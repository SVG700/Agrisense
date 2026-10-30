#!/usr/bin/env python3
"""
Agrisense AI - demo seed for the Pest Surveillance Map
======================================================

Generates SIMULATED sticky-trap history for 18 traps on farms around
Bengaluru Rural and Kolar districts (Karnataka): a whitefly outbreak that
starts near Malur and spreads outward over 14 days, with natural enemies
(Encarsia / ladybirds) building up a few days behind the pest front.

Everything produced here is fake and marked as such:
  * every trap name starts with "SIM ·"
  * the payload carries "simulated": true
  * the backend stores the traps with simulated=true and the map shows a
    "Simulated data" badge

The script only sends raw daily counts; the backend computes the
SPRAY / BIOCONTROL / WAIT decision with its own rule (single source of truth).

Usage (stdlib only, Python 3.9+):
    python demo/seed.py --dry-run                 # print the generated data, send nothing
    python demo/seed.py --out map-seed.json       # write the payload to a file
    python demo/seed.py                           # POST to http://localhost:4000 (needs the admin key)
    python demo/seed.py --reset                   # delete previous simulated traps first
    python demo/seed.py --remove                  # only delete simulated traps

Admin key: --admin-key, or the AGRISENSE_ADMIN_KEY / ADMIN_API_KEY environment
variable (leave unset when the backend runs in demo mode without keys).
"""

import argparse
import json
import math
import os
import random
import sys
import uuid
from datetime import date, timedelta
from urllib import error, request

NAMESPACE = uuid.UUID("6f1c2d3e-8a4b-4c5d-9e0f-a1b2c3d4e5f6")  # stable trap ids -> idempotent re-seeding

# Farm-level coordinates (WGS84), offset 1-3 km from the town centres into
# cropland. Crops are whitefly hosts typical of the area (Kolar is a major
# tomato belt; chilli, brinjal and beans are common around Hoskote/Devanahalli).
TRAPS = [
    # (name, district, crop, latitude, longitude)
    ("Malur", "Kolar", "tomato", 13.0156, 77.9264),
    ("Tekal", "Kolar", "tomato", 13.0712, 78.0034),
    ("Lakkur", "Kolar", "chilli", 13.1051, 78.0207),
    ("Narasapura", "Kolar", "tomato", 13.1488, 77.9617),
    ("Vemagal", "Kolar", "brinjal", 13.1926, 78.0861),
    ("Kolar", "Kolar", "tomato", 13.1512, 78.1458),
    ("Bangarapet", "Kolar", "tomato", 12.9837, 78.1951),
    ("Srinivaspur", "Kolar", "tomato", 13.3241, 78.2286),
    ("Mulbagal", "Kolar", "tomato", 13.1782, 78.3755),
    ("Hoskote", "Bengaluru Rural", "chilli", 13.0836, 77.8137),
    ("Sulibele", "Bengaluru Rural", "beans", 13.1769, 77.8221),
    ("Vijayapura", "Bengaluru Rural", "tomato", 13.3077, 77.8166),
    ("Devanahalli", "Bengaluru Rural", "brinjal", 13.2573, 77.6995),
    ("Avathi", "Bengaluru Rural", "chilli", 13.2856, 77.6324),
    ("Doddaballapura", "Bengaluru Rural", "tomato", 13.3062, 77.5214),
    ("Thubagere", "Bengaluru Rural", "beans", 13.3864, 77.5615),
    ("Nelamangala", "Bengaluru Rural", "tomato", 13.1118, 77.3772),
    ("Thyamagondlu", "Bengaluru Rural", "brinjal", 13.2163, 77.3108),
]

OUTBREAK_ORIGIN = (13.0300, 77.9000)  # between Malur and Hoskote
OUTBREAK_START_DAY = 1.5              # day 0 is quiet everywhere
FRONT_SPEED_KM_PER_DAY = 4.8          # farthest farms (~65 km) are only reached at the end of the window
FRONT_SHARPNESS_DAYS = 1.0            # how quickly a farm goes from baseline to peak
CROP_SUSCEPTIBILITY = {"tomato": 1.15, "chilli": 1.0, "brinjal": 0.95, "beans": 0.8}


def haversine_km(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


def logistic(x):
    return 1.0 / (1.0 + math.exp(-x))


def trap_id(name):
    return str(uuid.uuid5(NAMESPACE, "agrisense-sim-trap:" + name))


def generate(days=14, end=None, seed=42):
    """Pure function: returns the seed payload (no I/O). Deterministic for a given seed."""
    if not 7 <= days <= 60:
        raise ValueError("days must be between 7 and 60")
    rng = random.Random(seed)
    end = end or date.today()
    start = end - timedelta(days=days - 1)

    traps, observations = [], []
    for name, district, crop, lat, lon in TRAPS:
        tid = trap_id(name)
        traps.append({
            "id": tid,
            "name": "SIM · %s %s" % (name, crop),
            "latitude": lat,
            "longitude": lon,
            "district": district,
            "crop": crop,
            "simulated": True,
        })
        distance = haversine_km((lat, lon), OUTBREAK_ORIGIN)
        arrival = OUTBREAK_START_DAY + distance / FRONT_SPEED_KM_PER_DAY  # day the whitefly front reaches this farm
        peak = 85 * CROP_SUSCEPTIBILITY[crop] * rng.uniform(0.85, 1.15)
        baseline = rng.uniform(2, 7)
        enemy_lag = rng.uniform(3.0, 4.5)                     # natural enemies trail the pest front

        for d in range(days):
            whitefly = baseline + peak * logistic((d - arrival) / FRONT_SHARPNESS_DAYS)
            whitefly *= rng.uniform(0.88, 1.12)               # day-to-day trap noise
            aphids = rng.uniform(0, 6)
            enemies = 0.32 * whitefly * logistic((d - arrival - enemy_lag) / 1.1) + rng.uniform(0, 1.5)
            pests = int(round(whitefly + aphids))
            observations.append({
                "trap_id": tid,
                "date": (start + timedelta(days=d)).isoformat(),
                "pest_count": max(0, pests),
                "predator_count": max(0, int(round(enemies))),
                "dominant_pest": "whitefly" if whitefly >= aphids else "aphid",
                "simulated": True,
            })

    return {
        "simulated": True,
        "description": "Simulated whitefly outbreak, Bengaluru Rural + Kolar, %d days from %s" % (days, start.isoformat()),
        "traps": traps,
        "observations": observations,
    }


def call(method, url, admin_key=None, body=None, timeout=30):
    headers = {"Content-Type": "application/json"}
    if admin_key:
        headers["Authorization"] = "Bearer " + admin_key
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = request.Request(url, data=data, method=method, headers=headers)
    try:
        with request.urlopen(req, timeout=timeout) as res:
            return res.status, json.loads(res.read().decode("utf-8") or "{}")
    except error.HTTPError as exc:
        try:
            payload = json.loads(exc.read().decode("utf-8") or "{}")
        except ValueError:
            payload = {}
        return exc.code, payload


def main(argv=None):
    p = argparse.ArgumentParser(description="Seed SIMULATED trap history for the Pest Surveillance Map")
    p.add_argument("--url", default=os.environ.get("AGRISENSE_API_URL", "http://localhost:4000"))
    p.add_argument("--admin-key", default=os.environ.get("AGRISENSE_ADMIN_KEY") or os.environ.get("ADMIN_API_KEY"))
    p.add_argument("--days", type=int, default=14)
    p.add_argument("--seed", type=int, default=42, help="random seed (same seed = same data)")
    p.add_argument("--dry-run", action="store_true", help="print a summary + first rows, send nothing")
    p.add_argument("--out", help="write the JSON payload to this file and exit")
    p.add_argument("--reset", action="store_true", help="delete existing simulated traps before seeding")
    p.add_argument("--remove", action="store_true", help="only delete simulated traps, then exit")
    args = p.parse_args(argv)
    base = args.url.rstrip("/")

    if args.remove:
        status, body = call("DELETE", base + "/api/admin/map-seed", args.admin_key)
        print("HTTP %s %s" % (status, body))
        return 0 if status == 200 else 1

    payload = generate(days=args.days, seed=args.seed)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        print("wrote %d traps / %d observations to %s" % (len(payload["traps"]), len(payload["observations"]), args.out))
        return 0
    if args.dry_run:
        print(payload["description"])
        for t in payload["traps"]:
            print("  %-34s %9.4f %9.4f" % (t["name"], t["latitude"], t["longitude"]))
        print("first observations:", json.dumps(payload["observations"][:3], indent=2))
        return 0

    if args.reset:
        status, body = call("DELETE", base + "/api/admin/map-seed", args.admin_key)
        if status != 200:
            print("reset failed: HTTP %s %s" % (status, body.get("error", body)))
            return 1
        print("removed %s simulated traps" % body.get("removed_traps"))

    status, body = call("POST", base + "/api/admin/map-seed", args.admin_key, payload)
    if status != 201:
        print("seed failed: HTTP %s %s (%s)" % (status, body.get("error", body), body.get("code", "")))
        if status in (401, 403):
            print("hint: pass --admin-key or set AGRISENSE_ADMIN_KEY to the backend's ADMIN_API_KEY")
        if status == 503:
            print("hint: apply supabase/schema.sql (v3) so trap_daily_observations exists")
        return 1
    print("seeded %s simulated traps, %s daily observations. decisions: %s" % (body["traps"], body["observations"], body["decisions"]))
    print("open the dashboard -> Surveillance Map")
    return 0


if __name__ == "__main__":
    sys.exit(main())
