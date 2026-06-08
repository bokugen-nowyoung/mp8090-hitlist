import re, json
from pathlib import Path

HTML_FILE = Path("setuplits.html")

UPDATES = {
    164: "90年代のデュエットソング特集",
    169: "ナウヤン紅白〜80年代編〜",
    172: "布袋寅泰特集",
    180: "JUDY AND MARY特集",
    183: "細川たかし特集",
    184: "Mr.Children特集（２回目）",
    190: "2000(平成12)年特集",
    193: "来生たかお特集",
    196: "T.M.Revolution特集（２回目）",
    197: "米米CLUB特集（２回目）",
    198: "森高千里特集（２回目）",
    199: "野球ソング特集",
    200: "大江千里特集",
    216: "織田裕二特集",
}

content = HTML_FILE.read_text(encoding="utf-8")

m = re.search(
    r"(// <<SETUPLIST_DATA_START>>\s*\n\s*const SETUPLIST_DATA = )(\[.*?\])(;\s*\n\s*// <<SETUPLIST_DATA_END>>)",
    content, re.DOTALL,
)
if not m:
    raise ValueError("SETUPLIST_DATA が見つかりません")

data = json.loads(m.group(2))

count = 0
for ep in data:
    ep_no = ep["episode_no"]
    if ep_no in UPDATES:
        ep["special_feature"] = UPDATES[ep_no]
        # image_file も jfif -> jpg に更新
        ep["image_file"] = ep["image_file"].replace(".jfif", ".jpg")
        print(f"  ep{ep_no:3d}: special_feature={ep['special_feature']!r}  image_file={ep['image_file']!r}")
        count += 1

new_json = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
new_content = content[:m.start(2)] + new_json + content[m.end(2):]
HTML_FILE.write_text(new_content, encoding="utf-8")

print(f"\n更新完了: {count} 件")
