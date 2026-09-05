# FlixTunes 0.5.7

FlixTunes est un serveur multimédia auto-hébergé conçu pour un NAS, accompagné de clients pour le
Web, le bureau — Windows et Linux —, Android TV et Android mobile. Vos fichiers restent où ils sont :
le serveur ne déplace ni ne renomme rien, il se contente de les cataloguer et de les servir.

Tout tient dans un seul processus Node et un fichier SQLite. Aucune base de données à administrer,
aucun service tiers obligatoire, aucune donnée envoyée ailleurs que chez vous.

## Ce que fait FlixTunes

### Médiathèque

- **Bibliothèques typées** — Films, Séries TV, Autre, ou détection automatique — chacune avec son
  chemin, sa langue de fiches et son propre rythme d'analyse.
- **Analyse récursive** des conventions usuelles : `Titre (2024)`, `S01E02`, `1x02`, dossiers
  `Saison N`, épisodes doubles, hors-séries. Les ajouts, suppressions et remplacements sont détectés
  sans tout relire.
- **Lecture des fichiers par FFprobe** : conteneur, durée, pistes vidéo, audio et sous-titres, langues,
  chapitres, métadonnées embarquées.
- **Enrichissement TMDB facultatif** pour films, séries, saisons, épisodes et personnes, avec repli sur
  l'anglais quand le français manque. Sans jeton, le catalogue se construit à partir des noms de
  fichiers et des métadonnées embarquées.
- **Jaquettes et fonds mis en cache par le serveur** : le client ne contacte jamais TMDB directement.
- **Correction manuelle des correspondances**, verrouillable, prioritaire sur les analyses suivantes,
  avec prévisualisation et annulation.
- **Fiches complètes** : distribution et équipe, filmographie par personne, genres, collections,
  saisons et épisodes, versions multiples d'un même titre.

### Lecture

- **Négociation en trois temps** selon ce que le client déclare savoir lire :
  **Direct Play** avec requêtes `Range`, **remux HLS fMP4** quand seul le conteneur ou l'audio gêne,
  **transcodage HLS** en dernier recours.
- **Pistes audio et sous-titres** sélectionnables, extraction WebVTT, incrustation des sous-titres
  image, préférences de langue par profil.
- **Traitement de la couleur** : primaires, matrice, transfert, plage, profondeur et métadonnées de
  mastering sont relevés, y compris quand ils ne sont portés que par les SEI d'image. Le flux est
  conservé tel quel dès que la chaîne l'accepte ; sinon une couche rétrocompatible est cherchée avant
  toute conversion, et la perte éventuelle est annoncée **avant** la lecture.
- **Accélération matérielle** NVENC, Quick Sync, VA-API, AMF ou V4L2 M2M, avec repli logiciel
  automatique si l'encodeur matériel échoue.
- **Reprise de lecture, marque « terminé », lecture automatique de l'épisode suivant**, vitesse de
  lecture, minuteur d'arrêt.
- **Détection et saut des génériques** : chapitres nommés du fichier, déduction à partir des épisodes
  voisins d'une même saison, et reconnaissance par empreinte sonore du thème d'ouverture. La fonction
  est **désactivée par défaut** et s'active explicitement ; elle travaille en arrière-plan, à un fil
  et à la priorité la plus basse, et s'efface devant toute lecture en cours.

### Télévision en direct

- **Import de listes M3U** — fichiers, portails, adresses publiques — avec fusion des doublons,
  regroupement des sources d'une même chaîne et écart des entrées inexploitables.
- **Classement par pays**, chaînes françaises en tête, numérotation stable inspirée du plan TNT, et
  déduction du pays à partir d'une table de référence publique quand la liste ne le dit pas.
- **Mesure de fiabilité par liste et par adresse**, alimentée par les lectures réelles : une source
  qui ne répond pas recule, une source qui tient remonte.
- **Bascule automatique entre sources** en cas d'instabilité, avec fenêtre glissante surveillée pour
  éviter de sortir du direct, rattrapage progressif plutôt que sauts d'image, et choix manuel de la
  source à tout moment.
- **Favoris, filtres par pays, par liste et par fiabilité, reprise de la dernière chaîne**.

### Profils et usages

- **Groupes de profils** : plusieurs foyers ou plusieurs familles sur un même serveur, historiques
  strictement séparés.
- **Profils individuels** avec langue, préférences audio et sous-titres, normalisation sonore, mode
  nuit, priorité de plage dynamique, et protection par code.
- **Profils enfants** : classification d'âge appliquée **côté serveur**, un contenu trop élevé n'est
  jamais envoyé au client.
- **Recommandations** tirées de l'historique, avec retour explicite pour les corriger.
- **Ma liste**, historique récent, contenus déjà vus, reprise en cours.
- **Télécommande** : un appareil s'annonce sur le réseau local, un autre lui adresse des ordres —
  utile pour piloter un téléviseur depuis un téléphone.

### Clients

- **Web** : interface responsive et installable en PWA, pensée aussi bien pour la télécommande que
  pour le tactile.
- **Android mobile et Android TV** : une seule application qui s'adapte, lecture Media3/ExoPlayer,
  navigation au pavé directionnel, découverte automatique du serveur sur le réseau local.
- **Bureau Windows et Linux** : l'application **porte l'interface du client Web** — mêmes écrans,
  mêmes réglages — et confie la lecture à un **VLC embarqué**. Le NAS n'a donc plus à convertir les
  conteneurs et codecs qu'un navigateur refuse.

### Exploitation du serveur

- **Capacité mesurée, pas devinée** : au démarrage, chaque accélérateur compilé est éprouvé par un
  micro-banc non destructif, et n'est retenu que s'il tient au moins 80 % du débit logiciel. Un pilote
  présent mais plus lent que le processeur est écarté plutôt qu'imposé. Le résultat est conservé et
  refait quand FFmpeg change.
- **Budget de sessions** : chaque lecture reçoit un coût estimé ; une lecture directe coûte zéro et
  n'est jamais refusée. Quand le budget approche de sa limite, une définition plus basse est proposée
  avant tout refus, et un refus explique sa raison.
- **Travaux de fond effaçables** : analyses et détections cèdent la place aux lectures et reprennent
  ensuite, sans repartir de zéro.
- **Sauvegardes et restauration** de la base, inventaire des médias, métriques, journal et diagnostic.
- **Accès distant** optionnel, avec comptes dédiés, vérification de l'exposition et journal des accès.
  Sans lui, le serveur ne répond que sur le réseau local.

## Démarrage

Prérequis en développement : Node.js 24+, pnpm 11+ et FFmpeg dans le `PATH`. Sur NAS, l'image Docker
apporte Node et FFmpeg.

```powershell
Copy-Item .env.example .env
pnpm install
pnpm dev
```

En développement, l'interface est sur `http://localhost:5173` et l'API sur `http://localhost:4000`.
En production, le serveur sert les deux sur le port 4000.

> **Sous Windows, n'installez pas `node_modules` sur un partage réseau.** Les milliers de petits
> fichiers y sont très lents et les liens d'espace de travail peuvent être refusés. Développez et
> construisez sur un disque local, puis déployez. Sur le NAS, installez dans son système de fichiers
> local ou dans un conteneur à volumes locaux.

Au premier lancement, rien n'est préconfiguré : l'assistant demande au moins une bibliothèque — un
nom, un chemin, un type, une langue. Ces choix vivent ensuite dans la base du serveur.

À chaque démarrage, une analyse incrémentale part en arrière-plan pour chaque bibliothèque, sans
rendre le serveur indisponible. Deux actions distinctes existent par bibliothèque :

- **Scanner les fichiers** — détecter ajouts, suppressions et changements ;
- **Actualiser les métadonnées** — redemander titres, synopsis et images même pour l'existant.

## Métadonnées

Renseignez `TMDB_ACCESS_TOKEN` pour activer l'enrichissement. La langue se choisit **par
bibliothèque** ; en français, les textes et images anglais servent de repli. Les images sont
téléchargées dans `FLIXTUNES_DATA_DIR/artwork`. Les identifiants IMDb fournis par TMDB sont conservés.

Une mauvaise identification se corrige dans **Gérer les bibliothèques → Correspondances**. Le choix
manuel est verrouillé et l'emporte sur les analyses suivantes, sans jamais toucher au fichier.

Exemples de rangement reconnus :

```text
Films/Arrival (2016)/Arrival.2016.1080p.mkv
Series/Severance/Saison 01/Severance.S01E01.mkv
Series/Severance/S02E03 - Titre.mkv
```

## Construire une livraison

```powershell
.\tools\Build-Release.ps1
```

La version et la révision viennent du premier titre de [CHANGELOG.md](CHANGELOG.md) et sont recoupées
avec `package.json` : une livraison ne peut pas porter un numéro que le journal ne documente pas. Le
script refuse de s'exécuter depuis un partage réseau, lance les tests de tous les clients, et
estampille chaque paquet du **même** numéro. Les fichiers arrivent dans `artifacts/`.

`tools/Sync-Version.ps1` propage la version vers les contrats, les clients, l'image Compose, ce README
et le Dockerfile ; un test échoue si l'un d'eux dérive.

## Publier une livraison

```powershell
.\tools\Publier-Release.ps1 -Brouillon
```

Publie sur GitHub l'ensemble des fichiers d'une même estampille — clients, paquets serveur, sources
NAS, empreintes SHA-256 — avec pour description le bloc `<!-- release -->` de l'entrée correspondante
du journal. L'étiquette vise le commit exact, et le script vérifie qu'il est présent sur le dépôt
distant **avant** tout téléversement. L'authentification passe par GitHub CLI et reste locale.

Publier est un geste séparé de construire : le premier est sans conséquence, le second est public et
ne se reprend pas.

## Installation sur un serveur

Les installations Windows, Linux, NAS natif, Docker et ASUSTOR, ainsi que la mise à jour sans perte de
données, sont décrites dans [SERVER_INSTALLATION.md](docs/SERVER_INSTALLATION.md). Le montage des
dossiers et le lancement par Compose sont dans [NAS_DEPLOYMENT.md](docs/NAS_DEPLOYMENT.md).

## Vérifier

```powershell
pnpm test                                  # tous les paquets
pnpm --filter @flixtunes/server test:ffmpeg   # médias réels : Direct Play, remux, transcodage
```

Le second génère un fichier multi-pistes puis éprouve les trois chemins de lecture de bout en bout.

## Documentation

| | |
| --- | --- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | comment les morceaux s'articulent |
| [CODEC_MATRIX.md](docs/CODEC_MATRIX.md) | ce que chaque client sait lire |
| [SERVER_INSTALLATION.md](docs/SERVER_INSTALLATION.md) | installer et mettre à jour un serveur |
| [NAS_DEPLOYMENT.md](docs/NAS_DEPLOYMENT.md) | déploiement Docker sur NAS |
| [SECURITY.md](docs/SECURITY.md) | exposition, comptes distants, surface d'attaque |
| [ROADMAP.md](docs/ROADMAP.md) | ce qui vient ensuite |
| [CHANGELOG.md](CHANGELOG.md) | ce qui a changé, et pourquoi |

## Licence et marque

FlixTunes est distribué sous GPL v3. Le VLC embarqué reste sous GPL v2 ou ultérieure, et sa licence
voyage avec lui.

L'identité visuelle et la signature sonore sont originales. Le produit ne reproduit ni le logo, ni le
son de démarrage, ni l'habillage d'un service existant.
