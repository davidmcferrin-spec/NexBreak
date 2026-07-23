#!/usr/bin/env python3
"""
Pipeline builders for nexbreak-proc / nexbreak-egress.

ffmpeg remux/transcode → tsp (PMT + spliceinject) → UDP local feed
egress: UDP local feed → SRT (ffmpeg libsrt) or HLS (deferred).

Loopback feeds are rewritten to multicast (239.255.98.1 by default) so
multiple local readers each get a full packet copy.

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


def _is_loopback_host(host: str) -> bool:
    h = (host or "").strip().lower()
    return h in ("", "127.0.0.1", "localhost", "::1")


def _is_multicast_host(host: str) -> bool:
    try:
        first = int((host or "").strip().split(".", 1)[0])
    except ValueError:
        return False
    return 224 <= first <= 239


def resolve_local_feed_host(host: Optional[str] = None) -> str:
    """
    Resolve the UDP host used for the processed local feed.

    Loopback unicast (127.0.0.1) is rewritten to an admin-scoped multicast
    group so every local reader (preview, egress, cc-watch, caption-worker)
    receives a full copy. On Linux, SO_REUSEADDR on unicast UDP typically
    delivers each datagram to only one socket — which left MediaMTX with
    "no stream on path nbN" while egress still looked busy.

    Override: NEXBREAK_FEED_MULTICAST=0 keeps the configured host as-is.
    Group:    NEXBREAK_FEED_MCAST_GROUP (default 239.255.98.1); ports stay
              per-channel (19001, 19002, …).
    """
    raw = (host if host is not None else "127.0.0.1") or "127.0.0.1"
    raw = str(raw).strip() or "127.0.0.1"
    flag = (os.environ.get("NEXBREAK_FEED_MULTICAST") or "1").strip().lower()
    if flag in ("0", "false", "no", "off"):
        return raw
    if _is_multicast_host(raw):
        return raw
    if _is_loopback_host(raw):
        return (os.environ.get("NEXBREAK_FEED_MCAST_GROUP") or "239.255.98.1").strip()
    return raw


def udp_mpegts_input_url(
    host: str,
    port: int,
    *,
    fifo_size: int = 1000000,
) -> str:
    """ffmpeg UDP MPEG-TS input URL (multicast-aware)."""
    h = resolve_local_feed_host(host)
    q = f"reuse=1&fifo_size={int(fifo_size)}&overrun_nonfatal=1"
    if _is_multicast_host(h):
        # Join via loopback so local tsp → mcast → local readers stays on-box.
        q = f"localaddr=127.0.0.1&{q}"
    return f"udp://{h}:{int(port)}?{q}"


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
            "-map", "0:v:0?",
            "-map", "0:a:0?",
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
        # Remux all elementary streams so embedded captions (A/53 SEI / data) survive.
        argv += ["-map", "0", "-c", "copy"]

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
    src = udp_mpegts_input_url(feed_host, feed_port, fifo_size=1000000)
    # Optional scale for CPU — default 1280 wide keeps 16:9 without full UHD encode cost.
    scale = (os.environ.get("NEXBREAK_PREVIEW_SCALE") or "1280:-2").strip()
    vbitrate = (os.environ.get("NEXBREAK_PREVIEW_VBITRATE") or "1500k").strip()
    # Allow buffering to the next IDR (nobuffer + mid-GOP join left publishers
    # stuck forever with "non-existing PPS" and never opening the RTSP output).
    return [
        ffmpeg,
        "-hide_banner",
        "-loglevel", "error",
        "-nostdin",
        "-fflags", "+genpts+discardcorrupt",
        "-flags", "low_delay",
        "-analyzeduration", "10000000",
        "-probesize", "5000000",
        "-f", "mpegts",
        "-i", src,
        "-map", "0:v:0",
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
        "-b:a", "96k",
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
    out_host = resolve_local_feed_host(feed_host)
    argv = [
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
        "-O", "ip", f"{out_host}:{int(feed_port)}",
    ]
    # Bind send to loopback for mcast/local feeds so packets stay on-box.
    if _is_multicast_host(out_host) or _is_loopback_host(feed_host or ""):
        argv += ["--local-address", "127.0.0.1"]
    return argv


def build_srt_output_url(channel: dict[str, Any]) -> str:
    """
    Build SRT URL for egress.

    Listener: peeridletimeout + linger=0 so a dropped VLC/client tears down the
    socket and ffmpeg exits (nexbreak-egress restarts it for the next connect).
    Without that, ffmpeg often hangs mid-write and the port looks open but
    rejects reconnects until a manual egress restart.
    """
    mode = channel.get("srt_mode") or "listener"
    # Shared live-stream flags (ffmpeg libsrt URL query).
    common = "latency=200&transtype=live&linger=0&tlpktdrop=1"
    # ~3s without peer activity → connection die → mux I/O error → process exit.
    idle = "peeridletimeout=3000"
    if mode == "listener":
        port = channel.get("srt_listen_port")
        if not port:
            raise ValueError("srt_listen_port required for SRT listener egress")
        return f"srt://0.0.0.0:{int(port)}?mode=listener&{common}&{idle}"
    host = channel.get("srt_remote_host")
    port = channel.get("srt_remote_port")
    if not host or not port:
        raise ValueError("srt_remote_host/port required for SRT caller/rendezvous egress")
    if mode == "rendezvous":
        return f"srt://{host}:{int(port)}?mode=rendezvous&{common}&{idle}"
    return f"srt://{host}:{int(port)}?mode=caller&{common}&{idle}"


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

    src = udp_mpegts_input_url(feed_host, feed_port, fifo_size=1000000)
    dst = build_srt_output_url(egress)
    # Probe long enough to learn audio sample_rate / PMT before opening SRT.
    # analyzeduration=0 caused: "sample rate not set" / "Could not write header".
    return [
        ffmpeg,
        "-hide_banner",
        "-loglevel", "warning",
        "-nostdin",
        "-fflags", "+genpts+discardcorrupt",
        "-flags", "low_delay",
        "-analyzeduration", "5000000",
        "-probesize", "5000000",
        "-f", "mpegts",
        "-i", src,
        "-map", "0",
        "-c", "copy",
        "-f", "mpegts",
        "-mpegts_flags", "+resend_headers",
        "-muxdelay", "0",
        "-muxpreload", "0",
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
