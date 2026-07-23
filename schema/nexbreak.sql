-- NexBreak core schema (SQLite)
-- One row per physical input in processing_channels, one row per physical
-- output in egress_channels. routing_assignments is the decoupling layer
-- that lets any processing feed be assigned to any egress adapter.

PRAGMA foreign_keys = ON;

CREATE TABLE processing_channels (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    name                    TEXT NOT NULL,
    service_name            TEXT NOT NULL UNIQUE,     -- systemd instance id, e.g. 'proc1'

    input_type              TEXT NOT NULL CHECK (input_type IN ('rtsp','srt','decklink')),

    -- SRT input settings (input_type = 'srt')
    srt_mode                TEXT CHECK (srt_mode IN ('caller','listener','rendezvous')),
    srt_remote_host         TEXT,
    srt_remote_port         INTEGER,
    srt_listen_port         INTEGER,

    -- RTSP input settings (input_type = 'rtsp')
    rtsp_role               TEXT CHECK (rtsp_role IN ('client_pull','server_push')),
    rtsp_url                TEXT,
    -- tcp (default) or udp for ffmpeg -rtsp_transport
    rtsp_transport          TEXT NOT NULL DEFAULT 'tcp'
                            CHECK (rtsp_transport IN ('tcp','udp')),

    -- DeckLink input settings (input_type = 'decklink')
    decklink_device_index   INTEGER,

    -- Normalization / encode target
    video_codec             TEXT,
    audio_codec             TEXT,
    target_bitrate_kbps     INTEGER,
    -- copy = remux when possible; transcode = force H.264/AAC via ffmpeg
    ingest_mode             TEXT NOT NULL DEFAULT 'copy'
                            CHECK (ingest_mode IN ('copy','transcode')),

    -- Splice behavior
    splice_insertion_delay_ms INTEGER NOT NULL DEFAULT 0,
    -- SCTE-35 PID declared in the PMT (stream type 0x86)
    scte35_pid              INTEGER NOT NULL DEFAULT 500,
    -- UDP port tsp spliceinject listens on (loopback). NULL = local_feed_port + 1000
    splice_udp_port         INTEGER,

    -- Captioning
    -- off = no ASR (source CC still preserved on remux);
    -- auto = preserve source CC if present, else ASR insert;
    -- force_asr = always ASR insert (H.264+A53; replaces source CC)
    caption_policy          TEXT NOT NULL DEFAULT 'auto'
                            CHECK (caption_policy IN ('off','auto','force_asr')),
    -- Derived / back-compat: 0 iff policy=off; else 1 (ASR may run)
    captioning_enabled      BOOLEAN NOT NULL DEFAULT 1,

    -- WebRTC preview (MediaMTX path name, e.g. nb1). NULL = 'nb' || service_name
    preview_enabled         BOOLEAN NOT NULL DEFAULT 1,
    preview_path            TEXT,

    -- Addressable local output the router reads from
    local_feed_host         TEXT NOT NULL DEFAULT '127.0.0.1',
    local_feed_port         INTEGER NOT NULL,

    enabled                 BOOLEAN NOT NULL DEFAULT 1,
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE egress_channels (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    name                    TEXT NOT NULL,
    service_name            TEXT NOT NULL UNIQUE,     -- systemd instance id, e.g. 'egress1'

    output_type             TEXT NOT NULL CHECK (output_type IN ('srt','hls')),

    -- SRT output settings (output_type = 'srt')
    srt_mode                TEXT CHECK (srt_mode IN ('caller','listener','rendezvous')),
    srt_remote_host         TEXT,
    srt_remote_port         INTEGER,
    srt_listen_port         INTEGER,

    -- HLS output settings (output_type = 'hls')
    hls_mode                TEXT CHECK (hls_mode IN ('origin_pull','push_put')),
    hls_push_url            TEXT,

    target_bitrate_kbps     INTEGER,

    enabled                 BOOLEAN NOT NULL DEFAULT 1,
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Each egress adapter has exactly one active source; a processing feed may
-- be assigned to more than one egress adapter (simulcast), so the unique
-- constraint lives on egress_channel_id only.
CREATE TABLE routing_assignments (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    processing_channel_id   INTEGER NOT NULL REFERENCES processing_channels(id) ON DELETE CASCADE,
    egress_channel_id       INTEGER NOT NULL UNIQUE REFERENCES egress_channels(id) ON DELETE CASCADE,
    assigned_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE control_credentials (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    label                   TEXT NOT NULL,             -- e.g. 'DNF panel - MCR', 'Streamdeck - Bay 2'
    key_hash                TEXT NOT NULL,
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at            TIMESTAMP,
    revoked                 BOOLEAN NOT NULL DEFAULT 0
);

CREATE TABLE audit_events (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    processing_channel_id   INTEGER REFERENCES processing_channels(id) ON DELETE SET NULL,
    egress_channel_id       INTEGER REFERENCES egress_channels(id) ON DELETE SET NULL,

    event_type              TEXT NOT NULL CHECK (event_type IN (
                                'splice_command','service_start','service_stop',
                                'service_crash','config_change','routing_change'
                            )),

    -- Populated for event_type = 'splice_command'
    splice_type             TEXT CHECK (splice_type IN (
                                'splice_start_immediate','splice_start_normal',
                                'splice_end_immediate','splice_end_normal',
                                'splice_cancel'
                            )),
    splice_hex_payload      TEXT,
    thumbnail_path          TEXT,

    triggered_by_credential_id INTEGER REFERENCES control_credentials(id),
    source_ip               TEXT,
    result                   TEXT NOT NULL CHECK (result IN ('success','failure')),
    detail                   TEXT,

    occurred_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_events_channel ON audit_events(processing_channel_id, occurred_at);
CREATE INDEX idx_audit_events_type ON audit_events(event_type, occurred_at);

-- Shared across all channels, per project decision
CREATE TABLE caption_lexicon (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    word                    TEXT NOT NULL UNIQUE,
    phonetic                TEXT NOT NULL,             -- pronunciation entry for the ASR lexicon
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE caption_blacklist (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    word                    TEXT NOT NULL UNIQUE,
    created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- SCTE-35 markers observed on a return-feed / post-splice tap (Verify page)
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
    seen_at                 TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_scte_sightings_egress ON scte_sightings(egress_channel_id, seen_at);
CREATE INDEX idx_scte_sightings_proc ON scte_sightings(processing_channel_id, seen_at);

-- Global SCTE-35 trigger library (Roll buttons + StreamDeck/DNF URLs)
CREATE TABLE splice_presets (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    slug                    TEXT NOT NULL UNIQUE,      -- URL key: roll, end, cancel, …
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

