# Validation 0.5.6.r57

Date : 24 août 2026

## Analyse du rapport externe R56

Le fichier `Fluidité Android TV R56.html` est un audit statique, pas une trace de la TV. Ses
affirmations ont été recoupées avec les sources avant modification. Trois causes vérifiables ont été
retenues ; les refontes de `MainState`, de la carte et de la restauration de focus ont été écartées en
l'absence de preuve matérielle, afin de ne pas réintroduire les régressions corrigées en R47–R50.

## Corrections R57

- Le texte JSON est lu sur `Dispatchers.IO`, puis `JSONObject`, `JSONArray`, `parseHome`,
  `parseCatalogPage`, `parseDetails`, `parsePersonDetails` et les recherches sont entièrement traités
  sur `Dispatchers.Default`. Une page TV de 120 fiches ou une série complète ne bloque plus le fil UI.
- La prélecture n'observe plus le dernier index défilé avec un délai de 140 ms annulé à chaque
  répétition. La carte focalisée alimente maintenant une file conflated : deux workers terminent la
  petite rangée en cours, puis prennent directement la position la plus récente, sans arriéré.
- Les bandeaux TV sont bornés à 1024, 1280 ou 1440 px selon la mémoire. Portraits et affiches de saison
  rejoignent la même chaîne Coil que les jaquettes ; les saisons gardent 64 px supplémentaires.
- Mobile et tablette conservent le dimensionnement automatique exact. ARGB, cartes, textes, focus,
  lecteur, Direct Play, Dolby Vision et audio restent inchangés.

## Contrôles exécutés

- Android JVM : 26 classes, 192 tests, 0 échec.
- Android Lint debug et vital release : aucune erreur bloquante.
- Kotlin/Compose debug et release, R8, APK debug et release : constructions réussies.
- Baseline Profile toujours embarqué.
- APK signé : alignement 16 Kio valide, signatures v1/v2/v3 valides.
- Métadonnées : `tv.flixtunes.app`, `versionCode 56057`, `versionName 0.5.6.r57`, API 23–36.
- APKG x86-64 : format ASUSTOR 2.0 et chaîne FFmpeg/VA-API validés.
- Les quatre livrables R56 correspondent toujours exactement à leurs empreintes publiées.
- `adb` est installé mais ne voit actuellement aucun appareil ; aucune valeur de jank matériel n'est
  donc inventée dans cette validation.

## Artefacts

- `FlixTunes-Android-0.5.6.r57-release-signed.apk` — recommandé Android TV, mobile et tablette.
- `FlixTunes-Android-0.5.6.r57-debug.apk` — diagnostic local.
- `FlixTunes-Android-0.5.6.r57-release-unsigned.apk` — signature externe.
- `flixtunes_0.5.6.r57_x86-64.apk` — paquet ASUSTOR.
- `SHA256SUMS-0.5.6.r57.txt` — empreintes des quatre livrables.
