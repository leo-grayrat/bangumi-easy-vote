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
        cjk = next((Path(p) for p in render.CJK_HEAVY_DEFAULTS if Path(p).exists()), None)
        if cjk is None:
            self.skipTest("no CJK font installed in test environment")
        font = render.load_fonts({})["header_title"]
        self.assertEqual(Path(font.path), cjk)


if __name__ == "__main__":
    unittest.main()
