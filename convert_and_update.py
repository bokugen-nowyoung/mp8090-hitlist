#!/usr/bin/env python3
"""
jfif -> jpg 変換 + Claude Vision で特集名を抽出 + setuplits.html の SETUPLIST_DATA を更新
"""
import os
import re
import json
import base64
from pathlib import Path
from PIL import Image
import anthropic

IMAGES_DIR = Path("images/setuplits")
HTML_FILE  = Path("setuplits.html")

TARGET_EPS = {164, 169, 172, 180, 183, 184, 190, 193, 196, 197, 198, 199, 200, 216}

def convert_jfif_to_jpg(jfif_path: Path) -> Path:
    jpg_path = jfif_path.with_suffix(".jpg")
    with Image.open(jfif_path) as img:
        rgb = img.convert("RGB")
        rgb.save(jpg_path, "JPEG", quality=95)
    print(f"  変換完了: {jfif_path.name} -> {jpg_path.name}")
    return jpg_path

def extract_special_feature(client: anthropic.Anthropic, jpg_path: Path) -> str:
    with open(jpg_path, "rb") as f:
        image_data = base64.standard_b64encode(f.read()).decode("utf-8")

    message = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=300,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": image_data,
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "この画像はラジオ番組「POP YOUR NAME」のセットリスト画像です。\n"
                            "画像中に「特集」の名前が記載されています（例：「〇〇特集」「〇〇ソング特集」など）。\n"
                            "特集名を正確に抽出して、特集名の文字列だけを返してください。\n"
                            "特集名が見当たらない場合は「なし」と返してください。\n"
                            "余計な説明は不要です。特集名のみ返答してください。"
                        ),
                    },
                ],
            }
        ],
    )
    result = message.content[0].text.strip()
    return result

def update_html(html_path: Path, ep_no: int, special_feature: str, new_image_file: str):
    content = html_path.read_text(encoding="utf-8")

    # JSON部分を抽出
    m = re.search(
        r"// <<SETUPLIST_DATA_START>>\s*\n\s*const SETUPLIST_DATA = (\[.*?\]);\s*\n\s*// <<SETUPLIST_DATA_END>>",
        content,
        re.DOTALL,
    )
    if not m:
        raise ValueError("SETUPLIST_DATA が見つかりません")

    data = json.loads(m.group(1))

    updated = False
    for ep in data:
        if ep["episode_no"] == ep_no:
            ep["special_feature"] = special_feature
            ep["image_file"] = new_image_file
            updated = True
            break

    if not updated:
        print(f"  警告: ep{ep_no} がデータ内に見つかりませんでした")
        return

    new_json = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    new_content = content[: m.start(1)] + new_json + content[m.end(1) :]
    html_path.write_text(new_content, encoding="utf-8")

def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise EnvironmentError("ANTHROPIC_API_KEY が設定されていません")

    client = anthropic.Anthropic(api_key=api_key)

    # ep番号 -> jfifファイルのマップを構築
    jfif_files = {}
    for f in IMAGES_DIR.glob("*.jfif"):
        # ファイル名末尾の数字がep番号
        parts = f.stem.split(".")
        if parts:
            try:
                ep_no = int(parts[-1])
                jfif_files[ep_no] = f
            except ValueError:
                pass

    results = {}

    for ep_no in sorted(TARGET_EPS):
        print(f"\n--- ep{ep_no} ---")

        if ep_no not in jfif_files:
            print(f"  jfifファイルが見つかりません: ep{ep_no}")
            results[ep_no] = {"status": "jfif not found"}
            continue

        jfif_path = jfif_files[ep_no]

        # 1. jfif -> jpg 変換
        jpg_path = convert_jfif_to_jpg(jfif_path)

        # 2. Claude Vision で特集名抽出
        print(f"  Vision 解析中: {jpg_path.name}")
        feature = extract_special_feature(client, jpg_path)
        print(f"  抽出結果: {feature}")

        # 3. HTML 更新
        new_image_file = jpg_path.name
        if feature in ("なし", "", "特集名なし"):
            feature_value = None
        else:
            feature_value = feature

        update_html(HTML_FILE, ep_no, feature_value, new_image_file)
        print(f"  HTML更新完了: special_feature = {feature_value!r}, image_file = {new_image_file!r}")

        results[ep_no] = {"feature": feature_value, "image_file": new_image_file}

    print("\n===== 処理結果まとめ =====")
    for ep_no in sorted(results):
        r = results[ep_no]
        if "feature" in r:
            print(f"  ep{ep_no}: special_feature={r['feature']!r}  image_file={r['image_file']!r}")
        else:
            print(f"  ep{ep_no}: {r['status']}")

if __name__ == "__main__":
    main()
