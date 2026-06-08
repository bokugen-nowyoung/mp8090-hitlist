import json
import time
import re
import sys
import subprocess

# Install dependencies if needed
try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "beautifulsoup4"])
    import requests
    from bs4 import BeautifulSoup

# 丸数字 ① ② ... を整数に変換
CIRCLE_DIGITS = {
    '①': 1, '②': 2, '③': 3, '④': 4, '⑤': 5,
    '⑥': 6, '⑦': 7, '⑧': 8, '⑨': 9, '⑩': 10,
    '⑪': 11, '⑫': 12, '⑬': 13, '⑭': 14, '⑮': 15,
    '⑯': 16, '⑰': 17, '⑱': 18, '⑲': 19, '⑳': 20,
    '㉑': 21, '㉒': 22, '㉓': 23, '㉔': 24, '㉕': 25,
    '㉖': 26, '㉗': 27, '㉘': 28, '㉙': 29, '㉚': 30,
    '㉛': 31, '㉜': 32, '㉝': 33, '㉞': 34, '㉟': 35,
    '㊱': 36, '㊲': 37, '㊳': 38, '㊴': 39, '㊵': 40,
    '㊶': 41, '㊷': 42, '㊸': 43, '㊹': 44, '㊺': 45,
    '㊻': 46, '㊼': 47, '㊽': 48, '㊾': 49, '㊿': 50,
}

def parse_rank(text):
    text = text.strip()
    # 丸数字
    if text in CIRCLE_DIGITS:
        return CIRCLE_DIGITS[text]
    # 通常数字
    try:
        return int(text)
    except ValueError:
        return None

def scrape_year(year):
    url = f"https://entamedata.web.fc2.com/music/hit_music{year}.html"
    try:
        resp = requests.get(url, timeout=15)
        resp.encoding = 'euc-jp'
    except Exception as e:
        print(f"  [ERROR] {year}: {e}")
        return []

    soup = BeautifulSoup(resp.text, 'html.parser')
    results = []

    for table in soup.find_all('table'):
        headers = table.find('tr')
        if not headers:
            continue
        header_texts = [th.get_text(strip=True) for th in headers.find_all(['th', 'td'])]
        # "No." を含むテーブルだけ対象
        if not any('No' in h or 'no' in h.lower() for h in header_texts):
            continue

        for row in table.find_all('tr')[1:]:
            cols = row.find_all(['td', 'th'])
            if len(cols) < 4:
                continue

            rank_text = cols[0].get_text(strip=True)
            rank = parse_rank(rank_text)
            if rank is None:
                continue

            # タイトル列: YouTube リンクを除いた最初の <a> のテキスト
            title_cell = cols[1]
            title = None
            youtube_url = None

            for a in title_cell.find_all('a', href=True):
                href = a['href']
                if 'youtube.com/results' in href:
                    if youtube_url is None:
                        youtube_url = href
                elif title is None:
                    title = a.get_text(strip=True)

            # <a> がなければセル全体のテキストをタイトルに
            if title is None:
                title = title_cell.get_text(strip=True)

            artist = cols[2].get_text(strip=True)
            release_date = cols[3].get_text(strip=True)

            if not title:
                continue

            results.append({
                "rank": rank,
                "title": title,
                "artist": artist,
                "release_date": release_date,
                "youtube_url": youtube_url or "",
            })

    return results


def main():
    data = {}
    for year in range(1980, 2000):
        print(f"Scraping {year}...", end=" ", flush=True)
        entries = scrape_year(year)
        data[str(year)] = entries
        print(f"{len(entries)} entries")
        time.sleep(1.5)

    output_path = "data.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("\n=== 完了 ===")
    print(f"出力ファイル: {output_path}")
    print("\n年別取得件数:")
    for year in range(1980, 2000):
        print(f"  {year}: {len(data[str(year)])} 件")


if __name__ == "__main__":
    main()
