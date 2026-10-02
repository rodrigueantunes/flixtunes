# Validation de la livraison 0.6.0 r2

Date : 27 septembre 2026. Construction complète par `tools/Build-Release.ps1` dans
`C:/src/flixtunes-060-r1`, terminée avec le code 0. Aucun paquet installé ni service redémarré.

## Résultats

- TypeScript : vérifications de tous les projets réussies.
- Serveur : **1 181 tests réussis**, 2 ignorés par la suite existante.
- Web : **356 tests réussis**.
- Bureau : **30 tests réussis**.
- Android : **270 tests réussis**, 43 suites, aucun échec ni test ignoré.
- Total : **1 837 tests réussis**.
- Android lint : **0 erreur, 56 avertissements**. APK debug signé et release non signé construits.
- Budgets Web respectés : entrée 96,0 Kio gzip, CSS 17,8 Kio, modules différés 217,6 Kio.
- En-tête extrait du composant réel vérifié dans Opera GX sans interface visible, à 320, 390,
  1 280 et 1 920 pixels : bouton Cast à gauche et commandes dans la largeur disponible.
  Le panneau de diffusion a également été ouvert et contrôlé visuellement.
- Fichiers modifiés pour les commandes Cast et les notes r2 validés en UTF-8 strict, sans BOM
  ni caractère de remplacement ; copie locale identique aux sources partagées.

## Périmètre Cast

Les tests ciblés couvrent les échanges TLS avec un récepteur Cast simulé, les refus explicites,
la reconnexion, le lancement différé du lecteur, la réutilisation d'une application existante,
les messages binaires et les erreurs de décodage. Ils couvrent aussi les mises à jour mDNS,
les appareils DLNA imbriqués, la position DLNA indisponible, le repli de format, les sources
Live TV alternatives et la révocation des accès média après un échec.

Les tests AirPlay vérifient notamment le remplacement de l'accès média lors d'un nouvel essai,
sans vider la nouvelle URL ni déclencher une lecture locale cachée.

L'icône Cast remplace la commande textuelle et figure en haut à gauche de l'accueil et des
lecteurs. Sur Android, le bouton est masqué selon le mode système `UI_MODE_TYPE_TELEVISION`,
sans se baser sur la largeur : les téléphones et tablettes conservent l'envoi. L'attachement
de `TelecommandeAndroid` reste présent pour recevoir et exécuter les commandes sur Android TV.
Les mécanismes de rendu vidéo et de reprise Philips ne sont pas modifiés par ce déplacement.

## Livrables

Six fichiers et `SHA256SUMS-0.6.0.r2.txt` ont été copiés dans `artifacts`. Chaque empreinte a été
vérifiée avant la copie puis par relecture du fichier sur le partage.

| Livrable | Vérification |
| --- | --- |
| Android | Manifeste `0.6.0.r2`, code `60002`, application `tv.flixtunes.app` |
| Windows MSI | `ProductVersion=0.6.0.0`, nom de livraison `0.6.0.r2` |
| Linux DEB | `Version: 0.6.0.r2`, archive ar valide, `debian-binary` et contrôle en LF |
| ASUSTOR | APKG 2.0 validé par la chaîne de construction |
| Deux archives ZIP | CRC vérifiés et version racine `0.6.0` |

La construction NAS a utilisé le cache de trois paquets de pilotes Debian lorsque leur index
était indisponible ; le contrôle des bibliothèques et fonctions VA-API a réussi.
L'AppImage nécessite une construction Linux et n'a pas été générée sous Windows.

## Limites

L'incident initial « cast impossible » depuis Android n'a pas été reproduit sur le récepteur
physique concerné : son modèle, le contenu et le détail d'erreur n'ont pas été fournis.
La découverte locale n'a trouvé aucun récepteur pendant cette intervention, et l'accès SSH
au NAS n'était pas disponible avec l'authentification existante.

La lecture réelle Google Cast, DLNA et AirPlay, ainsi que le fonctionnement sur le téléviseur
Philips, restent à confirmer après mise à jour du serveur et des clients. Les tests automatisés
ne garantissent pas la compatibilité avec tous les formats, réseaux ou appareils.

Voir [DIFFUSION_060_R2.md](DIFFUSION_060_R2.md) pour les nouveaux comportements et les codes d'erreur.
