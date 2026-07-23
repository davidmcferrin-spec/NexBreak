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


def ensure_run_subdir(name: str) -> Path:
    """Create /run/nexbreak/<name> when writable; raise OSError if not."""
    d = run_dir() / name
    d.mkdir(parents=True, exist_ok=True)
    return d


def scte_dir(*, create: bool = False) -> Path:
    """SCTE verify state dir. Do not mkdir on read paths (ProtectSystem EROFS)."""
    if create:
        return ensure_run_subdir("scte")
    return run_dir() / "scte"


def asr_dir(*, create: bool = False) -> Path:
    if create:
        return ensure_run_subdir("asr")
    return run_dir() / "asr"


def scte_state_path(egress_id: int) -> Path:
    return run_dir() / "scte" / f"egress-{int(egress_id)}.json"


def scte_pid_path(egress_id: int) -> Path:
    return run_dir() / "scte" / f"egress-{int(egress_id)}.pid"


def asr_state_path(service_name: str) -> Path:
    return run_dir() / "asr" / f"{service_name}.json"


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
    Pick a tap source for SCTE verify.

    Prefer the routed post-splice local MPEG-TS feed when available: same TS
    tables egress remuxes, and it does not steal the live SRT client slot
    (SRT listener is typically one-caller).

    Fall back to calling into our SRT listener only when there is no routed
    processing source.
    """
    mode = (egress.get("srt_mode") or "listener").lower()

    if processing is not None:
        host = processing.get("local_feed_host") or "127.0.0.1"
        port = int(processing["local_feed_port"])
        dest = resolve_local_feed_host(host)
        url = udp_mpegts_input_url(host, port)
        note = ""
        if egress.get("output_type") == "srt" and mode == "listener":
            note = (
                " (post-splice feed — same TS as SRT remux; "
                "avoids fighting the live SRT client)"
            )
        return {
            "ok": True,
            "tap_kind": "feed",
            "tap_url": url,
            "label": f"post-splice feed {dest}:{port}{note}",
            "feed_host": host,
            "feed_port": port,
            "feed_dest": dest,
        }

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
            "label": (
                f"SRT return :{int(port)} (caller into our listener — "
                "fails if another client already holds the session)"
            ),
        }

    return {
        "ok": False,
        "error": "egress is push mode and has no routed processing source",
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
    try:
        atomic_write_json(scte_state_path(egress_id), state)
    except OSError:
        # EROFS under ProtectSystem if RuntimeDirectory missing — pid stop still ok.
        pass
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
