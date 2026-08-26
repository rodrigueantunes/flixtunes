# Validation 0.5.6.r48

Date : 24 août 2026

## Périmètre

- La livraison porte bien une nouvelle révision `0.5.6.r48`. Les quatre artefacts r47 restent présents et leurs empreintes r47 publiées ont été revérifiées à l'identique.
- L'index `# · A–Z` positionne Android TV et le Web sur la première jaquette de la lettre demandée sans filtrer le catalogue. La fenêtre garde des titres avant et après l'ancre et recharge les pages dans les deux directions ; la réglette Web reste cliquable à la souris.
- Sur Android TV, un maintien Bas parcourt une lettre toutes les 220 ms et affiche la lettre courante dans un repère dédié. Un appui bref conserve la descente normale d'une rangée. Le saut serveur est envoyé une seule fois au relâchement, ce qui évite d'empiler des rechargements pendant les répétitions de la télécommande.
- La lettre de départ vient de la première jaquette réellement visible. Après un défilement manuel, le maintien ne repart donc pas d'un ancien saut mémorisé.
- Le retour depuis une fiche conserve le rang et la jaquette focalisée ; Films et Séries gardent les pictogrammes tactiles `🎬` et `📺`.
- La précomposition TV est ramenée à une réserve ciblée : grilles `1,00/0,25 → 0,40/0,10`, rails `0,65/0,20 → 0,35/0,08` et listes `0,75/0,20 → 0,35/0,08` (avance/retour en fraction d'écran). La rangée suivante reste amorcée, sans faire travailler jusqu'à un écran complet de jaquettes hors champ.
- Le focus TV conserve exactement son agrandissement `1,06` et son liseré blanc, mais les applique immédiatement. Les deux animateurs d'état et l'onde tactile ne sont plus créés pour chaque carte TV ; mobile et tablette conservent leur animation tactile.
- Les libellés secondaires des médias et les initiales de secours des jaquettes sont calculés une fois au lieu d'être réalloués à chaque recomposition.
- La qualité des affiches n'est pas réduite : mêmes dimensions composées, même `ContentScale.Crop`, même précision Coil, même cache mémoire/disque et aucun filtre de qualité ajouté.
- Le lecteur n'est pas modifié. Dolby Vision, HDR10+, HDR10, HLG, SDR, Dolby Atmos, reprise et seeks gardent le chemin r46/r47 validé, notamment le fichier témoin *Astérix et Obélix : L’Empire du Milieu* (2023).

Aucune migration de schéma ni suppression de données n'est introduite. Médias, profils, progressions, états vus, personnes, crédits et réglages sont conservés.

## Contrôles exécutés

- Tests serveur : 60 fichiers, 572 tests, 0 échec.
- Tests Web : 20 fichiers, 166 tests, 0 échec.
- Tests Android JVM : 24 classes, 181 tests, 0 échec.
- TypeScript contrats, Web et serveur : aucune erreur de typage.
- Kotlin/Compose debug et release : compilation propre réussie ; optimisation R8 release terminée.
- Android Lint : 0 erreur, 45 avertissements de maintenance.
- Build Web : budgets respectés — premier JavaScript 84,0 Kio sur 95, styles 13,2 Kio sur 16, lecteur différé 189,2 Kio sur 200 et premier affichage complet 221,7 Kio sur 320.
- APKG : format 2.0 validé par le constructeur puis par une seconde vérification indépendante. `config.json` annonce `FlixTunes`, `0.5.6.r48` et `x86-64` ; la charge utile vérifiée contient serveur, Web, Node.js, FFmpeg et VA-API.
- APK debug : signatures v1 et v2 valides.
- APK release installable : signatures v1, v2 et v3 valides, alignement 16 Kio vérifié, manifeste non débogable.
- Certificat SHA-256 de la release signée : `c6d392431b9fe7d174990a9bb0a9e75b24c1cd39a495645c5fb76f726cd113e4`, identique à la clé locale des révisions précédentes.
- Métadonnées Android : paquet `tv.flixtunes.app`, `versionCode 56048`, `versionName 0.5.6.r48`, API minimale 23, cible 36.
- Les quatre artefacts r47 correspondent toujours exactement à `SHA256SUMS-0.5.6.r47.txt` ; aucun n'a été remplacé.

## Artefacts

- `FlixTunes-Android-0.5.6.r48-release-signed.apk` — **version recommandée Android TV/mobile**, optimisée et installable.
- `FlixTunes-Android-0.5.6.r48-debug.apk` — version de diagnostic installable.
- `FlixTunes-Android-0.5.6.r48-release-unsigned.apk` — release optimisée non signée, réservée à une signature externe.
- `flixtunes_0.5.6.r48_x86-64.apk` — paquet ASUSTOR APKG 2.0.
- `SHA256SUMS-0.5.6.r48.txt` — empreintes SHA-256 des quatre artefacts.

## Validation matérielle restante

Aucun téléviseur n'était relié par ADB pendant la construction. Les causes structurelles identifiées sont supprimées et l'ensemble est compilé/testé, mais la fluidité ressentie et les temps d'image d'une dalle précise ne peuvent être mesurés honnêtement que sur l'Android TV cible. Installer la release signée R8, pas le debug, pour cette vérification. Le chemin Dolby Vision n'a volontairement pas été retouché.
