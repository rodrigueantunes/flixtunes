#!/usr/bin/env python3
"""Build and validate an ASUSTOR APKG 2.0 archive.

The archive layout intentionally follows ASUSTOR's APKG_Utilities_2.0 tool:
three uncompressed ZIP members containing a version marker and two gzip tarballs.
"""

from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import stat
import tarfile
import zipfile


MEMBERS = ("apkg-version", "control.tar.gz", "data.tar.gz")


# Les binaires qui doivent porter le bit d'execution dans le paquet.
#
# Windows ne connait pas ce bit : tout ce qui est extrait ici arrive en 0666, et c'est cette liste qui
# le retablit. Un binaire oublie s'installe donc parfaitement et refuse de demarrer — Caddy est arrive
# en r60 sans y figurer, et l'acces distant n'aurait jamais fonctionne, avec un message annoncant un
# fichier « absent » alors qu'il etait la. Le controle de `validate` refuse desormais un paquet dans
# ce cas.
EXECUTABLES = (
    "/runtime/node/bin/node",
    "/runtime/ffmpeg/bin/ffmpeg",
    "/runtime/ffmpeg/bin/ffprobe",
    "/runtime/caddy/caddy",
)


def _tar_filter(info: tarfile.TarInfo) -> tarfile.TarInfo:
    normalized = info.name.replace("\\", "/")
    info.uid = 0
    info.gid = 0
    info.uname = "root"
    info.gname = "root"
    if "/CONTROL/" in f"/{normalized}/" or normalized.rstrip("/") in {"CONTROL", "./CONTROL"}:
        return None
    if normalized.endswith(".sh") or normalized.endswith(EXECUTABLES):
        info.mode = 0o755
    return info


def _control_filter(info: tarfile.TarInfo) -> tarfile.TarInfo:
    info.uid = 0
    info.gid = 0
    info.uname = "root"
    info.gname = "root"
    info.mode = 0o755 if info.isdir() or info.name.endswith(".sh") else 0o644
    return info


def _make_tar(source: Path, control: bool) -> bytes:
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz", format=tarfile.PAX_FORMAT) as archive:
        archive.add(source, arcname=".", filter=_control_filter if control else _tar_filter)
    return stream.getvalue()


def _read_config(layout: Path) -> dict:
    config_path = layout / "CONTROL" / "config.json"
    raw = config_path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raise ValueError("CONTROL/config.json contient un BOM UTF-8 interdit")
    config = json.loads(raw.decode("utf-8"))
    for field in ("package", "version", "architecture", "firmware"):
        if not str(config.get("general", {}).get(field, "")).strip():
            raise ValueError(f"champ general.{field} absent")
    shortcut = config.get("adm-desktop", {}).get("app", {})
    expected_shortcut = {"type": "custom", "protocol": "http", "port": 4000, "url": "/"}
    if any(shortcut.get(key) != value for key, value in expected_shortcut.items()):
        raise ValueError("raccourci ADM invalide : http://<adresse-du-NAS>:4000/ attendu")
    icon = layout / "CONTROL" / "icon.png"
    if not icon.is_file():
        raise ValueError("CONTROL/icon.png absent")
    return config


def build(layout: Path, destination: Path) -> Path:
    layout = layout.resolve()
    config = _read_config(layout)
    destination.mkdir(parents=True, exist_ok=True)
    general = config["general"]
    output = destination / f"{general['package']}_{general['version']}_{general['architecture']}.apk"
    payloads = {
        "apkg-version": b"2.0\n",
        "control.tar.gz": _make_tar(layout / "CONTROL", control=True),
        "data.tar.gz": _make_tar(layout, control=False),
    }
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as package:
        for name in MEMBERS:
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = zipfile.ZIP_STORED
            package.writestr(info, payloads[name])
    validate(output)
    return output


def validate(package_path: Path) -> None:
    with zipfile.ZipFile(package_path, "r") as package:
        if tuple(package.namelist()) != MEMBERS:
            raise ValueError("membres APKG invalides ou mal ordonnés")
        if package.read("apkg-version") != b"2.0\n":
            raise ValueError("version APKG invalide")
        for member in ("control.tar.gz", "data.tar.gz"):
            if package.getinfo(member).compress_type != zipfile.ZIP_STORED:
                raise ValueError(f"{member} doit être stocké sans double compression")
        with tarfile.open(fileobj=io.BytesIO(package.read("control.tar.gz")), mode="r:gz") as control:
            names = {name.removeprefix("./") for name in control.getnames()}
            if not {"config.json", "icon.png"}.issubset(names):
                raise ValueError("fichiers CONTROL obligatoires absents")
            config_member = next(item for item in control.getmembers() if item.name.removeprefix("./") == "config.json")
            config_raw = control.extractfile(config_member).read()
            if config_raw.startswith(b"\xef\xbb\xbf"):
                raise ValueError("config.json archivé avec un BOM")
            json.loads(config_raw.decode("utf-8"))
            for item in control.getmembers():
                if item.name.endswith(".sh") and item.mode & 0o111 == 0:
                    raise ValueError(f"script non exécutable : {item.name}")
        with tarfile.open(fileobj=io.BytesIO(package.read("data.tar.gz")), mode="r:gz") as data:
            members = {item.name.removeprefix("./"): item for item in data.getmembers()}
            if any(name.startswith("CONTROL") for name in members):
                raise ValueError("CONTROL ne doit pas être présent dans data.tar.gz")
            required = {
                "runtime/node/bin/node",
                "runtime/ffmpeg/bin/ffmpeg",
                "runtime/ffmpeg/bin/ffprobe",
                "runtime/caddy/caddy",
                "app/apps/server/dist/index.js",
                "app/apps/web/dist/index.html",
            }
            if not required.issubset(members):
                raise ValueError(f"charge utile précompilée incomplète : {sorted(required - members.keys())}")
            if members["runtime/node/bin/node"].mode & 0o111 == 0:
                raise ValueError("runtime Node.js non exécutable")
            # Windows ne porte pas le bit d'exécution : c'est `_tar_filter` qui le rétablit, à partir
            # d'une liste. Un binaire absent de cette liste s'installe parfaitement et refuse de
            # démarrer — c'est arrivé à Caddy. Le paquet est donc refusé plutôt que livré muet.
            for binary in (name.lstrip("/") for name in EXECUTABLES):
                if members[binary].mode & 0o111 == 0:
                    raise ValueError(f"binaire non exécutable dans le paquet : {binary}")
            for binary in ("runtime/ffmpeg/bin/ffmpeg", "runtime/ffmpeg/bin/ffprobe"):
                if members[binary].mode & 0o111 == 0:
                    raise ValueError(f"moteur multimédia non exécutable : {binary}")
                stream = data.extractfile(members[binary])
                if stream is None or stream.read(4) != b"\x7fELF":
                    raise ValueError(f"binaire Linux ELF invalide : {binary}")
            # Les signatures se cherchent dans le binaire **et** dans les bibliotheques partagees.
            #
            # Le runtime est passe en variante partagee — la statique embarquait ses propres libva et
            # libdrm, ce qui faisait cohabiter deux libdrm avec le pilote VA-API et tuait le processus.
            # Les noms de codecs vivent desormais dans `libavcodec.so`, plus dans l'executable : ne
            # regarder que ce dernier faisait echouer une verification pourtant satisfaite.
            a_inspecter = [nom for nom in members
                           if nom == "runtime/ffmpeg/bin/ffmpeg" or (nom.startswith("runtime/ffmpeg/lib/") and ".so" in nom)]
            required_signatures = {b"eac3", b"truehd", b"libx264"}
            found: set[bytes] = set()
            for nom in a_inspecter:
                if found == required_signatures:
                    break
                flux = data.extractfile(members[nom])
                if flux is None:
                    continue
                tail = b""
                while chunk := flux.read(1024 * 1024):
                    block = tail + chunk
                    found.update(signature for signature in required_signatures if signature in block)
                    tail = block[-16:]
                    if found == required_signatures:
                        break
            if found != required_signatures:
                missing = sorted(signature.decode("ascii") for signature in required_signatures - found)
                raise ValueError(f"runtime FFmpeg incomplet, signatures absentes : {missing}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Constructeur ASUSTOR APKG 2.0")
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create")
    create.add_argument("layout", type=Path)
    create.add_argument("--destination", type=Path, required=True)
    verify = subparsers.add_parser("verify")
    verify.add_argument("package", type=Path)
    args = parser.parse_args()
    if args.command == "create":
        print(build(args.layout, args.destination))
    else:
        validate(args.package)
        print(f"APKG 2.0 valide : {args.package}")


if __name__ == "__main__":
    main()
