import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

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
        cjk = next((Path(p) for p in render.CJK_HEAVY_DEFAULTS if Path(p).exists()), None)
        if cjk is None:
            self.skipTest("no CJK font installed in test environment")
        font = render.load_fonts({})["header_title"]
        self.assertEqual(Path(font.path), cjk)

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

    def test_auxiliary_row_is_tall_enough_for_voters_and_bgm(self):
        self.assertGreaterEqual(render.L.stats_foot_h, 32)

    def test_comparison_text_does_not_embed_unicode_arrow(self):
        bgm_label, delta_label, state = render.comparison_values(
            {"score": 8.57, "bgm_score": 6.94}, "red", None
        )
        self.assertEqual(bgm_label, "BGM 6.94")
        self.assertEqual(delta_label, "+1.63")
        self.assertEqual(state, "up")
        self.assertFalse(any(symbol in delta_label for symbol in "↑↓↔→←"))

    def test_trend_icon_is_drawn_as_geometry(self):
        image = Image.new("RGBA", (90, 70), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        render.draw_trend_icon(draw, "up", (5, 5, 75, 65))
        self.assertIsNotNone(image.getbbox())
        self.assertGreater(image.getbbox()[2] - image.getbbox()[0], 20)
        self.assertGreater(image.getbbox()[3] - image.getbbox()[1], 30)


if __name__ == "__main__":
    unittest.main()
