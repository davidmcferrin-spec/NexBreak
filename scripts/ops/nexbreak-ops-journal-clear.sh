#!/usr/bin/env bash
# Allowlisted journal vacuum for NexBreak Services UI.
# Usage: nexbreak-ops-journal-clear.sh
#
# systemd cannot delete logs for a single unit; this rotates and vacuums the
# whole journal so old crash spam is gone. Requires an explicit UI confirm.
set -euo pipefail

journalctl --rotate
# Keep almost nothing — operators want a clean slate after config thrash.
journalctl --vacuum-time=1s
exit 0
