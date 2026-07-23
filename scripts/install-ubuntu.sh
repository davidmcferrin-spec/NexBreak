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

  deps          Install apt packages (ffmpeg, tsduck, chrony, apache, php)
  install       Copy tree to $PREFIX, create user/dirs, install units
  init-db       Create SQLite schema + seed 4 demo channels
  enable        Enable controller + proc@1 + egress@1
  vosk          Download Vosk model + pip package; wire NEXBREAK_VOSK_MODEL
  status        systemctl status snapshot

Env overrides: NEXBREAK_PREFIX NEXBREAK_DATA NEXBREAK_LOG
               NEXBREAK_TIMEZONE (default America/New_York)
               NEXBREAK_VOSK_MODEL_DIR  (default /opt/vosk)
               NEXBREAK_VOSK_MODEL_NAME (default vosk-model-small-en-us-0.15)
EOF
}

install_chrony() {
  # Accurate clock for splice timestamps / audit / logs.
  local tz="${NEXBREAK_TIMEZONE:-America/New_York}"
  apt-get install -y chrony tzdata
  if timedatectl list-timezones 2>/dev/null | grep -qx "$tz"; then
    timedatectl set-timezone "$tz"
  else
    echo "WARN: timezone $tz not found; leaving system timezone unchanged" >&2
  fi
  timedatectl set-ntp true 2>/dev/null || true
  systemctl enable --now chrony
  # Prefer chronyd if the unit name differs (some images).
  systemctl enable --now chronyd 2>/dev/null || true
  echo "Time: timezone=$(timedatectl show -p Timezone --value 2>/dev/null || echo "$tz") chrony=$(systemctl is-active chrony 2>/dev/null || systemctl is-active chronyd 2>/dev/null || echo unknown)"
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
  apt-get install -y ccextractor || echo "NOTE: ccextractor not available — Preview/Roll CC overlay will be idle"
  install_chrony
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
  # Services page: allowlisted sudo wrappers for www-data (NexVUE pattern)
  for s in nexbreak-ops-status.sh nexbreak-ops-journal.sh nexbreak-ops-journal-clear.sh nexbreak-ops-restart.sh nexbreak-ops-enable.sh; do
    install -m 755 "$PREFIX/scripts/ops/$s" "/usr/local/bin/$s"
  done
  if [[ -f "$PREFIX"/config/nexbreak-ops.sudoers ]]; then
    install -m 440 "$PREFIX"/config/nexbreak-ops.sudoers /etc/sudoers.d/nexbreak-ops
    if ! visudo -cf /etc/sudoers.d/nexbreak-ops >/dev/null; then
      echo "ERROR: nexbreak-ops.sudoers failed visudo — removing" >&2
      rm -f /etc/sudoers.d/nexbreak-ops
      exit 1
    fi
  fi
  # Local MPEG-TS feed uses 239.255.98.0/24 so preview/egress/cc-watch each
  # receive a full copy (unicast UDP + SO_REUSEADDR only delivers to one socket).
  ip link set lo multicast on 2>/dev/null || true
  ip route replace 239.255.98.0/24 dev lo 2>/dev/null || \
    echo "WARN: could not add lo route for 239.255.98.0/24 (preview fan-out)" >&2
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

cmd_vosk() {
  # Optional ASR stack for caption_policy force_asr / auto→insert.
  # Does not change channel policy — set Force ASR in UI (or API) after this.
  local model_root="${NEXBREAK_VOSK_MODEL_DIR:-/opt/vosk}"
  local model_name="${NEXBREAK_VOSK_MODEL_NAME:-vosk-model-small-en-us-0.15}"
  local model_path="${model_root}/${model_name}"
  local zip_url="${NEXBREAK_VOSK_MODEL_URL:-https://alphacephei.com/vosk/models/${model_name}.zip}"
  local drop_in_dir="/etc/systemd/system/nexbreak-proc@.service.d"
  local drop_in="${drop_in_dir}/vosk.conf"

  apt-get update
  apt-get install -y python3-pip python3-venv unzip curl

  mkdir -p "$model_root"
  if [[ -d "$model_path" && -f "$model_path/am/final.mdl" ]]; then
    echo "Vosk model already present: $model_path"
  else
    local tmp_zip="/tmp/${model_name}.zip"
    echo "Downloading Vosk model ${model_name}…"
    curl -fsSL -o "$tmp_zip" "$zip_url"
    echo "Extracting to ${model_root}…"
    rm -rf "${model_path}.partial"
    mkdir -p "${model_path}.partial"
    unzip -q "$tmp_zip" -d "${model_path}.partial"
    # Zip usually contains a top-level folder named like the model.
    if [[ -d "${model_path}.partial/${model_name}" ]]; then
      rm -rf "$model_path"
      mv "${model_path}.partial/${model_name}" "$model_path"
      rm -rf "${model_path}.partial"
    else
      # Flat or differently named — promote the only child dir if present.
      local kids=("${model_path}.partial"/*)
      if [[ ${#kids[@]} -eq 1 && -d "${kids[0]}" ]]; then
        rm -rf "$model_path"
        mv "${kids[0]}" "$model_path"
        rm -rf "${model_path}.partial"
      else
        rm -rf "$model_path"
        mv "${model_path}.partial" "$model_path"
      fi
    fi
    rm -f "$tmp_zip"
    echo "Installed model: $model_path"
  fi

  if [[ ! -d "$model_path" ]]; then
    echo "ERROR: model path missing after install: $model_path" >&2
    exit 1
  fi

  echo "Installing Python vosk package (system site)…"
  # Ubuntu 24+ marks system Python as externally managed; captions are an
  # optional host tool, so --break-system-packages is intentional here.
  python3 -m pip install --upgrade --break-system-packages 'vosk>=0.3.45'

  mkdir -p "$drop_in_dir"
  cat >"$drop_in" <<EOF
# Managed by scripts/install-ubuntu.sh vosk — do not hand-edit; re-run vosk to refresh.
[Service]
Environment=NEXBREAK_VOSK_MODEL=${model_path}
Environment=NEXBREAK_CC_INJECT_SEI=1
EOF
  chmod 644 "$drop_in"
  systemctl daemon-reload

  # Restart any active proc instances so they pick up the env + can go asr_insert.
  local restarted=0
  local unit
  for unit in $(systemctl list-units --type=service --state=running --no-legend 'nexbreak-proc@*' 2>/dev/null | awk '{print $1}'); do
    echo "Restarting ${unit}…"
    systemctl restart "$unit"
    restarted=1
  done
  if [[ "$restarted" -eq 0 ]]; then
    echo "No running nexbreak-proc@* units — start one after setting caption policy."
  fi

  echo
  echo "Vosk ready:"
  echo "  model:  $model_path"
  echo "  env:    NEXBREAK_VOSK_MODEL (via $drop_in)"
  python3 - <<'PY' || true
import os, sys
try:
    import vosk
    print("  package:", getattr(vosk, "__file__", "vosk"))
except ImportError as e:
    print("  ERROR: vosk import failed:", e, file=sys.stderr)
    sys.exit(1)
PY
  echo
  echo "Next: set channel policy to Force ASR (Captions/Channels UI) or:"
  echo "  curl -X POST http://127.0.0.1:8787/v1/processing/1/captioning \\"
  echo "    -H 'Content-Type: application/json' -d '{\"policy\":\"force_asr\"}'"
  echo "Then confirm: journalctl -u nexbreak-proc@1 -n 40 | grep -iE 'effective|vosk|asr'"
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    deps) cmd_deps ;;
    install) cmd_install ;;
    init-db) cmd_init_db ;;
    enable) cmd_enable ;;
    vosk) cmd_vosk ;;
    status) cmd_status ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
