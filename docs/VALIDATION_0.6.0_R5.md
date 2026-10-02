# Validation de la livraison 0.6.0 r5

Date : 29 septembre 2026. Construction complète par `tools/Build-Release.ps1`, terminée avec
le code 0 dans `C:/src/flixtunes-060-r1`. Aucun paquet installé ni service redémarré.

## Incident et correction

La consultation en lecture seule du journal et des métadonnées du NAS a identifié deux échecs
successifs de préparation Cast sur une source HEVC 4K HDR / Dolby Vision profil 8, audio E-AC-3.
Le moteur passait de VA-API à libx264 puis interrompait la conversion avant le premier manifeste.
La raison exacte du premier échec matériel n'était pas conservée en r4.

La r5 réduit la définition avant le tone mapping logiciel pour cette conversion Cast, produit
des segments de deux secondes, suit les progrès réels de FFmpeg et réinitialise le suivi lors
d'un repli. Une préparation échouée peut être retentée en H.264/AAC 720p, avec deux tentatives
maximum au total. Les erreurs détaillées et l'échec matériel sont désormais conservés.

Détails : [DIFFUSION_060_R5.md](DIFFUSION_060_R5.md). Les moteurs Android TV et VLC ne sont pas modifiés.

## Vérifications

- TypeScript et construction des projets : réussis ; budgets Web respectés.
- Serveur : **1 203 tests réussis**, 2 ignorés par la suite existante.
- Web : **358 tests réussis**.
- Bureau : **30 tests réussis**.
- Android : **270 tests réussis**, sans échec, erreur ou test ignoré.
- Total : **1 861 tests réussis**.
- Android lint : **0 erreur, 56 avertissements**.
- 592 fichiers sources comparés entre copie locale et partage : aucune différence.
- Onze fichiers de la r5 : identiques sur le partage, UTF-8 strict sans BOM ni caractère de remplacement.
- Tests exécutés avec des données temporaires indépendantes de la production.

## Banc réel FFmpeg et HTTP

`pnpm --filter @flixtunes/server test:cast-media` a réussi pour trois scénarios : fichier SD direct,
source synthétique HEVC 4K HDR convertie en 1080p, puis profil compatible 720p. Le banc vérifie
l'accès HTTP, les manifestes et segments, les codecs H.264/AAC, les dimensions, le décodage FFmpeg
et la révocation des URL. La voie directe vérifie également les requêtes Range.

Le même banc a ensuite réussi avec un extrait de huit secondes du film réellement concerné,
prélevé à partir de 108 secondes via le partage multimédia en lecture seule. Les sorties 1080p
et 720p sont servies et décodées correctement. Les données du banc sont temporaires et supprimées.
Ces essais tournent sur le PC : ils ne mesurent pas les performances du NAS et ne prouvent pas
une lecture prolongée sur le récepteur physique Pixel Tablet.

Journaux locaux : `integration-cast-r5.log` et `integration-cast-source-r5.log` dans le répertoire
de construction. Le banc est inclus dans les archives de sources.

## Livraison

Les six livrables et `SHA256SUMS-0.6.0.r5.txt` sont déposés dans le dossier partagé `artifacts`.
Les empreintes ont été vérifiées localement puis après copie par relecture du partage.

| Livrable | Vérification |
| --- | --- |
| Android | `tv.flixtunes.app`, version `0.6.0.r5`, code `60005` |
| Windows MSI | `ProductVersion=0.6.0.0`, fichier estampillé `0.6.0.r5` |
| Linux DEB | `Version: 0.6.0.r5`, archive ar valide et métadonnées en LF |
| ASUSTOR | APKG 2.0 validé par la construction |
| Deux ZIP | CRC vérifiés, version racine `0.6.0`, sources Cast identiques aux fichiers validés |

La construction NAS a utilisé le cache de trois paquets Debian dont l'index était indisponible ;
le contrôle des bibliothèques et fonctions VA-API a réussi. L'AppImage nécessite Linux et n'a pas
été générée sous Windows.

## Validation matérielle restante

**Le serveur NAS doit être mis à jour en r5** : la mise à jour Android seule ne déploie pas ce correctif.
Après cette mise à jour, il reste à confirmer le transfert Android → NAS → Pixel Tablet et une lecture
prolongée du film, puis les autres contenus et récepteurs. Aucune réussite universelle n'est déduite
des seuls tests automatisés. Le serveur observé pendant l'analyse était encore en r4.

Ce rapport est rédigé après génération et n'est pas inclus dans les archives déjà vérifiées.
