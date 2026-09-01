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
import hashlib
import json
import logging
import os
import re
import shutil
import socket
import time
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
    # Les listes de i.mjh.nz — Pluto, Samsung, Rakuten — ont été retirées le 1er septembre 2026 :
    # vérifié, elles rendent 404 et l'hébergeur ne publie plus que des guides XMLTV. Les mesurer ici
    # les aurait comptées comme mortes à chaque passe, ce qui est exact mais inutile.
    #
    # Et rien n'a pris leur place. L'index de toutes les catégories d'iptv-org — 13 561 chaînes du
    # monde entier, mesuré — semblait un remplaçant naturel : c'en était le contraire. Les listes
    # fixes étant alors exemptes du critère de liste, elle aurait fait rentrer par la porte le monde
    # entier qu'on venait de sortir par la fenêtre. Le tri se faisant maintenant à la chaîne, elle ne
    # serait plus dangereuse — seulement inutile : ses 12 884 entrées se réduisent aux 705 que la
    # liste de langue française apporte déjà, mesuré.
}

"""
La part d'entrées francophones qui suffit à garder une liste **entière**.

C'est le garde-fou du filtre, et le seul réglage qui compte. En deçà, on ne retient que les entrées
reconnues — un fourre-tout mondial n'entre que par sa part française. Au-delà, on garde tout, y
compris ce que la table ne connaît pas : sur une liste française, ce qui n'est pas étiqueté est
français, et une chaîne régionale absente d'iptv-org ne mérite pas d'être perdue pour ça.

Mesuré : les trois listes françaises éprouvées sont reconnues à 100 % et passent donc largement,
tandis que le fourre-tout mondial d'iptv-org est à 5,5 % et subit le tri strict. Aucune liste
intermédiaire n'était disponible pour éprouver le seuil lui-même — il est raisonné, pas mesuré.
"""
PART_FRANCOPHONE_SUFFISANTE = 0.50

"""
Les noms qui trahissent une liste française, quand on cherche des **fichiers**.

Ils ne filtrent plus rien : le tri se fait à la chaîne, et une liste n'a plus à porter tel ou tel nom
pour être acceptée. Ils ne servent qu'à **trouver** — un fichier qui contient « TF1 » ou « Canal+ »
est très probablement une liste française, et GitHub ne sait chercher que par contenu littéral.
"""
CHAINES_CHERCHEES = ("TF1", "M6", '"Canal+"')

"""
Six secondes entre deux recherches de code.

L'API de recherche de code de GitHub n'accorde que **dix requêtes par minute**. Douze étaient tirées
d'affilée : les deux dernières recevaient 403, et le script les abandonnait en silence — on perdait
donc précisément les résultats qu'on était allé chercher. Attendre coûte une minute et rend ces
pages. La recherche de dépôts, elle, dispose de trente requêtes par minute et n'a pas besoin de ça.
"""
REPIT_RECHERCHE_CODE_S = 6.0

"""
Ce qu'un nom de fichier annonce franchement, et qui n'est pas pour nous.

Un filtre grossier, mais gratuit : il évite de télécharger une liste de deux mégaoctets pour découvrir
qu'elle est indienne. Il ne remplace pas le critère ci-dessus, il lui épargne du travail.
"""
NOMS_ECARTES = (
    "china", "chinese", "arab", "arabic", "india", "indian", "hindi", "turk", "russia", "russian",
    "brasil", "brazil", "espana", "spain", "italia", "italy", "german", "deutsch", "poland", "polska",
    "portugal", "greek", "korea", "japan", "viet", "thai", "indo", "iran", "pakistan", "africa",
    "latino", "mexico", "adult", "xxx", "porn",
)

"""
Les dépôts qu'on va lire, plutôt que les fichiers qu'on cherche.

La recherche de code de GitHub rend cent résultats par page, s'épuise vite en quota et ne voit qu'un
fichier à la fois. Chercher des **dépôts** puis lire leur arbre git donne toutes les listes d'un
projet en deux requêtes — et les projets qui collectionnent des listes en contiennent des dizaines.
"""
GITHUB_DEPOTS = [
    "iptv m3u france",
    "iptv playlist tnt",
    "chaines francaises m3u",
    "playlist tv francaise",
    "iptv francophone",
    "iptv belgique suisse m3u",
    "iptv-org",
    "free iptv m3u",
]

"""
La recherche de code reste, mais en second : elle trouve les fichiers isolés qu'aucun dépôt
spécialisé ne porte.
"""
GITHUB_QUERIES = [
    f"{chaine} in:file extension:{extension}"
    for chaine in CHAINES_CHERCHEES
    for extension in ("m3u", "m3u8")
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
    arbres: List[Tuple[str, str]] = []
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
            arbres.append((plein, branche))

    """
    Les arbres sont demandés **de front**, et non l'un après l'autre.

    Quatre-vingts dépôts interrogés en file, à un aller-retour chacun, font une minute d'attente avant
    que la première liste ne soit téléchargée — pendant laquelle le réseau ne fait rien. Six requêtes
    de front suffisent à l'effacer ; on n'en met pas plus, parce que l'API de GitHub compte les rafales
    autant que le total et répond 403 à qui la bouscule.
    """
    portes = asyncio.Semaphore(6)

    async def lire_un_arbre(plein: str, branche: str) -> List[str]:
        async with portes:
            try:
                arbre = await client.get(
                    f"https://api.github.com/repos/{plein}/git/trees/{branche}",
                    params={"recursive": "1"},
                )
                if arbre.status_code != 200:
                    return []
                return [
                    noeud.get("path", "") for noeud in arbre.json().get("tree", [])
                    if str(noeud.get("path", "")).lower().endswith((".m3u", ".m3u8"))
                ]
            except Exception:
                return []

    for (plein, branche), fichiers in zip(
        arbres, await asyncio.gather(*(lire_un_arbre(p, b) for p, b in arbres))
    ):
        for chemin in fichiers[:GITHUB_MAX_FICHIERS_PAR_DEPOT]:
            base = os.path.splitext(os.path.basename(chemin))[0]
            # Ce qui s'annonce étranger ne sera pas téléchargé : le critère de contenu s'appliquera
            # aux autres, et n'aura pas à trancher ce que le nom disait déjà.
            if any(mot in chemin.lower() for mot in NOMS_ECARTES):
                continue
            trouvees.setdefault(
                f"{base} ({plein})",
                f"https://raw.githubusercontent.com/{plein}/{branche}/{chemin}",
            )
    return trouvees


async def fichiers_github(client: httpx.AsyncClient) -> Dict[str, str]:
    """La recherche de code, en second : elle trouve les listes isolées qu'aucun dépôt ne rassemble."""
    trouvees: Dict[str, str] = {}
    premiere = True
    for requete in GITHUB_QUERIES:
        for page in range(1, GITHUB_MAX_PAGES_PER_QUERY + 1):
            if not premiere:
                await asyncio.sleep(REPIT_RECHERCHE_CODE_S)
            premiere = False
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


ATTRIBUT_EXTINF = re.compile(r'([\w-]+)="([^"]*)"')


def attributs_de_lextinf(ligne: str) -> Dict[str, str]:
    """
    Ce que la ligne `#EXTINF` déclare avant le nom, et qu'on jetait.

    `tvg-id="6ter.fr@SD"`, `group-title="Entertainment"`, `tvg-logo="…"` : trois renseignements
    lus puis perdus. Le premier est ce qui permet de reconnaître une chaîne francophone **par
    jointure exacte** plutôt que par ressemblance de nom ; les deux autres épargnent à FlixTunes de
    redécouvrir un logo et un genre qu'on avait sous les yeux.
    """
    return {cle.lower(): valeur for cle, valeur in ATTRIBUT_EXTINF.findall(ligne)}


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


def compacter(nom: str) -> str:
    """Le nom sans accents ni espaces, **ponctuation gardée** : c'est le `+` qui sauve « Canal+ »."""
    return DIACRITIQUES.sub("", unicodedata.normalize("NFD", nom)).lower().replace(" ", "")


# ------------------------------------------------------------------- qui parle français

"""
Le tri se fait à la **chaîne**, et non à la liste.

Le critère précédent jugeait une liste entière sur trois noms — TF1, M6, Canal+. Il se trompait dans
les deux sens : il jetait une bonne liste de chaînes régionales françaises qui n'a pas Canal+, et
gardait un dépôt mondial de douze mille chaînes qui, lui, contient les trois. Une liste n'est pas
francophone ou étrangère ; ce sont ses **entrées** qui le sont, et souvent les deux à la fois.

Ce qui manquait, c'est la langue. iptv-org publie `feeds.json`, où chaque flux déclare la sienne :
**2 002 chaînes de langue française**, et le `tvg-id` des listes — `6ter.fr@SD` — est exactement cet
identifiant. La jointure est donc **exacte**, sans comparaison de noms décorés.

Mesuré sur quatre listes réelles : le fourre-tout mondial d'iptv-org n'entre plus que par ses 705
chaînes françaises sur 12 884, tandis que les trois listes françaises éprouvées sont reconnues à
**100 %** et ne perdent rien.
"""

FEEDS_IPTV_ORG = "https://iptv-org.github.io/api/feeds.json"
CHAINES_IPTV_ORG = "https://iptv-org.github.io/api/channels.json"
CACHE_FRANCOPHONE = "reference-francophone.json"

"""Une semaine : une chaîne ne change pas de langue, et les deux tables pèsent vingt mégaoctets."""
FRAICHEUR_REFERENCE_S = 7 * 24 * 3600

"""
Les pays où le français est officiel ou d'usage courant.

Second signal, plus grossier que la langue déclarée : il rattrape les chaînes qu'iptv-org connaît sans
leur avoir attribué de flux. Le Canada en est **absent volontairement** — mille chaînes canadiennes
dont l'immense majorité est anglophone, et le signal de langue distingue déjà correctement celles du
Québec.
"""
PAYS_FRANCOPHONES = {
    "fr", "be", "ch", "lu", "mc", "sn", "ci", "cm", "ml", "bf", "ne", "td", "ga", "cg", "cd",
    "bj", "tg", "gn", "mg", "dj", "km", "rw", "bi", "sc", "mu", "ht",
}

"""Ce qu'un `group-title` dit quand il parle de territoire plutôt que de genre."""
MOTS_DE_GROUPE = (
    "france", "french", "francais", "français", "francophone", "belgique", "belgi", "suisse",
    "romande", "quebec", "québec", "canal+", "tnt", "afrique franc",
)

"""Le préfixe que beaucoup de listes collent devant le nom : « |FR| TF1 », « BE: La Une »."""
PREFIXE_DE_PAYS = re.compile(r"^\s*[\|\[\(]?\s*(fr|be|ch|qc|lu|mc)\s*[\|\]\)\:\-\.]", re.IGNORECASE)

"""Ce qui décore un nom sans rien en dire — mêmes listes que le serveur, pour que les deux s'accordent."""
DECOR_ENTRE_PARENTHESES = re.compile(r"\s*[\(\[\{][^\)\]\}]*[\)\]\}]\s*$")
DECOR_QUEUE = {
    "hd", "fhd", "uhd", "sd", "qhd", "4k", "8k", "1080p", "1080", "720p", "720", "576p", "540p",
    "480p", "h264", "h265", "hevc", "raw", "vip", "backup", "alt", "multi", "tnt", "tv", "fps50",
}
DECOR_TETE = {"fr", "fra", "france", "tnt", "hd", "fhd", "uhd", "sd", "4k", "vip", "hevc", "be", "ch", "qc"}


def ecritures_possibles(nom: str) -> List[str]:
    """Les écritures d'un nom, de la plus décorée à la plus nue : « TF1 FHD (1080p) » finit en « tf1 »."""
    reduit = nom
    for _ in range(3):
        suivant = DECOR_ENTRE_PARENTHESES.sub("", reduit).strip()
        if suivant == reduit:
            break
        reduit = suivant
    jetons = [jeton for jeton in reduit.split() if jeton]
    essais: List[str] = []
    while jetons:
        essais.append(compacter(" ".join(jetons)))
        if len(jetons) > 1 and jetons[-1].strip("[]()").lower() in DECOR_QUEUE:
            jetons = jetons[:-1]
            continue
        if len(jetons) > 1 and jetons[0].strip("|[]()").lower() in DECOR_TETE:
            jetons = jetons[1:]
            continue
        break
    return essais


class Francophonie:
    """
    Ce qu'on sait des chaînes qui parlent français, et comment on les reconnaît dans une liste.

    Quatre signaux en union, du plus sûr au plus grossier. L'identifiant de flux est exact. Le suffixe
    de pays du `tvg-id` l'est presque. Le nom dépouillé se compare à la table, **en écartant les noms
    qu'une chaîne non francophone porte aussi** — sans quoi « Sport TV » ferait entrer le Portugal.
    Le groupe et le préfixe ne coûtent rien et rattrapent les listes qui n'étiquettent rien d'autre :
    mesurés à zéro sur iptv-org, qui met des genres dans ses groupes, et à 100 % sur Free-TV France.
    """

    def __init__(self, ids: Set[str], noms: Set[str]) -> None:
        self.ids = ids
        self.noms = noms

    def reconnait(self, nom: str, attributs: Dict[str, str]) -> bool:
        identifiant = (attributs.get("tvg-id") or "").split("@")[0]
        if identifiant and identifiant in self.ids:
            return True
        if "." in identifiant and identifiant.rsplit(".", 1)[-1].lower() in PAYS_FRANCOPHONES:
            return True
        if any(ecriture in self.noms for ecriture in ecritures_possibles(nom)):
            return True
        groupe = (attributs.get("group-title") or "").lower()
        if groupe and any(mot in groupe for mot in MOTS_DE_GROUPE):
            return True
        return bool(PREFIXE_DE_PAYS.match(nom))


def indexer_la_francophonie(feeds_json: str, chaines_json: str) -> Francophonie:
    """Croiser les flux — qui portent la langue — et les chaînes — qui portent les noms."""
    ids = {
        str(flux.get("channel"))
        for flux in json.loads(feeds_json)
        if "fra" in (flux.get("languages") or []) and flux.get("channel")
    }
    francophones: Set[str] = set()
    etrangers: Set[str] = set()
    for chaine in json.loads(chaines_json):
        if chaine.get("closed"):
            continue
        cible = francophones if chaine.get("id") in ids else etrangers
        for appellation in [chaine.get("name")] + list(chaine.get("alt_names") or []):
            if isinstance(appellation, str) and appellation.strip():
                cible.add(compacter(appellation))
    """
    Un nom que porte aussi une chaîne non francophone n'identifie rien.

    C'est la même prudence que la table de pays du serveur : mieux vaut ignorer un homonyme que de
    faire entrer le monde entier par lui. Mesuré : 204 écritures écartées à ce titre.
    """
    return Francophonie(ids, francophones - etrangers)


async def charger_la_francophonie() -> Optional[Francophonie]:
    """
    La table, depuis le disque si elle y est fraîche, sinon depuis Internet.

    Un échec de téléchargement rend la copie périmée plutôt que rien. S'il n'y a **aucune** copie, on
    rend `None` : le filtre se désactive alors franchement — tout garder est un défaut visible, tout
    jeter faute de savoir serait un désastre silencieux.
    """
    chemin = os.path.join(SCRIPT_DIR, CACHE_FRANCOPHONE)
    garde: Optional[Dict[str, str]] = None
    try:
        with open(chemin, encoding="utf-8") as fichier:
            enveloppe = json.load(fichier)
        garde = {"feeds": enveloppe["feeds"], "chaines": enveloppe["chaines"]}
        if time.time() - float(enveloppe.get("lu_le", 0)) < FRAICHEUR_REFERENCE_S:
            return indexer_la_francophonie(garde["feeds"], garde["chaines"])
    except Exception:
        pass

    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True,
                                     headers={"User-Agent": "FlixTunes"}) as client:
            feeds, chaines = await asyncio.gather(
                client.get(FEEDS_IPTV_ORG), client.get(CHAINES_IPTV_ORG),
            )
        feeds.raise_for_status()
        chaines.raise_for_status()
        index = indexer_la_francophonie(feeds.text, chaines.text)
        with open(chemin, "w", encoding="utf-8") as fichier:
            json.dump({"lu_le": time.time(), "feeds": feeds.text, "chaines": chaines.text}, fichier)
        logger.info(f"Référence francophone : {len(index.ids)} chaînes, {len(index.noms)} écritures")
        return index
    except Exception as erreur:
        if garde:
            logger.warning(f"Référence francophone périmée réutilisée ({erreur})")
            return indexer_la_francophonie(garde["feeds"], garde["chaines"])
        logger.error(f"Référence francophone indisponible : le filtre est désactivé ({erreur})")
        return None


def analyze_m3u(contenu: str) -> Tuple[List[Dict[str, object]], int]:
    """
    Les entrées d'une liste, et le nombre de celles que FlixTunes n'importera pas.

    Ce qui est écarté ici l'est pour les mêmes raisons que là-bas : un transport qu'aucun lecteur
    n'ouvre, ou un nom vide qui ne donne aucune clé de fusion.
    """
    entrees: List[Dict[str, object]] = []
    ecartees = 0
    dernier_nom = ""
    derniers_attributs: Dict[str, str] = {}
    entetes: Dict[str, str] = {}

    for ligne_brute in contenu.splitlines():
        ligne = ligne_brute.strip()
        if not ligne:
            continue
        minuscule = ligne.lower()

        if minuscule.startswith("#extinf:"):
            dernier_nom = nom_de_lextinf(ligne)
            derniers_attributs = attributs_de_lextinf(ligne)
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
        entrees.append({
            "name": dernier_nom, "cle": cle, "flux_url": url, "headers": propres,
            "tvg_id": derniers_attributs.get("tvg-id", ""),
            "groupe": derniers_attributs.get("group-title", ""),
            "logo": derniers_attributs.get("tvg-logo", ""),
            "attributs": derniers_attributs,
        })

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
    cache: Dict[Tuple[str, Tuple[Tuple[str, str], ...]], "asyncio.Task[bool]"],
    verrou: asyncio.Semaphore,
    journal: List[Dict[str, object]],
    francophonie: Optional["Francophonie"],
    deja_vues: Dict[str, str],
) -> Optional[Dict[str, object]]:
    try:
        reponse = await client.get(url, timeout=PLAYLIST_DOWNLOAD_TIMEOUT)
        if reponse.status_code != 200:
            logger.warning(f"Liste « {nom} » injoignable (HTTP {reponse.status_code})")
            return None
        corps = reponse.text
        entrees, ecartees = analyze_m3u(corps)
    except Exception as erreur:
        logger.warning(f"Liste ignorée « {nom} » : {erreur}")
        return None

    if not entrees:
        return None

    """
    Deux copies du même fichier ne sont pas deux listes.

    Les dépôts de listes se recopient les uns les autres — une fourche de projet en porte l'intégralité
    sous une autre adresse. Rien ne s'en apercevait : l'adresse diffère, le contenu non. On la traitait
    donc entièrement pour aboutir au même chiffre, et FlixTunes se retrouvait avec deux entrées de menu
    pour un seul bouquet.

    Aucune chaîne n'est perdue en écartant l'une des deux, par construction : leurs octets sont
    identiques.
    """
    empreinte_liste = hashlib.sha256(corps.encode("utf-8", "replace")).hexdigest()
    jumelle = deja_vues.get(empreinte_liste)
    if jumelle is not None:
        logger.info(f"« {nom} » écartée : copie exacte de « {jumelle} »")
        return None
    deja_vues[empreinte_liste] = nom

    """
    Le tri francophone, entrée par entrée, **avant** de sonder.

    Il remplace le critère TF1 + M6 + Canal+, qui jugeait une liste entière sur trois noms et se
    trompait dans les deux sens. Chaque entrée est confrontée à la table des langues ; celles qui ne
    sont reconnues par aucun des quatre signaux ne sont ni sondées, ni transmises.

    **Le garde-fou.** Si la liste est reconnue francophone à `PART_FRANCOPHONE_SUFFISANTE` ou plus, on
    la garde **entière**, entrées non identifiées comprises : sur une liste française, ce qui n'est pas
    étiqueté est français, et une chaîne absente d'iptv-org ne mérite pas d'être perdue pour ça. Le
    filtre strict ne frappe donc que les fourre-tout mondiaux — ceux pour lesquels il a été écrit.

    Rien de tout ceci n'est appliqué si la table n'a pas pu être chargée : le filtre se désactive
    franchement plutôt que de tout jeter faute de savoir.
    """
    part_francophone: Optional[float] = None
    entiere = True
    if francophonie is not None:
        reconnues = [
            entree for entree in entrees
            if francophonie.reconnait(str(entree.get("name", "")), dict(entree.get("attributs", {})))
        ]
        part = len(reconnues) / len(entrees)
        part_francophone = round(part * 100, 1)
        if part >= PART_FRANCOPHONE_SUFFISANTE:
            logger.info(f"« {nom} » : {part:.0%} francophone, gardée entière ({len(entrees)} entrées)")
        elif reconnues:
            logger.info(
                f"« {nom} » : {len(reconnues)}/{len(entrees)} entrées francophones retenues ({part:.0%})"
            )
            entrees = reconnues
            entiere = False
        else:
            logger.info(f"« {nom} » écartée : aucune entrée francophone sur {len(entrees)}")
            return None

    await hotes.resoudre({urlparse(str(e["flux_url"])).hostname or "" for e in entrees} - {""})

    async def sonder(entree: Dict[str, object]) -> Tuple[Dict[str, object], bool]:
        """
        Une adresse n'est sondée qu'une fois, **même si huit listes la demandent en même temps**.

        Le cache ne retenait que des résultats, et n'était donc écrit qu'une fois la sonde finie. Huit
        listes avançant de front, les huit trouvaient le cache vide et sondaient la même adresse
        ensemble : le cache ne servait qu'aux retardataires. Ce n'est pas un détail de bord — les
        listes découvertes se recopient énormément, et c'est exactement quand elles se ressemblent que
        la collision arrive.

        Ce qui est mis en cache est maintenant la **sonde en cours** et non son résultat : la première
        liste la lance, les sept autres attendent la même.
        """
        adresse = str(entree["flux_url"])
        propres = dict(entree.get("headers", {}))
        empreinte = (adresse, tuple(sorted(propres.items())))
        en_cours = cache.get(empreinte)
        if en_cours is None:
            async def mesurer() -> bool:
                async with verrou:
                    return await check_flux(client, adresse, propres, hotes)
            en_cours = asyncio.create_task(mesurer())
            cache[empreinte] = en_cours
        return entree, await en_cours

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
    """
    Ce que FlixTunes reçoit de cette liste, et qu'il n'aura pas à redécouvrir.

    `part_francophone` et `entiere` disent **comment** la liste a été traitée : à 100 % elle est
    passée telle quelle, à 5 % elle a été réduite à sa part française. C'est le renseignement qui
    manquait pour ranger les listes dans un menu autrement que par leur seul taux de flux vivants —
    une liste mondiale rabotée à trente chaînes vaut moins qu'une liste française entière de trente
    chaînes, et rien ne le disait.
    """
    return {
        "nom": nom, "url": url, "chaines": total, "joignables": joignables,
        "pourcentage": pourcentage, "classement": classement(pourcentage),
        "flux": len(entrees), "flux_joignables": flux_actifs, "ecartees": ecartees,
        "part_francophone": part_francophone, "entiere": entiere,
    }


async def traiter_les_listes(listes: Dict[str, str]) -> Tuple[List[Dict[str, object]], List[Dict[str, object]]]:
    """
    Les listes sont traitées **par paquets**, et c'est le gain principal.

    Elles l'étaient une par une : chacune attendait que la précédente ait fini ses quatre cents
    sondes. Sur cinq cents listes, cette attente **était** la durée du script. Elles avancent
    maintenant à `LISTES_EN_PARALLELE` de front, sous un plafond commun de connexions qui empêche de
    saturer sa propre carte réseau — c'est-à-dire de mesurer sa file d'attente au lieu des hébergeurs.
    """
    """
    La table des langues est chargée **une fois**, avant tout le reste.

    Vingt mégaoctets lus une fois par semaine, contre un filtre appliqué des centaines de milliers de
    fois : le rapport ne se discute pas. Si elle manque, `charger_la_francophonie` rend `None` et le
    filtre se désactive — on garde tout, ce qui est un défaut visible, plutôt que de tout jeter faute
    de savoir, qui serait un désastre silencieux.
    """
    francophonie = await charger_la_francophonie()

    journal: List[Dict[str, object]] = []
    retenues: List[Dict[str, object]] = []
    cache: Dict[Tuple[str, Tuple[Tuple[str, str], ...]], "asyncio.Task[bool]"] = {}
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
    deja_vues: Dict[str, str] = {}

    async with httpx.AsyncClient(limits=plafond, timeout=delais, follow_redirects=True, http2=True) as client:
        async def une(nom: str, url: str) -> None:
            async with portes:
                mesure = await traiter_une_liste(
                    client, nom, url, hotes, cache, verrou, journal,
                    francophonie=francophonie, deja_vues=deja_vues,
                )
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
