#!/usr/bin/env bash
# Per-unit journal clear for NexBreak Services UI.
# Usage: nexbreak-ops-journal-clear.sh <unit>
#
# systemd cannot delete journal entries for a single unit. Instead we write a
# per-unit watermark; nexbreak-ops-journal.sh floors --since to that time so
# only this unit's view is reset. Other units are untouched; no host-wide vacuum.
set -euo pipefail

UNIT="${1:-}"
case "$UNIT" in
  nexbreak-controller|nexbreak-verify|nexbreak-mediamtx|nexbreak-proc@[0-9]|nexbreak-egress@[0-9]) ;;
  *) echo "disallowed unit: $UNIT" >&2; exit 2 ;;
esac

DIR=/var/lib/nexbreak/journal-cleared
mkdir -p "$DIR"
# journalctl --since accepts this form; UTC avoids local TZ ambiguity.
date -u +"%Y-%m-%d %H:%M:%S UTC" > "$DIR/$UNIT"
chmod 644 "$DIR/$UNIT"
echo "cleared $UNIT since $(cat "$DIR/$UNIT")"
exit 0
