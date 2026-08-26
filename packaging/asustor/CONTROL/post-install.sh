#!/bin/sh
set -eu

export PATH="$APKG_PKG_DIR/runtime/ffmpeg/bin:/opt/bin:/opt/sbin:/usr/local/bin:/usr/local/sbin:$PATH"

# Sans cette ligne, FFmpeg ne demarre pas, et l'installation ne se termine jamais.
#
# La variante partagee ne porte pas ses bibliotheques : elle les cherche. Le chemin de recherche que
# BtbN inscrit dans le binaire est casse — `DT_RPATH=-Wl:../lib`, ou l'option de liaison s'est
# retrouvee *dans* la valeur. Le chargeur y lit donc un repertoire nomme `-Wl`, qui n'existe pas, et
# `../lib` relatif au **repertoire courant** plutot qu'au binaire. Depuis le repertoire ou App Central
# execute ce script, cela ne mene nulle part.
#
# La consequence n'avait rien d'evident : `ffmpeg -decoders` echouait a demarrer, le controle du
# decodeur E-AC-3 juste dessous n'en concluait rien d'autre que « decodeur absent », le script sortait
# en erreur, et App Central laissait sa barre de progression tourner sans fin. Trois revisions ont paru
# « ne jamais s'installer » pour cette seule raison. `start-stop.sh` posait deja cette variable, ce qui
# explique que le serveur, lui, fonctionnait.
LD_LIBRARY_PATH="$APKG_PKG_DIR/runtime/ffmpeg/lib:$APKG_PKG_DIR/runtime/va${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export LD_LIBRARY_PATH

SHARE_ROOT="/volume1/FlixTunes"
[ -d "$SHARE_ROOT" ] || SHARE_ROOT="$APKG_PKG_DIR/persistent"
DATA_ROOT="$SHARE_ROOT/data"
CONFIG_ROOT="$SHARE_ROOT/config"
CONFIG_FILE="$CONFIG_ROOT/flixtunes.env"

mkdir -p "$DATA_ROOT" "$DATA_ROOT/backups" "$CONFIG_ROOT" "$SHARE_ROOT/logs" "$SHARE_ROOT/tmp"

FFMPEG_BIN="$APKG_PKG_DIR/runtime/ffmpeg/bin/ffmpeg"
FFPROBE_BIN="$APKG_PKG_DIR/runtime/ffmpeg/bin/ffprobe"
for candidate in /usr/local/AppCentral/ffmpeg/bin/ffmpeg /opt/bin/ffmpeg; do
  [ -n "$FFMPEG_BIN" ] || [ ! -x "$candidate" ] || FFMPEG_BIN="$candidate"
done
for candidate in /usr/local/AppCentral/ffmpeg/bin/ffprobe /opt/bin/ffprobe; do
  [ -n "$FFPROBE_BIN" ] || [ ! -x "$candidate" ] || FFPROBE_BIN="$candidate"
done
# App Central n'affiche pas la sortie d'erreur de ce script : un echec s'y voit comme une barre de
# progression qui tourne sans fin, et rien d'autre. Le meme diagnostic est donc ecrit dans le dossier
# partage, seul endroit atteignable sans SSH.
JOURNAL_INSTALL="$SHARE_ROOT/logs/install.log"
mkdir -p "$SHARE_ROOT/logs" 2>/dev/null || true
echouer() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installation interrompue : $1" >> "$JOURNAL_INSTALL" 2>/dev/null || true
  echo "$1" >&2
  exit 1
}

[ -x "$FFMPEG_BIN" ] && [ -x "$FFPROBE_BIN" ] ||
  echouer "Le moteur multimédia FFmpeg intégré à FlixTunes est absent."

# La sortie d'erreur est conservée : « decodeur absent » et « le binaire n'a pas demarre » se
# ressemblent ici, et seul le message de l'editeur de liens distingue les deux.
DECODEURS="$("$FFMPEG_BIN" -hide_banner -decoders 2>"$JOURNAL_INSTALL.tmp")" || true
echo "$DECODEURS" | grep -q '[[:space:]]eac3[[:space:]]' || {
  head -c 400 "$JOURNAL_INSTALL.tmp" >> "$JOURNAL_INSTALL" 2>/dev/null || true
  rm -f "$JOURNAL_INSTALL.tmp"
  echouer "Le moteur multimédia intégré ne contient pas le décodeur E-AC-3 requis, ou n'a pas démarré."
}
rm -f "$JOURNAL_INSTALL.tmp"

set_config_value() {
  KEY="$1"
  VALUE="$2"
  TEMP_FILE="$CONFIG_FILE.tmp"
  if [ -f "$CONFIG_FILE" ]; then grep -v "^${KEY}=" "$CONFIG_FILE" >"$TEMP_FILE" || true; else : >"$TEMP_FILE"; fi
  printf '%s=%s\n' "$KEY" "$VALUE" >>"$TEMP_FILE"
  mv "$TEMP_FILE" "$CONFIG_FILE"
}

# Ajoute une cle seulement si elle est absente : une mise a jour ne doit jamais ecraser un reglage
# choisi par l'administrateur. `set_config_value`, lui, impose la valeur — il reste reserve aux
# chemins que le paquet possede.
set_config_default() {
  KEY="$1"
  VALUE="$2"
  [ -f "$CONFIG_FILE" ] || return 0
  grep -q "^${KEY}=" "$CONFIG_FILE" && return 0
  printf '%s=%s
' "$KEY" "$VALUE" >>"$CONFIG_FILE"
}

if [ ! -f "$CONFIG_FILE" ]; then
  cat >"$CONFIG_FILE" <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=4000
FLIXTUNES_DATA_DIR=$DATA_ROOT
FFMPEG_PATH=$FFMPEG_BIN
FFPROBE_PATH=$FFPROBE_BIN
FLIXTUNES_HW_ACCEL=auto
FLIXTUNES_WATCH=1
FLIXTUNES_MDNS=1
# --- Acces distant -------------------------------------------------------------------------------
# Vide = aucun acces distant. Ni seconde ecoute, ni port lie, ni certificat demande.
# Pour l'activer : poser le domaine, rediriger 80 -> NAS:8080 et 443 -> NAS:8444 sur la box,
# puis redemarrer le paquet.
FLIXTUNES_WAN_DOMAIN=
FLIXTUNES_WAN_HOST=127.0.0.1
FLIXTUNES_WAN_PORT=4001
FLIXTUNES_WAN_HTTP_PORT=8080
FLIXTUNES_WAN_HTTPS_PORT=8444
FLIXTUNES_WAN_SESSION_HOURS=12
EOF
  chmod 640 "$CONFIG_FILE"
fi

# Installation existante : les cles arrivent sans rien ecraser, et l'acces distant reste ferme.
set_config_default FLIXTUNES_WAN_DOMAIN ""
set_config_default FLIXTUNES_WAN_HOST "127.0.0.1"
set_config_default FLIXTUNES_WAN_PORT "4001"
set_config_default FLIXTUNES_WAN_HTTP_PORT "8080"
set_config_default FLIXTUNES_WAN_HTTPS_PORT "8444"
set_config_default FLIXTUNES_WAN_SESSION_HOURS "12"

# Une mise à jour remplace aussi les anciens chemins pointant vers le FFmpeg limité d'App Central.
set_config_value FFMPEG_PATH "$FFMPEG_BIN"
set_config_value FFPROBE_PATH "$FFPROBE_BIN"
chmod 640 "$CONFIG_FILE"

# --- Compte de service, pour ne plus tourner en root -----------------------------------------------
#
# Best-effort et jamais bloquant : un paquet ne doit pas refuser de s'installer parce qu'ADM ne sait
# pas creer un utilisateur. Si quoi que ce soit echoue ici, `start-stop.sh` s'en apercoit par sa sonde
# et maintient le service en root — comportement d'hier, jamais une degradation silencieuse.
UTILISATEUR="${FLIXTUNES_RUN_AS:-flixtunes}"
JOURNAL_PRIV="$SHARE_ROOT/logs/privileges.log"
mkdir -p "$SHARE_ROOT/logs" 2>/dev/null || true

noter_priv() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Installation : $1" >>"$JOURNAL_PRIV" 2>/dev/null || true
}

if [ "$UTILISATEUR" != "root" ]; then
  if id "$UTILISATEUR" >/dev/null 2>&1; then
    noter_priv "compte $UTILISATEUR deja present"
  elif command -v useradd >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /sbin/nologin "$UTILISATEUR" 2>/dev/null       || useradd -r -M "$UTILISATEUR" 2>/dev/null || true
    id "$UTILISATEUR" >/dev/null 2>&1 && noter_priv "compte $UTILISATEUR cree par useradd"       || noter_priv "useradd n'a pas cree $UTILISATEUR"
  elif command -v adduser >/dev/null 2>&1; then
    adduser -S -D -H -s /sbin/nologin "$UTILISATEUR" 2>/dev/null || true
    id "$UTILISATEUR" >/dev/null 2>&1 && noter_priv "compte $UTILISATEUR cree par adduser"       || noter_priv "adduser n'a pas cree $UTILISATEUR"
  else
    noter_priv "ni useradd ni adduser : le service restera en root"
  fi

  if id "$UTILISATEUR" >/dev/null 2>&1; then
    # L'acces au peripherique de rendu passe par un groupe, jamais par les droits du fichier : c'est
    # la seule chose qui separe VA-API a 471 images/seconde de l'encodage logiciel a 151.
    # Les groupes `video` et `render` n'existent pas forcement : ADM n'en a aucun des deux, constate
    # en r60. On tente quand meme — une autre machine peut les avoir — sans jamais s'appuyer dessus.
    # `getent` est absent de certains systemes reduits : on retombe alors sur /etc/group.
    for GROUPE in video render input; do
      if command -v getent >/dev/null 2>&1; then
        getent group "$GROUPE" >/dev/null 2>&1 || continue
      else
        grep -q "^${GROUPE}:" /etc/group 2>/dev/null || continue
      fi
      if command -v usermod >/dev/null 2>&1; then usermod -a -G "$GROUPE" "$UTILISATEUR" 2>/dev/null || true
      elif command -v addgroup >/dev/null 2>&1; then addgroup "$UTILISATEUR" "$GROUPE" 2>/dev/null || true
      fi
    done
    noter_priv "groupes de $UTILISATEUR : $(id -Gn "$UTILISATEUR" 2>/dev/null)"
    # L'acces au peripherique ne vient donc pas des groupes, mais de `start-stop.sh`, qui lui accorde
    # renderD128 par son groupe a chaque demarrage — /dev etant reconstruit a chaque redemarrage.
    [ -e /dev/dri/renderD128 ] && noter_priv "renderD128 : $(ls -l /dev/dri/renderD128 2>/dev/null)"

    # Le partage porte base, journaux, sessions et certificats : il doit appartenir au compte.
    chown -R "$UTILISATEUR" "$SHARE_ROOT" 2>/dev/null       && noter_priv "propriete de $SHARE_ROOT transferee a $UTILISATEUR"       || noter_priv "chown de $SHARE_ROOT impossible : le service restera en root"
    # La configuration reste en 640, mais lisible par le compte qui doit la charger.
    chown "$UTILISATEUR" "$CONFIG_FILE" 2>/dev/null || true

    if [ -e /dev/dri/renderD128 ]; then
      # A ce stade le peripherique n'a pas encore ete accorde : c'est `start-stop.sh` qui le fait,
      # juste avant de decider. Ce releve n'est donc qu'informatif, il ne prejuge de rien.
      su -s /bin/sh -c "test -r /dev/dri/renderD128" "$UTILISATEUR" 2>/dev/null         && noter_priv "renderD128 deja lisible par $UTILISATEUR"         || noter_priv "renderD128 pas encore lisible par $UTILISATEUR : sera accorde au demarrage"
    fi
  fi
fi

"$APKG_PKG_DIR/CONTROL/start-stop.sh" start
