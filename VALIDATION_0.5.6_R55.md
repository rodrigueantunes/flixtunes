# Validation 0.5.6.r55

Date : 24 août 2026

## Fluidité Android TV

- Le focus TV est lu dans les phases de dessin et de transformation : changer de jaquette ne
  recompose plus son contenu.
- Les modificateurs `composed` ont été retirés du chemin chaud des cartes.
- La prélecture Coil suit désormais la rangée visible, utilise deux workers et annule les requêtes
  devenues inutiles. Le chauffage intégral en arrière-plan de R54 a été supprimé.
- La fenêtre paresseuse et le nombre d'affiches préparées sont adaptés à la classe mémoire de la TV.
- La détection TV est unifiée entre l'interface, le catalogue et le cache d'images.
- Un Baseline Profile FlixTunes est compilé dans l'APK release (`assets/dexopt/baseline.prof` et
  `baseline.profm`) pour précompiler le démarrage, les grilles et le focus.
- Les dimensions, la définition des affiches et les effets visuels restent inchangés. Mobile et
  tablette gardent leur comportement et leur budget d'origine.

L'analyse complète, les choix issus de Netflix/Plex et le protocole de mesure matérielle sont dans
`AUDIT_FLUIDITE_ANDROID_TV_R55.md`.

## Journal Dolby Vision retiré

- L'envoi Android, les compteurs temporaires et les routes serveur de diagnostic R54 ont été retirés.
- Le correctif fonctionnel Direct Play Dolby Vision/HDR10+ validé en R54 reste en place ; aucun chemin
  vidéo, audio, PTS, URL, remux ou transcodage n'a été modifié pour R55.

## Contrôles exécutés

- Serveur : 60 fichiers, 577 tests, 0 échec.
- Web : 20 fichiers, 170 tests, 0 échec.
- Android JVM : 26 classes, 192 tests, 0 échec.
- Android Lint debug et vital release : aucune erreur bloquante.
- TypeScript contrats, serveur et Web : aucune erreur ; builds de production réussis.
- Android debug et release R8 : constructions réussies.
- APK release : profil AOT embarqué, alignement 16 Kio valide, signatures v1/v2/v3 valides.
- Métadonnées : `tv.flixtunes.app`, `versionCode 56055`, `versionName 0.5.6.r55`, API 23–36.
- APKG x86-64 : format ASUSTOR 2.0 validé avec runtime FFmpeg et chaîne VA-API.
- Les quatre artefacts R54 correspondent toujours exactement à leurs empreintes publiées.

## Artefacts

- `FlixTunes-Android-0.5.6.r55-release-signed.apk` — recommandé pour Android TV, mobile et tablette.
- `FlixTunes-Android-0.5.6.r55-debug.apk` — diagnostic local.
- `FlixTunes-Android-0.5.6.r55-release-unsigned.apk` — signature externe.
- `flixtunes_0.5.6.r55_x86-64.apk` — paquet ASUSTOR.
- `SHA256SUMS-0.5.6.r55.txt` — empreintes des quatre livrables.

## Qualification TV réelle

Aucun appareil ADB n'était relié à la machine de construction. La compilation, l'analyse Compose et
les tests valident l'intégrité ; la cadence touche-vers-image doit être confirmée sur la TV avec
l'APK release R55, cache froid puis chaud. Le protocole précis est consigné dans l'audit.
