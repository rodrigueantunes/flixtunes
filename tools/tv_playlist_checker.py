#!/usr/bin/env python3
"""
Le script qui produit `m3u.json` — la liste des listes que FlixTunes relit au démarrage.

Version adaptée de `tv_playlist_checker.py` (Antunes Informatique) pour que ce qu'il mesure soit
exactement ce que FlixTunes affiche. Cinq écarts ont été relevés entre les deux, et corrigés ici :

1. **L'ordre des pastilles était inversé.** `⚠️` marquait les listes sous 25 % et `❌` celles de 25 à
   49 % : la pire portait le symbole le moins alarmant, et le filtre de fiabilité de FlixTunes les
   classait donc à l'envers. Les quatre pastilles descendent maintenant ✅ 〰️ ⚠️ ❌, du meilleur au pire.
2. **Le pourcentage comptait des flux, FlixTunes affiche des chaînes.** Une liste qui donne deux
   adresses par chaîne, l'une morte et l'autre vivante, était mesurée à 50 % alors que FlixTunes en
   montre 100 % de joignables — il fusionne les doublons et essaie les adresses l'une après l'autre.
   La pastille porte désormais sur les chaînes fusionnées, c'est-à-dire sur ce qu'on verra.
3. **Les transports illisibles pesaient dans le total.** `rtp://`, `rtsp://`, `rtmp://` : aucun des
   trois lecteurs de FlixTunes ne les ouvre, il les écarte à l'import. Les compter comme morts
   faisait passer pour mauvaise une liste dont FlixTunes ne garde que la bonne moitié.
4. **Le nom se coupait à la première virgule**, y compris celle d'un `tvg-name="Ciné, Polar"`. La
   virgule est maintenant cherchée hors guillemets, comme dans l'analyseur du serveur.
5. **Les entrées sans nom** sont écartées, comme le fait FlixTunes : sans nom, pas de clé de fusion.

Le format du fichier ne change pas — « nom de liste » : « adresse » —, TvPourTous continue de le lire.

Écrire ailleurs qu'à côté du script : `FLIXTUNES_M3U_DIR` (par exemple le dossier du NAS que
FlixTunes surveille) reçoit une copie de `m3u.json` à la fin de la passe.
"""
import asyncio
import datetime
import json
import logging
import os
import re
import shutil
import unicodedata
from typing import Dict, List, Optional, Tuple
from urllib.parse import parse_qsl

import httpx
from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

print("     ██████╗ ██╗ ")
print("    ██╔═══██╗██║ ")
print("    ██║   ██║██║ ")
print("    ██║   ██║██║ ")
print("    ╚██████╔╝██║ ")
print("     ╚═════╝ ╚═╝ ")
print("                 ")
print("   Antunes       ")
print(" Informatique    ")

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(SCRIPT_DIR)

SCOPES = ["https://www.googleapis.com/auth/drive"]
ROOT_FOLDER = "Tv Pour Tous"
ARCHIVE_FOLDER_NAME = "Archives"
CHANNELS_STATUS_FILE = "channels_status.json"
M3U_FILE = "m3u.json"
FILES_TO_ARCHIVE = [M3U_FILE, CHANNELS_STATUS_FILE]
LOG_FILE = "script.log"

# Le dossier que FlixTunes relit, s'il est indiqué : une copie y est déposée en fin de passe.
FLIXTUNES_M3U_DIR = os.environ.get("FLIXTUNES_M3U_DIR", "").strip()

PUBLIC_PLAYLISTS = {
    "iptv-org France": "https://iptv-org.github.io/iptv/countries/fr.m3u",
    "iptv-org Francophone": "https://iptv-org.github.io/iptv/languages/fra.m3u",
    "Free-TV France": "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_france.m3u8",
    "simon-lzw France": "https://raw.githubusercontent.com/simon-lzw/iptv-scraper/master/output/countries/FR.m3u",
}

GITHUB_QUERIES = [
    "TF1 in:file extension:m3u",
    "M6 in:file extension:m3u",
    '"France 2" in:file extension:m3u',
    "TNT in:file extension:m3u",
    "TF1 in:file extension:m3u8",
    "M6 in:file extension:m3u8",
]

GITHUB_MAX_PAGES_PER_QUERY = 2
PLAYLIST_DOWNLOAD_TIMEOUT = 20.0
STREAM_CONNECT_TIMEOUT = 7.0
STREAM_READ_TIMEOUT = 8.0
MAX_STREAM_CONCURRENCY = 80
MIN_ACTIVE_TO_KEEP = 1

logger = logging.getLogger("tv_checker")
logger.setLevel(logging.INFO)
formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
ch = logging.StreamHandler()
ch.setFormatter(formatter)
logger.addHandler(ch)
fh = logging.FileHandler(os.path.join(SCRIPT_DIR, LOG_FILE), encoding="utf-8")
fh.setFormatter(formatter)
logger.addHandler(fh)


def load_github_token() -> str:
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if token:
        return token
    token_path = os.path.join(SCRIPT_DIR, "github_token.txt")
    if os.path.exists(token_path):
        try:
            with open(token_path, "r", encoding="utf-8") as f:
                return f.read().strip()
        except OSError:
            return ""
    return ""


async def search_github_m3u(token: str) -> Dict[str, str]:
    if not token:
        logger.warning("GitHub ignoré: aucun token dans GITHUB_TOKEN ou github_token.txt")
        return {}

    url = "https://api.github.com/search/code"
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "TvPourTous/2.0 PlaylistAnalyzer",
    }
    playlists: Dict[str, str] = {}

    async with httpx.AsyncClient(headers=headers, timeout=20.0, follow_redirects=True) as client:
        for q in GITHUB_QUERIES:
            logger.info(f"GitHub search query: {q}")
            for page in range(1, GITHUB_MAX_PAGES_PER_QUERY + 1):
                try:
                    resp = await client.get(url, params={"q": q, "per_page": 100, "page": page})
                    if resp.status_code in (403, 429):
                        logger.warning(f"GitHub rate limit atteint sur '{q}', recherche suivante")
                        break
                    resp.raise_for_status()
                except Exception as e:
                    logger.warning(f"Recherche GitHub ignorée pour '{q}' page {page}: {e}")
                    break

                data = resp.json()
                items = data.get("items", [])
                if page == 1:
                    logger.info(f"Found {data.get('total_count', 0)} items; scanning up to {GITHUB_MAX_PAGES_PER_QUERY * 100}")

                if not items:
                    break

                for item in items:
                    path = item.get("path", "")
                    if not path.lower().endswith((".m3u", ".m3u8")):
                        continue
                    repo = item.get("repository", {})
                    owner = repo.get("owner", {}).get("login", "")
                    name = repo.get("name", "")
                    branch = repo.get("default_branch", "master")
                    if not owner or not name or not path:
                        continue
                    raw_url = f"https://raw.githubusercontent.com/{owner}/{name}/{branch}/{path}"
                    key = f"GitHub {owner}/{name}/{path}"
                    playlists.setdefault(key, raw_url)

                if len(items) < 100:
                    break

    return playlists


def parse_stream_url(raw_url: str, inherited_headers: Optional[Dict[str, str]] = None) -> Tuple[str, Dict[str, str]]:
    headers = dict(inherited_headers or {})
    if "|" not in raw_url:
        return raw_url.strip(), headers

    url, params = raw_url.split("|", 1)
    for key, value in parse_qsl(params, keep_blank_values=True):
        lk = key.strip().lower()
        if lk in {"user-agent", "user_agent", "http-user-agent"}:
            headers["User-Agent"] = value
        elif lk in {"referer", "referrer", "http-referrer"}:
            headers["Referer"] = value
        elif lk == "origin":
            headers["Origin"] = value
    return url.strip(), headers


def nom_de_lextinf(line: str) -> str:
    """
    Le nom d'une ligne `#EXTINF`, coupé à la première virgule **hors guillemets**.

    `#EXTINF:-1 tvg-name="Ciné, Polar" group-title="Cinéma",Ciné+ Polar` en contient trois : couper à
    la première donnait `Polar" group-title=...` comme nom de chaîne. C'est la règle qu'applique
    l'analyseur du serveur, et le nom sert maintenant de clé de fusion — il ne peut plus être faux.
    """
    dans_guillemets = False
    for index, caractere in enumerate(line):
        if caractere == '"':
            dans_guillemets = not dans_guillemets
        elif caractere == "," and not dans_guillemets:
            return line[index + 1:].strip()
    return ""


# Les diacritiques combinants, exactement le bloc que retire la normalisation du serveur.
DIACRITIQUES = re.compile(r"[̀-ͯ]")


def cle_de_chaine(nom: str) -> str:
    """
    La clé sous laquelle FlixTunes fusionne deux entrées.

    Transcription de `normaliseForSearch` : décomposition, retrait des accents, minuscules,
    ligatures dépliées, et tout ce qui n'est ni lettre ni chiffre devient une espace. « TF1 HD » et
    « tf1  hd » retombent ainsi sur la même chaîne — comme dans la base, sans quoi le pourcentage
    mesuré ici ne parlerait pas de la même chose que la grille.
    """
    texte = DIACRITIQUES.sub("", unicodedata.normalize("NFD", nom)).lower()
    texte = texte.replace("œ", "oe").replace("æ", "ae").replace("ß", "ss")
    lisible = "".join(c if unicodedata.category(c)[0] in ("L", "N") else " " for c in texte)
    return " ".join(lisible.split())


def lisible_par_flixtunes(url: str) -> bool:
    """
    Ce que les lecteurs de FlixTunes savent ouvrir : `http` et `https`, rien d'autre.

    Le corpus mesuré compte 1 347 entrées en `rtp`, `rtsp`, `rtmp` ou `plugin`. Ni le navigateur ni
    Media3 ne les lisent, et le serveur les écarte à l'import : les compter comme des flux morts
    faisait passer pour mauvaise une liste dont FlixTunes ne garde que la partie lisible.
    """
    return bool(re.match(r"^https?://", url, re.IGNORECASE))


def analyze_m3u(content: str) -> Tuple[List[Dict[str, object]], int]:
    """
    Les entrées d'une liste, et le nombre de celles que FlixTunes n'importera pas.

    Ce qui est écarté ici l'est pour les mêmes raisons que là-bas : un transport qu'aucun lecteur
    n'ouvre, ou un nom vide qui ne donne aucune clé de fusion. Les écartées sont **comptées** et non
    tues : une liste dont on retire la moitié doit pouvoir se lire dans le journal.
    """
    channels: List[Dict[str, object]] = []
    ecartees = 0
    last_name = ""
    pending_headers: Dict[str, str] = {}

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        lower = line.lower()

        if lower.startswith("#extinf:"):
            last_name = nom_de_lextinf(line)
            pending_headers = {}
            continue

        if lower.startswith("#extvlcopt:http-user-agent="):
            pending_headers["User-Agent"] = line.split("=", 1)[1].strip()
            continue

        if lower.startswith("#extvlcopt:http-referrer=") or lower.startswith("#extvlcopt:http-referer="):
            pending_headers["Referer"] = line.split("=", 1)[1].strip()
            continue

        if line.startswith("#"):
            continue

        url, headers = parse_stream_url(line, pending_headers)
        pending_headers = {}
        if not url:
            continue
        cle = cle_de_chaine(last_name)
        if not lisible_par_flixtunes(url) or not cle:
            ecartees += 1
            continue
        channels.append({"name": last_name, "cle": cle, "flux_url": url, "headers": headers})

    dedup: Dict[str, Dict[str, object]] = {}
    for channel in channels:
        dedup.setdefault(str(channel["flux_url"]), channel)
    return list(dedup.values()), ecartees


async def check_flux(client: httpx.AsyncClient, url: str, headers: Dict[str, str]) -> bool:
    if not lisible_par_flixtunes(url):
        return False

    request_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142 Safari/537.36",
        "Accept": "*/*",
        "Connection": "keep-alive",
    }
    request_headers.update(headers)

    try:
        async with client.stream("GET", url, headers=request_headers) as resp:
            if resp.status_code not in (200, 206):
                return False
            async for chunk in resp.aiter_bytes(2048):
                if chunk:
                    return True
            return True
    except Exception:
        return False


def determine_icon(total: int, active: int) -> str:
    """
    La pastille posée en tête du nom, et lue par FlixTunes pour classer la liste.

    Les quatre descendent du meilleur au pire — ✅ 〰️ ⚠️ ❌ — et c'est la correction principale de
    cette version : `⚠️` marquait auparavant les listes sous 25 % et `❌` celles de 25 à 49 %, si bien
    que la pire portait le symbole le moins alarmant et que le filtre de fiabilité les rangeait à
    l'envers. Les seuils, eux, n'ont pas bougé.

    | Pastille | Chaînes joignables | Classe côté FlixTunes |
    | --- | --- | --- |
    | ✅ | 75 % et plus | `bonne` |
    | 〰️ | 50 à 74 % | `moyenne` |
    | ⚠️ | 25 à 49 % | `douteuse` |
    | ❌ | moins de 25 % | `faible` |

    Aucune pastille quand rien ne répond : la liste n'est alors pas écrite dans le fichier.
    """
    if total <= 0 or active <= 0:
        return ""
    pct = active / total * 100
    if pct < 25:
        return "❌"
    if pct < 50:
        return "⚠️"
    if pct < 75:
        return "〰️"
    return "✅"


def playlist_label(key: str, icon: str) -> str:
    if key.startswith("GitHub "):
        value = key[7:]
        parts = value.split("/", 2)
        if len(parts) == 3:
            owner, repo, path = parts
            base = os.path.splitext(os.path.basename(path))[0]
            return f"{icon} {base} ({owner}/{repo})".strip()
    return f"{icon} {key}".strip()


async def process_playlists(playlists: Dict[str, str]) -> Tuple[List[Dict[str, object]], Dict[str, str]]:
    channels_status: List[Dict[str, object]] = []
    m3u_dict: Dict[str, str] = {}
    flux_cache: Dict[Tuple[str, Tuple[Tuple[str, str], ...]], bool] = {}

    timeout = httpx.Timeout(
        connect=STREAM_CONNECT_TIMEOUT,
        read=STREAM_READ_TIMEOUT,
        write=STREAM_READ_TIMEOUT,
        pool=STREAM_CONNECT_TIMEOUT,
    )
    limits = httpx.Limits(max_connections=MAX_STREAM_CONCURRENCY + 20, max_keepalive_connections=MAX_STREAM_CONCURRENCY)

    async with httpx.AsyncClient(limits=limits, timeout=timeout, follow_redirects=True, http2=True) as client:
        for key, url in playlists.items():
            logger.info(f"Downloading playlist '{key}' -> {url}")
            try:
                r = await client.get(url, timeout=PLAYLIST_DOWNLOAD_TIMEOUT)
                if r.status_code != 200:
                    logger.warning(f"Playlist '{key}' inactive (HTTP {r.status_code})")
                    continue

                chans, ecartees = analyze_m3u(r.text)
                flux_actifs = 0
                sem = asyncio.Semaphore(MAX_STREAM_CONCURRENCY)

                async def chk(channel: Dict[str, object]) -> Tuple[Dict[str, object], bool]:
                    stream_url = str(channel["flux_url"])
                    stream_headers = dict(channel.get("headers", {}))
                    cache_key = (stream_url, tuple(sorted(stream_headers.items())))
                    if cache_key in flux_cache:
                        return channel, flux_cache[cache_key]
                    async with sem:
                        ok = await check_flux(client, stream_url, stream_headers)
                    flux_cache[cache_key] = ok
                    return channel, ok

                """
                Une chaîne est joignable si **l'une** de ses adresses répond.

                C'est la règle du lecteur : il les sonde toutes en même temps et prend celle qui
                arrive la première. Compter les flux plutôt que les chaînes donnait 50 % à une liste
                qui double chacune de ses entrées, alors que FlixTunes en montre 100 % de vivantes.
                """
                par_chaine: Dict[str, bool] = {}
                tasks = [asyncio.create_task(chk(c)) for c in chans]
                for task in asyncio.as_completed(tasks):
                    channel, ok = await task
                    cle = str(channel["cle"])
                    par_chaine[cle] = par_chaine.get(cle, False) or ok
                    if ok:
                        flux_actifs += 1
                    channels_status.append(
                        {
                            "playlist": key,
                            "name": channel.get("name", ""),
                            "flux_url": channel.get("flux_url", ""),
                            "etat": "v" if ok else "x",
                        }
                    )

                total = len(par_chaine)
                active = sum(1 for joignable in par_chaine.values() if joignable)
                icon = determine_icon(total, active)
                if active >= MIN_ACTIVE_TO_KEEP:
                    label = playlist_label(key, icon)
                    base_label = label
                    n = 2
                    while label in m3u_dict and m3u_dict[label] != url:
                        label = f"{base_label} #{n}"
                        n += 1
                    m3u_dict[label] = url

                pct = active / total * 100 if total else 0
                logger.info(
                    f"{active}/{total} chaînes joignables ({pct:.1f}%) dans '{key}' "
                    f"— {flux_actifs}/{len(chans)} flux, {ecartees} entrée(s) écartée(s)"
                )

            except Exception as e:
                logger.warning(f"Playlist ignorée '{key}': {e}")

    return channels_status, m3u_dict


def get_folder_id(service, folder_name: str, parent_id: Optional[str] = None) -> Optional[str]:
    safe_name = folder_name.replace("'", "\\'")
    query = f"name='{safe_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    if parent_id:
        query += f" and '{parent_id}' in parents"
    res = service.files().list(q=query, spaces="drive", fields="files(id,name)").execute()
    items = res.get("files", [])
    return items[0]["id"] if items else None


def get_file_id(service, file_name: str, parent_id: str) -> Optional[str]:
    safe_name = file_name.replace("'", "\\'")
    query = f"name='{safe_name}' and '{parent_id}' in parents and trashed=false"
    res = service.files().list(q=query, fields="files(id,name)").execute()
    items = res.get("files", [])
    return items[0]["id"] if items else None


def authenticate_drive():
    token_path = os.path.join(SCRIPT_DIR, "token.json")
    if not os.path.exists(token_path):
        logger.warning("Drive ignoré: token.json absent")
        return None

    try:
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)
        if not creds.valid:
            if creds.expired and creds.refresh_token:
                creds.refresh(Request())
                with open(token_path, "w", encoding="utf-8") as token_file:
                    token_file.write(creds.to_json())
            else:
                logger.warning("Drive ignoré: authentification invalide")
                return None
        return build("drive", "v3", credentials=creds, cache_discovery=False)
    except RefreshError as e:
        logger.warning(f"Drive ignoré: jeton Google refusé ({e})")
        return None
    except Exception as e:
        logger.warning(f"Drive ignoré: authentification impossible ({e})")
        return None


def sync_drive() -> None:
    try:
        service = authenticate_drive()
        if service is None:
            return

        root_id = get_folder_id(service, ROOT_FOLDER)
        if not root_id:
            logger.warning(f"Drive ignoré: dossier '{ROOT_FOLDER}' introuvable")
            return

        archive_id = get_folder_id(service, ARCHIVE_FOLDER_NAME, root_id)
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

        for fn in FILES_TO_ARCHIVE:
            fid = get_file_id(service, fn, root_id)
            if fid and archive_id:
                archive_name = f"{os.path.splitext(fn)[0]}_{timestamp}{os.path.splitext(fn)[1]}"
                service.files().copy(fileId=fid, body={"name": archive_name, "parents": [archive_id]}).execute()
                logger.info(f"Archived {fn} to {ARCHIVE_FOLDER_NAME}")

            file_path = os.path.join(SCRIPT_DIR, fn)
            media = MediaFileUpload(file_path, mimetype="application/json", resumable=True)
            if fid:
                service.files().update(fileId=fid, media_body=media, fields="id").execute()
                logger.info(f"Updated {fn} on Drive")
            else:
                service.files().create(
                    body={"name": fn, "parents": [root_id]},
                    media_body=media,
                    fields="id",
                ).execute()
                logger.info(f"Uploaded new {fn} to {ROOT_FOLDER}")
    except Exception as e:
        logger.warning(f"Drive ignoré pour cette exécution: {e}")


def deposer_pour_flixtunes(source: str) -> None:
    """
    Déposer une copie dans le dossier que FlixTunes relit, si on en a indiqué un.

    Sans cela, il faut copier le fichier à la main après chaque passe — et le jour où on l'oublie,
    FlixTunes relit sagement la liste de la semaine dernière sans avoir aucun moyen de le dire.
    """
    if not FLIXTUNES_M3U_DIR:
        return
    try:
        os.makedirs(FLIXTUNES_M3U_DIR, exist_ok=True)
        shutil.copyfile(source, os.path.join(FLIXTUNES_M3U_DIR, M3U_FILE))
        logger.info(f"{M3U_FILE} déposé dans {FLIXTUNES_M3U_DIR}")
    except OSError as e:
        logger.warning(f"Dépôt FlixTunes ignoré ({FLIXTUNES_M3U_DIR}): {e}")


async def _main() -> None:
    playlists = dict(PUBLIC_PLAYLISTS)
    github_playlists = await search_github_m3u(load_github_token())

    known_urls = set(playlists.values())
    for key, url in github_playlists.items():
        if url not in known_urls:
            playlists[key] = url
            known_urls.add(url)

    logger.info(f"{len(playlists)} playlists uniques à analyser ({len(PUBLIC_PLAYLISTS)} sources fixes + {len(playlists) - len(PUBLIC_PLAYLISTS)} GitHub)")
    channels_status, m3u_data = await process_playlists(playlists)

    with open(os.path.join(SCRIPT_DIR, CHANNELS_STATUS_FILE), "w", encoding="utf-8") as f:
        json.dump(channels_status, f, ensure_ascii=False, indent=2)

    chemin_m3u = os.path.join(SCRIPT_DIR, M3U_FILE)
    with open(chemin_m3u, "w", encoding="utf-8") as f:
        json.dump(m3u_data, f, ensure_ascii=False, indent=2)

    active_count = sum(1 for item in channels_status if item.get("etat") == "v")
    logger.info(f"Local files updated: {CHANNELS_STATUS_FILE}, {M3U_FILE}")
    logger.info(f"Résultat: {len(m3u_data)} playlists conservées, {active_count} flux actifs détectés")
    deposer_pour_flixtunes(chemin_m3u)
    sync_drive()


def main() -> None:
    asyncio.run(_main())


if __name__ == "__main__":
    main()
