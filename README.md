# NexBreak

Per-stream SCTE-35 splice insertion, live captioning, and a software
routing matrix for broadcast contribution feeds.

**Status:** one-channel media path wired (RTSP/SRT → TSDuck spliceinject →
local MPEG-TS UDP feed → SRT egress). Web UI + controller on Apache.
See `CLAUDE.md` for the full design record.

## What it does

- Up to 4 feeds (RTSP, SRT, DeckLink) → SRT/HLS egress
- Manual SCTE-35 splice control per stream (Streamdeck / DNF / web Roll)
- Global **Triggers** preset library (immediate/normal, auto-return, hex)
- Operator-tunable trigger→insertion delay (pre-roll for GOP-aligned cues)
- Panel REST documented in [`docs/panel-api.md`](docs/panel-api.md)
- Support bundle (Services zip) in [`docs/support-bundle.md`](docs/support-bundle.md)
- Shared caption lexicon + blacklist; caption policy auto/force ASR/off with CEA-608 on SRT
- Software router between processed feeds and egress adapters

## Test environment

**Ubuntu 24.04 + Apache + PHP.** There is no PHP built-in server workflow.
DocumentRoot is `web/`; the browser talks same-origin `/api/*`, which PHP
proxies to `nexbreak-controller` on `127.0.0.1:8787`.

## Layout

```
nexbreak/
  schema/nexbreak.sql
  systemd/          controller + proc@ + egress@
  bin/
    nexbreak-controller     REST API + splice fan-out
    nexbreak-proc           ffmpeg | tsp spliceinject → UDP feed
    nexbreak-egress         UDP feed → SRT (ffmpeg)
    nexbreak_pipeline.py    argv builders
    nexbreak_control.py     Unix-socket client to proc
  web/              Apache DocumentRoot
  config/apache-nexbreak.conf
  scripts/install-ubuntu.sh
```

## One-channel signal path

```
RTSP/SRT source  (ffmpeg client_pull, low-latency flags)
    → ffmpeg → MPEG-TS pipe
    → tsp --add-input-stuffing
         -P pmt (SCTE-35 PID 0x86)
         -P spliceinject --udp 127.0.0.1:<feed+1000>
         -O ip 127.0.0.1:<local_feed_port>
         ├─→ nexbreak-egress → SRT
         └─→ ffmpeg preview → RTSP publish → MediaMTX → WHEP (browser)
```

Splice path:

```
Web/panel → GET|POST /api/v1/splice?preset=roll&processing_channel_id=1&key=…
         → controller (resolve preset → XML/hex)
         → Unix socket /run/nexbreak/proc-<id>.sock
         → if splice_insertion_delay_ms > 0: wait (hold trigger)
         → UDP SCTE-35 XML/hex → tsp spliceinject
           (if offset < 0: video already held by timeshift before inject)
         → null-strip → pcrbitrate → regulate → local UDP feed → SRT/HLS
```

Panel / StreamDeck / DNF USP3-16 URL cookbook: **[`docs/panel-api.md`](docs/panel-api.md)**.
Configure presets in the web **Triggers** page.
### WebRTC preview

| Piece | Detail |
|---|---|
| MediaMTX | `config/mediamtx.yml` · `nexbreak-mediamtx.service` |
| Path | `nb{service_name}` (override via `preview_path`) |
| WHEP | `http://<host>:8889/nb1/whep` |
| Media | UDP/TCP **8189** |
| UI | Embedded players on **Roll** (stereo VU + mute/volume) |

```bash
sudo systemctl enable --now nexbreak-mediamtx
# ufw (LAN):
sudo ufw allow 8889/tcp comment 'NexBreak WHEP'
sudo ufw allow 8189 comment 'NexBreak WebRTC media'
```

Set a real RTSP URL on Channels → Input 1, restart `nexbreak-proc@1`, open Roll.

### Verify SCTE on the egress (return feed)

Open **Verify**, pick an output, click **Listen**, then fire a splice from **Roll**.
Listener SRT outputs are checked with a second local caller into our port; push
egresses fall back to the routed post-splice local feed. Markers appear in the
sightings table (and match recent audit commands when `event_id` aligns).

### Caption policy (per stream → SRT egress)

| Policy | Behavior |
|---|---|
| `auto` | Preserve source CC when detected; else ASR → CEA-608 CC1 (A/53) on the program feed |
| `force_asr` | Always ASR insert (channel re-encodes to H.264+A53 while active) |
| `off` | No ASR; source CC still preserved on remux |

ASR runs as an isolated worker (Vosk). While `effective_mode=asr_insert`,
`nexbreak-cc-inject` runs **Live Caption Encoder** (`cc_injector`): UDP text →
CEA-608 A/53 side data → libx264 `a53cc=1` → MPEG-TS into tsp. Roll’s
CC Auto / Force ASR / Off button cycles this policy; stereo VU meters are
browser-local confidence monitors (Web Audio), not the program path.

```bash
# Set policy (may restart that channel's pipeline on mode flip):
curl -X POST http://127.0.0.1:8787/v1/processing/1/captioning \
  -H 'Content-Type: application/json' -d '{"policy":"force_asr"}'

# Legacy: {"enabled":0|1} maps to off|auto
```

Install ASR + the CEA-608 injector:

```bash
sudo bash scripts/install-ubuntu.sh vosk
sudo bash scripts/install-ubuntu.sh cc-injector
sudo systemctl restart nexbreak-proc@1
```

`vosk` sets `NEXBREAK_VOSK_MODEL` on `nexbreak-proc@*`. `cc-injector` builds
the vendored Live Caption Encoder into `/usr/local/bin/cc_injector`. Without
the binary, inject falls back to a caption-less remux (path stays up). Then set
caption policy to **Force ASR**.

## Ubuntu bring-up

```bash
sudo bash scripts/install-ubuntu.sh deps
sudo bash scripts/install-ubuntu.sh install
sudo bash scripts/install-ubuntu.sh init-db

# deps also installs chrony, enables NTP, and sets timezone
# America/New_York (override with NEXBREAK_TIMEZONE=...).

# Point channel 1 at a real RTSP source (SQL or Channels UI), then:
sudo systemctl enable --now nexbreak-controller
sudo systemctl enable --now nexbreak-proc@1
sudo systemctl enable --now nexbreak-egress@1

# Dry-run the planned argv without starting capture:
sudo -u nexbreak python3 /opt/nexbreak/bin/nexbreak-proc \
  --service-name 1 --db /var/lib/nexbreak/nexbreak.sqlite --dry-run
```

Apache site: `config/apache-nexbreak.conf` (installed as `nexbreak.conf`).
Open `http://<host>/` for the UI.

**Channels** edits processing inputs and egress outputs (SRT caller/listener/
rendezvous, HLS origin_pull — Apache serves `/hls/<svc>/index.m3u8`). Transport
changes need a unit restart.

**Services** / **Metrics** mirror NexVUE ops: `install` drops allowlisted
`/usr/local/bin/nexbreak-ops-*.sh` + `/etc/sudoers.d/nexbreak-ops` so the
Services page can status/journal/restart channel units as `www-data`.
Services also builds a **support bundle** zip (journals + redacted
config/state for 1–72h) — see [`docs/support-bundle.md`](docs/support-bundle.md).
Metrics shows live host resources (CPU, load, memory, disk, uptime, GPU when
present) plus splice/config/routing activity from `audit_events`.

### Troubleshooting: "controller unreachable" / API 500

1. On the Ubuntu box:
   ```bash
   systemctl status nexbreak-controller
   curl -sS http://127.0.0.1:8787/v1/health
   ```
2. From your workstation browser open `http://<host>/api/diag.php` —
   it reports PHP curl/`allow_url_fopen` and whether the controller answers.
3. Ensure `php-curl` is installed and `mod_rewrite` is enabled:
   ```bash
   sudo apt-get install -y php-curl
   sudo a2enmod rewrite
   sudo systemctl reload apache2
   ```
4. Redeploy `web/api/.htaccess` + `web/api/index.php` (a bad nested rewrite
   to `api/api/index.php` was a common cause of HTTP 500).


### Packages

| Tool | Role |
|---|---|
| `ffmpeg` (libsrt + libopus) | Ingest, SRT egress, preview RTSP publish |
| `tsduck` (`tsp`) | PMT SCTE declare + `spliceinject` |
| `mediamtx` | WHEP WebRTC preview |
| Apache + `libapache2-mod-php` | UI + `/api` proxy |
| Python 3 stdlib | Controller / service orchestration |

### Port map (defaults for seeded channels)

| Channel | Local feed UDP | spliceinject UDP | SRT listen |
|---|---|---|---|
| 1 | 19001 | 20001 | 9001 |
| 2 | 19002 | 20002 | 9002 |
| … | … | feed+1000 | … |

## UI styling

NexVUE dark ops console (cyan accent, monospace, theme toggle), with
NexAlert toast/API patterns and NexWAYPOINT early theme apply.
