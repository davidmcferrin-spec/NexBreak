"""
Host resource snapshot for Metrics (stdlib only).

Reads /proc and optional vendor tools (nvidia-smi). Safe on non-Linux:
returns available=False instead of raising.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import time
from typing import Any, Optional

# Previous /proc/stat sample for non-blocking CPU % (shared across requests).
_CPU_PREV: Optional[tuple[float, list[int]]] = None


def _read_text(path: str) -> Optional[str]:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return None


def _parse_meminfo(text: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, rest = line.split(":", 1)
        parts = rest.strip().split()
        if not parts:
            continue
        try:
            kib = int(parts[0])
        except ValueError:
            continue
        out[key] = kib * 1024
    return out


def _cpu_times() -> Optional[list[int]]:
    text = _read_text("/proc/stat")
    if not text:
        return None
    for line in text.splitlines():
        if line.startswith("cpu "):
            parts = line.split()[1:]
            try:
                return [int(x) for x in parts]
            except ValueError:
                return None
    return None


def _cpu_percent() -> Optional[float]:
    """Idle-delta CPU usage since the previous sample (None on first call)."""
    global _CPU_PREV
    now = time.monotonic()
    times = _cpu_times()
    if times is None or len(times) < 4:
        return None
    prev = _CPU_PREV
    _CPU_PREV = (now, times)
    if prev is None:
        return None
    _, old = prev
    # Align shorter/longer vectors (kernel versions differ).
    n = min(len(old), len(times))
    if n < 4:
        return None
    deltas = [times[i] - old[i] for i in range(n)]
    total = sum(deltas)
    if total <= 0:
        return 0.0
    idle = deltas[3] + (deltas[4] if n > 4 else 0)  # idle + iowait
    busy = total - idle
    pct = 100.0 * busy / total
    return round(max(0.0, min(100.0, pct)), 1)


def _loadavg() -> Optional[dict[str, float]]:
    try:
        a, b, c = os.getloadavg()
        return {"1m": round(a, 2), "5m": round(b, 2), "15m": round(c, 2)}
    except (AttributeError, OSError):
        text = _read_text("/proc/loadavg")
        if not text:
            return None
        parts = text.split()
        if len(parts) < 3:
            return None
        try:
            return {
                "1m": round(float(parts[0]), 2),
                "5m": round(float(parts[1]), 2),
                "15m": round(float(parts[2]), 2),
            }
        except ValueError:
            return None


def _uptime_seconds() -> Optional[float]:
    text = _read_text("/proc/uptime")
    if not text:
        return None
    try:
        return float(text.split()[0])
    except (IndexError, ValueError):
        return None


def _memory() -> Optional[dict[str, Any]]:
    text = _read_text("/proc/meminfo")
    if not text:
        return None
    m = _parse_meminfo(text)
    total = m.get("MemTotal", 0)
    available = m.get("MemAvailable")
    if available is None:
        available = m.get("MemFree", 0) + m.get("Buffers", 0) + m.get("Cached", 0)
    used = max(0, total - available) if total else 0
    percent = round(100.0 * used / total, 1) if total else 0.0
    swap_total = m.get("SwapTotal", 0)
    swap_free = m.get("SwapFree", 0)
    swap_used = max(0, swap_total - swap_free) if swap_total else 0
    swap_pct = round(100.0 * swap_used / swap_total, 1) if swap_total else 0.0
    return {
        "total_bytes": total,
        "available_bytes": available,
        "used_bytes": used,
        "percent": percent,
        "swap_total_bytes": swap_total,
        "swap_used_bytes": swap_used,
        "swap_percent": swap_pct,
    }


def _disk(path: str = "/") -> Optional[dict[str, Any]]:
    try:
        st = os.statvfs(path)
    except OSError:
        return None
    total = st.f_frsize * st.f_blocks
    free = st.f_frsize * st.f_bavail
    used = max(0, total - free)
    percent = round(100.0 * used / total, 1) if total else 0.0
    return {
        "path": path,
        "total_bytes": total,
        "used_bytes": used,
        "available_bytes": free,
        "percent": percent,
    }


def _nvidia_gpus() -> list[dict[str, Any]]:
    smi = shutil.which("nvidia-smi")
    if not smi:
        return []
    try:
        proc = subprocess.run(
            [
                smi,
                "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=2.0,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if proc.returncode != 0 or not proc.stdout.strip():
        return []
    gpus: list[dict[str, Any]] = []
    for line in proc.stdout.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 5:
            continue
        name = parts[0]

        def _num(s: str) -> Optional[float]:
            if not s or s.upper() in ("N/A", "[N/A]", "NA"):
                return None
            try:
                return float(s)
            except ValueError:
                return None

        util = _num(parts[1])
        mem_used_mib = _num(parts[2])
        mem_total_mib = _num(parts[3])
        temp = _num(parts[4])
        entry: dict[str, Any] = {
            "vendor": "nvidia",
            "name": name,
            "utilization_percent": util,
            "temperature_c": temp,
        }
        if mem_used_mib is not None:
            entry["memory_used_bytes"] = int(mem_used_mib * 1024 * 1024)
        if mem_total_mib is not None:
            entry["memory_total_bytes"] = int(mem_total_mib * 1024 * 1024)
        gpus.append(entry)
    return gpus


def _sysfs_gpu_busy(card_path: str) -> Optional[float]:
    """AMD often exposes gpu_busy_percent; Intel/others may not."""
    p = os.path.join(card_path, "device", "gpu_busy_percent")
    if not os.path.isfile(p):
        return None
    text = _read_text(p)
    if text is None:
        return None
    try:
        return float(text.strip())
    except ValueError:
        return None


def _drm_gpus() -> list[dict[str, Any]]:
    """Fallback when nvidia-smi is absent: list DRM cards + AMD busy % if present."""
    base = "/sys/class/drm"
    if not os.path.isdir(base):
        return []
    gpus: list[dict[str, Any]] = []
    try:
        names = sorted(os.listdir(base))
    except OSError:
        return []
    for name in names:
        # card0, card1 — skip card0-HDMI-A-1 style connectors
        if not name.startswith("card") or "-" in name:
            continue
        card = os.path.join(base, name)
        vendor = "unknown"
        vendor_id = _read_text(os.path.join(card, "device", "vendor"))
        if vendor_id:
            vid = vendor_id.strip().lower()
            if vid in ("0x10de",):
                vendor = "nvidia"
            elif vid in ("0x1002", "0x1022"):
                vendor = "amd"
            elif vid in ("0x8086",):
                vendor = "intel"
        label = name
        uevent = _read_text(os.path.join(card, "device", "uevent"))
        if uevent:
            for line in uevent.splitlines():
                if line.startswith("DRIVER="):
                    label = f"{name} ({line.split('=', 1)[1]})"
                    break
        entry: dict[str, Any] = {
            "vendor": vendor,
            "name": label,
            "utilization_percent": _sysfs_gpu_busy(card),
            "temperature_c": None,
        }
        gpus.append(entry)
    return gpus


def _gpus() -> list[dict[str, Any]]:
    nvidia = _nvidia_gpus()
    if nvidia:
        return nvidia
    return _drm_gpus()


def host_snapshot() -> dict[str, Any]:
    """
    Live host resource snapshot for Metrics.

    On non-Linux (no /proc), returns available=False with an error string.
    """
    if not os.path.isdir("/proc"):
        return {
            "available": False,
            "error": "host metrics require Linux /proc",
        }

    try:
        hostname = socket.gethostname()
    except OSError:
        hostname = ""

    mem = _memory()
    disk = _disk("/")
    load = _loadavg()
    uptime = _uptime_seconds()
    gpus = _gpus()

    return {
        "available": True,
        "hostname": hostname,
        "uptime_seconds": uptime,
        "loadavg": load,
        "cpu": {
            "count": os.cpu_count() or 0,
            "percent": _cpu_percent(),
        },
        "memory": mem,
        "disk": disk,
        "gpu": gpus,
        "sampled_at": time.time(),
    }
