from pathlib import Path
from PIL import Image

IMAGES_DIR = Path("images/setuplits")
TARGET_EPS = {164, 169, 172, 180, 183, 184, 190, 193, 196, 197, 198, 199, 200, 216}

converted = []
not_found = []

for f in IMAGES_DIR.glob("*.jfif"):
    parts = f.stem.split(".")
    try:
        ep_no = int(parts[-1])
    except ValueError:
        continue
    if ep_no not in TARGET_EPS:
        continue

    jpg_path = f.with_suffix(".jpg")
    with Image.open(f) as img:
        img.convert("RGB").save(jpg_path, "JPEG", quality=95)
    converted.append((ep_no, f.name, jpg_path.name))

found_eps = {ep for ep, _, _ in converted}
not_found = sorted(TARGET_EPS - found_eps)

for ep, src, dst in sorted(converted):
    print(f"  ep{ep:3d}: {src} -> {dst}")

print(f"\n変換完了: {len(converted)} 件")
if not_found:
    print(f"jfif が見つからなかった ep: {not_found}")
