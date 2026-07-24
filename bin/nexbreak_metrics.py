"""
Host metric history for Metrics charts + support bundles.

Samples CPU / memory / swap / GPU (not disk) into SQLite.
Controller runs a background sampler thread.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import time
from typing import Any, Optional

from nexbreak_host import host_snapshot

log = logging.getLogger("nexbreak.metrics")

SAMPLE_INTERVAL_S = 15.0
RETAIN_HOURS = 72
# Uptime is cheap; we still sample it every tick but UI treats it as footer-only.

_sampler_stop = threading.Event()
_sampler_thread: Optional[threading.Thread] = None


def ensure_host_samples_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS host_metric_samples (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            sampled_at      REAL NOT NULL,
            cpu_percent     REAL,
            mem_percent     REAL,
            swap_percent    REAL,
            gpu_percent     REAL,
            load_1m         REAL,
            uptime_seconds  REAL
        )
        """
    )
    conn.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_host_metric_samples_at
        ON host_metric_samples(sampled_at)
        """
    )
    conn.commit()


def record_host_sample(
    conn: sqlite3.Connection,
    snap: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    """Insert one sample from host_snapshot(). Returns the row dict or None."""
    ensure_host_samples_table(conn)
    snap = snap if snap is not None else host_snapshot()
    if not snap or not snap.get("available"):
        return None
    cpu = (snap.get("cpu") or {}).get("percent")
    mem = (snap.get("memory") or {}).get("percent")
    swap = (snap.get("memory") or {}).get("swap_percent")
    load = snap.get("loadavg") or {}
    load_1m = load.get("1m")
    uptime = snap.get("uptime_seconds")
    gpu_pct = None
    gpus = snap.get("gpu") or []
    if gpus:
        # Prefer first GPU that reports utilization.
        for g in gpus:
            if g.get("utilization_percent") is not None:
                try:
                    gpu_pct = float(g["utilization_percent"])
                except (TypeError, ValueError):
                    gpu_pct = None
                break
    now = time.time()
    conn.execute(
        """
        INSERT INTO host_metric_samples (
            sampled_at, cpu_percent, mem_percent, swap_percent,
            gpu_percent, load_1m, uptime_seconds
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (now, cpu, mem, swap, gpu_pct, load_1m, uptime),
    )
    conn.commit()
    return {
        "sampled_at": now,
        "cpu_percent": cpu,
        "mem_percent": mem,
        "swap_percent": swap,
        "gpu_percent": gpu_pct,
        "load_1m": load_1m,
        "uptime_seconds": uptime,
    }


def prune_host_samples(
    conn: sqlite3.Connection,
    *,
    retain_hours: float = RETAIN_HOURS,
) -> int:
    ensure_host_samples_table(conn)
    cutoff = time.time() - float(retain_hours) * 3600.0
    cur = conn.execute(
        "DELETE FROM host_metric_samples WHERE sampled_at < ?",
        (cutoff,),
    )
    conn.commit()
    return int(cur.rowcount or 0)


def query_host_samples(
    conn: sqlite3.Connection,
    *,
    since_seconds: float,
    limit: int = 20000,
) -> list[dict[str, Any]]:
    ensure_host_samples_table(conn)
    since = time.time() - float(since_seconds)
    lim = max(1, min(int(limit), 50000))
    rows = conn.execute(
        """
        SELECT sampled_at, cpu_percent, mem_percent, swap_percent,
               gpu_percent, load_1m, uptime_seconds
        FROM host_metric_samples
        WHERE sampled_at >= ?
        ORDER BY sampled_at ASC
        LIMIT ?
        """,
        (since, lim),
    ).fetchall()
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "sampled_at": r[0],
                "cpu_percent": r[1],
                "mem_percent": r[2],
                "swap_percent": r[3],
                "gpu_percent": r[4],
                "load_1m": r[5],
                "uptime_seconds": r[6],
            }
        )
    return out


def _sampler_loop(db_path: str) -> None:
    from nexbreak_db import connect

    log.info(
        "host metrics sampler started (interval=%.0fs retain=%sh)",
        SAMPLE_INTERVAL_S,
        RETAIN_HOURS,
    )
    prune_counter = 0
    while not _sampler_stop.is_set():
        try:
            conn = connect(db_path)
            try:
                record_host_sample(conn)
                prune_counter += 1
                # Prune about once an hour.
                if prune_counter >= int(3600 / SAMPLE_INTERVAL_S):
                    n = prune_host_samples(conn)
                    if n:
                        log.info("pruned %s old host metric samples", n)
                    prune_counter = 0
            finally:
                conn.close()
        except Exception as exc:  # noqa: BLE001
            log.warning("host sample failed: %s", exc)
        _sampler_stop.wait(SAMPLE_INTERVAL_S)
    log.info("host metrics sampler stopped")


def start_host_sampler(db_path: Optional[str] = None) -> None:
    """Idempotent background sampler for the controller process."""
    global _sampler_thread
    if _sampler_thread is not None and _sampler_thread.is_alive():
        return
    _sampler_stop.clear()
    path = db_path or ""
    t = threading.Thread(
        target=_sampler_loop,
        args=(path,),
        name="nexbreak-host-sampler",
        daemon=True,
    )
    _sampler_thread = t
    t.start()


def stop_host_sampler() -> None:
    _sampler_stop.set()
