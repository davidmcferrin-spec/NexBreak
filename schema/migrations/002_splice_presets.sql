-- Global SCTE-35 trigger library
CREATE TABLE IF NOT EXISTS splice_presets (
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

INSERT OR IGNORE INTO splice_presets (slug, label, sort_order, enabled, splice_type, auto_return, break_duration_sec, use_channel_delay) VALUES
  ('roll',   'ROLL',   10, 1, 'splice_start_immediate', 0, NULL, 1),
  ('end',    'END',    20, 1, 'splice_end_immediate',   0, NULL, 1),
  ('cancel', 'CANCEL', 30, 1, 'splice_cancel',          0, NULL, 1),
  ('start_normal', 'Start Normal', 40, 0, 'splice_start_normal', 0, NULL, 1),
  ('end_normal',   'End Normal',   50, 0, 'splice_end_normal',   0, NULL, 1),
  ('roll_30s',     'ROLL 30s auto-return', 60, 0, 'splice_start_immediate', 1, 30.0, 1);
