"""
Trap-box agent tests: control polling, switches, commands and Live Vision frames,
with a fake backend session and a fake camera (no hardware or network needed).

    cd edge-simulator
    python -m unittest discover -s tests -v
"""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agrisense_edge.agent import Agent, Outputs  # noqa: E402

DEVICE = "11111111-1111-4111-8111-111111111111"

try:
    import cv2  # noqa: F401
    import numpy as np

    HAVE_CV = True
except ImportError:  # the laptop may not have OpenCV; the Pi does
    HAVE_CV = False


class Res:
    def __init__(self, data=None, status=200):
        self._data = data or {}
        self.status_code = status

    def json(self):
        return self._data

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError("HTTP %d" % self.status_code)


class FakeSession:
    """Serves one pending-commands payload, records every POST."""

    def __init__(self, pending):
        self.pending = pending
        self.posts = []

    def get(self, url, **kw):
        return Res(self.pending)

    def post(self, url, json=None, **kw):
        self.posts.append((url, json, kw.get("headers")))
        return Res({"ok": True}, 201)


class FakeCamera:
    def __init__(self):
        self.stills = 0
        self.restarts = 0

    def still(self, path):
        self.stills += 1
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(b"\xff\xd8\xff\xe0" + b"0" * 64)
        return path

    def restart(self):
        self.restarts += 1

    def frame(self):
        img = np.zeros((972, 1296, 3), np.uint8)
        img[:] = (40, 220, 240)  # yellow card (BGR)
        for i in range(12):  # dark insects on it
            cv2.circle(img, (100 + i * 90, 300 + (i % 3) * 150), 7, (30, 30, 30), -1)
        return img

    def close(self):
        pass


class FakeQueue:
    def __init__(self):
        self.items = []

    def enqueue(self, rec):
        self.items.append(rec)


class FakeUploader:
    def flush(self, queue):
        return {"sent": len(queue.items), "retry": 0, "dead": 0}


def agent(pending, **kw):
    session = FakeSession(pending)
    a = Agent(session=session, api_url="http://backend:4000/", device_id=DEVICE, device_key="k" * 24, queue=FakeQueue(),
              uploader=FakeUploader(), camera=FakeCamera(), data_dir=tempfile.mkdtemp(), **kw)
    return a, session


class AgentTest(unittest.TestCase):
    def test_switches_are_applied_and_confirmed(self):
        a, s = agent({"switches": {"fan": True, "trap_light": False}, "commands": []})
        a.poll_once()
        self.assertEqual(a.outputs.state, {"fan": True, "trap_light": False})
        url, body, headers = s.posts[-1]
        self.assertTrue(url.endswith("/api/devices/%s/commands/ack" % DEVICE))
        self.assertEqual(body["switches"], {"fan": True, "trap_light": False})
        self.assertEqual(headers, {"X-Device-Key": "k" * 24})

    def test_capture_now_takes_a_photo_and_acks_done(self):
        a, s = agent({"switches": {}, "commands": [{"id": "c1", "command": "capture_now"}]})
        a.poll_once()
        self.assertEqual(a.camera.stills, 1)
        self.assertEqual(a.queue.items[0]["data_source"], "hardware")
        self.assertIsNone(a.queue.items[0]["battery_level"])  # never fabricated
        ack = s.posts[-1][1]
        self.assertEqual(ack["command_id"], "c1")
        self.assertTrue(ack["ok"])
        self.assertIn("sent", ack["message"])

    def test_stream_start_stop_and_restart_camera(self):
        a, s = agent({"switches": {}, "commands": [{"id": "a", "command": "start_stream"}, {"id": "b", "command": "restart_camera"}]})
        a.poll_once()
        self.assertTrue(a.streaming.is_set())
        self.assertEqual(a.camera.restarts, 1)
        a.run_command({"id": "c", "command": "stop_stream"})
        self.assertFalse(a.streaming.is_set())
        self.assertTrue(all(p[1]["ok"] for p in s.posts))

    def test_unknown_command_is_reported_not_ignored(self):
        a, s = agent({"switches": {}, "commands": [{"id": "x", "command": "launch_rocket"}]})
        a.poll_once()
        self.assertFalse(s.posts[-1][1]["ok"])

    def test_outputs_without_pins_only_remember(self):
        o = Outputs({"fan": None, "trap_light": None})
        o.set("fan", True)
        self.assertEqual(o.state["fan"], True)
        self.assertEqual(o.devices, {})

    @unittest.skipUnless(HAVE_CV, "OpenCV not installed here (it is on the Pi)")
    def test_live_vision_frame_finds_the_card_and_the_insects(self):
        a, s = agent({})
        a.send_frame()
        url, body, _ = s.posts[-1]
        self.assertTrue(url.endswith("/vision/frame"))
        self.assertEqual([st["name"] for st in body["stages"]], ["Yellow-card mask", "Card only", "Insect blobs"])
        self.assertEqual(len(body["boxes"]), 12)
        self.assertNotIn("(no yellow card in view)", body["pipeline"])
        self.assertEqual((body["width"], body["height"]), (960, 720))


if __name__ == "__main__":
    unittest.main()
