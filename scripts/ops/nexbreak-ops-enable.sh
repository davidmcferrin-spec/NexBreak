#!/usr/bin/env bash
# Allowlisted enable/disable/start/stop for channel units only.
# Core units (controller, mediamtx) may be restarted but not stopped/disabled
# from the LAN-trust Services page.
# Usage: nexbreak-ops-enable.sh <enable|disable|start|stop> <unit>
set -euo pipefail

VERB="${1:-}"
UNIT="${2:-}"

case "$VERB" in
  enable|disable|start|stop) ;;
  *) echo "disallowed verb: $VERB" >&2; exit 2 ;;
esac
case "$UNIT" in
  nexbreak-proc@[0-9]|nexbreak-egress@[0-9]) ;;
  *) echo "disallowed unit: $UNIT" >&2; exit 2 ;;
esac

case "$VERB" in
  enable)
    systemctl enable --now "$UNIT"
    ;;
  disable)
    systemctl disable --now "$UNIT"
    systemctl reset-failed "$UNIT" 2>/dev/null || true
    ;;
  start)
    systemctl start "$UNIT"
    ;;
  stop)
    systemctl stop "$UNIT"
    systemctl reset-failed "$UNIT" 2>/dev/null || true
    ;;
esac
