# Validation 0.5.6.r52

Date : 24 août 2026

## Périmètre

- La livraison porte la nouvelle révision `0.5.6.r52` sur Android, Android TV, Web et ASUSTOR. Les quatre artefacts R51 restent strictement identiques à leurs empreintes publiées.
- La capture Web de *The Drama (2026)* a établi que l’interface sélectionnait bien `Français · VF · Doublage`, mais que la session restait en Direct Play et jouait physiquement l’anglais. Le défaut n’était donc plus la préférence enregistrée.
- Le fichier réel contient trois pistes décodables : anglais E-AC-3 5.1 en première position, français E-AC-3 5.1 marqué par défaut en deuxième position, puis audiodescription française stéréo. Chrome/Edge ne permettent pas à FlixTunes d’imposer de manière fiable une piste audio interne d’un MKV servi entier.
- Le client Web annonce maintenant cette limite au serveur. Si la piste voulue n’est pas la première, la décision devient un remux sans perte : la vidéo et la VF E-AC-3 5.1 sont copiées bit pour bit sur le navigateur témoin qui annonce ce codec compatible, et le flux ne contient que cette piste. Les fichiers dont la bonne piste est déjà la première restent en Direct Play.
- Android annonce explicitement sa capacité à sélectionner la piste dans le fichier direct. Media3 conserve donc son Direct Play multipiste et la sélection audio Android déjà validée sur le téléviseur.
- Les photos TV de *Lucky S01E01* montrent simultanément `Direct Play`, `matroska`, `Plage dynamique Dolby Vision`, `profil 8 · Dolby Vision reconnu par Media3`, tandis que le téléviseur affiche `HDR10+ ADAPTIVE`. Le diagnostic interne décrivait donc la piste source, pas le mode HDR finalement choisi par le matériel.
- Les deux fichiers témoins ont été comparés avec FFprobe : Astérix et Lucky sont HEVC Main10, BT.2020/PQ, Dolby Vision profil 8.1, RPU présent, couche de base HDR10. Lucky possède en plus métadonnées de mastering HDR10 et métadonnées dynamiques HDR10+.
- Une extraction bitstream des 24 premières images trouve 0 signature HDR10+ dans *Astérix et Obélix : L’Empire du Milieu (2023)* et 24 dans *Lucky S01E01*. Cette différence explique pourquoi le premier déclenche Dolby Vision en Direct Play alors que le second laisse gagner HDR10+ Adaptive.
- Le Direct Play Android est maintenu. Pour une session directe Dolby Vision dont la source annonce aussi HDR10+, un adaptateur placé juste avant le décodeur neutralise uniquement l’identifiant d’application HDR10+ SMPTE ST 2094-40 dans les NAL SEI HEVC. Les tailles, positions, horodatages, données HEVC et NAL RPU Dolby Vision ne changent pas ; il n’y a ni remux serveur ni réencodage.
- Le filtre n’est créé que pour le codec `video/dolby-vision` et ne s’active que pour une sortie directe Dolby Vision hybride. Astérix ne contient aucune signature correspondante et reste bit pour bit inchangé. Un choix HDR10+ désactive le filtre.

## Contrôles exécutés

- Tests serveur : 60 fichiers, 577 tests, 0 échec.
- Tests Web : 20 fichiers, 170 tests, 0 échec.
- Tests Android JVM : 26 classes, 188 tests, 0 échec, 0 erreur, 0 test ignoré.
- Tests du filtre : neutralisation uniquement dans un NAL SEI de type 39/40, préservation du RPU type 62, flux DV sans HDR10+ intact et respect de la fenêtre utile du buffer codec.
- TypeScript contrats, serveur et Web : aucune erreur de typage.
- Kotlin/Compose debug et release : compilation réussie ; optimisation R8 release terminée.
- Android Lint : terminé sans erreur bloquante.
- Build Web : tous les budgets sont respectés — premier JavaScript 84,8 Kio sur 95, styles 13,5 Kio sur 16, lecteur différé 189,6 Kio sur 200 et premier affichage complet 222,8 Kio sur 320.
- APKG x86-64 : format 2.0 validé, runtime FFmpeg et chaîne VA-API complète.
- APK release installable : signatures v1, v2 et v3 valides et alignement 16 Kio vérifié.
- Certificat SHA-256 : `c6d392431b9fe7d174990a9bb0a9e75b24c1cd39a495645c5fb76f726cd113e4`, identique aux révisions précédentes.
- Métadonnées Android : paquet `tv.flixtunes.app`, `versionCode 56052`, `versionName 0.5.6.r52`, API minimale 23, cible 36.
- Les quatre artefacts R51 correspondent exactement à `SHA256SUMS-0.5.6.r51.txt` (`R51_INTACT=True`).

## Artefacts

- `FlixTunes-Android-0.5.6.r52-release-signed.apk` — version recommandée Android TV/mobile, optimisée et installable.
- `FlixTunes-Android-0.5.6.r52-debug.apk` — version de diagnostic installable.
- `FlixTunes-Android-0.5.6.r52-release-unsigned.apk` — release optimisée non signée.
- `flixtunes_0.5.6.r52_x86-64.apk` — paquet ASUSTOR APKG 2.0 avec la correction audio Web.
- `SHA256SUMS-0.5.6.r52.txt` — empreintes SHA-256 des quatre artefacts.

## Validation matérielle restante

Le conflit HDR10+ a été reproduit dans le bitstream réel, le point d’insertion Media3 compile et les transformations unitaires sont vérifiées. Le téléviseur reste cependant seul capable de confirmer son basculement final en Dolby Vision avec Lucky. Pendant ce test, le panneau FlixTunes doit continuer d’indiquer `Direct Play` ; si le badge change en remux ou transcodage, le chemin testé n’est pas celui de cette correction.
