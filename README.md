# NexBreak

Per-stream SCTE-35 splice insertion, live captioning, and a software
routing matrix for broadcast contribution feeds.

**Status:** one-channel media path wired (RTSP/SRT → TSDuck spliceinject →
local MPEG-TS UDP feed → SRT egress). Web UI + controller on Apache.
See `CLAUDE.md` for the full design record.

## What it does

- Up to 4 feeds (RTSP, SRT, DeckLink) → SRT/HLS egress
- Manual SCTE-35 splice control per stream (Streamdeck / DNF / web Roll)
- Operator-tunable trigger→insertion delay (pre-roll for GOP-aligned cues)
- Shared caption lexicon + blacklist (ASR path still pending)
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
Web/panel → POST /api/v1/splice → controller
         → Unix socket /run/nexbreak/proc-<id>.sock
         → wait splice_insertion_delay_ms
         → UDP SCTE-35 XML/hex → tsp spliceinject
```

### WebRTC preview

| Piece | Detail |
|---|---|
| MediaMTX | `config/mediamtx.yml` · `nexbreak-mediamtx.service` |
| Path | `nb{service_name}` (override via `preview_path`) |
| WHEP | `http://<host>:8889/nb1/whep` |
| Media | UDP/TCP **8189** |
| UI | **Preview** page + embedded players on **Roll** |

```bash
sudo systemctl enable --now nexbreak-mediamtx
# ufw (LAN):
sudo ufw allow 8889/tcp comment 'NexBreak WHEP'
sudo ufw allow 8189 comment 'NexBreak WebRTC media'
```

Set a real RTSP URL on Channels → Input 1, restart `nexbreak-proc@1`, open Preview.

### Captioning / Vosk bypass (per stream)

Captions run as an **isolated sidecar** of `nexbreak-proc@N` — never in the
fatal ffmpeg|tsp watch set.

| Action | Effect |
|---|---|
| Off / bypass | Vosk worker SIGTERM'd; model unloaded; no ASR CPU |
| On | Worker starts for that stream only |
| Worker crash | Auto-restart with backoff; **ingest/splice keep running** |

```bash
# Hot toggle (no service restart):
curl -X POST http://127.0.0.1:8787/v1/processing/1/captioning \
  -H 'Content-Type: application/json' -d '{"enabled":0}'

# Or Roll UI → CC ON/OFF, or Captions page → per-stream table
```

Optional model path: `NEXBREAK_VOSK_MODEL=/path/to/vosk-model` on the proc
unit. Without it the worker idles in bypass-ready mode so enable/disable
can still be validated.

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
rendezvous, HLS modes — HLS not wired in the egress binary yet). Transport
changes need a unit restart.

**Services** / **Metrics** mirror NexVUE ops: `install` drops allowlisted
`/usr/local/bin/nexbreak-ops-*.sh` + `/etc/sudoers.d/nexbreak-ops` so the
Services page can status/journal/restart channel units as `www-data`.
Metrics charts splice/config/routing activity from `audit_events`.

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
