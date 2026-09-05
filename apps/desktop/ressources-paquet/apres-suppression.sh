#!/bin/bash
# Ajouté au `postrm` du paquet : on retire ce que l'installation avait posé hors de son arborescence.
#
# Le profil AppArmor vit dans `/etc/apparmor.d`, qui n'appartient pas au paquet : `dpkg` ne le
# supprimera donc jamais de lui-même, et il resterait à désigner un binaire disparu. On ne le retire
# qu'à la **purge** — une simple désinstallation précède souvent une réinstallation, et reposer le
# profil à chaque fois n'apporterait rien.

if [ "$1" = "purge" ]; then
  PROFIL=/etc/apparmor.d/flixtunes
  if [ -f "$PROFIL" ]; then
    if command -v apparmor_parser >/dev/null 2>&1; then
      apparmor_parser -R "$PROFIL" >/dev/null 2>&1 || true
    fi
    rm -f "$PROFIL"
  fi
fi
