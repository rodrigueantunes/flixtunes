# Audit de conformité FlixTunes — phases 0 à 20

Date : 13 août 2026  
Version auditée : `0.2.0`

## Verdict

Les 21 phases ont été relues dans le code puis confrontées aux tests automatisés, aux intégrations FFmpeg/réseau et à une médiathèque temporaire réellement parcourue depuis l'interface Web. Les fonctions prévues dans le périmètre `0.2.0` sont présentes et les suites locales sont vertes.

Cet audit ne prétend pas que `0.2.0` égale déjà Netflix ou Plex dans tous les scénarios matériels. En particulier, les fournisseurs externes exigent leurs propres clés ou licences, la couverture réelle des codecs dépend aussi du FFmpeg et du matériel installés, et une session transcodée interrompue par un redémarrage serveur doit être relancée.

## Vérification phase par phase

| Phase | Version | Contrôle effectué | Preuve et verdict |
| ---: | :---: | --- | --- |
| 0 | 0.0.1 (base) | Architecture locale NAS, séparation serveur/client, données persistantes, conventions de version et de recette. | Structure monorepo, contrats partagés, documentation et scripts de livraison : **validé**. |
| 1 | 0.0.1 | Aucun dossier préconfiguré, assistant initial, chemins choisis par l'utilisateur, détection du type, persistance, scan au démarrage et manuel. | Test avec dossiers temporaires Films/Série TV, 4 fichiers importés sans déplacement ; correction du libellé accentué « Série TV » : **validé**. |
| 2 | 0.0.2 | Films, séries, saisons, épisodes, NFO/métadonnées intégrées, titres et images FR/EN avec repli anglais. | Tests scanner/NFO/TMDB et hiérarchie série → saisons → épisodes ; repli d'affiche saison vers série : **validé hors appels externes sans clé**. |
| 3 | 0.0.3 | Inventaire des pistes, négociation client, Direct Play, remux et transcodage FFmpeg. | 7 tests de décision et intégration FFmpeg réelle : **validé**. |
| 4 | 0.0.4 | Accueil, menus Films/Séries/Historique, tri, recherche, fiche série, saisons, épisodes, reprise et profils. | 6 tests Web et parcours navigateur sur catalogue réel : **validé**. |
| 5 | 0.0.5 | Client Android mobile/TV, Compose, Media3, navigation TV et découverte serveur. | 6 tests JVM, lint et APK debug assemblé : **validé sur build ; appareil physique non présent dans cette recette**. |
| 6 | 0.0.6 | Client Windows, découverte locale, catalogue et lecture VLC. | 8 tests natifs et publication autonome `win-x64` : **validé**. |
| 7 | 0.0.7 | Identité bleue FlixTunes, logo, animation et son de lancement original. | Ressources Web/Android/Windows construites et chargées : **validé**. |
| 8 | 0.0.8 | En-têtes, limitation de débit, jeton API optionnel, sauvegarde, observabilité, watcher et mDNS. | Tests sécurité/autorisation, watcher réel et découverte `_flixtunes._tcp` : **validé pour réseau local**. |
| 9 | 0.0.9 | Livraison NAS native, Windows et Android, documentation et sommes SHA-256. | Archives inspectées et sommes recalculées : **validé après correction du filtre d'archive source**. |
| 10 | 0.1.0 | Centre d'analyse global, Films, Séries, métadonnées, par bibliothèque, annulation, relance et historique. | Tests du gestionnaire Web et contrôle navigateur des boutons/états : **validé**. |
| 11 | 0.1.1 | Noms avancés, années, éditions, documentaires/concerts, épisodes doubles, datés, absolus et spéciaux. | 9 tests du parseur et 2 tests NFO : **validé**. |
| 12 | 0.1.2 | Priorité local/NFO puis TMDB, TheTVDB, Fanart.tv et connecteurs IMDb/Allociné licenciés. | 5 tests d'adaptateurs, délais et replis ; ajout des appels Fanart et connecteurs licenciés : **validé en simulation, recette live en attente de clés/licences**. |
| 13 | 0.1.3 | Score explicable, seuil automatique, file de revue et correction/verrouillage. | 4 tests ; correction du scanner pour persister réellement l'état `review` : **validé**. |
| 14 | 0.1.4 | Vidéo/audio/sous-titres, chapitres, HDR10, Dolby Vision, Atmos, accessibilité et fichiers externes. | 5 tests FFprobe, SRT/ASS/PGS et matrice de fichiers réels : **validé pour les formats testés**. |
| 15 | 0.1.5 | Direct Play prioritaire, remux, transcodage, profils débit/écran, HLS fMP4 et MPEG-TS. | Intégration réelle H.264/HEVC/VP9/AV1, MP4/MKV/WebM/M2TS et HLS ; correction d'une course Windows à l'arrêt FFmpeg : **validé**. |
| 16 | 0.1.6 | Préférences audio/sous-titres par profil, pistes forcées/SME, extraction et conversion WebVTT. | Contrats, API, tests FFprobe et extraction SRT forcée réelle : **validé côté serveur/Web/Windows ; sélecteur Android plus limité**. |
| 17 | 0.1.7 | Ma liste, clavier/télécommande, accessibilité et adaptations Web/mobile/TV. | Tests Web, sémantique accessible et build Android TV : **validé sur logiciel ; D-pad physique non présent**. |
| 18 | 0.1.8 | Recommandations locales, privées, explicables, diversifiées et influencées par les avis. | 2 tests du moteur et rail utilisateur visible : **validé**. |
| 19 | 0.1.9 | Cache, coupe-circuit, délais réseau, télémétrie et index SQLite. | Tests résilience, routes santé/métriques et inspection du schéma : **validé**. Le catalogue survit au redémarrage ; la session active n'est pas reprise à chaud. |
| 20 | 0.2.0 | Recette propre multiplateforme, encodage, intégrations et paquets avec sommes. | 57 tests serveur + 6 Web + 8 Windows + 6 Android, builds et intégrations réelles : **validé avec les limites déclarées ci-dessous**. |

## Écarts détectés et corrigés pendant l'audit

1. Le type automatique ne reconnaissait pas correctement un chemin contenant « Série TV » avec accent : normalisation Unicode ajoutée et testée.
2. Le scanner calculait une zone de confiance intermédiaire sans enregistrer l'état `review` : seuil et contrat corrigés.
3. Le paquet source excluait par erreur le package Kotlin `app/data` parce que son filtre `data` était trop large : exclusions rendues exactes.
4. Les connecteurs secondaires n'étaient pas tous utilisés lors de l'enrichissement : replis TheTVDB/licenciés et Fanart.tv effectivement branchés.
5. L'arrêt d'une session FFmpeg pouvait rencontrer `EBUSY` sous Windows : attente du processus puis suppression avec tentatives ajoutées.

## Limites explicites de la version 0.2.0

- TMDB, TheTVDB, Fanart.tv, IMDb et Allociné ne peuvent être validés en direct sans clés ou contrats valides. Les adaptateurs et replis sont testés avec des réponses contrôlées.
- « Tous les codecs » signifie détection et stratégie Direct Play/remux/transcodage. Un codec propriétaire absent de FFmpeg ou du décodeur du client ne peut pas être garanti universellement.
- Dolby Vision, HDR10/10+, HLG et Atmos sont détectés et transmis selon les capacités annoncées ; le résultat final dépend de la chaîne écran/TV, audio, pilotes et liaison HDMI.
- Le redémarrage conserve comptes, catalogues et progressions. Une session HLS/transcodée en cours doit être relancée.
- Docker reste optionnel. La recette principale cible le fonctionnement natif Node.js + FFmpeg sur le NAS local.
- La signature cryptographique éditeur des exécutables/APK n'est pas incluse ; les livrables sont protégés par sommes SHA-256 et l'APK fourni est un build debug.
