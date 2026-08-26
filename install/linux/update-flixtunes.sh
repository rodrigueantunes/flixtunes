#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_ROOT="/opt/flixtunes"
SOURCE=""
while (($#)); do
  case "$1" in
    --source) SOURCE=${2:?}; shift 2 ;;
    --install-root) INSTALL_ROOT=${2:?}; shift 2 ;;
    -h|--help) echo "Usage: $0 --source CHEMIN_OU_URL [--install-root CHEMIN]"; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 1 ;;
  esac
done
[[ -n $SOURCE ]] || { echo "--source est obligatoire" >&2; exit 1; }
[[ -f "$INSTALL_ROOT/install.env" ]] || { echo "Installation FlixTunes absente de $INSTALL_ROOT" >&2; exit 1; }
# shellcheck disable=SC1090
. "$INSTALL_ROOT/install.env"
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
args=(--source "$SOURCE" --install-root "$INSTALL_ROOT" --data-root "$DATA_ROOT" --config "$CONFIG_FILE" --port "$PORT" --user "$SERVICE_USER")
[[ $SERVICE_MODE != standalone ]] || args+=(--no-systemd)
exec "$SCRIPT_DIR/install-flixtunes.sh" "${args[@]}"
