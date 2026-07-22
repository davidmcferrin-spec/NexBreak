#!/usr/bin/env python3
"""
Pipeline builders for nexbreak-proc / nexbreak-egress.

ffmpeg remux/transcode → tsp (PMT + spliceinject) → UDP local feed
egress: UDP local feed → SRT (ffmpeg libsrt) or HLS (deferred).

Stdlib only; external tools invoked as subprocesses.
"""

from __future__ import annotations

import os
import re
import shutil
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse


def which(name: str) -> Optional[str]:
    env_key = {
        "ffmpeg": "NEXBREAK_FFMPEG",
        "ffprobe": "NEXBREAK_FFPROBE",
        "tsp": "NEXBREAK_TSP",
    }.get(name)
    if env_key:
        override = os.environ.get(env_key)
        if override:
            return override
    return shutil.which(name)


def require_bins(*names: str) -> dict[str, str]:
    found: dict[str, str] = {}
    missing = []
    for n in names:
        p = which(n)
        if not p:
            missing.append(n)
        else:
            found[n] = p
    if missing:
        raise RuntimeError(
            "missing required binaries: "
            + ", ".join(missing)
            + " (install ffmpeg + tsduck on Ubuntu)"
        )
    return found


def parse_srt_url(url: str) -> dict[str, Any]:
    """
    Parse srt://host:port[?mode=caller|listener|rendezvous] into fields.
    Returns empty dict if not an SRT URL.
    """
    raw = (url or "").strip()
    if not raw.lower().startswith("srt://"):
        return {}
    # urlparse needs a normal netloc; libsrt URLs are fine as-is.
    u = urlparse(raw)
    host = u.hostname
    port = u.port
    qs = parse_qs(u.query)
    mode = None
    if "mode" in qs and qs["mode"]:
        mode = qs["mode"][0].lower()
    out: dict[str, Any] = {}
    if mode in ("caller", "listener", "rendezvous"):
        out["srt_mode"] = mode
    if mode == "listener" and port:
        out["srt_listen_port"] = int(port)
    elif host and port:
        out["srt_remote_host"] = host
        out["srt_remote_port"] = int(port)
    elif port and not host:
        # srt://:9004 or srt://0.0.0.0:9004 without hostname edge cases
        out["srt_listen_port"] = int(port)
        out.setdefault("srt_mode", "listener")
    return out


def build_input_url(channel: dict[str, Any]) -> str:
    """Resolve ffmpeg -i URL from a processing_channels row."""
    kind = channel["input_type"]
    if kind == "rtsp":
        url = (channel.get("rtsp_url") or "").strip()
        if not url:
            raise ValueError("rtsp_url is required for input_type=rtsp")
        if url.lower().startswith("srt://"):
            raise ValueError(
                "rtsp_url is an srt:// URL but input_type=rtsp — "
                "set input_type=srt and fill SRT host/port (or paste the URL after switching)"
            )
        if not re.match(r"^rtsp[su]?://", url, re.I):
            raise ValueError(
                f"rtsp_url must be an rtsp:// URL (got {url[:48]!r})"
            )
        return url
    if kind == "srt":
        mode = (channel.get("srt_mode") or "caller").lower()
        host = channel.get("srt_remote_host")
        port = channel.get("srt_remote_port")
        listen = channel.get("srt_listen_port")
        # Recover from UI type-switch: SRT URL left in rtsp_url.
        if (mode == "listener" and not listen) or (
            mode != "listener" and (not host or not port)
        ):
            parsed = parse_srt_url(channel.get("rtsp_url") or "")
            if parsed:
                mode = (parsed.get("srt_mode") or mode).lower()
                host = host or parsed.get("srt_remote_host")
                port = port or parsed.get("srt_remote_port")
                listen = listen or parsed.get("srt_listen_port")
        if mode == "listener":
            if not listen:
                raise ValueError("srt_listen_port required for srt listener input")
            return f"srt://0.0.0.0:{int(listen)}?mode=listener&latency=200"
        if not host or not port:
            raise ValueError(
                "srt_remote_host/port required for srt caller/rendezvous input "
                "(set them in Channels, or paste srt://host:port)"
            )
        if mode == "rendezvous":
            return f"srt://{host}:{int(port)}?mode=rendezvous&latency=200"
        return f"srt://{host}:{int(port)}?mode=caller&latency=200"
    if kind == "decklink":
        idx = channel.get("decklink_device_index")
        if idx is None:
            raise ValueError("decklink_device_index required for input_type=decklink")
        # ffmpeg decklink device name; stations often use "DeckLink Quad (1)" etc.
        # For v1 we accept a numeric index via -video_device_number style URL.
        return f"decklink=device={int(idx)}"
    raise ValueError(f"unsupported input_type: {kind}")


def ffmpeg_ingest_argv(channel: dict[str, Any], ffmpeg: str) -> list[str]:
    """
    ffmpeg argv that writes MPEG-TS to stdout (piped into tsp).
    RTSP options are applied only for input_type=rtsp (never for srt://).
    """
    url = build_input_url(channel)
    kind = channel["input_type"]
    mode = (channel.get("ingest_mode") or "copy").lower()
    bitrate = int(channel.get("target_bitrate_kbps") or 14000)

    argv = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin"]

    if kind == "rtsp":
        transport = (channel.get("rtsp_transport") or "tcp").lower()
        if transport not in ("tcp", "udp"):
            transport = "tcp"
        # Live RTSP pull: prefer TCP, short probe, reconnect-friendly timeouts.
        argv += [
            "-rtsp_transport", transport,
            "-fflags", "nobuffer+genpts+discardcorrupt",
            "-flags", "low_delay",
            "-probesize", "32",
            "-analyzeduration", "0",
            "-timeout", "5000000",
            "-i", url,
        ]
    elif kind == "decklink":
        device = str(int(channel["decklink_device_index"]))
        argv += ["-f", "decklink", "-i", device]
    else:
        # SRT (and anything else ffmpeg understands as a URL).
        # Mid-GOP join on HEVC prints PPS warnings until the next IDR — normal for copy.
        argv += [
            "-fflags", "nobuffer+genpts+discardcorrupt",
            "-flags", "low_delay",
            "-analyzeduration", "2000000",
            "-probesize", "1000000",
            "-i", url,
        ]

    if mode == "transcode":
        vcodec = (channel.get("video_codec") or "h264").lower()
        acodec = (channel.get("audio_codec") or "aac").lower()
        v_ffmpeg = "libx264" if vcodec in ("h264", "avc", "libx264") else vcodec
        a_ffmpeg = "aac" if acodec in ("aac", "libfdk_aac") else acodec
        argv += [
            "-c:v", v_ffmpeg,
            "-preset", "veryfast",
            "-tune", "zerolatency",
            "-b:v", f"{bitrate}k",
            "-g", "60",
            "-c:a", a_ffmpeg,
            "-b:a", "128k",
            "-ac", "2",
            "-ar", "48000",
        ]
    else:
        argv += ["-c", "copy"]

    # MPEG-TS on stdout for tsp -I file -
    argv += ["-f", "mpegts", "-mpegts_flags", "+resend_headers", "pipe:1"]
    return argv


def ffmpeg_preview_argv(
    *,
    ffmpeg: str,
    feed_host: str,
    feed_port: int,
    preview_path: str,
    mediamtx_rtsp: Optional[str] = None,
) -> list[str]:
    """
    Republish the local MPEG-TS UDP feed to MediaMTX over RTSP (loopback).

    Always transcode video → H.264 (baseline) + audio → Opus so WHEP works in
    browsers even when the program path is HEVC/AAC copy. Ops preview only —
    does not touch the splice/egress feed.
    """
    base = (mediamtx_rtsp or os.environ.get("NEXBREAK_MEDIAMTX_RTSP") or "rtsp://127.0.0.1:8554").rstrip("/")
    dst = f"{base}/{preview_path}"
    src = f"udp://{feed_host}:{int(feed_port)}?reuse=1&fifo_size=1000000&overrun_nonfatal=1"
    # Optional scale for CPU — default 1280 wide keeps 16:9 without full UHD encode cost.
    scale = (os.environ.get("NEXBREAK_PREVIEW_SCALE") or "1280:-2").strip()
    vbitrate = (os.environ.get("NEXBREAK_PREVIEW_VBITRATE") or "1500k").strip()
    return [
        ffmpeg,
        "-hide_banner",
        "-loglevel", "error",
        "-nostdin",
        "-fflags", "+genpts+discardcorrupt",
        "-analyzeduration", "3000000",
        "-probesize", "2000000",
        "-i", src,
        "-map", "0:v:0?",
        "-map", "0:a:0?",
        "-vf", f"scale={scale}",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "zerolatency",
        "-profile:v", "baseline",
        "-pix_fmt", "yuv420p",
        "-b:v", vbitrate,
        "-maxrate", vbitrate,
        "-bufsize", "3000k",
        "-g", "30",
        "-c:a", "libopus",
        "-b:a", "64k",
        "-ac", "2",
        "-ar", "48000",
        "-f", "rtsp",
        "-rtsp_transport", "tcp",
        dst,
    ]


def tsp_splice_argv(
    channel: dict[str, Any],
    tsp: str,
    *,
    splice_udp_port: int,
    feed_host: str,
    feed_port: int,
) -> list[str]:
    """
    tsp chain: stuffing → PMT SCTE declare → spliceinject → drop nulls → UDP feed.
    Reads MPEG-TS from stdin (-I file -).

    TSDuck 3.4x requires --service OR (--pid AND --pts-pid). Using --service -
    selects the first PAT service so PTS/PCR PIDs are taken from that PMT
    (works for live remux without hardcoding a video PID).
    """
    scte_pid = int(channel.get("scte35_pid") or 500)
    return [
        tsp,
        "--add-input-stuffing", "1/10",
        "-I", "file", "-",
        "-P", "pmt",
        "--service", "-",
        "--add-programinfo-id", "0x43554549",
        "--add-pid", f"{scte_pid}/0x86",
        "-P", "spliceinject",
        "--service", "-",
        "--udp", f"127.0.0.1:{splice_udp_port}",
        "--inject-count", "2",
        "--inject-interval", "800",
        "-P", "filter", "--negate", "--pid", "0x1FFF",
        "-O", "ip", f"{feed_host}:{feed_port}",
        "--local-address", "127.0.0.1",
    ]


def build_srt_output_url(channel: dict[str, Any]) -> str:
    mode = channel.get("srt_mode") or "listener"
    if mode == "listener":
        port = channel.get("srt_listen_port")
        if not port:
            raise ValueError("srt_listen_port required for SRT listener egress")
        return f"srt://0.0.0.0:{int(port)}?mode=listener&latency=200&transtype=live"
    host = channel.get("srt_remote_host")
    port = channel.get("srt_remote_port")
    if not host or not port:
        raise ValueError("srt_remote_host/port required for SRT caller/rendezvous egress")
    if mode == "rendezvous":
        return f"srt://{host}:{int(port)}?mode=rendezvous&latency=200&transtype=live"
    return f"srt://{host}:{int(port)}?mode=caller&latency=200&transtype=live"


def ffmpeg_egress_argv(
    *,
    ffmpeg: str,
    feed_host: str,
    feed_port: int,
    egress: dict[str, Any],
) -> list[str]:
    """Pull local MPEG-TS UDP feed and push SRT (copy). HLS deferred."""
    if egress["output_type"] != "srt":
        raise ValueError(f"egress output_type={egress['output_type']} not implemented yet (v1 = srt)")

    src = f"udp://{feed_host}:{int(feed_port)}?reuse=1&fifo_size=1000000&overrun_nonfatal=1"
    dst = build_srt_output_url(egress)
    return [
        ffmpeg,
        "-hide_banner",
        "-loglevel", "warning",
        "-nostdin",
        "-fflags", "+genpts",
        "-i", src,
        "-c", "copy",
        "-f", "mpegts",
        dst,
    ]


def scte35_xml(
    *,
    splice_type: str,
    event_id: int,
    hex_payload: Optional[str] = None,
) -> Optional[str]:
    """
    Build a TSDuck XML splice_information_table, or None if hex_payload should
    be sent as raw binary instead.
    """
    if hex_payload:
        return None

    # Map NexBreak splice_type → SCTE-35 splice_insert attributes
    if splice_type == "splice_cancel":
        body = (
            f'<splice_insert splice_event_id="{event_id}" '
            f'splice_event_cancel="true"/>'
        )
    elif splice_type in ("splice_end_immediate", "splice_end_normal"):
        # Return to network (splice in)
        body = (
            f'<splice_insert splice_event_id="{event_id}" '
            f'out_of_network="false" splice_immediate="true"/>'
        )
    else:
        # splice_start_immediate / splice_start_normal — out of network
        body = (
            f'<splice_insert splice_event_id="{event_id}" '
            f'out_of_network="true" splice_immediate="true"/>'
        )

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<tsduck>\n"
        "  <splice_information_table protocol_version=\"0\">\n"
        f"    {body}\n"
        "  </splice_information_table>\n"
        "</tsduck>\n"
    )


def hex_to_bytes(hex_payload: str) -> bytes:
    cleaned = "".join(hex_payload.split())
    if cleaned.lower().startswith("0x"):
        cleaned = cleaned[2:]
    return bytes.fromhex(cleaned)
