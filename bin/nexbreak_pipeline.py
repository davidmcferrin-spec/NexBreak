#!/usr/bin/env python3
"""
Pipeline builders for nexbreak-proc / nexbreak-egress.

ffmpeg remux/transcode → tsp (PMT + spliceinject) → UDP local feed
egress: UDP local feed → SRT via tsp (packet-faithful; preserves SCTE-35)
  or ffmpeg libsrt when NEXBREAK_EGRESS_ENGINE=ffmpeg (may drop 0x86 PIDs).
HLS origin_pull: UDP local feed → ffmpeg HLS (mpegts segments) under
  /var/lib/nexbreak/hls/<service_name>/, served by Apache at /hls/.

Loopback feeds are rewritten to multicast (239.255.98.1 by default) so
multiple local readers each get a full packet copy.

Stdlib only; external tools invoked as subprocesses.
"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
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
        # Match egress default: 200ms is too tight and shows up as stutter.
        latency_ms = int(os.environ.get("NEXBREAK_SRT_LATENCY_MS", "800"))
        if mode == "listener":
            if not listen:
                raise ValueError("srt_listen_port required for srt listener input")
            return f"srt://0.0.0.0:{int(listen)}?mode=listener&latency={latency_ms}"
        if not host or not port:
            raise ValueError(
                "srt_remote_host/port required for srt caller/rendezvous input "
                "(set them in Channels, or paste srt://host:port)"
            )
        if mode == "rendezvous":
            return f"srt://{host}:{int(port)}?mode=rendezvous&latency={latency_ms}"
        return f"srt://{host}:{int(port)}?mode=caller&latency={latency_ms}"
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


# Marker prefix for splicemonitor --json-line events on tsp stderr.
# nexbreak-proc parses lines containing this marker into structured state.
SPLICEMON_MARKER = "##splicemon##"


def _env_flag(name: str, default: bool = True) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if not raw:
        return default
    return raw not in ("0", "false", "no", "off")


def tsp_verbose_enabled() -> bool:
    """
    tsp --verbose (default on): spliceinject logs its full command lifecycle
    (received message / enqueuing / injecting / dropping) ONLY at verbose
    level. Without it, splice failures are completely silent.
    Override: NEXBREAK_TSP_VERBOSE=0.
    """
    return _env_flag("NEXBREAK_TSP_VERBOSE", True)


def splicemon_enabled() -> bool:
    """In-chain splicemonitor (default on). Override: NEXBREAK_SPLICEMON=0."""
    return _env_flag("NEXBREAK_SPLICEMON", True)


def tsp_splice_argv(
    channel: dict[str, Any],
    tsp: str,
    *,
    splice_udp_port: int,
    feed_host: str,
    feed_port: int,
) -> list[str]:
    """
    tsp chain: stuffing → PMT SCTE declare → spliceinject → splicemonitor →
    drop nulls → UDP feed. Reads MPEG-TS from stdin (-I file -).

    TSDuck 3.4x requires --service OR (--pid AND --pts-pid). Using --service -
    selects the first PAT service so PTS/PCR PIDs are taken from that PMT
    (works for live remux without hardcoding a video PID).

    spliceinject only replaces null packets (PID 0x1FFF), so input stuffing is
    required. --min-inter-packet keeps the SCTE PID alive with splice_null so
    Verify always has TID 0xFC traffic even between Roll presses.

    spliceinject facts that shape this argv (verified against TSDuck source):
      * NOTHING is injected (keepalives included) until the plugin sees a PTS
        on the service's video/PCR PID ("PTS lock"). Silent until then.
      * Immediate splice_inserts are injected ONCE (a single TS packet);
        --inject-count/--inject-interval only apply to commands with pts_time.
      * All lifecycle logging is verbose-level → tsp runs --verbose so
        nexbreak-proc can parse it (see tsp_verbose_enabled).

    splicemonitor runs in-process right after spliceinject: lossless proof of
    insertion, JSON one-liners on stderr (##splicemon## prefix), and it emits
    nothing for splice_null keepalives — signal without noise.
    """
    scte_pid = int(channel.get("scte35_pid") or 500)
    out_host = resolve_local_feed_host(feed_host)
    # Keep SCTE PID active without needing a known TS bitrate (live remux often
    # reports bitrate=0, which makes --min-bitrate a no-op).
    min_inter = int(os.environ.get("NEXBREAK_SCTE_MIN_INTER_PACKET", "400") or 400)
    argv = [tsp]
    if tsp_verbose_enabled():
        argv += ["--verbose"]
    argv += [
        "--add-input-stuffing", "1/8",
        "-I", "file", "-",
        "-P", "pmt",
        "--service", "-",
        "--add-programinfo-id", "0x43554549",
        "--add-pid", f"{scte_pid}/0x86",
        "-P", "spliceinject",
        "--service", "-",
        "--pid", str(scte_pid),
        "--udp", f"127.0.0.1:{splice_udp_port}",
        "--inject-count", "3",
        "--inject-interval", "500",
        "--min-inter-packet", str(max(50, min_inter)),
    ]
    if splicemon_enabled():
        argv += [
            "-P", "splicemonitor",
            f"--json-line={SPLICEMON_MARKER}",
            "--tag", str(channel.get("service_name") or ""),
        ]
    argv += [
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

    Latency is intentionally higher than ultra-low (200ms) so VLC playback stays
    smooth; tlpktdrop is off so we don't intentionally discard for latency.
    """
    mode = channel.get("srt_mode") or "listener"
    # ~800ms receive buffer — smooth for copy remux; still interactive for ops.
    latency_ms = int(os.environ.get("NEXBREAK_SRT_LATENCY_MS", "800"))
    common = f"latency={latency_ms}&transtype=live&linger=0"
    # ~5s without peer → tear down so egress can recycle for the next client.
    idle = "peeridletimeout=5000"
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


def hls_data_root() -> Path:
    """Durable HLS publish root (Apache Alias /hls/ → here)."""
    return Path(os.environ.get("NEXBREAK_DATA") or "/var/lib/nexbreak") / "hls"


def hls_safe_service_name(service_name: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", str(service_name or "").strip())
    if not safe or safe in (".", ".."):
        raise ValueError("invalid egress service_name for HLS path")
    return safe


def hls_channel_dir(service_name: str) -> Path:
    return hls_data_root() / hls_safe_service_name(service_name)


def prepare_hls_publish_dir(service_name: str) -> Path:
    """
    Ensure /var/lib/nexbreak/hls/<service_name>/ exists and clear stale segments.
    Returns the directory path (playlist will be index.m3u8 inside).
    """
    d = hls_channel_dir(service_name)
    d.mkdir(parents=True, mode=0o755, exist_ok=True)
    try:
        d.chmod(0o755)
    except OSError:
        pass
    for pattern in ("*.ts", "*.m4s", "*.m3u8", "*.tmp"):
        for stale in d.glob(pattern):
            try:
                stale.unlink()
            except OSError:
                pass
    return d


def ffmpeg_hls_egress_argv(
    *,
    ffmpeg: str,
    feed_host: str,
    feed_port: int,
    egress: dict[str, Any],
    publish_dir: Optional[Path] = None,
) -> list[str]:
    """
    Pull local MPEG-TS UDP feed and write HLS (mpegts segments, copy).

    origin_pull only. SCTE-35 private PIDs are more likely to survive in
    mpegts segments than fMP4; still not as faithful as tsp→SRT.
    """
    if egress.get("output_type") != "hls":
        raise ValueError("ffmpeg_hls_egress_argv requires output_type=hls")
    mode = (egress.get("hls_mode") or "origin_pull").lower()
    if mode != "origin_pull":
        raise ValueError(f"hls_mode={mode} not supported by origin packager (use origin_pull)")

    svc = egress.get("service_name")
    if not svc:
        raise ValueError("service_name required for HLS origin_pull")
    out_dir = Path(publish_dir) if publish_dir else prepare_hls_publish_dir(str(svc))
    playlist = out_dir / "index.m3u8"
    segment = out_dir / "seg_%05d.ts"

    hls_time = int(os.environ.get("NEXBREAK_HLS_TIME", "2"))
    hls_list = int(os.environ.get("NEXBREAK_HLS_LIST_SIZE", "10"))
    src = udp_mpegts_input_url(feed_host, feed_port, fifo_size=2000000)

    return [
        ffmpeg,
        "-hide_banner",
        "-loglevel", "warning",
        "-nostdin",
        "-fflags", "+genpts+discardcorrupt",
        "-analyzeduration", "2000000",
        "-probesize", "2000000",
        "-f", "mpegts",
        "-i", src,
        "-map", "0",
        "-c", "copy",
        "-f", "hls",
        "-hls_time", str(max(1, hls_time)),
        "-hls_list_size", str(max(3, hls_list)),
        "-hls_flags", "delete_segments+append_list+independent_segments",
        "-hls_segment_type", "mpegts",
        "-hls_segment_filename", str(segment),
        str(playlist),
    ]


def ffmpeg_egress_argv(
    *,
    ffmpeg: str,
    feed_host: str,
    feed_port: int,
    egress: dict[str, Any],
) -> list[str]:
    """
    Pull local MPEG-TS UDP feed and push SRT (copy).

    Prefer tsp_egress_argv for production: ffmpeg demux/remux often drops
    SCTE-35 (stream_type 0x86) private data PIDs even with -map 0 -c copy.
    Kept for NEXBREAK_EGRESS_ENGINE=ffmpeg fallback / dry-run comparison.

    For HLS use ffmpeg_hls_egress_argv (always ffmpeg; tsp cannot package HLS).
    """
    if egress["output_type"] == "hls":
        return ffmpeg_hls_egress_argv(
            ffmpeg=ffmpeg,
            feed_host=feed_host,
            feed_port=feed_port,
            egress=egress,
        )
    if egress["output_type"] != "srt":
        raise ValueError(f"egress output_type={egress['output_type']} not supported")

    src = udp_mpegts_input_url(feed_host, feed_port, fifo_size=2000000)
    dst = build_srt_output_url(egress)
    # Modest probe so audio sample_rate is known; avoid ultra-low-delay flags
    # that encourage stutter on copy→SRT.
    return [
        ffmpeg,
        "-hide_banner",
        "-loglevel", "warning",
        "-nostdin",
        "-fflags", "+genpts+discardcorrupt",
        "-analyzeduration", "2000000",
        "-probesize", "2000000",
        "-f", "mpegts",
        "-i", src,
        "-map", "0",
        "-c", "copy",
        "-f", "mpegts",
        "-mpegts_flags", "+resend_headers",
        dst,
    ]


def tsp_egress_argv(
    *,
    tsp: str,
    feed_host: str,
    feed_port: int,
    egress: dict[str, Any],
) -> list[str]:
    """
    Packet-faithful local feed → SRT via TSDuck (preserves SCTE-35 PIDs).

    Listener uses --multiple so sequential clients can reconnect without
    restarting tsp; caller/rendezvous exit when the peer drops (egress
    service restarts them). HLS is ffmpeg-only.
    """
    if egress["output_type"] != "srt":
        raise ValueError(
            f"tsp egress only supports SRT (got output_type={egress['output_type']})"
        )

    mode = (egress.get("srt_mode") or "listener").lower()
    latency_ms = int(os.environ.get("NEXBREAK_SRT_LATENCY_MS", "800"))
    dest = resolve_local_feed_host(feed_host)
    argv = [
        tsp,
        "-I", "ip", f"{dest}:{int(feed_port)}",
        "--local-address", "127.0.0.1",
        "-O", "srt",
        "--latency", str(latency_ms),
        "--transtype", "live",
    ]
    if mode == "listener":
        port = egress.get("srt_listen_port")
        if not port:
            raise ValueError("srt_listen_port required for SRT listener egress")
        argv += ["--listener", f":{int(port)}", "--multiple"]
    elif mode == "rendezvous":
        host = egress.get("srt_remote_host")
        port = egress.get("srt_remote_port")
        if not host or not port:
            raise ValueError("srt_remote_host/port required for SRT rendezvous egress")
        # Rendezvous = both ends specify local+remote (TSDuck: --listener + --caller).
        argv += ["--listener", f":{int(port)}", "--caller", f"{host}:{int(port)}"]
    else:
        host = egress.get("srt_remote_host")
        port = egress.get("srt_remote_port")
        if not host or not port:
            raise ValueError("srt_remote_host/port required for SRT caller egress")
        argv += ["--caller", f"{host}:{int(port)}"]
    return argv


def egress_engine() -> str:
    """Return 'tsp' (default) or 'ffmpeg' from NEXBREAK_EGRESS_ENGINE."""
    raw = (os.environ.get("NEXBREAK_EGRESS_ENGINE") or "tsp").strip().lower()
    return "ffmpeg" if raw == "ffmpeg" else "tsp"


# SCTE-35 unique_program_id for generated splice_insert commands. Required by
# the TSDuck XML model (its absence made spliceinject reject every command).
# We run SPTS channels, so a constant per-box default is fine for v1.
def scte35_unique_program_id() -> int:
    try:
        return int(os.environ.get("NEXBREAK_UNIQUE_PROGRAM_ID", "1"))
    except ValueError:
        return 1


def scte35_xml(
    *,
    splice_type: str,
    event_id: int,
    hex_payload: Optional[str] = None,
    auto_return: bool = False,
    break_duration_sec: Optional[float] = None,
    unique_program_id: Optional[int] = None,
) -> Optional[str]:
    """
    Build a TSDuck XML splice_information_table, or None if hex_payload should
    be sent as raw binary instead.

    Only valid for immediate inserts and cancels. TSDuck's XML model REQUIRES
    pts_time when splice_immediate is false, and cannot express a program
    splice with time_specified_flag=0 ("earliest opportunity") — use
    scte35_splice_insert_section() (binary) for *_normal types.

    Maps NexBreak splice_type → SCTE-35 splice_insert:
      *_immediate → splice_immediate=true
      auto_return → optional break_duration (90 kHz ticks) on start events
    """
    if hex_payload:
        return None

    st = (splice_type or "").strip()
    if st.endswith("_normal"):
        raise ValueError(
            f"{st}: non-immediate splice without pts_time cannot be expressed "
            "in TSDuck XML — use scte35_splice_insert_section()"
        )
    upid = (
        int(unique_program_id)
        if unique_program_id is not None
        else scte35_unique_program_id()
    )
    if st == "splice_cancel":
        body = (
            f'<splice_insert splice_event_id="{event_id}" '
            f'splice_event_cancel="true"/>'
        )
    else:
        out_of_network = "true" if st.startswith("splice_start") else "false"
        # Auto-return only meaningful on out-of-network (start) inserts.
        break_xml = ""
        if (
            auto_return
            and st.startswith("splice_start")
            and break_duration_sec is not None
            and float(break_duration_sec) > 0
        ):
            ticks = int(round(float(break_duration_sec) * 90000.0))
            break_xml = (
                f'<break_duration auto_return="true" duration="{ticks}"/>'
            )
        attrs = (
            f'splice_event_id="{event_id}" '
            f'out_of_network="{out_of_network}" '
            f'splice_immediate="true" '
            f'unique_program_id="{upid}"'
        )
        if break_xml:
            body = f"<splice_insert {attrs}>{break_xml}</splice_insert>"
        else:
            body = f"<splice_insert {attrs}/>"

    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<tsduck>\n"
        "  <splice_information_table protocol_version=\"0\">\n"
        f"    {body}\n"
        "  </splice_information_table>\n"
        "</tsduck>\n"
    )


def mpeg_crc32(data: bytes) -> int:
    """CRC-32/MPEG-2 (poly 0x04C11DB7, init 0xFFFFFFFF, no reflection/xorout)."""
    crc = 0xFFFFFFFF
    for byte in data:
        crc ^= byte << 24
        for _ in range(8):
            if crc & 0x80000000:
                crc = ((crc << 1) ^ 0x04C11DB7) & 0xFFFFFFFF
            else:
                crc = (crc << 1) & 0xFFFFFFFF
    return crc


def scte35_splice_insert_section(
    *,
    event_id: int,
    out_of_network: bool,
    immediate: bool = False,
    auto_return: bool = False,
    break_duration_sec: Optional[float] = None,
    unique_program_id: Optional[int] = None,
) -> bytes:
    """
    Build a complete binary SCTE-35 splice_info_section (TID 0xFC) carrying a
    program-level splice_insert. spliceinject accepts raw sections on its UDP
    socket (first byte 0xFC → binary).

    Used for *_normal (non-immediate) commands: program_splice_flag=1,
    splice_immediate_flag=0, splice_time() with time_specified_flag=0 —
    "splice at the earliest opportunity", which downstream encoders align to
    the next GOP/keyframe. TSDuck's XML model cannot express this form.
    """
    upid = (
        int(unique_program_id)
        if unique_program_id is not None
        else scte35_unique_program_id()
    )
    duration_ticks: Optional[int] = None
    if (
        auto_return
        and out_of_network
        and break_duration_sec is not None
        and float(break_duration_sec) > 0
    ):
        duration_ticks = int(round(float(break_duration_sec) * 90000.0)) & ((1 << 33) - 1)

    # splice_insert() command body.
    cmd = bytearray()
    cmd += int(event_id).to_bytes(4, "big")            # splice_event_id
    cmd.append(0x7F)                                   # cancel=0 + reserved(7)
    flags = 0x0F                                       # reserved(4)
    if out_of_network:
        flags |= 0x80                                  # out_of_network_indicator
    flags |= 0x40                                      # program_splice_flag=1
    if duration_ticks is not None:
        flags |= 0x20                                  # duration_flag
    if immediate:
        flags |= 0x10                                  # splice_immediate_flag
    cmd.append(flags)
    if not immediate:
        # splice_time(): time_specified_flag=0 + reserved(7)
        cmd.append(0x7F)
    if duration_ticks is not None:
        # break_duration(): auto_return(1) + reserved(6) + duration(33)
        b0 = 0x7E | ((duration_ticks >> 32) & 0x01)    # reserved '111111'
        b0 |= 0x80                                     # auto_return=1
        cmd.append(b0)
        cmd += (duration_ticks & 0xFFFFFFFF).to_bytes(4, "big")
    cmd += int(upid).to_bytes(2, "big")                # unique_program_id
    cmd.append(0)                                      # avail_num
    cmd.append(0)                                      # avails_expected

    # splice_info_section around it.
    body = bytearray()
    body.append(0x00)                                  # protocol_version
    body.append(0x00)                                  # encrypted(1)+alg(6)+pts_adj bit32
    body += (0).to_bytes(4, "big")                     # pts_adjustment low 32
    body.append(0x00)                                  # cw_index
    body.append(0xFF)                                  # tier(12)=0xFFF …
    body.append(0xF0 | ((len(cmd) >> 8) & 0x0F))       # … + command_length(12)
    body.append(len(cmd) & 0xFF)
    body.append(0x05)                                  # splice_command_type=splice_insert
    body += cmd
    body += (0).to_bytes(2, "big")                     # descriptor_loop_length=0

    section_length = len(body) + 4                     # + CRC32
    header = bytearray()
    header.append(0xFC)                                # table_id
    header.append(0x30 | ((section_length >> 8) & 0x0F))  # ssi=0 priv=0 sap='11'
    header.append(section_length & 0xFF)
    section = bytes(header) + bytes(body)
    return section + mpeg_crc32(section).to_bytes(4, "big")


def scte35_command_payload(
    *,
    splice_type: str,
    event_id: int,
    hex_payload: Optional[str] = None,
    auto_return: bool = False,
    break_duration_sec: Optional[float] = None,
) -> tuple[str, bytes]:
    """
    Build the UDP datagram for tsp spliceinject. Returns (kind, payload):
      hex — operator-supplied raw section bytes
      bin — binary splice_insert for *_normal (non-immediate, no pts_time)
      xml — TSDuck XML for *_immediate and splice_cancel
    """
    if hex_payload:
        return ("hex", hex_to_bytes(hex_payload))
    st = (splice_type or "").strip()
    if st.endswith("_normal"):
        return (
            "bin",
            scte35_splice_insert_section(
                event_id=int(event_id),
                out_of_network=st.startswith("splice_start"),
                immediate=False,
                auto_return=bool(auto_return),
                break_duration_sec=break_duration_sec,
            ),
        )
    xml = scte35_xml(
        splice_type=st,
        event_id=int(event_id),
        auto_return=bool(auto_return),
        break_duration_sec=break_duration_sec,
    )
    assert xml is not None
    return ("xml", xml.encode("utf-8"))


def hex_to_bytes(hex_payload: str) -> bytes:
    cleaned = "".join(hex_payload.split())
    if cleaned.lower().startswith("0x"):
        cleaned = cleaned[2:]
    return bytes.fromhex(cleaned)


# --- Live bitrate sensing (Channels UI + LCE target) ---

# Small bump so caption SEI / remux never under-runs the sensed program rate.
BITRATE_HEADROOM_KBPS = 10


def bitrate_run_dir() -> "Path":
    from pathlib import Path

    d = Path(os.environ.get("NEXBREAK_RUN_DIR", "/run/nexbreak")) / "bitrate"
    try:
        d.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    return d


def bitrate_state_path(service_name: str) -> "Path":
    from pathlib import Path

    return bitrate_run_dir() / f"{service_name}.json"


def output_bitrate_kbps(sensed_kbps: Optional[int]) -> Optional[int]:
    if sensed_kbps is None or sensed_kbps <= 0:
        return None
    return int(sensed_kbps) + BITRATE_HEADROOM_KBPS


def write_bitrate_state(
    service_name: str,
    *,
    sensed_kbps: Optional[int],
    output_kbps: Optional[int] = None,
) -> None:
    import json
    import time

    out = output_kbps if output_kbps is not None else output_bitrate_kbps(sensed_kbps)
    path = bitrate_state_path(service_name)
    payload = {
        "service_name": str(service_name),
        "sensed_bitrate_kbps": sensed_kbps,
        "output_bitrate_kbps": out,
        "headroom_kbps": BITRATE_HEADROOM_KBPS,
        "updated_at": time.time(),
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload) + "\n", encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        pass


def read_bitrate_state(service_name: str) -> Optional[dict[str, Any]]:
    import json
    from pathlib import Path

    path = bitrate_state_path(service_name)
    try:
        if not path.is_file():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def probe_mpegts_bitrate_kbps(
    feed_host: str,
    feed_port: int,
    *,
    timeout: float = 8.0,
) -> Optional[int]:
    """
    Sense program bitrate from the local MPEG-TS feed (post-ingest).
    Uses ffprobe format/stream bit_rate; returns kbps or None.
    """
    import json
    import subprocess

    ffprobe = which("ffprobe")
    if not ffprobe:
        return None
    url = udp_mpegts_input_url(feed_host, int(feed_port), fifo_size=500000)
    argv = [
        ffprobe,
        "-v",
        "error",
        "-hide_banner",
        "-analyzeduration",
        "3000000",
        "-probesize",
        "2000000",
        "-show_entries",
        "format=bit_rate:stream=bit_rate,codec_type",
        "-of",
        "json",
        url,
    ]
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    try:
        data = json.loads(proc.stdout.decode("utf-8", errors="replace") or "{}")
    except json.JSONDecodeError:
        return None

    best = 0
    for stream in data.get("streams") or []:
        if stream.get("codec_type") != "video":
            continue
        try:
            br = int(stream.get("bit_rate") or 0)
        except (TypeError, ValueError):
            br = 0
        if br > best:
            best = br
    if best <= 0:
        try:
            best = int((data.get("format") or {}).get("bit_rate") or 0)
        except (TypeError, ValueError):
            best = 0
    if best <= 0:
        return None
    return max(1, int(round(best / 1000.0)))


# --- Splice-monitor state (in-chain tsp splicemonitor + spliceinject lifecycle) ---


def splicemon_run_dir() -> "Path":
    from pathlib import Path

    d = Path(os.environ.get("NEXBREAK_RUN_DIR", "/run/nexbreak")) / "splicemon"
    try:
        d.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass
    return d


def splicemon_state_path(service_name: str) -> "Path":
    return splicemon_run_dir() / f"{service_name}.json"


def write_splicemon_state(service_name: str, payload: dict[str, Any]) -> None:
    import json

    path = splicemon_state_path(str(service_name))
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload) + "\n", encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        pass


def read_splicemon_state(service_name: str) -> Optional[dict[str, Any]]:
    import json

    path = splicemon_state_path(str(service_name))
    try:
        if not path.is_file():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def enrich_channel_bitrate(channel: dict[str, Any]) -> dict[str, Any]:
    """Attach sensed/output bitrate fields from run-dir state (UI)."""
    out = dict(channel)
    st = read_bitrate_state(str(channel.get("service_name") or ""))
    sensed = None
    output = None
    if st:
        try:
            sensed = int(st["sensed_bitrate_kbps"]) if st.get("sensed_bitrate_kbps") else None
        except (TypeError, ValueError):
            sensed = None
        try:
            output = int(st["output_bitrate_kbps"]) if st.get("output_bitrate_kbps") else None
        except (TypeError, ValueError):
            output = None
    if sensed is None:
        try:
            tb = channel.get("target_bitrate_kbps")
            if tb is not None:
                # Legacy stored target ≈ output; back-calc sensed for display.
                output = int(tb)
                sensed = max(1, output - BITRATE_HEADROOM_KBPS)
        except (TypeError, ValueError):
            pass
    if output is None and sensed is not None:
        output = output_bitrate_kbps(sensed)
    out["sensed_bitrate_kbps"] = sensed
    out["output_bitrate_kbps"] = output
    return out

