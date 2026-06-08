import axios from 'axios';
import * as cheerio from 'cheerio';
import iconv from 'iconv-lite';

const resp = await axios.get('https://entamedata.web.fc2.com/music/hit_music1980.html', {
  responseType: 'arraybuffer',
  timeout: 15000,
});
const html = iconv.decode(Buffer.from(resp.data), 'euc-jp');
const $ = cheerio.load(html);

let tableIdx = 0;
$('table').each((_, t) => {
  const rows = $(t).find('tr');
  const firstRowText = rows.first().text().replace(/\s+/g, ' ').trim().slice(0, 80);
  const secondRowText = rows.eq(1).text().replace(/\s+/g, ' ').trim().slice(0, 80);
  console.log(`Table ${tableIdx++} | rows: ${rows.length} | h: "${firstRowText}" | r2: "${secondRowText}"`);
});
