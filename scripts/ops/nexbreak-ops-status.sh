#!/usr/bin/env bash
# Allowlisted systemctl status for NexBreak Services UI.
# Usage: nexbreak-ops-status.sh UNIT [UNIT...]
# Prints one line per unit: <unit> <active-state> <enabled-state>
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 UNIT [UNIT...]" >&2
  exit 2
fi

UNITS=()
for UNIT in "$@"; do
  case "$UNIT" in
    nexbreak-controller|nexbreak-verify|nexbreak-mediamtx|nexbreak-proc@[0-9]|nexbreak-egress@[0-9])
      UNITS+=("$UNIT")
      ;;
    *)
      echo "disallowed unit: $UNIT" >&2
      exit 2
      ;;
  esac
done

# One systemctl round-trip for all units (was N sequential sudo invocations).
set +e
mapfile -t STATES < <(systemctl is-active "${UNITS[@]}" 2>/dev/null)
mapfile -t ENABLED < <(systemctl is-enabled "${UNITS[@]}" 2>/dev/null)
set -e

i=0
for UNIT in "${UNITS[@]}"; do
  ST="${STATES[$i]:-unknown}"
  EN="${ENABLED[$i]:-unknown}"
  [[ -n "$ST" ]] || ST="unknown"
  [[ -n "$EN" ]] || EN="unknown"
  echo "$UNIT $ST $EN"
  i=$((i + 1))
done
exit 0
