#!/bin/sh
set -eu

# Le pilote VA-API depose hors du paquet est repris.
#
# La libva embarquee n'honore pas `LIBVA_DRIVERS_PATH` : elle ne consulte que des chemins figes a la
# compilation. Le service depose donc le pilote dans `/usr/lib/jellyfin-ffmpeg/lib/dri` a chaque
# demarrage. C'est le seul fichier que FlixTunes ecrive hors de son propre repertoire, et le laisser
# derriere lui apres une desinstallation serait malpoli — d'autant qu'il porte le nom d'un paquet qui
# n'est pas installe ici, et que personne n'irait donc chercher.
#
# Seuls les fichiers deposes sont retires, et le repertoire n'est supprime que s'il est vide : un
# `jellyfin-ffmpeg` reellement installe entre-temps ne doit rien perdre.
VA_CHEMIN_LIBVA="/usr/lib/jellyfin-ffmpeg/lib/dri"
for va_nom in iHD i965; do
  rm -f "$VA_CHEMIN_LIBVA/${va_nom}_drv_video.so" 2>/dev/null || true
done
# Le runtime Quick Sync a ete depose au meme endroit, un cran plus haut.
rm -f /usr/lib/jellyfin-ffmpeg/lib/libmfxhw64.so* /usr/lib/jellyfin-ffmpeg/lib/libmfx-gen.so*       /usr/lib/jellyfin-ffmpeg/lib/libvpl.so* 2>/dev/null || true
rmdir "$VA_CHEMIN_LIBVA" "/usr/lib/jellyfin-ffmpeg/lib" "/usr/lib/jellyfin-ffmpeg" 2>/dev/null || true

echo "Les données FlixTunes sont conservées dans le partage /volume1/FlixTunes."
