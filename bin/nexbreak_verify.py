#!/usr/bin/env python3
"""SCTE return-feed verify helpers (run-dir state + tap URL resolution)."""

from __future__ import annotations

import json
import os
import re
import shutil
import signal
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Optional

from nexbreak_pipeline import resolve_local_feed_host, scte35_xml, udp_mpegts_input_url


def run_dir() -> Path:
    return Path(os.environ.get("NEXBREAK_RUN_DIR", "/run/nexbreak"))


def data_dir() -> Path:
    return Path(os.environ.get("NEXBREAK_DATA", "/var/lib/nexbreak"))


def ensure_run_subdir(name: str) -> Path:
    """Create /run/nexbreak/<name> when writable; raise OSError if not."""
    d = run_dir() / name
    d.mkdir(parents=True, exist_ok=True)
    return d


def scte_dir(*, create: bool = False) -> Path:
    """
    SCTE verify pid/state directory.

    Lives under /var/lib/nexbreak/scte (not RuntimeDirectory /run/nexbreak).
    Spawned scte-watch children can see /run as read-only under
    ProtectSystem=strict once they leave the service mount namespace;
    the data dir stays in ReadWritePaths and remains writable.
    """
    override = (os.environ.get("NEXBREAK_SCTE_DIR") or "").strip()
    d = Path(override) if override else (data_dir() / "scte")
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return d


def asr_dir(*, create: bool = False) -> Path:
    if create:
        return ensure_run_subdir("asr")
    return run_dir() / "asr"


def scte_state_path(egress_id: int) -> Path:
    return scte_dir() / f"egress-{int(egress_id)}.json"


def scte_pid_path(egress_id: int) -> Path:
    return scte_dir() / f"egress-{int(egress_id)}.pid"


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
        "last_scte_null_at": None,
        "scte_null_count": 0,
        "scte_insert_count": 0,
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


def stop_watch_pid(egress_id: int, *, timeout: float = 3.0) -> bool:
    """Stop a watch process recorded in the pidfile. Returns True if stopped/absent."""
    pid_path = scte_pid_path(egress_id)
    try:
        raw = pid_path.read_text(encoding="utf-8").strip()
        pid = int(raw)
    except Exception:
        pid = 0
    if pid > 0:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            pid = 0
        except PermissionError:
            return False
    if pid > 0:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pid = 0
        except PermissionError:
            return False
        deadline = time.time() + timeout
        while pid > 0 and time.time() < deadline:
            try:
                os.kill(pid, 0)
                time.sleep(0.05)
            except ProcessLookupError:
                break
        else:
            if pid > 0:
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


SCTE_PROBE_MARKER = "##scte##"
PSI_PROBE_MARKER = "##psi##"


def _udp_inject_scte_xml(xml: str, port: int) -> None:
    """Send one TSDuck XML splice table to spliceinject's UDP listener."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.sendto(xml.encode("utf-8"), ("127.0.0.1", int(port)))
    finally:
        sock.close()


def probe_scte_feed(
    feed_host: str,
    feed_port: int,
    *,
    duration_s: float = 10.0,
    scte_pid: Optional[int] = None,
    splice_udp_port: Optional[int] = None,
    fire_test_splice: bool = True,
) -> dict[str, Any]:
    """
    One-shot TSDuck probe of the post-splice local feed.

    Separates three facts operators confuse:
      1) packets arriving on the feed
      2) PMT declares an SCTE-35 PID (stream_type 0x86)
      3) splice_information_table sections (TID 0xFC) actually seen

    When fire_test_splice is True and splice_udp_port is set, sends a
    splice_start_immediate XML to tsp spliceinject mid-probe so the test does
    not depend on manually hitting Roll in the same window.
    """
    tsp = shutil.which("tsp") or os.environ.get("NEXBREAK_TSP", "tsp")
    if not shutil.which("tsp") and not Path(str(tsp)).is_file():
        return {"ok": False, "error": "tsp not found"}

    dest = resolve_local_feed_host(feed_host)
    port = int(feed_port)
    secs = max(5.0, min(30.0, float(duration_s)))
    argv = [
        str(tsp),
        "-I",
        "ip",
        f"{dest}:{port}",
        "--local-address",
        "127.0.0.1",
        "-P",
        "tables",
        "--tid",
        "0xFC",
        f"--log-xml-line={SCTE_PROBE_MARKER}",
        "-P",
        "psi",
        f"--log-xml-line={PSI_PROBE_MARKER}",
        "-P",
        "count",
        "--interval",
        "2",
        "-P",
        "until",
        f"--seconds={int(secs)}",
        "-O",
        "drop",
    ]
    _ = scte_pid

    test_event_id = int(time.time()) & 0x7FFFFFFF
    inject_meta: dict[str, Any] = {
        "attempted": False,
        "ok": False,
        "event_id": test_event_id,
        "splice_udp_port": splice_udp_port,
        "error": None,
    }

    def _fire() -> None:
        time.sleep(max(1.5, secs * 0.25))
        if not fire_test_splice or not splice_udp_port:
            return
        inject_meta["attempted"] = True
        try:
            xml = scte35_xml(
                splice_type="splice_start_immediate",
                event_id=test_event_id,
            )
            assert xml is not None
            _udp_inject_scte_xml(xml, int(splice_udp_port))
            # Immediate commands are inserted once; send a second copy in case
            # the first datagram arrived before PTS lock.
            time.sleep(0.4)
            _udp_inject_scte_xml(xml, int(splice_udp_port))
            inject_meta["ok"] = True
        except Exception as exc:  # noqa: BLE001
            inject_meta["error"] = str(exc)

    starter = threading.Thread(target=_fire, name="scte-probe-inject", daemon=True)
    starter.start()

    started = time.time()
    try:
        proc = subprocess.run(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=secs + 8.0,
            check=False,
        )
        err = (proc.stderr or b"").decode("utf-8", errors="replace")
    except subprocess.TimeoutExpired as exc:
        err = (exc.stderr or b"").decode("utf-8", errors="replace") if exc.stderr else ""
        proc = None  # type: ignore[assignment]
    except FileNotFoundError:
        return {"ok": False, "error": f"tsp not executable: {tsp}"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
    finally:
        starter.join(timeout=1.0)

    sections: list[str] = []
    pmt_scte_pids: list[int] = []
    packets = 0
    for line in err.splitlines():
        if SCTE_PROBE_MARKER in line:
            idx = line.find(SCTE_PROBE_MARKER)
            blob = line[idx + len(SCTE_PROBE_MARKER) :].strip()
            if blob.startswith("<"):
                sections.append(blob[:400])
        if PSI_PROBE_MARKER in line and (
            "0x86" in line.lower() or 'stream_type="134"' in line
        ):
            for m in re.finditer(
                r'(?:elementary_)?pid="?(0x[0-9A-Fa-f]+|\d+)"?'
                r'[^>]*stream_type="?(?:0x86|134)"?'
                r'|stream_type="?(?:0x86|134)"?[^>]*'
                r'(?:elementary_)?pid="?(0x[0-9A-Fa-f]+|\d+)"?',
                line,
                re.I,
            ):
                raw = m.group(1) or m.group(2)
                try:
                    pid = int(raw, 0)
                except ValueError:
                    continue
                if pid not in pmt_scte_pids:
                    pmt_scte_pids.append(pid)
        m = re.search(r"(\d[\d,]*)\s+packets?", line, re.I)
        if m:
            try:
                packets = max(packets, int(m.group(1).replace(",", "")))
            except ValueError:
                pass

    has_traffic = (
        packets > 0 or bool(sections) or bool(pmt_scte_pids) or "ip:" in err.lower()
    )
    if not has_traffic and proc is not None and proc.returncode == 0 and len(err) > 40:
        has_traffic = "error" not in err.lower()[:200]

    saw_test = any(str(test_event_id) in s for s in sections)

    if not has_traffic and not sections and not pmt_scte_pids:
        verdict = "no_packets"
        summary = (
            f"No usable packets on {dest}:{port} in {secs:.0f}s — "
            "is nexbreak-proc running and routed?"
        )
    elif pmt_scte_pids and not sections:
        verdict = "pmt_ok_no_sections"
        if inject_meta.get("attempted") and inject_meta.get("ok"):
            summary = (
                f"PMT declares SCTE-35 PID(s) {pmt_scte_pids} but no TID 0xFC "
                f"after a test UDP inject to spliceinject :{splice_udp_port} "
                f"(event_id={test_event_id}). spliceinject is not placing "
                "sections on the feed — restart nexbreak-proc after deploy "
                "(needs stuffing + PTS lock)."
            )
        elif inject_meta.get("attempted"):
            summary = (
                f"PMT has SCTE PID(s) {pmt_scte_pids}; test inject failed: "
                f"{inject_meta.get('error')}"
            )
        else:
            summary = (
                f"PMT declares SCTE-35 PID(s) {pmt_scte_pids} but no TID 0xFC "
                f"sections in {secs:.0f}s — no test inject was sent "
                "(pass splice_udp_port / fire_test_splice)."
            )
    elif sections and not pmt_scte_pids:
        verdict = "sections_without_pmt"
        summary = (
            f"Saw {len(sections)} SCTE section(s) but PMT 0x86 not parsed — "
            "markers are on the wire."
        )
    elif sections:
        verdict = "scte_on_wire"
        extra = ""
        if inject_meta.get("attempted"):
            extra = (
                f" Test splice event_id={test_event_id} "
                + (
                    "seen."
                    if saw_test
                    else "sent but not matched in XML (null splices may dominate)."
                )
            )
        summary = (
            f"Confirmed: {len(sections)} SCTE-35 section(s) on feed "
            f"{dest}:{port}; PMT SCTE PID(s)={pmt_scte_pids or 'unparsed'}."
            + extra
        )
    else:
        verdict = "pmt_missing"
        summary = (
            f"Feed has traffic but no PMT SCTE-35 (0x86) and no TID 0xFC "
            f"in {secs:.0f}s — inject path may not be declaring/adding the PID."
        )

    return {
        "ok": True,
        "verdict": verdict,
        "summary": summary,
        "feed_dest": dest,
        "feed_port": port,
        "duration_s": secs,
        "elapsed_s": round(time.time() - started, 2),
        "packets_seen": packets,
        "pmt_scte_pids": pmt_scte_pids,
        "section_count": len(sections),
        "section_samples": sections[:5],
        "tsp_rc": None if proc is None else proc.returncode,
        "test_inject": inject_meta,
        "test_event_seen": saw_test,
    }
