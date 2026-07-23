#!/usr/bin/env bash
# Allowlisted journalctl for NexBreak Services UI.
# Usage: nexbreak-ops-journal.sh <unit> [lines] [since]
set -euo pipefail

UNIT="${1:-}"
LINES="${2:-100}"
SINCE="${3:-}"

case "$UNIT" in
  nexbreak-controller|nexbreak-verify|nexbreak-mediamtx|nexbreak-proc@[0-9]|nexbreak-egress@[0-9]) ;;
  *) echo "disallowed unit: $UNIT" >&2; exit 2 ;;
esac

[[ "$LINES" =~ ^[0-9]+$ ]] || { echo "lines must be an integer" >&2; exit 2; }
if [ "$LINES" -gt 500 ]; then LINES=500; fi
if [ "$LINES" -lt 1 ]; then LINES=1; fi

if [ -n "$SINCE" ]; then
  if [[ "$SINCE" =~ [\$\`\;\|\&\<\>] ]]; then
    echo "disallowed characters in since" >&2
    exit 2
  fi
  exec journalctl -u "$UNIT" -n "$LINES" --no-pager -o short-iso --since "$SINCE"
else
  exec journalctl -u "$UNIT" -n "$LINES" --no-pager -o short-iso
fi
