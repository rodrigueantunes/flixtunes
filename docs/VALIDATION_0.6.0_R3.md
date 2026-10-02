# Validation de la livraison 0.6.0 r3

Date : 27 septembre 2026. Construction complète par `tools/Build-Release.ps1`, version
0.6.0, révision r3, dans `C:/src/flixtunes-060-r1`. Résultat final : code 0.
Aucun paquet installé, aucun service de production redémarré.

## Résultats

- TypeScript : vérifications des projets réussies.
- Serveur : **1 190 tests réussis**, 2 ignorés par la suite existante.
- Web : **358 tests réussis**, sans erreur asynchrone non gérée.
- Bureau : **30 tests réussis**.
- Android : **270 tests réussis**, 43 suites, aucun échec, erreur ou test ignoré.
- Total : **1 848 tests réussis**.
- Android lint : **0 erreur, 56 avertissements**. APK debug signé et release non signé construits.
- Budgets Web respectés : entrée 96,0 Kio gzip, CSS 17,8 Kio, modules différés 217,6 Kio.
- Les 14 fichiers de code, tests et notes modifiés pour la r3 sont identiques entre le partage
  et la copie de construction ; UTF-8 strict, sans BOM ni caractère de remplacement.

La validation finale utilise un répertoire de données de test neuf, hors du projet. Des données
résiduelles d'une précédente exécution interrompue avaient fait échouer deux assertions de
marqueurs sonores ; la suite ciblée puis la suite complète passent avec les données isolées.
Aucune base de production n'a été modifiée.

## Régression GET_STATUS

Le nouveau test transmet le volume initial du récepteur avant la création de la lecture.
Avant correction, la route accède à `l.etat` alors que `l` est absent : les tests de route
échouent. Après correction, les quatre tests de route passent. Les treize tests du transport
Cast sur TLS simulé passent également, notamment la notification de volume, les réponses
sans identifiant, la nouvelle tentative complète et l'échec contrôlé d'un observateur.

Le récepteur simulé emploie un codec indépendant du code de production. Les notifications
de statut ne peuvent pas confirmer arbitrairement une commande média. Les essais de connexion
restent bornés et un échec de vérification ne lance ni application distante ni conversion.

Le récepteur Web dispose de deux nouveaux tests couvrant les réponses arrivées après son
arrêt : pas de réinscription d'un ancien profil ni de lancement de contenu tardif. La séparation
de l'état passif du lecteur corrige l'erreur d'import asynchrone révélée par la première construction.

## Vérifications sur le réseau local

Depuis le PC de développement, la découverte sur l'interface LAN a trouvé Pixel Tablet et
Tv Salon. Tous deux ont répondu à GET_STATUS avec les transports r2 et r3, sans lancement
ou arrêt d'application, sans chargement de média. Le nouveau service de découverte par
interface a aussi retrouvé Pixel Tablet, puis sa vérification d'état a réussi.

Ces vérifications n'exécutent pas la route serveur défectueuse avec son observateur de lecture.
Elles confirment la communication depuis le PC, pas le transfert complet depuis le NAS.
Le défaut serveur est reproduit par les tests ; la lecture physique depuis Android via le NAS
reste à confirmer après installation. Le serveur NAS était encore en r2 pendant l'intervention.

Les chemins films, séries, Web et Live TV ainsi que Google Cast, DLNA et les lecteurs FlixTunes
sont conservés. AirPlay demeure lié à Safari compatible sur Apple. Aucun changement du rendu
vidéo Android/Philips ou du moteur VLC n'est introduit dans cette révision.

## Livrables et intégrité

Les six fichiers et `SHA256SUMS-0.6.0.r3.txt` sont déposés dans le dossier partagé `artifacts`.
Toutes les empreintes SHA-256 ont été vérifiées avant copie puis après relecture du partage.
Le manifeste copié a également été vérifié.

| Livrable | Vérification |
| --- | --- |
| Android | `tv.flixtunes.app`, version `0.6.0.r3`, code `60003` |
| Windows MSI | `ProductVersion=0.6.0.0`, fichier de livraison `0.6.0.r3` |
| Linux DEB | `Version: 0.6.0.r3`, archive ar valide, métadonnées en LF |
| ASUSTOR | APKG 2.0 validé par la construction |
| Deux ZIP | CRC vérifiés, version racine `0.6.0` |
| ZIP NAS source | Route Cast corrigée identique au fichier source validé |

La construction NAS a utilisé le cache de trois paquets de pilotes Debian lorsque leur index
était indisponible. Le contrôle des bibliothèques et fonctions VA-API a réussi.
L'AppImage nécessite Linux et n'a pas été générée sous Windows.

Le correctif principal étant côté serveur, installer uniquement l'application Android ne suffit
pas : le serveur NAS doit également passer en r3. Aucun déploiement n'a été effectué ici.
Ce compte rendu est ajouté après la génération et ne figure pas dans les archives déjà vérifiées.
