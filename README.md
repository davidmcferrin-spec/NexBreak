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
RTSP/SRT source
    → ffmpeg (copy or transcode) → MPEG-TS pipe
    → tsp --add-input-stuffing
         -P pmt (SCTE-35 PID 0x86)
         -P spliceinject --udp 127.0.0.1:<feed+1000>
         -O ip 127.0.0.1:<local_feed_port>
    → [router assigns feed to an egress]
    → ffmpeg udp://feed → srt://… (listener or caller)
```

Splice path:

```
Web/panel → POST /api/v1/splice → controller
         → Unix socket /run/nexbreak/proc-<id>.sock
         → wait splice_insertion_delay_ms
         → UDP SCTE-35 XML/hex → tsp spliceinject
```

## Ubuntu bring-up

```bash
sudo bash scripts/install-ubuntu.sh deps
sudo bash scripts/install-ubuntu.sh install
sudo bash scripts/install-ubuntu.sh init-db

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

### Packages

| Tool | Role |
|---|---|
| `ffmpeg` (with libsrt) | Ingest remux/transcode + SRT egress |
| `tsduck` (`tsp`) | PMT SCTE declare + `spliceinject` |
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
