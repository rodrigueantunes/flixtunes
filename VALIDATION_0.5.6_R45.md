# Validation 0.5.6.r45

Date : 23 août 2026

## Périmètre

- Préférence HDR de profil sur Android, Android TV et Web : automatique, Dolby Vision, HDR10+, HDR10, HLG ou SDR.
- Repli automatique dans l'ordre Dolby Vision → HDR10+ → HDR10 → HLG → SDR lorsqu'une préférence n'est pas disponible.
- Choix radio contextuel dans le lecteur, limité aux sorties présentes ou dérivables de la vidéo et compatibles avec l'appareil.
- Vérification Android du profil Dolby Vision exact lorsque le pilote n'annonce pas ses niveaux.
- Changement HDR à la volée avec relance à la position absolue du film.
- Marquage vu/non vu par film, série, saison et épisode sur Android et Web.
- Agrégation de l'état vu des saisons et séries, filtres Vus/Non vus et coche en bas à droite des jaquettes.
- Optimisations Android TV des affiches et du focus sans réduction de la définition visible.
- Transport télécommande gauche/droite maintenu, OK et Retour conservé tel que validé en r44.

La migration SQLite est additive : `profiles.dynamic_range_priority` vaut `auto` sur les installations existantes. Aucun média, historique, profil ni réglage r44 n'est supprimé ou réinitialisé.

## Contrôles exécutés

- Kotlin/Compose debug et release : compilation réussie.
- Tests Android JVM : 23 classes, 178 tests, 0 échec.
- Android Lint : 0 erreur, 45 avertissements de maintenance — même total que r44.
- Tests Web : 20 fichiers, 165 tests, 0 échec.
- Tests serveur : 59 fichiers, 567 tests, 0 échec.
- Test serveur spécifique : saison isolée, série complète, remise à non vu et filtre `watched` validés.
- Tests HDR spécifiques : préférence disponible, préférence absente avec repli, SDR forcé et couche de base Dolby Vision validés.
- TypeScript contrats, Web et serveur : aucune erreur de typage.
- Build Web : tous les budgets du premier affichage, lecteur différé, styles, images et audio respectés.
- APKG : format 2.0, charge utile, exécutables FFmpeg et chaîne VA-API validés par le constructeur puis une seconde vérification indépendante.
- APK debug : signatures v1 et v2 valides ; APK release volontairement non signé.
- Métadonnées Android : `versionCode 56045`, `versionName 0.5.6.r45`, API minimale 23, cible 36.
- Sommes SHA-256 des trois artefacts recalculées et inscrites dans le manifeste livré.

## Artefacts

- `FlixTunes-Android-0.5.6.r45-debug.apk` — signé avec la clé de débogage, installable.
- `FlixTunes-Android-0.5.6.r45-release-unsigned.apk` — optimisé, non signé.
- `flixtunes_0.5.6.r45_x86-64.apk` — paquet ASUSTOR APKG 2.0.
- `SHA256SUMS-0.5.6.r45.txt` — sommes des trois artefacts.

## Validation matérielle restante

Aucun appareil ADB n'était connecté pendant cette construction. Les décisions de négociation et les interactions sont couvertes par les tests, mais les voyants Dolby Vision/HDR10+/HDR10/HLG dépendent du téléviseur, de son firmware, de la liaison HDMI et du profil réel du fichier. Une TV sans Dolby Vision recevra normalement la couche HDR10/HLG disponible ; aucune application ne peut fabriquer ou forcer un Dolby Vision absent du téléviseur ou du fichier.
