import tempfile
import unittest
from pathlib import Path

from PIL import Image

import render


class RenderBehaviorTests(unittest.TestCase):
    def test_output_keeps_transparent_background(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "poster.png"
            render.render({"items": []}, out)
            with Image.open(out) as img:
                self.assertEqual(img.mode, "RGBA")
                self.assertEqual(img.getpixel((10, 300))[3], 0)
                self.assertEqual(img.getpixel((10, 1700))[3], 0)
                self.assertEqual(img.getpixel((10, 10))[3], 255)

    def test_font_config_can_override_header_title(self):
        paths = render.font_candidates(
            {"header_title": "/tmp/custom-title.ttf"},
            "header_title",
            ["fallback.ttf"],
        )
        self.assertEqual(paths[0], "/tmp/custom-title.ttf")

    def test_default_header_title_prefers_cjk_capable_font(self):
        cjk = next((Path(p) for p in render.CJK_HEAVY_DEFAULTS if isinstance(p, str) and Path(p).exists()), None)
        if cjk is None:
            self.skipTest("no CJK font installed in test environment")
        font = render.load_fonts({})["header_title"]
        self.assertEqual(Path(font.path), cjk)

    def test_default_cjk_roles_use_simplified_chinese_face(self):
        noto = Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc")
        if not noto.exists():
            self.skipTest("Noto CJK collection is not installed")
        fonts = render.load_fonts({})
        self.assertIn("CJK SC", fonts["anime"].getname()[0])
        self.assertIn("CJK SC", fonts["header_title"].getname()[0])

    def test_red_and_black_sort_ties_by_more_voters(self):
        red_items = [
            {"title": "A", "score": 8.0, "voters": 4},
            {"title": "B", "score": 8.0, "voters": 5},
            {"title": "C", "score": 7.0, "voters": 9},
        ]
        self.assertEqual(
            [x["title"] for x in render.sort_items(red_items, "red")],
            ["B", "A", "C"],
        )

        black_items = [
            {"title": "A", "score": 7.0, "voters": 6},
            {"title": "B", "score": 7.0, "voters": 7},
            {"title": "C", "score": 6.0, "voters": 4},
        ]
        self.assertEqual(
            [x["title"] for x in render.sort_items(black_items, "black")],
            ["C", "B", "A"],
        )

    def test_red_and_black_use_different_trend_baselines(self):
        self.assertEqual(render.trend_state(8.8, 8.0, "red"), "flat")
        self.assertEqual(render.trend_state(8.8, 7.5, "red"), "up")
        self.assertEqual(render.trend_state(8.0, 8.0, "red"), "down")

        self.assertEqual(render.trend_state(4.8, 5.5, "black"), "flat")
        self.assertEqual(render.trend_state(4.0, 5.5, "black"), "down")
        self.assertEqual(render.trend_state(5.5, 5.5, "black"), "up")

    def test_stats_headers_fit_above_first_row(self):
        self.assertLessEqual(
            render.L.stats_head_y + render.L.stats_head_h,
            render.L.row_y[0],
        )

    def test_comparison_column_is_wider_than_score_column(self):
        self.assertLess(render.L.stats_split, render.L.stats_w - render.L.stats_split)

    def test_auxiliary_row_stays_compact(self):
        self.assertGreaterEqual(render.L.stats_foot_h, 18)
        self.assertLessEqual(render.L.stats_foot_h, 24)
        self.assertLessEqual(render.load_fonts({})["aux"].size, 15)

    def test_comparison_text_does_not_embed_unicode_arrow(self):
        bgm_label, delta_label, state = render.comparison_values(
            {"score": 8.57, "bgm_score": 6.94}, "red", None
        )
        self.assertEqual(bgm_label, "BGM 6.94")
        self.assertEqual(delta_label, "+1.63")
        self.assertEqual(state, "up")
        self.assertFalse(any(symbol in delta_label for symbol in "↑↓↔→←"))

    def test_reference_trend_assets_decode_with_transparency(self):
        for state in ("up", "down", "flat"):
            icon = render.load_trend_icon(state)
            self.assertEqual(icon.mode, "RGBA")
            alpha = icon.getchannel("A")
            self.assertEqual(alpha.getextrema()[0], 0)
            self.assertGreater(alpha.getextrema()[1], 200)

    def test_auxiliary_strip_uses_trend_color_across_both_columns(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "poster.png"
            render.render(
                {
                    "mode": "red",
                    "items": [
                        {
                            "title": "A",
                            "score": 8.5,
                            "voters": 7,
                            "bgm_score": 7.0,
                        }
                    ],
                },
                out,
            )
            with Image.open(out) as img:
                y = render.L.row_y[0] + render.L.row_h - 2
                self.assertEqual(img.getpixel((render.L.stats_x + 8, y))[:3], render.COLORS["trend_up"])
                self.assertEqual(img.getpixel((render.L.right - 8, y))[:3], render.COLORS["trend_up"])


if __name__ == "__main__":
    unittest.main()
