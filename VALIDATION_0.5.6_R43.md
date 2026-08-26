# Validation 0.5.6.r43

Date : 23 août 2026

## Périmètre

- Reprise exacte : position et durée du profil transmises en secondes, avec compatibilité du pourcentage historique.
- Lecture directe : seek initial réellement appliqué au fichier complet au lieu d'être considéré comme déjà effectué par le serveur.
- Progression : conversion systématique du temps local d'une fenêtre remuxée/transcodée vers le temps absolu du film avant sauvegarde.
- HDR direct : recréation ciblée du renderer vidéo après navigation afin de réarmer HDR10, HDR10+, HLG ou Dolby Vision ; piste et passthrough audio conservés.
- Repli qualité : formats HDR et codecs de sortie décodables conservés pendant un mode compatible ; SDR seulement lorsque la chaîne ne sait pas produire une sortie HDR sûre.
- Dolby Vision : présence conjointe d'un écran compatible et d'un décodeur `video/dolby-vision`, profils MediaCodec traduits vers Dolby Vision 4 à 10.
- Quarantaine : capacités vidéo effectives employées jusqu'au plan colorimétrique et à l'encodeur final, y compris après seek.
- Ergonomie Android/TV P0 à P3 de r42 conservée ; chaîne Atmos/TrueHD/E-AC3 JOC inchangée.

Les champs `progressPositionSeconds` et `progressDurationSeconds` sont additifs. Il n'y a ni changement de schéma SQLite, ni migration de données ; un ancien client continue d'utiliser `progressPercent`.

## Contrôles exécutés

- Kotlin/Compose debug et release : compilation réussie.
- Tests Android JVM : 23 classes, 173 tests, 0 échec.
- Android Lint : 0 erreur, 45 avertissements de maintenance — même total que r42.
- Tests Web : 20 fichiers, 165 tests, 0 échec.
- Tests serveur : 59 fichiers, 565 tests, 0 échec.
- TypeScript contrats, Web et serveur : aucune erreur de typage.
- Build Web : budgets du premier affichage, du lecteur différé, des styles, images et audio respectés.
- Installateurs Windows/Linux/NAS et structure ASUSTOR : validation réussie.
- APKG : format 2.0, charge utile, exécutables ELF, codecs FFmpeg et chaîne VA-API validés.
- Sommes SHA-256 des trois artefacts : recalculées et identiques au manifeste livré.
- Métadonnées Android debug et release : `versionCode 56043`, `versionName 0.5.6.r43`, API minimale 23, cible 36.
- Métadonnées ASUSTOR : `flixtunes`, `0.5.6.r43`, `x86-64`, ADM 5.0.0 minimum.

## Artefacts

- `FlixTunes-Android-0.5.6.r43-debug.apk` — signé avec la clé de débogage, installable.
- `FlixTunes-Android-0.5.6.r43-release-unsigned.apk` — optimisé, non signé.
- `flixtunes_0.5.6.r43_x86-64.apk` — paquet ASUSTOR APKG 2.0.
- `SHA256SUMS-0.5.6.r43.txt` — sommes des trois artefacts.

## Validation matérielle restante

Aucun appareil ADB n'était connecté pendant cette session. Les tests couvrent la décision de reprise, les conversions de temps, le déclenchement ciblé du réarmement HDR, les capacités Dolby Vision, les builds et le packaging. La confirmation du voyant HDR/Dolby Vision après `+10 s`/`−10 s`, ainsi que le maintien Atmos, doit être faite sur le téléviseur réel avant une diffusion large, car l'état HDMI et le micrologiciel du décodeur ne sont pas simulables sur la JVM.
