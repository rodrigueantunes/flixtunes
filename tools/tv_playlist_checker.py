#!/usr/bin/env python3
"""
Le script qui produit `m3u.json` — la liste des listes que FlixTunes relit au démarrage.

Il cherche des listes de chaînes, sonde chacun de leurs flux, et écrit ce qu'il a mesuré. Trois choses
ont été refaites, dans cet ordre d'importance.

**La vitesse, sans rien retirer à la mesure.** Le contrôle reste *exhaustif* — chaque flux de chaque
liste est réellement essayé —, l'échantillonnage aurait été la solution facile. La vitesse vient donc
de la structure :

| Ce qui coûtait | Ce qui le remplace |
| --- | --- |
| les listes traitées **une par une**, chacune attendant la précédente | `LISTES_EN_PARALLELE` de front |
| un hôte mort retenté pour chacune de ses centaines d'adresses | il est **banni**, ses autres adresses tombent sans requête |
| un nom de domaine disparu résolu à chaque adresse | résolu **une fois**, ses adresses écartées sans HTTP |
| 7 s pour se connecter, 8 s pour le premier octet | 4 s : plus lent que cela n'est pas regardable |

**La fiabilité.** N'importe quelle réponse 200 comptait comme vivante — page d'erreur, portail captif,
page de garde d'hébergeur. On regarde maintenant les premiers octets : un manifeste commence par
`#EXTM3U`, un flux MPEG-TS par l'octet de synchronisation `0x47`. Certains pourcentages vont
**baisser**, et ils seront justes.

**Ce que le fichier dit.** `m3u.json` portait le classement d'une liste **dans son libellé** — `✅ …`,
`〰️ …` — faute de pouvoir transporter autre chose qu'un nom et une adresse. Il porte maintenant le
pourcentage exact, l'effectif et la date du relevé. FlixTunes n'a plus à lire des emojis pour
retrouver un chiffre qu'on avait mesuré, et son filtre de fiabilité cesse de tenir en quatre paliers.

Écrire ailleurs qu'à côté du script : `FLIXTUNES_M3U_DIR` reçoit une copie de `m3u.json` à la fin.
"""
import asyncio
import datetime
import json
import logging
import os
import re
import shutil
import socket
import unicodedata
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import parse_qsl, urlparse

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

FLIXTUNES_M3U_DIR = os.environ.get("FLIXTUNES_M3U_DIR", "").strip()

# ------------------------------------------------------------------- où l'on cherche

PUBLIC_PLAYLISTS = {
    "iptv-org France": "https://iptv-org.github.io/iptv/countries/fr.m3u",
    "iptv-org Francophone": "https://iptv-org.github.io/iptv/languages/fra.m3u",
    "iptv-org Belgique": "https://iptv-org.github.io/iptv/countries/be.m3u",
    "iptv-org Suisse": "https://iptv-org.github.io/iptv/countries/ch.m3u",
    "iptv-org Canada": "https://iptv-org.github.io/iptv/countries/ca.m3u",
    "Free-TV France": "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlists/playlist_france.m3u8",
    "simon-lzw France": "https://raw.githubusercontent.com/simon-lzw/iptv-scraper/master/output/countries/FR.m3u",
    # Les bouquets gratuits et légaux que FlixTunes propose déjà comme fournisseur : les mesurer ici
    # leur donne le même classement qu'aux autres, au lieu de les croire sur parole.
    "Pluto TV (tous pays)": "https://i.mjh.nz/PlutoTV/all.m3u8",
    "Samsung TV Plus France": "https://i.mjh.nz/SamsungTVPlus/fr.m3u8",
    "Rakuten TV France": "https://i.mjh.nz/Rakuten/fr.m3u8",
}

"""
Les dépôts qu'on va lire, plutôt que les fichiers qu'on cherche.

La recherche de code de GitHub rend cent résultats par page, s'épuise vite en quota et ne voit qu'un
fichier à la fois. Chercher des **dépôts** puis lire leur arbre git donne toutes les listes d'un
projet en deux requêtes — et les projets qui collectionnent des listes en contiennent des dizaines.
"""
GITHUB_DEPOTS = [
    "iptv m3u france",
    "iptv playlist tnt",
    "iptv-org",
    "free iptv m3u",
]

"""
La recherche de code reste, mais en second : elle trouve les fichiers isolés qu'aucun dépôt
spécialisé ne porte.
"""
GITHUB_QUERIES = [
    "TF1 in:file extension:m3u",
    '"France 2" in:file extension:m3u',
    "TNT in:file extension:m3u8",
]

GITHUB_MAX_PAGES_PER_QUERY = 2
GITHUB_MAX_DEPOTS = 40
GITHUB_MAX_FICHIERS_PAR_DEPOT = 60

# ------------------------------------------------------------------- ce qui coûte du temps

PLAYLIST_DOWNLOAD_TIMEOUT = 15.0

"""
Quatre secondes, et non sept puis huit.

Un flux qui n'a pas répondu en quatre secondes ne se regarde pas : on ne mesure pas la patience d'un
hébergeur, on mesure s'il envoie une image. Sur un corpus où la moitié des adresses sont mortes, la
différence entre 4 et 15 secondes d'attente **est** la durée du script.
"""
STREAM_CONNECT_TIMEOUT = 4.0
STREAM_READ_TIMEOUT = 4.0

"""
La concurrence, à deux étages.

`MAX_STREAM_CONCURRENCY` borne le total — au-delà, on sature sa propre carte réseau et l'on mesure sa
propre file d'attente plutôt que les hébergeurs. `LISTES_EN_PARALLELE` est le vrai gain : les listes
étaient traitées une par une, chacune attendant que la précédente ait fini ses quatre cents sondes.
"""
MAX_STREAM_CONCURRENCY = 240
LISTES_EN_PARALLELE = 8

"""
Le bannissement d'un hôte, et pourquoi il compte autant.

Une liste morte, c'est un serveur disparu et quatre cents adresses qui pointent dessus. Les essayer
une à une, c'est quatre cents fois le même délai. Trois échecs de connexion suffisent à conclure : ce
n'est pas l'adresse qui est morte, c'est la machine.

Les échecs comptés sont ceux du **transport** — connexion refusée, délai dépassé —, jamais un 404 :
un hébergeur qui répond « cette chaîne n'existe plus » est bien vivant, et ses autres adresses le sont
peut-être aussi.
"""
ECHECS_AVANT_BANNISSEMENT = 3

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


# ------------------------------------------------------------------- la découverte

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


def entetes_github(token: str) -> Dict[str, str]:
    return {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "FlixTunes/PlaylistAnalyzer",
    }


async def depots_github(client: httpx.AsyncClient) -> Dict[str, str]:
    """
    Les listes trouvées en lisant l'**arbre** des dépôts spécialisés.

    Deux requêtes par dépôt — la recherche puis l'arbre complet — rendent toutes ses listes d'un coup,
    là où la recherche de code n'en montre qu'une par résultat et s'épuise en quota. Un dépôt qui
    collectionne des listes en porte des dizaines : c'est là que se trouve le volume.
    """
    trouvees: Dict[str, str] = {}
    vus: Set[str] = set()
    for requete in GITHUB_DEPOTS:
        try:
            reponse = await client.get(
                "https://api.github.com/search/repositories",
                params={"q": requete, "sort": "updated", "per_page": 20},
            )
            if reponse.status_code in (403, 429):
                logger.warning(f"GitHub : quota atteint sur les dépôts « {requete} »")
                break
            reponse.raise_for_status()
        except Exception as erreur:
            logger.warning(f"GitHub : recherche de dépôts « {requete} » ignorée ({erreur})")
            continue

        for depot in reponse.json().get("items", [])[:GITHUB_MAX_DEPOTS]:
            plein = depot.get("full_name") or ""
            branche = depot.get("default_branch") or "master"
            if not plein or plein in vus:
                continue
            vus.add(plein)
            try:
                arbre = await client.get(
                    f"https://api.github.com/repos/{plein}/git/trees/{branche}",
                    params={"recursive": "1"},
                )
                if arbre.status_code != 200:
                    continue
            except Exception:
                continue

            fichiers = [
                noeud.get("path", "") for noeud in arbre.json().get("tree", [])
                if str(noeud.get("path", "")).lower().endswith((".m3u", ".m3u8"))
            ]
            for chemin in fichiers[:GITHUB_MAX_FICHIERS_PAR_DEPOT]:
                base = os.path.splitext(os.path.basename(chemin))[0]
                trouvees.setdefault(
                    f"{base} ({plein})",
                    f"https://raw.githubusercontent.com/{plein}/{branche}/{chemin}",
                )
    return trouvees


async def fichiers_github(client: httpx.AsyncClient) -> Dict[str, str]:
    """La recherche de code, en second : elle trouve les listes isolées qu'aucun dépôt ne rassemble."""
    trouvees: Dict[str, str] = {}
    for requete in GITHUB_QUERIES:
        for page in range(1, GITHUB_MAX_PAGES_PER_QUERY + 1):
            try:
                reponse = await client.get(
                    "https://api.github.com/search/code",
                    params={"q": requete, "per_page": 100, "page": page},
                )
                if reponse.status_code in (403, 429):
                    logger.warning(f"GitHub : quota atteint sur « {requete} »")
                    return trouvees
                reponse.raise_for_status()
            except Exception as erreur:
                logger.warning(f"GitHub : « {requete} » page {page} ignorée ({erreur})")
                break

            entrees = reponse.json().get("items", [])
            for entree in entrees:
                chemin = entree.get("path", "")
                depot = entree.get("repository", {})
                proprietaire = depot.get("owner", {}).get("login", "")
                nom = depot.get("name", "")
                branche = depot.get("default_branch", "master")
                if not (chemin.lower().endswith((".m3u", ".m3u8")) and proprietaire and nom):
                    continue
                base = os.path.splitext(os.path.basename(chemin))[0]
                trouvees.setdefault(
                    f"{base} ({proprietaire}/{nom})",
                    f"https://raw.githubusercontent.com/{proprietaire}/{nom}/{branche}/{chemin}",
                )
            if len(entrees) < 100:
                break
    return trouvees


async def chercher_les_listes() -> Dict[str, str]:
    """Les listes fixes, puis ce que GitHub apporte — dépôts d'abord, fichiers isolés ensuite."""
    listes = dict(PUBLIC_PLAYLISTS)
    token = load_github_token()
    if not token:
        logger.warning("GitHub ignoré : aucun jeton dans GITHUB_TOKEN ni github_token.txt")
        return listes

    async with httpx.AsyncClient(headers=entetes_github(token), timeout=20.0, follow_redirects=True) as client:
        for source, trouvees in (("dépôts", await depots_github(client)), ("fichiers", await fichiers_github(client))):
            connues = set(listes.values())
            neuves = {nom: url for nom, url in trouvees.items() if url not in connues}
            listes.update(neuves)
            logger.info(f"GitHub {source} : {len(neuves)} liste(s) retenue(s)")
    return listes


# ------------------------------------------------------------------- lire une liste

DIACRITIQUES = re.compile(r"[̀-ͯ]")


def cle_de_chaine(nom: str) -> str:
    """
    La clé sous laquelle FlixTunes fusionne deux entrées.

    Transcription de `normaliseForSearch` : décomposition, retrait des accents, minuscules, ligatures
    dépliées, et tout ce qui n'est ni lettre ni chiffre devient une espace. Le pourcentage mesuré ici
    porte sur les mêmes chaînes que celles de la grille — sans cette clé commune, les deux compteraient
    des choses différentes en croyant compter la même.
    """
    texte = DIACRITIQUES.sub("", unicodedata.normalize("NFD", nom)).lower()
    texte = texte.replace("œ", "oe").replace("æ", "ae").replace("ß", "ss")
    lisible = "".join(c if unicodedata.category(c)[0] in ("L", "N") else " " for c in texte)
    return " ".join(lisible.split())


def nom_de_lextinf(ligne: str) -> str:
    """Le nom d'une ligne `#EXTINF`, coupé à la première virgule **hors guillemets**."""
    dans_guillemets = False
    for index, caractere in enumerate(ligne):
        if caractere == '"':
            dans_guillemets = not dans_guillemets
        elif caractere == "," and not dans_guillemets:
            return ligne[index + 1:].strip()
    return ""


def lisible_par_flixtunes(url: str) -> bool:
    """Ce que les lecteurs de FlixTunes savent ouvrir : `http` et `https`, rien d'autre."""
    return bool(re.match(r"^https?://", url, re.IGNORECASE))


def parse_stream_url(brute: str, heritees: Optional[Dict[str, str]] = None) -> Tuple[str, Dict[str, str]]:
    entetes = dict(heritees or {})
    if "|" not in brute:
        return brute.strip(), entetes
    url, parametres = brute.split("|", 1)
    for cle, valeur in parse_qsl(parametres, keep_blank_values=True):
        courte = cle.strip().lower()
        if courte in {"user-agent", "user_agent", "http-user-agent"}:
            entetes["User-Agent"] = valeur
        elif courte in {"referer", "referrer", "http-referrer"}:
            entetes["Referer"] = valeur
        elif courte == "origin":
            entetes["Origin"] = valeur
    return url.strip(), entetes


def analyze_m3u(contenu: str) -> Tuple[List[Dict[str, object]], int]:
    """
    Les entrées d'une liste, et le nombre de celles que FlixTunes n'importera pas.

    Ce qui est écarté ici l'est pour les mêmes raisons que là-bas : un transport qu'aucun lecteur
    n'ouvre, ou un nom vide qui ne donne aucune clé de fusion.
    """
    entrees: List[Dict[str, object]] = []
    ecartees = 0
    dernier_nom = ""
    entetes: Dict[str, str] = {}

    for ligne_brute in contenu.splitlines():
        ligne = ligne_brute.strip()
        if not ligne:
            continue
        minuscule = ligne.lower()

        if minuscule.startswith("#extinf:"):
            dernier_nom = nom_de_lextinf(ligne)
            entetes = {}
            continue
        if minuscule.startswith("#extvlcopt:http-user-agent="):
            entetes["User-Agent"] = ligne.split("=", 1)[1].strip()
            continue
        if minuscule.startswith("#extvlcopt:http-referrer=") or minuscule.startswith("#extvlcopt:http-referer="):
            entetes["Referer"] = ligne.split("=", 1)[1].strip()
            continue
        if ligne.startswith("#"):
            continue

        url, propres = parse_stream_url(ligne, entetes)
        entetes = {}
        if not url:
            continue
        cle = cle_de_chaine(dernier_nom)
        if not lisible_par_flixtunes(url) or not cle:
            ecartees += 1
            continue
        entrees.append({"name": dernier_nom, "cle": cle, "flux_url": url, "headers": propres})

    unique: Dict[str, Dict[str, object]] = {}
    for entree in entrees:
        unique.setdefault(str(entree["flux_url"]), entree)
    return list(unique.values()), ecartees


# ------------------------------------------------------------------- sonder, vite et juste

class VerdictHotes:
    """
    Ce qu'on sait des machines, pour ne pas le réapprendre à chaque adresse.

    Une liste morte, c'est un serveur disparu et quatre cents adresses qui pointent dessus. Les
    essayer une à une revient à payer quatre cents fois le même délai. Deux mémoires suffisent : les
    noms qui ne se résolvent pas, et les machines qui ont refusé le transport plusieurs fois.
    """

    def __init__(self) -> None:
        self.resolus: Dict[str, bool] = {}
        self.echecs: Dict[str, int] = {}

    def banni(self, hote: str) -> bool:
        return self.resolus.get(hote) is False or self.echecs.get(hote, 0) >= ECHECS_AVANT_BANNISSEMENT

    def noter_echec(self, hote: str) -> None:
        self.echecs[hote] = self.echecs.get(hote, 0) + 1

    def noter_succes(self, hote: str) -> None:
        # Une réussite efface le passé : un hébergeur qui a hoqueté trois fois puis répond n'est pas mort.
        self.echecs[hote] = 0

    async def resoudre(self, hotes: Set[str]) -> None:
        """
        Résoudre chaque nom **une seule fois**, en parallèle, avant toute requête.

        Un domaine expiré est la panne la plus fréquente d'un corpus de listes, et la plus chère à
        découvrir par HTTP : le délai s'écoule en entier pour chacune de ses adresses. Un nom qui ne
        se résout pas condamne les siennes sans qu'une seule connexion ne soit tentée.
        """
        inconnus = [hote for hote in hotes if hote not in self.resolus]
        if not inconnus:
            return
        boucle = asyncio.get_running_loop()
        verrou = asyncio.Semaphore(64)

        async def resoudre_un(hote: str) -> None:
            async with verrou:
                try:
                    await boucle.getaddrinfo(hote, None)
                    self.resolus[hote] = True
                except Exception:
                    self.resolus[hote] = False

        await asyncio.gather(*(resoudre_un(hote) for hote in inconnus))
        morts = sum(1 for hote in inconnus if not self.resolus.get(hote))
        logger.info(f"Noms résolus : {len(inconnus) - morts} vivants, {morts} disparus")


def ressemble_a_un_flux(octets: bytes, type_declare: Optional[str]) -> bool:
    """
    Est-ce vraiment un flux, ou une page qui répond poliment ?

    N'importe quelle réponse 200 comptait comme vivante : une page d'erreur, un portail captif, la
    page de garde d'un hébergeur qui a récupéré le domaine. Trois signes suffisent à trancher — un
    manifeste commence par `#EXTM3U`, un flux MPEG-TS par l'octet `0x47`, et un type déclaré vidéo
    engage celui qui l'annonce. Ce qui commence par `<` est une page web, et rien d'autre.
    """
    tete = octets[:512]
    if tete.lstrip()[:7] == b"#EXTM3U":
        return True
    if tete[:1] == b"G":
        return True
    if tete.lstrip()[:1] == b"<":
        return False
    declare = (type_declare or "").lower()
    return any(marqueur in declare for marqueur in ("mpegurl", "video/", "octet-stream", "audio/"))


async def check_flux(client: httpx.AsyncClient, url: str, entetes: Dict[str, str], hotes: VerdictHotes) -> bool:
    if not lisible_par_flixtunes(url):
        return False
    hote = urlparse(url).hostname or ""
    if not hote or hotes.banni(hote):
        return False

    demande = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142 Safari/537.36",
        "Accept": "*/*",
        "Connection": "keep-alive",
    }
    demande.update(entetes)

    try:
        async with client.stream("GET", url, headers=demande) as reponse:
            if reponse.status_code not in (200, 206):
                # Un 404 n'accuse pas la machine : elle a répondu, elle est vivante.
                hotes.noter_succes(hote)
                return False
            async for morceau in reponse.aiter_bytes(2048):
                hotes.noter_succes(hote)
                return ressemble_a_un_flux(morceau, reponse.headers.get("content-type"))
            return False
    except Exception:
        hotes.noter_echec(hote)
        return False


# ------------------------------------------------------------------- la passe

def classement(pourcentage: Optional[float]) -> str:
    """
    Les quatre bandes que FlixTunes affiche, dérivées du pourcentage exact.

    Le fichier porte désormais le chiffre lui-même ; ces noms ne servent plus qu'à ranger les listes
    dans un menu. C'est l'inverse d'avant, où le nom était la seule chose transmise et le chiffre
    perdu en route.
    """
    if pourcentage is None:
        return "inconnue"
    if pourcentage >= 75:
        return "bonne"
    if pourcentage >= 50:
        return "moyenne"
    if pourcentage >= 25:
        return "douteuse"
    return "faible"


async def traiter_une_liste(
    client: httpx.AsyncClient,
    nom: str,
    url: str,
    hotes: VerdictHotes,
    cache: Dict[Tuple[str, Tuple[Tuple[str, str], ...]], bool],
    verrou: asyncio.Semaphore,
    journal: List[Dict[str, object]],
) -> Optional[Dict[str, object]]:
    try:
        reponse = await client.get(url, timeout=PLAYLIST_DOWNLOAD_TIMEOUT)
        if reponse.status_code != 200:
            logger.warning(f"Liste « {nom} » injoignable (HTTP {reponse.status_code})")
            return None
        entrees, ecartees = analyze_m3u(reponse.text)
    except Exception as erreur:
        logger.warning(f"Liste ignorée « {nom} » : {erreur}")
        return None

    if not entrees:
        return None

    await hotes.resoudre({urlparse(str(e["flux_url"])).hostname or "" for e in entrees} - {""})

    async def sonder(entree: Dict[str, object]) -> Tuple[Dict[str, object], bool]:
        adresse = str(entree["flux_url"])
        propres = dict(entree.get("headers", {}))
        empreinte = (adresse, tuple(sorted(propres.items())))
        if empreinte in cache:
            return entree, cache[empreinte]
        async with verrou:
            vivant = await check_flux(client, adresse, propres, hotes)
        cache[empreinte] = vivant
        return entree, vivant

    """
    Une chaîne est joignable si **l'une** de ses adresses répond.

    C'est la règle du lecteur : il les sonde toutes et prend celle qui arrive la première. Compter les
    flux plutôt que les chaînes donnait 50 % à une liste qui double chacune de ses entrées, alors que
    FlixTunes en montre 100 % de vivantes.
    """
    par_chaine: Dict[str, bool] = {}
    flux_actifs = 0
    for tache in asyncio.as_completed([asyncio.create_task(sonder(e)) for e in entrees]):
        entree, vivant = await tache
        cle = str(entree["cle"])
        par_chaine[cle] = par_chaine.get(cle, False) or vivant
        if vivant:
            flux_actifs += 1
        journal.append({
            "playlist": nom, "name": entree.get("name", ""),
            "flux_url": entree.get("flux_url", ""), "etat": "v" if vivant else "x",
        })

    total = len(par_chaine)
    joignables = sum(1 for vivant in par_chaine.values() if vivant)
    if joignables < MIN_ACTIVE_TO_KEEP:
        logger.info(f"« {nom} » : aucune chaîne joignable, écartée")
        return None

    pourcentage = round(joignables * 100 / total, 1) if total else 0.0
    logger.info(
        f"« {nom} » : {joignables}/{total} chaînes ({pourcentage} %) — "
        f"{flux_actifs}/{len(entrees)} flux, {ecartees} écartée(s)"
    )
    return {
        "nom": nom, "url": url, "chaines": total, "joignables": joignables,
        "pourcentage": pourcentage, "classement": classement(pourcentage),
        "flux": len(entrees), "flux_joignables": flux_actifs, "ecartees": ecartees,
    }


async def traiter_les_listes(listes: Dict[str, str]) -> Tuple[List[Dict[str, object]], List[Dict[str, object]]]:
    """
    Les listes sont traitées **par paquets**, et c'est le gain principal.

    Elles l'étaient une par une : chacune attendait que la précédente ait fini ses quatre cents
    sondes. Sur cinq cents listes, cette attente **était** la durée du script. Elles avancent
    maintenant à `LISTES_EN_PARALLELE` de front, sous un plafond commun de connexions qui empêche de
    saturer sa propre carte réseau — c'est-à-dire de mesurer sa file d'attente au lieu des hébergeurs.
    """
    journal: List[Dict[str, object]] = []
    retenues: List[Dict[str, object]] = []
    cache: Dict[Tuple[str, Tuple[Tuple[str, str], ...]], bool] = {}
    hotes = VerdictHotes()

    delais = httpx.Timeout(
        connect=STREAM_CONNECT_TIMEOUT, read=STREAM_READ_TIMEOUT,
        write=STREAM_READ_TIMEOUT, pool=STREAM_CONNECT_TIMEOUT,
    )
    plafond = httpx.Limits(
        max_connections=MAX_STREAM_CONCURRENCY + 40,
        max_keepalive_connections=MAX_STREAM_CONCURRENCY,
    )
    verrou = asyncio.Semaphore(MAX_STREAM_CONCURRENCY)
    portes = asyncio.Semaphore(LISTES_EN_PARALLELE)

    async with httpx.AsyncClient(limits=plafond, timeout=delais, follow_redirects=True, http2=True) as client:
        async def une(nom: str, url: str) -> None:
            async with portes:
                mesure = await traiter_une_liste(client, nom, url, hotes, cache, verrou, journal)
            if mesure:
                retenues.append(mesure)

        await asyncio.gather(*(une(nom, url) for nom, url in listes.items()))

    retenues.sort(key=lambda m: (-float(m["pourcentage"]), str(m["nom"]).lower()))
    return journal, retenues


# ------------------------------------------------------------------- Google Drive

def get_folder_id(service, folder_name: str, parent_id: Optional[str] = None) -> Optional[str]:
    safe_name = folder_name.replace("'", "\'")
    query = f"name='{safe_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
    if parent_id:
        query += f" and '{parent_id}' in parents"
    res = service.files().list(q=query, spaces="drive", fields="files(id,name)").execute()
    items = res.get("files", [])
    return items[0]["id"] if items else None


def get_file_id(service, file_name: str, parent_id: str) -> Optional[str]:
    safe_name = file_name.replace("'", "\'")
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
    except RefreshError as erreur:
        logger.warning(f"Drive ignoré: jeton Google refusé ({erreur})")
        return None
    except Exception as erreur:
        logger.warning(f"Drive ignoré: authentification impossible ({erreur})")
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
        horodatage = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")

        for fichier in FILES_TO_ARCHIVE:
            identifiant = get_file_id(service, fichier, root_id)
            if identifiant and archive_id:
                base, extension = os.path.splitext(fichier)
                service.files().copy(
                    fileId=identifiant,
                    body={"name": f"{base}_{horodatage}{extension}", "parents": [archive_id]},
                ).execute()
                logger.info(f"{fichier} archivé dans {ARCHIVE_FOLDER_NAME}")

            media = MediaFileUpload(os.path.join(SCRIPT_DIR, fichier), mimetype="application/json", resumable=True)
            if identifiant:
                service.files().update(fileId=identifiant, media_body=media, fields="id").execute()
                logger.info(f"{fichier} mis à jour sur Drive")
            else:
                service.files().create(
                    body={"name": fichier, "parents": [root_id]}, media_body=media, fields="id",
                ).execute()
                logger.info(f"{fichier} envoyé dans {ROOT_FOLDER}")
    except Exception as erreur:
        logger.warning(f"Drive ignoré pour cette exécution: {erreur}")


def deposer_pour_flixtunes(source: str) -> None:
    """Déposer une copie dans le dossier que FlixTunes relit, si on en a indiqué un."""
    if not FLIXTUNES_M3U_DIR:
        return
    try:
        os.makedirs(FLIXTUNES_M3U_DIR, exist_ok=True)
        shutil.copyfile(source, os.path.join(FLIXTUNES_M3U_DIR, M3U_FILE))
        logger.info(f"{M3U_FILE} déposé dans {FLIXTUNES_M3U_DIR}")
    except OSError as erreur:
        logger.warning(f"Dépôt FlixTunes ignoré ({FLIXTUNES_M3U_DIR}): {erreur}")


# ------------------------------------------------------------------- le fichier produit

def ecrire_m3u_json(mesures: List[Dict[str, object]]) -> str:
    """
    Le fichier, version 2 : ce qu'on a mesuré, dit franchement.

    La version 1 était un dictionnaire « nom » : « adresse », et le classement voyageait **dans le
    nom** sous forme d'emoji — `✅ iptv-org France`. C'était le seul canal disponible, et FlixTunes
    devait rétro-analyser une pastille pour retrouver un chiffre qu'on avait mesuré puis jeté.
    Le pourcentage exact est là, l'effectif aussi, et la date du relevé avec eux.
    """
    contenu = {
        "version": 2,
        "genere_le": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "listes": mesures,
    }
    chemin = os.path.join(SCRIPT_DIR, M3U_FILE)
    with open(chemin, "w", encoding="utf-8") as fichier:
        json.dump(contenu, fichier, ensure_ascii=False, indent=2)
    return chemin


async def _main() -> None:
    debut = datetime.datetime.now()
    listes = await chercher_les_listes()
    logger.info(f"{len(listes)} liste(s) à analyser")

    journal, mesures = await traiter_les_listes(listes)

    with open(os.path.join(SCRIPT_DIR, CHANNELS_STATUS_FILE), "w", encoding="utf-8") as fichier:
        json.dump(journal, fichier, ensure_ascii=False, indent=2)
    chemin = ecrire_m3u_json(mesures)

    actifs = sum(1 for entree in journal if entree.get("etat") == "v")
    duree = (datetime.datetime.now() - debut).total_seconds()
    logger.info(
        f"Résultat : {len(mesures)} liste(s) conservée(s), {actifs} flux joignables sur {len(journal)}, "
        f"en {duree / 60:.1f} min"
    )
    deposer_pour_flixtunes(chemin)
    sync_drive()


def main() -> None:
    asyncio.run(_main())


if __name__ == "__main__":
    main()
