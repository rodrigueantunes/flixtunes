"""Extrait le pilote VA-API Intel et ses dépendances depuis des paquets Debian.

Sans pilote VA-API, FFmpeg transcode sur le processeur même quand la puce Intel est présente : mesuré
sur un AS5404T (Celeron N5105), 29 images/seconde et un budget d'une seule conversion.

**Pourquoi Python plutôt que `tar`.** Un paquet Debian est une archive `ar` contenant un `data.tar.xz`,
et ce dernier contient des liens symboliques — `libva.so.2` pointe vers `libva.so.2.1700.0`. Windows
refuse de les créer sans privilège particulier, et `tar.exe` s'arrête alors sur une erreur. Ici les
liens sont **résolus** : le contenu de la cible est écrit sous le nom du lien, ce qui donne un dossier
plat, exactement ce que `LIBVA_DRIVERS_PATH` attend.

Usage : python extract-va-driver.py <destination> <paquet.deb> [paquet.deb ...]
"""
import io
import gzip
import lzma
import re
import sys
import tarfile
from pathlib import Path

# Le pilote lui-même, et les bibliothèques sans lesquelles il refuse de se charger. `libpciaccess`
# est celle qui manquait sur le NAS : son absence faisait échouer le chargement du pilote pourtant
# présent, avec un message que rien ne reliait à la cause.
# Fichiers retenus des paquets Debian.
#
# `igdgmm` a manqué longtemps : le pilote `iHD` la réclame directement, et son absence empêchait tout
# chargement. Le motif ne la connaissait pas, si bien que même téléchargée, elle n'était pas extraite —
# une omission invisible, puisque le paquet se construisait sans erreur.
GARDER = re.compile(r"(_drv_video\.so$)|(^lib(va|va-drm|va-x11|pciaccess|drm|igdgmm)\.so(\.\d+)*$)")


# Version de glibc du NAS cible. ADM 5.x en est reste a 2.31, et un binaire qui en exige davantage
# ne produit pas une erreur lisible : charge par `dlopen` depuis un FFmpeg statique, il segfault.
GLIBC_CIBLE = (2, 31)


def glibc_exigee(chemin: Path) -> tuple[int, int] | None:
    """La glibc minimale que le paquet declare, lue dans son manifeste `control`."""
    with open(chemin, "rb") as fichier:
        donnees = fichier.read()
    position = 8
    while position < len(donnees):
        nom = donnees[position:position + 16].decode("utf8", "replace").strip()
        try:
            taille = int(donnees[position + 48:position + 58].decode().strip())
        except ValueError:
            return None
        debut = position + 60
        if nom.startswith("control.tar"):
            brut = donnees[debut:debut + taille]
            if nom.endswith(".xz"):
                brut = lzma.decompress(brut)
            elif nom.endswith(".gz"):
                brut = gzip.decompress(brut)
            with tarfile.open(fileobj=io.BytesIO(brut)) as archive:
                for membre in archive.getmembers():
                    if not membre.name.endswith("control"):
                        continue
                    flux = archive.extractfile(membre)
                    texte = flux.read().decode("utf8", "replace") if flux else ""
                    trouve = re.search(r"libc6 \(>= (\d+)\.(\d+)", texte)
                    return (int(trouve.group(1)), int(trouve.group(2))) if trouve else None
            return None
        position = debut + taille + (taille % 2)
    return None

def membres_de_deb(chemin: Path) -> tarfile.TarFile:
    """Rend le `data.tar.*` contenu dans un paquet Debian.

    Le format `ar` est volontairement simple : huit octets de signature, puis des en-têtes de soixante
    octets dont les champs sont en texte, chaque entrée étant alignée sur deux octets.
    """
    octets = chemin.read_bytes()
    position = 8
    while position + 60 <= len(octets):
        entete = octets[position:position + 60].decode("ascii", "replace")
        nom = entete[:16].strip().rstrip("/")
        taille = int(entete[48:58].strip())
        position += 60
        if nom.startswith("data.tar"):
            return tarfile.open(fileobj=io.BytesIO(octets[position:position + taille]))
        position += taille + (taille % 2)
    raise SystemExit(f"Aucune archive de données dans {chemin.name}")


def extraire(archive: tarfile.TarFile, destination: Path) -> list[str]:
    """Écrit les fichiers retenus à plat dans `destination`, liens résolus."""
    par_chemin = {membre.name.lstrip("./"): membre for membre in archive.getmembers()}
    ecrits: list[str] = []

    def contenu(membre: tarfile.TarInfo, profondeur: int = 0) -> bytes | None:
        # Un lien peut pointer vers un autre lien. La profondeur borne les cycles, qu'une archive
        # abîmée pourrait contenir : mieux vaut renoncer à un fichier que tourner sans fin.
        if profondeur > 4:
            return None
        if membre.issym() or membre.islnk():
            cible = membre.linkname
            base = cible if cible.startswith("/") else str(Path(membre.name).parent / cible)
            suivant = par_chemin.get(str(Path(base)).replace("\\", "/").lstrip("./"))
            return contenu(suivant, profondeur + 1) if suivant else None
        flux = archive.extractfile(membre)
        return flux.read() if flux else None

    for membre in archive.getmembers():
        nom = Path(membre.name).name
        if not GARDER.search(nom):
            continue
        donnees = contenu(membre)
        if donnees is None:
            continue
        (destination / nom).write_bytes(donnees)
        ecrits.append(nom)
    return ecrits


# Bibliothèques que tout système Linux fournit : les exiger dans le paquet n'aurait pas de sens.
SYSTEME = {
    "libc.so.6", "libm.so.6", "libdl.so.2", "libpthread.so.0", "librt.so.1",
    "libstdc++.so.6", "libgcc_s.so.1", "libz.so.1", "ld-linux-x86-64.so.2",
}


def bibliotheques_requises(chemin: Path) -> list[str]:
    """Les `DT_NEEDED` d'un objet ELF 64 bits, lus sans outil externe.

    Windows n'a pas de `ldd`, et la construction du paquet se fait ici. Sans cette lecture, une
    dépendance oubliée ne se découvre que sur le NAS, sous la forme d'un `dlopen` qui échoue et d'un
    repli silencieux sur le processeur.
    """
    donnees = chemin.read_bytes()
    if donnees[:4] != bytes([0x7F]) + b"ELF":
        return []
    entier = lambda offset, taille: int.from_bytes(donnees[offset:offset + taille], "little")
    debut, taille_entree, nombre = entier(0x28, 8), entier(0x3A, 2), entier(0x3C, 2)
    dynamique = None
    for rang in range(nombre):
        base = debut + rang * taille_entree
        if entier(base + 4, 4) == 6:  # SHT_DYNAMIC
            dynamique = (entier(base + 0x18, 8), entier(base + 0x20, 8), entier(base + 0x28, 4))
            break
    if dynamique is None:
        return []
    offset, taille, lien = dynamique
    base_chaines = entier(debut + lien * taille_entree + 0x18, 8)
    requis = []
    for position in range(offset, offset + taille, 16):
        marqueur = entier(position, 8)
        if marqueur == 0:
            break
        if marqueur == 1:  # DT_NEEDED
            depart = base_chaines + entier(position + 8, 8)
            fin = donnees.index(bytes([0]), depart)
            requis.append(donnees[depart:fin].decode())
    return requis


def verifier_dependances(destination: Path) -> list[str]:
    """Les bibliothèques réclamées par le pilote qui manquent au paquet.

    Relevé sur un NAS réel : `iHD_drv_video.so` réclame `libigdgmm.so.12`, qui n'était pas embarquée.
    Le chargement échouait, aucun pilote n'était retenu, et libva retombait sur son chemin par défaut
    et sur `i965` — un pilote qui ne couvre même pas la puce. L'utilisateur ne voyait qu'un message
    parlant d'un pilote absent, sans rapport avec la cause.
    """
    presentes = {fichier.name for fichier in destination.iterdir() if fichier.is_file()}
    manquantes = []
    for fichier in sorted(destination.iterdir()):
        if not fichier.is_file() or ".so" not in fichier.name:
            continue
        for requise in bibliotheques_requises(fichier):
            if requise not in SYSTEME and requise not in presentes and requise not in manquantes:
                manquantes.append(requise)
    return manquantes


def main() -> int:
    if len(sys.argv) < 3:
        raise SystemExit("Usage : extract-va-driver.py <destination> <paquet.deb> [...]")
    destination = Path(sys.argv[1])
    destination.mkdir(parents=True, exist_ok=True)

    total: list[str] = []
    for chemin in sys.argv[2:]:
        exigee = glibc_exigee(Path(chemin))
        if exigee and exigee > GLIBC_CIBLE:
            # Refus franc : un paquet trop recent se charge puis plante, et le message qui en sort ne
            # designe jamais la vraie cause. Constate sur le NAS — trois revisions perdues a chercher
            # une bibliotheque manquante alors que la glibc etait en cause.
            print(f"{Path(chemin).name} exige glibc {exigee[0]}.{exigee[1]}, la cible en a "
                  f"{GLIBC_CIBLE[0]}.{GLIBC_CIBLE[1]}.", file=sys.stderr)
            return 1
        with membres_de_deb(Path(chemin)) as archive:
            total.extend(extraire(archive, destination))

    pilote = destination / "iHD_drv_video.so"
    if pilote.exists():
        print(f"Pilote VA-API embarqué : {pilote.stat().st_size / 1048576:.1f} Mio "
              f"({len(total)} fichiers).")
        manquantes = verifier_dependances(destination)
        if manquantes:
            # Échec franc plutôt que paquet livré : un pilote qui ne se charge pas produit une
            # accélération silencieusement absente, découverte des semaines plus tard sur le NAS.
            print("Bibliothèques absentes du paquet, le pilote ne se chargera pas : "
                  + ", ".join(manquantes), file=sys.stderr)
            return 1
        return 0
    # Un pilote absent n'empêche pas le paquet d'exister : le serveur sait convertir sur le
    # processeur, et le script de démarrage le dira clairement dans son journal.
    print("Aucun pilote iHD extrait : les conversions se feront sur le processeur.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
