# Validation 0.5.6.r50

Date : 24 août 2026

## Périmètre

- La livraison porte une nouvelle révision `0.5.6.r50` sur Android, Android TV, Web et ASUSTOR. Les artefacts R49 ne sont ni remplacés ni modifiés.
- Android TV réduit le travail anticipé des listes et grilles sans réduire la résolution des affiches. Le défilement alphabétique maintenu suit désormais réellement la première jaquette de chaque lettre affichée.
- Le retour d’une fiche restaure le focus sur la jaquette ouverte, avec plusieurs tentatives synchronisées aux images Compose. La poignée A–Z ne peut plus voler ce focus pendant la restauration.
- Dans le lecteur TV, Gauche/Droite place explicitement le focus visuel sur la barre de progression pendant l’avance ou le recul ; le bouton Lecture/Pause n’est plus présenté comme sélectionné à tort.
- Android et Web proposent la taille, la couleur et le fond des sous-titres. Le fond est transparent par défaut ; les préférences sont persistées et appliquées à la volée sans redémarrer la lecture.
- La migration serveur ajoute uniquement la couleur aux préférences de sous-titres existantes. Les préférences déjà enregistrées sont conservées.
- Le chemin Dolby Vision validé n’a pas été modifié : remux `dvh1`, profils, négociation HDR et solutions de repli restent inchangés. Les informations de lecture indiquent maintenant le signal source et le signal réellement reconnu/sorti, afin de distinguer un fichier Dolby Vision d’une sortie en couche de base HDR10/HDR10+.

## Contrôles exécutés

- Tests serveur : 60 fichiers, 574 tests, 0 échec.
- Tests Web : 20 fichiers, 167 tests, 0 échec, dont la personnalisation des sous-titres sans reprise de lecture à zéro.
- Tests Android JVM : 25 classes, 183 tests, 0 échec.
- TypeScript contrats, Web et serveur : aucune erreur de typage.
- Kotlin/Compose debug et release : compilation réussie ; optimisation R8 release terminée.
- Android Lint : terminé sans erreur bloquante.
- Build Web : budgets respectés — premier JavaScript 84,8 Kio sur 95, styles 13,5 Kio sur 16, lecteur différé 189,5 Kio sur 200 et premier affichage complet 222,8 Kio sur 320.
- APKG : format 2.0 validé après construction.
- APK release installable : signatures v1, v2 et v3 valides et alignement 16 Kio vérifié.
- Certificat SHA-256 de la release signée : `c6d392431b9fe7d174990a9bb0a9e75b24c1cd39a495645c5fb76f726cd113e4`, identique aux révisions précédentes.
- Métadonnées Android : paquet `tv.flixtunes.app`, `versionCode 56050`, `versionName 0.5.6.r50`, API minimale 23, cible 36.
- Les quatre artefacts R49 correspondent toujours exactement à `SHA256SUMS-0.5.6.r49.txt` ; aucun n’a été remplacé.

## Artefacts

- `FlixTunes-Android-0.5.6.r50-release-signed.apk` — version recommandée Android TV/mobile, optimisée et installable.
- `FlixTunes-Android-0.5.6.r50-debug.apk` — version de diagnostic installable.
- `FlixTunes-Android-0.5.6.r50-release-unsigned.apk` — release optimisée non signée, réservée à une signature externe.
- `flixtunes_0.5.6.r50_x86-64.apk` — paquet ASUSTOR APKG 2.0.
- `SHA256SUMS-0.5.6.r50.txt` — empreintes SHA-256 des quatre artefacts.

## Validation matérielle restante

Aucun téléviseur n’est relié par ADB pendant la construction. Les tests et builds couvrent les régressions automatisables, mais le défilement prolongé, la restauration exacte du focus, le focus de la barre du lecteur et le signal HDMI Dolby Vision doivent être confirmés sur le téléviseur cible. Le chemin Dolby Vision fonctionnel, notamment celui observé sur *Astérix & Obélix : L’Empire du Milieu* (2023), a volontairement été préservé.
