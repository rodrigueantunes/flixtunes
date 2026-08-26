# Validation 0.5.6.r44

Date : 23 août 2026

## Périmètre

- Télécommande en mode transport : gauche/droite à −10/+10 secondes, OK lecture/pause.
- Télécommande en mode options : haut/bas active le parcours au focus ; directions et OK restent disponibles dans les panneaux.
- Retour hiérarchique : panneau, garniture, puis fermeture du lecteur sur un troisième geste.
- Toucher : tape simple pour afficher/masquer, double tape cumulé par côté, confirmation visuelle du saut.
- Téléphone/tablette : commande lecture/pause centrale, transport séparé des réglages et épisodes adjacents accessibles en portrait.
- Catalogues Films/Séries : recherche interne repliée avec requête active résumée ; recherche globale inchangée.
- Touches multimédias Lecture et Pause déterministes.

La révision ne modifie ni l'API, ni le schéma SQLite, ni les données. La reprise exacte, le réarmement HDR après seek direct, Dolby Vision, Atmos et la négociation de qualité de r43 conservent leur implémentation.

## Contrôles exécutés

- Kotlin/Compose debug et release : compilation réussie.
- Tests Android JVM : 23 classes, 176 tests, 0 échec.
- Android Lint : 0 erreur, 45 avertissements de maintenance — même total que r43.
- Tests Web : 20 fichiers, 165 tests, 0 échec.
- Tests serveur : 59 fichiers, 565 tests, 0 échec.
- TypeScript contrats, Web et serveur : aucune erreur de typage.
- Build Web : budgets du premier affichage, du lecteur différé, des styles, images et audio respectés.
- Installateurs Windows/Linux/NAS et structure ASUSTOR : validation réussie.
- APKG : format 2.0, charge utile, exécutables ELF, codecs FFmpeg et chaîne VA-API validés.
- APK debug : signatures v1 et v2 valides ; APK release volontairement non signé.
- Sommes SHA-256 des trois artefacts : recalculées et inscrites dans le manifeste livré.
- Métadonnées Android : `versionCode 56044`, `versionName 0.5.6.r44`, API minimale 23, cible 36.
- Métadonnées ASUSTOR : `flixtunes`, `0.5.6.r44`, `x86-64`, ADM 5.0.0 minimum.

## Artefacts

- `FlixTunes-Android-0.5.6.r44-debug.apk` — signé avec la clé de débogage, installable.
- `FlixTunes-Android-0.5.6.r44-release-unsigned.apk` — optimisé, non signé.
- `flixtunes_0.5.6.r44_x86-64.apk` — paquet ASUSTOR APKG 2.0.
- `SHA256SUMS-0.5.6.r44.txt` — sommes des trois artefacts.

## Validation matérielle restante

Aucun appareil ADB n'était connecté pendant cette session. Les décisions de touches et de retour sont couvertes par des tests JVM, et les trois surfaces compilent dans le même APK adaptatif. La sensation réelle du focus, les gestes tactiles et les voyants HDR/Dolby Vision/Atmos après navigation doivent encore être confirmés sur les appareils physiques avant une diffusion large ; le micrologiciel HDMI et le décodage matériel ne sont pas simulables sur la JVM.
