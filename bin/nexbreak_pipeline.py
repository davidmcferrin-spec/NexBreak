#!/usr/bin/env python3
"""
Pipeline builders for nexbreak-proc / nexbreak-egress.

ffmpeg remux/transcode → tsp (PMT + spliceinject) → UDP local feed
egress: UDP local feed → SRT (ffmpeg libsrt) or HLS (deferred).

Stdlib only; external tools invoked as subprocesses.
"""

from __future__ import annotations

import os
import shutil
from typing import Any, Optional


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


def build_input_url(channel: dict[str, Any]) -> str:
    """Resolve ffmpeg -i URL from a processing_channels row."""
    kind = channel["input_type"]
    if kind == "rtsp":
        url = (channel.get("rtsp_url") or "").strip()
        if not url:
            raise ValueError("rtsp_url is required for input_type=rtsp")
        return url
    if kind == "srt":
        mode = channel.get("srt_mode") or "caller"
        if mode == "listener":
            port = channel.get("srt_listen_port")
            if not port:
                raise ValueError("srt_listen_port required for srt listener input")
            return f"srt://0.0.0.0:{int(port)}?mode=listener&latency=200"
        host = channel.get("srt_remote_host")
        port = channel.get("srt_remote_port")
        if not host or not port:
            raise ValueError("srt_remote_host/port required for srt caller/rendezvous input")
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
    """
    url = build_input_url(channel)
    kind = channel["input_type"]
    mode = (channel.get("ingest_mode") or "copy").lower()
    bitrate = int(channel.get("target_bitrate_kbps") or 14000)

    argv = [ffmpeg, "-hide_banner", "-loglevel", "warning", "-nostdin"]

    if kind == "rtsp":
        argv += ["-rtsp_transport", "tcp", "-i", url]
    elif kind == "decklink":
        # Device string is "decklink=device=N" — split for ffmpeg's -f decklink
        device = str(int(channel["decklink_device_index"]))
        argv += ["-f", "decklink", "-i", device]
    else:
        argv += ["-i", url]

    if mode == "transcode":
        vcodec = (channel.get("video_codec") or "h264").lower()
        acodec = (channel.get("audio_codec") or "aac").lower()
        v_ffmpeg = "libx264" if vcodec in ("h264", "avc", "libx264") else vcodec
        a_ffmpeg = "aac" if acodec in ("aac", "libfdk_aac") else acodec
        argv += [
            "-c:v", v_ffmpeg,
            "-preset", "veryfast",
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
    """
    scte_pid = int(channel.get("scte35_pid") or 500)
    return [
        tsp,
        "--add-input-stuffing", "1/10",
        "-I", "file", "-",
        "-P", "pmt",
        "--add-programinfo-id", "0x43554549",
        "--add-pid", f"{scte_pid}/0x86",
        "-P", "spliceinject",
        "--pid", str(scte_pid),
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
