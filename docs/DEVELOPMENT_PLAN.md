# Plan de développement FlixTunes

## Objectif

Construire un serveur multimédia local avec la robustesse de lecture de Plex et une expérience de catalogue immersive inspirée de Netflix, tout en conservant une identité originale.

## Phases

## Convention de version

- Le socle validé est publié en `0.0.1`.
- Chaque phase validée jusqu'à la phase 9 incrémente le dernier nombre : `0.0.2` … `0.0.9`.
- La phase 10 ouvre la série `0.1.0`.
- La version n'est avancée qu'après validation complète du jalon concerné.

0. **Cadrage et architecture — base 0.0.1** : périmètre local NAS, séparation serveur/clients, convention de versions, modèle de données et stratégie de tests. Ce cadrage partage la première version exécutable avec la phase 1 ; il ne constitue pas un paquet distinct.
1. **Socle serveur — 0.0.1** : premier lancement, bibliothèques persistantes, scans incrémentaux et catalogue normalisé.
2. **Métadonnées — 0.0.2** : films, séries, saisons et épisodes, français/anglais, images locales et TMDB avec repli vers l'anglais.
3. **Lecture universelle — 0.0.3** : inventaire complet des pistes, négociation des capacités, Direct Play, remux puis transcodage FFmpeg.
4. **Expérience Web — 0.0.4** : accueil à jaquettes, rails, fiches immersives, profils isolés, recherche et reprise. Validée.
5. **Android — 0.0.5** : application mobile et interface Android TV avec Compose, Media3 et navigation D-pad. Validée.
6. **Windows — 0.0.6** : client natif léger utilisant un moteur de lecture à large couverture codec. Validée.
7. **Identité — 0.0.7** : nouveau symbole, mot-symbole, mouvement, palette et signature sonore originale. Validée.
8. **Durcissement — 0.0.8** : sécurité, sauvegarde, accélération matérielle, observabilité et tests multi-appareils. Validée.
9. **Validation et livraison — 0.0.9** : paquets NAS/clients, migrations, documentation, matrice codecs et recette de bout en bout. Validée.
10. **Centre d'analyse — 0.1.0** : travaux persistés, portées global/films/séries, priorité, annulation, relance et historique. Validée.
11. **Détection avancée — 0.1.1** : NFO, identifiants, éditions, documentaires, concerts, spéciaux, épisodes doubles/datés/absolus. Validée.
12. **Multi-fournisseurs — 0.1.2** : local/NFO, TMDB, TheTVDB, Fanart.tv et connecteurs IMDb/Allociné licenciés. Validée.
13. **Correspondance — 0.1.3** : score explicable, seuil automatique, file de revue, verrouillage et correction. Validée.
14. **Inventaire universel — 0.1.4** : flux, chapitres, codecs, HDR, audio immersif, accessibilité et sous-titres externes. Validée.
15. **Lecture adaptative — 0.1.5** : Direct Play prioritaire, remux, transcodage, débit réseau, profils d'écran et HLS fMP4/MPEG-TS. Validée.
16. **Audio et sous-titres — 0.1.6** : préférences par profil, pistes forcées/SME, conversion WebVTT et sélection externe. Validée.
17. **Expérience premium — 0.1.7** : Ma liste, navigation clavier/télécommande, accessibilité et adaptations Web/mobile/TV. Validée.
18. **Intelligence locale — 0.1.8** : recommandations privées, explicables, diversifiées et pilotées par les avis. Validée.
19. **Performance et résilience — 0.1.9** : télémétrie, cache, coupe-circuit, délais réseau et indexation SQLite. Validée.
20. **Validation 0.2 — 0.2.0** : durcissement, tests multiplateformes, documentation et paquets signés par somme SHA-256. Validée.

## Critères 0.2 atteints

- démarrage non bloqué par les scans ;
- scan et rafraîchissement séparés par bibliothèque ;
- aucun déplacement implicite de fichier ;
- jaquettes localisées pour films, séries et saisons ;
- pistes audio et sous-titres sélectionnables ;
- reprise inter-appareils fiable ;
- lecture testée en H.264, HEVC, AV1 et VP9 ;
- conteneurs MKV, MP4 et M2TS couverts ;
- sous-titres SRT, ASS et PGS couverts ;
- interface Android TV entièrement utilisable au D-pad ;
- catalogue persistant après redémarrage serveur ; une lecture transcodée interrompue doit actuellement être relancée par le client.

## Suite — phases 43 à 62

La feuille de route détaillée pour dépasser Plex sur la lecture, les sous-titres, les langues, la détection, les clients et l'exploitation se trouve dans [BEYOND_PLEX_PLAN.md](BEYOND_PLEX_PLAN.md). Elle impose des critères mesurables et un test de non-régression à chaque phase.
