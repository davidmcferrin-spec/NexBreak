#!/usr/bin/env bash
# Allowlisted journalctl for NexBreak Services UI.
# Usage: nexbreak-ops-journal.sh <unit> [lines] [since]
#
# If this unit was cleared via nexbreak-ops-journal-clear.sh, a watermark
# under /var/lib/nexbreak/journal-cleared/ floors --since so old spam stays gone.
set -euo pipefail

UNIT="${1:-}"
LINES="${2:-300}"
SINCE="${3:-}"
CLEARED_DIR=/var/lib/nexbreak/journal-cleared

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
fi

FLOOR=""
CLEARED_FILE="$CLEARED_DIR/$UNIT"
if [ -f "$CLEARED_FILE" ]; then
  FLOOR=$(head -n 1 "$CLEARED_FILE" | tr -d '\r\n')
  if [[ "$FLOOR" =~ [\$\`\;\|\&\<\>] ]]; then
    FLOOR=""
  fi
fi

EFFECTIVE_SINCE=""
if [ -n "$SINCE" ] && [ -n "$FLOOR" ]; then
  TS_SINCE=$(date -d "$SINCE" +%s 2>/dev/null || echo 0)
  TS_FLOOR=$(date -d "$FLOOR" +%s 2>/dev/null || echo 0)
  if [ "$TS_FLOOR" -gt "$TS_SINCE" ]; then
    EFFECTIVE_SINCE="$FLOOR"
  else
    EFFECTIVE_SINCE="$SINCE"
  fi
elif [ -n "$SINCE" ]; then
  EFFECTIVE_SINCE="$SINCE"
elif [ -n "$FLOOR" ]; then
  EFFECTIVE_SINCE="$FLOOR"
fi

if [ -n "$EFFECTIVE_SINCE" ]; then
  exec journalctl -u "$UNIT" -n "$LINES" --no-pager -o short-iso --since "$EFFECTIVE_SINCE"
else
  exec journalctl -u "$UNIT" -n "$LINES" --no-pager -o short-iso
fi
