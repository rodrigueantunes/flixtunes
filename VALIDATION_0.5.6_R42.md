# Validation 0.5.6.r42

Date : 23 août 2026

## Périmètre ergonomique

- P0 : changement de profil sans déconnexion du NAS et plein écran réservé au lecteur.
- P1 : écrans compacts, clavier/IME, conservation du défilement, rafraîchissement au retour du lecteur, cibles tactiles et sémantique TalkBack.
- P2 : gabarit tablette/pliable, grille TV 4/6/8 colonnes et compte à rebours avant l'épisode suivant.
- P3 : réglages de lecture du profil sur Android/TV et état réseau récupérable sans vider les contenus chargés.

Le mode TV conserve la détection système, le focus visible, la validation au premier appui, la croix directionnelle, les touches média et les capacités audio/vidéo de r41. Le paquet ASUSTOR ne change ni le schéma, ni les données, ni le comportement serveur par rapport à r41.

## Contrôles exécutés

- Kotlin/Compose debug et release : compilation réussie.
- Tests Android JVM : 23 classes, 165 tests, 0 échec.
- Android Lint : 0 erreur, 45 avertissements de maintenance — même total qu'avant les ajouts P2-P3.
- Tests Web : 20 fichiers, 165 tests, 0 échec.
- Tests serveur : 59 fichiers, 565 tests, 0 échec.
- TypeScript contrats, Web et serveur : aucune erreur de typage.
- Build Web : budgets de chargement respectés.
- Installateurs Windows/Linux/NAS et structure ASUSTOR : validation réussie.
- APKG : format 2.0, charge utile, exécutables ELF, codecs FFmpeg et chaîne VA-API validés.
- Métadonnées Android : `versionCode 56042`, `versionName 0.5.6.r42`, API minimale 23, cible 36.
- Métadonnées ASUSTOR : `flixtunes`, `0.5.6.r42`, `x86-64`, ADM 5.0.0 minimum.

## Artefacts

- `FlixTunes-Android-0.5.6.r42-debug.apk` — signé avec la clé de débogage, installable.
- `FlixTunes-Android-0.5.6.r42-release-unsigned.apk` — optimisé, non signé.
- `flixtunes_0.5.6.r42_x86-64.apk` — paquet ASUSTOR APKG 2.0.
- `SHA256SUMS-0.5.6.r42.txt` — sommes des trois artefacts.

## Limite de cette validation

Les contrôles automatisés couvrent le code, les parcours de télécommande isolés, le packaging et les métadonnées. Aucun téléphone, écran pliable ou téléviseur physique n'était connecté à cette session : l'essai visuel final sur les appareils réels reste donc recommandé avant une diffusion large.
