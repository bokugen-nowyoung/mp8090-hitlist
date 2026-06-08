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
  if (tableIdx === 19) {
    const row1 = $(t).find('tr').eq(1);
    const col1 = row1.find('td, th').eq(1);
    console.log('Full HTML of title cell:');
    console.log(col1.html());
    console.log('\nAll <a> tags in title cell:');
    col1.find('a[href]').each((i, a) => {
      console.log(`  a[${i}] href="${$(a).attr('href')?.slice(0,60)}" text="${$(a).text()}"`);
    });
  }
  tableIdx++;
});
