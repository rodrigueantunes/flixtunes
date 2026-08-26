# Validation FlixTunes 0.4.6 — étape 46

## Périmètre

L'étape 46 transforme la lecture en session continue et contrôlable sur Web, Android mobile et Android TV. Elle couvre la reprise, le seek, les chapitres, les informations techniques, les commandes de confort et l'enchaînement borné des épisodes.

## Cas obligatoires

1. Reprise automatique, reprise avec confirmation et redémarrage à zéro ; retour configurable de 0 à 60 secondes sans position négative.
2. Seek exact, ±10 secondes et accès direct à chaque chapitre, y compris média sans durée ou chapitre sans titre.
3. Vignette de timeline générée à la demande, mise en cache par tranche de dix secondes et position invalide refusée.
4. Vitesse 0,5× à 2×, PiP sur client compatible et minuteur qui met en pause sans marquer le média terminé.
5. Informations de lecture : mode, conteneur, codecs, débit, buffer, images perdues, sortie et raisons de conversion.
6. Épisodes précédent/suivant ordonnés par saison puis épisode, y compris franchissement de saison.
7. Auto-play borné par profil ; après la limite sans interaction, aucune lecture suivante n'est lancée.
8. Fin, pause, fermeture et changement d'épisode conservent la progression ; un épisode terminé est marqué explicitement.
9. Android Media3 conserve vitesse, reprise, PiP mobile et politique d'auto-play.

## Barrière de sortie

- Contrats/serveur/Web compilés et suites complètes sans régression.
- Tests Android JVM et APK `versionCode 46`.
- Test réel FFmpeg d'une vignette extraite et servie en JPEG.
- Recette navigateur du profil, des contrôles, du panneau technique et de la reprise.
- APKG x86-64/ARM64, APK Android et sommes SHA-256.

## Résultats

- Contrats, serveur et Web compilés ; build PWA de production réussi.
- Suite serveur : **19 fichiers / 101 tests réussis**.
- Suite Web : **6 fichiers / 23 tests réussis**.
- Android : **12 tests JVM réussis**, assemblage propre et manifeste `versionCode 46`, `versionName 0.4.6`.
- Régression FFmpeg réelle réussie : Direct Play, HLS fMP4/MPEG-TS, AAC/AC-3/Opus, EBU R128, mode nuit, E-AC-3, WebVTT et transcodage.
- Extraction réelle d'une vignette : JPEG `FF-D8-FF`, 6 493 octets ; lecture du même bucket depuis le cache en environ 46 ms sur le poste QA.
- Recette navigateur : réglages de reprise/vitesse/auto-play persistés après fermeture/réouverture puis restaurés ; lecteur Direct Play contrôlé à 1,25× ; seek −10 s borné à zéro ; diagnostic MP4/H.264/AAC, 0,8 Mb/s, 8 s de buffer et zéro image perdue.
- Les tests API valident le franchissement Saison 1 épisode 2 → Saison 2 épisode 1 et le refus d'une position de vignette négative.
- Deux APKG 2.0 validés par extraction et APK Android publiés.

### Artefacts

- `flixtunes_0.4.6.r1_x86-64.apk` — `7E29396D87DCA86A3F22258E76479D8203E8566C224BAC98BB37403D517B62DE`
- `flixtunes_0.4.6.r1_arm64.apk` — `3BCB28A50B492227BA7E4544DDF09858B219159E48D7A60D07046594A5764ABB`
- `FlixTunes-Android-0.4.6.apk` — `703EFAD7D6B31683977D34510D7422785673ADD4CA159F86F4C1AAC428B02102`

### Décision

La barrière de sortie de l'étape 46 est franchie. Le profil QA a été remis en reprise automatique, retour de 5 secondes, vitesse 1× et limite de trois épisodes.
