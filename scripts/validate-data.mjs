import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const START_MARKER = '// <<SETUPLIST_DATA_START>>';
const END_MARKER = '// <<SETUPLIST_DATA_END>>';
const REQUIRED_FILES = [
  'index.html',
  'setuplits.html',
  'year-end-chart.html',
  'gallery.html',
  'top.html',
  'googleba0f6ee57d1ea362.html',
  'style.css',
  'app.js',
  'data.json',
  'data/dousoukai-data.json',
];

export class Report {
  constructor() {
    this.items = [];
  }

  add(level, area, message) {
    this.items.push({ level, area, message });
  }

  ok(area, message) { this.add('OK', area, message); }
  warning(area, message) { this.add('WARNING', area, message); }
  error(area, message) { this.add('ERROR', area, message); }

  count(level) {
    return this.items.filter(item => item.level === level).length;
  }

  print() {
    console.log('mp8090 data validation\n');
    for (const item of this.items) {
      console.log(`[${item.level}] ${item.area}: ${item.message}`);
    }
    const errors = this.count('ERROR');
    const warnings = this.count('WARNING');
    console.log(`\nResult: ${errors === 0 ? 'PASS' : 'FAIL'} (errors=${errors}, warnings=${warnings})`);
  }
}

export function exitCodeFor(report) {
  return report.count('ERROR') === 0 ? 0 : 1;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function requireFields(value, fields, report, area, location) {
  if (!isObject(value)) {
    report.error(area, `${location} must be an object`);
    return false;
  }
  let complete = true;
  for (const field of fields) {
    if (!hasOwn(value, field)) {
      report.error(area, `${location} missing field: ${field}`);
      complete = false;
    }
  }
  return complete;
}

function validIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

export function extractSetuplistData(html, sourceName = 'setuplits.html') {
  const text = html.replace(/^\uFEFF/, '');
  const startCount = countOccurrences(text, START_MARKER);
  const endCount = countOccurrences(text, END_MARKER);
  if (startCount !== 1 || endCount !== 1) {
    throw new Error(`${sourceName}: expected exactly one START and END marker (found ${startCount}/${endCount})`);
  }
  const start = text.indexOf(START_MARKER) + START_MARKER.length;
  const end = text.indexOf(END_MARKER);
  if (end <= start) throw new Error(`${sourceName}: SETUPLIST_DATA markers are out of order`);
  const block = text.slice(start, end);
  const match = /^\s*const\s+SETUPLIST_DATA\s*=\s*([\s\S]*?)\s*;\s*$/.exec(block);
  if (!match) throw new Error(`${sourceName}: SETUPLIST_DATA assignment has an unexpected format`);
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`${sourceName}: invalid SETUPLIST_DATA JSON: ${error.message}`);
  }
}

function setuplistSnapshot(data) {
  const byPuy = {};
  const byEpisode = {};
  let tracks = 0;
  if (!Array.isArray(data)) return { episodes: 0, tracks: 0, byPuy, byEpisode };
  for (const episode of data) {
    if (!isObject(episode)) continue;
    const count = Array.isArray(episode.tracks) ? episode.tracks.length : 0;
    tracks += count;
    if (Number.isInteger(episode.puy_year)) {
      const key = String(episode.puy_year);
      byPuy[key] = (byPuy[key] || 0) + count;
    }
    if (Number.isInteger(episode.episode_no)) byEpisode[String(episode.episode_no)] = count;
  }
  return { episodes: data.length, tracks, byPuy, byEpisode };
}

export function validateSetuplist(data, report, { imageNames = null } = {}) {
  if (!Array.isArray(data)) {
    report.error('SETUPLIST', 'SETUPLIST_DATA must be an array');
    return setuplistSnapshot(data);
  }
  if (data.length === 0) report.error('SETUPLIST', 'SETUPLIST_DATA is empty');

  const episodeNumbers = new Set();
  let imageReferences = 0;
  for (let index = 0; index < data.length; index += 1) {
    const episode = data[index];
    const location = `episode[index=${index}]`;
    if (!requireFields(episode,
      ['episode_no', 'puy_year', 'air_date', 'special_feature', 'image_file', 'tracks'],
      report, 'SETUPLIST', location)) continue;

    const episodeNo = episode.episode_no;
    const episodeLocation = Number.isInteger(episodeNo) ? `episode_no=${episodeNo}` : location;
    if (!Number.isInteger(episodeNo) || episodeNo <= 0) {
      report.error('SETUPLIST', `${location} invalid episode_no: ${JSON.stringify(episodeNo)}`);
    } else if (episodeNumbers.has(episodeNo)) {
      report.error('SETUPLIST', `duplicate episode_no: ${episodeNo}`);
    } else {
      episodeNumbers.add(episodeNo);
    }

    if (!Number.isInteger(episode.puy_year) || episode.puy_year < 1980 || episode.puy_year > 1999) {
      report.error('SETUPLIST', `${episodeLocation} invalid puy_year: ${JSON.stringify(episode.puy_year)}`);
    }
    if (typeof episode.air_date !== 'string' || !validIsoDate(episode.air_date)) {
      report.error('SETUPLIST', `${episodeLocation} invalid air_date: ${JSON.stringify(episode.air_date)}`);
    }
    if (episode.special_feature !== null && typeof episode.special_feature !== 'string') {
      report.error('SETUPLIST', `${episodeLocation} special_feature must be string or null`);
    }

    if (episode.image_file !== null) {
      if (!nonEmptyString(episode.image_file)
        || isAbsolute(episode.image_file)
        || episode.image_file.includes('/')
        || episode.image_file.includes('\\')
        || episode.image_file.includes('..')) {
        report.error('IMAGE', `${episodeLocation} invalid image_file: ${JSON.stringify(episode.image_file)}`);
      } else {
        imageReferences += 1;
        if (imageNames instanceof Set && !imageNames.has(episode.image_file)) {
          report.error('IMAGE', `${episodeLocation} missing image: ${episode.image_file}`);
        }
      }
    }

    if (!Array.isArray(episode.tracks)) {
      report.error('SETUPLIST', `${episodeLocation} tracks must be an array`);
      continue;
    }
    if (episode.tracks.length === 0) {
      report.error('SETUPLIST', `${episodeLocation} tracks is empty`);
    }
    for (let trackIndex = 0; trackIndex < episode.tracks.length; trackIndex += 1) {
      const track = episode.tracks[trackIndex];
      const trackLocation = `${episodeLocation} track[index=${trackIndex}]`;
      if (!requireFields(track, ['no', 'title', 'artist', 'note'], report, 'SETUPLIST', trackLocation)) continue;
      const validNumber = Number.isInteger(track.no) && track.no > 0;
      const validAnnotation = typeof track.no === 'string' && track.no.trim() !== '';
      if (!validNumber && !validAnnotation) {
        report.error('SETUPLIST', `${trackLocation} invalid no: ${JSON.stringify(track.no)}`);
      }
      if (!nonEmptyString(track.title)) report.error('SETUPLIST', `${trackLocation} invalid title`);
      if (!nonEmptyString(track.artist)) report.error('SETUPLIST', `${trackLocation} invalid artist`);
      if (track.note !== null && typeof track.note !== 'string') {
        report.error('SETUPLIST', `${trackLocation} note must be string or null`);
      }
    }
  }

  const snapshot = setuplistSnapshot(data);
  report.ok('SETUPLIST', `parsed; episodes=${snapshot.episodes}, tracks=${snapshot.tracks}`);
  report.ok('IMAGE', `references checked=${imageReferences}${imageNames instanceof Set ? '' : ' (file lookup unavailable)'}`);
  report.ok('SETUPLIST', `tracks by PUY year: ${formatMap(snapshot.byPuy)}`);
  return snapshot;
}

function rankingSnapshot(data) {
  const byYear = {};
  let tracks = 0;
  if (!isObject(data)) return { tracks, byYear };
  for (let year = 1980; year <= 1999; year += 1) {
    const songs = data[String(year)];
    const count = Array.isArray(songs) ? songs.length : 0;
    byYear[String(year)] = count;
    tracks += count;
  }
  return { tracks, byYear };
}

export function validateRanking(data, report) {
  if (!isObject(data)) {
    report.error('RANKING', 'data.json root must be an object');
    return rankingSnapshot(data);
  }
  const expectedYears = new Set(Array.from({ length: 20 }, (_, index) => String(1980 + index)));
  for (const key of Object.keys(data)) {
    if (!expectedYears.has(key)) report.warning('RANKING', `unexpected year key: ${key}`);
  }

  for (const year of expectedYears) {
    if (!hasOwn(data, year)) {
      report.error('RANKING', `missing year: ${year}`);
      continue;
    }
    const songs = data[year];
    if (!Array.isArray(songs)) {
      report.error('RANKING', `year=${year} must be an array`);
      continue;
    }
    if (songs.length === 0) report.warning('RANKING', `year=${year} is empty`);
    const ranks = new Set();
    for (let index = 0; index < songs.length; index += 1) {
      const song = songs[index];
      const location = `year=${year} song[index=${index}]`;
      if (!requireFields(song,
        ['rank', 'title', 'artist', 'release_date', 'youtube_url'],
        report, 'RANKING', location)) continue;
      if (!Number.isInteger(song.rank) || song.rank <= 0) {
        report.error('RANKING', `${location} invalid rank: ${JSON.stringify(song.rank)}`);
      } else if (ranks.has(song.rank)) {
        report.error('RANKING', `year=${year} duplicate rank: ${song.rank}`);
      } else {
        ranks.add(song.rank);
      }
      if (!nonEmptyString(song.title)) report.error('RANKING', `${location} invalid title`);
      if (!nonEmptyString(song.artist)) report.error('RANKING', `${location} invalid artist`);
      for (const field of ['release_date', 'youtube_url']) {
        if (typeof song[field] !== 'string') {
          report.error('RANKING', `${location} ${field} must be a string`);
        } else if (song[field].trim() === '') {
          report.warning('RANKING', `${location} ${field} is empty`);
        }
      }
    }
  }
  const snapshot = rankingSnapshot(data);
  report.ok('RANKING', `data.json 1980-1999; tracks=${snapshot.tracks}`);
  report.ok('RANKING', `tracks by year: ${formatMap(snapshot.byYear)}`);
  return snapshot;
}

function eventSongCount(event) {
  if (!isObject(event)) return 0;
  if (Array.isArray(event.songs)) return event.songs.length;
  if (Array.isArray(event.groups)) {
    return event.groups.reduce((sum, group) => sum + (Array.isArray(group?.songs) ? group.songs.length : 0), 0);
  }
  return 0;
}

function dousoukaiSnapshot(data) {
  const byKai = {};
  const events = isObject(data) && Array.isArray(data.dousoukai) ? data.dousoukai : [];
  let songs = 0;
  for (const event of events) {
    const count = eventSongCount(event);
    songs += count;
    if (Number.isInteger(event?.kai)) byKai[String(event.kai)] = count;
  }
  return { events: events.length, songs, byKai };
}

function validateDousoukaiSong(song, columns, report, location, requireNumber) {
  if (!requireFields(song, columns, report, 'DOUSOUKAI', location)) return;
  if (!nonEmptyString(song.title)) report.error('DOUSOUKAI', `${location} invalid title`);
  if (!nonEmptyString(song.artist)) report.error('DOUSOUKAI', `${location} invalid artist`);
  if (requireNumber && (!Number.isInteger(song.no) || song.no <= 0)) {
    report.error('DOUSOUKAI', `${location} invalid no: ${JSON.stringify(song.no)}`);
  }
  if (columns.includes('puy') && !nonEmptyString(song.puy)) {
    report.error('DOUSOUKAI', `${location} invalid puy`);
  }
  if (columns.includes('note') && typeof song.note !== 'string') {
    report.error('DOUSOUKAI', `${location} note must be a string`);
  }
  if (hasOwn(song, 'group') && typeof song.group !== 'string') {
    report.error('DOUSOUKAI', `${location} group must be a string when present`);
  }
}

export function validateDousoukai(data, report) {
  if (!isObject(data) || !Array.isArray(data.dousoukai)) {
    report.error('DOUSOUKAI', 'root.dousoukai must be an array');
    return dousoukaiSnapshot(data);
  }
  if (data.dousoukai.length === 0) report.error('DOUSOUKAI', 'dousoukai is empty');
  const kaiNumbers = new Set();
  for (let index = 0; index < data.dousoukai.length; index += 1) {
    const event = data.dousoukai[index];
    const location = `event[index=${index}]`;
    if (!requireFields(event, ['kai', 'title', 'venue', 'date', 'columns'], report, 'DOUSOUKAI', location)) continue;
    const eventLocation = Number.isInteger(event.kai) ? `kai=${event.kai}` : location;
    if (!Number.isInteger(event.kai) || event.kai <= 0) {
      report.error('DOUSOUKAI', `${location} invalid kai: ${JSON.stringify(event.kai)}`);
    } else if (kaiNumbers.has(event.kai)) {
      report.error('DOUSOUKAI', `duplicate kai: ${event.kai}`);
    } else {
      kaiNumbers.add(event.kai);
    }
    for (const field of ['title', 'venue', 'date']) {
      if (!nonEmptyString(event[field])) report.error('DOUSOUKAI', `${eventLocation} invalid ${field}`);
    }
    if (!Array.isArray(event.columns) || event.columns.length === 0
      || event.columns.some(column => !nonEmptyString(column))) {
      report.error('DOUSOUKAI', `${eventLocation} columns must be a non-empty string array`);
      continue;
    }
    if (new Set(event.columns).size !== event.columns.length) {
      report.error('DOUSOUKAI', `${eventLocation} columns contains duplicates`);
    }

    if (event.columns.includes('no')) {
      if (!Array.isArray(event.songs) || event.songs.length === 0) {
        report.error('DOUSOUKAI', `${eventLocation} songs must be a non-empty array`);
        continue;
      }
      for (let songIndex = 0; songIndex < event.songs.length; songIndex += 1) {
        validateDousoukaiSong(event.songs[songIndex], event.columns, report,
          `${eventLocation} song[index=${songIndex}]`, true);
      }
    } else {
      if (!Array.isArray(event.groups) || event.groups.length === 0) {
        report.error('DOUSOUKAI', `${eventLocation} groups must be a non-empty array`);
        continue;
      }
      for (let groupIndex = 0; groupIndex < event.groups.length; groupIndex += 1) {
        const group = event.groups[groupIndex];
        const groupLocation = `${eventLocation} group[index=${groupIndex}]`;
        if (!requireFields(group, ['name', 'songs'], report, 'DOUSOUKAI', groupLocation)) continue;
        if (!nonEmptyString(group.name)) report.error('DOUSOUKAI', `${groupLocation} invalid name`);
        if (!Array.isArray(group.songs) || group.songs.length === 0) {
          report.error('DOUSOUKAI', `${groupLocation} songs must be a non-empty array`);
          continue;
        }
        for (let songIndex = 0; songIndex < group.songs.length; songIndex += 1) {
          validateDousoukaiSong(group.songs[songIndex], event.columns, report,
            `${groupLocation} song[index=${songIndex}]`, false);
        }
      }
    }
  }
  const snapshot = dousoukaiSnapshot(data);
  report.ok('DOUSOUKAI', `parsed; events=${snapshot.events}, songs=${snapshot.songs}`);
  report.ok('DOUSOUKAI', `songs by event: ${formatMap(snapshot.byKai, '#')}`);
  return snapshot;
}

function formatMap(values, prefix = '') {
  return Object.entries(values).map(([key, value]) => `${prefix}${key}=${value}`).join(', ');
}

function readJson(root, relativePath, report, area) {
  try {
    return JSON.parse(readFileSync(join(root, relativePath), 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    report.error(area, `${relativePath} could not be parsed: ${error.message}`);
    return null;
  }
}

export function validateImportantFiles(root, report) {
  const missing = REQUIRED_FILES.filter(relativePath => {
    try {
      return !lstatSync(join(root, relativePath)).isFile();
    } catch {
      return true;
    }
  });
  for (const relativePath of missing) report.error('FILES', `missing required file: ${relativePath}`);
  if (missing.length === 0) report.ok('FILES', `required files present=${REQUIRED_FILES.length}`);
}

export function regularFileNames(entries) {
  return new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name));
}

function readHeadFile(root, relativePath) {
  const result = spawnSync('git', ['show', `HEAD:${relativePath}`], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || 'git show failed').trim();
    throw new Error(detail || 'git show failed');
  }
  return result.stdout;
}

function compareValue(report, label, before, after) {
  if (after < before) report.warning('HEAD', `${label} decreased: ${before} -> ${after}`);
  else if (after > before) report.ok('HEAD', `${label} increased: ${before} -> ${after}`);
}

function compareMap(report, label, before, after) {
  for (const [key, oldCount] of Object.entries(before)) {
    const newCount = after[key] ?? 0;
    compareValue(report, `${label} ${key}`, oldCount, newCount);
  }
  for (const [key, newCount] of Object.entries(after)) {
    if (!hasOwn(before, key)) report.ok('HEAD', `${label} ${key} added: 0 -> ${newCount}`);
  }
}

export function compareSnapshots(report, head, current) {
  const warningsBefore = report.count('WARNING');
  const itemsBefore = report.items.length;
  compareValue(report, 'Set Up List episodes', head.setuplist.episodes, current.setuplist.episodes);
  compareValue(report, 'Set Up List tracks', head.setuplist.tracks, current.setuplist.tracks);
  compareMap(report, 'Set Up List PUY', head.setuplist.byPuy, current.setuplist.byPuy);
  compareMap(report, 'Set Up List episode', head.setuplist.byEpisode, current.setuplist.byEpisode);
  compareValue(report, 'Ranking tracks', head.ranking.tracks, current.ranking.tracks);
  compareMap(report, 'Ranking year', head.ranking.byYear, current.ranking.byYear);
  compareValue(report, 'Dousoukai events', head.dousoukai.events, current.dousoukai.events);
  compareValue(report, 'Dousoukai songs', head.dousoukai.songs, current.dousoukai.songs);
  compareMap(report, 'Dousoukai event', head.dousoukai.byKai, current.dousoukai.byKai);
  if (report.items.length === itemsBefore) report.ok('HEAD', 'data counts unchanged from HEAD');
  else if (report.count('WARNING') === warningsBefore) report.ok('HEAD', 'comparison completed with no count decreases');
}

export function compareWithHead(root, current, report) {
  try {
    const headSetuplist = extractSetuplistData(readHeadFile(root, 'setuplits.html'), 'HEAD:setuplits.html');
    const headRanking = JSON.parse(readHeadFile(root, 'data.json').replace(/^\uFEFF/, ''));
    const headDousoukai = JSON.parse(readHeadFile(root, 'data/dousoukai-data.json').replace(/^\uFEFF/, ''));
    compareSnapshots(report, {
      setuplist: setuplistSnapshot(headSetuplist),
      ranking: rankingSnapshot(headRanking),
      dousoukai: dousoukaiSnapshot(headDousoukai),
    }, current);
  } catch (error) {
    report.warning('HEAD', `comparison unavailable: ${error.message}`);
  }
}

export function runValidation(root) {
  const report = new Report();
  validateImportantFiles(root, report);

  let setuplist = null;
  try {
    setuplist = extractSetuplistData(readFileSync(join(root, 'setuplits.html'), 'utf8'));
  } catch (error) {
    report.error('SETUPLIST', error.message);
  }

  let imageNames = null;
  try {
    imageNames = regularFileNames(readdirSync(join(root, 'images', 'setuplits'), { withFileTypes: true }));
  } catch (error) {
    report.error('IMAGE', `images/setuplits could not be read: ${error.message}`);
  }

  const ranking = readJson(root, 'data.json', report, 'RANKING');
  const dousoukai = readJson(root, 'data/dousoukai-data.json', report, 'DOUSOUKAI');
  const current = {
    setuplist: setuplist === null ? null : validateSetuplist(setuplist, report, { imageNames }),
    ranking: ranking === null ? null : validateRanking(ranking, report),
    dousoukai: dousoukai === null ? null : validateDousoukai(dousoukai, report),
  };
  if (current.setuplist && current.ranking && current.dousoukai) {
    compareWithHead(root, current, report);
  } else {
    report.warning('HEAD', 'comparison skipped because current data could not be parsed');
  }
  return report;
}

function makeRankingFixture() {
  const data = {};
  for (let year = 1980; year <= 1999; year += 1) {
    data[String(year)] = [{
      rank: 1,
      title: `Song ${year}`,
      artist: 'Artist',
      release_date: `${year}/01/01`,
      youtube_url: 'https://www.youtube.com/results?search_query=test',
    }];
  }
  return data;
}

function makeSetuplistFixture() {
  return [
    {
      episode_no: 1,
      puy_year: 1980,
      air_date: '2020-01-01',
      special_feature: null,
      image_file: null,
      tracks: [{ no: 1, title: 'Song A', artist: 'Artist A', note: null }],
    },
    {
      episode_no: 3,
      puy_year: 1981,
      air_date: '2020-01-08',
      special_feature: 'Feature',
      image_file: '1981.3.png',
      tracks: [{ no: '※', title: 'Song B', artist: 'Artist B', note: 'Note' }],
    },
  ];
}

function makeDousoukaiFixture() {
  return {
    dousoukai: [
      {
        kai: 1, title: 'Event 1', venue: 'Venue', date: '2025.1.1',
        columns: ['no', 'title', 'artist', 'puy', 'note'],
        songs: [{ no: 1, title: 'Song', artist: 'Artist', puy: '1980', note: '' }],
      },
      {
        kai: 2, title: 'Event 2', venue: 'Venue', date: '2025.2.2',
        columns: ['title', 'artist'],
        groups: [{ name: 'Group', songs: [{ title: 'Song', artist: 'Artist' }] }],
      },
    ],
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasDiagnostic(report, level, text) {
  return report.items.some(item => item.level === level && item.message.includes(text));
}

export function runSelfTest() {
  const tests = [];
  const test = (name, callback) => tests.push({ name, callback });
  const validateSet = (data, images = new Set(['1981.3.png'])) => {
    const report = new Report();
    validateSetuplist(data, report, { imageNames: images });
    return report;
  };

  test('valid fixtures, episode gap, null image, annotation track number', () => {
    const report = validateSet(makeSetuplistFixture());
    validateRanking(makeRankingFixture(), report);
    validateDousoukai(makeDousoukaiFixture(), report);
    return report.count('ERROR') === 0;
  });
  test('malformed SETUPLIST JSON', () => {
    try {
      extractSetuplistData(`${START_MARKER}\nconst SETUPLIST_DATA = [;\n${END_MARKER}`);
      return false;
    } catch { return true; }
  });
  test('duplicate episode_no', () => {
    const data = makeSetuplistFixture();
    data[1].episode_no = 1;
    return hasDiagnostic(validateSet(data), 'ERROR', 'duplicate episode_no');
  });
  test('missing image reference', () =>
    hasDiagnostic(validateSet(makeSetuplistFixture(), new Set()), 'ERROR', 'missing image'));
  test('image directories are not accepted as files', () => {
    const names = regularFileNames([
      { name: 'real.png', isFile: () => true },
      { name: 'directory.png', isFile: () => false },
    ]);
    return names.has('real.png') && !names.has('directory.png');
  });
  test('missing required track field', () => {
    const data = makeSetuplistFixture();
    delete data[0].tracks[0].artist;
    return hasDiagnostic(validateSet(data), 'ERROR', 'missing field: artist');
  });
  test('empty ranking year is WARNING only', () => {
    const data = makeRankingFixture();
    data['1980'] = [];
    const report = new Report();
    validateRanking(data, report);
    return report.count('ERROR') === 0 && hasDiagnostic(report, 'WARNING', 'year=1980 is empty');
  });
  test('duplicate ranking rank', () => {
    const data = makeRankingFixture();
    data['1980'].push(clone(data['1980'][0]));
    const report = new Report();
    validateRanking(data, report);
    return hasDiagnostic(report, 'ERROR', 'duplicate rank');
  });
  test('HEAD count decrease is WARNING only', () => {
    const report = new Report();
    const head = {
      setuplist: { episodes: 2, tracks: 2, byPuy: { 1980: 2 }, byEpisode: { 1: 2 } },
      ranking: { tracks: 2, byYear: { 1980: 2 } },
      dousoukai: { events: 1, songs: 2, byKai: { 1: 2 } },
    };
    const current = {
      setuplist: { episodes: 1, tracks: 1, byPuy: { 1980: 1 }, byEpisode: { 1: 1 } },
      ranking: { tracks: 1, byYear: { 1980: 1 } },
      dousoukai: { events: 1, songs: 1, byKai: { 1: 1 } },
    };
    compareSnapshots(report, head, current);
    return report.count('ERROR') === 0 && report.count('WARNING') > 0;
  });
  test('exit code is nonzero only when ERROR exists', () => {
    const warningsOnly = new Report();
    warningsOnly.warning('TEST', 'review needed');
    const withError = new Report();
    withError.error('TEST', 'broken data');
    return exitCodeFor(warningsOnly) === 0 && exitCodeFor(withError) !== 0;
  });

  console.log('mp8090 validator self-test\n');
  let failures = 0;
  for (const item of tests) {
    try {
      const passed = item.callback();
      console.log(`[${passed ? 'OK' : 'ERROR'}] ${item.name}`);
      if (!passed) failures += 1;
    } catch (error) {
      failures += 1;
      console.log(`[ERROR] ${item.name}: ${error.message}`);
    }
  }
  console.log(`\nResult: ${failures === 0 ? 'PASS' : 'FAIL'} (failures=${failures})`);
  return failures === 0 ? 0 : 1;
}

function parseArguments(argv) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  let selfTest = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--self-test') selfTest = true;
    else if (arg === '--root') {
      if (!argv[index + 1]) throw new Error('--root requires a directory');
      root = resolve(argv[index + 1]);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/validate-data.mjs [--root DIR] [--self-test]');
      return { help: true, root, selfTest };
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { help: false, root, selfTest };
}

const isDirectRun = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (!options.help) {
      if (options.selfTest) {
        process.exitCode = runSelfTest();
      } else {
        const report = runValidation(options.root);
        report.print();
        process.exitCode = exitCodeFor(report);
      }
    }
  } catch (error) {
    console.error(`[ERROR] VALIDATOR: ${error.message}`);
    process.exitCode = 1;
  }
}
