#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
DATA_ROOT="$ROOT/data"
MEDIA_ROOT="$ROOT/media"
PORT=4000
while (($#)); do
  case "$1" in
    --data-root) DATA_ROOT=${2:?}; shift 2 ;;
    --media-root) MEDIA_ROOT=${2:?}; shift 2 ;;
    --port) PORT=${2:?}; shift 2 ;;
    -h|--help) echo "Usage: $0 --data-root CHEMIN --media-root CHEMIN [--port 4000]"; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 1 ;;
  esac
done
command -v docker >/dev/null 2>&1 || { echo "Docker/Container Manager est requis pour ce mode." >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Le plugin Docker Compose est requis." >&2; exit 1; }
mkdir -p "$DATA_ROOT" "$MEDIA_ROOT"
ENV_FILE="$ROOT/.env"
if [[ ! -f $ENV_FILE ]]; then
  cat >"$ENV_FILE" <<EOF
PUID=$(id -u)
PGID=$(id -g)
PORT=$PORT
FLIXTUNES_DATA_ROOT=$DATA_ROOT
FLIXTUNES_MEDIA_ROOT=$MEDIA_ROOT
TMDB_ACCESS_TOKEN=
TVDB_API_KEY=
TVDB_PIN=
FANART_API_KEY=
FLIXTUNES_HW_ACCEL=auto
FLIXTUNES_WATCH_POLLING=1
FLIXTUNES_SCAN_INTERVAL_HOURS=6
FLIXTUNES_BACKUP_INTERVAL_HOURS=24
FLIXTUNES_BACKUP_RETENTION=7
FLIXTUNES_API_TOKEN=
EOF
  chmod 600 "$ENV_FILE"
fi
cd "$ROOT"
docker compose up -d --build
docker compose ps
printf 'FlixTunes est accessible sur http://%s:%s\n' "$(hostname -I 2>/dev/null | awk '{print $1}' || echo localhost)" "$PORT"
