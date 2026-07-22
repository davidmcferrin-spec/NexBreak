-- NexBreak schema additions for the media path (SQLite).
-- Safe to re-run: each ALTER is ignored if the column already exists
-- when applied via bin/nexbreak_db.migrate().

-- SCTE-35 PID declared in the PMT (stream type 0x86)
-- ALTER: processing_channels.scte35_pid INTEGER NOT NULL DEFAULT 500

-- UDP port where tsp spliceinject listens (127.0.0.1 only)
-- ALTER: processing_channels.splice_udp_port INTEGER

-- Prefer copy vs re-encode on ingest (copy|transcode)
-- ALTER: processing_channels.ingest_mode TEXT NOT NULL DEFAULT 'copy'
