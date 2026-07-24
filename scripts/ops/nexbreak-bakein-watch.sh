#!/usr/bin/env bash
# nexbreak-bakein-watch.sh — soak-test local program feed health.
#
# Usage:
#   sudo -u nexstar bash /opt/nexbreak/scripts/ops/nexbreak-bakein-watch.sh [svc] [port]
# Defaults: svc=1 feed port=19001
#
# Pass criteria for a bake-in window: zero FAIL lines (or only brief self-heals
# that the in-process proc watchdog already recovered without this script).
#
# Optional auto-heal: set NEXBREAK_BAKEIN_RESTART=1 to systemctl restart after
# 2 consecutive fails (record each restart as a bake-in defect).

set -euo pipefail

SVC="${1:-1}"
PORT="${2:-19001}"
UNIT="nexbreak-proc@${SVC}"
FEED="udp://239.255.98.1:${PORT}?localaddr=127.0.0.1"
LOG="${NEXBREAK_BAKEIN_LOG:-/var/tmp/nexbreak-bakein-${SVC}.log}"
INTERVAL="${NEXBREAK_BAKEIN_INTERVAL:-30}"
AUTO_RESTART="${NEXBREAK_BAKEIN_RESTART:-0}"
FAILS=0
OKS=0

mkdir -p "$(dirname "$LOG")"
echo "$(date -Is) bake-in watch start unit=$UNIT feed=$FEED log=$LOG" | tee -a "$LOG"

while true; do
  ts=$(date -Is)
  if timeout 8 ffprobe -v error -timeout 5000000 \
      -show_entries stream=codec_type -select_streams v:0 \
      -of csv=p=0 "$FEED" 2>/dev/null | grep -qi video; then
    OKS=$((OKS + 1))
    FAILS=0
    echo "$ts OK feed (ok=$OKS)" | tee -a "$LOG"
  else
    FAILS=$((FAILS + 1))
    echo "$ts FAIL feed (streak=$FAILS ok=$OKS)" | tee -a "$LOG"
    ss -uln 2>/dev/null | grep -E "${PORT}|2200${SVC}" | tee -a "$LOG" || true
    journalctl -u "$UNIT" -n 40 --no-pager 2>/dev/null \
      | grep -iE 'pipeline restart|ingest fault|local feed|No room|preview|cc.inject|recycl' \
      | tee -a "$LOG" || true
    if [[ "$AUTO_RESTART" == "1" && "$FAILS" -ge 2 ]]; then
      echo "$ts AUTO restart $UNIT" | tee -a "$LOG"
      systemctl restart "$UNIT" || true
      FAILS=0
      sleep 25
    fi
  fi
  sleep "$INTERVAL"
done
