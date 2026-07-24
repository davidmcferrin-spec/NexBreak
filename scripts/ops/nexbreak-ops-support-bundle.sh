#!/usr/bin/env bash
# Allowlisted support-bundle builder for NexBreak Services UI.
# Usage: nexbreak-ops-support-bundle.sh <hours> [requestor_ip]
#
# hours: 1|6|12|24|48|72
# Prints the absolute path to the zip on stdout (single line).
set -euo pipefail

HOURS="${1:-}"
REQUESTOR_IP="${2:-}"
PREFIX="${NEXBREAK_PREFIX:-/opt/nexbreak}"
PY="$PREFIX/bin/nexbreak-support-bundle"

case "$HOURS" in
  1|6|12|24|48|72) ;;
  *)
    echo "hours must be one of: 1 6 12 24 48 72" >&2
    exit 2
    ;;
esac

if [[ -n "$REQUESTOR_IP" ]]; then
  # IPv4 / IPv6 / empty — reject shell metacharacters
  if [[ "$REQUESTOR_IP" =~ [\$\`\;\|\&\<\>\ \'\"\\] ]]; then
    echo "disallowed characters in requestor_ip" >&2
    exit 2
  fi
  if [[ ${#REQUESTOR_IP} -gt 64 ]]; then
    echo "requestor_ip too long" >&2
    exit 2
  fi
fi

if [[ ! -f "$PY" ]]; then
  echo "missing collector: $PY" >&2
  exit 2
fi

# Ensure support dir exists with sensible perms before python runs.
DATA="${NEXBREAK_DATA:-/var/lib/nexbreak}"
mkdir -p "$DATA/support"
chmod 750 "$DATA/support" 2>/dev/null || true

export NEXBREAK_PREFIX="$PREFIX"
export NEXBREAK_DATA="$DATA"
export NEXBREAK_DB="${NEXBREAK_DB:-$DATA/nexbreak.sqlite}"
export NEXBREAK_RUN_DIR="${NEXBREAK_RUN_DIR:-/run/nexbreak}"

ARGS=(--hours "$HOURS")
if [[ -n "$REQUESTOR_IP" ]]; then
  ARGS+=(--requestor-ip "$REQUESTOR_IP")
fi

exec /usr/bin/python3 "$PY" "${ARGS[@]}"
