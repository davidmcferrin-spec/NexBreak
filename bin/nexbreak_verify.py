#!/usr/bin/env python3
"""SCTE return-feed verify helpers (run-dir state + tap URL resolution)."""

from __future__ import annotations

import json
import os
import signal
import time
from pathlib import Path
from typing import Any, Optional

from nexbreak_pipeline import resolve_local_feed_host, udp_mpegts_input_url


def run_dir() -> Path:
    return Path(os.environ.get("NEXBREAK_RUN_DIR", "/run/nexbreak"))


def scte_dir() -> Path:
    d = run_dir() / "scte"
    d.mkdir(parents=True, exist_ok=True)
    return d


def asr_dir() -> Path:
    d = run_dir() / "asr"
    d.mkdir(parents=True, exist_ok=True)
    return d


def scte_state_path(egress_id: int) -> Path:
    return scte_dir() / f"egress-{int(egress_id)}.json"


def scte_pid_path(egress_id: int) -> Path:
    return scte_dir() / f"egress-{int(egress_id)}.pid"


def asr_state_path(service_name: str) -> Path:
    return asr_dir() / f"{service_name}.json"


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    tmp.write_text(raw + "\n", encoding="utf-8")
    os.replace(tmp, path)


def read_json(path: Path) -> Optional[dict[str, Any]]:
    try:
        if not path.is_file():
            return None
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def empty_scte_state(egress_id: int, **extra: Any) -> dict[str, Any]:
    base = {
        "ok": True,
        "egress_id": int(egress_id),
        "listening": False,
        "source": None,
        "tap_kind": None,
        "tap_url": None,
        "locked": False,
        "bytes_seen": 0,
        "last_byte_at": None,
        "last_scte_at": None,
        "last_event_id": None,
        "out_of_network": None,
        "recent": [],
        "error": None,
        "updated_at": time.time(),
    }
    base.update(extra)
    return base


def resolve_tap(
    egress: dict[str, Any],
    processing: Optional[dict[str, Any]],
) -> dict[str, Any]:
    """
    Pick SRT return (listener egress) or post-splice local feed (push egress).
    """
    mode = (egress.get("srt_mode") or "listener").lower()
    if egress.get("output_type") == "srt" and mode == "listener":
        port = egress.get("srt_listen_port")
        if not port:
            return {
                "ok": False,
                "error": "srt_listen_port required for listener return tap",
            }
        url = f"srt://127.0.0.1:{int(port)}?mode=caller&latency=200&transtype=live"
        return {
            "ok": True,
            "tap_kind": "srt",
            "tap_url": url,
            "label": f"SRT return :{int(port)} (caller into our listener)",
        }
    if processing is None:
        return {
            "ok": False,
            "error": "egress is push mode and has no routed processing source",
        }
    host = processing.get("local_feed_host") or "127.0.0.1"
    port = int(processing["local_feed_port"])
    dest = resolve_local_feed_host(host)
    url = udp_mpegts_input_url(host, port)
    return {
        "ok": True,
        "tap_kind": "feed",
        "tap_url": url,
        "label": (
            f"post-splice feed {dest}:{port} "
            f"(egress is {mode} push — cannot pull SRT return)"
        ),
        "feed_host": host,
        "feed_port": port,
        "feed_dest": dest,
    }


def stop_watch_pid(egress_id: int, *, timeout: float = 5.0) -> bool:
    """Stop a watch process recorded in the pidfile. Returns True if stopped/absent."""
    pid_path = scte_pid_path(egress_id)
    try:
        raw = pid_path.read_text(encoding="utf-8").strip()
        pid = int(raw)
    except Exception:
        pid = 0
    if pid > 0:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except PermissionError:
            return False
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                os.kill(pid, 0)
                time.sleep(0.1)
            except ProcessLookupError:
                break
        else:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    try:
        pid_path.unlink(missing_ok=True)  # type: ignore[call-arg]
    except TypeError:
        if pid_path.exists():
            pid_path.unlink()
    except OSError:
        pass
    state = read_json(scte_state_path(egress_id)) or empty_scte_state(egress_id)
    state["listening"] = False
    state["locked"] = False
    state["updated_at"] = time.time()
    atomic_write_json(scte_state_path(egress_id), state)
    return True


def watch_alive(egress_id: int) -> bool:
    pid_path = scte_pid_path(egress_id)
    try:
        pid = int(pid_path.read_text(encoding="utf-8").strip())
    except Exception:
        return False
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False
