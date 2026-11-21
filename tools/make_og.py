# -*- coding: utf-8 -*-
"""產生 1200x630 的 Open Graph 分享圖（僅需 Pillow，無需外部素材）。"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1200, 630
OUTPUT = Path(__file__).resolve().parents[1] / "og-image.png"

FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyhbd.ttc",      # 微軟雅黑 Bold
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/NotoSansTC-Bold.otf",
    "C:/Windows/Fonts/arialbd.ttf",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def main():
    image = Image.new("RGB", (WIDTH, HEIGHT), "#101a30")
    draw = ImageDraw.Draw(image)

    # 斜向漸層背景
    for y in range(HEIGHT):
        for x in range(0, WIDTH, 4):
            t = (x / WIDTH + y / HEIGHT) / 2
            r = int(0x22 * (1 - t) + 0x10 * t)
            g = int(0x35 * (1 - t) + 0x1A * t)
            b = int(0x59 * (1 - t) + 0x30 * t)
            draw.rectangle([x, y, x + 4, y + 1], fill=(r, g, b))

    gold = "#f5c451"
    ink = "#1b2a4a"

    # 左側金色圓形標誌
    draw.ellipse([100, 205, 330, 435], fill=gold)
    font_seven = load_font(130)
    draw.text((215, 320), "7", font=font_seven, fill=ink, anchor="mm")

    # 標題與副標題
    font_title = load_font(78)
    font_sub = load_font(30)
    font_body = load_font(34)
    font_small = load_font(22)

    draw.text((380, 215), "星耀拉霸", font=font_title, fill="#ffffff")
    draw.text((384, 310), "S T A R   S P I N", font=font_sub, fill=gold)
    draw.text((384, 375), "輕量 HTML5 老虎機 · 純靜態 · 虛擬幣", font=font_body, fill="#dfe6f2")

    # 右下方賠率提示
    draw.rounded_rectangle([768, 470, 1120, 552], radius=18, fill="#1b2a4a", outline=gold, width=2)
    draw.text((944, 511), "中獎賠率最高 80 倍", font=font_small, fill=gold, anchor="mm")

    draw.text((384, 552), "Canvas 2D  /  Web Audio  /  RWD", font=font_small, fill="#8f9cb5")

    image.save(OUTPUT, optimize=True)
    print(f"已產生：{OUTPUT}")


if __name__ == "__main__":
    main()
