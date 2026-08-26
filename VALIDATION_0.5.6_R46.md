# Validation 0.5.6.r46

Date : 23 août 2026

## Périmètre

- Distribution, réalisation, création, scénario et musique sur les fiches films/séries.
- Filmographie locale par personne, avec navigation directe vers chaque œuvre de la bibliothèque.
- Recherche globale par titre, acteur, réalisateur, genre et collection/saga, accents compris.
- Clic droit Web et appui long Android/mobile/TV : Lecture/Reprendre, Informations, Vu/Non vu et Ma liste.
- Retour depuis une fiche vers la position de défilement et l'affiche exactement focalisée auparavant.
- Focus TV placé sur Lecture/Reprendre à l'ouverture d'une fiche.
- Index alphabétique TV latéral : poignée droite, maintien droite ou maintien bas, puis saut serveur direct par lettre.
- Optimisations de grille Android TV : modèles immuables, cellules typées et réutilisées, pinceaux mémorisés, préchargement anticipé et focus à 45 ms.
- Dolby Vision prioritaire : profil source accepté malgré un pilote incomplet, détection `dvhe`/`dvh1`, repli remux unique sans réencodage et étiquetage fMP4 `dvh1`.
- Conservation des données et fonctions r45 : états vus, préférence HDR, progression exacte, Atmos et transport télécommande r44.

La migration SQLite est uniquement additive : `catalog_people` et `catalog_people_credits` ajoutent les personnes et leurs liens. Les médias, profils, progressions, états vus, réglages et corrections existants ne sont ni supprimés ni réinitialisés.

## Contrôles exécutés

- Tests serveur : 60 fichiers, 572 tests, 0 échec.
- Tests Web : 20 fichiers, 165 tests, 0 échec.
- Tests Android JVM : 23 classes, 180 tests, 0 échec.
- Tests ciblés : recherche par personne sans accents, filmographie locale, pagination par lettre, profils Dolby Vision OEM incomplets, reconnaissance `dvhe`/`dvh1`, ordre DV → HDR10+ → HDR10 → HLG → SDR et balise de remux `dvh1`.
- TypeScript contrats, Web et serveur : aucune erreur de typage.
- Kotlin/Compose debug et release : compilation réussie.
- Android Lint : 0 erreur, 45 avertissements de maintenance — même total que r45.
- Build Web : tous les budgets du premier affichage, du lecteur différé, des styles, images et audio sont respectés.
- APKG : format 2.0, charge utile, FFmpeg et chaîne VA-API validés par le constructeur puis par une seconde vérification indépendante.
- APK debug : signatures v1 et v2 valides ; APK release volontairement non signé.
- Métadonnées Android : `versionCode 56046`, `versionName 0.5.6.r46`, API minimale 23, cible 36.
- Sommes SHA-256 des trois artefacts recalculées après le dernier build.
- Les artefacts r44 et r45 ont conservé leurs tailles et dates ; aucune ancienne révision n'a été remplacée.

## Artefacts

- `FlixTunes-Android-0.5.6.r46-debug.apk` — signé avec la clé de débogage, installable.
- `FlixTunes-Android-0.5.6.r46-release-unsigned.apk` — optimisé, non signé.
- `flixtunes_0.5.6.r46_x86-64.apk` — paquet ASUSTOR APKG 2.0.
- `SHA256SUMS-0.5.6.r46.txt` — sommes des trois artefacts.

## Validation matérielle restante

ADB ne détectait aucun appareil pendant cette construction. Toute la chaîne Dolby Vision est couverte jusqu'au format effectivement remis à Media3 : détection du profil, négociation prioritaire, conservation des octets vidéo et entrée `dvh1` du remux. L'allumage physique du voyant Dolby Vision reste à confirmer sur le téléviseur et le fichier qui déclenchaient HDR10+ Adaptive ; c'est la seule vérification que les tests hors appareil ne peuvent pas reproduire.
