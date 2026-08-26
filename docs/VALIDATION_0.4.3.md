# Validation FlixTunes 0.4.3 — phase 43

## Périmètre

La phase 43 remplace les suppositions sur FFmpeg par un inventaire exécuté sur le serveur. La matrice couvre les entrées vidéo/audio, conteneurs, sous-titres, sorties et filtres. Le lecteur Web permet de choisir Auto, Direct forcé, Remux sans perte ou Compatible ; une tentative directe refusée par le navigateur retombe automatiquement en Compatible.

## Critères

- H.264, AAC, E-AC-3, sortie H.264, sortie AAC, HLS et redimensionnement sont classés critiques.
- Un composant absent apparaît avec son repli au lieu d'être annoncé comme pris en charge.
- Le diagnostic n'expose pas les journaux FFmpeg bruts au lecteur.
- Le paquet ASUSTOR embarqué conserve les signatures E-AC-3, TrueHD et libx264.
- Les quatre modes de lecture produisent une décision testable et explicable.

## Recette

1. Compiler contrats, serveur et Web sans erreur TypeScript.
2. Exécuter toutes les suites Vitest serveur et Web.
3. Exécuter les tests Android JVM puis construire l'APK version 43.
4. Exécuter les intégrations Direct Play, remux HLS, transcodage, E-AC-3 vers AAC et matrice codecs.
5. Ouvrir Administration > Diagnostic et contrôler la matrice dans un navigateur réel.
6. Ouvrir le lecteur, vérifier les quatre boutons et le repli Direct vers Compatible.
7. Construire puis valider les APKG x86-64 et ARM64.

## Résultats

- Serveur : 87/87 tests Vitest, TypeScript sans erreur.
- Web : 20/20 tests Vitest, build Vite et contrôle visuel navigateur réel réussis.
- Android : tests JVM et APK debug versionCode 43 réussis.
- Intégration : Direct Play, remux HLS fMP4/MPEG-TS, E-AC-3 vers AAC, sous-titres WebVTT et transcodage réussis.
- Matrice réelle du banc Windows : 40 capacités disponibles sur 40, aucun composant critique absent.
- APKG 2.0 x86-64 et ARM64 : validation structurelle, ELF, E-AC-3, TrueHD et libx264 réussie.
