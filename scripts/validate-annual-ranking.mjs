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

const episodes = extractEpisodes();
const beforeRuntime = compileRankingRuntime({ includeApprovedAliases: false });
const afterRuntime = compileRankingRuntime({ includeApprovedAliases: true });
const beforeIndex = beforeRuntime.buildAnnualRankingIndex(rankingData);
const afterIndex = afterRuntime.buildAnnualRankingIndex(rankingData);

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
console.log('\nResult: PASS (failures=0)');
