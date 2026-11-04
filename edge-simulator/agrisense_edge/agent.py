"""
Trap-box agent for the Raspberry Pi: the one program that owns the camera.

  capture loop   a trap photo every `interval` seconds -> durable queue -> POST /api/telemetry
  control loop   every `poll` seconds GET /api/devices/<id>/commands/pending:
                   switches  fan / trap_light -> GPIO pins (or logged if no pin is set), confirmed back
                   commands  capture_now, restart_camera, reboot, start_stream, stop_stream
  stream loop    while streaming: Picamera2 frame -> OpenCV pipeline (vision.py) ->
                 POST /api/devices/<id>/vision/frame (~1-2 frames/s); stops by itself
                 after `stream_minutes` so a forgotten stream does not run all day

Everything is best effort: a failed poll, frame or upload is logged and retried;
the capture queue keeps working offline.
"""
import logging
import os
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Dict, Optional

log = logging.getLogger("agrisense.agent")

SWITCHES = ("fan", "trap_light")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Outputs:
    """Fan / trap light on GPIO pins via gpiozero; without a pin the state is just remembered."""

    def __init__(self, pins: Dict[str, Optional[int]]):
        self.state = {k: None for k in SWITCHES}
        self.devices = {}
        for name, pin in pins.items():
            if pin is None:
                continue
            try:
                from gpiozero import OutputDevice  # type: ignore

                self.devices[name] = OutputDevice(pin, active_high=True, initial_value=False)
                log.info("%s on GPIO%s", name, pin)
            except Exception as exc:  # noqa: BLE001
                log.error("%s: GPIO%s unavailable (%s) - state will only be logged", name, pin, exc)

    def set(self, name: str, on: bool) -> None:
        if self.state.get(name) == on:
            return
        dev = self.devices.get(name)
        if dev is not None:
            dev.on() if on else dev.off()
        self.state[name] = on
        log.info("%s -> %s%s", name, "ON" if on else "OFF", "" if dev is not None else " (no pin wired, logged only)")


class Camera:
    """Picamera2 at the full-view binned mode; frames for the stream, JPEG files for captures."""

    def __init__(self, size=(1296, 972)):
        self.size = size
        self.lock = threading.Lock()
        self.cam = None
        self.open()

    def open(self):
        from picamera2 import Picamera2  # type: ignore

        cam = Picamera2()
        # RGB888 in Picamera2 is BGR byte order in memory - what OpenCV expects
        cam.configure(cam.create_still_configuration(main={"size": self.size, "format": "RGB888"}))
        cam.start()
        time.sleep(1.5)  # auto-exposure / white balance
        self.cam = cam
        log.info("camera ready at %dx%d", *self.size)

    def restart(self):
        with self.lock:
            self.close()
            self.open()

    def frame(self):
        with self.lock:
            return self.cam.capture_array("main")

    def still(self, path: str) -> str:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        tmp = path + ".part"
        with self.lock:
            self.cam.capture_file(tmp, format="jpeg")
        os.replace(tmp, path)
        return path

    def close(self):
        try:
            if self.cam:
                self.cam.stop()
                self.cam.close()
        except Exception:  # noqa: BLE001
            pass
        self.cam = None


class Agent:
    def __init__(self, *, session, api_url, device_id, device_key, queue, uploader, camera, sensor=None, outputs=None,
                 interval=300.0, poll=3.0, stream_fps=1.5, stream_minutes=10.0, data_dir="./edge-data", timeout=15.0):
        self.s = session
        self.api = api_url.rstrip("/")
        self.device_id = device_id
        self.headers = {"X-Device-Key": device_key} if device_key else {}
        self.queue = queue
        self.uploader = uploader
        self.camera = camera
        self.sensor = sensor
        self.outputs = outputs or Outputs({})
        self.interval = interval
        self.poll = poll
        self.stream_period = 1.0 / max(0.2, stream_fps)
        self.stream_minutes = stream_minutes
        self.image_dir = os.path.join(data_dir, "images")
        self.timeout = timeout
        self.stop = threading.Event()
        self.streaming = threading.Event()
        self.stream_until = 0.0
        self.capture_lock = threading.Lock()

    # ------------------------------------------------------------- captures
    def capture(self) -> Dict:
        """One trap photo (+ sensor) into the queue, then try to upload. Returns the record."""
        with self.capture_lock:
            cid = str(uuid.uuid4())
            temperature = humidity = None
            sensor_error = None
            if self.sensor is not None:
                temperature, humidity, sensor_error = self.sensor.read()
            path = self.camera.still(os.path.join(self.image_dir, cid + ".jpg"))
            rec = {
                "capture_id": cid,
                "device_id": self.device_id,
                "captured_at": utc_now(),
                "data_source": "hardware",
                "temperature": temperature,
                "humidity": humidity,
                "sensor_error": sensor_error,
                "battery_level": None,  # no battery sensor wired; never fabricated
                "image_path": path,
            }
            self.queue.enqueue(rec)
            res = self.uploader.flush(self.queue)
            log.info("captured %s -> upload %s", cid, res)
            return rec

    def capture_loop(self):
        while not self.stop.is_set():
            try:
                self.capture()
            except Exception as exc:  # noqa: BLE001
                log.error("scheduled capture failed: %s", exc)
            self.stop.wait(self.interval)

    # ------------------------------------------------------------- controls
    def _url(self, path):
        return "%s/api/devices/%s%s" % (self.api, self.device_id, path)

    def ack(self, command_id=None, ok=True, message=None):
        body = {"ok": ok, "switches": {k: v for k, v in self.outputs.state.items() if v is not None}}
        if command_id:
            body["command_id"] = command_id
        if message:
            body["message"] = message[:200]
        self.s.post(self._url("/commands/ack"), json=body, headers=self.headers, timeout=self.timeout)

    def run_command(self, cmd: Dict):
        name, cid = cmd.get("command"), cmd.get("id")
        log.info("command %s", name)
        try:
            if name == "capture_now":
                rec = self.capture()
                self.ack(cid, True, "photo %s sent" % rec["capture_id"][:8])
            elif name == "restart_camera":
                self.camera.restart()
                self.ack(cid, True, "camera restarted")
            elif name == "start_stream":
                self.stream_until = time.time() + self.stream_minutes * 60
                self.streaming.set()
                self.ack(cid, True, "streaming for %d min" % self.stream_minutes)
            elif name == "stop_stream":
                self.streaming.clear()
                self.ack(cid, True, "stream stopped")
            elif name == "reboot":
                # Needs passwordless sudo for reboot; otherwise report it instead of pretending
                r = subprocess.run(["sudo", "-n", "/sbin/reboot"], capture_output=True, text=True, timeout=10)
                if r.returncode != 0:
                    self.ack(cid, False, "reboot not allowed (needs passwordless sudo for /sbin/reboot)")
                else:
                    self.ack(cid, True, "rebooting")
            else:
                self.ack(cid, False, "unknown command %s" % name)
        except Exception as exc:  # noqa: BLE001
            log.error("command %s failed: %s", name, exc)
            try:
                self.ack(cid, False, str(exc))
            except Exception:  # noqa: BLE001
                pass

    def poll_once(self):
        r = self.s.get(self._url("/commands/pending"), headers=self.headers, timeout=self.timeout)
        r.raise_for_status()
        data = r.json()
        for name, on in (data.get("switches") or {}).items():
            if name in SWITCHES:
                self.outputs.set(name, bool(on))
        cmds = data.get("commands") or []
        if not cmds:
            self.ack()  # confirms the switch states the Pi has applied
        for cmd in cmds:
            self.run_command(cmd)

    def control_loop(self):
        failures = 0
        while not self.stop.is_set():
            try:
                self.poll_once()
                failures = 0
            except Exception as exc:  # noqa: BLE001
                failures += 1
                if failures in (1, 5) or failures % 20 == 0:
                    log.warning("control poll failed (%d): %s", failures, exc)
            self.stop.wait(self.poll if failures == 0 else min(30, self.poll * (failures + 1)))

    # ------------------------------------------------------------- live vision
    def send_frame(self) -> float:
        from agrisense_edge import vision

        started = time.time()
        out = vision.process(self.camera.frame())
        body = {
            "image_base64": vision.jpeg_b64(out["frame"]),
            "stages": [{"name": n, "image_base64": vision.jpeg_b64(img, 60)} for n, img in out["stages"]],
            "boxes": out["boxes"],
            "width": out["size"][0],
            "height": out["size"][1],
            "pipeline": vision.PIPELINE + ([] if out["card_found"] else ["(no yellow card in view)"]),
        }
        body["fps"] = round(1.0 / max(self.stream_period, time.time() - started), 2)
        r = self.s.post(self._url("/vision/frame"), json=body, headers=self.headers, timeout=self.timeout)
        r.raise_for_status()
        return time.time() - started

    def stream_loop(self):
        while not self.stop.is_set():
            if not self.streaming.wait(1.0):
                continue
            if time.time() > self.stream_until:
                log.info("stream auto-stopped after %d min", self.stream_minutes)
                self.streaming.clear()
                continue
            try:
                took = self.send_frame()
                self.stop.wait(max(0.0, self.stream_period - took))
            except Exception as exc:  # noqa: BLE001
                log.warning("frame failed: %s", exc)
                self.stop.wait(2.0)

    # ------------------------------------------------------------- run
    def run(self, stream_on_start=False):
        if stream_on_start:
            self.stream_until = time.time() + self.stream_minutes * 60
            self.streaming.set()
        threads = [threading.Thread(target=fn, name=fn.__name__, daemon=True) for fn in (self.control_loop, self.stream_loop, self.capture_loop)]
        for t in threads:
            t.start()
        log.info("agent running: device=%s poll=%ss interval=%ss stream=%s", self.device_id, self.poll, self.interval, self.streaming.is_set())
        try:
            while not self.stop.is_set():
                self.stop.wait(1.0)
        finally:
            self.streaming.clear()
            for t in threads:
                t.join(timeout=10)
            self.camera.close()
