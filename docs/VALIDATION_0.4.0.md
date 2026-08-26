# FlixTunes 0.4.0 — qualification des phases 21 à 40

Ce jalon transforme le prototype 0.2.0 en socle multimédia local qualifiable. Chaque phase possède un critère d'acceptation vérifiable et reste couverte par les tests unitaires, d'intégration ou de construction listés à la fin de ce document.

| Phase | Version | Domaine | Critère d'acceptation |
| ---: | :---: | --- | --- |
| 21 | 0.2.1 | Correctif lecture | Les dimensions impaires sont normalisées, l'accélération matérielle est détectée et les erreurs FFmpeg sont lisibles. |
| 22 | 0.2.2 | Localisation | Les titres et images suivent la langue de bibliothèque, avec repli français/anglais déterministe. |
| 23 | 0.2.3 | Provenance | Chaque champ enrichi conserve sa source, sa langue, sa date et son identifiant externe. |
| 24 | 0.2.4 | Identification | Les noms de fichiers films/séries sont normalisés, scorés et envoyés en revue en cas d'ambiguïté. |
| 25 | 0.2.5 | Fournisseurs | NFO, TMDB, TVDB, Fanart et connecteurs licenciés sont orchestrés avec état de santé et délais bornés. |
| 26 | 0.2.6 | Correction | L'administrateur peut rechercher, verrouiller, corriger ou libérer une correspondance. |
| 27 | 0.2.7 | Négociation | Le serveur choisit lecture directe, remux ou transcodage selon le client et explique sa décision. |
| 28 | 0.2.8 | Transcodage | Sessions HLS isolées, concurrence bornée, nettoyage et diagnostics sont opérationnels. |
| 29 | 0.2.9 | HDR | HDR10, HLG, Dolby Vision, profondeur de couleur et tone mapping sont détectés et négociés. |
| 30 | 0.3.0 | Audio/sous-titres | Multicanal, Atmos, DTS:X, pistes intégrées/externes et sous-titres image sont inventoriés. |
| 31 | 0.3.1 | Lecteur Web | Reconnexion HLS, reprise, choix de pistes, repli compatible et persistance des préférences sont couverts. |
| 32 | 0.3.2 | Navigation Web | Accueil, Films, Séries et Historique possèdent URL, clavier et navigation accessibles. |
| 33 | 0.3.3 | Catalogue | Recherche, tri et filtres de statut fonctionnent sur les bibliothèques volumineuses. |
| 34 | 0.3.4 | Profils | Préférences par profil, PIN haché et jeton temporaire protègent les données de lecture. |
| 35 | 0.3.5 | Administration | État serveur, scans, transcodages, sauvegardes et restauration différée sont exposés. |
| 36 | 0.3.6 | Android — socle | Dépôt, API, persistance de session, découverte locale et modèles partagés structurent le client. |
| 37 | 0.3.7 | Android mobile | Navigation tactile, rails, recherche, fiches et lecteur Media3 sont intégrés. |
| 38 | 0.3.8 | Android TV | Navigation télécommande, focus visible, grands formats et parcours canapé sont intégrés. |
| 39 | 0.3.9 | Android lecture | Capacités codecs/HDR/Dolby, HLS, reprise, progression et nouvelle tentative sont négociées. |
| 40 | 0.4.0 | Qualification | Versions alignées, PIN vérifié de bout en bout, matrice automatisée verte et paquets reproductibles. |

## Politique de lecture

Le serveur préfère toujours la lecture directe. Il remuxe lorsque seul le conteneur est incompatible et ne transcode que les flux réellement incompatibles. Les capacités envoyées par le client couvrent les conteneurs, codecs vidéo/audio, HDR, profils Dolby Vision, nombre de canaux et formats de sous-titres. Un client non compatible reçoit une variante SDR/H.264/AAC adaptée ; l'image est forcée sur des dimensions paires avant libx264.

La promesse « tous codecs » signifie : détection de tous les flux exposés par FFprobe et conversion de repli par FFmpeg lorsqu'une lecture native est impossible. Elle ne contourne ni DRM, ni brevet, ni décodeur matériel absent.

## Sécurité des profils

Les PIN ne sont jamais stockés en clair : ils sont dérivés avec `scrypt` et un sel aléatoire. Après validation, le serveur émet un jeton aléatoire lié au profil, valable douze heures au maximum et conservé uniquement pendant la session client. Les routes de catalogue personnel, progression, historique, recommandations et liste de suivi refusent un profil protégé sans jeton valide.

## Qualification attendue

- `pnpm validate` : types, tests unitaires et builds Contracts/Serveur/Web.
- `pnpm --filter @flixtunes/server test:ffmpeg` : lecture directe, HLS et dimensions impaires avec un vrai FFmpeg.
- `pnpm --filter @flixtunes/server test:codecs` : matrice de décision codecs, HDR et audio.
- `pnpm --filter @flixtunes/server test:watcher` : surveillance et ajout automatique.
- `pnpm --filter @flixtunes/server test:mdns` : annonce/découverte locale lorsque le réseau hôte autorise le multicast.
- `gradlew testDebugUnitTest lintDebug assembleDebug assembleRelease` : tests JVM, analyse statique et APK Android mobile/TV.
- Construction APKG ASUSTOR x86-64 avec données persistantes hors du répertoire applicatif.

Les clés TMDB/TVDB/Fanart et les éventuels connecteurs IMDb/Allociné licenciés restent à fournir dans l'administration : FlixTunes ne distribue aucune clé tierce et n'effectue aucun scraping non autorisé.

## Résultat de qualification — 13 août 2026

- Contracts/Serveur/Web : typecheck réussi, 78 tests serveur et 19 tests Web réussis, builds production réussis.
- Lecture réelle : Direct Play, HLS fMP4/MPEG-TS, transcodage, WebVTT et correction des dimensions impaires réussis avec FFmpeg.
- Matrice codecs : H.264, HEVC, VP9, AV1, MP4, MKV, WebM et M2TS réussis ; tone mapping HDR→SDR validé séparément.
- Automatisation locale : surveillance de bibliothèque et découverte mDNS réussies. L'annonce porte un nom unique par machine et port.
- Android : tests JVM, lintDebug, assembleDebug et assembleRelease réussis ; manifeste vérifié en `versionCode 40`, `versionName 0.4.0`, minSdk 23, targetSdk 36.
- Windows : 8 tests .NET réussis et publication autonome Windows x64 réussie.
- Installation serveur : analyse syntaxique PowerShell/Bash et structure Windows/Linux/NAS réussies.
- ASUSTOR : APKG 2.0 x86-64 vérifié, avec icône ADM, raccourci `http://<NAS>:4000/`, runtime Node embarqué et code précompilé.
- Parcours Web réel : ajout de bibliothèques Films/Séries, scans global/ciblés, fiche série/saison/épisode, Direct Play et HLS jusqu'à la fin, pistes, historique, liste de suivi et effacement de progression validés.
- Résilience profils : dialogue PIN Web validé (erreur puis succès), jeton périmé après redémarrage détecté et nouvelle authentification demandée ; le client Android revient également à la sélection de profil.
- Responsive : parcours contrôlé en 390×844 et 1920×1080 sans débordement horizontal, avec navigation tactile et grand écran.
- Intégrité : sommes SHA-256 publiées dans `artifacts/SHA256SUMS-0.4.0.txt`.

Le paquet Android `debug` est signé par la clé de développement et directement installable pour les essais locaux. Le paquet `release-unsigned` est le binaire optimisé destiné à être signé avec la future clé de publication ; Android refusera son installation tant qu'il n'est pas signé.
