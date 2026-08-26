# Validation 0.5.6.r58

Date : 24 août 2026

## Résolution vidéo

- Le fichier témoin `Le Loup et le Lion (2021).mkv` a été lu directement avec FFprobe : vidéo HEVC
  Main 10, `1920×804` (codée `1920×808`), SAR `1:1`, DAR `160:67`. Il appartient bien à la famille
  1080p cinémascope et n'est plus annoncé 720p.
- Le calcul repose sur la largeur **ou** la hauteur nominale, orientation comprise. Les cas automatisés
  couvrent `1920×1080`, `1920×804`, `1916×800`, `1280×720`, `1280×536`, `3840×2160`,
  `3840×1606`, le portrait `804×1920`, une définition atypique `1600×900` et les dimensions absentes.
- Le même helper est employé par les qualités de fiche et par `technologies.resolution` dans
  l'inventaire de lecture. Les données FFprobe déjà stockées sont relues à la volée : aucune migration,
  aucun scan et aucune modification du fichier vidéo.

## Fluidité Android TV

- La prélecture reçoit directement l'index focalisé dans un canal conflated. Elle abandonne une cible
  périmée entre deux images, sans interrompre le décodage déjà commencé ; l'arriéré maximal est donc
  un bitmap, quelle que soit la durée du maintien D-pad.
- Un seul travailleur prépare jusqu'à huit affiches dans la direction courante. R57 en employait deux :
  le nouveau plafond réserve davantage de CPU au rendu sur les SoC TV modestes.
- Les textures de jaquette TV passent à `208×312`, `240×360` ou `272×408` px selon la classe mémoire.
  C'est environ 12 % de moins par axe que R57, près d'un quart de pixels en moins, tout en conservant
  ARGB, cache disque/mémoire, dimensions de carte, bandeaux et définition automatique sur mobile/tablette.
- L'initiale de secours n'est plus composée et dessinée derrière chaque bitmap chargé. L'indication de
  focus TV applique son agrandissement uniquement au dessin de la carte visée, sans calque de
  transformation permanent pour toutes les autres ; liseré, échelle 1,06, navigation et clic restent
  identiques.
- Le lecteur n'a pas été modifié : Direct Play, Dolby Vision, HDR10+, HDR10, Atmos, pistes, reprise et
  transport télécommande restent sur le chemin validé des révisions précédentes.

## Contrôles exécutés

- Serveur : 61 fichiers, 587 tests, 0 échec ; les nouveaux tests de définition et de fiche passent.
- TypeScript serveur : typecheck sans erreur.
- Web production : build Vite/PWA réussi ; tous les budgets de premier affichage et lecteur sont tenus.
- Android JVM : 26 classes, 192 tests, 0 échec.
- Android Lint debug et vital release : aucune erreur bloquante.
- Kotlin/Compose debug et release, R8, APK debug et release : constructions réussies.
- Baseline Profile présent dans `assets/dexopt` de l'APK release.
- APK signé : alignement 16 Kio valide, signatures v1/v2/v3 valides, certificat identique à R57.
- Métadonnées : `tv.flixtunes.app`, `versionCode 56058`, `versionName 0.5.6.r58`, API 23–36.
- APKG x86-64 : conteneur ASUSTOR 2.0 valide, manifeste `0.5.6.r58`, serveur compilé avec le nouveau
  calcul, chaîne FFmpeg/VA-API validée.
- Les quatre livrables R57 correspondent toujours exactement à leurs empreintes publiées
  (`R57_INTACT=True`).
- ADB est installé mais aucun appareil n'est relié. Aucune mesure de jank matériel n'est inventée ; le
  gain final reste à confirmer sur la TV avec l'APK release signé, jamais avec le debug.

## Artefacts

- `FlixTunes-Android-0.5.6.r58-release-signed.apk` — recommandé Android TV, mobile et tablette.
- `FlixTunes-Android-0.5.6.r58-debug.apk` — diagnostic local.
- `FlixTunes-Android-0.5.6.r58-release-unsigned.apk` — signature externe.
- `flixtunes_0.5.6.r58_x86-64.apk` — paquet ASUSTOR.
- `SHA256SUMS-0.5.6.r58.txt` — empreintes des quatre livrables.
