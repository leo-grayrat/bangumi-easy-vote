#!/usr/bin/env python3
"""Render the standalone ranking poster with Pillow.

The geometry is calibrated against the two Anime Corner reference posters
supplied for this task. This module stays independent from the voting HTML.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageEnhance, ImageFont


@dataclass(frozen=True)
class Layout:
    width: int = 1200
    height: int = 1800

    # Reference image: header occupies y=0..145; body background starts at 146.
    header_h: int = 146
    brand_w: int = 344

    # Measured row starts in the 2026 reference. Keeping the measured values
    # avoids cumulative 4-5 px drift across ten rows.
    row_y: tuple[int, ...] = (168, 317, 467, 616, 766, 915, 1065, 1214, 1364, 1514)
    row_h: int = 136

    left: int = 22
    rank_w: int = 110
    visual_w: int = 699
    stats_w: int = 345
    right: int = 1176  # exclusive

    stats_split: int = 185
    stats_foot_h: int = 20

    footer_top: int = 1650

    @property
    def visual_x(self) -> int:
        return self.left + self.rank_w

    @property
    def stats_x(self) -> int:
        return self.visual_x + self.visual_w


L = Layout()

COLORS = {
    "bg": (106, 210, 214),
    "header": (0, 0, 0),
    "stats": (30, 30, 30),
    "rank_top": (255, 104, 111),
    "rank_normal": (239, 148, 72),
    "accent": (106, 210, 214),
    "footer": (255, 233, 204),
    "white": (255, 255, 255),
    "black": (0, 0, 0),
    "yellow": (255, 176, 24),
    "green": (54, 193, 32),
    "label_red": (221, 0, 0),
}


def _font(candidates: Iterable[str | None], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


def load_fonts() -> dict[str, ImageFont.ImageFont]:
    # Font names are still an approximation. Geometry/weight is calibrated first;
    # callers can override with environment variables without shipping font files.
    latin_heavy = [
        os.getenv("RANKING_FONT_LATIN"),
        "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
    ]
    cjk_heavy = [
        os.getenv("RANKING_FONT_CJK"),
        "/usr/share/opentype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    ]
    cjk_regular = [
        os.getenv("RANKING_FONT_CJK_REGULAR"),
        "/usr/share/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    ]
    return {
        "header_title": _font(latin_heavy, 60),
        "header_subtitle": _font(latin_heavy, 34),
        "brand": _font(cjk_heavy + latin_heavy, 34),
        "rank": _font(latin_heavy, 74),
        "anime": _font(cjk_heavy + latin_heavy, 36),
        "anime_small": _font(cjk_heavy + latin_heavy, 31),
        "label": _font(cjk_heavy + latin_heavy, 16),
        "metric": _font(latin_heavy + cjk_heavy, 46),
        "small": _font(cjk_heavy + latin_heavy, 14),
        "footer": _font(cjk_regular + latin_heavy, 25),
    }


def crop_cover(img: Image.Image, size: tuple[int, int], focus=(0.5, 0.5)) -> Image.Image:
    """Cover-crop while allowing a manually supplied focal point in [0, 1]."""
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
    """Simple placeholder used only when visual assets are absent."""
    base = (66 + seed * 9 % 80, 78 + seed * 13 % 90, 104 + seed * 17 % 80)
    img = Image.new("RGB", size, base)
    draw = ImageDraw.Draw(img)
    for x in range(-size[1], size[0], 120):
        draw.polygon(
            ((x, 0), (x + 58, 0), (x + size[1] + 58, size[1]), (x + size[1], size[1])),
            fill=tuple(min(255, c + 18) for c in base),
        )
    return img


def fit_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    fonts: list[ImageFont.ImageFont],
    max_width: int,
    max_lines: int = 2,
):
    """Fit CJK/Latin titles into at most ``max_lines`` lines."""
    for font in fonts:
        if draw.textbbox((0, 0), text, font=font)[2] <= max_width:
            return [text], font

        lines: list[str] = []
        current = ""
        for ch in text:
            trial = current + ch
            if draw.textbbox((0, 0), trial, font=font)[2] <= max_width:
                current = trial
                continue
            if current:
                lines.append(current)
            current = ch
            if len(lines) >= max_lines:
                break
        if current and len(lines) < max_lines:
            lines.append(current)
        if len(lines) <= max_lines and "".join(lines) == text:
            return lines, font

    fallback = fonts[-1]
    ellipsis = "…"
    current = text
    while current and draw.textbbox((0, 0), current + ellipsis, font=fallback)[2] > max_width:
        current = current[:-1]
    return [current + ellipsis], fallback


def draw_header(canvas: Image.Image, draw: ImageDraw.ImageDraw, fonts, cfg):
    draw.rectangle((0, 0, L.width, L.header_h - 1), fill=COLORS["header"])
    brand_color = tuple(cfg.get("brand_color", COLORS["rank_top"]))
    draw.rectangle((0, 0, L.brand_w - 1, L.header_h - 1), fill=brand_color)

    brand = cfg.get("brand", "现视妍 ACG部")
    draw.text((26, 42), brand, font=fonts["brand"], fill=COLORS["white"])

    title = cfg.get("title", "7月新番中期评分 TOP 10")
    subtitle = cfg.get("subtitle", "2026 MID-SEASON RESULTS")
    draw.text((365, 16), title, font=fonts["header_title"], fill=COLORS["white"])
    draw.text((365, 84), subtitle, font=fonts["header_subtitle"], fill=COLORS["white"])


def draw_stats_column_headers(draw: ImageDraw.ImageDraw, fonts):
    """Reference poster shows the column headers only once, above row 1."""
    y = L.row_y[0] - 12
    x1 = L.stats_x
    split = x1 + L.stats_split
    x2 = L.right
    h = 28
    draw.rectangle((x1, y, split - 1, y + h - 1), fill=COLORS["label_red"])
    draw.rectangle((split, y, x2 - 1, y + h - 1), fill=COLORS["white"])
    draw.text((x1 + 12, y + 4), "AVERAGE SCORE", font=fonts["label"], fill=COLORS["white"])
    draw.text((split + 14, y + 4), "RATERS", font=fonts["label"], fill=COLORS["black"])


def draw_row(canvas: Image.Image, draw: ImageDraw.ImageDraw, fonts, item, idx: int, assets: Path):
    y = L.row_y[idx]
    rank_x1 = L.left
    rank_x2 = rank_x1 + L.rank_w
    visual_x1 = rank_x2
    visual_x2 = visual_x1 + L.visual_w
    stats_x1 = visual_x2
    stats_x2 = L.right
    bottom = y + L.row_h

    draw.rectangle((rank_x1 + 3, bottom, stats_x2 + 2, bottom + 4), fill=(48, 70, 72, 150))

    rank_color = COLORS["rank_top"] if idx < 3 else COLORS["rank_normal"]
    draw.rectangle((rank_x1, y, rank_x2 - 1, bottom - 1), fill=rank_color)
    draw.rectangle((stats_x1, y, stats_x2 - 1, bottom - 1), fill=COLORS["stats"])

    image_path = assets / item.get("image", "") if item.get("image") else None
    if image_path and image_path.exists():
        with Image.open(image_path) as src:
            visual = crop_cover(src, (L.visual_w, L.row_h), item.get("focus", [0.5, 0.5]))
    else:
        visual = placeholder((L.visual_w, L.row_h), idx)

    visual = ImageEnhance.Brightness(visual).enhance(float(item.get("brightness", 0.78)))
    canvas.paste(visual, (visual_x1, y))

    veil = Image.new("RGBA", (L.visual_w, L.row_h), (0, 0, 0, 0))
    vd = ImageDraw.Draw(veil)
    for x in range(L.visual_w):
        horiz = 78 * (1 - x / max(1, L.visual_w - 1))
        for yy in range(L.row_h):
            vert = 64 * (yy / max(1, L.row_h - 1))
            alpha = round(min(145, 18 + horiz + vert))
            vd.point((x, yy), fill=(0, 0, 0, alpha))
    canvas.alpha_composite(veil, (visual_x1, y))

    rank = str(item.get("rank", idx + 1))
    rb = draw.textbbox((0, 0), rank, font=fonts["rank"])
    rw = rb[2] - rb[0]
    rh = rb[3] - rb[1]
    rank_y = y + (L.row_h - rh) / 2 - 8
    draw.text(
        (rank_x1 + (L.rank_w - rw) / 2, rank_y),
        rank,
        font=fonts["rank"],
        fill=COLORS["white"] if idx < 3 else COLORS["black"],
    )

    title = str(item.get("title", "UNTITLED"))
    lines, anime_font = fit_text(
        draw,
        title,
        [fonts["anime"], fonts["anime_small"]],
        L.visual_w - 44,
        max_lines=2,
    )
    line_h = 39 if anime_font is fonts["anime"] else 34
    title_y = bottom - 16 - line_h * len(lines)
    for line_no, line in enumerate(lines):
        draw.text(
            (visual_x1 + 20, title_y + line_no * line_h),
            line,
            font=anime_font,
            fill=COLORS["white"],
            stroke_width=1,
            stroke_fill=(0, 0, 0),
        )

    split = stats_x1 + L.stats_split
    score = f'{float(item.get("score", 0)):.2f}'
    voters = f'{int(item.get("voters", 0))}'

    score_box = draw.textbbox((0, 0), score, font=fonts["metric"])
    voters_box = draw.textbbox((0, 0), voters, font=fonts["metric"])
    score_w = score_box[2] - score_box[0]
    voters_w = voters_box[2] - voters_box[0]
    metric_y = y + 42

    draw.text((stats_x1 + (L.stats_split - score_w) / 2, metric_y), score, font=fonts["metric"], fill=COLORS["white"])
    draw.text((split + ((stats_x2 - split) - voters_w) / 2, metric_y), voters, font=fonts["metric"], fill=COLORS["white"])

    foot_y = bottom - L.stats_foot_h
    draw.rectangle((stats_x1, foot_y, split - 1, bottom - 1), fill=COLORS["yellow"])
    draw.rectangle((split, foot_y, stats_x2 - 1, bottom - 1), fill=COLORS["green"])
    draw.text((stats_x1 + 34, foot_y + 2), "平均评分", font=fonts["small"], fill=COLORS["black"])
    draw.text((split + 31, foot_y + 2), f'{int(item.get("voters", 0))} 人评分', font=fonts["small"], fill=COLORS["black"])


def draw_footer(draw: ImageDraw.ImageDraw, fonts, cfg):
    draw.rectangle((0, L.footer_top, L.width, L.height), fill=COLORS["footer"])
    footer = cfg.get("footer", "基于本次有效问卷统计 · 补丁已纳入")
    detail = cfg.get("footer_detail", "平均分仅统计有效评分 · 右栏为评分人数")

    box = draw.textbbox((0, 0), footer, font=fonts["footer"])
    draw.text(((L.width - (box[2] - box[0])) / 2, L.footer_top + 42), footer, font=fonts["footer"], fill=COLORS["black"])
    box2 = draw.textbbox((0, 0), detail, font=fonts["footer"])
    draw.text(((L.width - (box2[2] - box2[0])) / 2, L.footer_top + 80), detail, font=fonts["footer"], fill=(35, 126, 165))


def render(cfg: dict, out: Path):
    fonts = load_fonts()
    canvas = Image.new("RGBA", (L.width, L.height), COLORS["bg"] + (255,))
    draw = ImageDraw.Draw(canvas)

    draw_header(canvas, draw, fonts, cfg)
    draw_stats_column_headers(draw, fonts)

    items = cfg.get("items", [])[:10]
    assets = Path(cfg.get("assets", "."))
    for idx, item in enumerate(items):
        draw_row(canvas, draw, fonts, item, idx, assets)

    draw_footer(draw, fonts, cfg)

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
