# Validation 0.5.6.r53

Date : 24 août 2026

## Périmètre corrigé

- *The Drama (2026)* : la piste française sélectionnée sur le Web doit être celle qui s’entend, sans décalage avec l’image.
- *Lucky S01E01* : la préférence Dolby Vision doit neutraliser le signal HDR10+ concurrent tout en conservant le mode `Direct Play`.
- Android TV : les catalogues Films et Séries doivent préparer leurs données et leurs jaquettes avant l’arrivée du focus, sans baisser leur qualité et sans modifier téléphone/tablette.

## Audio Web — mesure et correction

- FFprobe mesure un départ à `0.000 s` pour la vidéo, la VO E‑AC‑3 5.1, la VF E‑AC‑3 5.1 et l’audiodescription. Une corrélation d’enveloppe sur trois minutes entre VO et VF trouve son maximum à `0 ms` (`0,886`) : le fichier source n’est pas décalé.
- Le remux R52 E‑AC‑3 copie produisait lui aussi des PTS identiques (`0.083 s`) : le retard était introduit par le décodage MediaSource du navigateur, pas par FFmpeg ni le MKV.
- R53 conserve le remux obligatoire lorsque la piste Web voulue n’est pas la première. La vidéo reste en copie de flux ; cette seule piste secondaire devient AAC afin d’utiliser la timeline navigateur la plus stable. Android n’entre jamais dans cette branche.
- Le HLS R53 témoin commence la vidéo à `0.083 s` et l’AAC à `0.061 s`, soit `22 ms` d’écart lié à l’amorce AAC, inférieur au seuil A/V du projet de `40 ms`.
- La décision automatisée vérifie `remux`, `transcodeVideo=false`, `transcodeAudio=true`, puis interdit `-c:a copy` pour ce cas précis.

## Dolby Vision Direct Play — preuve binaire

- Lucky et Astérix sont HEVC Main10, BT.2020/PQ, Dolby Vision profil 8.1 avec RPU. Lucky porte en plus une métadonnée HDR10+ SMPTE ST 2094-40 par image dans l’échantillon analysé.
- Sur les 24 premières images de Lucky : `24` signatures HDR10+ avant filtre, `24` neutralisées, `0` après filtre, `24` NAL RPU Dolby Vision conservés, `24` octets modifiés et taille strictement identique.
- Sur les 24 premières images d’Astérix : `0` signature HDR10+, `0` octet modifié et `24` NAL RPU Dolby Vision conservés.
- Le filtre R53 s’active pour toute session `direct + dolbyvision`, même si une bibliothèque analysée par une ancienne révision n’a pas encore inscrit HDR10+ dans `availableHdrFormats`.
- Il couvre les configurations codec exposées comme `video/dolby-vision` **ou** `video/hevc`, inspecte les blocs `csd-*` d’initialisation et chaque buffer avant `queueInputBuffer`. Il ne modifie ni URL, ni conteneur, ni paquet réseau, ni PTS, ni audio : le serveur reste en Direct Play.
- Le panneau Infos affiche `HDR10+ concurrent neutralisé (N)` dès que des signatures ont réellement traversé le filtre. Ce compteur distingue enfin une reconnaissance théorique de Media3 d’une transformation effectivement appliquée.

## Fluidité Android TV

- Les pages Films/Séries passent de 60 à 120 fiches uniquement sur TV, ce qui divise par deux les raccords réseau et remplacements d’état pendant un long parcours. Mobile et tablette restent à 60.
- La page suivante est demandée 24 cartes avant la fin — environ quatre rangées sur le téléviseur de référence — au lieu de 10 cartes.
- Deux rangées suivantes sont préchargées dans Coil après un délai qui laisse la priorité aux jaquettes visibles. Le bitmap est demandé avec une marge de 15 % sur la taille réelle d’une cellule adaptative : aucune jaquette sous-dimensionnée n’est réutilisée sur une dalle 4K.
- Le focus TV ne crée plus un collecteur de `Flow` et une coroutine par carte. Le même agrandissement `1,06`, le même liseré et la même cible de clic sont pilotés directement par `onFocusChanged`. Le tactile conserve son indication animée actuelle.
- Le cache mémoire à 28 %, le cache disque, le décodage matériel des bitmaps, les images originales et tous les écrans tactiles restent inchangés.

## Contrôles exécutés

- Serveur : 60 fichiers, 577 tests, 0 échec.
- Web : 20 fichiers, 170 tests, 0 échec.
- Android JVM : 26 classes, 189 tests, 0 échec, 0 erreur, 0 ignoré.
- TypeScript contrats, serveur et Web : aucune erreur.
- Kotlin/Compose debug et release R8 : compilations réussies.
- Android Lint debug et vital release : aucune erreur bloquante.
- Budgets Web : premier JavaScript 84,8 Kio/95, CSS 13,5/16, lecteur différé 189,6/200, premier affichage complet 222,8/320.
- APK signé : schémas v1, v2 et v3 valides, alignement 16 Kio valide, certificat SHA‑256 `c6d392431b9fe7d174990a9bb0a9e75b24c1cd39a495645c5fb76f726cd113e4`.
- Métadonnées Android : `tv.flixtunes.app`, `versionCode 56053`, `versionName 0.5.6.r53`, API 23–36.
- APKG x86‑64 : format ASUSTOR 2.0 validé, runtime FFmpeg et chaîne VA‑API embarqués.
- Empreintes R51 et R52 revérifiées après construction : `R51_INTACT=True`, `R52_INTACT=True`.

## Artefacts

- `FlixTunes-Android-0.5.6.r53-release-signed.apk` — recommandé pour Android TV, mobile et tablette.
- `FlixTunes-Android-0.5.6.r53-debug.apk` — diagnostic.
- `FlixTunes-Android-0.5.6.r53-release-unsigned.apk` — diffusion avec une autre clé.
- `flixtunes_0.5.6.r53_x86-64.apk` — ASUSTOR avec le correctif Web The Drama.
- `SHA256SUMS-0.5.6.r53.txt` — empreintes des quatre livrables.

## Validation matérielle attendue

Le téléviseur reste l’autorité finale sur le mode qu’il affiche. Pendant le test de Lucky, Infos doit montrer simultanément `Mode direct`, `Dolby Vision reconnu` et `HDR10+ concurrent neutralisé (N)` avec `N > 0`. Si le compteur reste à zéro, la capture de ce panneau donnera immédiatement le point restant à corriger ; il ne faudra pas conclure à partir du seul libellé source.
