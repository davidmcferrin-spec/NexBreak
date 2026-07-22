#!/usr/bin/env bash
# Allowlisted systemctl status for NexBreak Services UI.
# Usage: nexbreak-ops-status.sh <unit>
# Prints: <active-state> <enabled-state>
set -euo pipefail

UNIT="${1:-}"
case "$UNIT" in
  nexbreak-controller|nexbreak-mediamtx|nexbreak-proc@[0-9]|nexbreak-egress@[0-9]) ;;
  *) echo "disallowed unit: $UNIT" >&2; exit 2 ;;
esac

set +e
STATE="$(systemctl is-active "$UNIT" 2>/dev/null)"
ENABLED="$(systemctl is-enabled "$UNIT" 2>/dev/null)"
set -e
[[ -n "$STATE" ]] || STATE="unknown"
[[ -n "$ENABLED" ]] || ENABLED="unknown"
echo "$STATE $ENABLED"
exit 0
