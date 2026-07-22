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

install_tsduck() {
  # Not in Ubuntu's default apt repos — use official .deb from GitHub releases.
  if command -v tsp >/dev/null 2>&1; then
    echo "TSDuck already present: $(command -v tsp)"
    return 0
  fi
  if apt-get install -y tsduck 2>/dev/null; then
    return 0
  fi

  local ver="${TSDUCK_VERSION:-v3.44-4676}"
  local pkg_ver="${ver#v}"
  local deb_arch
  case "$(dpkg --print-architecture)" in
    amd64) deb_arch=amd64 ;;
    arm64) deb_arch=arm64 ;;
    *)
      echo "ERROR: unsupported arch for TSDuck auto-install; get a .deb from https://tsduck.io/tsduck-binaries/" >&2
      return 1
      ;;
  esac
  # Match host Ubuntu major (24/26); fall back to ubuntu24 packages.
  local ubu
  ubu="$(. /etc/os-release && echo "${VERSION_ID%%.*}")"
  case "$ubu" in
    24|26) ;;
    *) ubu=24 ;;
  esac
  local deb="tsduck_${pkg_ver}.ubuntu${ubu}_${deb_arch}.deb"
  local url="https://github.com/tsduck/tsduck/releases/download/${ver}/${deb}"
  local tmp="/tmp/${deb}"

  echo "TSDuck not in apt — downloading ${deb}…"
  curl -fsSL -o "$tmp" "$url"
  apt-get install -y "$tmp"
  rm -f "$tmp"

  if ! command -v tsp >/dev/null 2>&1; then
    echo "ERROR: tsp still missing after TSDuck install" >&2
    return 1
  fi
  echo "Installed TSDuck: $(tsp --version 2>&1 | head -n1 || true)"
}

cmd_deps() {
  apt-get update
  apt-get install -y \
    apache2 libapache2-mod-php php-sqlite3 php-curl \
    ffmpeg \
    python3 \
    curl \
    rsync
  install_tsduck
  # MediaMTX binary (WebRTC WHEP preview)
  if [[ ! -x /usr/local/bin/mediamtx ]]; then
    local ver="${MEDIAMTX_VERSION:-v1.12.2}"
    local arch="linux_amd64"
    local url="https://github.com/bluenviron/mediamtx/releases/download/${ver}/mediamtx_${ver}_${arch}.tar.gz"
    echo "Installing MediaMTX ${ver}…"
    curl -fsSL "$url" | tar -xz -C /tmp mediamtx
    install -m 755 /tmp/mediamtx /usr/local/bin/mediamtx
    rm -f /tmp/mediamtx
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
  # Substitute PREFIX/DATA into unit files (templates ship with /opt and /var/lib defaults)
  for unit in nexbreak-controller.service nexbreak-proc@.service nexbreak-egress@.service nexbreak-mediamtx.service; do
    sed -e "s|/opt/nexbreak|${PREFIX}|g" \
        -e "s|/var/lib/nexbreak|${DATA}|g" \
        "$PREFIX/systemd/$unit" > "/etc/systemd/system/$unit"
    chmod 644 "/etc/systemd/system/$unit"
  done
  mkdir -p /etc/nexbreak
  install -m 644 "$PREFIX"/config/mediamtx.yml /etc/nexbreak/mediamtx.yml
  if [[ -f "$PREFIX"/config/apache-nexbreak.conf ]]; then
    install -m 644 "$PREFIX"/config/apache-nexbreak.conf /etc/apache2/sites-available/nexbreak.conf
    # Rewrite DocumentRoot to PREFIX/web
    sed -i "s|/opt/nexbreak|$PREFIX|g" /etc/apache2/sites-available/nexbreak.conf
    a2ensite nexbreak || true
  fi
  systemctl daemon-reload
  systemctl reload apache2 || true
  echo "Installed under $PREFIX (DocumentRoot $PREFIX/web, DB $DATA)"
}

cmd_init_db() {
  mkdir -p "$DATA"
  chown nexbreak:nexbreak "$DATA"
  sudo -u nexbreak python3 "$PREFIX"/bin/nexbreak-controller \
    --db "$DATA"/nexbreak.sqlite --init-only --seed
  echo "DB ready: $DATA/nexbreak.sqlite"
}

cmd_enable() {
  systemctl enable --now nexbreak-mediamtx
  systemctl enable --now nexbreak-controller
  systemctl enable --now nexbreak-proc@1
  systemctl enable --now nexbreak-egress@1
  systemctl status --no-pager nexbreak-mediamtx nexbreak-controller 'nexbreak-proc@1' 'nexbreak-egress@1' || true
}

cmd_status() {
  systemctl status --no-pager nexbreak-mediamtx nexbreak-controller 'nexbreak-proc@*' 'nexbreak-egress@*' || true
  echo "---"
  curl -sS http://127.0.0.1:8787/v1/health || echo "controller not reachable"
  curl -sS http://127.0.0.1:9997/v3/paths/list || echo "mediamtx API not reachable"
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
