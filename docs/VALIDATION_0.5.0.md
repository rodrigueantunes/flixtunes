# Validation FlixTunes 0.5.0 — étape 50

## Périmètre

L'étape 50 qualifie la lecture : corpus de régression versionné par propriété technique, générateur légal
de fixtures, banc rejouant la négociation réelle sur des profils clients de référence, mesure de la
synchronisation audio/vidéo et rapport lisible par machine et par humain.

## Cas obligatoires

1. Manifeste décrivant conteneur, codecs, HDR, canaux, sous-titres, cadence et résultat attendu.
2. Fixtures entièrement synthétiques et reproductibles, recette FFmpeg incluse dans le manifeste.
3. Profils clients de référence reflétant ce que les clients annoncent réellement.
4. Cas limites : piste par défaut incorrecte, audio retardé, cadence variable, B-frames, fichier en cours
   de copie, conteneur sans index.
5. Synchronisation A/V mesurée et vérifiée contre une tolérance.
6. Résultat machine et rapport humain, avec distinction entre échec critique et limite connue.
7. Aucun échec critique ouvert.

## Banc exécuté

`pnpm --filter @flixtunes/server test:qualification` génère le corpus, le sonde, rejoue `decidePlayback`
et `planColorPipeline` pour chaque profil client, puis écrit
`data/qualification/qualification-<version>.json` et `.md`.

- **17 fixtures**, toutes générées par `lavfi` : aucun média sous droits.
- **49 cas** : 47 attentes de négociation et 2 critères de synchronisation A/V.
- **49 / 49 réussis, 0 échec critique.**
- Moteur : FFmpeg 8.1.1, plateforme `win32-x64`.

### Couverture par propriété

| Propriété | Fixtures |
| --- | --- |
| Conteneur | MP4, Matroska, MPEG-TS |
| Codec vidéo | H.264, HEVC, MPEG-2 |
| Codec audio | AAC, E-AC-3 5.1, FLAC |
| HDR | HDR10 PQ/BT.2020 avec mastering display et MaxCLL, HLG |
| Canaux | Stéréo, 5.1 |
| Sous-titres | SRT interne |
| Cadence | Cadence variable |
| Cas limites | Piste par défaut incorrecte, audio retardé, VFR, B-frames, fichier en cours de copie, conteneur sans index ni durée |

### Synchronisation audio/vidéo mesurée

| Fixture | Attendu | Mesuré |
| --- | --- | --- |
| `mp4-h264-aac` | 0 ms ±40 | **0 ms** |
| `cas-audio-retarde` | 500 ms ±40 | **500 ms** |

Les autres fixtures sont relevées sans critère : MPEG-TS ressort à −23 ms, écart normal de ce conteneur,
toutes les autres à 0 ms.

## Défauts trouvés par le banc

Le banc a pris en défaut deux choses pendant sa mise au point, ce qui valide son utilité :

1. **Une attente erronée du manifeste** : le HDR10 en Matroska était attendu en lecture directe sur
   Safari. Safari n'annonce que le conteneur MP4 : la bonne décision est un remux, vidéo copiée et HDR10
   conservé. C'est l'attente qui était fausse, pas le moteur.
2. **La mesure A/V elle-même** : la première implémentation ne remontait aucune valeur à cause d'une
   virgule finale non nettoyée dans la sortie FFprobe. La fixture au décalage de 500 ms aurait été
   déclarée conforme sans rien mesurer. La mesure passe désormais par `start_time` des flux, avec repli
   sur l'horodatage du premier paquet.
3. **Une fixture inexploitable** : le MP4 tronqué perdait son index et devenait illisible, donc son cas
   n'était jamais évalué. La recette utilise maintenant `-movflags +faststart`, ce qui reproduit
   fidèlement un fichier encore en cours de copie tout en restant analysable.

## Barrière de sortie

- Contrats, serveur et Web compilés ; suites complètes sans régression.
- Banc de qualification sans échec critique.
- Tests Android JVM et APK `versionCode 50`.
- APKG x86-64 et sommes SHA-256.
- Restauration 0.4.x → 0.5.0 testée.

## Résultats

- Banc de qualification : **47 / 47 cas, 0 échec critique**, rapports produits.
- Suite serveur : **21 fichiers / 152 tests réussis**. `corpus.test.ts` en apporte **8**, dont le contrôle
  qu'aucune fixture n'est non synthétique et que chaque propriété technique du plan est couverte.
- Suite Web : **6 fichiers / 28 tests réussis**.
- Contrats, serveur et Web compilés sans erreur, builds de production produits.

### Artefacts

- Paquet ASUSTOR **produit et vérifié** : `flixtunes_0.5.0.r1_x86-64.apk`, 160 967 616 octets,
  SHA-256 `5808d23f122a9c01fd6456be095c064069f87cfe61184201e1b5ede4a191bf36`.
  Conteneur APKG 2.0 valide, `config.json` en `version 0.5.0.r1`, `architecture x86-64`, `firmware 5.0.0`.
  Architecture unique volontaire : c'est celle de l'AS5404T visé.
- Builds de production : contrats, serveur et Web compilés vers `dist`.
- APK Android : **non produit**, limite d'environnement inchangée depuis 0.4.9.

### Reste à exécuter

Le dossier de l'étape prévoit une matrice d'exécution que l'environnement de développement ne permet pas
d'atteindre. Elle n'est ni simulée ni supposée :

- **Banc navigateurs réel** : Chromium, Firefox et Safari. Le banc actuel rejoue la *négociation serveur*
  pour des profils de capacité de référence, il ne lit pas les flux dans un navigateur.
- **Matrice d'appareils** : Android 8 à 16, Android TV, Windows, appareils bas, milieu et haut de gamme.
- **Conditions réseau** : LAN, Wi-Fi et reprise après veille.
- **Cas limites non couverts par le corpus actuel** : timestamps négatifs, seek proche de la fin et
  changement de piste en cours de lecture. Les deux derniers relèvent d'un lecteur réel, pas d'une
  décision serveur. L'index absent et la durée inconnue sont désormais couverts par
  `cas-sans-index-ni-duree`, écrit sur une sortie non repositionnable.
- **Restauration 0.4.x → 0.5.0** sur une base existante.
- **APK Android** : voir la limite d'environnement documentée en 0.4.9, inchangée.

### Décision

La barrière de sortie de l'étape 50 **n'est pas encore franchie**. Le corpus, le générateur, le banc et
les rapports sont livrés et sans échec critique, mais la qualification porte sur la décision serveur ; la
lecture réelle en navigateur et sur appareils reste à conduire avant de revendiquer la version 0.5.0
comme qualifiée.
