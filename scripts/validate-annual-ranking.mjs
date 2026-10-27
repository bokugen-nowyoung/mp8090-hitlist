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
      annualRankingTrackKey,
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

assert(episodes.reduce((sum, episode) => sum + episode.tracks.length, 0) === 5444,
  'unexpected Set Up List track count');
assert(JSON.stringify(beforeTotals) === JSON.stringify({ regular: 3155, confirm: 331, rankout: 1657, foreign: 301 }),
  `unexpected pre-alias totals: ${JSON.stringify(beforeTotals)}`);
assert(JSON.stringify(afterTotals) === JSON.stringify({ regular: 3326, confirm: 331, rankout: 1486, foreign: 301 }),
  `unexpected post-alias totals: ${JSON.stringify(afterTotals)}`);
assert(afterRuntime.ANNUAL_RANKING_TRACK_ALIAS_GROUPS.length === 69,
  `unexpected approved alias destination count: ${afterRuntime.ANNUAL_RANKING_TRACK_ALIAS_GROUPS.length}`);
assert(newRegular === 171, `unexpected newly ranked count: ${newRegular}`);
assert(existingChanged === 0, `existing ranking results changed: ${existingChanged}`);

for (const [canonicalTitle, artist] of afterRuntime.ANNUAL_RANKING_TRACK_ALIAS_GROUPS) {
  const candidates = beforeIndex.byTrack.get(beforeRuntime.annualRankingTrackKey(canonicalTitle, artist));
  assert(candidates?.size === 1,
    `approved alias destination is missing or ambiguous: ${canonicalTitle} / ${artist} (${candidates?.size || 0})`);
}

const positiveCases = [
  [269, 2, '19位'],
  [269, 4, '2位'],
  [269, 5, '73位']
];
for (const [episodeNo, trackNo, expected] of positiveCases) {
  const { episode, track } = findTrack(episodeNo, trackNo);
  const result = afterRuntime.resolveAnnualRanking(afterIndex, episode, track);
  assert(result.text === expected,
    `positive case failed: #${episodeNo} No.${trackNo} expected ${expected}, got ${result.text}`);
}

const negativeCases = [
  [222, 6],
  [164, 15],
  [14, 9],
  [173, 4],
  [226, 5]
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
  { title: 'センチメンタル・ジャーニ', artist: '松本伊代', count: 1, prefix: false }
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
console.log('[OK] approved destinations=69; newly ranked=171; canonical ambiguity=0');
console.log('[OK] totals: regular=3326, confirm=331, rankout=1486, foreign=301');
console.log('[OK] required positives=3; untouched groups=6; negative cases=5');
console.log('[OK] existing ranking result changes=0');
console.log('\nResult: PASS (failures=0)');
