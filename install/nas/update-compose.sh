#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT"
[[ -f .env ]] || { echo "Configuration .env absente." >&2; exit 1; }
# shellcheck disable=SC1091
. ./.env
DATA_ROOT=${FLIXTUNES_DATA_ROOT:-./data}
PREVIOUS_IMAGE=$(docker compose images -q flixtunes | head -n 1)
IMAGE_NAME=$(docker compose config --images | head -n 1)
BACKUP=""
if [[ -f "$DATA_ROOT/flixtunes.db" ]]; then
  mkdir -p "$DATA_ROOT/backups"
  docker compose stop flixtunes
  BACKUP="$DATA_ROOT/backups/pre-compose-update-$(date +%Y%m%d-%H%M%S).db"
  cp -p "$DATA_ROOT/flixtunes.db" "$BACKUP"
fi
docker compose build --pull
docker compose up -d
for _ in {1..60}; do
  curl --fail --silent "http://127.0.0.1:${PORT:-4000}/api/health" >/dev/null 2>&1 && exit 0
  sleep 1
done
echo "La nouvelle image ne répond pas : retour à l'image précédente." >&2
docker compose stop flixtunes || true
if [[ -n $BACKUP && -f $BACKUP ]]; then
  cp -p "$BACKUP" "$DATA_ROOT/flixtunes.db"
  rm -f -- "$DATA_ROOT/flixtunes.db-wal" "$DATA_ROOT/flixtunes.db-shm"
fi
if [[ -n $PREVIOUS_IMAGE && -n $IMAGE_NAME ]]; then
  docker image tag "$PREVIOUS_IMAGE" "$IMAGE_NAME"
  docker compose up -d --no-build --force-recreate
fi
exit 1
