# Validation de la livraison 0.6.0 r4

Date : 28 septembre 2026. Construction complète par `tools/Build-Release.ps1` dans
`C:/src/flixtunes-060-r1`, terminée avec le code 0. Aucun paquet installé ni service redémarré.
Les sources de la copie locale ont été comparées au partage : aucune différence hors fichiers
générés et documentation, puis les cinq fichiers modifiés pour la r4 ont été comparés séparément.

## Résultats

- TypeScript : vérifications des projets réussies.
- Serveur : **1 192 tests réussis**, 2 ignorés par la suite existante.
- Web : **358 tests réussis**.
- Bureau : **30 tests réussis**.
- Android : **270 tests réussis**, 43 suites, aucun échec, erreur ou test ignoré.
- Total : **1 850 tests réussis**.
- Android lint : **0 erreur, 56 avertissements**.
- Budgets Web respectés ; aucune modification du code client ou du rendu vidéo.
- Tests serveur exécutés avec un répertoire de données neuf, hors du projet et des données de production.
- Sources et notes r4 : UTF-8 strict, sans BOM ni caractère de remplacement, identiques sur le partage.

## Régression découverte Cast

Les deux tests de `diffusion-multicast.test.ts` échouent avec la configuration r3 puis passent
avec la liaison d'écoute corrigée. Les vraies bibliothèques Bonjour et multicast-dns analysent
les paquets DNS ; seule la livraison UDP est simulée selon le filtrage d'adresse Linux.
Ce test ne constitue pas une exécution matérielle sur Linux.

La découverte corrigée exécutée sur le PC a trouvé Tv Salon et Pixel Tablet en Google Cast,
et Tv Salon en DLNA. GET_STATUS a réussi sur les deux récepteurs Google Cast. L'essai est
strictement limité à la découverte et à la lecture de l'état, sans chargement de média,
lancement d'application ni commande de pause ou d'arrêt.

Le NAS répondait en r3. Le transfert complet Android → NAS → récepteur et la lecture prolongée
restent à vérifier après mise à jour du serveur en r4. Le mécanisme corrigé et les références
techniques sont décrits dans [DIFFUSION_060_R4.md](DIFFUSION_060_R4.md).

## Livrables

Les six fichiers et `SHA256SUMS-0.6.0.r4.txt` ont été copiés dans le dossier partagé `artifacts`.
Toutes les empreintes SHA-256 ont été contrôlées avant copie puis par relecture du partage.

| Livrable | Vérification |
| --- | --- |
| Android | Application `tv.flixtunes.app`, version `0.6.0.r4`, code `60004` |
| Windows MSI | `ProductVersion=0.6.0.0`, fichier de livraison `0.6.0.r4` |
| Linux DEB | `Version: 0.6.0.r4`, archive ar valide, métadonnées en LF |
| ASUSTOR | APKG 2.0 validé par la construction |
| Deux ZIP | CRC vérifiés, version racine `0.6.0` |
| ZIP NAS source | Découverte corrigée identique au source validé |

La construction NAS a utilisé le cache de trois paquets de pilotes Debian dont l'index était
indisponible ; la vérification des bibliothèques et fonctions VA-API a réussi.
L'AppImage nécessite Linux et n'a pas été générée sous Windows.

Le correctif est côté serveur : la mise à jour de l'application Android seule ne le déploie pas.
Le serveur NAS doit passer en r4. Ce rapport, rédigé après la génération, n'est pas inclus dans
les archives déjà vérifiées.
