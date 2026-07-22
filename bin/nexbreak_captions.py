#!/usr/bin/env python3
"""
Per-stream caption/Vosk sidecar — isolated from the critical ingest→splice path.

Design rules (stability):
- Captioning NEVER shares fate with ffmpeg|tsp. A Vosk crash must not restart
  or kill nexbreak-proc's media pipeline.
- Off / bypass = process not running, model not loaded, zero ASR CPU.
- Hot toggle via CaptionSidecar.set_enabled() without touching core _procs.

The worker itself lives in nexbreak-caption-worker (separate process). When
Vosk is not installed or caption injection is not yet wired, the worker
idles in "bypass-ready" mode so enable/disable semantics can be proven.
"""

from __future__ import annotations

import logging
import os
import sys
import time
from pathlib import Path
from subprocess import Popen
from typing import Any, Optional

log = logging.getLogger("nexbreak.captions")


def worker_script() -> str:
    return str(Path(__file__).resolve().parent / "nexbreak-caption-worker")


class CaptionSidecar:
    """Owns one optional caption-worker child for a single processing channel."""

    def __init__(self, channel: dict[str, Any], db_path: Optional[str] = None):
        self.channel = channel
        self.db_path = db_path
        self._desired = False
        self._proc: Optional[Popen] = None
        self._restart_at = 0.0
        self._last_error: Optional[str] = None

    @property
    def desired(self) -> bool:
        return self._desired

    @property
    def alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def status(self) -> dict[str, Any]:
        return {
            "desired": self._desired,
            "running": self.alive,
            "bypassed": not self._desired,
            "pid": self._proc.pid if self.alive else None,
            "last_error": self._last_error,
            "channel_id": self.channel.get("id"),
            "service_name": self.channel.get("service_name"),
        }

    def set_enabled(self, enabled: bool) -> dict[str, Any]:
        """
        Hot enable/disable. Disable stops Vosk immediately and prevents
        auto-restart. Enable starts the worker (non-fatal on failure).
        """
        enabled = bool(enabled)
        if enabled == self._desired and (enabled == self.alive or not enabled):
            if not enabled:
                self.stop(reason="already off")
            return {"ok": True, **self.status()}

        self._desired = enabled
        self.channel["captioning_enabled"] = 1 if enabled else 0

        if not enabled:
            self.stop(reason="operator bypass/off")
            log.info(
                "captions OFF for %s — Vosk stopped, stream bypasses ASR",
                self.channel.get("service_name"),
            )
            return {"ok": True, **self.status()}

        ok = self.start()
        return {"ok": ok, **self.status()}

    def start(self) -> bool:
        """Start worker if desired. Failures are logged; never raise to caller."""
        if not self._desired:
            return False
        if self.alive:
            return True
        argv = [
            sys.executable,
            worker_script(),
            "--service-name",
            str(self.channel["service_name"]),
            "--feed-host",
            str(self.channel.get("local_feed_host") or "127.0.0.1"),
            "--feed-port",
            str(int(self.channel["local_feed_port"])),
        ]
        if self.db_path:
            argv += ["--db", self.db_path]
        model = os.environ.get("NEXBREAK_VOSK_MODEL", "")
        if model:
            argv += ["--model", model]

        try:
            log.info("starting caption worker: %s", " ".join(argv))
            self._proc = Popen(argv)
            self._last_error = None
            return True
        except Exception as exc:  # noqa: BLE001
            self._last_error = str(exc)
            log.warning("caption worker failed to start (non-fatal): %s", exc)
            self._proc = None
            return False

    def stop(self, reason: str = "") -> None:
        """Terminate worker; clear restart intent when desired is false."""
        if self._proc is None:
            return
        proc = self._proc
        self._proc = None
        if proc.poll() is None:
            log.info("stopping caption worker (%s)", reason or "stop")
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except Exception:
                proc.kill()
                try:
                    proc.wait(timeout=2)
                except Exception:
                    pass

    def tick(self) -> None:
        """
        Called from the proc main loop. If captions are desired and the worker
        died, restart with backoff. Never signals the core pipeline.
        """
        if not self._desired:
            return
        if self.alive:
            return
        now = time.time()
        if now < self._restart_at:
            return
        self._restart_at = now + 5.0
        code = self._proc.returncode if self._proc is not None else "n/a"
        log.warning("caption worker down (code=%s) — restarting (non-fatal)", code)
        self.start()

    def shutdown(self) -> None:
        self._desired = False
        self.stop(reason="proc shutdown")
