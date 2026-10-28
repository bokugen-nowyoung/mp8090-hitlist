import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'setuplits.html'), 'utf8').replace(/\r\n?/g, '\n');
const rankingData = JSON.parse(readFileSync(join(root, 'data.json'), 'utf8').replace(/^\uFEFF/, ''));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sourceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0, `source marker not found: ${startMarker}`);
  assert(end > start, `source marker not found or out of order: ${endMarker}`);
  return html.slice(start, end);
}

function extractEpisodes() {
  const startMarker = '// <<SETUPLIST_DATA_START>>';
  const endMarker = '// <<SETUPLIST_DATA_END>>';
  const block = sourceBetween(startMarker, endMarker);
  const match = block.match(/const\s+SETUPLIST_DATA\s*=\s*([\s\S]*?)\s*;\s*$/);
  assert(match, 'SETUPLIST_DATA assignment has an unexpected format');
  return JSON.parse(match[1]);
}

function compileRankingRuntime({ includeApprovedAliases }) {
  const normalizeSource = sourceBetween(
    '    const normalizeForMatch = (s) => {',
    '\n\n    // ── 初登場（デビュー）判定 ──'
  );
  const artistAliasSource = sourceBetween(
    '    const ARTIST_SEARCH_ALIAS_GROUPS = [',
    '\n    const artistSearchAliasTermsByQuery'
  );
  let rankingSource = sourceBetween(
    '    function normalizeAnnualRankingArtistTerm(value) {',
    '\n    let annualRankingLoadState'
  );
  const resolveSource = sourceBetween(
    '    function resolveAnnualRanking(index, ep, track) {',
    '\n    function setAnnualRankingCell'
  );

  if (!includeApprovedAliases) {
    const aliasCall = '      addApprovedAnnualRankingTrackAliases(byTrack);\n';
    assert(rankingSource.includes(aliasCall), 'approved alias registration call not found');
    rankingSource = rankingSource.replace(aliasCall, '');
    assert(!rankingSource.includes(aliasCall), 'approved alias registration call appears more than once');
  }

  // setuplits.htmlの実コードをそのまま評価し、テスト側へ照合ロジックを複製しない。
  return Function(`
    ${normalizeSource}
    ${artistAliasSource}
    ${rankingSource}
    ${resolveSource}
    return {
      ANNUAL_RANKING_TRACK_ALIAS_GROUPS,
      ANNUAL_RANKING_TRACK_YEAR_OVERRIDES,
      annualRankingTrackKey,
      annualRankingTrackYearOverrideKey,
      buildAnnualRankingIndex,
      resolveAnnualRanking
    };
  `)();
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.className = '';
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.style = {
      removeProperty: name => { delete this.style[name]; }
    };
    this.listeners = new Map();
    this.focused = false;
    this.rect = { left: 100, top: 20, right: 150, bottom: 40, width: 50, height: 20 };
    this._textContent = '';
  }

  get textContent() {
    return this.children.length > 0
      ? this.children.map(child => child.textContent).join('')
      : this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get title() {
    return this.attributes.get('title') || '';
  }

  set title(value) {
    this.attributes.set('title', String(value));
  }

  append(...children) {
    children.forEach(child => this.appendChild(child));
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, properties = {}) {
    const event = { type, target: this, relatedTarget: null, ...properties };
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }

  focus() {
    this.focused = true;
  }

  contains(element) {
    for (let current = element; current; current = current.parentNode) {
      if (current === this) return true;
    }
    return false;
  }

  matches(selector) {
    const match = selector.match(/^\.([\w-]+)(?:\[data-visible="(true|false)"\])?$/);
    if (!match) return false;
    const classes = this.className.split(/\s+/).filter(Boolean);
    return classes.includes(match[1]) && (match[2] === undefined || this.dataset.visible === match[2]);
  }

  querySelectorAll(selector) {
    const results = [];
    const visit = element => {
      for (const child of element.children) {
        if (child.matches(selector)) results.push(child);
        visit(child);
      }
    };
    visit(this);
    return results;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getBoundingClientRect() {
    return this.rect;
  }
}

function compileAnnualRankingDisplayRuntime() {
  const displaySource = sourceBetween(
    "    const ANNUAL_RANKING_PENDING_LABEL = '確認中';",
    '\n    function updateAnnualRankingCells'
  );
  const document = {
    documentElement: { clientWidth: 1024 },
    createElement(tagName) {
      return new FakeElement(tagName);
    }
  };
  const window = {
    innerHeight: 600,
    hoverCapable: true,
    matchMedia() { return { matches: this.hoverCapable }; }
  };
  const modalBody = new FakeElement('div');
  return Function('document', 'window', 'modalBody', `
    ${displaySource}
    return {
      ANNUAL_RANKING_PENDING_LABEL,
      ANNUAL_RANKING_PENDING_HELP,
      setAnnualRankingCell,
      positionAnnualRankingHelp,
      closeAnnualRankingHelp,
      closeAnnualRankingHelpOnEscape,
      modalBody,
      testWindow: window,
      testDocument: document
    };
  `)(document, window, modalBody);
}

const episodes = extractEpisodes();
const beforeRuntime = compileRankingRuntime({ includeApprovedAliases: false });
const afterRuntime = compileRankingRuntime({ includeApprovedAliases: true });
const beforeIndex = beforeRuntime.buildAnnualRankingIndex(rankingData);
const afterIndex = afterRuntime.buildAnnualRankingIndex(rankingData);
const displayRuntime = compileAnnualRankingDisplayRuntime();

assert(displayRuntime.ANNUAL_RANKING_PENDING_LABEL === '確認中',
  'annual ranking pending display label changed');
assert(displayRuntime.ANNUAL_RANKING_PENDING_HELP === '複数年の年間ランキング候補があります',
  'annual ranking pending help text changed');

const pendingCell = new FakeElement('td');
pendingCell.setAttribute('title', 'old title');
displayRuntime.modalBody.appendChild(pendingCell);
displayRuntime.setAnnualRankingCell(pendingCell, {
  text: '要確認',
  title: '年間ランキングに異なる年または順位が複数あります'
});
assert(pendingCell.children.length === 1 && pendingCell.children[0].tagName === 'SPAN',
  'pending annual ranking must render a help wrapper');
const [pendingHelp] = pendingCell.children;
const pendingTrigger = pendingHelp.querySelector('.annual-ranking-help-trigger');
const pendingText = pendingHelp.querySelector('.annual-ranking-help-text');
assert(pendingHelp.className === 'annual-ranking-help',
  'pending annual ranking wrapper class changed');
assert(pendingTrigger?.tagName === 'BUTTON' && pendingTrigger.type === 'button'
  && pendingTrigger.textContent === '確認中',
  'pending annual ranking button changed');
assert(pendingText?.textContent === '複数年の年間ランキング候補があります',
  'pending annual ranking help content changed');
assert(pendingTrigger.attributes.get('aria-label')?.includes('複数年の年間ランキング候補があります'),
  'pending annual ranking accessible label is missing help text');
assert(pendingTrigger.attributes.get('aria-controls') === pendingText.id
  && pendingTrigger.attributes.get('aria-describedby') === pendingText.id
  && pendingText.attributes.get('role') === 'tooltip',
  'pending annual ranking accessible relationship changed');
assert(!pendingCell.attributes.has('title'),
  'pending annual ranking cell retained a stale title');

pendingTrigger.rect = { left: 100, top: 100, right: 140, bottom: 120, width: 40, height: 20 };
pendingText.rect = { left: 0, top: 0, right: 200, bottom: 50, width: 200, height: 50 };
pendingText.hidden = false;
displayRuntime.positionAnnualRankingHelp(pendingHelp);
assert(pendingText.style.top === '125px' && pendingText.style.left === '120px',
  'annual ranking help must use the normal below-trigger position');
pendingTrigger.rect = { left: 100, top: 560, right: 140, bottom: 580, width: 40, height: 20 };
displayRuntime.positionAnnualRankingHelp(pendingHelp);
assert(pendingText.style.top === '505px',
  'annual ranking help must flip above the trigger near the viewport bottom');
displayRuntime.testWindow.innerHeight = 80;
pendingTrigger.rect = { left: 100, top: 30, right: 140, bottom: 50, width: 40, height: 20 };
pendingText.rect = { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 };
displayRuntime.positionAnnualRankingHelp(pendingHelp);
assert(pendingText.style.top === '8px',
  'annual ranking help must clamp to the viewport margin when neither side fits');
displayRuntime.testWindow.innerHeight = 600;
pendingText.rect = { left: 0, top: 0, right: 200, bottom: 50, width: 200, height: 50 };
pendingTrigger.rect = { left: -50, top: 100, right: -30, bottom: 120, width: 20, height: 20 };
displayRuntime.positionAnnualRankingHelp(pendingHelp);
assert(pendingText.style.left === '108px',
  'annual ranking help must clamp its left edge to the viewport margin');
pendingTrigger.rect = { left: 1100, top: 100, right: 1120, bottom: 120, width: 20, height: 20 };
displayRuntime.positionAnnualRankingHelp(pendingHelp);
assert(pendingText.style.left === '916px',
  'annual ranking help must clamp its right edge to the viewport margin');
pendingText.rect = { left: 0, top: 0, right: 80, bottom: 50, width: 80, height: 50 };
pendingTrigger.rect = { left: -50, top: 100, right: -30, bottom: 120, width: 20, height: 20 };
displayRuntime.positionAnnualRankingHelp(pendingHelp);
assert(pendingText.style.left === '48px',
  'annual ranking help must use its measured width for a narrower left clamp');
pendingTrigger.rect = { left: 1100, top: 100, right: 1120, bottom: 120, width: 20, height: 20 };
displayRuntime.positionAnnualRankingHelp(pendingHelp);
assert(pendingText.style.left === '976px',
  'annual ranking help must use its measured width for a narrower right clamp');
pendingText.rect = { left: 0, top: 0, right: 1200, bottom: 50, width: 1200, height: 50 };
pendingTrigger.rect = { left: -50, top: 100, right: -30, bottom: 120, width: 20, height: 20 };
displayRuntime.positionAnnualRankingHelp(pendingHelp);
assert(pendingText.style.left === '512px',
  'oversized annual ranking help must center within the available viewport width');
pendingText.hidden = true;

displayRuntime.testWindow.hoverCapable = false;
pendingHelp.dispatch('pointerenter', { pointerType: 'mouse' });
assert(pendingText.hidden, 'non-hover-capable pointers must not show transient annual ranking help');
displayRuntime.testWindow.hoverCapable = true;
pendingHelp.dispatch('pointerenter', { pointerType: 'touch' });
assert(pendingText.hidden, 'touch pointerenter must not show transient annual ranking help');
pendingHelp.dispatch('pointerenter', { pointerType: 'mouse' });
assert(!pendingText.hidden && pendingTrigger.attributes.get('aria-expanded') === 'true',
  'hover-capable pointerenter must show annual ranking help');
pendingHelp.dispatch('pointerleave');
assert(pendingText.hidden && pendingTrigger.attributes.get('aria-expanded') === 'false',
  'pointerleave must hide unpinned annual ranking help');
pendingHelp.dispatch('focusin');
assert(!pendingText.hidden && pendingTrigger.attributes.get('aria-expanded') === 'true',
  'focusin must show annual ranking help');
pendingHelp.dispatch('focusout');
assert(pendingText.hidden && pendingTrigger.attributes.get('aria-expanded') === 'false',
  'focusout must hide annual ranking help');
displayRuntime.testWindow.hoverCapable = false;
pendingTrigger.dispatch('click');
assert(!pendingText.hidden && pendingHelp.dataset.pinned === 'true',
  'tap/click must pin annual ranking help open without hover support');
pendingTrigger.dispatch('click');
assert(pendingText.hidden && pendingHelp.dataset.pinned === 'false',
  'second tap/click must close pinned annual ranking help');
displayRuntime.testWindow.hoverCapable = true;

const secondCell = new FakeElement('td');
displayRuntime.modalBody.appendChild(secondCell);
displayRuntime.setAnnualRankingCell(secondCell, { text: '要確認', title: '' });
const secondHelp = secondCell.querySelector('.annual-ranking-help');
const secondTrigger = secondHelp.querySelector('.annual-ranking-help-trigger');
pendingHelp.dispatch('pointerleave');
pendingTrigger.dispatch('click');
secondTrigger.dispatch('click');
assert(pendingText.hidden && pendingTrigger.attributes.get('aria-expanded') === 'false'
  && secondHelp.dataset.pinned === 'true',
  'opening another annual ranking help must close the first');
displayRuntime.closeAnnualRankingHelp();
assert(secondHelp.querySelector('.annual-ranking-help-text').hidden,
  'outside-close path must hide annual ranking help');
secondHelp.dispatch('pointerleave');
secondTrigger.dispatch('click');
assert(displayRuntime.closeAnnualRankingHelpOnEscape(),
  'Escape handler must report that it closed annual ranking help');
assert(secondHelp.querySelector('.annual-ranking-help-text').hidden
  && secondTrigger.attributes.get('aria-expanded') === 'false'
  && secondTrigger.focused,
  'Escape must close annual ranking help, update aria, and restore trigger focus');
assert(!displayRuntime.closeAnnualRankingHelpOnEscape(),
  'a second Escape must fall through when no annual ranking help is visible');

for (const result of [
  { text: '14位', title: '' },
  { text: '―', title: '' },
  { text: '取得不可', title: '年間ランキングデータを取得できませんでした' }
]) {
  const cell = new FakeElement('td');
  displayRuntime.setAnnualRankingCell(cell, result);
  assert(cell.textContent === result.text && cell.children.length === 0,
    `ordinary annual ranking display changed: ${result.text}`);
  assert((cell.attributes.get('title') || '') === result.title,
    `ordinary annual ranking title changed: ${result.text}`);
}

assert(html.includes('@media (hover: hover) and (pointer: fine)'),
  'pointer-specific annual ranking help styling is missing');
assert(/\.annual-ranking-help-text\s*\{[^}]*box-sizing:\s*border-box;[^}]*max-width:\s*min\(14rem, calc\(100vw - 1rem\)\);/s.test(html),
  'annual ranking help must include padding and borders within its viewport max-width');

function resultFor(runtime, index, episode, track) {
  if (track.note === '洋楽枠') return { kind: 'foreign', text: '―' };
  const result = runtime.resolveAnnualRanking(index, episode, track);
  if (result.text === '―') return { kind: 'rankout', text: result.text };
  if (result.text === '要確認') return { kind: 'confirm', text: result.text };
  return { kind: 'regular', text: result.text };
}

function findTrack(episodeNo, trackNo) {
  const episode = episodes.find(item => item.episode_no === episodeNo);
  assert(episode, `episode not found: #${episodeNo}`);
  const track = episode.tracks.find(item => item.no === trackNo);
  assert(track, `track not found: #${episodeNo} No.${trackNo}`);
  return { episode, track };
}

const beforeTotals = { regular: 0, confirm: 0, rankout: 0, foreign: 0 };
const afterTotals = { regular: 0, confirm: 0, rankout: 0, foreign: 0 };
let newRegular = 0;
let existingChanged = 0;
for (const episode of episodes) {
  for (const track of episode.tracks || []) {
    const before = resultFor(beforeRuntime, beforeIndex, episode, track);
    const after = resultFor(afterRuntime, afterIndex, episode, track);
    beforeTotals[before.kind] += 1;
    afterTotals[after.kind] += 1;
    if (before.kind === 'rankout' && after.kind === 'regular') newRegular += 1;
    if (before.kind !== 'rankout' && before.text !== after.text) existingChanged += 1;
  }
}

assert(episodes.reduce((sum, episode) => sum + episode.tracks.length, 0) === 5462,
  'unexpected Set Up List track count');
assert(JSON.stringify(beforeTotals) === JSON.stringify({ regular: 3166, confirm: 331, rankout: 1663, foreign: 302 }),
  `unexpected pre-alias totals: ${JSON.stringify(beforeTotals)}`);
assert(JSON.stringify(afterTotals) === JSON.stringify({ regular: 3346, confirm: 331, rankout: 1483, foreign: 302 }),
  `unexpected post-alias totals: ${JSON.stringify(afterTotals)}`);
assert(afterRuntime.ANNUAL_RANKING_TRACK_ALIAS_GROUPS.length === 74,
  `unexpected approved alias destination count: ${afterRuntime.ANNUAL_RANKING_TRACK_ALIAS_GROUPS.length}`);
assert(newRegular === 180, `unexpected newly ranked count: ${newRegular}`);
assert(existingChanged === 0, `existing ranking results changed: ${existingChanged}`);

for (const [canonicalTitle, artist] of afterRuntime.ANNUAL_RANKING_TRACK_ALIAS_GROUPS) {
  const candidates = beforeIndex.byTrack.get(beforeRuntime.annualRankingTrackKey(canonicalTitle, artist));
  const expectedSize = canonicalTitle === '人生の空から' && artist === '松山千春' ? 2 : 1;
  assert(candidates?.size === expectedSize,
    `approved alias destination is missing or ambiguous: ${canonicalTitle} / ${artist} (${candidates?.size || 0})`);
}

const lifeAliasKey = afterRuntime.annualRankingTrackKey('人生(たび)の空から', '松山千春');
const lifeOverrideKey = afterRuntime.annualRankingTrackYearOverrideKey(
  165,
  '人生(たび)の空から',
  '松山千春'
);
const lifeCanonicalCandidates = afterIndex.byTrack.get(lifeAliasKey);
assert(lifeCanonicalCandidates?.size === 2,
  `人生の空から should retain both ranking candidates before override: ${lifeCanonicalCandidates?.size || 0}`);
assert(afterRuntime.ANNUAL_RANKING_TRACK_YEAR_OVERRIDES.get(lifeOverrideKey) === 1980,
  '人生(たび)の空から year override must be limited to #165 and 1980');

const episode297Overrides = [
  ['ス・ト・リ・ッ・パ・ー', '沢田研二', 1981],
  ['みちのくひとり旅', '山本譲二', 1981],
  ['帰ってこいよ', '松村和子', 1981]
];
for (const [title, artist, expectedYear] of episode297Overrides) {
  const overrideKey = afterRuntime.annualRankingTrackYearOverrideKey(297, title, artist);
  assert(afterRuntime.ANNUAL_RANKING_TRACK_YEAR_OVERRIDES.get(overrideKey) === expectedYear,
    `#297 year override is missing: ${title} / ${artist}`);
}
assert(afterRuntime.ANNUAL_RANKING_TRACK_YEAR_OVERRIDES.size === 4,
  `unexpected year override count: ${afterRuntime.ANNUAL_RANKING_TRACK_YEAR_OVERRIDES.size}`);

const positiveCases = [
  [269, 2, '19位'],
  [269, 4, '2位'],
  [269, 5, '73位'],
  [165, 19, '45位'],
  [39, 3, '35位'],
  [139, 3, '35位'],
  [159, 12, '1981年 35位'],
  [241, 5, '35位'],
  [122, 5, '19位'],
  [134, 17, '83位'],
  [207, 13, '1983年 69位'],
  [297, 1, '14位'],
  [297, 2, '―'],
  [297, 3, '42位'],
  [297, 4, '37位'],
  [297, 5, '32位'],
  [297, 6, '85位'],
  [297, 7, '43位'],
  [297, 8, '―'],
  [297, 9, '1982年 13位'],
  [297, 10, '13位'],
  [297, 11, '―'],
  [297, 12, '―'],
  [297, 13, '―'],
  [297, 14, '74位'],
  [297, 15, '―'],
  [297, 16, '16位'],
  [297, 17, '17位'],
  [297, 18, '86位']
];
for (const [episodeNo, trackNo, expected] of positiveCases) {
  const { episode, track } = findTrack(episodeNo, trackNo);
  const result = afterRuntime.resolveAnnualRanking(afterIndex, episode, track);
  assert(result.text === expected,
    `positive case failed: #${episodeNo} No.${trackNo} expected ${expected}, got ${result.text}`);
}

const episodeSpecificOverrideNegativeCases = [
  [61, 12],
  [173, 5],
  [95, 22],
  [95, 21],
  [139, 17],
  [229, 12]
];
for (const [episodeNo, trackNo] of episodeSpecificOverrideNegativeCases) {
  const { episode, track } = findTrack(episodeNo, trackNo);
  const result = afterRuntime.resolveAnnualRanking(afterIndex, episode, track);
  assert(result.text === '要確認',
    `#297-only year override leaked to #${episodeNo} No.${trackNo}: ${result.text}`);
}

const negativeCases = [
  [222, 6],
  [164, 15],
  [14, 9],
  [173, 4],
  [226, 5],
  [29, 15],
  [48, 14],
  [186, 5],
  [257, 12]
];
for (const [episodeNo, trackNo] of negativeCases) {
  const { episode, track } = findTrack(episodeNo, trackNo);
  const result = afterRuntime.resolveAnnualRanking(afterIndex, episode, track);
  assert(result.text === '―',
    `negative case was connected: #${episodeNo} No.${trackNo} ${track.title} -> ${result.text}`);
}

const untouchedGroups = [
  { title: 'Get Along Together', artist: '山根康広', count: 3, prefix: false },
  { title: '悲しい気持ち', artist: '桑田佳祐', count: 4, prefix: true },
  { title: '恋におちて', artist: '小林明子', count: 1, prefix: false },
  { title: 'ごめんね', artist: '高橋真梨子', count: 1, prefix: false },
  { title: 'E気持', artist: '沖田浩之', count: 3, prefix: false },
  { title: 'センチメンタル・ジャーニ', artist: '松本伊代', count: 1, prefix: false },
  { title: 'ユー・メイ・ドリーム', artist: 'シーナ&ザ・ロケッツ', count: 3, prefix: true }
];
for (const expected of untouchedGroups) {
  const matches = [];
  for (const episode of episodes) {
    for (const track of episode.tracks || []) {
      const titleMatches = expected.prefix ? track.title.startsWith(expected.title) : track.title === expected.title;
      if (titleMatches && track.artist === expected.artist) matches.push({ episode, track });
    }
  }
  assert(matches.length === expected.count,
    `unexpected untouched case count: ${expected.title} / ${expected.artist} (${matches.length})`);
  for (const { episode, track } of matches) {
    const before = beforeRuntime.resolveAnnualRanking(beforeIndex, episode, track);
    const after = afterRuntime.resolveAnnualRanking(afterIndex, episode, track);
    assert(after.text === before.text,
      `unapproved case changed: #${episode.episode_no} No.${track.no} ${track.title}`);
  }
}

console.log('mp8090 annual ranking regression\n');
console.log('[OK] production ranking functions loaded from setuplits.html');
console.log('[OK] approved destinations=74; newly ranked=180; controlled canonical ambiguity=1');
console.log('[OK] totals: regular=3346, confirm=331, rankout=1483, foreign=302');
console.log('[OK] required positives=29; untouched groups=7; negative cases=9');
console.log('[OK] episode-specific year overrides=4; leakage checks=6');
console.log('[OK] existing ranking result changes=0');
console.log('[OK] pending display=確認中; placement/touch/hover/focus/click/outside/Escape verified');
console.log('\nResult: PASS (failures=0)');
