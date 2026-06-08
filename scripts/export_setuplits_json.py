import argparse
import json
import re
import sqlite3
from pathlib import Path

# setuplits.html 内のデータブロックのマーカー
_START = "// <<SETUPLIST_DATA_START>>"
_END   = "// <<SETUPLIST_DATA_END>>"


def export(db_path: str, out_path: str, html_path: str) -> None:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("""
        SELECT episode_no, puy_year, air_date, special_feature
        FROM episodes
        ORDER BY episode_no DESC
    """)

    rows = cur.fetchall()
    conn.close()

    result = []
    for row in rows:
        air_date = row["air_date"]
        # YYYY-MM-DD に正規化
        if air_date and len(air_date) == 8 and air_date.isdigit():
            air_date = f"{air_date[:4]}-{air_date[4:6]}-{air_date[6:]}"

        result.append({
            "episode_no": row["episode_no"],
            "puy_year":   row["puy_year"],
            "air_date":   air_date,
            "special_feature": row["special_feature"],
            "image_file": None,
        })

    # JSON ファイルを出力
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"Exported {len(result)} records → {out_path}")

    # setuplits.html のインラインデータを更新
    html_file = Path(html_path)
    if not html_file.exists():
        print(f"Warning: {html_path} not found, skipping HTML embed")
        return

    html = html_file.read_text(encoding="utf-8")
    json_str = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
    new_block = (
        f"{_START}\n"
        f"  const SETUPLIST_DATA = {json_str};\n"
        f"  {_END}"
    )


    # マーカー間をまるごと置換
    pattern = re.compile(
        re.escape(_START) + r".*?" + re.escape(_END),
        re.DOTALL,
    )
    if not pattern.search(html):
        print("Warning: data markers not found in HTML, skipping HTML embed")
        return

    html_new = pattern.sub(new_block, html)
    html_file.write_text(html_new, encoding="utf-8")
    print(f"Embedded data into {html_path}")


if __name__ == "__main__":
    root = Path(__file__).parent.parent

    parser = argparse.ArgumentParser(description="Export episodes to setuplits.json and embed into setuplits.html")
    parser.add_argument("--db",   required=True, help="Path to mp8090.db")
    parser.add_argument("--out",  default=str(root / "data" / "setuplits.json"),
                        help="Output JSON path (default: ../data/setuplits.json)")
    parser.add_argument("--html", default=str(root / "setuplits.html"),
                        help="setuplits.html path to embed data into (default: ../setuplits.html)")
    args = parser.parse_args()
    export(args.db, args.out, args.html)
