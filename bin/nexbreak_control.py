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
    timeout: float = 60.0,
) -> dict[str, Any]:
    body: dict[str, Any] = {"cmd": "splice", "splice_type": splice_type}
    if hex_payload:
        body["hex_payload"] = hex_payload
    if event_id is not None:
        body["event_id"] = event_id
    # Allow delay_ms up to ~channel delay + inject overhead
    return proc_request(sock_path, body, timeout=timeout)
