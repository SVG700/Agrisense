"""
Uploads queued captures to POST /api/telemetry.

Idempotent: each request carries the capture's UUID as `capture_id`, so a retry
after a lost response can never create a duplicate record on the server.

Outcome per HTTP result:
  200 / 201                    -> sent (server confirmed durable ingestion)
  408 / 429 / 5xx / network    -> retry with exponential backoff + jitter
  401 / 403                    -> retry slowly (credentials problem; data is kept)
  other 4xx (400/409/413/422)  -> dead (permanent rejection, kept for inspection)
"""

import base64
import logging
import mimetypes
import random
from typing import Dict, Optional

log = logging.getLogger("agrisense.uploader")

RETRYABLE = {408, 425, 429}
MAX_BACKOFF_S = 900          # 15 min
AUTH_BACKOFF_S = 600         # 10 min


def backoff_delay(attempts: int, base: float = 5.0) -> float:
    """Exponential backoff with full jitter, capped."""
    return min(MAX_BACKOFF_S, base * (2 ** min(attempts, 10))) * random.uniform(0.5, 1.0)


def build_payload(rec: Dict) -> Dict:
    payload = {
        "capture_id": rec["capture_id"],
        "device_id": rec["device_id"],
        "timestamp": rec["captured_at"],
        "temperature": rec.get("temperature"),
        "humidity": rec.get("humidity"),
        "data_source": rec.get("data_source") or "unknown",
    }
    if rec.get("battery_level") is not None:
        payload["battery_level"] = rec["battery_level"]
    if rec.get("image_path"):
        mime = mimetypes.guess_type(rec["image_path"])[0] or "image/jpeg"
        with open(rec["image_path"], "rb") as f:
            payload["image_base64"] = "data:%s;base64,%s" % (mime, base64.b64encode(f.read()).decode("ascii"))
    elif rec.get("image_url"):
        payload["image_url"] = rec["image_url"]
    return payload


class Uploader:
    def __init__(self, session, api_url: str, device_key: Optional[str], timeout_s: float = 60.0):
        self.session = session
        self.url = api_url.rstrip("/") + "/api/telemetry"
        self.health_url = api_url.rstrip("/") + "/api/health"
        self.timeout_s = timeout_s
        self.headers = {"Content-Type": "application/json"}
        if device_key:
            self.headers["Authorization"] = "Bearer " + device_key

    def health(self) -> Optional[Dict]:
        try:
            res = self.session.get(self.health_url, timeout=5)
            return res.json() if res.ok else None
        except Exception:  # noqa: BLE001 - any failure == backend unreachable
            return None

    def flush(self, queue, limit: int = 20) -> Dict[str, int]:
        """Upload due captures. Stops early on network failure (we are offline)."""
        result = {"sent": 0, "retry": 0, "dead": 0}
        for rec in queue.due(limit):
            outcome = self.upload_one(queue, rec)
            result[outcome] += 1
            if outcome == "retry" and rec.get("_offline"):
                break
        return result

    def upload_one(self, queue, rec: Dict) -> str:
        cid = rec["capture_id"]
        try:
            payload = build_payload(rec)
        except OSError as exc:
            queue.mark_dead(cid, "image unreadable: %s" % exc)
            log.error("capture %s: image file unreadable, marked dead", cid)
            return "dead"

        try:
            res = self.session.post(self.url, json=payload, headers=self.headers, timeout=self.timeout_s)
        except Exception as exc:  # noqa: BLE001 - requests.RequestException and friends
            rec["_offline"] = True
            delay = backoff_delay(rec["attempts"])
            queue.mark_retry(cid, "network: %s" % type(exc).__name__, delay)
            log.warning("capture %s: backend unreachable (%s), retry in %.0fs", cid, type(exc).__name__, delay)
            return "retry"

        body = _json(res)
        if res.status_code in (200, 201):
            queue.mark_sent(cid)
            queue.release_image(cid)
            det = (body.get("telemetry") or {}).get("detection") or {}
            log.info(
                "capture %s: %s (vision=%s, advisory=%s/%s)",
                cid,
                "duplicate (already stored)" if body.get("duplicate") else "stored",
                (det.get("vision_meta") or {}).get("status"),
                (det.get("ai_advisory") or {}).get("source"),
                (det.get("ai_advisory") or {}).get("status"),
            )
            return "sent"

        error = "HTTP %s %s: %s" % (res.status_code, body.get("code", ""), body.get("error", "")[:200])
        if res.status_code in (401, 403):
            queue.mark_retry(cid, error, AUTH_BACKOFF_S)
            log.error("capture %s: %s - check AGRISENSE_DEVICE_KEY; data kept", cid, error)
            return "retry"
        if res.status_code in RETRYABLE or res.status_code >= 500:
            delay = backoff_delay(rec["attempts"])
            if res.headers.get("Retry-After", "").isdigit():
                delay = max(delay, float(res.headers["Retry-After"]))
            queue.mark_retry(cid, error, delay)
            log.warning("capture %s: %s, retry in %.0fs", cid, error, delay)
            return "retry"
        queue.mark_dead(cid, error)
        log.error("capture %s: permanently rejected: %s", cid, error)
        return "dead"


def _json(res) -> Dict:
    try:
        data = res.json()
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}
