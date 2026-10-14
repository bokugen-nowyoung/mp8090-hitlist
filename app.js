'use strict';

const YEARS = Array.from({ length: 20 }, (_, i) => 1980 + i);
const SEARCH_GRAPHEME_SEGMENTER = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;
const SEARCH_COMBINING_MARK = /\p{M}/u;
const SEARCH_VIRAMA_CODE_POINTS = new Set([
  0x094D, 0x09CD, 0x0A4D, 0x0ACD, 0x0B4D, 0x0BCD, 0x0C4D, 0x0CCD,
  0x0D4D, 0x0DCA, 0x0F84, 0x1039, 0x103A, 0x1714, 0x1734, 0x17D2,
  0x1A60, 0x1B44, 0x1BAA, 0xA806, 0xA8C4, 0xA953, 0xAAF6, 0xABED
]);

let rankingData = {};
let currentYear = 1980;
let rankingSearchIndex = [];
let searchIsComposing = false;
let ignoreNextSearchSubmit = false;

/* --------------------------------------------------------
   Init
   -------------------------------------------------------- */
async function init() {
  try {
    const res = await fetch('data.json');
    if (!res.ok) throw new Error(`HTTP ${res.status} — data.json の読み込みに失敗しました`);
    rankingData = await res.json();
    rankingSearchIndex = buildRankingSearchIndex(rankingData);
  } catch (err) {
    const errEl = document.getElementById('errorMsg');
    errEl.textContent = `⚠️ ${err.message}`;
    errEl.hidden = false;
    document.getElementById('loadingMsg').hidden = true;
    return;
  }

  renderYearButtons();
  setupSearch();
  showYear(1980);

  document.getElementById('loadingMsg').hidden = true;
  document.getElementById('chartSection').hidden = false;

  document.addEventListener('keydown', handleKeyNav);
}

/* --------------------------------------------------------
   Year buttons
   -------------------------------------------------------- */
function renderYearButtons() {
  const container = document.getElementById('yearButtons');
  const frag = document.createDocumentFragment();

  YEARS.forEach(y => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'year-btn';
    btn.textContent = y;
    btn.dataset.year = String(y);
    btn.setAttribute('aria-label', `${y}年のランキングを表示`);
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      closeSearch();
      showYear(y);
    });
    frag.appendChild(btn);
  });

  container.appendChild(frag);
}

/* --------------------------------------------------------
   Search
   -------------------------------------------------------- */
function buildRankingSearchIndex(data) {
  return YEARS.flatMap(year => (data[String(year)] || []).map(entry => ({
    year,
    rank: entry.rank,
    title: entry.title,
    artist: entry.artist,
    normalizedTitle: normalizeSearchText(entry.title),
    normalizedArtist: normalizeSearchText(entry.artist)
  }))).sort((a, b) => a.year - b.year || a.rank - b.rank);
}

function setupSearch() {
  const toggle = document.getElementById('chartSearchToggle');
  const panel = document.getElementById('chartSearchPanel');
  const keyword = document.getElementById('chartSearchKeyword');
  const clearButton = document.getElementById('chartSearchClear');
  const closeButton = document.getElementById('chartSearchResultsClose');

  toggle.disabled = false;
  toggle.addEventListener('click', () => {
    if (toggle.getAttribute('aria-expanded') === 'true') {
      closeSearch();
      return;
    }
    openSearch();
  });

  panel.addEventListener('submit', event => {
    event.preventDefault();
    if (searchIsComposing || ignoreNextSearchSubmit) return;
    runSearch();
  });

  keyword.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    if (!event.isComposing && !searchIsComposing && event.keyCode !== 229) return;

    ignoreNextSearchSubmit = true;
    setTimeout(() => {
      ignoreNextSearchSubmit = false;
    }, 0);
  });

  keyword.addEventListener('compositionstart', () => {
    searchIsComposing = true;
  });
  keyword.addEventListener('compositionend', () => {
    searchIsComposing = false;
  });

  clearButton.addEventListener('click', () => {
    clearSearchConditionsAndResults();
    keyword.focus();
  });

  closeButton.addEventListener('click', () => closeSearch({ focusToggle: true }));
}

function openSearch() {
  const toggle = document.getElementById('chartSearchToggle');
  const panel = document.getElementById('chartSearchPanel');

  panel.hidden = false;
  toggle.setAttribute('aria-expanded', 'true');
  document.body.classList.add('search-panel-open');
  document.getElementById('chartSearchKeyword').focus();
}

function closeSearch({ focusToggle = false } = {}) {
  const toggle = document.getElementById('chartSearchToggle');
  const panel = document.getElementById('chartSearchPanel');

  clearSearchConditionsAndResults();
  panel.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('search-panel-open');
  if (focusToggle) toggle.focus();
}

function clearSearchConditionsAndResults() {
  document.getElementById('chartSearchPanel').reset();
  document.getElementById('chartSearchResultsBody').innerHTML = '';
  document.getElementById('chartSearchResultCount').textContent = '';
  document.getElementById('chartSearchResults').hidden = true;
  document.getElementById('chartSection').hidden = false;
}

function runSearch() {
  const form = document.getElementById('chartSearchPanel');
  const query = normalizeSearchText(document.getElementById('chartSearchKeyword').value);

  if (!query) {
    document.getElementById('chartSearchResultsBody').innerHTML = '';
    document.getElementById('chartSearchResultCount').textContent = '';
    document.getElementById('chartSearchResults').hidden = true;
    document.getElementById('chartSection').hidden = false;
    return;
  }

  const decade = new FormData(form).get('decade');
  const results = rankingSearchIndex.filter(entry => {
    const decadeMatches = decade === 'all' || Math.floor(entry.year / 10) * 10 === Number(decade);
    const keywordMatches = entry.normalizedTitle.includes(query) || entry.normalizedArtist.includes(query);
    return decadeMatches && keywordMatches;
  });

  document.getElementById('chartSearchResultsBody').innerHTML = buildSearchRows(results, query);
  document.getElementById('chartSearchResultCount').textContent = `${results.length}件`;
  document.getElementById('chartSection').hidden = true;
  document.getElementById('chartSearchResults').hidden = false;
}

function buildSearchRows(entries, query) {
  if (entries.length === 0) {
    return '<tr><td colspan="4" class="chart-search-empty">該当する曲はありません</td></tr>';
  }

  return entries.map(entry => (
    '<tr>' +
      `<td class="col-search-year">${esc(entry.year)}年</td>` +
      `<td class="col-search-rank">${esc(entry.rank)}位</td>` +
      `<td class="col-search-title">${entry.normalizedTitle.includes(query) ? renderHighlightedText(entry.title, query) : esc(entry.title)}</td>` +
      `<td class="col-search-artist">${entry.normalizedArtist.includes(query) ? renderHighlightedText(entry.artist, query) : esc(entry.artist)}</td>` +
    '</tr>'
  )).join('');
}

function normalizeSearchText(value) {
  return String(value || '')
    .replace(/[‘’‛′ʼ＇`´]/g, "'")
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖゝ-ゟ]/g, char => String.fromCharCode(char.charCodeAt(0) + 0x60))
    .replace(/\s+/gu, '');
}

function splitSearchGraphemeClusters(sourceText) {
  if (SEARCH_GRAPHEME_SEGMENTER) {
    return Array.from(SEARCH_GRAPHEME_SEGMENTER.segment(sourceText), part => ({
      text: part.segment,
      start: part.index,
      end: part.index + part.segment.length
    }));
  }

  const clusters = [];
  let sourceOffset = 0;
  let joinsNext = false;
  let regionalRunLength = 0;

  for (const char of sourceText) {
    const start = sourceOffset;
    const end = start + char.length;
    const codePoint = char.codePointAt(0);
    const isVariationSelector =
      (codePoint >= 0xFE00 && codePoint <= 0xFE0F) ||
      (codePoint >= 0xE0100 && codePoint <= 0xE01EF);
    const isEmojiModifier = codePoint >= 0x1F3FB && codePoint <= 0x1F3FF;
    const isRegionalIndicator = codePoint >= 0x1F1E6 && codePoint <= 0x1F1FF;
    const isExtender =
      SEARCH_COMBINING_MARK.test(char) ||
      codePoint === 0xFF9E ||
      codePoint === 0xFF9F ||
      isVariationSelector ||
      isEmojiModifier;
    const isJoiner = codePoint === 0x200D;
    const joinsRegionalPair = isRegionalIndicator && regionalRunLength % 2 === 1;
    const appendToPrevious = clusters.length > 0 && (
      isExtender ||
      isJoiner ||
      joinsNext ||
      joinsRegionalPair
    );

    if (appendToPrevious) {
      const cluster = clusters[clusters.length - 1];
      cluster.text += char;
      cluster.end = end;
    } else {
      clusters.push({ text: char, start, end });
    }

    if (isJoiner || SEARCH_VIRAMA_CODE_POINTS.has(codePoint)) {
      joinsNext = true;
    } else if (joinsNext && !isExtender) {
      joinsNext = false;
    }
    regionalRunLength = isRegionalIndicator ? regionalRunLength + 1 : 0;
    sourceOffset = end;
  }

  return clusters;
}

function buildNormalizedSourceMap(source) {
  const sourceText = String(source || '');
  const clusters = splitSearchGraphemeClusters(sourceText);
  const sourceTokens = clusters.flatMap(cluster => (
    Array.from(normalizeSearchText(cluster.text), value => ({
      value,
      start: cluster.start,
      end: cluster.end
    }))
  ));
  const normalizedText = normalizeSearchText(sourceText);
  const targetTokens = Array.from(normalizedText);
  const operations = [];
  const tokensAlreadyAligned =
    sourceTokens.length === targetTokens.length &&
    sourceTokens.every((token, index) => token.value === targetTokens[index]);

  if (tokensAlreadyAligned) {
    targetTokens.forEach((unused, index) => {
      operations.push({ type: 'match', sourceIndex: index, targetIndex: index });
    });
  } else {
    const alignmentCosts = Array.from(
      { length: sourceTokens.length + 1 },
      () => new Uint16Array(targetTokens.length + 1)
    );

    for (let sourceIndex = sourceTokens.length; sourceIndex >= 0; sourceIndex -= 1) {
      alignmentCosts[sourceIndex][targetTokens.length] = sourceTokens.length - sourceIndex;
    }
    for (let targetIndex = targetTokens.length; targetIndex >= 0; targetIndex -= 1) {
      alignmentCosts[sourceTokens.length][targetIndex] = targetTokens.length - targetIndex;
    }
    for (let sourceIndex = sourceTokens.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
      for (let targetIndex = targetTokens.length - 1; targetIndex >= 0; targetIndex -= 1) {
        const substitutionCost = sourceTokens[sourceIndex].value === targetTokens[targetIndex] ? 0 : 1;
        alignmentCosts[sourceIndex][targetIndex] = Math.min(
          alignmentCosts[sourceIndex + 1][targetIndex + 1] + substitutionCost,
          alignmentCosts[sourceIndex + 1][targetIndex] + 1,
          alignmentCosts[sourceIndex][targetIndex + 1] + 1
        );
      }
    }

    let sourceIndex = 0;
    let targetIndex = 0;
    while (sourceIndex < sourceTokens.length || targetIndex < targetTokens.length) {
      if (
        sourceIndex < sourceTokens.length &&
        targetIndex < targetTokens.length &&
        sourceTokens[sourceIndex].value === targetTokens[targetIndex] &&
        alignmentCosts[sourceIndex][targetIndex] === alignmentCosts[sourceIndex + 1][targetIndex + 1]
      ) {
        operations.push({ type: 'match', sourceIndex, targetIndex });
        sourceIndex += 1;
        targetIndex += 1;
      } else if (
        sourceIndex < sourceTokens.length &&
        targetIndex < targetTokens.length &&
        alignmentCosts[sourceIndex][targetIndex] === alignmentCosts[sourceIndex + 1][targetIndex + 1] + 1
      ) {
        operations.push({ type: 'substitution', sourceIndex, targetIndex });
        sourceIndex += 1;
        targetIndex += 1;
      } else if (
        sourceIndex < sourceTokens.length &&
        alignmentCosts[sourceIndex][targetIndex] === alignmentCosts[sourceIndex + 1][targetIndex] + 1
      ) {
        operations.push({ type: 'deletion', sourceIndex });
        sourceIndex += 1;
      } else {
        operations.push({ type: 'insertion', targetIndex });
        targetIndex += 1;
      }
    }
  }

  const targetRanges = new Array(targetTokens.length);
  operations.forEach(operation => {
    if (operation.type === 'match' || operation.type === 'substitution') {
      const token = sourceTokens[operation.sourceIndex];
      targetRanges[operation.targetIndex] = { start: token.start, end: token.end };
    }
  });

  let operationIndex = 0;
  while (operationIndex < operations.length) {
    if (operations[operationIndex].type === 'match') {
      operationIndex += 1;
      continue;
    }

    const blockStart = operationIndex;
    while (operationIndex < operations.length && operations[operationIndex].type !== 'match') {
      operationIndex += 1;
    }
    const block = operations.slice(blockStart, operationIndex);
    const sourceBlock = block
      .filter(operation => operation.sourceIndex !== undefined)
      .map(operation => sourceTokens[operation.sourceIndex]);
    const targetBlock = block
      .filter(operation => operation.targetIndex !== undefined)
      .map(operation => operation.targetIndex);
    const hasInsertionOrDeletion = block.some(operation => (
      operation.type === 'insertion' || operation.type === 'deletion'
    ));

    if (targetBlock.length > 0 && sourceBlock.length > 0 && hasInsertionOrDeletion) {
      const blockRange = {
        start: Math.min(...sourceBlock.map(token => token.start)),
        end: Math.max(...sourceBlock.map(token => token.end))
      };
      targetBlock.forEach(index => {
        targetRanges[index] = blockRange;
      });
    } else if (targetBlock.length > 0 && sourceBlock.length === 0) {
      const previousSourceOperation = operations
        .slice(0, blockStart)
        .reverse()
        .find(operation => operation.sourceIndex !== undefined);
      const nextSourceOperation = operations
        .slice(operationIndex)
        .find(operation => operation.sourceIndex !== undefined);
      const nearbyTokens = [previousSourceOperation, nextSourceOperation]
        .filter(Boolean)
        .map(operation => sourceTokens[operation.sourceIndex]);
      const blockRange = nearbyTokens.length > 0
        ? {
            start: Math.min(...nearbyTokens.map(token => token.start)),
            end: Math.max(...nearbyTokens.map(token => token.end))
          }
        : {
            start: clusters[0]?.start || 0,
            end: clusters[clusters.length - 1]?.end || 0
          };
      targetBlock.forEach(index => {
        targetRanges[index] = blockRange;
      });
    } else if (targetBlock.length === 0 && sourceBlock.length > 0) {
      const nearbyTargetOperation = operations
        .slice(0, blockStart)
        .reverse()
        .find(operation => operation.targetIndex !== undefined) ||
        operations.slice(operationIndex).find(operation => operation.targetIndex !== undefined);
      if (nearbyTargetOperation) {
        const existingRange = targetRanges[nearbyTargetOperation.targetIndex];
        targetRanges[nearbyTargetOperation.targetIndex] = {
          start: Math.min(existingRange.start, ...sourceBlock.map(token => token.start)),
          end: Math.max(existingRange.end, ...sourceBlock.map(token => token.end))
        };
      }
    }
  }

  const sourceMap = [];
  targetTokens.forEach((token, index) => {
    const range = targetRanges[index];
    for (let i = 0; i < token.length; i += 1) {
      sourceMap.push({ ...range });
    }
  });

  return { normalizedText, sourceMap };
}

function findHighlightRanges(normalizedText, sourceMap, query) {
  if (!query) return [];

  const ranges = [];
  let matchStart = normalizedText.indexOf(query);

  while (matchStart !== -1) {
    const mappedUnits = sourceMap.slice(matchStart, matchStart + query.length);
    if (mappedUnits.length === query.length) {
      const start = Math.min(...mappedUnits.map(unit => unit.start));
      const end = Math.max(...mappedUnits.map(unit => unit.end));
      ranges.push({ start, end });
    }
    matchStart = normalizedText.indexOf(query, matchStart + 1);
  }

  return ranges
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .reduce((merged, range) => {
      const previous = merged[merged.length - 1];
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        merged.push({ ...range });
      }
      return merged;
    }, []);
}

function renderHighlightedText(source, query) {
  const sourceText = String(source || '');
  const { normalizedText, sourceMap } = buildNormalizedSourceMap(sourceText);
  const ranges = findHighlightRanges(normalizedText, sourceMap, query);
  if (ranges.length === 0) return esc(sourceText);

  let sourceOffset = 0;
  let html = '';

  ranges.forEach(range => {
    html += esc(sourceText.slice(sourceOffset, range.start));
    html += `<mark class="chart-search-highlight">${esc(sourceText.slice(range.start, range.end))}</mark>`;
    sourceOffset = range.end;
  });

  return html + esc(sourceText.slice(sourceOffset));
}

/* --------------------------------------------------------
   Show year
   -------------------------------------------------------- */
function showYear(year) {
  currentYear = year;

  // Update buttons
  document.querySelectorAll('.year-btn').forEach(btn => {
    const active = parseInt(btn.dataset.year) === year;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
    if (active) btn.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  });

  const entries = (rankingData[String(year)] || [])
    .slice()
    .sort((a, b) => a.rank - b.rank);

  // Update header
  document.getElementById('currentYearTitle').textContent = `${year}年 年間シングルランキング`;
  document.getElementById('chartCount').textContent = `${entries.length} 曲`;

  // Animate tbody
  const tbody = document.getElementById('rankingBody');
  tbody.style.transition = 'opacity 0.15s';
  tbody.style.opacity = '0';

  requestAnimationFrame(() => {
    tbody.innerHTML = buildRows(entries);
    renderRankShortcuts(entries);
    requestAnimationFrame(() => {
      tbody.style.opacity = '1';
    });
  });
}

/* --------------------------------------------------------
   Build table rows (returns HTML string)
   -------------------------------------------------------- */
function buildRows(entries) {
  if (entries.length === 0) {
    return `<tr><td colspan="4" style="text-align:center;padding:2rem;color:#A07850;">データがありません</td></tr>`;
  }

  return entries.map(entry => {
    const { rank } = entry;
    const rowClass =
      rank === 1 ? ' class="rank-first"'  :
      rank === 2 ? ' class="rank-second"' :
      rank === 3 ? ' class="rank-third"'  : '';

    const rankCell =
      rank === 1 ? `<td class="col-rank"><span class="badge-gold">👑 1位</span></td>`   :
      rank === 2 ? `<td class="col-rank"><span class="badge-silver">🥈 2位</span></td>` :
      rank === 3 ? `<td class="col-rank"><span class="badge-bronze">🥉 3位</span></td>` :
                   `<td class="col-rank"><span class="rank-number">${rank}</span></td>`;

    const ytCell = entry.youtube_url
      ? `<td class="col-yt"><a href="${esc(entry.youtube_url)}" target="_blank" rel="noopener noreferrer" class="yt-btn">▶ YouTube</a></td>`
      : `<td class="col-yt"></td>`;

    return (
      `<tr${rowClass} id="rank-${rank}">` +
        rankCell +
        `<td class="col-title">` +
          `<span class="song-title">${esc(entry.title)}</span>` +
          `<span class="song-artist">${esc(entry.artist)}</span>` +
        `</td>` +
        `<td class="col-date">${esc(entry.release_date)}</td>` +
        ytCell +
      `</tr>`
    );
  }).join('');
}

/* --------------------------------------------------------
   Rank shortcut buttons
   -------------------------------------------------------- */
function renderRankShortcuts(entries) {
  const container = document.getElementById('rankShortcuts');
  if (!container) return;

  const maxRank = entries.length;
  const jumps = [1, 11, 21, 31, 41, 51, 61, 71, 81, 91];

  container.innerHTML = '';
  const frag = document.createDocumentFragment();

  jumps.forEach(r => {
    if (r > maxRank) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rank-jump-btn';
    btn.textContent = `${r}位`;
    btn.setAttribute('aria-label', `${r}位へスクロール`);
    btn.addEventListener('click', () => {
      const target = document.getElementById(`rank-${r}`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    frag.appendChild(btn);
  });

  container.appendChild(frag);
}

/* --------------------------------------------------------
   Keyboard navigation (← →)
   -------------------------------------------------------- */
function handleKeyNav(e) {
  if (e.isComposing || searchIsComposing || e.keyCode === 229) return;

  if (e.key === 'Escape' && document.getElementById('chartSearchToggle').getAttribute('aria-expanded') === 'true') {
    e.preventDefault();
    closeSearch({ focusToggle: true });
    return;
  }

  if (e.target?.closest?.('#chartSearchPanel')) return;

  if (!document.getElementById('chartSearchResults').hidden) return;

  // Skip when focus is inside an input / link
  if (['INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(document.activeElement?.tagName)) return;

  const idx = YEARS.indexOf(currentYear);
  if (e.key === 'ArrowLeft'  && idx > 0)              showYear(YEARS[idx - 1]);
  if (e.key === 'ArrowRight' && idx < YEARS.length - 1) showYear(YEARS[idx + 1]);
}

/* --------------------------------------------------------
   Utility: HTML escape
   -------------------------------------------------------- */
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

/* --------------------------------------------------------
   Back to top
   -------------------------------------------------------- */
document.getElementById('backToTop').addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* --------------------------------------------------------
   Start
   -------------------------------------------------------- */
init();
