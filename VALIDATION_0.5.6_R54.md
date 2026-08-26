# Validation 0.5.6.r54

Date : 24 août 2026

## Correctif Dolby Vision — Direct Play conservé

- La capture R53 prouve que le filtre s'exécutait (`805` signatures vues), mais modifier uniquement `application_identifier` n'empêchait pas le décodeur du téléviseur de reconnaître le message Samsung HDR10+.
- R54 analyse la structure RBSP des NAL SEI HEVC et retire le message `user_data_registered_itu_t_t35` SMPTE ST 2094-40 complet, comme l'implémentation de référence Kodi.
- Quand le NAL ne contient que HDR10+, le NAL est supprimé. Quand plusieurs messages partagent le NAL, seul HDR10+ est retiré puis les autres SEI sont reconstruits avec leurs octets d'échappement HEVC.
- La taille réellement envoyée à `MediaCodec.queueInputBuffer` est réduite en conséquence. C'était impossible avec la neutralisation R53, qui conservait volontairement la taille originale.
- Le filtre reste limité à `mode=direct` et `outputDynamicRange=dolbyvision`. Il ne modifie ni URL, ni conteneur MKV, ni image HEVC, ni audio, ni PTS ; il n'effectue aucun remux et aucun transcodage.
- Les NAL Dolby Vision RPU 62/63 ne sont jamais candidats au retrait. Le panneau Infos affiche désormais `HDR10+ retiré (N SEI · X octets)`.

## Preuve sur les deux fichiers réels

- *Lucky S01E01*, 24 premières images : `24` messages SEI HDR10+ retirés, `1 752` octets retirés, `24` RPU Dolby Vision conservés. Un second passage sur la sortie trouve `0` HDR10+ et toujours `24` RPU.
- *Astérix et Obélix : L'Empire du Milieu (2023)*, 24 premières images : `0` message retiré, taille identique, tableau d'octets identique et au moins `24` RPU Dolby Vision conservés.
- Les tests couvrent aussi un NAL mixte : l'autre message SEI et le RPU restent identiques après retrait de HDR10+.

## Diagnostic matériel temporaire R54

- Après sept secondes d'une session Direct Play Dolby Vision filtrée, Android envoie au NAS un instantané contenant : révision, modèle/SDK, mode et plage demandée, codec réellement choisi, formats MediaCodec d'entrée/sortie, clés de paramètres, buffers/octet reçus, RPU conservés, SEI et octets retirés.
- Le serveur conserve uniquement les vingt derniers essais en mémoire. Les textes sont bornés, le journal n'accepte ni chemin de fichier ni jeton et disparaît à chaque redémarrage du serveur.
- Consultation : `GET /api/playback/diagnostics`. Effacement : `DELETE /api/playback/diagnostics`. Ce mécanisme est explicitement temporaire et sera retiré après validation matérielle.

## Fluidité Android TV — chargement au démarrage

- Au choix du profil TV, les métadonnées Films et Séries sont chargées intégralement et en parallèle par pages de 120. La grille Compose reste paresseuse : posséder la liste en mémoire ne compose que les fiches visibles.
- Les 48 premières affiches Films/Séries, entrelacées, sont décodées à `320×480` avant l'ouverture des menus. Elles sont donc prêtes lorsque le focus arrive.
- Le reste de la bibliothèque chauffe le cache disque une image à la fois à faible cadence, mémoire désactivée. Coil conserve la réponse originale sur disque puis la redécode à la définition réelle de la carte : aucune image basse définition n'est affichée.
- Une fois le catalogue complet en mémoire, A–Z calcule localement la première jaquette et positionne son rang sans appel réseau ni remplacement de page.
- Le mode téléphone/tablette conserve strictement ses pages de 60, son démarrage immédiat, son cache, ses gestes et ses dimensions. Aucun préchargement intégral n'y est activé.

## Contrôles exécutés

- Serveur : 61 fichiers, 579 tests, 0 échec.
- Web : 20 fichiers, 170 tests, 0 échec.
- Android JVM : 26 classes, 192 tests, 0 échec, 0 erreur, 0 ignoré, dont les corpus Lucky et Astérix réels.
- TypeScript contrats, serveur et Web : aucune erreur.
- Web, serveur et contrats : builds de production réussis.
- Android Kotlin/Compose debug et release R8 : compilations réussies.
- Android Lint debug et vital release : aucune erreur bloquante.
- Budgets Web : premier JavaScript 84,8 Kio/95, CSS 13,5/16, lecteur différé 189,6/200, premier affichage complet 222,8/320.
- APK signé : schémas v1, v2 et v3 valides, alignement 16 Kio valide, certificat SHA-256 `c6d392431b9fe7d174990a9bb0a9e75b24c1cd39a495645c5fb76f726cd113e4`.
- Métadonnées Android : `tv.flixtunes.app`, `versionCode 56054`, `versionName 0.5.6.r54`, API 23–36.
- APKG x86-64 : format ASUSTOR 2.0 validé, runtime FFmpeg et chaîne VA-API embarqués.
- Empreintes R51, R52 et R53 revérifiées après construction : tous leurs APK/APKG restent identiques à leurs fichiers `SHA256SUMS`.

## Artefacts

- `FlixTunes-Android-0.5.6.r54-release-signed.apk` — APK recommandé Android TV, mobile et tablette.
- `FlixTunes-Android-0.5.6.r54-debug.apk` — diagnostic local.
- `FlixTunes-Android-0.5.6.r54-release-unsigned.apk` — signature externe.
- `flixtunes_0.5.6.r54_x86-64.apk` — paquet ASUSTOR comprenant le journal temporaire.
- `SHA256SUMS-0.5.6.r54.txt` — empreintes des quatre livrables.

## Test matériel attendu

Installer d'abord le paquet ASUSTOR R54, puis l'APK release signé R54. Lire Lucky au moins dix secondes en forçant Dolby Vision. Infos doit montrer simultanément `Mode direct`, `Dolby Vision reconnu` et `HDR10+ retiré (N SEI · X octets)` avec `N > 0` et `X > 0`. La dalle doit alors annoncer Dolby Vision. Si elle annonce encore HDR10+ Adaptive, le journal NAS permettra de lire le codec et son format de sortie réels sans nouvelle capture approximative ni ADB.
