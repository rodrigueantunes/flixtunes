"""Extrait un FFmpeg partage sans dependre des liens symboliques.

L'archive de la variante partagee contient des liens : `libavcodec.so` pointe vers `libavcodec.so.62`.
Windows ne les cree pas sans privileges, et `tar` s'arrete sur « Invalid argument » au premier
rencontre. Les resoudre en copies donne exactement le meme resultat une fois sur le NAS — un fichier
par nom — au prix de quelques megaoctets, ce qui est sans commune mesure avec l'interet d'avoir une
construction qui aboutit.

La variante partagee est indispensable : la statique embarque ses propres libva et libdrm, et le
pilote VA-API charge les siennes. Deux libdrm sur le meme descripteur /dev/dri, et le processus meurt
en segfault.
"""
import sys
import tarfile
from pathlib import Path


def extraire(archive: Path, destination: Path) -> int:
    """Depose binaires et bibliotheques, liens resolus. Rend le nombre de fichiers ecrits."""
    (destination / "bin").mkdir(parents=True, exist_ok=True)
    (destination / "lib").mkdir(parents=True, exist_ok=True)

    with tarfile.open(archive, "r:xz") as tar:
        membres = {m.name: m for m in tar.getmembers()}

        def contenu(membre: tarfile.TarInfo, profondeur: int = 0) -> bytes | None:
            """Le contenu reel d'un membre, en suivant les liens jusqu'a leur cible."""
            if profondeur > 8:
                return None
            if membre.issym() or membre.islnk():
                cible = membre.linkname
                if not cible.startswith("/"):
                    cible = str(Path(membre.name).parent / cible)
                cible = str(Path(cible).as_posix()).replace("/./", "/")
                # Le chemin d'un lien relatif se normalise : « lib/../lib/x » designe « lib/x ».
                pieces: list[str] = []
                for piece in cible.split("/"):
                    if piece == "..":
                        if pieces:
                            pieces.pop()
                    elif piece not in ("", "."):
                        pieces.append(piece)
                suivant = membres.get("/".join(pieces))
                return contenu(suivant, profondeur + 1) if suivant else None
            flux = tar.extractfile(membre)
            return flux.read() if flux else None

        ecrits = 0
        for nom, membre in membres.items():
            base = Path(nom).name
            if base in ("ffmpeg", "ffprobe") and "/bin/" in nom:
                cible = destination / "bin" / base
            elif "/lib/" in nom and ".so" in base:
                cible = destination / "lib" / base
            elif base in ("LICENSE.txt", "LICENSE", "COPYING.GPLv3"):
                cible = destination / "LICENSE.txt"
            else:
                continue
            donnees = contenu(membre)
            if donnees is None:
                continue
            cible.write_bytes(donnees)
            ecrits += 1
        return ecrits


def main() -> int:
    if len(sys.argv) < 3:
        raise SystemExit("Usage : extract-ffmpeg.py <archive.tar.xz> <destination>")
    archive, destination = Path(sys.argv[1]), Path(sys.argv[2])
    ecrits = extraire(archive, destination)
    binaire = destination / "bin" / "ffmpeg"
    if not binaire.exists():
        print("Binaire ffmpeg absent de l'archive.", file=sys.stderr)
        return 1
    bibliotheques = len(list((destination / "lib").glob("*.so*")))
    print(f"FFmpeg partage extrait : {ecrits} fichiers, dont {bibliotheques} bibliotheques.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
