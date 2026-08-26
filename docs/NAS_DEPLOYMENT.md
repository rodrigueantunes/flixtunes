# Déploiement sur un NAS local

FlixTunes ne contient aucun chemin média préconfiguré. Le montage Docker rend les fichiers visibles dans le conteneur, puis l’assistant Web demande les bibliothèques au premier lancement et les conserve dans SQLite.

## Installation automatisée

Le mode natif, sans Docker, est disponible avec :

```bash
bash install/nas/install-nas.sh --nas-root /volume1/FlixTunes
```

Le mode Container Manager/Docker est automatisé avec :

```bash
bash install/nas/install-compose.sh --data-root /volume1/FlixTunes/data --media-root /volume1/Multimédia
```

Les mises à jour correspondantes sont `install/linux/update-flixtunes.sh` pour le mode natif et `install/nas/update-compose.sh` pour Compose. Elles sauvegardent SQLite avant la bascule et conservent configuration, affiches, comptes et progressions. Voir [SERVER_INSTALLATION.md](SERVER_INSTALLATION.md) pour Windows, Linux et ASUSTOR ADM.

## Préparation

1. Copier `.env.example` vers `.env`.
2. Renseigner `FLIXTUNES_MEDIA_ROOT` avec le dossier parent des films et séries du NAS.
3. Renseigner `FLIXTUNES_DATA_ROOT` avec un dossier persistant et accessible en écriture par `PUID`/`PGID`.
4. Ajouter un jeton TMDB en lecture dans `TMDB_ACCESS_TOKEN` pour les affiches et métadonnées en ligne.
5. Lancer `docker compose up -d --build`.

L’interface est disponible sur `http://adresse-du-nas:4000`. Par exemple, si le partage `Multimédia` est monté dans `/media`, l’assistant acceptera `/media/Film` et `/media/Serie Tv`. Aucun fichier vidéo n’est déplacé ni renommé.

`network_mode: host` est volontaire sur un NAS Linux : il permet aux applications Android de trouver `_flixtunes._tcp.local` par DNS-SD. Si le NAS interdit le réseau hôte, remplacer ce réglage par `ports: ["4000:4000"]`; la connexion manuelle restera disponible mais le multicast peut dépendre du routeur Docker.

## Analyse et lecture

- Une analyse incrémentale est lancée à chaque démarrage.
- Une surveillance des dossiers déclenche un nouveau scan après stabilisation des copies.
- Un passage de contrôle est planifié toutes les six heures par défaut.
- FFmpeg décide entre Direct Play, remux et transcodage selon le client, y compris pour HDR10/HDR10+/HLG/Dolby Vision et Atmos/DTS:X/Auro-3D.
- Pour un partage réseau dont les notifications sont peu fiables, régler `FLIXTUNES_WATCH_POLLING=1`.

## Sauvegarde et restauration

La base est sauvegardée au démarrage puis toutes les 24 heures dans `data/backups`, avec sept versions conservées par défaut. L’API d’administration fournit :

- `GET /api/system/backups` pour l’inventaire ;
- `POST /api/system/backups` pour une sauvegarde immédiate ;
- `GET /api/system/backups/{nom}` pour télécharger SQLite ;
- `POST /api/system/backups/{nom}/restore` avec `{ "confirm": "RESTORE" }` pour préparer une restauration au prochain redémarrage.

Une copie de sécurité de la base courante est créée avant toute restauration. Le diagnostic `GET /api/system/status` contrôle également l’intégrité SQLite et l’état de FFmpeg.

## Accélération matérielle

Le mode `auto` essaie les moteurs disponibles puis retombe sur le logiciel. Sur un NAS Intel/AMD Linux, ajouter le périphérique `/dev/dri` au service Compose et donner à l’utilisateur du conteneur l’accès au groupe vidéo. La lecture directe ne nécessite pas d’accélération matérielle.
