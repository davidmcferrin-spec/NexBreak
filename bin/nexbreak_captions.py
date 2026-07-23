#!/usr/bin/env python3
"""
Per-stream caption/Vosk sidecar — isolated from the critical ingest→splice path.

Design rules (stability):
- Captioning NEVER shares fate with ffmpeg|tsp|cc-inject. A Vosk crash must not
  restart or kill nexbreak-proc's media pipeline.
- Off / bypass = process not running, model not loaded, zero ASR CPU.
- Hot toggle via CaptionSidecar.set_policy() without touching core _procs
  (pipeline mode flips are handled by nexbreak-proc).
"""

from __future__ import annotations

import logging
import os
import sys
import time
from pathlib import Path
from subprocess import Popen
from typing import Any, Optional

from nexbreak_caption_policy import cue_sock_path, enabled_from_policy, normalize_policy
from nexbreak_db import cc_udp_endpoint_for
from nexbreak_verify import asr_state_path, read_json

log = logging.getLogger("nexbreak.captions")


def worker_script() -> str:
    return str(Path(__file__).resolve().parent / "nexbreak-caption-worker")


def read_asr_live(service_name: str) -> Optional[dict[str, Any]]:
    return read_json(asr_state_path(str(service_name)))


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
        svc = str(self.channel.get("service_name") or "x")
        asr = read_asr_live(svc) or {}
        return {
            "desired": self._desired,
            "running": self.alive,
            "bypassed": not self._desired,
            "pid": self._proc.pid if self.alive else None,
            "last_error": self._last_error,
            "channel_id": self.channel.get("id"),
            "service_name": self.channel.get("service_name"),
            "policy": normalize_policy(
                self.channel.get("caption_policy"),
                captioning_enabled=self.channel.get("captioning_enabled"),
            ),
            "cue_sock": cue_sock_path(svc),
            "asr": asr,
        }

    def set_enabled(self, enabled: bool) -> dict[str, Any]:
        """Back-compat: enabled True→auto, False→off."""
        return self.set_policy("auto" if enabled else "off")

    def set_policy(self, policy: str) -> dict[str, Any]:
        pol = normalize_policy(policy)
        self.channel["caption_policy"] = pol
        self.channel["captioning_enabled"] = enabled_from_policy(pol)
        # Worker runs only when ASR insert is intended by caller (proc sets desired).
        return {"ok": True, **self.status()}

    def set_asr_desired(self, desired: bool) -> dict[str, Any]:
        """Start/stop worker for asr_insert effective mode."""
        desired = bool(desired)
        if desired == self._desired and (desired == self.alive or not desired):
            if not desired:
                self.stop(reason="already off")
            return {"ok": True, **self.status()}

        self._desired = desired
        if not desired:
            self.stop(reason="operator bypass/off or preserve mode")
            log.info(
                "ASR worker OFF for %s",
                self.channel.get("service_name"),
            )
            return {"ok": True, **self.status()}

        ok = self.start()
        return {"ok": ok, **self.status()}

    def start(self) -> bool:
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
            "--cue-sock",
            cue_sock_path(str(self.channel["service_name"])),
            "--cc-udp",
            cc_udp_endpoint_for(self.channel),
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
