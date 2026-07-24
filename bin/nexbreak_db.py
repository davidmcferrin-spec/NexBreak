#!/usr/bin/env python3
"""Shared SQLite helpers for NexBreak services (stdlib only)."""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import string
from pathlib import Path
from typing import Any, Iterable, Optional


DEFAULT_DB = os.environ.get("NEXBREAK_DB", "/var/lib/nexbreak/nexbreak.sqlite")

# Panel / StreamDeck / DNF shared API key (URL query or X-Api-Key).
PANEL_API_KEY_LEN = 12
PANEL_CREDENTIAL_LABEL = "Panel / StreamDeck / DNF"
_PANEL_KEY_ALPHABET = string.ascii_letters + string.digits


def connect(db_path: Optional[str] = None) -> sqlite3.Connection:
    path = db_path or DEFAULT_DB
    conn = sqlite3.connect(path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_schema(conn: sqlite3.Connection, schema_path: Optional[str] = None) -> None:
    if schema_path is None:
        here = Path(__file__).resolve().parent.parent
        schema_path = str(here / "schema" / "nexbreak.sql")
    sql = Path(schema_path).read_text(encoding="utf-8")
    conn.executescript(sql)
    conn.commit()
    migrate(conn)


def _column_names(conn: sqlite3.Connection, table: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {r[1] for r in rows}


def migrate(conn: sqlite3.Connection) -> None:
    """Idempotent column adds for existing DBs created before the media path."""
    cols = _column_names(conn, "processing_channels")
    alters: list[str] = []
    if "ingest_mode" not in cols:
        alters.append(
            "ALTER TABLE processing_channels ADD COLUMN ingest_mode TEXT NOT NULL DEFAULT 'copy'"
        )
    if "scte35_pid" not in cols:
        alters.append(
            "ALTER TABLE processing_channels ADD COLUMN scte35_pid INTEGER NOT NULL DEFAULT 500"
        )
    if "splice_udp_port" not in cols:
        alters.append(
            "ALTER TABLE processing_channels ADD COLUMN splice_udp_port INTEGER"
        )
    if "rtsp_transport" not in cols:
        alters.append(
            "ALTER TABLE processing_channels ADD COLUMN rtsp_transport TEXT NOT NULL DEFAULT 'tcp'"
        )
    if "preview_enabled" not in cols:
        alters.append(
            "ALTER TABLE processing_channels ADD COLUMN preview_enabled BOOLEAN NOT NULL DEFAULT 1"
        )
    if "preview_path" not in cols:
        alters.append(
            "ALTER TABLE processing_channels ADD COLUMN preview_path TEXT"
        )
    added_policy = False
    if "caption_policy" not in cols:
        alters.append(
            "ALTER TABLE processing_channels ADD COLUMN caption_policy TEXT NOT NULL DEFAULT 'auto'"
        )
        added_policy = True
    for stmt in alters:
        conn.execute(stmt)
    if alters:
        conn.commit()
    # Keep caption_policy ↔ captioning_enabled consistent (idempotent).
    if "caption_policy" in _column_names(conn, "processing_channels"):
        if added_policy:
            # First introduction: derive policy from legacy enabled flag.
            conn.execute(
                """
                UPDATE processing_channels
                SET caption_policy = CASE
                  WHEN COALESCE(captioning_enabled, 0) = 0 THEN 'off'
                  ELSE 'auto'
                END
                """
            )
        conn.execute(
            """
            UPDATE processing_channels
            SET caption_policy = 'auto'
            WHERE IFNULL(caption_policy, '') NOT IN ('off', 'auto', 'force_asr')
            """
        )
        conn.execute(
            """
            UPDATE processing_channels
            SET captioning_enabled = CASE WHEN caption_policy = 'off' THEN 0 ELSE 1 END
            """
        )
        conn.commit()

    # SCTE return-feed sightings (Verify page)
    tables = {
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    if "scte_sightings" not in tables:
        conn.executescript(
            """
            CREATE TABLE scte_sightings (
                id                      INTEGER PRIMARY KEY AUTOINCREMENT,
                egress_channel_id       INTEGER REFERENCES egress_channels(id) ON DELETE SET NULL,
                processing_channel_id   INTEGER REFERENCES processing_channels(id) ON DELETE SET NULL,
                event_id                INTEGER,
                splice_type             TEXT,
                out_of_network          INTEGER,
                verified                BOOLEAN NOT NULL DEFAULT 0,
                source                  TEXT NOT NULL CHECK (source IN ('srt','feed')),
                raw_snip                TEXT,
                raw_hex                 TEXT,
                seen_at                 TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX idx_scte_sightings_egress ON scte_sightings(egress_channel_id, seen_at);
            CREATE INDEX idx_scte_sightings_proc ON scte_sightings(processing_channel_id, seen_at);
            """
        )
        conn.commit()
    scols = _column_names(conn, "scte_sightings")
    if scols and "raw_hex" not in scols:
        conn.execute("ALTER TABLE scte_sightings ADD COLUMN raw_hex TEXT")
        conn.commit()

    # Panel API credentials (12-char key for DNF / StreamDeck / Roll)
    tables = {
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    if "control_credentials" not in tables:
        conn.executescript(
            """
            CREATE TABLE control_credentials (
                id                      INTEGER PRIMARY KEY AUTOINCREMENT,
                label                   TEXT NOT NULL,
                key_hash                TEXT NOT NULL,
                api_key                 TEXT,
                created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_used_at            TIMESTAMP,
                revoked                 BOOLEAN NOT NULL DEFAULT 0
            );
            """
        )
        conn.commit()
    else:
        ccols = _column_names(conn, "control_credentials")
        if "api_key" not in ccols:
            conn.execute("ALTER TABLE control_credentials ADD COLUMN api_key TEXT")
            conn.commit()

    # Global SCTE trigger presets (Roll + panel URLs)
    tables = {
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    if "splice_presets" not in tables:
        conn.executescript(
            """
            CREATE TABLE splice_presets (
                id                      INTEGER PRIMARY KEY AUTOINCREMENT,
                slug                    TEXT NOT NULL UNIQUE,
                label                   TEXT NOT NULL,
                sort_order              INTEGER NOT NULL DEFAULT 0,
                enabled                 BOOLEAN NOT NULL DEFAULT 1,
                splice_type             TEXT NOT NULL CHECK (splice_type IN (
                                            'splice_start_immediate','splice_start_normal',
                                            'splice_end_immediate','splice_end_normal',
                                            'splice_cancel'
                                        )),
                hex_payload             TEXT,
                auto_return             BOOLEAN NOT NULL DEFAULT 0,
                break_duration_sec      REAL,
                use_channel_delay       BOOLEAN NOT NULL DEFAULT 1,
                created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT INTO splice_presets (slug, label, sort_order, enabled, splice_type, auto_return, break_duration_sec, use_channel_delay) VALUES
              ('roll',   'ROLL',   10, 1, 'splice_start_immediate', 0, NULL, 1),
              ('end',    'END',    20, 1, 'splice_end_immediate',   0, NULL, 1),
              ('cancel', 'CANCEL', 30, 1, 'splice_cancel',          0, NULL, 1),
              ('start_normal', 'Start Normal', 40, 0, 'splice_start_normal', 0, NULL, 1),
              ('end_normal',   'End Normal',   50, 0, 'splice_end_normal',   0, NULL, 1),
              ('roll_30s',     'ROLL 30s auto-return', 60, 0, 'splice_start_immediate', 1, 30.0, 1);
            """
        )
        conn.commit()


SPLICE_TYPES = (
    "splice_start_immediate",
    "splice_start_normal",
    "splice_end_immediate",
    "splice_end_normal",
    "splice_cancel",
)


def _slugify(raw: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", (raw or "").strip().lower()).strip("_")
    return s or "preset"


def list_splice_presets(
    conn: sqlite3.Connection, *, enabled_only: bool = False
) -> list[dict[str, Any]]:
    sql = "SELECT * FROM splice_presets"
    if enabled_only:
        sql += " WHERE enabled = 1"
    sql += " ORDER BY sort_order ASC, id ASC"
    return rows_to_dicts(conn.execute(sql).fetchall())


def get_splice_preset(
    conn: sqlite3.Connection,
    *,
    preset_id: Optional[int] = None,
    slug: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    if preset_id is not None:
        return row_to_dict(
            conn.execute(
                "SELECT * FROM splice_presets WHERE id = ?", (int(preset_id),)
            ).fetchone()
        )
    if slug:
        return row_to_dict(
            conn.execute(
                "SELECT * FROM splice_presets WHERE slug = ?", (str(slug).strip(),)
            ).fetchone()
        )
    return None


def upsert_splice_preset(
    conn: sqlite3.Connection,
    fields: dict[str, Any],
    *,
    preset_id: Optional[int] = None,
) -> dict[str, Any]:
    label = str(fields.get("label") or "").strip()
    if not label:
        raise ValueError("label required")
    splice_type = str(fields.get("splice_type") or "").strip()
    if splice_type not in SPLICE_TYPES:
        raise ValueError(f"invalid splice_type {splice_type}")
    slug = str(fields.get("slug") or "").strip() or _slugify(label)
    slug = re.sub(r"[^a-z0-9_]+", "", slug.lower())
    if not slug:
        raise ValueError("slug required")
    sort_order = int(fields.get("sort_order") or 0)
    enabled = 1 if fields.get("enabled", True) else 0
    hex_payload = fields.get("hex_payload")
    if hex_payload is not None:
        hex_payload = str(hex_payload).strip() or None
    auto_return = 1 if fields.get("auto_return") else 0
    break_duration_sec = fields.get("break_duration_sec")
    if break_duration_sec is not None and break_duration_sec != "":
        break_duration_sec = float(break_duration_sec)
    else:
        break_duration_sec = None
    use_channel_delay = 1 if fields.get("use_channel_delay", True) else 0

    if preset_id is None:
        cur = conn.execute(
            """
            INSERT INTO splice_presets (
                slug, label, sort_order, enabled, splice_type, hex_payload,
                auto_return, break_duration_sec, use_channel_delay
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                slug,
                label,
                sort_order,
                enabled,
                splice_type,
                hex_payload,
                auto_return,
                break_duration_sec,
                use_channel_delay,
            ),
        )
        preset_id = int(cur.lastrowid)
    else:
        conn.execute(
            """
            UPDATE splice_presets SET
                slug = ?, label = ?, sort_order = ?, enabled = ?,
                splice_type = ?, hex_payload = ?, auto_return = ?,
                break_duration_sec = ?, use_channel_delay = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (
                slug,
                label,
                sort_order,
                enabled,
                splice_type,
                hex_payload,
                auto_return,
                break_duration_sec,
                use_channel_delay,
                int(preset_id),
            ),
        )
    conn.commit()
    out = get_splice_preset(conn, preset_id=preset_id)
    assert out is not None
    return out


def delete_splice_preset(conn: sqlite3.Connection, preset_id: int) -> bool:
    cur = conn.execute("DELETE FROM splice_presets WHERE id = ?", (int(preset_id),))
    conn.commit()
    return cur.rowcount > 0


def splice_udp_port_for(channel: dict[str, Any]) -> int:
    """Loopback UDP port for tsp spliceinject; default local_feed_port + 1000."""
    explicit = channel.get("splice_udp_port")
    if explicit is not None:
        return int(explicit)
    return int(channel["local_feed_port"]) + 1000


def cc_udp_endpoint_for(channel: dict[str, Any]) -> str:
    """
    HOST:PORT for Live Caption Encoder text ingest.
    Default: 127.0.0.1:(local_feed_port + 3000) → e.g. 19001 → 22001.
    Override with NEXBREAK_CC_UDP or channel-local env later if needed.
    """
    env = (os.environ.get("NEXBREAK_CC_UDP") or "").strip()
    if env:
        return env
    host = "127.0.0.1"
    port = int(channel["local_feed_port"]) + 3000
    return f"{host}:{port}"


def preview_path_for(channel: dict[str, Any]) -> str:
    """MediaMTX path name for WHEP preview (e.g. nb1)."""
    explicit = (channel.get("preview_path") or "").strip()
    if explicit:
        return explicit
    return f"nb{channel['service_name']}"


def control_sock_path(service_name: str) -> str:
    """Unix socket path the controller uses to reach nexbreak-proc@N."""
    base = os.environ.get("NEXBREAK_RUN_DIR", "/run/nexbreak")
    return str(Path(base) / f"proc-{service_name}.sock")


def row_to_dict(row: Optional[sqlite3.Row]) -> Optional[dict[str, Any]]:
    if row is None:
        return None
    return {k: row[k] for k in row.keys()}


def rows_to_dicts(rows: Iterable[sqlite3.Row]) -> list[dict[str, Any]]:
    return [row_to_dict(r) for r in rows]  # type: ignore[misc]


def get_processing_by_service(conn: sqlite3.Connection, service_name: str) -> Optional[dict[str, Any]]:
    cur = conn.execute(
        "SELECT * FROM processing_channels WHERE service_name = ?",
        (service_name,),
    )
    return row_to_dict(cur.fetchone())


def get_egress_by_service(conn: sqlite3.Connection, service_name: str) -> Optional[dict[str, Any]]:
    cur = conn.execute(
        "SELECT * FROM egress_channels WHERE service_name = ?",
        (service_name,),
    )
    return row_to_dict(cur.fetchone())


def audit(
    conn: sqlite3.Connection,
    *,
    event_type: str,
    result: str = "success",
    processing_channel_id: Optional[int] = None,
    egress_channel_id: Optional[int] = None,
    splice_type: Optional[str] = None,
    splice_hex_payload: Optional[str] = None,
    thumbnail_path: Optional[str] = None,
    triggered_by_credential_id: Optional[int] = None,
    source_ip: Optional[str] = None,
    detail: Optional[str] = None,
) -> int:
    cur = conn.execute(
        """
        INSERT INTO audit_events (
            processing_channel_id, egress_channel_id, event_type,
            splice_type, splice_hex_payload, thumbnail_path,
            triggered_by_credential_id, source_ip, result, detail
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            processing_channel_id,
            egress_channel_id,
            event_type,
            splice_type,
            splice_hex_payload,
            thumbnail_path,
            triggered_by_credential_id,
            source_ip,
            result,
            detail,
        ),
    )
    conn.commit()
    return int(cur.lastrowid)


def generate_panel_api_key(length: int = PANEL_API_KEY_LEN) -> str:
    """URL-safe random key for panel GET URLs (?key=…)."""
    n = max(8, int(length))
    return "".join(secrets.choice(_PANEL_KEY_ALPHABET) for _ in range(n))


def hash_api_key(key: str) -> str:
    return hashlib.sha256(str(key).encode("utf-8")).hexdigest()


def _write_panel_key_file(key: str, db_path: Optional[str] = None) -> None:
    """Best-effort sidecar file for ops / PHP (same dir as the SQLite DB)."""
    try:
        db = Path(db_path or DEFAULT_DB)
        path = db.parent / "panel-api.key"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(str(key).strip() + "\n", encoding="utf-8")
        try:
            os.chmod(path, 0o640)
        except OSError:
            pass
    except OSError:
        pass


def ensure_panel_credential(
    conn: sqlite3.Connection,
    *,
    db_path: Optional[str] = None,
) -> dict[str, Any]:
    """
    Ensure one active panel credential exists. Returns {id, label, api_key}.
    Creates a new 12-char key when missing or when plaintext was never stored.
    """
    migrate(conn)
    row = conn.execute(
        """
        SELECT * FROM control_credentials
        WHERE revoked = 0
        ORDER BY id ASC
        LIMIT 1
        """
    ).fetchone()
    if row is not None:
        cred = row_to_dict(row) or {}
        key = (cred.get("api_key") or "").strip()
        if key and len(key) == PANEL_API_KEY_LEN:
            _write_panel_key_file(key, db_path=db_path)
            return {
                "id": int(cred["id"]),
                "label": cred.get("label") or PANEL_CREDENTIAL_LABEL,
                "api_key": key,
            }
        # Legacy hash-only row — rotate so panel URLs can be shown again.
        return rotate_panel_credential(conn, db_path=db_path, credential_id=int(cred["id"]))

    key = generate_panel_api_key()
    cur = conn.execute(
        """
        INSERT INTO control_credentials (label, key_hash, api_key, revoked)
        VALUES (?, ?, ?, 0)
        """,
        (PANEL_CREDENTIAL_LABEL, hash_api_key(key), key),
    )
    conn.commit()
    _write_panel_key_file(key, db_path=db_path)
    return {
        "id": int(cur.lastrowid),
        "label": PANEL_CREDENTIAL_LABEL,
        "api_key": key,
    }


def rotate_panel_credential(
    conn: sqlite3.Connection,
    *,
    db_path: Optional[str] = None,
    credential_id: Optional[int] = None,
) -> dict[str, Any]:
    """Revoke previous active keys and mint a new 12-char panel key."""
    migrate(conn)
    conn.execute("UPDATE control_credentials SET revoked = 1 WHERE revoked = 0")
    key = generate_panel_api_key()
    cur = conn.execute(
        """
        INSERT INTO control_credentials (label, key_hash, api_key, revoked)
        VALUES (?, ?, ?, 0)
        """,
        (PANEL_CREDENTIAL_LABEL, hash_api_key(key), key),
    )
    conn.commit()
    _write_panel_key_file(key, db_path=db_path)
    return {
        "id": int(cur.lastrowid),
        "label": PANEL_CREDENTIAL_LABEL,
        "api_key": key,
    }


def lookup_credential_by_key(
    conn: sqlite3.Connection,
    key: Optional[str],
) -> Optional[dict[str, Any]]:
    """Match a presented API key against active credentials (constant-time hash)."""
    raw = (key or "").strip()
    if not raw or len(raw) > 128:
        return None
    presented = hash_api_key(raw)
    rows = conn.execute(
        """
        SELECT * FROM control_credentials
        WHERE revoked = 0 AND key_hash IS NOT NULL
        """
    ).fetchall()
    for row in rows:
        stored = str(row["key_hash"] or "")
        if stored and hmac.compare_digest(presented, stored):
            cred = row_to_dict(row)
            if cred is None:
                return None
            # Prefer DB plaintext; fall back to presented key for legacy rows.
            if not (cred.get("api_key") or "").strip():
                cred["api_key"] = raw
            try:
                conn.execute(
                    """
                    UPDATE control_credentials
                    SET last_used_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (int(cred["id"]),),
                )
                conn.commit()
            except sqlite3.Error:
                pass
            return cred
    return None
