# Validation 0.5.6.r56

Date : 24 août 2026

## Fluidité des jaquettes Android TV

- La texture d'une jaquette est maintenant plafonnée selon la classe mémoire de la TV : `224×336`,
  `256×384` ou `288×432` px. La valeur précédente était `320×480` au démarrage et pouvait différer
  de la taille ensuite demandée par la carte.
- La même dimension est utilisée au démarrage, en prélecture et dans la carte visible. Coil peut donc
  réutiliser un seul bitmap au lieu de décoder plusieurs variantes d'une affiche.
- Le nombre de pixels et le volume envoyé au GPU diminuent de 19 à 51 % selon l'appareil. Le format
  couleur complet et le décodage matériel sont conservés : aucun passage en RGB565.
- Le plafond ne s'applique qu'à Android TV. Téléphone et tablette conservent le dimensionnement exact
  choisi par Coil selon leurs contraintes.
- L'observation du dernier élément visible passe désormais par `snapshotFlow` et `collectLatest`.
  Faire défiler la grille ne remonte donc plus cet index dans la composition de l'écran, et tout délai
  ou décodage de prélecture est annulé lorsque la télécommande avance de nouveau.
- Le zoom de focus, les dimensions des cartes, les textes et la qualité des fiches/bandeaux restent
  inchangés. Le lecteur, Direct Play, Dolby Vision et l'audio ne sont pas modifiés.

## Contrôles exécutés

- Android JVM : 26 classes, 192 tests, 0 échec.
- Android Lint debug et vital release : aucune erreur bloquante.
- Kotlin/Compose debug et release, R8, APK debug et release : constructions réussies.
- Baseline Profile toujours embarqué dans l'APK release.
- APK signé : alignement 16 Kio valide, signatures v1/v2/v3 valides.
- Métadonnées : `tv.flixtunes.app`, `versionCode 56056`, `versionName 0.5.6.r56`, API 23–36.
- APKG x86-64 : format ASUSTOR 2.0 et chaîne FFmpeg/VA-API validés.
- Les quatre livrables R55 correspondent toujours exactement à leurs empreintes publiées.

## Artefacts

- `FlixTunes-Android-0.5.6.r56-release-signed.apk` — recommandé Android TV, mobile et tablette.
- `FlixTunes-Android-0.5.6.r56-debug.apk` — diagnostic local.
- `FlixTunes-Android-0.5.6.r56-release-unsigned.apk` — signature externe.
- `flixtunes_0.5.6.r56_x86-64.apk` — paquet ASUSTOR.
- `SHA256SUMS-0.5.6.r56.txt` — empreintes des quatre livrables.
