"""Unit tests for tools/visual_compare.py (the screenshot regression comparator)."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOL = Path(__file__).resolve().parent.parent / "tools" / "visual_compare.py"
sys.path.insert(0, str(TOOL.parent))
import visual_compare as vc  # noqa: E402


def solid(width, height, rgba):
    return [bytes(rgba) * width for _ in range(height)]


class VisualCompareTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="d2da-visual-"))

    def run_tool(self, *args):
        return subprocess.run([sys.executable, str(TOOL), *args], capture_output=True, text=True)

    def image(self, name, rows):
        path = self.dir / name
        vc.write_png(path, len(rows[0]) // 4, len(rows), rows)
        return str(path)

    def test_png_round_trip(self):
        rows = solid(5, 3, (10, 20, 30, 255))
        path = self.image("a.png", rows)
        self.assertEqual(vc.read_png(path), (5, 3, rows))

    def test_identical_images_match(self):
        a = self.image("a.png", solid(40, 20, (50, 60, 70, 255)))
        g = self.image("g.png", solid(40, 20, (50, 60, 70, 255)))
        result = self.run_tool(a, g, "--crop", "0,0,40,20")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_noise_within_tolerance_matches(self):
        a = self.image("a.png", solid(40, 20, (50, 60, 70, 255)))
        g = self.image("g.png", solid(40, 20, (58, 52, 70, 255)))
        self.assertEqual(self.run_tool(a, g, "--crop", "0,0,40,20").returncode, 0)

    def test_visible_change_is_a_regression(self):
        base = solid(40, 20, (50, 60, 70, 255))
        changed = [bytearray(r) for r in base]
        for y in range(5, 15):
            changed[y][40:80] = bytes((255, 0, 0, 255)) * 10
        a = self.image("a.png", [bytes(r) for r in changed])
        g = self.image("g.png", base)
        diff = self.dir / "diff.png"
        result = self.run_tool(a, g, "--crop", "0,0,40,20", "--diff-out", str(diff))
        self.assertEqual(result.returncode, 1)
        self.assertIn("REGRESSION", result.stderr)
        self.assertTrue(diff.exists())

    def test_change_outside_the_crop_is_ignored(self):
        base = solid(40, 20, (50, 60, 70, 255))
        changed = [bytearray(r) for r in base]
        changed[0][0:16] = bytes((255, 0, 0, 255)) * 4  # top-left, outside the crop
        a = self.image("a.png", [bytes(r) for r in changed])
        full = self.image("full.png", base)
        golden = str(self.dir / "golden.png")
        self.assertEqual(self.run_tool(full, golden, "--crop", "0,10,40,10", "--update").returncode, 0)
        self.assertEqual(self.run_tool(a, golden, "--crop", "0,10,40,10").returncode, 0)

    def test_update_writes_the_cropped_golden(self):
        a = self.image("a.png", solid(40, 20, (1, 2, 3, 255)))
        golden = self.dir / "golden.png"
        self.assertEqual(self.run_tool(a, str(golden), "--crop", "4,2,10,6", "--update").returncode, 0)
        self.assertEqual(vc.read_png(golden)[:2], (10, 6))

    def test_crop_outside_the_image_is_unusable_input(self):
        a = self.image("a.png", solid(10, 10, (0, 0, 0, 255)))
        self.assertEqual(self.run_tool(a, a, "--crop", "0,0,50,50").returncode, 2)

    def test_missing_golden_is_unusable_input(self):
        a = self.image("a.png", solid(10, 10, (0, 0, 0, 255)))
        self.assertEqual(self.run_tool(a, str(self.dir / "none.png"), "--crop", "0,0,10,10").returncode, 2)


if __name__ == "__main__":
    unittest.main()
