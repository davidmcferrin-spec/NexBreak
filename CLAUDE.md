# NexBreak

Status: architecture locked for v1; one-channel media path implemented
(RTSP/SRT → TSDuck SCTE-35 → local UDP feed → SRT). Apache is the only
supported web front end. This doc is the source of truth for design
decisions — update it as the build progresses.

## What this is

NexBreak is the expansion/rename of the earlier `sdi-ingest-pipeline` project.
It ingests up to 4 independent video streams (RTSP, SRT, or DeckLink SDI-in)
and produces SRT/HLS egress with operator-controlled SCTE-35/SCTE-104 splice
insertion, live closed captioning, and a software routing matrix between
inputs and outputs. DeckLink SDI-out is architected for but deferred past v1.

## Non-negotiable v1 requirements

- Full manual splice control: hex payload, splice now, delayed, auto return,
  splice_start_immediate, splice_start_normal, splice_cancel — per stream,
  triggering one stream's splice never touches another.
- Trigger-to-insertion delay is operator-tunable per channel (compliant
  encoders need a GOP/keyframe-aligned splice point, not an instant one).
- Control surfaces: REST API driven by a Streamdeck, a DNF USP3-16 panel
  (HTTP GET/POST per button — no special SDK needed), and a web UI with a
  roll button.
- Full low-latency WebRTC preview per stream, plus a dashboard: event log,
  timestamps, a thumbnail captured at the moment of insertion, and the
  source/user/IP that triggered it.
- Live closed captioning: ASR-driven, using the existing splice pre-roll
  delay as processing headroom so captioning adds no extra latency budget.
  Caption text only — no audio ducking/beeping.
  - Shared blacklist library (compliance): a blacklisted word is omitted
    from the caption text entirely, no placeholder.
  - Shared phonetic lexicon library (accuracy): feeds the ASR engine's
    pronunciation dictionary to improve recognition before transcription,
    not a post-hoc correction pass.
- Software stream router: each input's processed feed (post-splice,
  post-caption) is decoupled from any specific output. The routing table
  assigns processed feeds to egress adapters — not fixed 1-in/1-out.
- Every input and every output is independently configurable per channel:
  - SRT: caller / listener / rendezvous
  - RTSP: client_pull (we connect out, standard case) or server_push (we'd
    need an embedded RTSP server — confirm this is actually needed before
    building it, see Open items)
  - HLS: origin_pull (we host, CDN/viewer pulls) or push_put (we push
    segments to a remote ingest) — confirm which the target CDN expects
- Everything — sources/destinations, logs, audio, codecs — configurable via
  the web UI. No hand-editing config files for day-to-day operation.
- Extensive logging on input/output/commands/insertion, per stream.

## Service architecture — this is the core design decision

Each stream is its own OS-level service, for maintenance and failure
isolation: restarting or reconfiguring one channel must never affect
another, and a crash in one must never take down another.

- **Processing service** (one per physical input): ingest (RTSP/SRT/
  DeckLink) → normalize/transcode as needed → SCTE-35/104 splice injection
  → caption insertion → writes to a locally-addressable feed (the "output"
  the router can pick up). Runs as `nexbreak-proc@<id>.service`
  (systemd template unit — each instance is independently started, stopped,
  and restarted; a crash in `nexbreak-proc@4` cannot affect `@1`, `@2`, `@3`).
- **Egress service** (one per output destination): reads a locally-addressable
  feed (assigned by the router, not hardwired to a specific processing
  service) → packages for SRT or HLS → delivers. Runs as
  `nexbreak-egress@<id>.service`, same isolation model.
- **Controller** (single instance): owns the SQLite config/state/audit store,
  serves the control API and the routing table, and is what the web UI and
  panels talk to. It also needs a safe way to start/stop/restart specific
  systemd instances — see security note below.
- The processing↔egress decoupling is what makes the router possible: a
  processing service doesn't know or care which egress service (if any)
  is currently consuming its feed. Reassigning "input 1 now feeds output 3"
  is a controller-side table update, not a restart of either service.

### Security note — flagging now, not deciding yet

The web UI (PHP under Apache, running as `www-data`) needs to start/stop/
restart specific systemd units. Giving `www-data` broad sudo rights to
`systemctl` is a real risk. Two options to weigh before building this part:
1. A narrowly-scoped sudoers rule limited to exactly
   `systemctl {start,stop,restart} nexbreak-proc@* nexbreak-egress@*`.
2. A small privileged helper daemon (not running as `www-data`) that the
   controller talks to over a local Unix socket, which is the only thing
   allowed to call `systemctl`. More moving parts, meaningfully smaller
   attack surface. Leaning this direction unless there's a reason not to.

## Data model (see schema/nexbreak.sql)

- `processing_channels` — one row per input, all its config
- `egress_channels` — one row per output, all its config
- `routing_assignments` — which processing feed currently feeds which egress
  adapter (many egress→one processing is allowed for simulcast; each egress
  adapter has exactly one active source)
- `audit_events` — splice commands, service lifecycle events, config changes;
  always carries triggering identity, source IP, and result
- `caption_lexicon` / `caption_blacklist` — shared across all channels
- `control_credentials` — identity for API callers (panels, StreamDeck, web
  sessions) — audit requires knowing *who*, not just *that*

## Stack and constraints

- Ubuntu 24.04 LTS, Apache, PHP, Python services, vanilla JS. No Docker, no
  Node.js, no Composer, no pip beyond stdlib — external tools (TSDuck,
  ffmpeg/GStreamer, Vosk) are invoked as subprocesses/binaries, not pip
  packages, to stay inside that constraint.
- SQLite as the config/state/audit store (stdlib `sqlite3` in Python, PDO
  in PHP — no extra dependency).
- SCTE-35 (SRT/HLS path): TSDuck packet-level injection, same pattern as
  `sdi-ingest-pipeline`.
- SCTE-104 (future SDI-out path): requires libklvanc + the Blackmagic
  DeckLink SDK directly (C/C++) — no off-the-shelf tool writes VANC. Deferred
  to the SDI-out phase.
- Captioning: leaning Vosk/Kaldi over Whisper specifically because the
  phonetic-lexicon and blacklist requirements need a decoder with an actual
  pronunciation-lexicon layer, which Whisper (end-to-end) doesn't have.
  Not yet validated on real hardware — see Open items.

## Hardware target (under evaluation)

HP Z1 G1i Tower (BS7N2UT#ABA base config: Core Ultra 5, integrated graphics
only, 32GB DDR5, 3 usable PCIe slots — 1x PCIe5 x16, 1x PCIe3 x16-physical/
x4-electrical, 1x PCIe3 x1). A single DeckLink Quad 2 covers all 4 SDI-in
channels in one x4 slot; the x16 slot is free for a future SDI-out card or
NIC upgrade. Confirmed 1GbE is sufficient at ~13-15Mbps × 4 streams. Whether
the base integrated GPU/CPU tier is sufficient depends on the open items
below — don't finalize the purchase until those are answered.

## Open items (need answers before/while building the affected part)

- RTSP: do any real sources need `server_push`, or are they all
  `client_pull`? Changes whether an embedded RTSP server is in scope.
- HLS: does the target CDN expect `origin_pull` or `push_put`? Changes
  whether push-ingest is built for v1.
- Captioning compute: Vosk on CPU for 2 concurrent real-time streams is
  plausible but unverified on this specific hardware — needs a proof-of-
  concept before finalizing GPU/CPU spec or committing to 2 vs 4 channels.
- Video/audio codec + resolution/frame-rate targets per channel, needed to
  finalize encode load estimates.
- Blacklist/lexicon library: confirmed shared across all channels.

## Build order

See the plan in the project kickoff notes — schema and service skeleton
first, one channel end-to-end before replicating to 4, captioning and
preview layered in after the core signal path is proven.

### Scaffold progress (2026-07-22)

Done:
- `schema/nexbreak.sql` + migrations (`scte35_pid`, `splice_udp_port`, `ingest_mode`,
  `rtsp_transport`, `preview_enabled`, `preview_path`)
- systemd units + `scripts/install-ubuntu.sh` + Apache vhost + MediaMTX
- `nexbreak-controller` REST API; splice fan-out via `/run/nexbreak/proc-*.sock`
- `nexbreak-proc`: ffmpeg RTSP/SRT ingest → tsp spliceinject → UDP feed
  + MediaMTX RTSP preview publisher (WHEP)
- `nexbreak-egress`: UDP local feed → SRT (ffmpeg)
- `web/` UI: Dashboard, Roll (with live preview), Preview, Channels, Router,
  Captions, Audit; `/api` PHP proxy to controller

Next:
- Hardware bring-up of channel 1 against a real RTSP source
- Privileged helper for systemctl (leaning Unix-socket helper over sudoers)
- Caption ASR (Vosk) using splice pre-roll as headroom
- HLS egress mode
- TLS on MediaMTX when UI is HTTPS (same NexVUE pattern)
