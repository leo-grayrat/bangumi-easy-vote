#!/usr/bin/env python3
"""Render the standalone ranking poster with Pillow."""

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
    header_h: int = 146
    brand_w: int = 344
    row_y: tuple[int, ...] = (168, 317, 467, 616, 766, 915, 1065, 1214, 1364, 1514)
    row_h: int = 136
    left: int = 22
    rank_w: int = 110
    visual_w: int = 699
    stats_w: int = 345
    right: int = 1176
    stats_split: int = 158
    stats_foot_h: int = 34
    stats_head_y: int = 146
    stats_head_h: int = 22
    footer_top: int = 1650

    @property
    def visual_x(self) -> int:
        return self.left + self.rank_w

    @property
    def stats_x(self) -> int:
        return self.visual_x + self.visual_w


L = Layout()

COLORS = {
    "header": (0, 0, 0),
    "stats": (30, 30, 30),
    "rank_top": (255, 104, 111),
    "rank_normal": (239, 148, 72),
    "white": (255, 255, 255),
    "black": (0, 0, 0),
    "aux": (244, 244, 244),
    "trend_up": (54, 193, 32),
    "trend_flat": (255, 176, 24),
    "trend_down": (238, 31, 31),
    "label_red": (221, 0, 0),
}

LATIN_HEAVY_DEFAULTS = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
]
CJK_HEAVY_DEFAULTS = [
    "/usr/share/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
]
CJK_REGULAR_DEFAULTS = [
    "/usr/share/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/truetype/wqy/wqy-zenhei.ttc",
]


def font_candidates(font_cfg: dict, role: str, fallbacks: Iterable[str | None]) -> list[str | None]:
    explicit = font_cfg.get(role)
    return [explicit, *fallbacks] if explicit else list(fallbacks)


def _font(candidates: Iterable[str | None], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in candidates:
        if not candidate:
            continue
        try:
            return ImageFont.truetype(candidate, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def load_fonts(cfg: dict | None = None) -> dict[str, ImageFont.ImageFont]:
    cfg = cfg or {}
    font_cfg = cfg.get("fonts", {}) or {}
    latin = [font_cfg.get("latin"), os.getenv("RANKING_FONT_LATIN"), *LATIN_HEAVY_DEFAULTS]
    cjk = [font_cfg.get("cjk"), os.getenv("RANKING_FONT_CJK"), *CJK_HEAVY_DEFAULTS]
    regular = [
        font_cfg.get("cjk_regular"),
        os.getenv("RANKING_FONT_CJK_REGULAR"),
        *CJK_REGULAR_DEFAULTS,
        *cjk,
    ]
    return {
        "header_title": _font(font_candidates(font_cfg, "header_title", cjk + latin), 60),
        "header_subtitle": _font(font_candidates(font_cfg, "header_subtitle", latin + cjk), 34),
        "brand": _font(font_candidates(font_cfg, "brand", cjk + latin), 34),
        "rank": _font(font_candidates(font_cfg, "rank", latin + cjk), 74),
        "anime": _font(font_candidates(font_cfg, "anime", cjk + latin), 36),
        "anime_small": _font(font_candidates(font_cfg, "anime_small", cjk + latin), 31),
        "label": _font(font_candidates(font_cfg, "label", latin + cjk), 14),
        "metric": _font(font_candidates(font_cfg, "metric", latin + cjk), 46),
        "trend_delta": _font(font_candidates(font_cfg, "trend_delta", latin + cjk), 34),
        "aux": _font(font_candidates(font_cfg, "aux", cjk + latin), 15),
        "footer": _font(font_candidates(font_cfg, "footer", regular + latin), 25),
    }


def sort_items(items: list[dict], mode: str) -> list[dict]:
    """Rank by score, breaking ties with the larger rating sample."""
    if mode == "black":
        return sorted(items, key=lambda item: (float(item.get("score", 0)), -int(item.get("voters", 0))))
    if mode != "red":
        raise ValueError("mode must be 'red' or 'black'")
    return sorted(items, key=lambda item: (-float(item.get("score", 0)), -int(item.get("voters", 0))))


def trend_state(score: float, bgm_score: float, mode: str, thresholds: dict | None = None) -> str:
    """Classify relative preference using different red/black-list baselines."""
    thresholds = thresholds or {}
    delta = float(score) - float(bgm_score)
    if mode == "red":
        if delta >= float(thresholds.get("red_up", 1.0)):
            return "up"
        if delta < float(thresholds.get("red_down", 0.4)):
            return "down"
        return "flat"
    if mode == "black":
        if delta > float(thresholds.get("black_up", -0.4)):
            return "up"
        if delta <= float(thresholds.get("black_down", -1.0)):
            return "down"
        return "flat"
    raise ValueError("mode must be 'red' or 'black'")


def comparison_values(item: dict, mode: str, thresholds: dict | None) -> tuple[str, str, str]:
    """Return BGM label, numeric delta and state; arrows are drawn separately."""
    bgm = item.get("bgm_score")
    if bgm is None:
        return "BGM --", "—", "flat"
    bgm = float(bgm)
    delta = float(item.get("score", 0)) - bgm
    return (
        f"BGM {bgm:.2f}",
        f"{delta:+.2f}",
        trend_state(float(item.get("score", 0)), bgm, mode, thresholds),
    )


def crop_cover(img: Image.Image, size: tuple[int, int], focus=(0.5, 0.5)) -> Image.Image:
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
    for font in fonts:
        if draw.textbbox((0, 0), text, font=font)[2] <= max_width:
            return [text], font
        lines: list[str] = []
        current = ""
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
    fallback = fonts[-1]
    current = text
    while current and draw.textbbox((0, 0), current + "…", font=fallback)[2] > max_width:
        current = current[:-1]
    return [current + "…"], fallback


def _center_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, box, fill):
    x1, y1, x2, y2 = box
    bounds = draw.textbbox((0, 0), text, font=font)
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    draw.text(
        ((x1 + x2 - width) / 2 - bounds[0], (y1 + y2 - height) / 2 - bounds[1]),
        text,
        font=font,
        fill=fill,
    )


def draw_trend_icon(draw: ImageDraw.ImageDraw, state: str, box) -> None:
    """Draw the reference-style double arrows as geometry, not font glyphs."""
    x1, y1, x2, y2 = box
    color = COLORS[f"trend_{state}"]
    line_width = max(4, round((x2 - x1) * 0.07))
    head = max(7, round((x2 - x1) * 0.14))

    if state in ("up", "down"):
        xs = (x1 + (x2 - x1) * 0.34, x1 + (x2 - x1) * 0.68)
        top = y1 + 5
        bottom = y2 - 5
        for x in xs:
            if state == "up":
                draw.line((x, bottom, x, top + head), fill=color, width=line_width)
                draw.line(
                    (x - head, top + head, x, top, x + head, top + head),
                    fill=color,
                    width=line_width,
                    joint="curve",
                )
            else:
                draw.line((x, top, x, bottom - head), fill=color, width=line_width)
                draw.line(
                    (x - head, bottom - head, x, bottom, x + head, bottom - head),
                    fill=color,
                    width=line_width,
                    joint="curve",
                )
        return

    left = x1 + 6
    right = x2 - 6
    y_top = y1 + (y2 - y1) * 0.36
    y_bottom = y1 + (y2 - y1) * 0.68
    draw.line((left, y_top, right - head, y_top), fill=color, width=line_width)
    draw.line(
        (right - head, y_top - head, right, y_top, right - head, y_top + head),
        fill=color,
        width=line_width,
        joint="curve",
    )
    draw.line((right, y_bottom, left + head, y_bottom), fill=color, width=line_width)
    draw.line(
        (left + head, y_bottom - head, left, y_bottom, left + head, y_bottom + head),
        fill=color,
        width=line_width,
        joint="curve",
    )


def draw_header(draw: ImageDraw.ImageDraw, fonts, cfg):
    draw.rectangle((0, 0, L.width, L.header_h - 1), fill=COLORS["header"])
    brand_color = tuple(cfg.get("brand_color", COLORS["rank_top"]))
    draw.rectangle((0, 0, L.brand_w - 1, L.header_h - 1), fill=brand_color)
    draw.text((26, 42), cfg.get("brand", "现视妍 ACG部"), font=fonts["brand"], fill=COLORS["white"])
    draw.text((365, 16), cfg.get("title", "7月新番中期评分 TOP 10"), font=fonts["header_title"], fill=COLORS["white"])
    draw.text((365, 84), cfg.get("subtitle", "2026 MID-SEASON RESULTS"), font=fonts["header_subtitle"], fill=COLORS["white"])


def draw_stats_column_headers(draw: ImageDraw.ImageDraw, fonts, cfg):
    x1 = L.stats_x
    split = x1 + L.stats_split
    y = L.stats_head_y
    bottom = y + L.stats_head_h
    draw.rectangle((x1, y, split - 1, bottom - 1), fill=COLORS["label_red"])
    draw.rectangle((split, y, L.right - 1, bottom - 1), fill=COLORS["white"])
    _center_text(draw, "AVERAGE SCORE", fonts["label"], (x1, y, split, bottom), COLORS["white"])
    _center_text(
        draw,
        cfg.get("comparison_label", "VS BANGUMI"),
        fonts["label"],
        (split, y, L.right, bottom),
        COLORS["black"],
    )


def draw_row(
    canvas: Image.Image,
    draw: ImageDraw.ImageDraw,
    fonts,
    item: dict,
    idx: int,
    assets: Path,
    mode: str,
    thresholds: dict | None,
):
    y = L.row_y[idx]
    rank_x1 = L.left
    rank_x2 = rank_x1 + L.rank_w
    visual_x1 = rank_x2
    visual_x2 = visual_x1 + L.visual_w
    stats_x1 = visual_x2
    stats_x2 = L.right
    split = stats_x1 + L.stats_split
    bottom = y + L.row_h
    foot_y = bottom - L.stats_foot_h

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
            vd.point((x, yy), fill=(0, 0, 0, round(min(145, 18 + horiz + vert))))
    canvas.alpha_composite(veil, (visual_x1, y))

    rank = str(idx + 1)
    rank_box = draw.textbbox((0, 0), rank, font=fonts["rank"])
    rw, rh = rank_box[2] - rank_box[0], rank_box[3] - rank_box[1]
    draw.text(
        (rank_x1 + (L.rank_w - rw) / 2, y + (L.row_h - rh) / 2 - 8),
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
        2,
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
            stroke_fill=COLORS["black"],
        )

    _center_text(
        draw,
        f'{float(item.get("score", 0)):.2f}',
        fonts["metric"],
        (stats_x1, y, split, foot_y),
        COLORS["white"],
    )

    bgm_label, delta_label, state = comparison_values(item, mode, thresholds)
    icon_left = split + 8
    icon_right = min(split + 74, stats_x2 - 92)
    draw_trend_icon(draw, state, (icon_left, y + 19, icon_right, foot_y - 16))
    _center_text(
        draw,
        delta_label,
        fonts["trend_delta"],
        (icon_right + 4, y, stats_x2 - 4, foot_y),
        COLORS["white"],
    )

    draw.rectangle((stats_x1, foot_y, stats_x2 - 1, bottom - 1), fill=COLORS["aux"])
    voters_label = f'投票数 {int(item.get("voters", 0))}'
    draw.text((stats_x1 + 12, foot_y + 8), voters_label, font=fonts["aux"], fill=COLORS["black"])
    bgm_box = draw.textbbox((0, 0), bgm_label, font=fonts["aux"])
    draw.text(
        (stats_x2 - 12 - (bgm_box[2] - bgm_box[0]), foot_y + 8),
        bgm_label,
        font=fonts["aux"],
        fill=COLORS["black"],
    )


def draw_footer(draw: ImageDraw.ImageDraw, fonts, cfg):
    footer = cfg.get("footer", "基于本次有效问卷统计 · 补丁已纳入")
    detail = cfg.get("footer_detail", "BGM 为 Bangumi 当前评分")
    _center_text(draw, footer, fonts["footer"], (0, L.footer_top + 25, L.width, L.footer_top + 75), COLORS["black"])
    _center_text(draw, detail, fonts["footer"], (0, L.footer_top + 65, L.width, L.footer_top + 115), (35, 126, 165))


def render(cfg: dict, out: Path):
    mode = cfg.get("mode", "red")
    thresholds = cfg.get("thresholds", {}) or {}
    fonts = load_fonts(cfg)
    canvas = Image.new("RGBA", (L.width, L.height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    draw_header(draw, fonts, cfg)
    items = sort_items(list(cfg.get("items", [])), mode)[:10]
    assets = Path(cfg.get("assets", "."))
    for idx, item in enumerate(items):
        draw_row(canvas, draw, fonts, item, idx, assets, mode, thresholds)

    draw_stats_column_headers(draw, fonts, cfg)
    draw_footer(draw, fonts, cfg)

    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config", type=Path)
    ap.add_argument("-o", "--output", type=Path, default=Path("ranking-poster.png"))
    args = ap.parse_args()
    cfg = json.loads(args.config.read_text(encoding="utf-8"))
    render(cfg, args.output)


if __name__ == "__main__":
    main()
