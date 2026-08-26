#!/usr/bin/env python3
"""Extrait le FFmpeg portable de Jellyfin dans la disposition attendue par FlixTunes.

Pourquoi celui-ci plutôt que les constructions génériques de BtbN — le raisonnement a coûté plusieurs
révisions à établir, autant l'écrire.

FFmpeg appelle `vaMapBuffer2` sur le chemin d'encodage VA-API. Ce symbole est apparu dans libva 2.21.
Or l'ADM des NAS ASUSTOR tourne en glibc 2.31, et aucune libva de Debian ne réunit les deux : celle de
bullseye (2.10) a la bonne glibc mais pas le symbole ; celles qui l'ont (2.22, 2.24) exigent glibc
2.38. Les constructions de BtbN chargent libva par `implib-gen`, qui **abandonne le processus** devant
un symbole absent au lieu de dégrader — relevé mot pour mot sur le NAS :

    implib-gen: libva.so.2: failed to resolve symbol 'vaMapBuffer2' via dlsym
    ffmpeg: libva.so.2.init.c:290: _libva_so_2_tramp_resolve: Assertion `0' failed. Aborted

Deux constructions Jellyfin existent, et le choix entre elles n'est pas indifférent. Le paquet Debian
`bullseye` réclame une vingtaine de bibliothèques de cette distribution — `libx264`, `libmp3lame`,
`libgnutls` — que l'ADM n'a pas. La construction **portable**, elle, ne dépend que de la bibliothèque
C : c'est celle-ci qu'on embarque, et l'étage VA-API vient du paquet Debian, par `extract-jellyfin-va.py`.

Usage : extract-jellyfin-ffmpeg.py <portable.tar.xz> <destination>
"""
from __future__ import annotations

import shutil
import sys
import tarfile
from pathlib import Path

BINAIRES = ("ffmpeg", "ffprobe")


def extraire(archive: Path, destination: Path) -> int:
    """Pose `bin/ffmpeg` et `bin/ffprobe` dans [destination]. Rend le nombre de fichiers écrits."""
    if destination.exists():
        shutil.rmtree(destination)
    binaires = destination / "bin"
    binaires.mkdir(parents=True)

    ecrits = 0
    with tarfile.open(archive, "r:xz") as tar:
        for membre in tar.getmembers():
            nom = Path(membre.name).name
            if not membre.isfile() or nom not in BINAIRES:
                continue
            flux = tar.extractfile(membre)
            if flux is None:
                continue
            cible = binaires / nom
            cible.write_bytes(flux.read())
            # Le bit d'exécution ne survit pas à Windows : il est reposé explicitement, faute de quoi
            # le paquet s'installe et le service ne démarre pas.
            cible.chmod(0o755)
            ecrits += 1
    return ecrits


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("Usage : extract-jellyfin-ffmpeg.py <portable.tar.xz> <destination>")
    archive, destination = Path(sys.argv[1]), Path(sys.argv[2])
    ecrits = extraire(archive, destination)
    if ecrits != len(BINAIRES):
        print(f"FFmpeg incomplet : {ecrits} binaire(s) extrait(s) sur {len(BINAIRES)}.", file=sys.stderr)
        return 1
    taille = sum(f.stat().st_size for f in (destination / "bin").iterdir()) / 1048576
    print(f"FFmpeg Jellyfin portable extrait : {ecrits} binaires, {taille:.0f} Mio.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
