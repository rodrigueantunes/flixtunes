# Validation 0.5.6.r51

Date : 24 août 2026

## Périmètre

- La livraison porte la nouvelle révision `0.5.6.r51` sur Android, Android TV, Web et ASUSTOR. Les quatre artefacts R50 sont restés strictement identiques à leurs empreintes publiées.
- Le choix audio Web est maintenant mémorisé par profil **et par média**. L’index d’une piste choisie sur un autre film ne peut donc plus sélectionner une mauvaise langue. Le fichier réel *The Drama (2026)* contient VO anglaise E-AC-3 5.1, VF française E-AC-3 5.1 par défaut et audiodescription française stéréo ; la sélection automatique retient bien la VF (flux 2) et les trois pistes se décodent correctement avec FFmpeg.
- Le sélecteur audio Android validé sur le téléviseur est préservé. Il traite déjà `fr`, `fra` et `fre`, privilégie le multicanal et exclut l’audiodescription ; aucun index de piste brut n’y est partagé entre les médias.
- Le fichier réel *Lucky S01E01* est identifié comme un master hybride HEVC Main10 Dolby Vision profil 8.1 avec couche HDR10 et métadonnées dynamiques HDR10+. Les formats disponibles sont conservés dans les métadonnées de scan et exposés au lecteur.
- La cause précise du repli Dolby Vision a été reproduite : le seul FourCC `dvh1` ne suffisait pas, car FFmpeg refusait d’écrire la boîte de configuration `dvcC`/`dvvC` sans son option ciblée. Le remux Dolby Vision écrit désormais réellement cette boîte et conserve le RPU, sans réencodage vidéo. Le choix HDR10+ remuxe le même flux en `hvc1`, sans signaler Dolby Vision et sans supprimer ses métadonnées HDR10+.
- Sur un master hybride, le menu Image propose uniquement les formats réellement contenus dans le flux et acceptés par l’appareil. Dolby Vision et HDR10+ peuvent être changés à la volée ; le lecteur redémarre la session à la position courante, sans revenir à zéro.
- Le maintien de Bas ne change plus de lettre. Bas reste une navigation ordinaire dans la grille et l’index A–Z latéral demeure l’unique accès alphabétique.
- La télécommande suit une règle de focus explicite : commandes masquées, Gauche/Droite avance ou recule ; commandes visibles, les flèches naviguent entre Lecture, Pistes, Infos et les autres contrôles ; lorsque la timeline possède le focus, Gauche/Droite avance ou recule. Haut/Bas reste disponible pour quitter la timeline et naviguer dans le panneau.
- Le focus de la timeline est retenté pendant plusieurs images Compose afin d’éviter que Lecture/Pause reste sélectionné visuellement. Cette gestion est locale au mode TV et ne modifie ni les gestes ni la disposition Android mobile/tablette.
- Android TV précompose moins de contenu hors écran et déclenche la pagination plus près de la zone visible. La résolution, le décodage, les caches d’affiches et la qualité vidéo ne sont pas diminués ; les paramètres téléphone/tablette restent inchangés.

## Contrôles exécutés

- Tests serveur : 60 fichiers, 576 tests validés. Deux tests d’intégration ont dépassé le délai court de 5 s sur le partage réseau puis ont réussi avec un délai de 20 s ; aucune assertion n’a échoué.
- Tests Web : 20 fichiers, 169 tests, 0 échec, dont l’isolation du choix audio par média et les formats HDR hybrides.
- Tests Android JVM : 25 classes, 185 tests, 0 échec, dont les gestes de timeline, la sélection HDR hybride et la sélection audio.
- TypeScript contrats, Web et serveur : aucune erreur de typage.
- Kotlin/Compose debug et release : compilation réussie ; optimisation R8 release terminée.
- Android Lint : 0 erreur bloquante.
- Build Web : tous les budgets sont respectés — premier JavaScript 84,8 Kio sur 95, styles 13,5 Kio sur 16, lecteur différé 189,6 Kio sur 200 et premier affichage complet 222,8 Kio sur 320.
- APKG x86-64 : format 2.0 validé après construction, avec runtime FFmpeg et chaîne VA-API complète.
- APK release installable : signatures v1, v2 et v3 valides et alignement 16 Kio vérifié.
- Certificat SHA-256 de la release signée : `c6d392431b9fe7d174990a9bb0a9e75b24c1cd39a495645c5fb76f726cd113e4`, identique aux révisions précédentes.
- Métadonnées Android : paquet `tv.flixtunes.app`, `versionCode 56051`, `versionName 0.5.6.r51`, API minimale 23, cible 36.
- Les quatre artefacts R50 correspondent exactement à `SHA256SUMS-0.5.6.r50.txt` (`R50_INTACT=True`) ; aucun n’a été remplacé.

## Artefacts

- `FlixTunes-Android-0.5.6.r51-release-signed.apk` — version recommandée Android TV/mobile, optimisée et installable.
- `FlixTunes-Android-0.5.6.r51-debug.apk` — version de diagnostic installable.
- `FlixTunes-Android-0.5.6.r51-release-unsigned.apk` — release optimisée non signée, réservée à une signature externe.
- `flixtunes_0.5.6.r51_x86-64.apk` — paquet ASUSTOR APKG 2.0.
- `SHA256SUMS-0.5.6.r51.txt` — empreintes SHA-256 des quatre artefacts.

## Validation matérielle restante

Les tests, sondes des fichiers réels et remux de contrôle prouvent la présence de la signalisation Dolby Vision dans la sortie R51. La négociation HDMI finale dépend néanmoins du téléviseur et doit être confirmée sur l’appareil cible, tout comme le ressenti de fluidité et le focus de la timeline. Cette réserve évite de déclarer un résultat matériel avant le test réel ; elle ne remet pas en cause la correction reproductible de la boîte `dvcC`/`dvvC`.
