'use strict';

const YEARS = Array.from({ length: 20 }, (_, i) => 1980 + i);

let rankingData = {};
let currentYear = 1980;

/* --------------------------------------------------------
   Init
   -------------------------------------------------------- */
async function init() {
  try {
    const res = await fetch('data.json');
    if (!res.ok) throw new Error(`HTTP ${res.status} — data.json の読み込みに失敗しました`);
    rankingData = await res.json();
  } catch (err) {
    const errEl = document.getElementById('errorMsg');
    errEl.textContent = `⚠️ ${err.message}`;
    errEl.hidden = false;
    document.getElementById('loadingMsg').hidden = true;
    return;
  }

  renderYearButtons();
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
    btn.addEventListener('click', () => showYear(y));
    frag.appendChild(btn);
  });

  container.appendChild(frag);
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
