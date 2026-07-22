# NexBreak

Per-stream SCTE-35/104 splice insertion, live captioning, and a software
routing matrix for broadcast contribution feeds. Expansion of the earlier
`sdi-ingest-pipeline` project.

**Status:** architecture complete for v1, implementation starting. See
`CLAUDE.md` for the full design record — this file is the short version.

## What it does

- Takes in up to 4 feeds (RTSP, SRT, or DeckLink SDI) and produces SRT/HLS
  egress, ~13-15Mbps per stream.
- Manual SCTE-35/104 splice control (hex payload, all splice types) from a
  Streamdeck, a DNF USP3-16 panel, or a web UI roll button — per stream,
  fully isolated from the others.
- Operator-tunable delay between trigger and actual insertion, for
  GOP-aligned splicing.
- Live ASR closed captioning with a shared phonetic lexicon (accuracy) and
  a shared blacklist (compliance — blacklisted words are omitted from
  caption text, audio is untouched).
- A routing matrix: any input's processed feed (post-splice, post-caption)
  can be assigned to any output, not a fixed 1-in/1-out pairing.
- Full WebRTC preview per stream, plus a dashboard with event log,
  timestamps, insertion thumbnails, and who/where triggered each event.

## Requirements

- Ubuntu 24.04 LTS, Apache, PHP, Python 3 (stdlib only — see `CLAUDE.md`
  for why), SQLite.
- TSDuck (SCTE-35 injection), GStreamer/FFmpeg with Intel Quick Sync
  (ingest/encode).
- Vosk (ASR — evaluation pending, see Open items in `CLAUDE.md`).
- Blackmagic DeckLink SDK + libklvanc (future SDI-out phase only — not
  required for v1).

## Layout

```
nexbreak/
  CLAUDE.md              — full architecture and decision record
  README.md              — this file
  schema/nexbreak.sql    — SQLite schema (config, routing, audit, captioning)
  systemd/
    nexbreak-proc@.service    — templated unit, one instance per input
    nexbreak-egress@.service  — templated unit, one instance per output
  bin/                   — (not yet created) nexbreak-proc, nexbreak-egress,
                            controller/web API
  web/                   — (not yet created) PHP admin UI
```

## Service model

Each input and each output runs as its own systemd service instance
(`nexbreak-proc@<id>`, `nexbreak-egress@<id>`). A crash or restart on one
channel never affects another. A single controller process owns the SQLite
store and the routing table, and is what the web UI and control panels talk
to. See `CLAUDE.md` for the security note on how the controller is allowed
to start/stop specific service instances.
