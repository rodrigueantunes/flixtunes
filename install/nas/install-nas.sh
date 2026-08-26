#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SOURCE=$(cd "$SCRIPT_DIR/../.." && pwd)
NAS_ROOT=""
PORT=4000
NO_START=0

while (($#)); do
  case "$1" in
    --source) SOURCE=${2:?}; shift 2 ;;
    --nas-root) NAS_ROOT=${2:?}; shift 2 ;;
    --port) PORT=${2:?}; shift 2 ;;
    --no-start) NO_START=1; shift ;;
    -h|--help) echo "Usage: $0 [--source DOSSIER_OU_ZIP] [--nas-root CHEMIN] [--port 4000]"; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; exit 1 ;;
  esac
done

if [[ -z $NAS_ROOT ]]; then
  for candidate in /volume1/FlixTunes /share/FlixTunes /mnt/user/appdata/FlixTunes "$HOME/FlixTunes"; do
    parent=$(dirname "$candidate")
    if [[ -d $parent && -w $parent ]]; then NAS_ROOT=$candidate; break; fi
  done
fi
[[ -n $NAS_ROOT ]] || { echo "Impossible de choisir un volume. Utilisez --nas-root." >&2; exit 1; }

export PATH="/opt/bin:/opt/sbin:/usr/local/bin:$PATH"
if ! command -v ffmpeg >/dev/null 2>&1 && command -v opkg >/dev/null 2>&1; then
  echo "[FlixTunes] Installation de FFmpeg via Entware"
  opkg update
  opkg install ffmpeg
fi

args=(--source "$SOURCE" --install-root "$NAS_ROOT/server" --data-root "$NAS_ROOT/data" --config "$NAS_ROOT/config/flixtunes.env" --port "$PORT" --user "$(id -un)" --no-systemd)
((NO_START == 0)) || args+=(--no-start)
bash "$SCRIPT_DIR/../linux/install-flixtunes.sh" "${args[@]}"

cat <<EOF

Installation NAS terminée.
  Démarrer : $NAS_ROOT/server/bin/start.sh
  Arrêter  : $NAS_ROOT/server/bin/stop.sh
  État     : $NAS_ROOT/server/bin/status.sh
  Mettre à jour : bash $NAS_ROOT/server/current/install/linux/update-flixtunes.sh --source NOUVELLE_ARCHIVE --install-root $NAS_ROOT/server

Si votre NAS possède un planificateur de tâches, ajoutez au démarrage :
  $NAS_ROOT/server/bin/start.sh
EOF
