import os
import unittest
from unittest.mock import patch

try:
    import cv2
    import numpy as np
    from agrisense_edge import vision
    HAS_CV = True
except ImportError:
    HAS_CV = False

@unittest.skipUnless(HAS_CV, "OpenCV and NumPy are required")
class VisionPipelineTests(unittest.TestCase):
    def test_rejects_empty_frame(self):
        with self.assertRaises(ValueError):
            vision.process(np.zeros((0, 0, 3), dtype=np.uint8))

    def test_no_yellow_card_means_no_candidate_boxes(self):
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        result = vision.process(frame)
        self.assertFalse(result["card_found"])
        self.assertEqual(result["boxes"], [])
        self.assertTrue(any("WARNING" in item for item in result["pipeline"]))

    def test_detects_card_and_dark_candidate_regions(self):
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        frame[:] = (40, 40, 40)
        cv2.rectangle(frame, (100, 60), (540, 420), (0, 220, 240), -1)
        for x, y in ((180, 150), (280, 230), (400, 330)):
            cv2.circle(frame, (x, y), 7, (20, 20, 20), -1)
        result = vision.process(frame, width=640)
        self.assertTrue(result["card_found"])
        self.assertGreaterEqual(result["candidate_count"], 1)
        for box in result["boxes"]:
            self.assertGreaterEqual(box["x"], 0)
            self.assertGreaterEqual(box["y"], 0)
            self.assertLessEqual(box["x"] + box["width"], 1.001)
            self.assertLessEqual(box["y"] + box["height"], 1.001)

    def test_width_is_bounded_and_preserves_aspect_ratio(self):
        frame = np.zeros((300, 600, 3), dtype=np.uint8)
        result = vision.process(frame, width=300)
        self.assertEqual(result["size"], (300, 150))

    def test_invalid_environment_values_fall_back_safely(self):
        frame = np.zeros((100, 100, 3), dtype=np.uint8)
        with patch.dict(os.environ, {"AGRISENSE_VISION_WIDTH": "not-a-number"}):
            result = vision.process(frame)
        self.assertEqual(result["size"], (100, 100))

if __name__ == "__main__":
    unittest.main()
