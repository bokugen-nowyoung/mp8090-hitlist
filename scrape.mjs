import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';
import fs from 'fs';

// 丸数字 → 整数
const CIRCLE_DIGITS = {
  '①': 1,  '②': 2,  '③': 3,  '④': 4,  '⑤': 5,
  '⑥': 6,  '⑦': 7,  '⑧': 8,  '⑨': 9,  '⑩': 10,
  '⑪': 11, '⑫': 12, '⑬': 13, '⑭': 14, '⑮': 15,
  '⑯': 16, '⑰': 17, '⑱': 18, '⑲': 19, '⑳': 20,
  '㉑': 21, '㉒': 22, '㉓': 23, '㉔': 24, '㉕': 25,
  '㉖': 26, '㉗': 27, '㉘': 28, '㉙': 29, '㉚': 30,
  '㉛': 31, '㉜': 32, '㉝': 33, '㉞': 34, '㉟': 35,
  '㊱': 36, '㊲': 37, '㊳': 38, '㊴': 39, '㊵': 40,
  '㊶': 41, '㊷': 42, '㊸': 43, '㊹': 44, '㊺': 45,
  '㊻': 46, '㊼': 47, '㊽': 48, '㊾': 49, '㊿': 50,
};

function normalizeDigits(s) {
  // 全角数字 ０-９ → 半角 0-9
  return s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30));
}

function parseRank(text) {
  const t = normalizeDigits(text.trim());
  if (CIRCLE_DIGITS[t] !== undefined) return CIRCLE_DIGITS[t];
  const n = parseInt(t, 10);
  return isNaN(n) ? null : n;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeYear(year) {
  const url = `https://entamedata.web.fc2.com/music/hit_music${year}.html`;
  let html;
  try {
    const resp = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
    });
    html = iconv.decode(Buffer.from(resp.data), 'euc-jp');
  } catch (e) {
    console.error(`  [ERROR] ${year}: ${e.message}`);
    return [];
  }

  const $ = cheerio.load(html);
  const results = [];

  $('table').each((_, table) => {
    const firstRow = $(table).find('tr').first();
    const headerText = firstRow.text();
    // "No." を含むテーブルだけ対象
    if (!/No\.?/i.test(headerText)) return;

    $(table).find('tr').slice(1).each((_, row) => {
      const cols = $(row).find('td, th');
      if (cols.length < 4) return;

      const rankText = $(cols[0]).text().trim();
      const rank = parseRank(rankText);
      if (rank === null) return;

      // タイトル列: YouTube リンクを除いた最初の <a> のテキスト
      const titleCell = $(cols[1]);
      let title = null;
      let youtubeUrl = null;

      titleCell.find('a[href]').each((_, a) => {
        const href = $(a).attr('href') || '';
        if (href.includes('youtube.com/results')) {
          if (!youtubeUrl) youtubeUrl = href;
        } else if (!title) {
          title = $(a).text().trim();
        }
      });

      // <a> がなければセル全体テキスト
      if (!title) title = titleCell.text().trim();
      if (!title) return;

      const artist = $(cols[2]).text().trim();
      const releaseDate = $(cols[3]).text().trim();

      results.push({
        rank,
        title,
        artist,
        release_date: releaseDate,
        youtube_url: youtubeUrl || '',
      });
    });
  });

  return results;
}

async function main() {
  const data = {};

  for (let year = 1980; year <= 1999; year++) {
    process.stdout.write(`Scraping ${year}... `);
    const entries = await scrapeYear(year);
    data[String(year)] = entries;
    console.log(`${entries.length} entries`);
    await sleep(1500);
  }

  fs.writeFileSync('data.json', JSON.stringify(data, null, 2), 'utf-8');

  console.log('\n=== 完了 ===');
  console.log('出力ファイル: data.json');
  console.log('\n年別取得件数:');
  for (let year = 1980; year <= 1999; year++) {
    console.log(`  ${year}: ${data[String(year)].length} 件`);
  }
}

main();
