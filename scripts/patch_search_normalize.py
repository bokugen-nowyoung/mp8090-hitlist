# -*- coding: utf-8 -*-
"""
setuplits.html 検索正規化パッチ
- searchNormalize / normalizeWithMap ヘルパーを追加
- readCriteria: 入力は生のまま保持（照合時のみ正規化）
- episodeMatches / getMatchingTracks: 正規化照合に変更
- highlightText: インデックスマップ方式に書き換え（正規化しても<mark>位置が正確）
各置換は「対象が正確に1回だけ存在する」ことを検証してから実行する。
"""
import io
import re
import sys

PATH = 'setuplits.html'

with io.open(PATH, encoding='utf-8', newline='') as f:
    src = f.read()

# CRLF環境対応: 照合・置換はLF空間で行い、書き込み時に元の改行へ戻す。
# （パッチの各パターンはLFで書かれているため、Windowsチェックアウト=CRLFだと一致しない）
use_crlf = '\r\n' in src
if use_crlf:
    src = src.replace('\r\n', '\n')

orig_len = len(src)
replacements_done = []


def replace_once(src, pattern, repl, name, is_regex=False):
    if is_regex:
        matches = list(re.finditer(pattern, src, re.S))
        count = len(matches)
    else:
        count = src.count(pattern)
    if count != 1:
        print(f'[NG] {name}: 対象が {count} 箇所（1箇所であるべき）。中断します。')
        sys.exit(1)
    if is_regex:
        m = matches[0]
        expanded = m.expand(repl) if '\\g<' in repl or '\\1' in repl else repl
        out = src[:m.start()] + expanded + src[m.end():]
    else:
        out = src.replace(pattern, repl)
    replacements_done.append(name)
    return out


# ── 1. escHtml直後にヘルパー2関数を追加 ──
ESC_HTML = '''    function escHtml(s) {
      return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }'''

HELPERS = ESC_HTML + '''

    // ── 検索用正規化 ──
    // NFKC（全角英数→半角等）＋小文字化＋ひらがな→カタカナ＋アポストロフィ類統一＋空白除去。
    // 表示データは変更せず、照合の瞬間だけ両辺に適用する（生データ保持主義）。
    // normalizeWithMap は「正規化後の位置 → 元文字列の位置」対応表を返し、ハイライトに使う。
    function normalizeWithMap(str) {
      const s = String(str ?? '');
      const map = [];
      let out = '';
      for (let i = 0; i < s.length; i++) {
        let ch = s[i].replace(/[\\u2018\\u2019\\u02BC\\u00B4\\u0060\\uFF07]/g, "'");
        ch = ch.normalize('NFKC').toLowerCase();
        ch = ch.replace(/[\\u3041-\\u3096]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
        if (/^\\s+$/.test(ch)) continue;
        for (const c2 of ch) { out += c2; map.push(i); }
      }
      return { out, map };
    }
    function searchNormalize(str) {
      return normalizeWithMap(str).out;
    }'''

src = replace_once(src, ESC_HTML, HELPERS, '1. ヘルパー関数の追加')


# ── 2. highlightText をインデックスマップ方式に書き換え ──
HIGHLIGHT_NEW = '''    function highlightText(str, terms) {
      const raw = String(str ?? '');
      const activeTerms = (terms || []).map(t => searchNormalize(t)).filter(Boolean);
      if (activeTerms.length === 0) return escHtml(raw);
      const { out, map } = normalizeWithMap(raw);
      // 一致範囲（元文字列上の [開始, 終了)）を収集
      const ranges = [];
      for (const term of activeTerms) {
        let from = 0;
        while (true) {
          const idx = out.indexOf(term, from);
          if (idx === -1) break;
          const startO = map[idx];
          const lastMapped = map[idx + term.length - 1];
          ranges.push([startO, lastMapped + 1]);
          from = idx + 1;
        }
      }
      if (ranges.length === 0) return escHtml(raw);
      // 重なる範囲をマージ
      ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const merged = [ranges[0].slice()];
      for (let k = 1; k < ranges.length; k++) {
        const last = merged[merged.length - 1];
        if (ranges[k][0] <= last[1]) last[1] = Math.max(last[1], ranges[k][1]);
        else merged.push(ranges[k].slice());
      }
      // 元文字列を分割し、一致部分だけ <mark> で囲む（escHtmlは区間ごとに適用）
      let result = '';
      let pos = 0;
      for (const [s0, e0] of merged) {
        result += escHtml(raw.slice(pos, s0));
        result += '<mark class="search-hit">' + escHtml(raw.slice(s0, e0)) + '</mark>';
        pos = e0;
      }
      result += escHtml(raw.slice(pos));
      return result;
    }'''

src = replace_once(
    src,
    r'    function highlightText\(str, terms\) \{.*?\n    \}',
    HIGHLIGHT_NEW,
    '2. highlightText の書き換え',
    is_regex=True,
)


# ── 3. episodeMatches を正規化照合に書き換え ──
EPISODE_MATCHES_NEW = '''    function episodeMatches(ep, c) {
      const tracks = ep.tracks || [];
      const nArtist  = searchNormalize(c.artist);
      const nTitle   = searchNormalize(c.title);
      const nFeature = searchNormalize(c.feature);
      const nFree    = searchNormalize(c.free);

      if (nArtist) {
        const ok = tracks.some(t => searchNormalize(t.artist).includes(nArtist));
        if (!ok) return false;
      }
      if (nTitle) {
        const ok = tracks.some(t => searchNormalize(t.title).includes(nTitle));
        if (!ok) return false;
      }
      if (c.epNo !== null) {
        if (ep.episode_no !== c.epNo) return false;
      }
      if (c.airDate) {
        if (ep.air_date !== c.airDate) return false;
      }
      if (nFeature) {
        if (!searchNormalize(ep.special_feature).includes(nFeature)) return false;
      }
      if (c.puySingle !== null) {
        if (ep.puy_year !== c.puySingle) return false;
      }
      if (c.puyMulti.length > 0) {
        if (!c.puyMulti.includes(ep.puy_year)) return false;
      }
      if (nFree) {
        const inTracks = tracks.some(t =>
          searchNormalize(t.title).includes(nFree) ||
          searchNormalize(t.artist).includes(nFree)
        );
        const inFeature = searchNormalize(ep.special_feature).includes(nFree);
        if (!inTracks && !inFeature) return false;
      }
      return true;
    }'''

src = replace_once(
    src,
    r'    function episodeMatches\(ep, c\) \{.*?\n    \}',
    EPISODE_MATCHES_NEW,
    '3. episodeMatches の書き換え',
    is_regex=True,
)


# ── 4. readCriteria: 入力を生のまま保持（.toLowerCase()を削除） ──
for field, elem in [('artist', 'searchArtist'), ('title', 'searchTitleInput'),
                    ('feature', 'searchFeature'), ('free', 'searchFree')]:
    src = replace_once(
        src,
        rf'({field}:\s+{elem}\.value\.trim\(\))\.toLowerCase\(\)(,)',
        rf'\g<1>\g<2>',
        f'4. readCriteria {field} の生値化',
        is_regex=True,
    )


# ── 5. getMatchingTracks を正規化照合に書き換え ──
GET_MATCHING_NEW = '''    function getMatchingTracks(ep, c) {
      if (!c) return [];
      const tracks = ep.tracks || [];
      const nArtist = searchNormalize(c.artist);
      const nTitle  = searchNormalize(c.title);
      const nFree   = searchNormalize(c.free);
      return tracks.filter(t => {
        const ta = searchNormalize(t.artist);
        const tt = searchNormalize(t.title);
        if (nArtist && ta.includes(nArtist)) return true;
        if (nTitle && tt.includes(nTitle)) return true;
        if (nFree && (tt.includes(nFree) || ta.includes(nFree))) return true;
        return false;
      });
    }'''

src = replace_once(
    src,
    r'    function getMatchingTracks\(ep, c\) \{.*?\n    \}',
    GET_MATCHING_NEW,
    '5. getMatchingTracks の書き換え',
    is_regex=True,
)


# ── 検証 ──
remaining = src.count('toLowerCase')
# 正規化ヘルパー内の1箇所（s[i].normalize('NFKC').toLowerCase()）だけ残るのが正
if remaining != 1:
    print(f'[NG] toLowerCase の残存数が想定外: {remaining}（ヘルパー内の1箇所のみが正）')
    sys.exit(1)

out_text = src.replace('\n', '\r\n') if use_crlf else src
with io.open(PATH, 'w', encoding='utf-8', newline='') as f:
    f.write(out_text)

print('=== パッチ適用完了 ===')
for name in replacements_done:
    print(f'  [OK] {name}')
print(f'ファイルサイズ: {orig_len} → {len(src)} bytes')
print(f'toLowerCase残存: {remaining}箇所（ヘルパー内、正常）')
