#!/usr/bin/env python3
"""
1981-1999 Excel batch importer for SETUPLIST_DATA

Usage:
    python scripts/batch_import_excel.py
    python scripts/batch_import_excel.py --base "path/to/base" --years 1981-1999
"""

import argparse
import sys
from pathlib import Path

# 同ディレクトリのヘルパー関数を使う
sys.path.insert(0, str(Path(__file__).parent))
from import_excel_setuplits import (
    read_html_data,
    write_html_data,
    process_excel,
    _HTML,
)

_BASE = Path(r"C:\Users\SEIZOU1\mp8090_set up list")


def main():
    parser = argparse.ArgumentParser(description="年別フォルダの Excel を一括取り込み")
    parser.add_argument("--base", default=str(_BASE), help="年フォルダの親ディレクトリ")
    parser.add_argument("--years", default="1981-1999", help="処理する年の範囲 (例: 1981-1999)")
    parser.add_argument("--html", default=str(_HTML), help="setuplits.html のパス")
    args = parser.parse_args()

    base_dir  = Path(args.base)
    html_path = Path(args.html)

    # 年の範囲を解析
    parts = args.years.split("-")
    year_start, year_end = int(parts[0]), int(parts[1])

    print(f"Base : {base_dir}")
    print(f"HTML : {html_path}")
    print(f"Years: {year_start}〜{year_end}")
    print()

    # HTML から現在のデータを1回だけ読み込む
    current_data = read_html_data(html_path)
    print(f"既存レコード数: {len(current_data)}")
    print("=" * 50)

    year_stats = {}
    total_added   = 0
    total_updated = 0
    total_skipped = 0

    for year in range(year_start, year_end + 1):
        folder = base_dir / str(year)
        if not folder.exists():
            print(f"\n[{year}] フォルダなし: {folder}")
            continue

        xlsx_files = sorted(folder.glob("*.xlsx"))
        if not xlsx_files:
            print(f"\n[{year}] .xlsx ファイルなし")
            continue

        year_added   = 0
        year_updated = 0
        year_skipped = 0
        processed_files = []

        for xlsx_path in xlsx_files:
            print(f"\n[{year}] {xlsx_path.name}")
            current_data, added, upd, skipped = process_excel(xlsx_path, current_data)
            year_added   += added
            year_updated += upd
            year_skipped += skipped
            processed_files.append(xlsx_path.name)

        year_stats[year] = {
            "added":   year_added,
            "updated": year_updated,
            "skipped": year_skipped,
            "files":   processed_files,
        }
        total_added   += year_added
        total_updated += year_updated
        total_skipped += year_skipped

    # 追加・更新があった場合のみ HTML を更新（1回だけ書き込み）
    print("\n" + "=" * 50)
    if total_added > 0 or total_updated > 0:
        write_html_data(html_path, current_data)
        print(f"setuplits.html を更新しました")

    # 年別サマリー
    print("\n【年別サマリー】")
    print(f"{'年':<6} {'追加':>4} {'更新':>4} {'スキップ':>6}  ファイル")
    print("-" * 56)
    for year in range(year_start, year_end + 1):
        if year in year_stats:
            s = year_stats[year]
            files_str = ", ".join(s["files"])
            print(f"{year:<6} {s['added']:>4} {s['updated']:>4} {s['skipped']:>6}    {files_str}")

    print("-" * 56)
    print(f"{'合計':<6} {total_added:>4} {total_updated:>4} {total_skipped:>6}")
    print()
    print(f"最終レコード数: {len(current_data)} 件")


if __name__ == "__main__":
    main()
