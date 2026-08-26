#!/usr/bin/env python3
"""Vérifie les bibliothèques que FFmpeg charge par `dlopen`, et que rien d'autre ne déclare.

Le contrôle de dépendances du paquet lit les `DT_NEEDED` des binaires : c'est ce qu'un éditeur de
liens y inscrit, et ce que le chargeur va chercher. Il ne peut rien dire d'une bibliothèque ouverte à
l'exécution par `dlopen`, puisque celle-ci n'apparaît nulle part dans l'en-tête.

Or les constructions FFmpeg de BtbN passent libva par `implib-gen` : au lieu d'être liée, elle est
chargée au premier appel. Le paquet embarquait donc `libva.so.2` — utile — mais pas `libva-drm.so.2`,
qui porte `vaGetDisplayDRM`, la seule fonction capable d'ouvrir `/dev/dri/renderD128`. Tous les
contrôles passaient au vert et l'accélération matérielle ne pouvait pas démarrer, plusieurs révisions
de suite. Le message obtenu sur le NAS ne parlait même pas d'un pilote :

    implib-gen: libva-drm.so.2: failed to load library 'libva-drm.so.2' via dlopen

`implib-gen` laisse dans le binaire une chaîne par bibliothèque qu'il enveloppe. C'est ce que ce
script relève : la liste réelle, lue dans ce qui va être livré, plutôt qu'une liste tenue à la main.

Usage : verify-dlopen.py <dossier-ffmpeg-lib> <dossier-va>
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ELF = bytes([0x7F]) + b"ELF"
NUL = bytes([0])

# Ce que la conversion matérielle emprunte réellement sur un NAS. `libva-x11` et consorts sont aussi
# enveloppées par `implib-gen`, mais un serveur n'a pas de serveur graphique : les réclamer ferait
# échouer une construction parfaitement saine.
INDISPENSABLES = ("libva.so.2", "libva-drm.so.2")

MOTIF = re.compile(rb"implib-gen: ([A-Za-z0-9_.+-]+\.so[0-9.]*): failed to load library")
SYMBOLE = re.compile(rb"va[A-Z][A-Za-z0-9_]{2,30}")

# La conversion matérielle n'appelle qu'une part de libva, et c'est cette part qui doit exister.
#
# FFmpeg est construit contre une libva récente ; celle du paquet vient de bullseye, la seule base
# dont la glibc corresponde à celle d'ADM. L'écart laisse quelques fonctions sans réponse, et il faut
# savoir lesquelles comptent. `implib-gen` résout chaque symbole **au premier appel**, pas au
# chargement : un symbole absent d'un chemin qu'on n'emprunte jamais ne se manifeste jamais.
#
# Ce raisonnement a une limite, apprise à ses dépens : `implib-gen` ne rend pas une erreur devant un
# symbole absent, il **lève une assertion et abandonne le processus**. Un symbole manquant ne dégrade
# donc pas la conversion, il tue le transcodage — et le message n'a rien à voir avec un pilote. Ce qui
# est jugé « hors chemin » doit l'être avec certitude, pas par ressemblance de nom.
#
# Restent réellement hors chemin : les cinq fonctions de « protected session », qui servent au contenu
# chiffré que FlixTunes ne lit pas, ainsi que `vaGetDisplay` et `vaPutSurface`, propres au rendu X11
# qu'un serveur n'a pas. Celles du chemin de conversion, les voici.
NOYAU = (
    "vaInitialize", "vaTerminate", "vaGetDisplayDRM", "vaErrorStr",
    "vaQueryConfigProfiles", "vaQueryConfigEntrypoints", "vaCreateConfig", "vaDestroyConfig",
    "vaCreateContext", "vaDestroyContext", "vaCreateSurfaces", "vaDestroySurfaces",
    "vaBeginPicture", "vaRenderPicture", "vaEndPicture", "vaSyncSurface",
    "vaDeriveImage", "vaCreateImage", "vaDestroyImage", "vaMapBuffer", "vaUnmapBuffer",
    "vaCreateBuffer", "vaDestroyBuffer", "vaExportSurfaceHandle",
    # `vaMapBuffer2` est ici parce que je l'avais mis ailleurs.
    #
    # Je l'avais classe « sans emploi ici, la variante d'origine est presente ». C'etait faux : il est
    # sur le chemin d'encodage, et son absence n'a pas degrade la conversion, elle a **abandonne le
    # processus** — `implib-gen` leve une assertion plutot que de rendre une erreur. Le NAS l'a montre
    # apres que ce jugement ait ete ecrit en commentaire au lieu d'etre verifie.
    "vaMapBuffer2",
)


def binaires(dossier: Path) -> list[bytes]:
    """Le contenu des exécutables et bibliothèques d'un dossier, lus une seule fois."""
    contenus = []
    for fichier in sorted(dossier.rglob("*")):
        if not fichier.is_file():
            continue
        donnees = fichier.read_bytes()
        if donnees[:4] == ELF:
            contenus.append(donnees)
    return contenus


def bibliotheques_dlopen(contenus: list[bytes]) -> set[str]:
    """Les noms enveloppés par `implib-gen`."""
    trouvees: set[str] = set()
    for donnees in contenus:
        trouvees.update(nom.decode() for nom in MOTIF.findall(donnees))
    return trouvees


def symboles_definis(chemin: Path) -> set[str]:
    """Les symboles qu'une bibliothèque expose réellement, par lecture directe de l'ELF."""
    donnees = chemin.read_bytes()
    if donnees[:4] != ELF:
        return set()
    debut_sections = int.from_bytes(donnees[0x28:0x30], "little")
    taille = int.from_bytes(donnees[0x3A:0x3C], "little")
    nombre = int.from_bytes(donnees[0x3C:0x3E], "little")
    entetes = []
    for i in range(nombre):
        b = debut_sections + i * taille
        entetes.append((
            int.from_bytes(donnees[b + 4:b + 8], "little"),        # type de section
            int.from_bytes(donnees[b + 0x18:b + 0x20], "little"),  # décalage dans le fichier
            int.from_bytes(donnees[b + 0x20:b + 0x28], "little"),  # taille
            int.from_bytes(donnees[b + 0x28:b + 0x2C], "little"),  # lien vers la table de chaînes
        ))
    noms: set[str] = set()
    for type_section, offset, longueur, lien in entetes:
        if type_section not in (2, 11):  # SYMTAB, DYNSYM
            continue
        chaines = entetes[lien][1]
        for i in range(longueur // 24):
            b = offset + i * 24
            depart = int.from_bytes(donnees[b:b + 4], "little")
            section = int.from_bytes(donnees[b + 6:b + 8], "little")
            # Une section nulle signale un symbole importé, pas fourni : il ne compte pas ici.
            if depart == 0 or section == 0:
                continue
            fin = donnees.index(NUL, chaines + depart)
            noms.add(donnees[chaines + depart:fin].decode(errors="replace"))
    return noms


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("Usage : verify-dlopen.py <dossier-ffmpeg-lib> <dossier-va>")
    ffmpeg_lib, va = Path(sys.argv[1]), Path(sys.argv[2])
    if not ffmpeg_lib.is_dir():
        print(f"Dossier introuvable : {ffmpeg_lib}", file=sys.stderr)
        return 1

    contenus = binaires(ffmpeg_lib)
    attendues = bibliotheques_dlopen(contenus)
    if not attendues:
        # Une construction qui ne passe pas par `implib-gen` lie ses dépendances normalement : le
        # contrôle des `DT_NEEDED` les couvre alors, et il n'y a rien à ajouter ici.
        print("Aucune bibliothèque chargée par dlopen : rien à vérifier.")
        return 0

    fournies = {fichier.name for dossier in (va, ffmpeg_lib) if dossier.is_dir()
                for fichier in dossier.iterdir() if fichier.is_file()}
    manquantes = [nom for nom in INDISPENSABLES if nom in attendues and nom not in fournies]
    optionnelles = sorted(attendues - set(INDISPENSABLES) - fournies)

    print(f"Chargées par dlopen : {', '.join(sorted(attendues))}")
    if optionnelles:
        # Dites, pas exigées : leur absence n'empêche que des chemins dont un NAS ne se sert pas.
        print(f"Absentes mais sans emploi ici : {', '.join(optionnelles)}")
    if manquantes:
        print("Bibliothèques indispensables absentes du paquet, l'accélération matérielle ne "
              f"démarrera pas : {', '.join(manquantes)}", file=sys.stderr)
        return 1

    # La bibliothèque est là ; reste à savoir si elle est assez récente pour ce que FFmpeg lui demande.
    exposes: set[str] = set()
    for nom in INDISPENSABLES:
        for dossier in (va, ffmpeg_lib):
            chemin = dossier / nom
            if chemin.exists():
                exposes |= symboles_definis(chemin.resolve())
    reclames: set[str] = set()
    for donnees in contenus:
        reclames.update(nom.decode() for nom in SYMBOLE.findall(donnees))

    absents = sorted(nom for nom in NOYAU if nom in reclames and nom not in exposes)
    if absents:
        print("Fonctions du chemin de conversion absentes de la libva embarquée, la conversion "
              f"matérielle échouerait à l'usage : {', '.join(absents)}", file=sys.stderr)
        return 1
    # Les noms hors noyau ne sont pas rapportés : le relevé se fait sur les octets bruts du binaire, où
    # le motif attrape aussi des morceaux de texte sans rapport. Les lister donnerait une liste
    # majoritairement fausse, et une sortie qui bruite cesse d'être lue. Ce qui compte est vérifié
    # ci-dessus, et les huit absences réelles de libva 2.10 sont expliquées près de `NOYAU`.
    print("VA-API complet : bibliothèques présentes et fonctions du chemin de conversion exposées.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
