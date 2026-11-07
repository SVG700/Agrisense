"""
Inference service tests with a fake model (no weights or GPU needed).

    .venv/Scripts/python -m unittest -v test_service
"""
import base64
import io
import os
import unittest

os.environ["INFERENCE_API_KEY"] = "test-key-123"

from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

import service  # noqa: E402

service.API_KEY = "test-key-123"


class FakeModel:
    def __init__(self, names):
        self.names = dict(enumerate(names))


class FakeDetector(service.Detector):
    def __init__(self, names=service.AGROPEST_CLASSES):
        super().__init__(FakeModel(names), "fake.pt")
        self.seen = []

    def predict(self, image):
        self.seen.append(image.size)
        return [{"label": "Weevils", "class_id": 11, "confidence": 0.91, "bbox": [10.0, 20.0, 60.0, 80.0]}]


def b64(fmt="JPEG", size=(320, 240), exif_rotate=False):
    img = Image.new("RGB", size, (120, 160, 80))
    buf = io.BytesIO()
    if exif_rotate:
        exif = Image.Exif()
        exif[0x0112] = 6  # rotate 90 degrees on display
        img.save(buf, fmt, exif=exif)
    else:
        img.save(buf, fmt)
    return base64.b64encode(buf.getvalue()).decode()


AUTH = {"Authorization": "Bearer test-key-123"}


class ServiceTest(unittest.TestCase):
    def client(self, det=None):
        self.det = det or FakeDetector()
        return TestClient(service.create_app(loader=lambda: self.det))

    def test_detect_returns_the_generic_contract(self):
        with self.client() as c:
            r = c.post("/detect", json={"image_base64": b64(), "content_type": "image/jpeg"}, headers=AUTH)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual((body["image_width"], body["image_height"]), (320, 240))
        self.assertEqual(body["detections"][0]["label"], "Weevils")
        self.assertEqual(len(body["detections"][0]["bbox"]), 4)
        self.assertEqual(body["model"], "agropest12-yolov8s")

    def test_exif_rotation_is_applied_before_inference(self):
        with self.client() as c:
            r = c.post("/detect", json={"image_base64": b64(exif_rotate=True)}, headers=AUTH)
        self.assertEqual((r.json()["image_width"], r.json()["image_height"]), (240, 320))
        self.assertEqual(self.det.seen[-1], (240, 320))

    def test_api_key_is_required(self):
        with self.client() as c:
            self.assertEqual(c.post("/detect", json={"image_base64": b64()}).status_code, 401)
            self.assertEqual(c.post("/detect", json={"image_base64": b64()}, headers={"Authorization": "Bearer nope"}).status_code, 401)

    def test_bad_inputs_are_rejected_with_a_code(self):
        with self.client() as c:
            cases = [
                ({}, 400, "no_image"),
                ({"image_base64": "%%%not base64"}, 400, "bad_base64"),
                ({"image_base64": base64.b64encode(b"hello").decode()}, 415, "image_unreadable"),
                ({"image_base64": b64("GIF")}, 415, "unsupported_format"),
                ({"image_url": "http://169.254.169.254/latest"}, 400, "image_url_unsupported"),
            ]
            for payload, status, code in cases:
                r = c.post("/detect", json=payload, headers=AUTH)
                self.assertEqual((r.status_code, r.json()["error"]["code"]), (status, code), payload)

    def test_oversized_image_is_refused(self):
        old = service.SETTINGS["max_bytes"]
        service.SETTINGS["max_bytes"] = 1000
        try:
            with self.client() as c:
                r = c.post("/detect", json={"image_base64": b64(size=(800, 800))}, headers=AUTH)
            self.assertEqual(r.status_code, 413)
        finally:
            service.SETTINGS["max_bytes"] = old

    def test_health_reports_the_model_but_not_its_path(self):
        with self.client() as c:
            body = c.get("/health").json()
        self.assertTrue(body["model"]["verified_agropest12"])
        self.assertEqual(body["model"]["classes"], service.AGROPEST_CLASSES)
        self.assertNotIn("\\", str(body))
        self.assertNotIn("/weights/", str(body))

    def test_a_non_agropest_model_is_marked_unverified(self):
        with self.client(FakeDetector(["person", "bicycle"])) as c:
            body = c.get("/health").json()
        self.assertFalse(body["model"]["verified_agropest12"])
        self.assertTrue(body["model"]["name"].startswith("UNVERIFIED"))
        self.assertTrue(body["model"]["experimental"])

    def test_the_29_class_model_is_served_but_labelled_experimental(self):
        with self.client(FakeDetector(service.PEST29_CLASSES)) as c:
            health = c.get("/health").json()["model"]
            r = c.post("/detect", json={"image_base64": b64()}, headers=AUTH).json()
        self.assertEqual(health["profile"], "pest29")
        self.assertEqual(health["imgsz"], 640)
        self.assertTrue(health["experimental"])
        self.assertIn("mAP@50 0.25", health["note"])
        self.assertEqual(r["model"], "pest29-yolo11s-experimental")
        self.assertTrue(r["experimental"])

    def test_agropest_model_is_not_experimental(self):
        with self.client() as c:
            r = c.post("/detect", json={"image_base64": b64()}, headers=AUTH).json()
        self.assertFalse(r["experimental"])


if __name__ == "__main__":
    unittest.main()
