import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

import render


HERE = Path(__file__).resolve().parent


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

    def test_score_comparison_modes_share_adjustable_bangumi_thresholds(self):
        for mode in ("red", "black", "bgm-deviation"):
            self.assertEqual(render.trend_state(7.69, 7.0, mode), "flat")
            self.assertEqual(render.trend_state(7.70, 7.0, mode), "up")
            self.assertEqual(render.trend_state(6.99, 7.0, mode), "down")
            self.assertEqual(
                render.trend_state(
                    7.20,
                    7.0,
                    mode,
                    {"scoreBgmDown": 0.1, "scoreBgmUp": 0.3},
                ),
                "flat",
            )

    def test_legacy_red_black_thresholds_are_still_read_when_new_fields_are_absent(self):
        self.assertEqual(
            render.trend_state(8.8, 8.0, "red", {"redDown": 0.4, "redUp": 1.0}),
            "flat",
        )
        self.assertEqual(
            render.trend_state(5.5, 5.5, "black", {"blackDown": -1.0, "blackUp": -0.4}),
            "up",
        )

    def test_controversy_uses_one_adjustable_sd_threshold_pair(self):
        self.assertEqual(render.controversy_trend_state(1.50, 1.00), "up")
        self.assertEqual(render.controversy_trend_state(0.50, 1.00), "down")
        self.assertEqual(render.controversy_trend_state(1.10, 1.00), "flat")
        self.assertEqual(
            render.controversy_trend_state(
                1.25,
                1.00,
                {"controversyDown": -0.2, "controversyUp": 0.2},
            ),
            "up",
        )

    def test_midseason_thresholds_default_to_positive_negative_around_zero(self):
        self.assertEqual(render.midseason_trend_state(7.01, 7.00), "up")
        self.assertEqual(render.midseason_trend_state(6.99, 7.00), "down")
        self.assertEqual(render.midseason_trend_state(7.00, 7.00), "flat")
        thresholds = {"midseasonDown": -0.3, "midseasonUp": 0.3}
        self.assertEqual(render.midseason_trend_state(7.2, 7.0, thresholds), "flat")
        self.assertEqual(render.midseason_trend_state(7.4, 7.0, thresholds), "up")
        self.assertEqual(render.midseason_trend_state(6.6, 7.0, thresholds), "down")

    def test_three_dual_section_modes_use_separate_one_to_five_ranks_without_overlap(self):
        controversy_items = [
            {"title": f"C{i}", "stdDev": i / 10, "voters": 10}
            for i in range(12)
        ]
        controversy_rows = render.display_rows(controversy_items, "controversy")
        self.assertEqual([row["section"] for row in controversy_rows[:5]], ["controversial"] * 5)
        self.assertEqual([row["section"] for row in controversy_rows[5:]], ["consistent"] * 5)
        self.assertEqual([row["display_rank"] for row in controversy_rows], [1,2,3,4,5,1,2,3,4,5])
        self.assertEqual(len({id(row["item"]) for row in controversy_rows}), 10)

        mid_items = [
            {"title": f"M{i}", "score": 7.0, "midseasonScore": 7.0 - delta, "midseasonVoters": 8}
            for i, delta in enumerate([-2,-1.5,-1,-0.5,-0.2,0.1,0.4,0.8,1.2,1.6,2.0,2.5])
        ]
        mid_rows = render.display_rows(mid_items, "midseason-change")
        self.assertEqual([row["section"] for row in mid_rows[:5]], ["improved"] * 5)
        self.assertEqual([row["section"] for row in mid_rows[5:]], ["declined"] * 5)
        self.assertEqual(len({id(row["item"]) for row in mid_rows}), 10)

        bgm_items = [
            {"title": f"B{i}", "score": 7.0, "bgmScore": 7.0 - delta, "voters": 10}
            for i, delta in enumerate([-1.2,-0.9,-0.4,-0.2,-0.1,0.1,0.3,0.5,0.8,1.0,1.4,1.8])
        ]
        bgm_rows = render.display_rows(bgm_items, "bgm-deviation")
        self.assertEqual([row["section"] for row in bgm_rows[:5]], ["above"] * 5)
        self.assertEqual([row["section"] for row in bgm_rows[5:]], ["below"] * 5)
        self.assertEqual(len({id(row["item"]) for row in bgm_rows}), 10)

    def test_midseason_row_uses_midseason_voter_count_in_footer(self):
        metric, delta, state, left, right = render.row_values(
            {"score": 5.0, "midseasonScore": 3.125, "midseasonVoters": 8},
            "midseason-change",
            1,
            {},
        )
        self.assertEqual(metric, "5.00")
        self.assertEqual(delta, "+1.88")
        self.assertEqual(state, "up")
        self.assertEqual(left, "MID N8")
        self.assertEqual(right, "MID 3.12")

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
                    "items": [{"title": "A", "score": 8.5, "voters": 7, "bgmScore": 7.0}],
                },
                out,
            )
            with Image.open(out) as img:
                y = render.L.row_y[0] + render.L.row_h - 2
                self.assertEqual(img.getpixel((render.L.stats_x + 8, y))[:3], render.COLORS["trend_up"])
                self.assertEqual(img.getpixel((render.L.right - 8, y))[:3], render.COLORS["trend_up"])

    def test_manual_title_lines_override_auto_wrap(self):
        image = Image.new("RGBA", (800, 200), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        fonts = render.load_fonts({})
        item = {
            "title": "Re:从零开始的异世界生活 第4期 Part.2 夺还篇",
            "title_lines": ["Re:从零开始的异世界生活 第4期", "Part.2 夺还篇"],
        }
        lines, _ = render.resolve_title_lines(draw, item, fonts, 650)
        self.assertEqual(lines, item["title_lines"])

    def test_delta_sign_has_fixed_slot_and_uses_math_minus(self):
        self.assertGreaterEqual(render.L.delta_sign_w, 20)
        self.assertEqual(render.delta_parts("+1.63"), ("+", "1.63"))
        self.assertEqual(render.delta_parts("-0.10"), ("−", "0.10"))

    def test_header_text_block_is_vertically_centered(self):
        image = Image.new("RGBA", (1200, 200), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        fonts = render.load_fonts({})
        layout = render.header_text_layout(
            draw,
            fonts,
            {"title": "7月新番完结评分 TOP 10", "subtitle": "SEASON FINALE TOP 10 ANIME"},
        )
        top_margin = layout["block_top"]
        bottom_margin = render.L.header_h - layout["block_bottom"]
        self.assertLessEqual(abs(top_margin - bottom_margin), 2)
        self.assertGreaterEqual(top_margin, 8)

    def test_brand_and_footer_copy_do_not_affect_render(self):
        with tempfile.TemporaryDirectory() as td:
            out_a = Path(td) / "a.png"
            out_b = Path(td) / "b.png"
            base = {"title": "T", "subtitle": "S", "items": []}
            render.render({**base, "brand": "AAAA", "footer": "AAAA", "footer_detail": "AAAA"}, out_a)
            render.render({**base, "brand": "BBBB", "footer": "BBBB", "footer_detail": "BBBB"}, out_b)
            with Image.open(out_a) as a, Image.open(out_b) as b:
                self.assertIsNone(ImageChops.difference(a, b).getbbox())

    def test_all_six_samples_render_exactly_ten_display_rows(self):
        filenames = [
            "sample.json",
            "sample-black.json",
            "sample-favorite.json",
            "sample-controversy.json",
            "sample-midseason-change.json",
            "sample-bgm-deviation.json",
        ]
        for filename in filenames:
            cfg = json.loads((HERE / filename).read_text(encoding="utf-8"))
            rows = render.display_rows(cfg["items"], cfg["mode"])
            self.assertEqual(len(rows), 10, filename)
            self.assertEqual(set(cfg["thresholds"]), {
                "scoreBgmDown",
                "scoreBgmUp",
                "controversyDown",
                "controversyUp",
                "favoriteDown",
                "favoriteUp",
                "midseasonDown",
                "midseasonUp",
            })

    def test_red_sample_is_the_finale_top_ten(self):
        cfg = json.loads((HERE / "sample.json").read_text(encoding="utf-8"))
        rows = render.display_rows(cfg["items"], cfg["mode"])
        self.assertEqual(cfg["title"], "7月新番完结评分 TOP 10")
        self.assertEqual(rows[0]["item"]["title"], "穹庐下的魔女")
        self.assertEqual(rows[-1]["item"]["title"], "画完这个在去死")


if __name__ == "__main__":
    unittest.main()
