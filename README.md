# FlixTunes 0.5.6

FlixTunes est un serveur multimédia auto-hébergé conçu pour un NAS, accompagné de clients modernes pour le Web, Windows, Android TV et Android mobile.

Le premier jalon fournit :

- une API locale Fastify + SQLite sans serveur de base de données externe ;
- des bibliothèques typées Films, Séries TV, Autre ou à détection automatique ;
- le scan récursif des films et séries (`Titre (2024)`, `S01E02`, `1x02`, dossiers `Saison N`) ;
- l'analyse FFprobe des tags, de la durée et des langues audio/sous-titres ;
- l'enrichissement facultatif par TMDB pour films, séries, saisons et épisodes ;
- les jaquettes françaises/anglaises mises en cache et servies uniquement par le NAS ;
- la correction manuelle et verrouillable d'une correspondance TMDB ;
- la négociation Direct Play → remux HLS → transcodage HLS avec FFmpeg ;
- la sélection audio/sous-titres, l'extraction WebVTT et l'incrustation des pistes image ;
- la détection HDR10, HDR10+, HLG, Dolby Vision, Dolby Atmos, DTS:X et Auro-3D ;
- les profils locaux, la progression de lecture et l'état « terminé » ;
- un historique strictement isolé par profil, avec création, suppression et langue propre ;
- la recherche côté serveur et les fiches films/séries avec saisons et épisodes ;
- une interface web responsive et installable (PWA), pensée télécommande et tactile.
- une application Android mobile et Android TV adaptative, avec Media3, D-pad et découverte du serveur local.
- une application Windows x64 autonome avec libVLC, détection mDNS, HDR, sortie audio déclarée et sélection des pistes — **client expérimental**, réseau local seulement, voir [apps/windows/README.md](apps/windows/README.md) ;
- un déploiement NAS Docker/Compose avec surveillance des dossiers, sauvegardes, restauration et diagnostic.

## Construire une livraison

```powershell
.	ools\Build-Release.ps1
```

La version et la révision viennent du premier titre de [CHANGELOG.md](CHANGELOG.md) et sont recoupées
avec `package.json` : une livraison ne peut pas porter un numéro que le journal ne documente pas. Le
script refuse de s'exécuter depuis un partage réseau — pnpm n'y crée pas ses liens symboliques —, il
lance les tests des quatre clients, et estampille l'APK et le paquet ASUSTOR du **même** numéro.

`tools/Sync-Version.ps1` propage la version depuis `package.json` vers les contrats, le client
Windows, l'image Compose, ce README et le Dockerfile. Un test échoue si l'un d'eux dérive.

## Démarrage

Prérequis en développement : Node.js 24+, pnpm 11+ et FFmpeg dans le `PATH`. Sur NAS, Docker Compose installe Node et FFmpeg dans l’image.

```powershell
Copy-Item .env.example .env
pnpm install
pnpm dev
```

En développement, ouvrez `http://localhost:5173` et l’API écoute sur `http://localhost:4000`. En production, le serveur sert directement l’interface et l’API sur le port 4000.

> Sous Windows, évitez d'installer `node_modules` directement sur un lecteur SMB : les milliers de petits fichiers rendent l'opération très lente et les liens workspace peuvent être refusés. Développez et construisez sur un disque local NTFS, puis déployez le build. Sur le NAS, exécutez l'installation dans son système de fichiers local ou dans un conteneur avec volumes locaux.

Au premier lancement, aucun chemin n'est préconfiguré. L'assistant demande au moins une bibliothèque avec :

- son nom ;
- le chemin réseau ou local ;
- le type Films, Séries TV, Autre ou Détection automatique ;
- la langue française ou anglaise des titres, synopsis et affiches.

Ces choix sont ensuite conservés dans la base du serveur. FlixTunes ne déplace et ne renomme aucun fichier. Il range films, séries, saisons et épisodes uniquement dans son catalogue.

À chaque démarrage du serveur, un scan incrémental est placé en arrière-plan pour chaque bibliothèque enregistrée. Le serveur reste disponible pendant l'analyse. Dans **Gérer les bibliothèques**, chaque entrée possède deux actions distinctes :

- **Scanner les fichiers** : détecter les ajouts, suppressions et changements ;
- **Actualiser les métadonnées** : redemander titres, synopsis et images même pour les fichiers inchangés.

```powershell
$libraryId = "identifiant-de-la-bibliothèque"
Invoke-RestMethod -Method Post "http://localhost:4000/api/libraries/$libraryId/scan"
```

## Métadonnées

Créez un jeton d'accès TMDB et renseignez `TMDB_ACCESS_TOKEN`. Sans jeton, le scanner fonctionne avec les noms de fichiers, les dossiers et les métadonnées intégrées. La langue est définie séparément pour chaque bibliothèque. En français, les images et textes anglais servent de repli. Les affiches sont téléchargées dans `FLIXTUNES_DATA_DIR/artwork` : le client ne contacte jamais TMDB directement. Les identifiants IMDb présents dans TMDB sont conservés quand ils sont disponibles.

Une mauvaise identification se corrige dans **Gérer les bibliothèques → Correspondances**. Le choix manuel est verrouillé et reste prioritaire lors des scans suivants, sans déplacer ni renommer le média.

Exemples de rangement reconnus :

```text
Movies/Arrival (2016)/Arrival.2016.1080p.mkv
TV/Severance/Season 01/Severance.S01E01.mkv
TV/Severance/S02E03 - Who Is Alive.mkv
```

## Lecture

Le client annonce au serveur ses conteneurs, codecs, limites de définition/débit, formats HDR et capacités audio. FlixTunes choisit ensuite le chemin le moins coûteux :

1. **Direct Play** avec requêtes `Range` si le fichier entier est compatible ;
2. **Remux HLS fMP4** si la vidéo peut être copiée mais que le conteneur ou la piste audio doit changer ;
3. **Transcodage HLS** avec tone mapping HDR vers SDR si nécessaire.

`FLIXTUNES_HW_ACCEL=auto` tente NVENC, Quick Sync ou AMF et revient automatiquement à `libx264` si l'encodeur matériel échoue au démarrage. VA-API est activable explicitement sur Linux. L'état détecté est visible via `GET /api/system/playback`.

### Capacité du serveur

Au démarrage, FlixTunes essaie réellement chaque accélérateur compilé — NVENC, Quick Sync, VA-API, AMF, V4L2 M2M — par un micro-banc non destructif de quatre secondes encodées vers `null`. Un accélérateur n'est retenu que s'il soutient au moins 80 % du débit de l'encodage logiciel : un pilote présent mais plus lent que le processeur est écarté au lieu d'être imposé. Le calibrage est conservé entre les redémarrages et refait dès que la version de FFmpeg ou la liste des accélérateurs change.

Chaque session se voit attribuer un coût estimé, en unités valant un transcodage 1080p à 25 images par seconde. Une lecture directe coûte zéro et n'est jamais refusée. Quand le budget est atteint, une définition plus basse est proposée avant tout refus, et un refus explique la raison. Les analyses de bibliothèque cèdent la place : un seul travailleur dès qu'une conversion tourne, aucun quand le budget est presque saturé, reprise automatique ensuite.

`FLIXTUNES_TRANSCODE_HEADROOM` fixe la part de la capacité mesurée offerte aux conversions ; le reste protège l'interface, les analyses et les lectures directes. `GET /api/system/capacity` et le tableau « capacité de mon serveur » dans le diagnostic exposent processeur, mémoire, température, débit mesuré par accélérateur, sessions simultanées soutenables et alertes accompagnées d'une action. Les mesures sont dans [VALIDATION_0.4.9.md](docs/VALIDATION_0.4.9.md).

### Couleur et HDR

FlixTunes relève pour chaque piste vidéo les primaires, la matrice, le transfert, la plage, la position chroma, le sous-échantillonnage, la profondeur, la rotation et l'entrelacement, ainsi que le mastering display et MaxCLL/MaxFALL — y compris lorsque ces derniers ne sont portés que par les SEI d'image.

Le flux est conservé tel quel dès que la chaîne complète l'accepte. Sinon le serveur cherche d'abord une couche de base rétrocompatible — un Dolby Vision profil 8.1 est lu en HDR10 sur un téléviseur HDR10, un 8.4 en HLG, un HDR10+ en HDR10 — avant d'envisager une conversion. Un profil 5, qui n'expose aucune couche rétrocompatible, est converti en SDR et la perte est annoncée avant la lecture. La chaîne retenue est détaillée pas à pas dans « Infos lecture » et dans le diagnostic serveur.

`FLIXTUNES_TONEMAP=auto` choisit libplacebo/Vulkan lorsqu'il est disponible et retombe sinon sur zscale en logiciel. `vaapi` et `opencl` restent sur décision explicite tant qu'ils n'ont pas été mesurés sur le NAS visé ; toute panne du chemin matériel relance la session en logiciel. Les mesures de fidélité colorimétrique sont dans [VALIDATION_0.4.8.md](docs/VALIDATION_0.4.8.md).

Le test réel, qui génère un média multi-audio puis vérifie Direct Play, remux et transcodage, se lance avec :

```powershell
pnpm --filter @flixtunes/server test:ffmpeg
```

## Livraison NAS et clients

Le guide [NAS_DEPLOYMENT.md](docs/NAS_DEPLOYMENT.md) décrit le montage des dossiers et le lancement Compose. Les clients Android et Windows sont produits dans `artifacts/` par `tools/Build-Release.ps1`. Les capacités de lecture sont détaillées dans [CODEC_MATRIX.md](docs/CODEC_MATRIX.md) et la recette finale dans [VALIDATION_0.2.0.md](docs/VALIDATION_0.2.0.md).

Les installations automatisées Windows, Linux, NAS natif, Docker et ASUSTOR ainsi que la procédure de mise à jour sans perte sont décrites dans [SERVER_INSTALLATION.md](docs/SERVER_INSTALLATION.md).

## Architecture

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) et [docs/ROADMAP.md](docs/ROADMAP.md).

## Marque

FlixTunes utilise une identité et une signature sonore originales. Le produit ne doit pas reproduire le logo, le son de démarrage ou l'habillage d'un service existant.
