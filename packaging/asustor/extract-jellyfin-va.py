#!/usr/bin/env python3
"""Extrait l'étage VA-API du paquet Debian de Jellyfin : libva, son pilote, et le runtime Quick Sync.

Jellyfin construit sa propre libva pour chaque distribution cible. Son paquet `bullseye` fournit donc
ce qui n'existe nulle part ailleurs : une **libva 2.23 compilée contre glibc 2.30**, appariée à son
pilote `iHD` et à sa libdrm. C'est la seule combinaison connue qui expose `vaMapBuffer2` — le symbole
que FFmpeg réclame à l'encodage — tout en tenant dans la glibc 2.31 de l'ADM.

Le reste du paquet n'est pas repris : son FFmpeg réclame une vingtaine de bibliothèques Debian que
l'ADM n'a pas. Seul l'étage VA-API est extrait, et il se referme sur lui-même à une exception près,
`libpciaccess`, que le paquet FlixTunes embarque déjà depuis Debian.

Sont également repris `libmfxhw64`, `libmfx-gen` et `libvpl` : le runtime Intel Media SDK, sans lequel
Quick Sync ne peut pas ouvrir de session — ce qui le faisait échouer quel que soit l'état de VA-API.

Usage : extract-jellyfin-va.py <paquet.deb> <destination>
"""
from __future__ import annotations

import importlib.util
import shutil
import sys
from pathlib import Path

_spec = importlib.util.spec_from_file_location("_deb", Path(__file__).parent / "extract-va-driver.py")
_deb = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_deb)

RACINE = "usr/lib/jellyfin-ffmpeg/lib"

# Ce que la conversion matérielle emprunte, et rien d'autre. Le paquet complet pèse 338 Mio ; cet
# étage-ci en fait 90, et le reste ne servirait qu'à des chemins qu'un NAS Intel n'emprunte pas.
FAMILLES = ("libva.so", "libva-drm.so", "libdrm.so", "libdrm_intel.so", "libigdgmm.so",
            "libmfxhw64.so", "libmfx-gen.so", "libvpl.so")
# `i965` couvre les puces Intel anciennes, `iHD` les récentes — Jasper Lake et au-delà. Les deux sont
# repris : le script de démarrage essaie l'un puis l'autre, et laisse la machine trancher.
PILOTES = ("iHD_drv_video.so", "i965_drv_video.so")


def _retenu(relatif: str) -> bool:
    nom = Path(relatif).name
    if Path(relatif).parent.name == "dri":
        return nom in PILOTES
    return any(nom.startswith(famille) for famille in FAMILLES)


def extraire(deb: Path, destination: Path) -> list[str]:
    """Pose l'étage VA-API à plat dans [destination]. Rend les noms écrits."""
    destination.mkdir(parents=True, exist_ok=True)
    liens: list[tuple[Path, str]] = []
    ecrits: list[str] = []
    with _deb.membres_de_deb(deb) as archive:
        for membre in archive.getmembers():
            nom = membre.name.lstrip("./")
            if not nom.startswith(RACINE + "/"):
                continue
            relatif = nom[len(RACINE) + 1:]
            if not relatif or not _retenu(relatif):
                continue
            cible = destination / Path(relatif).name
            if membre.issym() or membre.islnk():
                # Windows ne crée pas de lien symbolique sans droits particuliers, et `tar` s'y arrête.
                # Les liens sont donc résolus en copies, une fois tous les fichiers réels posés.
                liens.append((cible, Path(membre.linkname).name))
                continue
            if not membre.isfile():
                continue
            flux = archive.extractfile(membre)
            if flux is None:
                continue
            cible.write_bytes(flux.read())
            cible.chmod(0o755)
            ecrits.append(cible.name)
    for cible, source in liens:
        origine = destination / source
        if origine.exists() and not cible.exists():
            shutil.copy2(origine, cible)
            ecrits.append(cible.name)
    return ecrits


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("Usage : extract-jellyfin-va.py <paquet.deb> <destination>")
    deb, destination = Path(sys.argv[1]), Path(sys.argv[2])

    # La contrainte qui a coûté trois révisions : rien ne doit exiger plus que la glibc de l'ADM. Un
    # paquet trop récent ne produit pas une erreur propre mais un segfault, dont le message ne désigne
    # jamais la vraie cause.
    exigee = _deb.glibc_exigee(deb)
    if exigee and exigee > _deb.GLIBC_CIBLE:
        print(f"{deb.name} exige glibc {exigee[0]}.{exigee[1]}, la cible en a "
              f"{_deb.GLIBC_CIBLE[0]}.{_deb.GLIBC_CIBLE[1]}.", file=sys.stderr)
        return 1

    ecrits = extraire(deb, destination)
    pilote = destination / "iHD_drv_video.so"
    if not pilote.exists():
        print("Pilote iHD absent du paquet Jellyfin.", file=sys.stderr)
        return 1
    libva = destination / "libva.so.2"
    if not libva.exists():
        print("libva absente du paquet Jellyfin.", file=sys.stderr)
        return 1
    taille = sum(f.stat().st_size for f in destination.iterdir() if f.is_file()) / 1048576
    print(f"Étage VA-API Jellyfin extrait : {len(ecrits)} fichiers, {taille:.0f} Mio.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
