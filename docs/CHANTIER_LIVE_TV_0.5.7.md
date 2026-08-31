# Chantier 0.5.7 — la télévision en direct

*30 août 2026. Le point 10 de la r88 était reporté ; il revient, mais **par une autre porte**. Ce
document ne construit rien : il dit ce qui est **mesuré**, ce qui est **supposé**, et ce qu'il faut
décider avant d'écrire la première ligne.*

**Rien n'est engagé tant que le feu vert n'est pas donné.**

---

## Ce qui a changé depuis la r88

La r88 s'arrêtait sur un obstacle précis : la porte intéressante était la **box de l'opérateur**, les
flux y sont multidiffusés, et une multidiffusion ne traverse pas le routeur ASUS qui sépare le NAS de
la Bbox. Tout le chantier tenait à ce réglage de routeur, et à un point d'accès `/api/v1/iptv` dont
on ne connaissait que le code de retour.

La demande d'aujourd'hui écarte cette porte : **des listes M3U et des fournisseurs identifiés par un
compte**. Ni multidiffusion, ni routage à changer, ni mot de passe de box. Le fichier `m3u.json`
fourni est déjà la matière première, et ce qu'il contient a été **mesuré** avant d'être commenté.

L'analyse de la r88 §10 n'est pas perdue pour autant : le socle qu'elle décrivait — sources, chaînes,
numéros, lecture d'un M3U, réglages en base — est exactement celui qu'il faut ici. C'est l'étape « a »
de son découpage, et elle devient l'étape 1 de celui-ci.

---

## 1. Ce qui est mesuré

### 1.1 Le fichier `m3u.json`

Relevé le 30 août 2026 sur les 535 entrées du fichier fourni.

| Mesure | Valeur |
| --- | --- |
| Listes déclarées | **535** |
| Listes qui répondent à un `HEAD` | **527** — mais voir la correction du §1.4 |
| Hébergeur | `raw.githubusercontent.com` pour 533, `iptv-org.github.io` pour 2 |
| Poids total téléchargé | **42,0 Mio** |
| Poids médian d'une liste | 49 Kio ; la plus grosse, 0,35 Mio |
| Téléchargement des 527, 16 fils | **4,1 s** |
| Analyse des 42 Mio | **0,6 s** |

### 1.2 Ce que les 527 listes contiennent

| Mesure | Valeur |
| --- | --- |
| Entrées de chaîne (`#EXTINF`) | **181 126** |
| Adresses **uniques** | **100 113** — donc **44,7 % de doublons** |
| Noms uniques | 84 309 |
| Chaînes par liste | médiane **193**, p90 936, maximum 2 518 |
| Adresse la plus répétée | présente dans **80** listes |

Les attributs, comptés sur les 181 126 entrées :

| Attribut | Présence | Ce qu'il porte |
| --- | --- | --- |
| `group-title` | **79,7 %** | le genre ou le pays — la matière du filtre |
| `tvg-logo` | **68,0 %** | le logo de la chaîne |
| `tvg-id` | 47,6 % | la clé qui relierait un guide XMLTV |
| **`tvg-chno`** | **12,7 %** | **le numéro de chaîne** |

Les transports, sur les mêmes entrées :

| Protocole | Entrées | Lisible par |
| --- | --- | --- |
| `https` | 114 213 | tous les clients |
| `http` | 65 357 | tous — **sauf une page servie en HTTPS** (voir §6.3) |
| `rtp`, `rtsp`, `rtmp`, `plugin` | **1 347** | ni le navigateur, ni Media3 |

Et les conteneurs : **116 437 en `.m3u8`** (HLS — le format que les trois lecteurs de FlixTunes savent
déjà lire), 4 382 en `.mpd` (DASH), le reste sans extension parlante.

### 1.3 Les chaînes elles-mêmes — échantillon de 250

Tirées au hasard dans 40 listes marquées « ✅ » par vos soins, sondées avec un en-tête `Origin` comme
le ferait un navigateur.

| Mesure | Valeur |
| --- | --- |
| Manifeste joignable (HTTP 200) | **220 / 250 — 88 %** |
| Échecs | 15 injoignables, 8 en `403`, 5 en `404`, 1 en `401`, 1 en `400` |
| **En-tête CORS permettant au navigateur de lire** | **197 / 220 — 90 %** |
| Chaînes en `http` nu dans l'échantillon | 63 / 250 — **25 %** |
| Latence jusqu'aux premiers octets du manifeste | p50 **835 ms**, p95 **2,0 s** |

**Réserves honnêtes sur ces chiffres.** Ils viennent de mon poste, sur une fibre, un 30 août — pas du
NAS, et la règle du projet est qu'on mesure là où ça tourne. Et un manifeste qui répond `200` **ne
prouve pas qu'une chaîne se regarde** : il reste les segments, le débit, et la durée de vie de la
source. Les 88 % sont donc un plafond, pas une promesse.

### 1.4 Ce que l'étape 1 a réellement mesuré, une fois le code écrit

Le banc `pnpm --filter @flixtunes/server test:live-corpus <m3u.json>` rejoue le rafraîchissement
complet et chronomètre la grille. Relevé sur le poste de développement, le 30 août 2026 :

| Mesure | Valeur | Écart avec l'estimation du §1.1 |
| --- | --- | --- |
| Listes qui répondent | **535 / 535** | **les 8 « mortes » n'existaient pas** |
| Entrées lues | **183 837** | +2 700 environ |
| Entrées écartées (transports illisibles) | 1 576 | conforme |
| **Chaînes après fusion** | **76 899** | — |
| Adresses conservées | 115 879 | — |
| Doublons fusionnés | **105 362, soit 57,8 %** | plus que les 44,7 % annoncés |
| Rafraîchissement complet | **21,1 s** | — |
| Poids de la base après import | 67,5 Mio | — |

*Le corpus bouge sous la mesure : deux relevés à vingt minutes d'intervalle diffèrent de quelque
mille entrées, les listes étant des fichiers vivants sur GitHub. C'est une raison de plus de refaire
la mesure sur le NAS plutôt que de reprendre ces chiffres.*

**Trois corrections, et elles vont toutes dans le même sens : le corpus est meilleur qu'annoncé.**

1. **Les 8 listes « mortes » du §1.1 étaient un artefact de la méthode.** Elles ne répondaient pas à
   un `HEAD` ; elles répondent parfaitement à un `GET`. Le sondage à l'économie mentait, et c'est un
   rappel utile : la mesure doit se faire avec la requête qu'on fera vraiment.
2. **Quelque trois mille entrées de plus qu'au premier comptage.** Le relevé initial exigeait une
   durée numérique juste après `#EXTINF:` ; les listes qui l'écrivent autrement perdaient toutes leurs
   chaînes. L'analyseur du dépôt ne l'exige pas.
3. **57,8 % de doublons et non 44,7 %.** Le premier chiffre comparait des **adresses** ; celui-ci
   compare des **chaînes**, ce qui est la bonne unité — c'est ce que la personne voit. Autrement dit :
   la réserve de repli est encore plus fournie qu'espéré.

---

## 2. Ce que ces chiffres imposent

**a. 181 126 chaînes, ce n'est pas une liste : c'est un catalogue.** La médiathèque en compte trois
ordres de grandeur de moins. La méthode de TvPourTous — tout charger en mémoire, tout mettre dans une
`ListBox`, refiltrer la collection entière à chaque frappe — ne peut pas être reprise : elle
s'écroulerait sur un boîtier Android TV bien avant le NAS. Les chaînes doivent être **indexées en base
et paginées**, exactement comme le catalogue l'est déjà.

**b. 44,7 % de doublons ne sont pas un défaut à masquer, mais une réserve à exploiter.** La même
chaîne présente dans quatre listes, ce sont quatre adresses pour un même programme. Réunies sous une
seule entrée, elles deviennent un **repli automatique** : la première refuse, on prend la suivante,
sans que la personne devant l'écran ait à savoir pourquoi. C'est la réponse la plus directe aux 12 %
de chaînes mortes de l'échantillon — et elle ne coûte rien, puisque les doublons sont déjà là.

**c. Le numéro de chaîne est absent 87 fois sur 100.** Il faudra donc l'attribuer, et non le lire.
C'est la question du §5.2, et elle se décide avant d'écrire quoi que ce soit.

**d. 1 347 chaînes ne sont lisibles par aucun de nos clients.** `rtp`, `rtsp`, `rtmp` : ni navigateur,
ni Media3. Soit on les écarte à l'entrée en le disant, soit le NAS les relaie en HLS — et cette
seconde voie est un chantier à elle seule, pour 0,7 % du corpus. **Ma recommandation : les écarter, en
les comptant**, plutôt que promettre une chaîne qui ne démarrera jamais.

**e. Le rafraîchissement est l'affaire du serveur, jamais du client.** 42 Mio et 181 000 entrées
retéléchargés par chaque téléphone à chaque démarrage, ce serait la fin de « ultra performant » avant
d'avoir commencé. Le NAS rafraîchit, indexe, déduplique ; les clients lisent l'index paginé. Le
« pourcentage au démarrage » demandé affiche donc **l'avancement d'un travail du serveur**, pas un
téléchargement du client.

---

## 3. TvPourTous : ce qui passe, ce qui ne passe pas

L'exemple a été lu en entier — 21 fichiers, l'essentiel dans `MainWindow.xaml.cs`.

| Ce qu'il fait | Reprise |
| --- | --- |
| `m3u.json`, nom → adresse | **oui** — c'est le format que vous avez, il devient le format d'import |
| Une entrée « Tout » qui fusionne les listes | **oui** — c'est la coche « toutes les listes » demandée |
| État par chaîne dans `channels_status.json` (`v` / `x`) | **l'idée oui, le fichier non** — cela va en base |
| Tri par état : actives d'abord, mortes en dernier | **oui**, et c'est un bon réflexe |
| Test HTTP `HEAD` des sources au démarrage | **oui**, avec la réserve du §1.3 : un `HEAD` ne prouve rien du flux |
| Recherche par filtre texte sur la liste | **oui**, mais indexée (§2.a) |
| Renommage des doublons en `1-`, `2-`, `3-` | **non** — ils sont fusionnés, pas numérotés (§2.b) |
| LibVLC comme lecteur | **rien à reprendre** : FlixTunes a déjà trois lecteurs qui lisent HLS |
| Serveur d'API sur le port 5000 pour changer de chaîne | **non** — non demandé, et FlixTunes a déjà son API |

**Un détail de votre fichier qui n'est pas dans le code de TvPourTous** : les noms de `m3u.json`
commencent par ✅, 〰️, ⚠️ ou ❌ — 260, 124, 75 et 76 entrées. C'est un classement fait à la main,
rangé faute de mieux dans le nom. Je propose de **le lire comme un état et de le retirer du nom** à
l'import : le classement est conservé, sans rester un préfixe qui remonte dans les recherches et dans
les titres affichés.

---

## 4. Ce que FlixTunes a déjà — et qu'il n'y a donc pas à écrire

C'est la bonne nouvelle de cet audit : **aucune brique n'est à inventer.**

| Besoin | Ce qui existe |
| --- | --- |
| Réglages de fournisseur, secrets chiffrés | `provider-settings.ts` (AES-256-GCM, clé hors base) |
| Écran de saisie d'un fournisseur | `ProviderSetup.tsx` |
| Réglage persistant en base | `getSetting` / `setSetting`, `database.ts:878` ; patron complet dans `wan-parametres.ts` |
| **Choisir un dossier du NAS depuis l'écran** | `filesystem-browser.ts` + `FolderBrowser.tsx` — exactement ce que « le json paramétrable sur dossier du serveur » demande |
| Lecture HLS, navigateur | hls.js, `Player.tsx:597` |
| Lecture HLS, Android | `media3-exoplayer-hls`, déjà déclaré |
| Lecture HLS, bureau | VLC, via la surface de lecture de la r86 |
| Démarrage à étapes avec pourcentage | `StartupStep`, `MainViewModel.kt:47` — une étape `LIVE_TV` s'y insère après `MEDIATHEQUE`, ce qui est le placement demandé |
| Sections de navigation | `Sections.kt:26` (Android), `App.tsx:893` (Web) — l'entrée se pose après « Séries TV » |
| Catalogue paginé et filtré | `GET /api/catalog/browse`, `routes.ts:1163` |
| Filtres à cocher façon « genres » | déjà en place dans le catalogue — c'est le modèle demandé pour les listes de lecture |
| Navigation à la télécommande | `remote-navigation.ts`, `NavigationTelevision.kt` |

Le travail est donc d'**assembler**, pas de fonder. C'est ce qui rend l'estimation tenable malgré la
taille du sujet.

---

## 5. Les fournisseurs

Vous demandez « tout provider que tu vois pertinent ». Les voici classés par rapport entre ce qu'ils
rapportent et ce qu'ils coûtent, avec un avis franc sur chacun.

| | Fournisseur | Identifiant | Apport | Coût | Avis |
| --- | --- | --- | --- | --- | --- |
| 1 | **M3U perso** | un fichier ou une adresse | la base ; tout le reste en dérive | — | **demandé, et socle de tout** |
| 2 | **Xtream Codes** | hôte + utilisateur + mot de passe | catégories, **numéros**, guide, le tout par une API JSON | faible | **le meilleur rapport** — c'est littéralement « via identifiant » |
| 3 | **Listes publiques FAST** (Pluto TV, Samsung TV Plus, Rakuten) | aucun | chaînes gratuites et légales, stables, françaises | faible | **oui** — et c'est ce qu'un nouvel arrivant verra en premier |
| 4 | **XMLTV** (le guide) | une adresse | transforme une liste de noms en téléviseur | **moyen à élevé** | **chantier à part** — §5.3 |
| 5 | **HDHomeRun** (tuner TNT réseau) | découverte automatique | la vraie TNT, sans zone grise, API locale documentée | moyen | **oui si vous en avez un** ; sinon, sans objet |
| 6 | **Portail Stalker / Ministra** | une adresse MAC | très répandu chez les abonnements | moyen | **je le déconseille** : protocole non documenté qui change ; c'est la dette dont parlait la r88 |
| 7 | **Box opérateur** | mot de passe de la box | numéros fournis, qualité opérateur | **élevé** | **hors périmètre** — l'analyse r88 §10 tient : multidiffusion et routage |

**Ma recommandation pour 0.5.7r1 : les numéros 1, 2 et 3.** Ils couvrent « le M3U perso » demandé,
« l'identifiant » demandé, et donnent une entrée qui fonctionne sans rien configurer. Le 5 se branche
en une soirée le jour où un tuner apparaît sur le réseau.

### 5.1 Cumuler, ou n'en choisir qu'un

Demandé : « pouvoir les cumuler ou n'en mettre qu'un, mais ouvre une fenêtre de choix du provider si
plusieurs ». Traduit dans FlixTunes : les sources cohabitent dans une seule liste de chaînes, et un
sélecteur en tête d'écran dit **d'où** l'on regarde — « Tous », puis chaque fournisseur. Avec une
seule source réglée, le sélecteur ne s'affiche pas : il n'aurait qu'une entrée.

Le second niveau — cocher **quelles listes de lecture** à l'intérieur du M3U perso — reprend
exactement le composant des genres du catalogue, comme demandé.

### 5.2 Les numéros de chaîne

Trois sources possibles pour un même numéro, et il faut dire qui gagne :

1. `tvg-chno` de la liste — présent **12,7 %** du temps ;
2. l'ordre du fournisseur — Xtream le donne, un M3U l'a implicitement ;
3. une correction à la main.

**Ma proposition :** la correction manuelle l'emporte toujours ; sinon `tvg-chno` ; sinon un numéro
attribué à la première indexation et **stable ensuite** — un numéro qui change au rafraîchissement
serait pire que pas de numéro du tout. À valider (§8.3).

### 5.3 Le guide des programmes

Sans lui, une chaîne est un nom et un logo. Avec lui, c'est un téléviseur : ce qui passe maintenant,
ce qui suit, une grille. `tvg-id` est présent sur 47,6 % des entrées — assez pour que cela vaille le
coup, pas assez pour que ce soit gratuit.

**C'est un chantier au moins aussi gros que tout le reste réuni** : un XMLTV national pèse des
centaines de mégaoctets, se rafraîchit chaque jour, et il faut le ranger, le purger et l'interroger
sur un Celeron. Je recommande de **le sortir de 0.5.7r1** et d'en faire l'étape suivante — mais de
poser dès maintenant le `tvg-id` en base, pour ne pas avoir à tout réindexer le jour venu.

---

## 6. L'architecture proposée

### 6.1 En base

Quatre tables, dans l'esprit de celles du catalogue :

- `live_sources` — un fournisseur réglé : type (`m3u`, `xtream`, `fast`), libellé, adresse ou dossier,
  état, date du dernier rafraîchissement, compteurs.
- `live_playlists` — une liste de lecture à l'intérieur d'une source M3U : c'est l'unité que l'on
  coche. Elle porte le classement ✅/〰️/⚠️/❌ lu à l'import.
- `live_channels` — la chaîne **dédupliquée** : nom normalisé, logo, groupe, `tvg-id`, numéro, état.
- `live_channel_urls` — les N adresses d'une chaîne, ordonnées, chacune rattachée à sa liste d'origine.
  C'est la table qui rend le repli du §2.b possible, et qui retient quelle adresse a marché la
  dernière fois.

Plus un index de recherche sur le nom, du même type que celui du catalogue — c'est lui qui rend la
recherche instantanée sur 181 000 entrées au lieu d'un balayage.

### 6.2 Le rafraîchissement

Déclenché à trois moments : à l'enregistrement d'une source, sur demande explicite, et au démarrage du
serveur **si la fonction est activée**. Jamais par un client.

Il expose son avancement sur l'API des travaux qui existe déjà, ce qui donne gratuitement le
pourcentage demandé à l'écran de démarrage — après la médiathèque, comme vous le décrivez.

### 6.3 La lecture

Une chaîne est une adresse HLS : les trois lecteurs savent déjà la lire. **Le chemin par défaut est la
lecture directe** — le NAS ne touche à rien, ne réencode rien, ne relaie rien. C'est ce qui rend
l'objectif « ultra performant » atteignable sur un Celeron : le coût d'une chaîne pour le NAS est
**nul**.

Le relais par le NAS n'intervient que dans les deux cas mesurés au §1.3 :

- **les 10 % de chaînes sans en-tête CORS**, qu'un navigateur refuse de lire directement ;
- **les chaînes en `http` nu — 25 % de l'échantillon — quand la page est servie en HTTPS**,
  c'est-à-dire par l'accès distant. Le navigateur bloque le contenu mixte, et aucun réglage ne le
  contourne.

Android et le client de bureau n'ont ni l'une ni l'autre de ces contraintes : ils lisent tout en
direct. Le relais est donc une **rustine pour le navigateur**, activée chaîne par chaîne au vu de ce
qui a été constaté, et non un passage obligé.

### 6.4 Android TV : le numéro à la télécommande

Demandé, et c'est le geste qui distingue un téléviseur d'une grille d'icônes. Composer un chiffre sur
la télécommande ouvre une surimpression — le numéro en cours de saisie, puis le nom de la chaîne visée
dès qu'elle est déterminée — et valide au bout d'un délai court ou sur OK. Les touches P+/P− et les
flèches en lecture passent à la chaîne voisine.

Le budget à tenir sur ce geste est au §7.

---

## 7. « Ultra performant » : ce que cela veut dire, chiffré

Un objectif qui ne se mesure pas ne s'atteint pas. Voici ce que je propose de tenir, et comment le
vérifier — **sur le NAS et sur le boîtier TV**, pas sur mon poste.

| Ce qui se mesure | Cible | Comment |
| --- | --- | --- |
| Ouvrir l'écran Live TV | **< 300 ms** jusqu'à la première grille | l'index est paginé, rien n'est chargé d'avance |
| Frappe → liste filtrée | **< 100 ms** | index de recherche, pas de balayage |

### Où en est la mesure après l'étape 1

Sur le poste de développement, base de 78 741 chaînes, trois passages retenus :

| | Première écriture | Après l'index de l'étape 1 |
| --- | --- | --- |
| Première grille | 96,2 ms | **0,4 ms** |
| Recherche « tf1 » | 191,4 ms | **0,2 ms** |
| Recherche « can » | 193,9 ms | **3,5 ms** |
| Page à 30 000 chaînes | 116,9 ms | 35 ms |

### Et ce que les filtres ont réglé, que l'index ne pouvait pas régler

Le temps n'était que la moitié du problème. Chercher « canal » rendait **1 141 chaînes**, et le
constat qui a fait changer d'approche est que **tous ces résultats étaient justes** : *canal* est le
mot espagnol et portugais pour « chaîne ». Aucun classement par pertinence ne répare cela — il
manquait une dimension.

| Ce qu'on tape | Sans filtre | Avec le pays « France » |
| --- | --- | --- |
| « canal » | 1 141 | **17** |
| « canal + » | **66** (le signe compte désormais) | 13 |

Trois filtres, et un retiré :

- **le pays**, déduit du `tvg-id`, d'un drapeau ou d'un nom reconnu — **32,5 % des chaînes** en
  reçoivent un, dont **1 081 françaises** ;
- **les listes**, cochées comme les genres du catalogue, mais repliées : 499 ne tiennent pas à plat ;
- **la fiabilité**, qui est la mesure que le script de `m3u.json` avait déjà faite et qu'on ignorait —
  ✅ vaut « 75 % des flux répondent », ❌ « 25 à 49 % », et **non « morte »** comme on l'avait d'abord
  enregistré. *(Le script a été corrigé depuis : `❌` marque les listes sous 25 % et `⚠️` celles de
  25 à 49 %, et la part se compte en chaînes fusionnées. Voir `tools/tv_playlist_checker.py`.)* ;
- **le bouquet, retiré** : il exposait les `group-title` bruts, c'est-à-dire le vocabulaire de cinq
  cents auteurs différents.

Deux causes, toutes deux mesurées avant d'être corrigées. Le tri portait `numero IS NULL` en tête —
une **expression**, donc un tri complet des 78 741 lignes à chaque page, pour départager un cas qui
n'existe pas (toute chaîne affichée a un numéro). Et la recherche était un `LIKE '%…%'`, qui ne
s'indexe pas : elle est passée à **FTS5**, présent dans le SQLite de Node, reconstruit une fois par
rafraîchissement plutôt qu'entretenu par des déclencheurs.

Ce changement a une conséquence visible qu'il vaut mieux annoncer : FTS cherche par **préfixe de
mot**. « can » trouve « Canal+ » et « TV Cannes », mais plus « Toucan » — 1 464 résultats au lieu de
1 803. C'est le bon compromis pour des noms de chaînes, et c'est ce qui rend la recherche
indépendante de la taille du corpus.

La pagination profonde reste en `LIMIT/OFFSET`, donc proportionnelle au décalage : 37 ms à la
trente-millième chaîne. Personne n'y arrive en tournant les pages, et l'index alphabétique du
catalogue y mènera directement — mais c'est le seul chiffre du tableau qui grandira avec le corpus,
et il est noté pour cela.
| Numéro composé → première image | **< 2 s** | chronométré sur dix chaînes ; le p95 du §1.3 est déjà à 2,0 s pour le seul manifeste — ce plafond est donc **serré et honnête** |
| Chaîne morte → repli joué | **< 3 s**, sans message d'erreur | le repli du §2.b |
| Rafraîchissement complet des 527 listes | **à mesurer sur le NAS** | 4,7 s sur mon poste ; le Celeron et son réseau décideront |
| Mémoire du client pendant la navigation | ne croît pas avec la taille du corpus | conséquence directe du §2.a |
| Processeur du NAS pendant une lecture directe | **nul** | §6.3 |

### La règle qui s'applique à cette fonction

Comme le repérage des génériques et comme l'import IMDb : **la télévision en direct s'active**.
Désactivée au départ, réglage en base, arrêt net. Tant qu'aucune source n'est réglée, l'entrée de menu
n'existe pas — ce qui est exactement ce que vous demandez — et **rien ne tourne** : ni téléchargement,
ni indexation, ni rafraîchissement au démarrage.

---

## 8. Ce qu'il faut décider avant l'étape 1

Huit questions. Aucune n'est de forme : chacune change le code.

1. **Où vit `m3u.json` sur le NAS**, et à quelle fréquence le relire. Le sélecteur de dossier existe
   déjà (§4) ; il manque le chemin et la cadence.
2. **Les doublons : fusionnés en repli, ou laissés distincts ?** Ma recommandation est la fusion
   (§2.b). C'est le choix qui a le plus d'effet sur ce qu'on ressent à l'usage.
3. **Qui gagne pour le numéro de chaîne** (§5.2).
4. **Le classement ✅/〰️/⚠️/❌ de vos noms** : le lire comme un état et le retirer du nom, comme je le
   propose — ou le laisser tel quel ?
5. **L'état d'une chaîne : à la main, mesuré, ou les deux ?** TvPourTous le tenait à la main. Le sonder
   automatiquement veut dire 100 113 requêtes, ce qui ne se fait pas d'un bloc. Ma proposition : on
   retient ce qui s'est passé à la lecture — une chaîne qui a joué monte, une qui a échoué descend —,
   et un bouton sonde une liste choisie, à la demande.
6. **Le guide des programmes** dans 0.5.7r1, ou à l'étape suivante ? Ma recommandation : à l'étape
   suivante (§5.3).
7. **Les fournisseurs retenus** parmi les sept du §5. Ma recommandation : 1, 2 et 3.
8. **La recherche** : les chaînes remontent-elles dans la recherche générale de FlixTunes, à côté des
   films et des séries, ou seulement à l'intérieur de l'écran Live TV ? Vous écrivez « pouvoir
   rechercher, mais ça pour tout provider », ce que je lis comme « toutes sources confondues à
   l'intérieur du Live TV ». À confirmer : 181 000 chaînes dans la recherche générale y noieraient la
   médiathèque.

**Non demandé, et donc écarté sauf avis contraire :** l'enregistrement, le différé, le contrôle du
direct.

---

## 9. Découpage proposé

**La génération a lieu une fois, à la fin de toutes les étapes** — décidé le 30 août 2026. Les étapes
intermédiaires ne produisent pas de paquet : leur travail va dans l'entrée en cours du journal, et
l'APK Android comme l'APKG ASUSTOR sortent ensemble quand l'ensemble est là.

| Étape | Contenu | Ce qui se voit à la fin |
| --- | --- | --- |
| **1** ✅ | Le modèle : tables, import d'un `m3u.json`, déduplication, index de recherche. Réglages en base, dossier choisi à l'écran. | **Fait.** 535 listes, 76 899 chaînes, 21,1 s — sur le poste ; reste à refaire sur le NAS |
| **2** ✅ | L'écran Live TV du **Web** — la référence graphique — après « Séries TV », et seulement si une source est réglée. Grille, sélecteur de source, coches de listes, recherche. | **Fait.** Vérifié à l'écran sur le corpus réel |
| **3** ✅ | La lecture : direct par défaut, repli sur les adresses de secours, relais du navigateur pour les cas du §6.3. | **Fait.** Arte en 1080p, lecture directe, coût NAS nul |
| **4** ✅ | Le rafraîchissement au démarrage avec son pourcentage, après la médiathèque. | **Fait.** Cadence de douze heures, étape `DIRECT` entre la médiathèque et les affiches |
| **5** ✅ | **Android** — mobile et TV — aligné sur le Web. Grille, sélecteur, recherche. | **Fait.** Section conditionnelle, grille paginée, trois filtres repliables |
| **6** ✅ | La télécommande : numéro composé, P+/P−, surimpression. | **Fait.** Chiffres composés, validation après 1,5 s, P+/P− qui bouclent |
| **7** ✅ | Xtream Codes et les listes FAST, sur le socle de l'étape 1. | **Fait.** Un portail = une adresse M3U ; rien d'autre n'a bougé |
| **(8)** | Le guide XMLTV — **si décidé** (§5.3). | Une grille de programmes |

Les étapes 1 à 6 forment un tout cohérent : à la fin de la 6, la demande est tenue pour le M3U perso
sur les trois surfaces. La 7 ajoute les fournisseurs identifiés sans rien remettre en cause.

---

## 10. Les risques, nommés

- **La durée de vie des sources.** 8 listes sur 535 sont déjà mortes, et 12 % des chaînes sondées ne
  répondent pas. Ce corpus se dégrade tout seul, sans que rien chez nous ne change. Le repli du §2.b et
  l'état du §8.5 sont les deux réponses ; il n'y en a pas de troisième.
- **La mesure sur le NAS reste à faire.** Tous les temps de ce document viennent de mon poste. Le
  Celeron et son réseau peuvent multiplier le rafraîchissement par cinq sans que cela change les
  conclusions — mais cela changerait le §7, et c'est pourquoi l'étape 1 se termine par une mesure.
- **Le contenu mixte en accès distant** (§6.3) est le seul point où une part du corpus devient
  inaccessible sans travail du serveur. Il est mesuré à 25 % de l'échantillon, et il ne concerne que le
  navigateur.
- **Le guide des programmes est plus gros qu'il n'en a l'air**, et c'est la seule partie du sujet qui
  pourrait, à elle seule, doubler le chantier.
