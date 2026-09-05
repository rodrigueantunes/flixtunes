#!/bin/bash
# Ce qui suit est ajouté au `postinst` du paquet Debian, après ce qu'electron-builder y écrit.
#
# **Pourquoi FlixTunes se fermait aussitôt lancé, sur Ubuntu 24.04 et au-delà.**
#
# Rapporté sur Ubuntu 26.04 : l'application quitte immédiatement avec le signal 5, SIGTRAP, sans
# jamais dessiner de fenêtre. Ce n'est pas une panne de FlixTunes mais du bac à sable de Chromium,
# qu'Electron embarque.
#
# Le script d'installation d'electron-builder choisit entre deux mécanismes :
#
#     if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
#         chmod 4755 chrome-sandbox   # pas d'espaces de noms : bac à sable SUID
#     else
#         chmod 0755 chrome-sandbox   # espaces de noms disponibles
#     fi
#
# Le test est fait par `root` pendant l'installation, et il **réussit**. On retient donc la seconde
# branche. Mais à l'exécution, l'utilisateur n'est pas root, et Ubuntu 24.04 a introduit une
# restriction AppArmor — `kernel.apparmor_restrict_unprivileged_userns` — qui interdit les espaces de
# noms non privilégiés aux binaires non confinés. Or `/opt` n'est couvert par aucun profil. Chromium
# ne peut donc créer ni l'un ni l'autre de ses bacs à sable, et s'arrête net.
#
# La réponse recommandée par Ubuntu pour les paquets tiers est un profil AppArmor qui accorde
# explicitement ce droit au binaire. On l'écrit ici plutôt que de l'embarquer : le paquet est
# construit sous Windows, où l'on ne sait ni poser les droits ni garantir les fins de ligne d'un
# fichier destiné à `/etc`.
#
# **Et si AppArmor n'est pas là**, on repose le bit SUID sur le bac à sable : c'est l'autre mécanisme,
# celui qu'electron-builder aurait choisi si son test avait dit vrai.

PROFIL=/etc/apparmor.d/flixtunes
RESTRICTION=/proc/sys/kernel/apparmor_restrict_unprivileged_userns

if [ -r "$RESTRICTION" ] && [ "$(cat "$RESTRICTION" 2>/dev/null)" = "1" ]; then
  if command -v apparmor_parser >/dev/null 2>&1 && [ -d /etc/apparmor.d ]; then
    cat > "$PROFIL" <<'PROFIL_APPARMOR'
# Profil minimal pour FlixTunes, paquet tiers installé hors des chemins du système.
#
# Il n'ajoute qu'une permission : créer un espace de noms utilisateur, ce dont le bac à sable de
# Chromium a besoin. `flags=(unconfined)` dit qu'on ne prétend pas confiner l'application — ce
# profil existe pour lever une interdiction, pas pour en poser de nouvelles.
abi <abi/4.0>,
include <tunables/global>

profile flixtunes /opt/FlixTunes/flixtunes flags=(unconfined) {
  userns,
  include if exists <local/flixtunes>
}
PROFIL_APPARMOR
    # Le rechargement peut échouer sur un noyau sans le module : on ne fait pas échouer
    # l'installation pour autant, la solution de repli ci-dessous prend le relais.
    if ! apparmor_parser -r "$PROFIL" >/dev/null 2>&1; then
      rm -f "$PROFIL"
      chmod 4755 '/opt/FlixTunes/chrome-sandbox' 2>/dev/null || true
    fi
  else
    chmod 4755 '/opt/FlixTunes/chrome-sandbox' 2>/dev/null || true
  fi
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi
# Le cache d'icônes ne se relit pas tout seul : sans cela l'application garde l'icône générique
# jusqu'à la prochaine session, alors que le fichier est bien en place.
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t /usr/share/icons/hicolor >/dev/null 2>&1 || true
fi
