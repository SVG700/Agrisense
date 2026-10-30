#!/usr/bin/env python3
"""
Agrisense AI - edge collector (Raspberry Pi 5) and simulator
=============================================================

Two explicit modes:

  simulator  MOCK readings (labelled data_source=simulator) + a synthetic trap
             image rendered by the backend. Runs on any computer.
  hardware   Real Pi camera (Picamera2) + real BME280/DHT22 readings
             (labelled data_source=hardware). A failed sensor read is sent as
             null - never invented.

Every capture goes into a durable SQLite queue first and is uploaded with a
unique capture_id, so network outages, crashes and retries never lose or
duplicate data.

Examples:
    python simulator.py --once
    python simulator.py --interval 3 --count 20
    python simulator.py --surge
    python simulator.py --image trap.jpg             # simulator readings + a real photo
    python simulator.py --mode hardware --probe      # test camera + sensor, no upload
    python simulator.py --mode hardware              # field collector (see deploy/)
    python simulator.py --status                     # queue statistics
    python simulator.py --flush-only                 # upload queued captures then exit

Configuration: CLI flags override environment variables (see .env.example).
"""

import argparse
import logging
import os
import shutil
import signal
import sys
import threading
import uuid
from datetime import datetime, timezone

try:
    import requests
except ImportError:
    sys.exit("Missing dependency: run `pip install -r requirements.txt` first.")

from agrisense_edge.queue_store import CaptureQueue
from agrisense_edge.simulated import Microclimate, SimulatedBattery, mock_trap_url
from agrisense_edge.uploader import Uploader

DEMO_DEVICE_ID = "11111111-1111-4111-8111-111111111111"
log = logging.getLogger("agrisense")


# ----------------------------------------------------------------- config
def load_env_file(path):
    """Minimal KEY=VALUE loader (no extra dependency). Existing env vars win."""
    if not path or not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            # Same semantics as systemd EnvironmentFile: no inline comments
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def env(name, default=None):
    value = os.environ.get(name, "")
    return value if value != "" else default


def parse_args(argv=None):
    pre = argparse.ArgumentParser(add_help=False)
    pre.add_argument("--env-file", default=".env")
    known, _ = pre.parse_known_args(argv)
    load_env_file(known.env_file)

    p = argparse.ArgumentParser(description="Agrisense AI edge collector / simulator", parents=[pre])
    p.add_argument("--mode", choices=["simulator", "hardware"], default=env("AGRISENSE_MODE", "simulator"))
    p.add_argument("--url", default=env("AGRISENSE_API_URL", "http://localhost:4000"), help="Backend base URL")
    p.add_argument("--device-id", default=env("AGRISENSE_DEVICE_ID", DEMO_DEVICE_ID))
    p.add_argument("--device-key", default=env("AGRISENSE_DEVICE_KEY"), help="Device API key (prefer the env var)")
    p.add_argument("--interval", type=float, default=float(env("AGRISENSE_INTERVAL", "5")), help="Seconds between captures")
    p.add_argument("--count", type=int, default=0, help="Number of captures (0 = forever)")
    p.add_argument("--once", action="store_true", help="One capture, upload, exit")
    p.add_argument("--data-dir", default=env("AGRISENSE_DATA_DIR", "./edge-data"), help="Queue DB + image directory")
    p.add_argument("--max-pending", type=int, default=int(env("AGRISENSE_MAX_PENDING", "1000")))
    p.add_argument("--keep-sent-hours", type=float, default=float(env("AGRISENSE_KEEP_SENT_HOURS", "24")))
    p.add_argument("--timeout", type=float, default=float(env("AGRISENSE_HTTP_TIMEOUT", "60")))
    p.add_argument("--status", action="store_true", help="Print queue statistics and exit")
    p.add_argument("--flush-only", action="store_true", help="Upload queued captures and exit")
    p.add_argument("--log-level", default=env("AGRISENSE_LOG_LEVEL", "INFO"))
    # simulator mode
    p.add_argument("--image", help="[simulator] upload this real photo instead of a synthetic trap")
    p.add_argument("--surge", action="store_true", help="[simulator] hot, humid outbreak scenario")
    p.add_argument("--report-battery", action="store_true", help="[simulator] include a simulated draining battery")
    # hardware mode
    p.add_argument("--sensor", default=env("AGRISENSE_SENSOR", "bme280"), help="[hardware] bme280 | dht22 | none")
    p.add_argument("--dht-pin", default=env("AGRISENSE_DHT_PIN", "D4"))
    p.add_argument("--i2c-bus", type=int, default=int(env("AGRISENSE_I2C_BUS", "1")))
    p.add_argument("--bme280-address", type=lambda s: int(s, 0), default=int(env("AGRISENSE_BME280_ADDRESS", "0x76"), 0))
    p.add_argument("--resolution", default=env("AGRISENSE_RESOLUTION", "1920x1080"), help="[hardware] WxH")
    p.add_argument("--probe", action="store_true", help="[hardware] test camera + sensor once, no upload")
    args = p.parse_args(argv)
    if args.interval < 1:
        p.error("--interval must be >= 1 second")
    try:
        uuid.UUID(args.device_id)
    except ValueError:
        p.error("--device-id must be a UUID")
    return args


def utc_now():
    return datetime.now(timezone.utc).isoformat()


# ----------------------------------------------------------------- sources
class SimulatorSource:
    data_source = "simulator"

    def __init__(self, args):
        self.args = args
        self.climate = Microclimate(surge=args.surge)
        self.battery = SimulatedBattery() if args.report_battery else None
        self.image_dir = os.path.join(args.data_dir, "images")

    def capture(self):
        cid = str(uuid.uuid4())
        temperature, humidity = self.climate.step()
        rec = {
            "capture_id": cid,
            "device_id": self.args.device_id,
            "captured_at": utc_now(),
            "data_source": self.data_source,
            "temperature": temperature,
            "humidity": humidity,
            "battery_level": self.battery.read() if self.battery else None,
        }
        if self.args.image:
            # Copy so the queue can delete its copy after upload without touching the user's file
            os.makedirs(self.image_dir, exist_ok=True)
            ext = os.path.splitext(self.args.image)[1].lower() or ".jpg"
            rec["image_path"] = shutil.copyfile(self.args.image, os.path.join(self.image_dir, cid + ext))
        else:
            rec["image_url"] = mock_trap_url(self.args.url, self.climate.pest_density())
        return rec

    def close(self):
        pass


class HardwareSource:
    data_source = "hardware"

    def __init__(self, args):
        from agrisense_edge.hardware import PiCamera, make_sensor  # lazy: optional deps

        self.args = args
        width, height = (int(v) for v in args.resolution.lower().split("x"))
        self.sensor = make_sensor(args.sensor, args.dht_pin, args.i2c_bus, args.bme280_address)
        self.camera = PiCamera(width, height)
        self.image_dir = os.path.join(args.data_dir, "images")

    def capture(self):
        cid = str(uuid.uuid4())
        captured_at = utc_now()
        temperature, humidity, sensor_error = self.sensor.read()
        if sensor_error:
            log.warning("sensor: %s (sending null readings)", sensor_error)
        image_path = None
        try:
            image_path = self.camera.capture(os.path.join(self.image_dir, cid + ".jpg"))
        except Exception as exc:  # noqa: BLE001 - keep collecting sensor data if the camera hiccups
            log.error("camera capture failed: %s", exc)
        if image_path is None and temperature is None and humidity is None:
            raise RuntimeError("nothing captured (camera and sensor both failed)")
        return {
            "capture_id": cid,
            "device_id": self.args.device_id,
            "captured_at": captured_at,
            "data_source": self.data_source,
            "temperature": temperature,
            "humidity": humidity,
            "sensor_error": sensor_error,
            "battery_level": None,  # no battery sensor wired; never fabricated
            "image_path": image_path,
        }

    def close(self):
        self.camera.close()


# ----------------------------------------------------------------- main loop
def run(args):
    os.makedirs(args.data_dir, exist_ok=True)
    queue = CaptureQueue(os.path.join(args.data_dir, "queue.db"), args.max_pending, args.keep_sent_hours)

    if args.status:
        print(queue.stats())
        queue.close()
        return 0

    if args.mode == "hardware" and args.probe:
        queue.close()
        return probe(args)

    uploader = Uploader(requests.Session(), args.url, args.device_key, args.timeout)

    # Startup health check: informative only - the collector must work offline
    health = uploader.health()
    if health:
        log.info("backend %s reachable (store=%s, device_auth=%s)", args.url, health.get("store"),
                 (health.get("auth") or {}).get("device"))
        if (health.get("auth") or {}).get("device") == "required" and not args.device_key:
            log.error("backend requires a device key but AGRISENSE_DEVICE_KEY is not set")
    else:
        log.warning("backend %s not reachable - captures will be queued in %s", args.url, args.data_dir)

    if args.flush_only:
        total = {"sent": 0, "retry": 0, "dead": 0}
        while True:
            res = uploader.flush(queue)
            for k in total:
                total[k] += res[k]
            if res["sent"] == 0:
                break
        log.info("flush complete: %s, queue now %s", total, queue.stats())
        queue.close()
        return 0

    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())

    try:
        source = SimulatorSource(args) if args.mode == "simulator" else HardwareSource(args)
    except Exception as exc:  # noqa: BLE001 - HardwareUnavailable or bad config
        log.error("cannot start %s mode: %s", args.mode, exc)
        queue.close()
        return 2

    log.info("mode=%s device=%s interval=%ss data_dir=%s queue=%s", args.mode, args.device_id,
             args.interval, args.data_dir, queue.stats())
    total = 1 if args.once else args.count
    captured = 0
    try:
        while not stop.is_set() and (total == 0 or captured < total):
            try:
                rec = source.capture()
                queue.enqueue(rec)
                captured += 1
                log.info("captured %s T=%s RH=%s (%s)", rec["capture_id"], rec["temperature"], rec["humidity"],
                         source.data_source)
            except Exception as exc:  # noqa: BLE001 - one bad capture must not kill the service
                log.error("capture failed: %s", exc)
            uploader.flush(queue)
            pruned = queue.prune()
            if pruned["overflow"]:
                log.warning("queue full: dropped %d oldest pending captures", pruned["overflow"])
            if total == 0 or captured < total:
                stop.wait(args.interval)
    finally:
        source.close()
        log.info("stopping; queue %s", queue.stats())
        queue.close()
    return 0


def probe(args):
    """Hardware self-test: one photo + one sensor reading, printed, not uploaded."""
    from agrisense_edge.hardware import HardwareUnavailable, PiCamera, make_sensor

    ok = True
    try:
        t, h, err = make_sensor(args.sensor, args.dht_pin, args.i2c_bus, args.bme280_address).read()
        print("sensor %s: temperature=%s humidity=%s%s" % (args.sensor, t, h, " error=%s" % err if err else ""))
        if args.sensor.lower() != "none":
            ok = ok and err is None
    except HardwareUnavailable as exc:
        print("sensor FAILED: %s" % exc)
        ok = False
    try:
        width, height = (int(v) for v in args.resolution.lower().split("x"))
        cam = PiCamera(width, height)
        path = cam.capture(os.path.join(args.data_dir, "probe.jpg"))
        cam.close()
        print("camera OK: %s (%d bytes)" % (path, os.path.getsize(path)))
    except HardwareUnavailable as exc:
        print("camera FAILED: %s" % exc)
        ok = False
    return 0 if ok else 1


def main(argv=None):
    args = parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
