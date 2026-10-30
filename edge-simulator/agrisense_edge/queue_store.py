"""
Durable local capture queue (SQLite, stdlib only).

Every capture is written here BEFORE any upload attempt, so a crash, reboot or
network outage never loses data. A record is only marked `sent` after the
backend confirms durable ingestion (HTTP 200/201). Records rejected permanently
(e.g. HTTP 422) are marked `dead` and kept for inspection, never retried.

Growth is bounded: sent records are pruned after `keep_sent_hours`, and when
pending records exceed `max_pending` the OLDEST pending captures are dropped
(with a warning) so the SD card cannot fill up during a long outage.
"""

import os
import sqlite3
import threading
import time
from typing import Dict, List, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS captures (
    capture_id      TEXT PRIMARY KEY,
    device_id       TEXT NOT NULL,
    captured_at     TEXT NOT NULL,        -- ISO-8601 UTC
    data_source     TEXT NOT NULL,        -- hardware | simulator
    temperature     REAL,                 -- NULL = not measured / sensor failure
    humidity        REAL,
    sensor_error    TEXT,
    battery_level   INTEGER,
    image_path      TEXT,                 -- local JPEG/PNG file
    image_url       TEXT,                 -- or a remote URL (simulator)
    status          TEXT NOT NULL DEFAULT 'pending',   -- pending | sent | dead
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at REAL NOT NULL DEFAULT 0,
    last_error      TEXT,
    created_at      REAL NOT NULL,
    sent_at         REAL
);
CREATE INDEX IF NOT EXISTS captures_due ON captures (status, next_attempt_at);
"""

FIELDS = (
    "capture_id", "device_id", "captured_at", "data_source", "temperature", "humidity",
    "sensor_error", "battery_level", "image_path", "image_url",
)


class CaptureQueue:
    def __init__(self, db_path: str, max_pending: int = 2000, keep_sent_hours: float = 24.0):
        os.makedirs(os.path.dirname(os.path.abspath(db_path)), exist_ok=True)
        self.db_path = db_path
        self.max_pending = max_pending
        self.keep_sent_secs = keep_sent_hours * 3600
        self._lock = threading.Lock()
        self._db = sqlite3.connect(db_path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")      # crash-safe, concurrent reads
        self._db.execute("PRAGMA synchronous=NORMAL")
        self._db.executescript(SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._db.close()

    # ------------------------------------------------------------------ writes
    def enqueue(self, record: Dict) -> None:
        """Insert a capture. Re-enqueueing the same capture_id is a no-op."""
        values = [record.get(f) for f in FIELDS]
        with self._lock:
            self._db.execute(
                f"INSERT OR IGNORE INTO captures ({', '.join(FIELDS)}, created_at) "
                f"VALUES ({', '.join('?' * len(FIELDS))}, ?)",
                values + [time.time()],
            )

    def mark_sent(self, capture_id: str) -> None:
        with self._lock:
            self._db.execute(
                "UPDATE captures SET status='sent', sent_at=?, last_error=NULL WHERE capture_id=?",
                (time.time(), capture_id),
            )

    def mark_retry(self, capture_id: str, error: str, delay_s: float) -> None:
        with self._lock:
            self._db.execute(
                "UPDATE captures SET attempts=attempts+1, next_attempt_at=?, last_error=? WHERE capture_id=?",
                (time.time() + delay_s, error[:500], capture_id),
            )

    def mark_dead(self, capture_id: str, error: str) -> None:
        with self._lock:
            self._db.execute(
                "UPDATE captures SET status='dead', attempts=attempts+1, last_error=? WHERE capture_id=?",
                (error[:500], capture_id),
            )

    # ------------------------------------------------------------------- reads
    def due(self, limit: int = 20) -> List[Dict]:
        """Pending captures whose backoff has elapsed, oldest first."""
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM captures WHERE status='pending' AND next_attempt_at<=? "
                "ORDER BY created_at LIMIT ?",
                (time.time(), limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def get(self, capture_id: str) -> Optional[Dict]:
        with self._lock:
            row = self._db.execute("SELECT * FROM captures WHERE capture_id=?", (capture_id,)).fetchone()
        return dict(row) if row else None

    def stats(self) -> Dict[str, int]:
        with self._lock:
            rows = self._db.execute("SELECT status, COUNT(*) AS n FROM captures GROUP BY status").fetchall()
        out = {"pending": 0, "sent": 0, "dead": 0}
        out.update({r["status"]: r["n"] for r in rows})
        return out

    # ------------------------------------------------------------- maintenance
    def prune(self) -> Dict[str, int]:
        """Bound disk usage. Returns counts of removed records."""
        removed = {"sent": 0, "overflow": 0}
        cutoff = time.time() - self.keep_sent_secs
        with self._lock:
            old_sent = self._db.execute(
                "SELECT capture_id, image_path FROM captures WHERE status='sent' AND sent_at<?", (cutoff,)
            ).fetchall()
            pending = self._db.execute("SELECT COUNT(*) FROM captures WHERE status='pending'").fetchone()[0]
            overflow = []
            if pending > self.max_pending:
                overflow = self._db.execute(
                    "SELECT capture_id, image_path FROM captures WHERE status='pending' "
                    "ORDER BY created_at LIMIT ?",
                    (pending - self.max_pending,),
                ).fetchall()
            for row in old_sent:
                self._db.execute("DELETE FROM captures WHERE capture_id=?", (row["capture_id"],))
            for row in overflow:
                self._db.execute("DELETE FROM captures WHERE capture_id=?", (row["capture_id"],))
        for row in list(old_sent) + list(overflow):
            _remove_file(row["image_path"])
        removed["sent"], removed["overflow"] = len(old_sent), len(overflow)
        return removed

    def release_image(self, capture_id: str) -> None:
        """Delete the local image once the server has it (record itself is kept until pruned)."""
        rec = self.get(capture_id)
        if rec and rec.get("image_path"):
            _remove_file(rec["image_path"])


def _remove_file(path: Optional[str]) -> None:
    if not path:
        return
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError:
        pass  # never crash the collector over cleanup
