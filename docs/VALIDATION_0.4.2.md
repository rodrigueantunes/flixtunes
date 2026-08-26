# Validation FlixTunes 0.4.2 — phase 42

## Objectifs corrigés

- Lecture MKV/H.264 avec audio E-AC-3 sur ASUSTOR, y compris quand le navigateur exige un transcodage.
- Affiches et métadonnées en français sans configuration obligatoire d'une clé API.
- Mise à niveau automatique d'une bibliothèque existante sans supprimer les comptes, progressions ou chemins.
- Repli Web conservateur HLS MPEG-TS, H.264/AAC, SDR, 1080p maximum.

## Architecture validée

- Le paquet APKG contient ses propres binaires Linux `ffmpeg` et `ffprobe` et les préfère systématiquement aux binaires App Central.
- Le script d'installation refuse un runtime embarqué non exécutable ou sans décodeur E-AC-3.
- Les archives Node.js et FFmpeg sont vérifiées par SHA-256 avant empaquetage.
- TVmaze enrichit les séries et saisons ; Wikidata, Wikipedia et Wikimedia enrichissent les films.
- Les réponses distantes sont dédupliquées, temporisées, mises en cache en mémoire et en SQLite pendant sept jours.
- TMDB, TVDB, fanart.tv, IMDb licencié et Allociné licencié restent des options avancées, jamais un prérequis.

## Matrice de test

| Domaine | Contrôle | Résultat attendu |
|---|---|---|
| Serveur | 84 tests Vitest et TypeScript | 84/84, aucun échec |
| Web | 20 tests Vitest, TypeScript et production Vite | 20/20, aucun échec |
| Android | Tests JVM et APK debug | Aucun échec |
| Métadonnées | Requêtes réelles Ahsoka, Andor, 1923, Better Call Saul et Dune (2021) | Correspondance et affiche trouvées |
| Lecture | Direct Play, HLS fMP4/MPEG-TS, MKV E-AC-3 vers AAC, WebVTT et transcodage | Aucun échec |
| ASUSTOR | Création puis vérification structurelle APKG 2.0 | Paquet valide, binaires exécutables présents |
| Mise à jour | Données hors du dossier applicatif et configuration réécrite vers le runtime intégré | Conservation des données |

## Test après installation sur le NAS

1. Installer le paquet `flixtunes_0.4.2.r1_x86-64.apk` depuis App Central.
2. Ouvrir FlixTunes depuis l'icône ADM ; l'enrichissement automatique commence en arrière-plan après le démarrage.
3. Dans Administration > Système, vérifier que FFmpeg est disponible et que `eac3` figure parmi les décodeurs.
4. Lire un MKV/H.264/E-AC-3, puis utiliser « Relancer en mode compatible » pour valider le chemin HLS H.264/AAC.
5. Contrôler les affiches Films et Séries ; une analyse de métadonnées peut aussi être relancée manuellement depuis l'administration.
