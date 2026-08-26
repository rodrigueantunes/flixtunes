# Validation FlixTunes 0.4.5 — étape 45

## Périmètre

L'étape 45 rend la sélection linguistique et la chaîne audio déterministes. Le profil choisit son ordre de langues, le rôle admissible, la politique de sortie et les traitements dynamiques. Le serveur conserve le flux lorsqu'il est réellement compatible et ne convertit que l'audio dans les autres cas.

## Cas obligatoires

1. Les codes ISO-639 `fra/fre/fr`, `eng/en` et BCP-47 convergent ; `original` cible une piste marquée originale.
2. Une piste commentaire ou audiodescription n'est jamais sélectionnée implicitement, même si elle porte la langue favorite et le drapeau `default`.
3. Les rôles `main`, `original`, `dub`, `commentary`, `audio-description` proviennent des dispositions et titres de piste.
4. Android mobile reste conservateur ; Android TV annonce uniquement les encodages déclarés par la sortie HDMI/eARC active.
5. AC-3, E-AC-3, TrueHD/Atmos, DTS/DTS-HD/DTS:X sont copiés uniquement si codec, canaux, lossless et audio immersif sont tous acceptés.
6. Les sorties AAC, AC-3 et Opus sont vérifiées par FFprobe ; Opus retombe en AAC sur HLS MPEG-TS.
7. Le mode nuit utilise un compresseur, EBU R128 utilise `loudnorm`, et tout downmix/traitement termine par un limiteur à −0,45 dBFS environ.
8. Les réglages sont conservés dans le profil et transmis par Web et Android.

## Barrière de sortie

- Contrats/serveur/Web compilés sans erreur et suites complètes sans régression.
- Tests JVM et APK Android `versionCode 45`.
- Intégration réelle Direct Play, vidéo copiée + audio AAC/AC-3/Opus, EBU R128/mode nuit et E-AC-3.
- Diagnostic FFmpeg incluant sorties AC-3/Opus et filtres `loudnorm`, `acompressor`, `alimiter`.
- Contrôle navigateur des préférences du profil et de la raison de conversion.
- APKG x86-64/ARM64 et hashes de livraison.

## Résultats

- Contrats, serveur et Web compilés sans erreur ; build Web de production généré avec PWA.
- Suite serveur : **19 fichiers / 99 tests réussis**.
- Suite Web : **6 fichiers / 22 tests réussis**.
- Intégration FFmpeg/FFprobe réelle réussie : Direct Play, HLS fMP4 et MPEG-TS, vidéo copiée avec sorties AAC/AC-3/Opus, EBU R128, mode nuit, E-AC-3 et WebVTT.
- Matrice FFmpeg du serveur QA : **45/45 capacités disponibles**, aucun composant critique manquant, FFmpeg 8.1.1.
- Android : tests JVM et assemblage debug réussis ; manifeste produit en `versionCode 45`, `versionName 0.4.5`.
- Recette navigateur réelle : présence de tous les réglages, sauvegarde AC-3 + normalisation + mode nuit, fermeture/réouverture et restauration confirmées. Le profil QA a ensuite été remis en mode automatique sans traitement.
- Paquets ASUSTOR APKG 2.0 x86-64 et ARM64 vérifiés par extraction/validation du manifeste.
- Artefacts et sommes SHA-256 publiés dans `artifacts/`.

### Artefacts

- `flixtunes_0.4.5.r1_x86-64.apk` — `8386A404C955930966E772EAF43A81C227F92D747C8B9FD90E15E9C6BB5F7E5B`
- `flixtunes_0.4.5.r1_arm64.apk` — `08A6ABFEC18F68F847CA7E0C983C0AC4780F32375E90CECA0E0AB6710F243102`
- `FlixTunes-Android-0.4.5.apk` — `BDE7417DB5E8CC19369F5AD26306ACDECC53BFD7E3E83D17A5EE22B4B5373ED7`

### Décision

La barrière de sortie de l'étape 45 est franchie. Les limites de sortie réelles restent volontairement gouvernées par les capacités annoncées par le client et, sur Android TV, par la chaîne HDMI/eARC détectée : un format non déclaré n'est jamais forcé en passthrough.
