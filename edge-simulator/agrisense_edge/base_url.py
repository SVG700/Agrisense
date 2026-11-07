"""
The AgriSense address the edge tools talk to: every request goes to
``{AGRISENSE_BASE_URL}/api/<endpoint>``.

Resolved from, in order:
  1. the AGRISENSE_BASE_URL environment variable (or the tool's .env file) - what the Pi uses
  2. the repo-root agrisense.json, when running inside the repository on a laptop

The value is normalised: no trailing slash and no trailing /api, so paths never double up.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

REPO_CONFIG = Path(__file__).resolve().parents[2] / "agrisense.json"


def normalize(url: str) -> str:
    url = url.strip().rstrip("/")
    return url[: -len("/api")] if url.lower().endswith("/api") else url


def resolve_base_url() -> str:
    value = os.environ.get("AGRISENSE_BASE_URL", "").strip()
    if not value and REPO_CONFIG.is_file():
        value = str(json.loads(REPO_CONFIG.read_text(encoding="utf-8")).get("AGRISENSE_BASE_URL", "")).strip()
    if not value:
        raise SystemExit("AGRISENSE_BASE_URL is not set: put it in .env (e.g. AGRISENSE_BASE_URL=http://<host-ip>:5173)")
    return normalize(value)
