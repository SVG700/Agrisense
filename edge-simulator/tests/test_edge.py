"""
Edge client tests (stdlib unittest; no hardware, network or `requests` needed).

    cd edge-simulator
    python -m unittest discover -s tests -v
"""

import os
import sys
import tempfile
import time
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agrisense_edge.queue_store import CaptureQueue  # noqa: E402
from agrisense_edge.simulated import Microclimate  # noqa: E402
from agrisense_edge.uploader import Uploader, backoff_delay, build_payload  # noqa: E402
from agrisense_edge import hardware  # noqa: E402

DEVICE = "11111111-1111-4111-8111-111111111111"


def record(**over):
    rec = {
        "capture_id": str(uuid.uuid4()),
        "device_id": DEVICE,
        "captured_at": "2026-01-01T00:00:00+00:00",
        "data_source": "simulator",
        "temperature": 24.0,
        "humidity": 70.0,
        "image_url": "http://localhost:4000/api/mock-trap/a.svg?d=0.3",
    }
    rec.update(over)
    return rec


class FakeResponse:
    def __init__(self, status, body=None, headers=None):
        self.status_code = status
        self._body = body if body is not None else {}
        self.headers = headers or {}
        self.ok = 200 <= status < 300

    def json(self):
        return self._body


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.posts = []

    def post(self, url, json=None, headers=None, timeout=None):
        self.posts.append({"url": url, "json": json, "headers": headers})
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    def get(self, url, timeout=None):
        return FakeResponse(200, {"store": "memory"})


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.q = CaptureQueue(os.path.join(self.dir, "q.db"), max_pending=3, keep_sent_hours=0)

    def tearDown(self):
        self.q.close()

    def test_enqueue_is_idempotent_and_persistent(self):
        rec = record()
        self.q.enqueue(rec)
        self.q.enqueue(rec)
        self.assertEqual(self.q.stats()["pending"], 1)
        self.q.close()
        self.q = CaptureQueue(os.path.join(self.dir, "q.db"))  # survives "reboot"
        self.assertEqual(self.q.due()[0]["capture_id"], rec["capture_id"])

    def test_backoff_hides_records_until_due(self):
        rec = record()
        self.q.enqueue(rec)
        self.q.mark_retry(rec["capture_id"], "offline", 60)
        self.assertEqual(self.q.due(), [])
        self.assertEqual(self.q.get(rec["capture_id"])["attempts"], 1)

    def test_prune_bounds_pending_and_removes_sent(self):
        img = os.path.join(self.dir, "x.jpg")
        open(img, "wb").close()
        recs = [record(image_path=img if i == 0 else None) for i in range(5)]
        for r in recs:
            self.q.enqueue(r)
            time.sleep(0.01)
        self.q.mark_sent(recs[4]["capture_id"])
        time.sleep(0.01)
        removed = self.q.prune()
        self.assertEqual(removed["sent"], 1)
        self.assertEqual(removed["overflow"], 1)  # 4 pending > max 3 -> oldest dropped
        self.assertFalse(os.path.exists(img))
        self.assertIsNone(self.q.get(recs[0]["capture_id"]))


class UploaderTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.q = CaptureQueue(os.path.join(self.dir, "q.db"))

    def tearDown(self):
        self.q.close()

    def _run(self, responses, rec=None):
        rec = rec or record()
        self.q.enqueue(rec)
        session = FakeSession(responses)
        up = Uploader(session, "http://api.test", "device-key-0123456789")
        result = up.flush(self.q)
        return rec, session, result

    def test_success_marks_sent_and_sends_capture_id_and_auth(self):
        rec, session, result = self._run([FakeResponse(201, {"telemetry": {"detection": {}}})])
        self.assertEqual(result["sent"], 1)
        self.assertEqual(self.q.get(rec["capture_id"])["status"], "sent")
        post = session.posts[0]
        self.assertEqual(post["json"]["capture_id"], rec["capture_id"])
        self.assertEqual(post["json"]["data_source"], "simulator")
        self.assertEqual(post["headers"]["Authorization"], "Bearer device-key-0123456789")

    def test_duplicate_response_counts_as_sent(self):
        rec, _, result = self._run([FakeResponse(200, {"duplicate": True})])
        self.assertEqual(result["sent"], 1)

    def test_network_error_keeps_record_pending(self):
        rec, _, result = self._run([ConnectionError("down")])
        self.assertEqual(result["retry"], 1)
        stored = self.q.get(rec["capture_id"])
        self.assertEqual(stored["status"], "pending")
        self.assertGreater(stored["next_attempt_at"], time.time())

    def test_server_error_and_rate_limit_retry(self):
        for status in (500, 503, 429):
            rec, _, result = self._run([FakeResponse(status, {"code": "x"})], record())
            self.assertEqual(result["retry"], 1, status)
            self.assertEqual(self.q.get(rec["capture_id"])["status"], "pending")

    def test_auth_failure_keeps_data(self):
        rec, _, result = self._run([FakeResponse(401, {"code": "unauthorized"})])
        self.assertEqual(self.q.get(rec["capture_id"])["status"], "pending")

    def test_validation_rejection_is_dead_not_retried(self):
        rec, _, result = self._run([FakeResponse(422, {"code": "sensor_out_of_range"})])
        self.assertEqual(result["dead"], 1)
        self.assertEqual(self.q.get(rec["capture_id"])["status"], "dead")

    def test_image_payload_is_base64_data_url_and_released_after_success(self):
        img = os.path.join(self.dir, "c.jpg")
        with open(img, "wb") as f:
            f.write(b"\xff\xd8\xff" + b"\0" * 20)
        payload = build_payload(record(image_url=None, image_path=img))
        self.assertTrue(payload["image_base64"].startswith("data:image/jpeg;base64,"))
        self.assertNotIn("image_url", payload)
        rec, _, _ = self._run([FakeResponse(201, {})], record(image_url=None, image_path=img))
        self.assertFalse(os.path.exists(img))

    def test_null_readings_are_sent_as_null(self):
        payload = build_payload(record(temperature=None, humidity=None))
        self.assertIsNone(payload["temperature"])
        self.assertIsNone(payload["humidity"])

    def test_backoff_is_bounded(self):
        self.assertLessEqual(backoff_delay(50), 900)
        self.assertGreater(backoff_delay(0), 0)


class SimulatedAndHardwareTests(unittest.TestCase):
    def test_simulated_readings_stay_within_sensor_range(self):
        m = Microclimate(surge=True, seed=1)
        for _ in range(500):
            t, h = m.step()
            self.assertTrue(-40 <= t <= 85)
            self.assertTrue(0 <= h <= 100)
            self.assertTrue(0 <= m.pest_density() <= 1)

    def test_invalid_hardware_readings_become_none(self):
        self.assertEqual(hardware._validate(120.0, 50.0)[0], None)
        self.assertEqual(hardware._validate(20.0, -5)[1], None)
        self.assertEqual(hardware._validate(20.0, 55.0)[:2], (20.0, 55.0))

    def test_missing_hardware_libraries_raise_clear_error(self):
        try:
            import picamera2  # noqa: F401
            self.skipTest("picamera2 installed")
        except ImportError:
            with self.assertRaises(hardware.HardwareUnavailable):
                hardware.PiCamera()

    def test_no_sensor_returns_nulls(self):
        self.assertEqual(hardware.make_sensor("none").read()[:2], (None, None))


if __name__ == "__main__":
    unittest.main()
