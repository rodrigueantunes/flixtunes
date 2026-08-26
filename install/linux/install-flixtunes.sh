#!/usr/bin/env bash
set -Eeuo pipefail

VERSION_PNPM="11.16.0"
MINIMUM_NODE_MAJOR=24
INSTALL_ROOT="/opt/flixtunes"
DATA_ROOT="/var/lib/flixtunes"
CONFIG_FILE="/etc/flixtunes/flixtunes.env"
SERVICE_USER="flixtunes"
PORT=4000
SOURCE=""
SERVICE_MODE="auto"
INSTALL_PREREQUISITES=1
START_SERVER=1

log() { printf '\033[36m[FlixTunes]\033[0m %s\n' "$*"; }
fail() { printf '\033[31m[FlixTunes] ERREUR:\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: sudo ./install-flixtunes.sh [options]
  --source CHEMIN_OU_URL    Dossier ou ZIP source FlixTunes
  --install-root CHEMIN     Code versionné (défaut /opt/flixtunes)
  --data-root CHEMIN        Données persistantes (défaut /var/lib/flixtunes)
  --config CHEMIN           Configuration persistante
  --port PORT               Port HTTP (défaut 4000)
  --user UTILISATEUR        Compte du service (défaut flixtunes)
  --no-systemd              Scripts start/stop au lieu d'un service systemd
  --no-prerequisites        Ne tente pas d'installer Node/FFmpeg
  --no-start                Installe sans démarrer
EOF
}

while (($#)); do
  case "$1" in
    --source) SOURCE=${2:?}; shift 2 ;;
    --install-root) INSTALL_ROOT=${2:?}; shift 2 ;;
    --data-root) DATA_ROOT=${2:?}; shift 2 ;;
    --config) CONFIG_FILE=${2:?}; shift 2 ;;
    --port) PORT=${2:?}; shift 2 ;;
    --user) SERVICE_USER=${2:?}; shift 2 ;;
    --no-systemd) SERVICE_MODE="standalone"; shift ;;
    --no-prerequisites) INSTALL_PREREQUISITES=0; shift ;;
    --no-start) START_SERVER=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Option inconnue : $1" ;;
  esac
done

[[ $PORT =~ ^[0-9]+$ ]] && ((PORT > 0 && PORT < 65536)) || fail "Port invalide : $PORT"
if [[ $SERVICE_MODE == auto ]]; then
  if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then SERVICE_MODE=systemd; else SERVICE_MODE=standalone; fi
fi
if [[ $SERVICE_MODE == systemd && ${EUID:-$(id -u)} -ne 0 ]]; then fail "L'installation systemd doit être exécutée avec sudo."; fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -n $SOURCE ]] || SOURCE=$(cd "$SCRIPT_DIR/../.." && pwd)
TEMP_ROOT=""
cleanup() { [[ -z $TEMP_ROOT || ! -d $TEMP_ROOT ]] || rm -rf -- "$TEMP_ROOT"; }
trap cleanup EXIT

install_os_packages() {
  ((INSTALL_PREREQUISITES == 1)) || return 0
  [[ ${EUID:-$(id -u)} -eq 0 ]] || return 0
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl xz-utils unzip ffmpeg
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y ca-certificates curl xz unzip ffmpeg
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache ca-certificates curl xz unzip ffmpeg
  elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm ca-certificates curl xz unzip ffmpeg
  fi
}

install_node_runtime() {
  local machine node_arch sums filename checksum archive runtime
  machine=$(uname -m)
  case "$machine" in
    x86_64|amd64) node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    armv7l) node_arch="armv7l" ;;
    *) fail "Architecture Node.js non prise en charge automatiquement : $machine" ;;
  esac
  command -v curl >/dev/null 2>&1 || fail "curl est requis pour installer Node.js."
  command -v sha256sum >/dev/null 2>&1 || fail "sha256sum est requis."
  TEMP_ROOT=${TEMP_ROOT:-$(mktemp -d)}
  sums="$TEMP_ROOT/SHASUMS256.txt"
  curl --fail --location --silent --show-error "https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt" -o "$sums"
  filename=$(awk -v arch="linux-${node_arch}.tar.gz" '$2 ~ arch "$" {print $2; exit}' "$sums")
  [[ -n $filename ]] || fail "Runtime Node.js 24 introuvable pour $node_arch."
  checksum=$(awk -v file="$filename" '$2 == file {print $1; exit}' "$sums")
  archive="$TEMP_ROOT/$filename"
  curl --fail --location --silent --show-error "https://nodejs.org/dist/latest-v24.x/$filename" -o "$archive"
  printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status || fail "Somme SHA-256 Node.js invalide."
  runtime="$INSTALL_ROOT/runtime/node"
  mkdir -p "$runtime"
  tar -xzf "$archive" --strip-components=1 -C "$runtime"
  NODE_BIN="$runtime/bin/node"
  NPM_BIN="$runtime/bin/npm"
}

ensure_prerequisites() {
  install_os_packages
  local major=0
  if command -v node >/dev/null 2>&1; then major=$(node --version | sed -E 's/^v([0-9]+).*/\1/'); fi
  if ((major >= MINIMUM_NODE_MAJOR)); then
    NODE_BIN=$(command -v node)
    NPM_BIN=$(command -v npm)
  elif ((INSTALL_PREREQUISITES == 1)); then
    log "Installation privée de Node.js 24 avec vérification SHA-256"
    install_node_runtime
  else
    fail "Node.js 24 ou supérieur est requis."
  fi
  command -v ffmpeg >/dev/null 2>&1 || fail "FFmpeg est requis. Sur NAS, installez le paquet FFmpeg ou Entware FFmpeg."
  command -v ffprobe >/dev/null 2>&1 || fail "FFprobe est requis."
  mkdir -p "$INSTALL_ROOT/runtime/pnpm"
  "$NPM_BIN" install --silent --no-audit --no-fund --prefix "$INSTALL_ROOT/runtime/pnpm" "pnpm@$VERSION_PNPM"
  PNPM_BIN="$INSTALL_ROOT/runtime/pnpm/node_modules/.bin/pnpm"
}

resolve_source() {
  local input=$SOURCE package
  if [[ $input =~ ^https?:// ]]; then
    TEMP_ROOT=${TEMP_ROOT:-$(mktemp -d)}
    log "Téléchargement de la distribution"
    curl --fail --location --show-error "$input" -o "$TEMP_ROOT/flixtunes.zip"
    input="$TEMP_ROOT/flixtunes.zip"
  fi
  if [[ -f $input ]]; then
    command -v unzip >/dev/null 2>&1 || fail "unzip est requis pour une archive ZIP."
    TEMP_ROOT=${TEMP_ROOT:-$(mktemp -d)}
    mkdir -p "$TEMP_ROOT/source"
    unzip -q "$input" -d "$TEMP_ROOT/source"
    if [[ -f "$TEMP_ROOT/source/package.json" && -f "$TEMP_ROOT/source/apps/server/package.json" ]]; then
      SOURCE_ROOT="$TEMP_ROOT/source"
    else
      package=$(find "$TEMP_ROOT/source" -maxdepth 3 -type f -path '*/package.json' | while read -r candidate; do
        candidate_root=$(dirname "$candidate")
        [[ -f "$candidate_root/apps/server/package.json" ]] && { echo "$candidate"; break; }
      done)
      [[ -n $package ]] || fail "Archive FlixTunes invalide."
      SOURCE_ROOT=$(dirname "$package")
    fi
  elif [[ -d $input ]]; then
    SOURCE_ROOT=$(cd "$input" && pwd)
  else
    fail "Source introuvable : $input"
  fi
  [[ -f "$SOURCE_ROOT/apps/server/package.json" ]] || fail "La source ne contient pas le serveur FlixTunes."
}

copy_sources() {
  local release=$1
  mkdir -p "$release/apps" "$release/packages"
  cp -a "$SOURCE_ROOT/apps/server" "$release/apps/server"
  cp -a "$SOURCE_ROOT/apps/web" "$release/apps/web"
  cp -a "$SOURCE_ROOT/packages/contracts" "$release/packages/contracts"
  cp -a "$SOURCE_ROOT/install" "$release/install"
  cp "$SOURCE_ROOT/package.json" "$SOURCE_ROOT/pnpm-lock.yaml" "$SOURCE_ROOT/pnpm-workspace.yaml" "$SOURCE_ROOT/tsconfig.base.json" "$release/"
  rm -rf -- "$release/apps/server/node_modules" "$release/apps/server/dist" "$release/apps/web/node_modules" "$release/apps/web/dist" "$release/packages/contracts/node_modules" "$release/packages/contracts/dist"
}

write_config() {
  mkdir -p "$(dirname "$CONFIG_FILE")"
  [[ -f $CONFIG_FILE ]] && return 0
  cat >"$CONFIG_FILE" <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=$PORT
FLIXTUNES_DATA_DIR=$DATA_ROOT
FFMPEG_PATH=$(command -v ffmpeg)
FFPROBE_PATH=$(command -v ffprobe)
FLIXTUNES_HW_ACCEL=auto
FLIXTUNES_WATCH=1
FLIXTUNES_MDNS=1
EOF
  chmod 640 "$CONFIG_FILE"
}

write_launchers() {
  mkdir -p "$INSTALL_ROOT/bin" "$INSTALL_ROOT/logs"
  cat >"$INSTALL_ROOT/bin/run.sh" <<EOF
#!/usr/bin/env bash
set -a
. "$CONFIG_FILE"
set +a
cd "$INSTALL_ROOT/current"
exec "$NODE_BIN" apps/server/dist/index.js
EOF
  cat >"$INSTALL_ROOT/bin/start.sh" <<EOF
#!/usr/bin/env bash
set -e
[[ ! -f "$INSTALL_ROOT/flixtunes.pid" ]] || ! kill -0 \$(cat "$INSTALL_ROOT/flixtunes.pid") 2>/dev/null || exit 0
nohup "$INSTALL_ROOT/bin/run.sh" >>"$INSTALL_ROOT/logs/server.log" 2>&1 &
echo \$! >"$INSTALL_ROOT/flixtunes.pid"
EOF
  cat >"$INSTALL_ROOT/bin/stop.sh" <<EOF
#!/usr/bin/env bash
set -e
if [[ -f "$INSTALL_ROOT/flixtunes.pid" ]]; then
  pid=\$(cat "$INSTALL_ROOT/flixtunes.pid")
  kill "\$pid" 2>/dev/null || true
  for _ in {1..30}; do kill -0 "\$pid" 2>/dev/null || break; sleep 0.2; done
  kill -9 "\$pid" 2>/dev/null || true
  rm -f "$INSTALL_ROOT/flixtunes.pid"
fi
EOF
  cat >"$INSTALL_ROOT/bin/status.sh" <<EOF
#!/usr/bin/env bash
curl --fail --silent "http://127.0.0.1:$PORT/api/health"
EOF
  chmod 755 "$INSTALL_ROOT/bin/"*.sh
}

write_systemd_service() {
  [[ $SERVICE_MODE == systemd ]] || return 0
  if ! id "$SERVICE_USER" >/dev/null 2>&1; then useradd --system --home-dir "$DATA_ROOT" --shell /usr/sbin/nologin "$SERVICE_USER"; fi
  chown -R "$SERVICE_USER":"$SERVICE_USER" "$DATA_ROOT" "$INSTALL_ROOT/logs"
  cat >/etc/systemd/system/flixtunes.service <<EOF
[Unit]
Description=FlixTunes local media server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
EnvironmentFile=$CONFIG_FILE
WorkingDirectory=$INSTALL_ROOT/current
ExecStart=$NODE_BIN apps/server/dist/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$DATA_ROOT $INSTALL_ROOT/logs

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable flixtunes.service
}

stop_server() {
  if [[ $SERVICE_MODE == systemd ]]; then systemctl stop flixtunes.service 2>/dev/null || true; else "$INSTALL_ROOT/bin/stop.sh" 2>/dev/null || true; fi
}
start_server() {
  if [[ $SERVICE_MODE == systemd ]]; then systemctl start flixtunes.service; else "$INSTALL_ROOT/bin/start.sh"; fi
}
wait_health() {
  local attempt
  for attempt in {1..60}; do curl --fail --silent "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && return 0; sleep 0.75; done
  return 1
}

log "Vérification des prérequis"
mkdir -p "$INSTALL_ROOT" "$DATA_ROOT"
ensure_prerequisites
resolve_source
APP_VERSION=$("$NODE_BIN" -p "require(process.argv[1]).version" "$SOURCE_ROOT/package.json")
RELEASE_ID="${APP_VERSION}-$(date +%Y%m%d%H%M%S)"
RELEASE_PATH="$INSTALL_ROOT/releases/$RELEASE_ID"
PREVIOUS_RELEASE=""
[[ ! -L "$INSTALL_ROOT/current" ]] || PREVIOUS_RELEASE=$(readlink -f "$INSTALL_ROOT/current")

log "Préparation de FlixTunes $APP_VERSION"
mkdir -p "$RELEASE_PATH"
copy_sources "$RELEASE_PATH"
(cd "$RELEASE_PATH" && "$PNPM_BIN" install --frozen-lockfile && "$PNPM_BIN" --filter @flixtunes/contracts build && "$PNPM_BIN" --filter @flixtunes/web build && "$PNPM_BIN" --filter @flixtunes/server build)
[[ -f "$RELEASE_PATH/apps/server/dist/index.js" && -f "$RELEASE_PATH/apps/web/dist/index.html" ]] || fail "Compilation incomplète."

write_config
write_launchers
write_systemd_service
stop_server
BACKUP=""
if [[ -f "$DATA_ROOT/flixtunes.db" ]]; then
  mkdir -p "$DATA_ROOT/backups"
  BACKUP="$DATA_ROOT/backups/pre-update-$(date +%Y%m%d-%H%M%S).db"
  "$NODE_BIN" "$RELEASE_PATH/install/common/backup-sqlite.cjs" "$DATA_ROOT/flixtunes.db" "$BACKUP"
fi
rm -f -- "$INSTALL_ROOT/current.new"
ln -s "$RELEASE_PATH" "$INSTALL_ROOT/current.new"
rm -f -- "$INSTALL_ROOT/current"
mv -f "$INSTALL_ROOT/current.new" "$INSTALL_ROOT/current"
cat >"$INSTALL_ROOT/install.env" <<EOF
INSTALL_ROOT=$INSTALL_ROOT
DATA_ROOT=$DATA_ROOT
CONFIG_FILE=$CONFIG_FILE
SERVICE_USER=$SERVICE_USER
PORT=$PORT
SERVICE_MODE=$SERVICE_MODE
CURRENT_RELEASE=$RELEASE_PATH
PREVIOUS_RELEASE=$PREVIOUS_RELEASE
BACKUP=$BACKUP
VERSION=$APP_VERSION
EOF

if ((START_SERVER == 1)); then
  start_server
  if ! wait_health; then
    stop_server
    if [[ -n $PREVIOUS_RELEASE && -d $PREVIOUS_RELEASE ]]; then
      if [[ -n $BACKUP && -f $BACKUP ]]; then
        cp -p "$BACKUP" "$DATA_ROOT/flixtunes.db"
        rm -f -- "$DATA_ROOT/flixtunes.db-wal" "$DATA_ROOT/flixtunes.db-shm"
      fi
      rm -f -- "$INSTALL_ROOT/current.rollback"
      ln -s "$PREVIOUS_RELEASE" "$INSTALL_ROOT/current.rollback"
      rm -f -- "$INSTALL_ROOT/current"
      mv -f "$INSTALL_ROOT/current.rollback" "$INSTALL_ROOT/current"
      start_server
    fi
    fail "Le contrôle de santé a échoué ; retour à la version précédente effectué."
  fi
fi
log "FlixTunes Server $APP_VERSION installé ; données conservées dans $DATA_ROOT"
printf 'Interface : http://%s:%s\n' "$(hostname -I 2>/dev/null | awk '{print $1}' || echo localhost)" "$PORT"
