#!/usr/bin/env python3
"""Render an Anime Corner-like ranking poster with Pillow.

This is intentionally standalone and not connected to the existing HTML UI.
Geometry is based on the 1024x1536 reference poster supplied during design.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageEnhance, ImageFont, ImageOps


@dataclass(frozen=True)
class Layout:
    width: int = 1024
    height: int = 1536
    header_h: int = 125
    list_top: int = 143
    left: int = 18
    right: int = 1004
    row_h: int = 118
    row_gap: int = 9
    rank_w: int = 95
    visual_w: int = 596
    stats_w: int = 295
    footer_top: int = 1424


L = Layout()

COLORS = {
    "bg": (206, 245, 244),
    "header": (6, 6, 8),
    "stats": (31, 31, 31),
    "rank_top": (255, 102, 113),
    "rank_normal": (242, 145, 59),
    "accent": (59, 192, 213),
    "footer": (255, 232, 198),
    "white": (255, 255, 255),
    "black": (0, 0, 0),
    "muted": (225, 225, 225),
    "bottom_bar": (35, 190, 54),
}


def _font(candidates: Iterable[str], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


def load_fonts() -> dict[str, ImageFont.ImageFont]:
    latin = [
        os.getenv("RANKING_FONT_LATIN"),
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    ]
    cjk = [
        os.getenv("RANKING_FONT_CJK"),
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    ]
    return {
        "title": _font(latin, 50),
        "subtitle": _font(latin, 29),
        "rank": _font(latin, 60),
        "anime": _font(cjk + latin, 31),
        "label": _font(cjk + latin, 15),
        "metric": _font(latin + cjk, 39),
        "small": _font(cjk + latin, 13),
        "footer": _font(cjk + latin, 21),
    }


def crop_cover(img: Image.Image, size: tuple[int, int], focus=(0.5, 0.5)) -> Image.Image:
    """Cover-crop while allowing a manually supplied focal point in [0,1]."""
    img = img.convert("RGB")
    tw, th = size
    scale = max(tw / img.width, th / img.height)
    nw, nh = round(img.width * scale), round(img.height * scale)
    img = img.resize((nw, nh), Image.Resampling.LANCZOS)
    fx = min(1.0, max(0.0, float(focus[0])))
    fy = min(1.0, max(0.0, float(focus[1])))
    x = round((nw - tw) * fx)
    y = round((nh - th) * fy)
    return img.crop((x, y, x + tw, y + th))


def placeholder(size: tuple[int, int], seed: int) -> Image.Image:
    img = Image.new("RGB", size, (55 + seed * 7 % 90, 65 + seed * 11 % 100, 90 + seed * 13 % 90))
    draw = ImageDraw.Draw(img)
    for x in range(0, size[0], 90):
        draw.rectangle((x, 0, x + 45, size[1]), fill=(255, 255, 255, 22))
    return img


def fit_text(draw: ImageDraw.ImageDraw, text: str, font_candidates: list[ImageFont.ImageFont], max_width: int, max_lines: int = 2):
    """Simple 1-2 line fit for CJK/Latin titles."""
    for font in font_candidates:
        if draw.textbbox((0, 0), text, font=font)[2] <= max_width:
            return [text], font
        # greedy split by character so CJK titles work without spaces
        lines, current = [], ""
        for ch in text:
            trial = current + ch
            if draw.textbbox((0, 0), trial, font=font)[2] <= max_width:
                current = trial
            else:
                if current:
                    lines.append(current)
                current = ch
                if len(lines) >= max_lines:
                    break
        if current and len(lines) < max_lines:
            lines.append(current)
        if len(lines) <= max_lines and "".join(lines) == text:
            return lines, font
    return [text[:18] + "…"], font_candidates[-1]


def draw_header(canvas: Image.Image, draw: ImageDraw.ImageDraw, fonts, cfg):
    draw.rectangle((0, 0, L.width, L.header_h), fill=COLORS["header"])
    draw.rectangle((0, 0, 292, L.header_h), fill=cfg.get("brand_color", COLORS["rank_top"]))
    draw.text((24, 22), cfg.get("brand", "ACG CLUB"), font=fonts["subtitle"], fill=COLORS["white"])
    draw.text((307, 16), cfg.get("title", "7月新番中期评分 TOP 10"), font=fonts["title"], fill=COLORS["white"])
    draw.text((309, 77), cfg.get("subtitle", "2026 MID-SEASON RESULTS"), font=fonts["subtitle"], fill=COLORS["white"])


def draw_row(canvas: Image.Image, draw: ImageDraw.ImageDraw, fonts, item, idx: int, assets: Path):
    y = L.list_top + idx * (L.row_h + L.row_gap)
    rank_x1 = L.left
    rank_x2 = rank_x1 + L.rank_w
    visual_x1 = rank_x2
    visual_x2 = visual_x1 + L.visual_w
    stats_x1 = visual_x2
    stats_x2 = L.right

    rank_color = COLORS["rank_top"] if idx < 3 else COLORS["rank_normal"]
    draw.rectangle((rank_x1, y, rank_x2, y + L.row_h), fill=rank_color)
    draw.rectangle((stats_x1, y, stats_x2, y + L.row_h), fill=COLORS["stats"])

    image_path = assets / item.get("image", "") if item.get("image") else None
    if image_path and image_path.exists():
        src = Image.open(image_path)
        focus = item.get("focus", [0.5, 0.5])
        visual = crop_cover(src, (L.visual_w, L.row_h), focus)
    else:
        visual = placeholder((L.visual_w, L.row_h), idx)
    visual = ImageEnhance.Brightness(visual).enhance(float(item.get("brightness", 0.76)))
    canvas.paste(visual, (visual_x1, y))

    # left-to-right dark veil: keeps text readable while preserving the visual on the right.
    veil = Image.new("RGBA", (L.visual_w, L.row_h), (0, 0, 0, 0))
    vd = ImageDraw.Draw(veil)
    for x in range(L.visual_w):
        alpha = round(105 * (1 - x / L.visual_w) + 18)
        vd.line((x, 0, x, L.row_h), fill=(0, 0, 0, alpha))
    canvas.alpha_composite(veil, (visual_x1, y))

    rank = str(item.get("rank", idx + 1))
    rb = draw.textbbox((0, 0), rank, font=fonts["rank"])
    draw.text((rank_x1 + (L.rank_w - (rb[2]-rb[0]))/2, y + 25), rank, font=fonts["rank"], fill=COLORS["white"] if idx < 3 else COLORS["black"])

    anime_sizes = [fonts["anime"]]
    title = str(item.get("title", "UNTITLED"))
    lines, anime_font = fit_text(draw, title, anime_sizes, L.visual_w - 44, 2)
    line_h = 34
    title_y = y + L.row_h - 22 - line_h * len(lines)
    for line_no, line in enumerate(lines):
        draw.text((visual_x1 + 20, title_y + line_no * line_h), line, font=anime_font, fill=COLORS["white"], stroke_width=1, stroke_fill=(0,0,0))

    label_y = y + 4
    mid = stats_x1 + 145
    draw.rectangle((stats_x1, label_y, mid, y + 27), fill=COLORS["rank_top"])
    draw.rectangle((mid, label_y, stats_x2, y + 27), fill=COLORS["white"])
    draw.text((stats_x1 + 10, y + 7), "平均分", font=fonts["label"], fill=COLORS["white"])
    draw.text((mid + 12, y + 7), "评分人数", font=fonts["label"], fill=COLORS["black"])

    score = f'{float(item.get("score", 0)):.2f}'
    voters = f'{int(item.get("voters", 0))} 人'
    draw.text((stats_x1 + 22, y + 41), score, font=fonts["metric"], fill=COLORS["white"])
    draw.text((mid + 19, y + 41), voters, font=fonts["metric"], fill=COLORS["white"])

    draw.rectangle((stats_x1, y + L.row_h - 16, stats_x2, y + L.row_h), fill=COLORS["bottom_bar"])
    total = item.get("total")
    detail = f"{item.get('voters', 0)} / {total} 份问卷有效评分" if total else "有效评分人数"
    draw.text((stats_x1 + 10, y + L.row_h - 15), detail, font=fonts["small"], fill=COLORS["black"])


def render(cfg: dict, out: Path):
    fonts = load_fonts()
    canvas = Image.new("RGBA", (L.width, L.height), COLORS["bg"] + (255,))
    draw = ImageDraw.Draw(canvas)
    draw_header(canvas, draw, fonts, cfg)

    items = cfg.get("items", [])[:10]
    assets = Path(cfg.get("assets", "."))
    for idx, item in enumerate(items):
        draw_row(canvas, draw, fonts, item, idx, assets)

    draw.rectangle((0, L.footer_top, L.width, L.height), fill=COLORS["footer"])
    footer = cfg.get("footer", "基于本次有效问卷统计 · 补丁已纳入")
    box = draw.textbbox((0, 0), footer, font=fonts["footer"])
    draw.text(((L.width - (box[2]-box[0])) / 2, L.footer_top + 44), footer, font=fonts["footer"], fill=COLORS["black"])

    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out, quality=95)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config", type=Path)
    ap.add_argument("-o", "--output", type=Path, default=Path("ranking-poster.png"))
    args = ap.parse_args()
    cfg = json.loads(args.config.read_text(encoding="utf-8"))
    render(cfg, args.output)


if __name__ == "__main__":
    main()
