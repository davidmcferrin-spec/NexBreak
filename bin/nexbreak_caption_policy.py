#!/usr/bin/env python3
"""Caption policy helpers: off / auto / force_asr → effective_mode."""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from typing import Any, Optional

from nexbreak_pipeline import build_input_url, which

log = logging.getLogger("nexbreak.caption_policy")

POLICIES = frozenset({"off", "auto", "force_asr"})
EFFECTIVE = frozenset({"off", "preserve", "asr_insert"})


def normalize_policy(raw: Any, *, captioning_enabled: Any = None) -> str:
    """Return off|auto|force_asr. Falls back from legacy captioning_enabled."""
    p = (str(raw).strip().lower() if raw is not None else "") or ""
    if p in POLICIES:
        return p
    if captioning_enabled is not None and not int(captioning_enabled or 0):
        return "off"
    return "auto"


def enabled_from_policy(policy: str) -> int:
    return 0 if normalize_policy(policy) == "off" else 1


def cue_sock_path(service_name: str) -> str:
    base = os.environ.get("NEXBREAK_RUN_DIR", "/run/nexbreak")
    return os.path.join(base, f"cc-{service_name}.sock")


def vosk_ready() -> bool:
    """True when a model dir is configured and present (ASR can produce text)."""
    model = (os.environ.get("NEXBREAK_VOSK_MODEL") or "").strip()
    return bool(model) and os.path.isdir(model)


def effective_mode(policy: str, source_has_cc: bool, *, asr_available: Optional[bool] = None) -> str:
    """
    off         → off (no ASR; remux may still carry source CC)
    auto+has_cc → preserve
    auto+!cc    → asr_insert only if Vosk model is configured; else preserve
    force_asr   → asr_insert
    """
    p = normalize_policy(policy)
    if p == "off":
        return "off"
    if p == "force_asr":
        return "asr_insert"
    # auto
    if source_has_cc:
        return "preserve"
    if asr_available is None:
        asr_available = vosk_ready()
    if not asr_available:
        log.info(
            "auto policy, no source CC, but NEXBREAK_VOSK_MODEL unset/missing — "
            "preserving remux (set model or Force ASR to enable inject)"
        )
        return "preserve"
    return "asr_insert"


def probe_source_has_cc(channel: dict[str, Any], timeout: float = 8.0) -> bool:
    """
    Best-effort: ffprobe closed_captions flag on the ingest URL.
    Returns False when probe fails (auto → ASR insert).
    """
    ffprobe = which("ffprobe") or shutil.which("ffprobe")
    if not ffprobe:
        log.warning("ffprobe missing — assuming no source CC")
        return False
    try:
        url = build_input_url(channel)
    except Exception as exc:  # noqa: BLE001
        log.warning("CC probe: cannot build input URL: %s", exc)
        return False

    argv = [
        ffprobe,
        "-v",
        "error",
        "-show_streams",
        "-show_entries",
        "stream=index,codec_type,closed_captions:stream_tags",
        "-of",
        "json",
    ]
    kind = channel.get("input_type")
    if kind == "rtsp":
        transport = (channel.get("rtsp_transport") or "tcp").lower()
        argv += ["-rtsp_transport", transport]
    argv += ["-analyzeduration", "3000000", "-probesize", "2000000", url]

    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("CC probe failed: %s", exc)
        return False
    if proc.returncode != 0 or not proc.stdout:
        log.info("CC probe: ffprobe rc=%s — assuming no CC", proc.returncode)
        return False
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return False
    for stream in data.get("streams") or []:
        if stream.get("codec_type") != "video":
            continue
        cc = stream.get("closed_captions")
        if cc in (1, "1", True):
            return True
        tags = stream.get("tags") or {}
        for k, v in tags.items():
            if "caption" in str(k).lower() and str(v).strip() not in ("", "0"):
                return True
    return False


def apply_policy_fields(fields: dict[str, Any]) -> dict[str, Any]:
    """
    Normalize caption_policy / captioning_enabled in an update dict.
    Prefer explicit policy; map enabled→policy when only enabled is sent.
    """
    out = dict(fields)
    if "caption_policy" in out:
        pol = normalize_policy(out["caption_policy"])
        out["caption_policy"] = pol
        out["captioning_enabled"] = enabled_from_policy(pol)
    elif "captioning_enabled" in out:
        en = out["captioning_enabled"] in (True, 1, "1", "true", "on")
        out["caption_policy"] = "auto" if en else "off"
        out["captioning_enabled"] = 1 if en else 0
    return out
