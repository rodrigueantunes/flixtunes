# NAS générique — installation native

Depuis SSH :

```bash
bash install/nas/install-nas.sh --nas-root /volume1/FlixTunes
```

Le script détecte les emplacements Synology/ASUSTOR, QNAP et Unraid les plus courants. Il utilise Entware pour FFmpeg quand `opkg` est disponible, installe un runtime Node privé et ne modifie pas les dossiers multimédias.

Les données et la configuration restent respectivement dans `FlixTunes/data` et `FlixTunes/config`. Le code versionné réside dans `FlixTunes/server/releases` : une mise à jour n'écrase donc ni les comptes, ni les progressions, ni les bibliothèques.

Si le NAS ne permet pas d'ajouter un service système, les commandes `server/bin/start.sh`, `stop.sh` et `status.sh` sont générées. Placez simplement `start.sh` dans le planificateur de tâches au démarrage du NAS.

Pour un NAS verrouillé disposant de Docker ou Container Manager, `install-compose.sh` et `update-compose.sh` fournissent le parcours alternatif. Les données restent montées hors de l'image et ne sont donc pas perdues lors d'une reconstruction.
