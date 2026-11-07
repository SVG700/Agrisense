#!/usr/bin/env python3
"""
AgriSense trap-box agent (Raspberry Pi): scheduled captures + dashboard
controls (fan, trap light, Capture now, Restart camera, Reboot) + the Live
Vision OpenCV stream. See agrisense_edge/agent.py.

    python pi_agent.py                      # run (settings from .env / environment)
    python pi_agent.py --stream             # start streaming Live Vision straight away
    python pi_agent.py --frame-test         # one OpenCV frame to the dashboard, then exit

Settings (env or flags): AGRISENSE_BASE_URL, AGRISENSE_DEVICE_ID, AGRISENSE_DEVICE_KEY,
AGRISENSE_INTERVAL (s), AGRISENSE_POLL (s), AGRISENSE_STREAM_FPS, AGRISENSE_STREAM_MINUTES,
AGRISENSE_FAN_PIN / AGRISENSE_LIGHT_PIN (BCM numbers, blank = not wired), AGRISENSE_SENSOR.
"""
import argparse
import logging
import os
import signal
import sys

import requests

from agrisense_edge.agent import Agent, Camera, Outputs
from agrisense_edge.base_url import normalize, resolve_base_url
from agrisense_edge.queue_store import CaptureQueue
from agrisense_edge.uploader import Uploader
from simulator import load_env_file


def env(name, default=None):
    v = os.environ.get(name)
    return default if v is None or v == "" else v


def pin(v):
    return int(v) if v not in (None, "", "none") else None


def main(argv=None):
    pre = argparse.ArgumentParser(add_help=False)
    pre.add_argument("--env-file", default=".env")
    known, _ = pre.parse_known_args(argv)
    load_env_file(known.env_file)

    p = argparse.ArgumentParser(description="AgriSense trap-box agent", parents=[pre])
    p.add_argument("--url", default=None, help="AgriSense base URL (default: AGRISENSE_BASE_URL)")
    p.add_argument("--device-id", default=env("AGRISENSE_DEVICE_ID"))
    p.add_argument("--device-key", default=env("AGRISENSE_DEVICE_KEY"))
    p.add_argument("--interval", type=float, default=float(env("AGRISENSE_INTERVAL", "300")))
    p.add_argument("--poll", type=float, default=float(env("AGRISENSE_POLL", "3")))
    p.add_argument("--stream-fps", type=float, default=float(env("AGRISENSE_STREAM_FPS", "1.5")))
    p.add_argument("--stream-minutes", type=float, default=float(env("AGRISENSE_STREAM_MINUTES", "10")))
    p.add_argument("--fan-pin", type=pin, default=pin(env("AGRISENSE_FAN_PIN")))
    p.add_argument("--light-pin", type=pin, default=pin(env("AGRISENSE_LIGHT_PIN")))
    p.add_argument("--sensor", default=env("AGRISENSE_SENSOR", "none"))
    p.add_argument("--data-dir", default=env("AGRISENSE_DATA_DIR", "./edge-data"))
    p.add_argument("--stream", action="store_true", help="start streaming Live Vision immediately")
    p.add_argument("--frame-test", action="store_true", help="send one Live Vision frame and exit")
    p.add_argument("--log-level", default=env("AGRISENSE_LOG_LEVEL", "INFO"))
    args = p.parse_args(argv)
    args.url = normalize(args.url) if args.url else resolve_base_url()
    logging.basicConfig(level=args.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    log = logging.getLogger("agrisense.pi")
    log.info("AgriSense base URL: %s (API at %s/api)", args.url, args.url)
    if not args.device_id:
        p.error("AGRISENSE_DEVICE_ID is required")

    sensor = None
    if args.sensor != "none":
        from agrisense_edge.hardware import make_sensor

        sensor = make_sensor(args.sensor)

    os.makedirs(args.data_dir, exist_ok=True)
    queue = CaptureQueue(os.path.join(args.data_dir, "queue.db"), 1000, 24)
    session = requests.Session()
    agent = Agent(
        session=session,
        api_url=args.url,
        device_id=args.device_id,
        device_key=args.device_key,
        queue=queue,
        uploader=Uploader(session, args.url, args.device_key, 60),
        camera=Camera(),
        sensor=sensor,
        outputs=Outputs({"fan": args.fan_pin, "trap_light": args.light_pin}),
        interval=args.interval,
        poll=args.poll,
        stream_fps=args.stream_fps,
        stream_minutes=args.stream_minutes,
        data_dir=args.data_dir,
    )
    if args.frame_test:
        took = agent.send_frame()
        log.info("frame sent in %.2fs", took)
        agent.camera.close()
        return 0

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: agent.stop.set())
    agent.run(stream_on_start=args.stream)
    queue.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
