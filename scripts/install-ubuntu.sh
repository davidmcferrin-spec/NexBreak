#!/usr/bin/env bash
# NexBreak Ubuntu bring-up helpers (Apache + systemd). Run as root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PREFIX="${NEXBREAK_PREFIX:-/opt/nexbreak}"
DATA="${NEXBREAK_DATA:-/var/lib/nexbreak}"
LOG="${NEXBREAK_LOG:-/var/log/nexbreak}"

usage() {
  cat <<EOF
Usage: sudo $0 <command>

  deps          Install apt packages (ffmpeg, tsduck, apache, php)
  install       Copy tree to $PREFIX, create user/dirs, install units
  init-db       Create SQLite schema + seed 4 demo channels
  enable        Enable controller + proc@1 + egress@1
  status        systemctl status snapshot

Env overrides: NEXBREAK_PREFIX NEXBREAK_DATA NEXBREAK_LOG
EOF
}

cmd_deps() {
  apt-get update
  apt-get install -y \
    apache2 libapache2-mod-php php-sqlite3 php-curl \
    ffmpeg \
    python3 \
    curl
  # TSDuck: prefer distro package; fall back to note if missing
  if ! apt-get install -y tsduck; then
    echo "WARN: tsduck package not in apt — install from https://tsduck.io/download/" >&2
  fi
  a2enmod rewrite headers
  systemctl reload apache2 || true
}

cmd_install() {
  id -u nexbreak &>/dev/null || useradd --system --home-dir /nonexistent --shell /usr/sbin/nologin nexbreak
  mkdir -p "$PREFIX" "$DATA" "$LOG" /run/nexbreak
  rsync -a --delete \
    --exclude '.git' --exclude 'data/*.sqlite' --exclude '__pycache__' \
    "$ROOT"/ "$PREFIX"/
  chown -R nexbreak:nexbreak "$DATA" "$LOG" /run/nexbreak
  # www-data needs to reach the controller HTTP port only (loopback)
  usermod -aG nexbreak www-data || true
  chmod 0755 "$PREFIX"/bin/nexbreak-*
  install -m 644 "$PREFIX"/systemd/nexbreak-controller.service /etc/systemd/system/
  install -m 644 "$PREFIX"/systemd/nexbreak-proc@.service /etc/systemd/system/
  install -m 644 "$PREFIX"/systemd/nexbreak-egress@.service /etc/systemd/system/
  if [[ -f "$PREFIX"/config/apache-nexbreak.conf ]]; then
    install -m 644 "$PREFIX"/config/apache-nexbreak.conf /etc/apache2/sites-available/nexbreak.conf
    # Rewrite DocumentRoot to PREFIX/web
    sed -i "s|/opt/nexbreak|$PREFIX|g" /etc/apache2/sites-available/nexbreak.conf
    a2ensite nexbreak || true
  fi
  systemctl daemon-reload
  systemctl reload apache2 || true
  echo "Installed under $PREFIX (DocumentRoot $PREFIX/web)"
}

cmd_init_db() {
  mkdir -p "$DATA"
  chown nexbreak:nexbreak "$DATA"
  sudo -u nexbreak python3 "$PREFIX"/bin/nexbreak-controller \
    --db "$DATA"/nexbreak.sqlite --init-only --seed
  echo "DB ready: $DATA/nexbreak.sqlite"
}

cmd_enable() {
  systemctl enable --now nexbreak-controller
  systemctl enable --now nexbreak-proc@1
  systemctl enable --now nexbreak-egress@1
  systemctl status --no-pager nexbreak-controller 'nexbreak-proc@1' 'nexbreak-egress@1' || true
}

cmd_status() {
  systemctl status --no-pager nexbreak-controller 'nexbreak-proc@*' 'nexbreak-egress@*' || true
  echo "---"
  curl -sS http://127.0.0.1:8787/v1/health || echo "controller not reachable"
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    deps) cmd_deps ;;
    install) cmd_install ;;
    init-db) cmd_init_db ;;
    enable) cmd_enable ;;
    status) cmd_status ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
