#!/usr/bin/env python3
"""Send a JSON command to a nexbreak-proc Unix control socket (one request/response line)."""

from __future__ import annotations

import json
import socket
from typing import Any, Optional


def proc_request(sock_path: str, payload: dict[str, Any], timeout: float = 30.0) -> dict[str, Any]:
    data = (json.dumps(payload) + "\n").encode("utf-8")
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect(sock_path)
        sock.sendall(data)
        buf = b""
        while b"\n" not in buf:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
    finally:
        sock.close()
    if not buf:
        raise ConnectionError(f"no response from {sock_path}")
    return json.loads(buf.decode("utf-8").split("\n", 1)[0])


def send_splice(
    sock_path: str,
    *,
    splice_type: str,
    hex_payload: Optional[str] = None,
    event_id: Optional[int] = None,
    auto_return: bool = False,
    break_duration_sec: Optional[float] = None,
    use_channel_delay: bool = True,
    timeout: float = 60.0,
) -> dict[str, Any]:
    body: dict[str, Any] = {"cmd": "splice", "splice_type": splice_type}
    if hex_payload:
        body["hex_payload"] = hex_payload
    if event_id is not None:
        body["event_id"] = event_id
    if auto_return:
        body["auto_return"] = True
    if break_duration_sec is not None:
        body["break_duration_sec"] = float(break_duration_sec)
    body["use_channel_delay"] = bool(use_channel_delay)
    # Allow delay_ms up to ~channel delay + inject overhead
    return proc_request(sock_path, body, timeout=timeout)


def send_caption_set(
    sock_path: str,
    *,
    enabled: Optional[bool] = None,
    policy: Optional[str] = None,
    timeout: float = 15.0,
) -> dict[str, Any]:
    """Hot-set caption policy / enable on a running proc (may restart pipeline)."""
    body: dict[str, Any] = {"cmd": "caption_set"}
    if policy is not None:
        body["policy"] = policy
    if enabled is not None:
        body["enabled"] = bool(enabled)
    return proc_request(sock_path, body, timeout=timeout)


def send_caption_status(sock_path: str, timeout: float = 1.5) -> dict[str, Any]:
    return proc_request(sock_path, {"cmd": "caption_status"}, timeout=timeout)
