# NexBreak support bundle

One-click diagnostic zip for bake-in and remote troubleshooting.
Built from the **Services** page (or the allowlisted CLI/sudo wrapper).

## What you get

A redacted zip named like:

```text
nexbreak-support-YYYYMMDD-HHMMSS-<hostname>-<Nh>.zip
```

Windows (selectable): **1 / 6 / 12 / 24 / 48 / 72** hours.

### Layout

| Path | Contents |
|---|---|
| `MANIFEST.json` | Host, hours, requestor IP, paths, notes |
| `REDACTIONS.txt` | What was stripped |
| `NOTES.txt` | Truncations / missing pieces (if any) |
| `host/` | uname, uptime, free, df, ip, lsblk, host snapshot, dmesg warn/err tail |
| `versions/` | ffmpeg, tsp, mediamtx, python, php, apache, relevant dpkg, git describe |
| `systemd/` | is-active/enabled, `systemctl status`, `systemctl cat` per unit |
| `journal/` | `journalctl -u <unit> --since "<N> hours ago"` for all NexBreak units |
| `config/` | processing / egress / routing / presets JSON, credential **metadata only**, caption library counts, audit events in window, **host_metric_samples** JSON/CSV, schema.sql, apache/mediamtx configs |
| `state/` | Small files from `/run/nexbreak` (splicemon, bitrate, …), SCTE dir listing |

### Always redacted / omitted

- Panel API key and `key_hash`
- URL userinfo (`rtsp://user:pass@…` → `rtsp://***:***@…`)
- password / passphrase / token field values
- Caption lexicon & blacklist word lists (counts only)
- Audit `splice_hex_payload`
- HLS segments / raw media

## UI

**Services** → Support bundle dropdown → **Download zip…**

Requires the same sudoers helpers as the rest of Services.

## CLI (on the appliance)

```bash
sudo /usr/local/bin/nexbreak-ops-support-bundle.sh 24
# prints: /var/lib/nexbreak/support/nexbreak-support-….zip
```

Or directly:

```bash
sudo NEXBREAK_PREFIX=/opt/nexbreak python3 /opt/nexbreak/bin/nexbreak-support-bundle --hours 24
```

## Install

`scripts/install-ubuntu.sh` installs:

- `/usr/local/bin/nexbreak-ops-support-bundle.sh`
- sudoers line in `/etc/sudoers.d/nexbreak-ops`
- `/var/lib/nexbreak/support/` (`0750`, group `www-data`)

Redeploy after pull:

```bash
sudo ./scripts/install-ubuntu.sh   # or your usual install path
# or manually:
sudo install -m 755 scripts/ops/nexbreak-ops-support-bundle.sh /usr/local/bin/
sudo install -m 440 config/nexbreak-ops.sudoers /etc/sudoers.d/nexbreak-ops
sudo visudo -cf /etc/sudoers.d/nexbreak-ops
sudo mkdir -p /var/lib/nexbreak/support && sudo chgrp www-data /var/lib/nexbreak/support && sudo chmod 750 /var/lib/nexbreak/support
```

Bundles older than 24 hours under `/var/lib/nexbreak/support/` are pruned on the next build.

## Hand-off to support / Cursor

1. Reproduce the issue (note wall-clock time).
2. Services → pick a window that covers the incident → Download zip.
3. Attach the zip (or unpack and paste `MANIFEST.json` + the relevant `journal/*.log`).

## Limits

- Per-unit journal soft-cap: 8 MiB (tail kept if larger)
- Zip soft-warn: 100 MiB
- PHP request time budget: 180 s for the download action
