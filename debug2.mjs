import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

const resp = await axios.get('https://entamedata.web.fc2.com/music/hit_music1980.html', {
  responseType: 'arraybuffer',
  timeout: 15000,
});
const html = iconv.decode(Buffer.from(resp.data), 'euc-jp');
const $ = cheerio.load(html);

// Table 19 (index 19) の最初の5行を詳しく見る
let tableIdx = 0;
$('table').each((_, t) => {
  if (tableIdx === 19) {
    $(t).find('tr').slice(0, 6).each((i, row) => {
      const cols = $(row).find('td, th');
      if (cols.length >= 2) {
        const col0 = $(cols[0]).text().trim();
        const col1html = $(cols[1]).html()?.slice(0, 200);
        const col1text = $(cols[1]).text().trim().slice(0, 80);
        console.log(`Row ${i}: col0="${col0}" | col1text="${col1text}"`);
        console.log(`  col1html: ${col1html}`);
        console.log('---');
      }
    });
  }
  tableIdx++;
});
