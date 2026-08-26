#!/bin/sh
set -eu
"$APKG_PKG_DIR/CONTROL/start-stop.sh" stop || true
SHARE_ROOT="/volume1/FlixTunes"
if [ -f "$SHARE_ROOT/data/flixtunes.db" ]; then
  mkdir -p "$SHARE_ROOT/data/backups"
  DESTINATION="$SHARE_ROOT/data/backups/pre-apkg-${APKG_PKG_STATUS}-$(date +%Y%m%d-%H%M%S).db"
  NODE_BIN="$APKG_PKG_DIR/runtime/node/bin/node"
  BACKUP_TOOL="$APKG_PKG_DIR/app/install/backup-sqlite.cjs"
  if [ -x "$NODE_BIN" ] && [ -f "$BACKUP_TOOL" ]; then
    "$NODE_BIN" "$BACKUP_TOOL" "$SHARE_ROOT/data/flixtunes.db" "$DESTINATION"
  else
    cp -p "$SHARE_ROOT/data/flixtunes.db" "$DESTINATION"
  fi
fi
