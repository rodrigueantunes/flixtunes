# Validation 0.5.6.r39

## Uniformisation graphique, du Web vers Android TV et mobile

Le client Web sert de référence. Chaque point ci-dessous se vérifie en ouvrant les deux clients
côte à côte sur la même médiathèque et le même profil.

### Socle

- Les couleurs, arrondis, durées et approches typographiques d'Android viennent d'un seul fichier,
  `apps/android/app/src/main/java/tv/flixtunes/app/ui/Design.kt`, transcrit de `apps/web/src/styles.css`.
  Chaque jeton porte en commentaire la règle CSS dont il vient.
- Le gris secondaire est `#9BA5B9` des deux côtés, et non plus `Color.Gray` (`#888888`) sur Android.
- Les titres sont en Manrope, le texte en DM Sans, avec l'approche négative du Web. Les fichiers sont
  embarqués dans l'APK : aucun accès réseau n'est nécessaire au premier lancement.
- L'enseigne affiche « Flix » en blanc et « Tunes » en bleu, comme le Web et le logo.

### Accueil

- Huit rails, dans l'ordre du Web : Continuer à regarder, Sélection pour *profil*, Ma liste,
  Ajouts récents, Films, Séries, Déjà vus, Historique récent.
- Chaque intitulé de rail porte son décompte à droite ; « Sélection pour » porte « 100 % local ».
- La vitrine affiche l'accroche en capitales espacées, le titre en Manrope, la ligne
  « année • durée » avec le point médian bleu clair, puis Lecture et Plus d'infos.
- Un titre de carte occupe toujours deux lignes : la ligne de méta tombe à la même hauteur sur toute
  la grille.

### Navigation

- Cinq sections sur la barre tactile — Accueil, Films, Séries TV, Historique, Recherche — et quatre
  sur celle du téléviseur, la recherche gardant son bouton propre.
- Depuis Films, ouvrir un film puis revenir ramène **dans Films**. Idem depuis Séries.
- Un second retour depuis une section ramène à l'accueil ; un troisième quitte l'application.
- Un bouton **Actualiser** apparaît dans la barre du haut lorsqu'on est dans Films ou Séries. Il
  recharge la première page du catalogue et l'accueil.

### Catalogue

- En-tête identique au Web : accroche « Bibliothèque », titre, « *N* titres · *M* affichés ».
- Recherche interne, état (Tous, En cours, Vus, Non vus), tri (Titre, Sortie, Ajout) et genres.
- Les critères partent au serveur : le décompte reste juste au-delà de la première page.
- La grille s'étend pendant le défilement, et propose un bouton lorsqu'il reste des titres.

### Fiche

- Accroche de type, titre en Manrope, badges de qualité.
- Actions : Lecture ou Reprendre, Ma liste, Détails du fichier ou du dossier, Marquer vu.
- Lorsqu'un film possède plusieurs fichiers, chacun est listé avec sa qualité et sa taille, et la
  version lue se choisit.
- **Les saisons sont des cartes à jaquette** : affiche, nombre d'épisodes, titre et résumé — et non
  plus une rangée de puces de réglage.
- Chaque épisode affiche sa durée, son résumé, son avancement et un bouton « marquer vu ».

### Profils

- Un profil se modifie depuis Android : nom, couleur, langue, code PIN. Un champ PIN laissé vide ne
  touche pas au code en place ; « Retirer le code PIN » l'efface.
- Le serveur accepte `PUT` en plus de `PATCH` sur `/api/profiles/:id` : `HttpURLConnection` refuse
  `PATCH` par une liste de méthodes figée dans le JDK.

## Lecteur

- **Le cadre autour de l'image est noir.** Un film 2.39:1 sur un téléviseur 16:9 ne laisse plus deux
  bandes gris bleuté. La ressource nommée `black` valait `#080B12`.
- **La télécommande pilote le lecteur.** Barre retirée : gauche et droite naviguent de dix secondes,
  le centre ramène la barre. Barre visible : la croix parcourt les boutons, et le focus se pose de
  lui-même sur pause/lecture. Les touches multimédias agissent dans les deux cas. Retour et volume
  restent au système.
- **Atmos.** Les capacités de sortie sont désormais lues à la fois dans `AudioDeviceInfo.encodings`
  et dans `AudioCapabilities` de Media3. À vérifier sur l'appareil : lancer un film à piste E-AC3 JOC
  ou TrueHD, ouvrir « Infos lecture », et contrôler que le mode annoncé est `direct` ou `remux` —
  et non `transcode`.

## Contrôles automatiques

- Tests JVM Android : **161 tests, 0 échec** (`testDebugUnitTest`). S'y ajoutent les tests neufs de
  cette étape : analyse des trois listes d'accueil ignorées jusqu'ici, qualités et versions d'une
  fiche, résumé de saison, genres de catalogue, sections alignées sur le menu du Web, gestes de
  télécommande, et disponibilité de l'Atmos.
- Analyse statique : `lintDebug` — aucune erreur.
- Ressources : `aapt2 compile` accepte `strings.xml`, les polices et les couleurs.

## Livrables

- Application Android : `FlixTunes-Android-0.5.6.r39-debug.apk` (`versionCode 56039`, 18,8 Mio, signé
  par la clé de débogage — c'est celui qui s'installe).
  - SHA-256 : `028C78609A01A34254362BD9C4C2D87AA48DEB83DC11F51110FE92542064212B`.
- Application Android, diffusion : `FlixTunes-Android-0.5.6.r39-release-unsigned.apk` (4,7 Mio, **non
  signé** — il ne s'installe pas tel quel).
  - SHA-256 : `7AEEA86FA53834DE82DFA136C6CB6388482B08C8A42DED0B604B70A8AE608376`.
- Paquet ASUSTOR x86-64 : `flixtunes_0.5.6.r39_x86-64.apk` (157,6 Mio). `config.json` relu dans le
  paquet : `package flixtunes`, `version 0.5.6.r39`, `architecture x86-64`, `firmware 5.0.0`.
  - SHA-256 : `5B1891DA284F568FF69E8715579AD9A81D59B23D3E5A5618DFFAC3B339AAA74F`.
- Empreintes réunies : `artifacts/SHA256SUMS-0.5.6.r39.txt`.
