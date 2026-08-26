# Validation 0.5.6.r49

Date : 24 août 2026

## Périmètre

- La livraison porte une nouvelle révision `0.5.6.r49` sur Android, Android TV et ASUSTOR. Les artefacts r48 ne sont ni remplacés ni modifiés.
- À chaque ouverture, le client présente les groupes, puis les profils du groupe choisi. Android/TV remonte aux groupes avec Retour ; le Web propose la même hiérarchie.
- Les groupes peuvent être ajoutés, renommés et supprimés. Le serveur refuse un doublon, un treizième groupe, un groupe non vide et la suppression du dernier groupe.
- Un profil enfant exige un âge entier de 0 à 17 ans. Tous les profils existants sont rattachés automatiquement à un groupe `Famille` par une migration additive.
- Le filtrage parental est exécuté côté serveur sur les catalogues Films et Séries, l’accueil, la recherche globale, les recommandations, les genres, les listes, les collections, les personnes, les fiches et les routes de lecture/sous-titres. Une œuvre classée au-dessus de l’âge reçoit une réponse introuvable même par accès direct.
- Les classifications cinéma et télévision sont demandées au fournisseur selon la région du profil et normalisées (`Tous publics`, `-12`, `TV-14`, `FSK 16`, etc.). Une œuvre sans classification connue reste visible conformément à la règle demandée : seule une classification supérieure est exclue.
- Une analyse ordinaire R49 complète une seule fois les classifications des anciennes fiches. Ce chemin ne passe pas par l’upsert général : les titres corrigés, identifiants épinglés, affiches, fichiers et autres métadonnées ne sont pas réécrits.
- Le lecteur r48 n’est pas remanié. Dolby Vision, HDR10+, HDR10, HLG, SDR, Dolby Atmos, reprise, navigation rapide et optimisations Android TV gardent leur code validé ; R49 ajoute seulement l’identité du profil aux accès directs du lecteur.

## Contrôles exécutés

- Tests serveur : 60 fichiers, 574 tests, 0 échec, y compris migration de groupes, validation enfant, filtrage catalogue/recherche/fiche et conservation des corrections manuelles.
- Tests Web : 20 fichiers, 166 tests, 0 échec.
- Tests Android JVM : 25 classes, 183 tests, 0 échec.
- TypeScript contrats, Web et serveur : aucune erreur de typage.
- Kotlin/Compose debug et release : compilation réussie ; optimisation R8 release terminée.
- Android Lint : 0 erreur, 47 avertissements de maintenance.
- Build Web : budgets respectés — premier JavaScript 84,8 Kio sur 95, styles 13,4 Kio sur 16, lecteur différé 189,3 Kio sur 200 et premier affichage complet 222,8 Kio sur 320.
- APKG : format 2.0 validé par le constructeur puis par une seconde vérification. `config.json` annonce `FlixTunes`, `0.5.6.r49` et `x86-64` ; serveur, Web, Node.js et FFmpeg sont présents dans la charge utile.
- APK debug : signature de développement valide.
- APK release installable : signatures v1, v2 et v3 valides, alignement 16 Kio vérifié, manifeste non débogable.
- Certificat SHA-256 de la release signée : `c6d392431b9fe7d174990a9bb0a9e75b24c1cd39a495645c5fb76f726cd113e4`, identique aux révisions précédentes.
- Métadonnées Android : paquet `tv.flixtunes.app`, `versionCode 56049`, `versionName 0.5.6.r49`, API minimale 23, cible 36.
- Les quatre artefacts r48 correspondent toujours exactement à `SHA256SUMS-0.5.6.r48.txt` ; aucun n’a été remplacé.

## Artefacts

- `FlixTunes-Android-0.5.6.r49-release-signed.apk` — version recommandée Android TV/mobile, optimisée et installable.
- `FlixTunes-Android-0.5.6.r49-debug.apk` — version de diagnostic installable.
- `FlixTunes-Android-0.5.6.r49-release-unsigned.apk` — release optimisée non signée, réservée à une signature externe.
- `flixtunes_0.5.6.r49_x86-64.apk` — paquet ASUSTOR APKG 2.0.
- `SHA256SUMS-0.5.6.r49.txt` — empreintes SHA-256 des quatre artefacts.

## Validation matérielle restante

Aucun téléviseur n’est relié par ADB pendant la construction. Le parcours groupes/profils et le filtrage sont compilés et testés, mais la validation finale du focus et du confort de saisie doit être faite sur l’Android TV cible avec la release signée R8. Le lecteur Dolby Vision/HDR n’a volontairement pas été modifié.
