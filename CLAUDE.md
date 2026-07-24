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
- Trigger-to-insertion timing offset is operator-tunable per channel
 (±2000 ms): positive holds the trigger; negative holds the video
 (timeshift) so a late Roll can still mark earlier frames. Compliant
 encoders still GOP/keyframe-align the actual cut.
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
  - **Per-stream caption policy** (`caption_policy`): `off` | `auto` | `force_asr`.
    Auto preserves source CEA when present, otherwise ASR-inserts CEA-608 CC1
    (A/53) into the program feed for SRT egress. Force ASR always inserts
    (H.264+A53 re-encode for that channel). Off stops ASR but still remux-
    preserves source CC. Vosk crash never kills ingest/splice; inject is on
    the core path only while `effective_mode=asr_insert`.
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
  panels talk to for config/splice/routing. It also needs a safe way to
  start/stop/restart specific systemd instances — see security note below.
- **Verify** (single instance, `nexbreak-verify`): SCTE return-feed monitor
  API on loopback `:8788` — spawn/stop `nexbreak-scte-watch`, `/run/nexbreak/scte`
  state, `scte_sightings`. Isolated from the controller so ProtectSystem
  / RuntimeDirectory ownership for watch state cannot break the control plane.
  PHP `/api` proxies `/v1/verify/*` here; everything else goes to the controller.
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
- `control_credentials` — 12-char panel API key (hash + plaintext for URL
  copy; sidecar `panel-api.key` next to the DB). Required on `/v1/splice`
  (`?key=` / `X-Api-Key` / Bearer). Audit sets `triggered_by_credential_id`.

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
- `nexbreak-verify` SCTE return-feed Verify API (`:8788`); PHP `/api` routes
  `/v1/verify/*` there (not the controller)
- `nexbreak-proc`: ffmpeg RTSP/SRT ingest → tsp spliceinject → UDP feed
  + MediaMTX RTSP preview publisher (WHEP)
  + caption policy (auto preserve / force ASR / off) with CEA-608 A/53 insert
    into the local feed when ASR is required; Vosk sidecar + cc-inject
- `nexbreak-egress`: UDP local feed → SRT (tsp) or HLS origin_pull (ffmpeg →
  `/var/lib/nexbreak/hls/<svc>/`, Apache `/hls/`)
- SCTE insertion visibility (2026-07-23): tsp now runs `--verbose` with an
 in-chain `-P splicemonitor --json-line=##splicemon##` between spliceinject
 and the null filter (lossless insertion proof; splice_null keepalives emit
 nothing → no noise). `nexbreak-proc` drains tsp stderr into structured
 state — spliceinject lifecycle counters (received/enqueued/injected/
 dropped) + splicemonitor events — at `/run/nexbreak/splicemon/<svc>.json`,
 in the proc `status` reply (`splice_monitor`), and via controller
 `GET /v1/processing/<id>/splicemon`. Verify page shows an "Insertion
 engine" panel from it. Splice command sends are single-shot (one trigger
 = one splice_insert in the stream) — the splicemonitor confirms delivery,
 so repeats aren't needed; `NEXBREAK_SPLICE_SEND_COUNT`/`_GAP_MS` can
 restore repeats on a lossy path. spliceinject injects immediate inserts
 exactly once per command (one TS packet; `--inject-count` only applies
 to pts_time commands). Key spliceinject facts (verified in TSDuck
 source): nothing is injected — keepalives included — before PTS lock on
 the service video/PCR PID, and only null packets are replaced (hence
 `--add-input-stuffing 1/8`). Env gates: `NEXBREAK_TSP_VERBOSE=0`,
 `NEXBREAK_SPLICEMON=0`.
- SCTE payload fix (2026-07-23): TSDuck's XML model REQUIRES
 `unique_program_id` on non-cancel `<splice_insert>` (its absence made
 spliceinject reject every command) and REQUIRES `pts_time` when
 `splice_immediate="false"` — XML cannot express "program splice at
 earliest opportunity". So: `scte35_xml()` (immediate/cancel only) now sets
 `unique_program_id` (`NEXBREAK_UNIQUE_PROGRAM_ID`, default 1);
 `splice_start_normal`/`splice_end_normal` are built as binary
 splice_info_sections (`scte35_splice_insert_section()`,
 time_specified_flag=0, MPEG CRC32) — spliceinject takes raw sections on
 the same UDP socket (first byte 0xFC). `scte35_command_payload()` routes
 hex/bin/xml; proc counts spliceinject command errors as `rejected` in the
 splice-monitor state and the Verify panel shows the last reject line.
- Verify test cues (2026-07-23): Listen no longer auto-fires splices by
 default — test cues are OPT-IN (UI checkbox → `auto_inject_sec: 12`,
 server default 0) because they are real SCTE-35 markers downstream
 receivers act on. Test cues use event ids 0x50000000–0x5FFFFFFF and are
 badged "test" in Sent/Received; duplicate copies of the same command
 (only when NEXBREAK_SPLICE_SEND_COUNT>1) collapse into one Received row
 with a ×N repeat counter (30s window, scte-watch). There is
 no command queue anywhere in the splice path: spliceinject injects
 immediates on arrival, UDP does not backlog.
- Payload inspector (2026-07-23): click any Sent/Received row on Verify to
 see the exact splice payload. Received: scte-watch tables plugin now also
 runs `--log-hexa-line=##sctehex##`, pairs hex↔XML per section (event-id
 sanity check), stores full XML in `raw_snip` + raw section hex in new
 `scte_sightings.raw_hex` (migrated). Sent: proc/scte-watch append
 `payload:<hex>` to the splice audit detail — Verify decodes it (XML text
 or binary section); Audit/Dashboard strip the suffix for readability.
 Fixed: TSDuck XML event ids are hex ("0x0000004D") — parse_scte_xml now
 uses base-0 int, so Sent↔Received matching/dedupe actually correlate.
- Signed splice timing offset (2026-07-23): `splice_insertion_delay_ms` is
 now ±2000 ms. Positive = hold the trigger (existing sleep in proc).
 Negative = hold the video via `-P timeshift` before spliceinject (adds
 |offset| feed latency; sized by `--packets` from sensed bitrate ×9/8
 stuffing, else `--time`). When negative and preview is on, a pretap fork
 (`local_feed_port+2000`) feeds the preview publisher *before* the hold so
 Roll-page triggering still aligns. Hot-apply via proc `config_set`;
 pipeline restarts when entering/leaving/changing a negative value.
 Channels UI: horizontal slider (−2s video hold … 0 … +2s trigger hold)
 with live ms/frame hint; Roll shows "trigger held" / "video held".
- Feed smoothness (2026-07-23): shared proc path was the hitch source for
 both SRT and HLS — stuffing then null-strip with no pacing + aggressive
 ingest `nobuffer+discardcorrupt`. Defaults now: softer ingest (real RTSP
 probe, `-copyts` on remux; `NEXBREAK_INGEST_LOW_DELAY=1` restores the old
 ultra-low-delay flags), and after null-strip `-P pcrbitrate -P regulate`
 paces the local feed (`NEXBREAK_FEED_REGULATE=0` to disable). Egress
 ffmpeg paths no longer use `discardcorrupt`.
- `web/` UI: Dashboard, Roll (live WHEP + stereo VU / mute / volume from
  NexVUE; caption policy cycle; former Preview page redirects here),
  Channels (processing + egress editors; Source dropdown routes input→egress;
  Copy URL for SRT listener / HLS M3U8; former Router page redirects here),
  Captions, Verify, Services (systemd/journal via allowlisted sudo wrappers —
  no controller; **Support bundle** zip: journals + redacted config/state for
  1–72h — see `docs/support-bundle.md`), Metrics (host CPU/mem/disk/uptime/GPU +
  audit-derived splice/config/routing activity), Audit; `/api` PHP proxy to
  controller/verify
- Panel API key (2026-07-23): controller mints a 12-char key on boot;
  `/v1/splice` requires it (query `key`, `X-Api-Key`, or Bearer). Triggers
  page reveals/copies/rotates and embeds `&key=` in StreamDeck/DNF URLs;
  Roll sends `X-Api-Key` via `nexbreak-api.js`. See `docs/panel-api.md`.
- Support bundle (2026-07-24): Services one-click zip via
  `nexbreak-ops-support-bundle.sh` → `bin/nexbreak-support-bundle` (journals,
  systemd status, redacted channel/routing/presets/audit, `/run/nexbreak`
  state, host/versions, host metric samples). Secrets stripped; safe for
  bake-in hand-off.
- Metrics history + routing UX (2026-07-24): controller samples CPU/mem/swap/GPU
  every 15s into `host_metric_samples` (72h retain); Metrics page line charts
  for 15m–72h; uptime footer-only; disk not logged. Routing snapshot
  Processing→Egress with shared color accents on Channels. Egress hot-applies
  routing changes (~1s rebuild). About page lists stack/OSS components.
- Pipeline stability (2026-07-24): ingest/egress SRT default latency 1200ms +
  8MiB rcvbuf/sndbuf + peeridletimeout (env `NEXBREAK_SRT_*`); ingest stderr
  watch recycles on libsrt overflow; local-feed video watchdog + in-process
  pipeline recycle (no systemd exit loop); preview optional maps + backoff
  when feed empty. Captions/ASR overlay JSON moved to
  `/var/lib/nexbreak/captions` + `/var/lib/nexbreak/asr` (fixes EROFS on
  `/run/nexbreak/captions`); `RuntimeDirectoryPreserve=yes` on shared units.
  Bake-in helper: `scripts/ops/nexbreak-bakein-watch.sh`.

Next:
- Hardware bring-up of channel 1 against a real RTSP source
- Optional: replace sudoers ops wrappers with Unix-socket privileged helper
- HLS `push_put` remote ingest
- TLS on MediaMTX when UI is HTTPS (same NexVUE pattern)
- CEA-708 service layer (CC1 A/53 shipped first)
