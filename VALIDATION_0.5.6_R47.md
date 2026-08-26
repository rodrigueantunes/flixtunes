# Validation 0.5.6.r47

Date : 24 août 2026

## Périmètre

- L'index `# · A–Z` Android TV positionne désormais le catalogue sur la première jaquette de la lettre choisie. La réponse contient des titres avant et après l'ancre, puis recharge dans les deux directions : aucune partie du catalogue n'est filtrée ou tronquée.
- Le Web reçoit le même index latéral droit, utilisable à la souris et au clavier, avec le même saut sans filtrage.
- La pagination Android et Web conserve le décalage et l'ancre absolus après un saut alphabétique : le total et le chargement des pages précédentes et suivantes restent exacts.
- Le retour Android depuis une fiche ne réexécute plus la remise en tête réservée à un véritable changement de critère ; le défilement et la jaquette focalisée sont conservés.
- Sur Android TV, un maintien Bas avance de lettre en lettre toutes les 220 ms sans ouvrir la réglette ; un appui bref continue de descendre normalement et le maintien Droite ouvre toujours le panneau latéral. Si le NAS répond plus lentement que le maintien, les réponses devenues anciennes sont ignorées et la dernière lettre choisie est chargée dès que possible.
- Dans la barre basse tactile, seuls les deux pictogrammes demandés changent : `🎬` identifie Films et `📺` Séries TV.
- Les grilles et rails Android TV précomposent et préparent les éléments situés devant le focus, avec une petite réserve derrière lui. La résolution des jaquettes, leur cache et les animations visibles ne sont pas dégradés.
- Seule la carte qui doit réellement restaurer le focus crée le mécanisme Compose correspondant ; les cartes ordinaires et préchargées évitent ce coût.
- L'APK Android principal est une release R8 optimisée, alignée et signée avec la même clé locale que les APK debug précédents.
- La lecture r46 n'est pas modifiée : Dolby Vision, HDR10+, HDR10, HLG, SDR, Dolby Atmos, reprise et seeks gardent exactement leur chemin existant. *Astérix et Obélix : L'Empire du Milieu* (2023), confirmé en Dolby Vision, reste le fichier témoin de ce chemin.

Aucune migration de schéma ni suppression de données n'est introduite. Les médias, profils, progressions, états vus, personnes, crédits et réglages r46 sont conservés.

## Contrôles exécutés

- Tests serveur : 60 fichiers, 572 tests, 0 échec.
- Tests Web : 20 fichiers, 166 tests, 0 échec, dont le clic sur `V` qui conserve Alpha avant l'ancre, vise Voyage puis laisse Zeta après elle.
- Tests Android JVM : 24 classes, 181 tests, 0 échec, dont l'ordre du maintien `# → A → … → Z` et sa borne finale.
- TypeScript contrats, Web et serveur : aucune erreur de typage.
- Kotlin/Compose debug et release : compilation réussie ; optimisation R8 release terminée.
- Android Lint : 0 erreur, 45 avertissements de maintenance — même total que r46.
- Build Web : budgets respectés — premier JavaScript 84,0 Kio sur 95, styles 13,2 Kio sur 16, lecteur différé 189,2 Kio sur 200 et premier affichage complet 221,7 Kio sur 320.
- APKG : format 2.0 validé par le constructeur puis par une seconde vérification ; `config.json` annonce `0.5.6.r47` et `x86-64`, et la charge utile contient le serveur, le Web, FFmpeg et VA-API.
- APK debug : signatures v1 et v2 valides.
- APK release installable : signatures v1, v2 et v3 valides, alignement 16 Kio vérifié, manifeste non débogable.
- Certificat SHA-256 identique pour le debug et la release signée : `c6d392431b9fe7d174990a9bb0a9e75b24c1cd39a495645c5fb76f726cd113e4`.
- Métadonnées Android : paquet `tv.flixtunes.app`, `versionCode 56047`, `versionName 0.5.6.r47`, API minimale 23, cible 36.
- Les trois artefacts r46 correspondent toujours exactement à leurs empreintes publiées ; aucun n'a été remplacé.
- Les quatre artefacts r47 ont été recalculés après le dernier build et sont consignés dans `SHA256SUMS-0.5.6.r47.txt`.

## Artefacts

- `FlixTunes-Android-0.5.6.r47-release-signed.apk` — **version recommandée Android TV/mobile**, optimisée et installable.
- `FlixTunes-Android-0.5.6.r47-debug.apk` — version de diagnostic installable.
- `FlixTunes-Android-0.5.6.r47-release-unsigned.apk` — release optimisée non signée, réservée à une signature externe.
- `flixtunes_0.5.6.r47_x86-64.apk` — paquet ASUSTOR APKG 2.0.
- `SHA256SUMS-0.5.6.r47.txt` — empreintes SHA-256 des quatre artefacts.

## Validation matérielle restante

Aucun téléviseur n'était relié par ADB pendant cette construction. Les gains structurels sont compilés et couverts par les tests, mais une mesure de latence réelle de la télécommande et du rendu des jaquettes doit forcément se faire sur l'Android TV cible. Pour cette mesure et pour l'usage normal, installer la release signée optimisée, pas le debug. Le fonctionnement Dolby Vision n'a volontairement pas été retouché après la confirmation positive sur le film témoin de 2023.
