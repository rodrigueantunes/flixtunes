#!/bin/sh
set -eu

SHARE_ROOT="/volume1/FlixTunes"
[ -d "$SHARE_ROOT" ] || SHARE_ROOT="$APKG_PKG_DIR/persistent"
CONFIG_FILE="$SHARE_ROOT/config/flixtunes.env"
# Ecrit par le serveur quand on regle l'acces distant depuis l'interface. Charge APRES le fichier
# historique : le reglage fait a l'ecran l'emporte, celui du fichier sert de valeur par defaut.
WAN_FILE="$SHARE_ROOT/data/wan.env"
PID_FILE="$SHARE_ROOT/flixtunes.pid"
CADDY_BIN="$APKG_PKG_DIR/runtime/caddy/caddy"
CADDY_PID_FILE="$SHARE_ROOT/caddy.pid"
CADDY_DIR="$SHARE_ROOT/caddy"
CADDY_FILE="$SHARE_ROOT/config/Caddyfile"
CADDY_LOG="$SHARE_ROOT/logs/caddy.log"
LOG_FILE="$SHARE_ROOT/logs/server.log"
NODE_BIN="$APKG_PKG_DIR/runtime/node/bin/node"
SERVER_ENTRY="$APKG_PKG_DIR/app/apps/server/dist/index.js"

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

# --- Moindre privilege ----------------------------------------------------------------------------
#
# Le service tournait en root. Sur un serveur joignable depuis Internet, une faille y devient totale
# au lieu d'etre contenue : acces a tous les partages, persistance installable, pivot vers les autres
# services d'ADM. Surtout, rien au niveau du systeme n'empechait FlixTunes d'effacer la mediatheque —
# seule la bonne conduite du code l'en empechait. Un compte qui n'a que le droit de lire les medias
# rend la lecture seule verifiable par le systeme, et non promise par le programme.
#
# Le risque de la bascule est connu et unique : perdre /dev/dri/renderD128, donc VA-API, donc retomber
# de 471 a 151 images par seconde. Il est traite par une sonde **avant** la bascule, et par un repli
# vers root si le demarrage non privilegie echoue quand meme. Le pire cas est donc le comportement
# d'hier, jamais une degradation silencieuse.
UTILISATEUR_CIBLE="${FLIXTUNES_RUN_AS:-flixtunes}"

journal_privilege() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Privileges : $1"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Privileges : $1" >>"$SHARE_ROOT/logs/privileges.log" 2>/dev/null || true
}

# Accorde le peripherique de rendu au compte de service.
#
# Constate sur cet ADM en r60 : /dev/dri/renderD128 est en `crw-rw---- root root`, et il n'existe **ni
# groupe `video` ni groupe `render`** — les noms que tout le reste du monde Linux emploie. Le compte de
# service ne pouvait donc pas l'ouvrir, la sonde refusait la bascule, et le service restait en root.
#
# Sur un poste Linux ordinaire, c'est une regle udev qui fait ce travail. ADM n'en a pas : on le fait
# ici, a chaque demarrage, parce que /dev est reconstruit a chaque redemarrage du NAS.
#
# Le proprietaire reste root, seul le groupe change : root garde son acces par la propriete, et rien
# d'autre que ce compte ne gagne quoi que ce soit. C'est l'inverse d'ajouter le compte au groupe root,
# qui lui donnerait acces a tout ce que ce groupe protege.
preparer_peripherique_rendu() {
  [ "$(id -u 2>/dev/null)" = "0" ] || return 0
  [ -e /dev/dri/renderD128 ] || return 0
  id "$UTILISATEUR_CIBLE" >/dev/null 2>&1 || return 0
  GROUPE_CIBLE="$(id -gn "$UTILISATEUR_CIBLE" 2>/dev/null)"
  [ -n "$GROUPE_CIBLE" ] || return 0
  [ "$GROUPE_CIBLE" = "root" ] && return 0
  if chgrp "$GROUPE_CIBLE" /dev/dri/renderD128 2>/dev/null     || chown ":$GROUPE_CIBLE" /dev/dri/renderD128 2>/dev/null; then
    chmod 660 /dev/dri/renderD128 2>/dev/null || true
    journal_privilege "peripherique de rendu accorde au groupe $GROUPE_CIBLE"
  else
    journal_privilege "impossible de changer le groupe de renderD128 : le service restera en root"
  fi
}

# Rend le nom du compte a employer, ou une chaine vide pour rester tel quel.
compte_utilisable() {
  [ "$(id -u 2>/dev/null)" = "0" ] || { journal_privilege "deja sans privilege ($(id -un 2>/dev/null))"; return 1; }
  [ -n "$UTILISATEUR_CIBLE" ] || return 1
  [ "$UTILISATEUR_CIBLE" = "root" ] && { journal_privilege "root demande explicitement"; return 1; }
  id "$UTILISATEUR_CIBLE" >/dev/null 2>&1 || { journal_privilege "compte $UTILISATEUR_CIBLE absent : maintien en root"; return 1; }
  command -v su >/dev/null 2>&1 || { journal_privilege "su indisponible : maintien en root"; return 1; }

  # Le partage doit rester inscriptible, sinon ni base, ni journaux, ni sessions.
  su -s /bin/sh -c "test -w '$SHARE_ROOT' && test -w '$SHARE_ROOT/logs'" "$UTILISATEUR_CIBLE" 2>/dev/null || {
    journal_privilege "partage non inscriptible par $UTILISATEUR_CIBLE : maintien en root"; return 1; }

  # Le peripherique de rendu doit rester ouvert, sans quoi la bascule couterait l'acceleration.
  if [ -e /dev/dri/renderD128 ]; then
    su -s /bin/sh -c "test -r /dev/dri/renderD128" "$UTILISATEUR_CIBLE" 2>/dev/null || {
      journal_privilege "renderD128 illisible par $UTILISATEUR_CIBLE : maintien en root pour ne pas perdre VA-API"
      return 1; }
  fi

  # Les bibliotheques doivent etre lisibles : un paquet installe avec des droits restrictifs ferait
  # echouer le demarrage bien plus loin, dans un message d'editeur de liens illisible a distance.
  su -s /bin/sh -c "test -x '$NODE_BIN' && test -r '$SERVER_ENTRY'" "$UTILISATEUR_CIBLE" 2>/dev/null || {
    journal_privilege "runtime illisible par $UTILISATEUR_CIBLE : maintien en root"; return 1; }

  journal_privilege "service demarre sous $UTILISATEUR_CIBLE"
  return 0
}

start_server() {
  is_running && return 0
  [ -x "$NODE_BIN" ] || { echo "Runtime Node.js FlixTunes absent ou non exécutable." >&2; return 1; }
  [ -f "$SERVER_ENTRY" ] || { echo "Serveur FlixTunes précompilé absent." >&2; return 1; }
  [ -f "$CONFIG_FILE" ] || { echo "Configuration FlixTunes absente." >&2; return 1; }
  mkdir -p "$SHARE_ROOT/logs" "$SHARE_ROOT/tmp"
  if [ -z "${SOUS_COMPTE+defini}" ]; then
    preparer_peripherique_rendu
    if compte_utilisable; then SOUS_COMPTE="$UTILISATEUR_CIBLE"; else SOUS_COMPTE=""; fi
  fi
  (
    set -a
    . "$CONFIG_FILE"
    [ -f "$WAN_FILE" ] && . "$WAN_FILE"
    set +a
    # FFmpeg est desormais construit en variante **partagee**, et ne demarre pas sans ses
    # bibliotheques. C'est le prix a payer, et c'est aussi la solution : la variante statique embarquait
    # ses propres libva et libdrm, tandis que le pilote VA-API chargeait les siennes. Deux libdrm
    # manipulant le meme descripteur /dev/dri, cela se terminait en segfault — quel que soit le pilote,
    # ce qui a longtemps fait chercher au mauvais endroit.
    #
    # Le repertoire du pilote figure dans le meme chemin : une seule libva et une seule libdrm vivent
    # ainsi dans le processus, celles que ce paquet fournit.
    LD_LIBRARY_PATH="$APKG_PKG_DIR/runtime/ffmpeg/lib:$APKG_PKG_DIR/runtime/va${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    export LD_LIBRARY_PATH

    # Quick Sync ne se trouve pas par le chemin des bibliotheques.
    #
    # oneVPL n'est qu'un repartiteur : il charge ensuite un runtime GPU — `libmfxhw64` pour les puces
    # jusqu'a Gen11, `libmfx-gen` a partir de Gen12 — qu'il cherche dans ses propres emplacements, pas
    # dans `LD_LIBRARY_PATH`. Les deux sont embarques ; sans cette variable, le repartiteur ne les voit
    # pas et Quick Sync echoue en annoncant qu'il ne peut pas ouvrir de session, ce qui se lit comme un
    # pilote absent alors que tout est la.
    ONEVPL_SEARCH_PATH="$APKG_PKG_DIR/runtime/va${ONEVPL_SEARCH_PATH:+:$ONEVPL_SEARCH_PATH}"
    export ONEVPL_SEARCH_PATH

    export FFMPEG_PATH="$APKG_PKG_DIR/runtime/ffmpeg/bin/ffmpeg"
    export FFPROBE_PATH="$APKG_PKG_DIR/runtime/ffmpeg/bin/ffprobe"
    export HOME="$SHARE_ROOT" TMPDIR="$SHARE_ROOT/tmp"

    # --- Accélération matérielle ------------------------------------------------------------------
    #
    # Sans cela, FFmpeg transcode sur le processeur alors que la puce Intel est présente. Mesuré sur un
    # AS5404T (Celeron N5105) : 29 images/seconde en logiciel, et un budget d'une seule conversion.
    #
    # La cause n'est ni le périphérique ni les droits — /dev/dri/renderD128 existe et le service tourne
    # en root. Elle tient à deux détails de l'environnement :
    #
    #   1. libva cherche ses pilotes dans un chemin figé à la compilation (/usr/local/lib), où ADM n'en
    #      place aucun ;
    #   2. le pilote refuse de se charger faute de libpciaccess.so.0, absente des chemins de l'éditeur
    #      de liens.
    #
    # Chaque combinaison est **éprouvée** avant d'être retenue, au lieu d'être choisie sur la seule
    # présence d'un fichier. Un pilote présent mais incompatible — compilé pour une autre bibliothèque C,
    # ou pour une puce plus ancienne — échouerait sinon en pleine lecture, bien plus difficile à
    # diagnostiquer qu'un refus au démarrage. Le coût est d'une poignée de secondes, une fois.
    # La sortie d'erreur de chaque essai est conservée : quand aucune combinaison ne passe, c'est la
    # seule chose qui permette de savoir pourquoi. Sans elle, le journal ne disait qu'« aucun pilote
    # utilisable » — vrai, mais inexploitable à distance, et il a fallu deux versions pour découvrir
    # qu'une bibliothèque manquait au paquet.
    # La revision du paquet, lue dans son propre manifeste, est transmise au serveur.
    #
    # La version applicative ne suffit pas a identifier ce qui tourne : plusieurs revisions partagent
    # la meme version, et c'est justement entre deux revisions qu'un correctif d'empaquetage se juge.
    # Sans elle, impossible de savoir depuis l'ecran de diagnostic si un correctif est installe.
    FLIXTUNES_PACKAGE_REVISION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"[^"]*\.\(r[0-9][0-9]*\)".*/\1/p' "$APKG_PKG_DIR/CONTROL/config.json" 2>/dev/null | head -1)"
    export FLIXTUNES_PACKAGE_REVISION

    # Dans le dossier partage, a cote du journal du serveur : c'est le seul endroit que l'utilisateur
    # atteint sans SSH ni acces au repertoire d'installation. Un diagnostic qu'on ne peut pas lire ne
    # sert a rien.
    VA_JOURNAL="$SHARE_ROOT/logs/va-probe.log"
    : > "$VA_JOURNAL" 2>/dev/null || VA_JOURNAL=/dev/null
    # Une sonde materielle ne doit jamais pouvoir retenir le demarrage.
    #
    # Elle n'en avait aucune limite, et le defaut est reste invisible tant qu'une bibliotheque
    # manquait : `dlopen` echouait instantanement, la sonde rendait la main aussitot. Des que la
    # bibliotheque a ete fournie, ffmpeg s'est mis a solliciter reellement le peripherique de rendu —
    # ou il peut rester bloque, sur un pilote qui tourne en rond ou un GPU deja pris. Le journal s'est
    # alors arrete sans verdict, le serveur ne demarrait plus, et l'installation ne se terminait pas.
    #
    # `timeout` n'existe pas partout : plutot que d'en dependre, la sonde est lancee en arriere-plan et
    # surveillee. Passe le delai, elle est tuee et comptee comme un refus — un accelerateur qui met
    # plus de quinze secondes a repondre a une image de 64 pixels ne servirait de toute facon a rien.
    VA_DELAI=15
    va_probe() {
      (
        LIBVA_MESSAGING_LEVEL=2 LIBVA_DRIVERS_PATH="$1" LIBVA_DRIVER_NAME="$2" LD_LIBRARY_PATH="$3${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" "$APKG_PKG_DIR/runtime/ffmpeg/bin/ffmpeg" -hide_banner -loglevel error -init_hw_device vaapi=probe:/dev/dri/renderD128 -f lavfi -i testsrc=size=64x64:rate=1:duration=1 -f null - >/dev/null 2>"$VA_JOURNAL.tmp"
      ) &
      va_pid=$!
      va_attente=0
      while [ "$va_attente" -lt "$VA_DELAI" ] && kill -0 "$va_pid" 2>/dev/null; do
        sleep 1
        va_attente=$((va_attente + 1))
      done
      if kill -0 "$va_pid" 2>/dev/null; then
        kill -9 "$va_pid" 2>/dev/null || true
        wait "$va_pid" 2>/dev/null || true
        va_code=124
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Essai abandonne apres ${VA_DELAI}s : pilote=$2 chemin=$1" >> "$VA_JOURNAL"
      else
        wait "$va_pid" 2>/dev/null && va_code=0 || va_code=$?
      fi
      if [ "$va_code" -ne 0 ] && [ "$va_code" -ne 124 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Essai refuse : pilote=$2 chemin=$1 libs=$3" >> "$VA_JOURNAL"
        # Mille caracteres, pas six cents : les messages de libva precedent ceux de FFmpeg, et c'est
        # justement eux qu'une troncature trop courte coupait.
        head -c 1000 "$VA_JOURNAL.tmp" >> "$VA_JOURNAL" 2>/dev/null
        echo >> "$VA_JOURNAL"
      fi
      rm -f "$VA_JOURNAL.tmp"
      return $va_code
    }

    # Ce que le service voit du noeud de rendu, releve une fois : un pilote parfait ne sert a rien si le
    # peripherique n'est pas lisible par l'utilisateur qui execute FlixTunes, et rien dans le message
    # de libva ne le laisse deviner.
    {
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] Diagnostic VA-API - utilisateur $(id -un 2>/dev/null) ($(id -u 2>/dev/null)), groupes : $(id -Gn 2>/dev/null)"
      if [ -e /dev/dri/renderD128 ]; then
        ls -l /dev/dri/ 2>&1
        if [ -r /dev/dri/renderD128 ]; then echo "renderD128 lisible"; else echo "renderD128 NON lisible par ce service"; fi
      else
        echo "/dev/dri/renderD128 absent"
      fi
      echo "--- contenu du pilote embarque ---"
      ls -l "$APKG_PKG_DIR/runtime/va" 2>&1 | head -12
    } >> "$VA_JOURNAL"

    # La libva de Jellyfin n'honore pas `LIBVA_DRIVERS_PATH`.
    #
    # Elle est compilee avec ses chemins de recherche figes et ignore la variable — verifie sur le NAS :
    # avec `LIBVA_DRIVERS_PATH` et `LIBVA_DRIVER_NAME` poses, son journal n'en fait aucune mention et
    # elle n'essaie que `/usr/lib/jellyfin-ffmpeg/lib/dri`, `/usr/lib/x86_64-linux-gnu/dri`, `/usr/lib/dri`
    # et `/usr/local/lib/dri`. Les cinq pilotes livres echouaient donc identiquement, non pas parce
    # qu'ils etaient mauvais mais parce qu'aucun n'etait jamais regarde.
    #
    # Le pilote est donc depose la ou elle regarde. Ce chemin appartient a `jellyfin-ffmpeg`, qui n'est
    # pas installe ici : rien d'autre ne s'en sert, et `post-uninstall.sh` le retire. La copie est
    # refaite a chaque demarrage plutot qu'a l'installation, parce que la racine d'un NAS peut etre
    # remontee a neuf au redemarrage — auquel cas le pilote disparaitrait sans que rien ne le signale.
    VA_CHEMIN_LIBVA="/usr/lib/jellyfin-ffmpeg/lib/dri"
    if mkdir -p "$VA_CHEMIN_LIBVA" 2>/dev/null; then
      for va_nom in iHD i965; do
        va_source="$APKG_PKG_DIR/runtime/va/${va_nom}_drv_video.so"
        [ -f "$va_source" ] || continue
        va_cible="$VA_CHEMIN_LIBVA/${va_nom}_drv_video.so"
        if [ ! -e "$va_cible" ] || [ "$va_source" -nt "$va_cible" ]; then
          cp -f "$va_source" "$va_cible" 2>/dev/null || true
        fi
      done
      # Le runtime Quick Sync se depose au meme titre, un cran plus haut.
      #
      # oneVPL n'est qu'un repartiteur : il charge ensuite `libmfxhw64` (jusqu'a Gen11) ou `libmfx-gen`
      # (a partir de Gen12), et les cherche dans ses propres emplacements — `ONEVPL_SEARCH_PATH` ne
      # suffit pas ici. Verifie sur le NAS : une fois ces bibliotheques posees a cote de FFmpeg, la
      # session materielle MFX s'ouvre, la ou elle echouait auparavant en annoncant un noeud de rendu
      # absent — un message qui ne designait pas la cause.
      for va_runtime in "$APKG_PKG_DIR"/runtime/va/libmfxhw64.so* "$APKG_PKG_DIR"/runtime/va/libmfx-gen.so* "$APKG_PKG_DIR"/runtime/va/libvpl.so*
      do
        [ -f "$va_runtime" ] || continue
        va_cible="$(dirname "$VA_CHEMIN_LIBVA")/$(basename "$va_runtime")"
        if [ ! -e "$va_cible" ] || [ "$va_runtime" -nt "$va_cible" ]; then
          cp -f "$va_runtime" "$va_cible" 2>/dev/null || true
        fi
      done
    else
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] $VA_CHEMIN_LIBVA non creable : la libva embarquee ne verra ni le pilote ni le runtime Quick Sync." >> "$VA_JOURNAL"
    fi

    # Les bibliothèques d'appoint sont cherchées d'abord : elles conditionnent le chargement du pilote.
    VA_LIBS=""
    for lib_dir in "$APKG_PKG_DIR/runtime/va" /volume*/.@plugins/AppCentral/xorg/usr/lib       /volume*/.@plugins/AppCentral/ffmpeg/lib /volume*/.@plugins/lib
    do
      [ -f "$lib_dir/libpciaccess.so.0" ] || continue
      VA_LIBS="$lib_dir"
      break
    done

    # Le pilote embarqué passe en premier : il ne dépend d'aucun autre paquet, et ne disparaîtra pas
    # le jour où celui-ci sera désinstallé. Les copies du système servent de secours.
    # Deux pilotes embarques, essayes dans l'ordre, et c'est la machine qui tranche.
    #
    # Celui de Jellyfin est apparie a sa libva et bien plus recent. Celui de Debian bullseye est plus
    # ancien — mais c'est lui dont le NAS de reference a prouve qu'il s'initialise, la ou le recent
    # echoue avant meme d'ouvrir une session. Un pilote recent suppose un noyau et un micrologiciel
    # que tous les ADM n'ont pas.
    #
    # Les deux sont donc livres et sondes tour a tour, plutot que d'en choisir un sur une supposition.
    # libva sait charger un pilote plus ancien qu'elle : son ABI le prevoit, et c'est ce qui rend
    # l'assemblage possible.
    VA_FOUND=""
    for va_dir in "$VA_CHEMIN_LIBVA" "$APKG_PKG_DIR/runtime/va" "$APKG_PKG_DIR/runtime/va-legacy" /volume*/.@plugins/AppCentral/xorg/usr/lib/va       /volume*/.@plugins/AppCentral/ffmpeg/lib /usr/lib/dri /usr/lib64/dri
    do
      [ -d "$va_dir" ] || continue
      # iHD couvre les puces Intel récentes — Jasper Lake et au-delà ; i965 ne couvre que les anciennes.
      for va_name in iHD i965; do
        [ -f "$va_dir/${va_name}_drv_video.so" ] || continue
        # Le repertoire du pilote passe en tete du chemin de recherche : le pilote ancien reclame
        # `libigdgmm.so.11`, le recent `libigdgmm.so.12`, et chacun doit trouver la sienne sans que
        # celle de l'autre s'interpose.
        if va_probe "$va_dir" "$va_name" "$va_dir:${VA_LIBS:-$va_dir}"; then
          export LIBVA_DRIVERS_PATH="$va_dir" LIBVA_DRIVER_NAME="$va_name"
          LD_LIBRARY_PATH="$va_dir${VA_LIBS:+:$VA_LIBS}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
          export LD_LIBRARY_PATH
          VA_FOUND="$va_dir ($va_name)"
          break
        fi
      done
      # `[ -n "$VA_FOUND" ] && break` en fin de corps de boucle est un piege sous `set -e` : quand la
      # condition est fausse, la liste ET rend 1, et le shell s'arrete la — avant le verdict, et avant
      # meme de lancer le serveur. La forme explicite ne rend jamais un etat d'echec.
      if [ -n "$VA_FOUND" ]; then break; fi
    done

    # Le verdict va dans le journal de sonde **et** sur la sortie standard.
    #
    # Il n'allait que sur la sortie standard, donc dans le journal du serveur — alors que le journal de
    # sonde est le fichier qu'on ouvre pour savoir ce que l'acceleration a donne. Celui-ci s'arretait
    # apres l'inventaire du pilote, ce qui se lit comme une sonde interrompue alors qu'elle avait
    # simplement ecrit sa conclusion ailleurs. Deux personnes s'y sont trompees, dont moi.
    if [ -n "$VA_FOUND" ]; then
      VA_VERDICT="[$(date '+%Y-%m-%d %H:%M:%S')] Accélération matérielle active : $VA_FOUND"
    else
      VA_VERDICT="[$(date '+%Y-%m-%d %H:%M:%S')] Aucun pilote VA-API utilisable : conversions sur le processeur."
    fi
    echo "$VA_VERDICT"
    echo "$VA_VERDICT" >> "$VA_JOURNAL" 2>/dev/null || true
    cd "$APKG_PKG_DIR/app"
    if [ -n "$SOUS_COMPTE" ]; then
      # `su -m` conserve l'environnement prepare ci-dessus — chemins FFmpeg, VA-API, TMPDIR. Sans lui,
      # tout le travail d'acceleration serait perdu au passage.
      exec su -m -s /bin/sh -c "exec '$NODE_BIN' apps/server/dist/index.js" "$SOUS_COMPTE"
    fi
    exec "$NODE_BIN" apps/server/dist/index.js
  ) >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  sleep 1
  if ! is_running && [ -n "$SOUS_COMPTE" ]; then
    # Deuxieme filet : la sonde peut passer et le demarrage echouer quand meme — un `su` qui refuse
    # sans terminal, un droit manquant plus loin. On reprend alors le comportement d'hier plutot que
    # de laisser le service arrete.
    journal_privilege "demarrage sous $SOUS_COMPTE echoue : reprise en root"
    rm -f "$PID_FILE"
    SOUS_COMPTE=""
    start_server
    return $?
  fi
  is_running || { echo "FlixTunes n'a pas démarré. Consultez $LOG_FILE" >&2; return 1; }
}

stop_server() {
  if is_running; then
    PID="$(cat "$PID_FILE")"
    kill "$PID" 2>/dev/null || true
    COUNT=0
    while kill -0 "$PID" 2>/dev/null && [ "$COUNT" -lt 30 ]; do
      sleep 1
      COUNT=$((COUNT + 1))
    done
    kill -9 "$PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}

caddy_running() {
  [ -f "$CADDY_PID_FILE" ] && kill -0 "$(cat "$CADDY_PID_FILE")" 2>/dev/null
}

# La Caddyfile est engendree a chaque demarrage depuis la configuration, jamais editee a la main :
# elle doit suivre le domaine et les ports sans qu'on ait a se souvenir de la regenerer.
ecrire_caddyfile() {
  mkdir -p "$(dirname "$CADDY_FILE")" "$CADDY_DIR" "$SHARE_ROOT/logs"
  cat >"$CADDY_FILE" <<CADDYEOF
{
	# Les serveurs de Let's Encrypt se connectent a l'IP publique sur 80 et 443 ; la box traduit vers
	# ces ports-ci. Caddy n'a donc aucun port privilegie a lier, et tourne sans privilege.
	http_port ${FLIXTUNES_WAN_HTTP_PORT:-8080}
	https_port ${FLIXTUNES_WAN_HTTPS_PORT:-8444}
	# Le routeur publie 443 puis traduit vers 8444. HTTP/3 annoncerait sinon :8444 au mobile, qui
	# tenterait ce port public non redirige. H1/H2 gardent l'URL publique et le certificat corrects.
	servers {
		protocols h1 h2
	}
	storage file_system {
		root $CADDY_DIR
	}
	admin off
}

${FLIXTUNES_WAN_DOMAIN} {
	reverse_proxy 127.0.0.1:${FLIXTUNES_WAN_PORT:-4001}
	# La video, les segments et les jaquettes sont deja compresses : les recomprimer couterait du
	# processeur pour rien, et sur un N5105 ce rien se paie sur les conversions en cours.
	#
	# Exprime en exclusion de chemins plutot qu'en types de contenu : dans un bloc "match", Caddy
	# combine les criteres en ET, donc plusieurs lignes "header Content-Type" reclameraient plusieurs
	# types a la fois — condition impossible, et compression jamais appliquee.
	#
	# Aucun accent grave ici : ce document est volontairement non quote, pour que le domaine et les
	# ports soient developpes. Le shell y substituerait donc toute commande entre accents graves.
	@compressible not path *.m4s *.ts *.mp4 *.m3u8 *.mpd *.jpg *.jpeg *.png *.webp *.woff2
	encode @compressible zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		-Server
	}
	log {
		output file $CADDY_LOG {
			roll_size 5MiB
			roll_keep 2
		}
	}
}
CADDYEOF
}

start_caddy() {
  # Sans domaine, l'acces distant n'existe pas : aucun port n'est lie, aucun certificat n'est demande.
  # Une mise a jour ne peut donc pas ouvrir l'exterieur par effet de bord.
  [ -n "${FLIXTUNES_WAN_DOMAIN:-}" ] || return 0
  caddy_running && return 0
  # Distinguer les deux cas : un binaire present mais non executable s'est deja produit, et le message
  # « absent » envoyait chercher au mauvais endroit.
  if [ ! -e "$CADDY_BIN" ]; then
    echo "Caddy absent du paquet : acces distant indisponible." >&2
    return 0
  fi
  if [ ! -x "$CADDY_BIN" ]; then
    echo "Caddy present mais non executable ($CADDY_BIN) : acces distant indisponible." >&2
    return 0
  fi
  ecrire_caddyfile
  XDG_DATA_HOME="$CADDY_DIR" XDG_CONFIG_HOME="$CADDY_DIR" \
    "$CADDY_BIN" validate --config "$CADDY_FILE" --adapter caddyfile >>"$CADDY_LOG" 2>&1 || {
      echo "Configuration Caddy invalide : acces distant non demarre. Consultez $CADDY_LOG" >&2
      return 0
    }

  # Le proxy ne lie que 8080/8444 : il n'a pas plus besoin de root que le serveur applicatif. Ses
  # donnees ACME et son journal doivent toutefois appartenir au compte avant la baisse de privilege.
  if [ -n "${SOUS_COMPTE:-}" ] && [ "$(id -u 2>/dev/null)" = "0" ]; then
    touch "$CADDY_LOG" 2>/dev/null || true
    chown -R "$SOUS_COMPTE" "$CADDY_DIR" 2>/dev/null || true
    chown "$SOUS_COMPTE" "$CADDY_FILE" "$CADDY_LOG" 2>/dev/null || true
    ( XDG_DATA_HOME="$CADDY_DIR" XDG_CONFIG_HOME="$CADDY_DIR" \
      exec su -m -s /bin/sh -c "exec '$CADDY_BIN' run --config '$CADDY_FILE' --adapter caddyfile" "$SOUS_COMPTE"
    ) >>"$CADDY_LOG" 2>&1 &
  else
    ( XDG_DATA_HOME="$CADDY_DIR" XDG_CONFIG_HOME="$CADDY_DIR" \
      exec "$CADDY_BIN" run --config "$CADDY_FILE" --adapter caddyfile
    ) >>"$CADDY_LOG" 2>&1 &
  fi
  echo $! >"$CADDY_PID_FILE"
  sleep 1
  if ! caddy_running; then
    echo "Caddy n'a pas demarre. Consultez $CADDY_LOG" >&2
    rm -f "$CADDY_PID_FILE"
  fi
}

stop_caddy() {
  if caddy_running; then
    CADDY_PID="$(cat "$CADDY_PID_FILE")"
    kill "$CADDY_PID" 2>/dev/null || true
    COUNT=0
    while kill -0 "$CADDY_PID" 2>/dev/null && [ "$COUNT" -lt 15 ]; do
      sleep 1
      COUNT=$((COUNT + 1))
    done
    kill -9 "$CADDY_PID" 2>/dev/null || true
  fi
  rm -f "$CADDY_PID_FILE"
}

# L'ordre compte dans les deux sens : TLS ne doit pas accepter de connexion avant que le serveur
# reponde, et doit cesser d'en accepter avant qu'il s'arrete.
demarrer_tout() {
  start_server
  ( set -a; . "$CONFIG_FILE"; [ -f "$WAN_FILE" ] && . "$WAN_FILE"; set +a; start_caddy )
}

arreter_tout() {
  ( set -a; . "$CONFIG_FILE" 2>/dev/null || true; [ -f "$WAN_FILE" ] && . "$WAN_FILE"; set +a; stop_caddy )
  stop_server
}

# Deux processus, donc deux etats. « Node vivant, Caddy mort » veut dire « le reseau local marche,
# l'acces distant est tombe » : cela doit se voir, et non se confondre avec un arret complet.
etat() {
  if is_running; then echo "FlixTunes : en service"; else echo "FlixTunes : arrete"; fi
  if [ -n "${FLIXTUNES_WAN_DOMAIN:-}" ] || [ -f "$CADDY_PID_FILE" ]; then
    if caddy_running; then echo "Acces distant : en service"; else echo "Acces distant : ARRETE"; fi
  fi
  is_running
}

case "${1:-}" in
  start) demarrer_tout ;;
  stop) arreter_tout ;;
  restart) arreter_tout; demarrer_tout ;;
  status) ( set -a; . "$CONFIG_FILE" 2>/dev/null || true; [ -f "$WAN_FILE" ] && . "$WAN_FILE"; set +a; etat ) ;;
  *) echo "Usage: $0 {start|stop|restart|status}" >&2; exit 2 ;;
esac
