#!/usr/bin/env bash
# Allowlisted systemctl restart for NexBreak Services UI.
# Usage: nexbreak-ops-restart.sh <unit> [<unit> ...]
set -euo pipefail

[ "$#" -ge 1 ] || { echo "usage: nexbreak-ops-restart.sh <unit>..." >&2; exit 2; }

for UNIT in "$@"; do
  case "$UNIT" in
    nexbreak-controller|nexbreak-mediamtx|nexbreak-proc@[0-9]|nexbreak-egress@[0-9]) ;;
    *) echo "disallowed unit: $UNIT" >&2; exit 2 ;;
  esac
done

exec systemctl restart "$@"
