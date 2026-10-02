# Diffusion 0.6.0 r2

Cette révision traite les échecs génériques de cast signalés depuis Android. Le récepteur exact,
le contenu et le code de l’incident initial n’étant pas connus, la cause de cet incident particulier
n’est pas confirmée. Plusieurs défauts vérifiables de la r1 ont été corrigés et couverts par des tests.

## Changements

Google Cast vérifie sa connexion avant de préparer un média. Une rupture avant la connexion TLS
est retentée une fois, éventuellement sur la seconde adresse privée annoncée par le même appareil.
Les mises à jour mDNS du port et de l’adresse sont prises en compte après un réveil ; l’identité
du récepteur reste stable. Un lecteur Google Cast déjà disponible est réutilisé. Le démarrage
asynchrone est suivi avant d’envoyer LOAD, et une erreur de décodage est rendue immédiatement.

Un refus média Google Cast ou DLNA peut déclencher une seconde préparation en H.264/AAC SDR.
Le flux refusé est révoqué et sa conversion libérée. Il n’y a pas de boucle infinie de conversions.
Une panne de connexion Cast n’entraîne pas de conversion. Les limites de capacité du NAS continuent
de s’appliquer ; les reprises et moteurs des lecteurs locaux restent inchangés.

Le Live TV tente au plus trois sources lorsque la préparation d’une source échoue, dans un budget
de 45 secondes (le nettoyage de la conversion peut dépasser légèrement ce budget). Un manque
de capacité arrête immédiatement les tentatives. Le direct reste limité au tampon du récepteur.

DLNA accepte les descriptions de périphériques imbriqués et URLBase, tout en vérifiant que les
services restent sur la même adresse privée. Les entités XML prédéfinies sont décodées, mais toute
déclaration DOCTYPE/ENTITY reste interdite. GetPositionInfo peut manquer sans invalider une lecture
confirmée. Seek est envoyé après PLAYING, avec une reprise bornée pour l’erreur transitoire 701.

AirPlay affiche les erreurs média, permet un nouvel essai compatible et laisse annuler un accès
préparé avant même la sélection d’un récepteur. Le menu natif Safari reste nécessaire pour choisir
l’appareil. La nouvelle URL n’est pas effacée par le nettoyage de l’ancienne lecture.

## Adresse du NAS et erreurs

Quand FlixTunes est ouvert en HTTP par un nom local que la TV peut ne pas résoudre, le serveur
peut annoncer l’adresse privée de sa socket d’écoute. `FLIXTUNES_CAST_BASE_URL` garde la priorité.
En HTTPS, aucune substitution silencieuse par une IP susceptible d’invalider le certificat n’est faite.
Les commandes restent limitées au LAN et les accès média restent temporaires et révocables.

| Code ou message | Sens et vérification utile |
| --- | --- |
| CAST_CONNEXION_ECONNREFUSED | Le récepteur refuse la connexion depuis le NAS : vérifier qu’il est allumé et que son service Cast est actif. |
| CAST_CONNEXION_DELAI | Pas de réponse à la connexion : vérifier la communication entre le NAS et le réseau du récepteur. |
| CAST_CONNEXION_EHOSTUNREACH / ENETUNREACH | Route réseau indisponible depuis le NAS. |
| CAST_LANCEUR / CAST_DELAI_LAUNCH | Le lecteur Cast ne devient pas disponible. |
| CAST_LOAD_FAILED / CAST_MEDIA | Le récepteur refuse le média ou échoue à le lire ; le repli compatible est essayé une fois. |
| Aucun média demandé au NAS | Pendant la tentative, le récepteur n’a effectué aucune requête sur son accès média. Vérifier l’adresse annoncée et le port du NAS. Ce constat n’établit pas à lui seul la cause réseau. |
| DLNA_701 | État transitoire incompatible avec une commande ; le déplacement initial peut être réessayé une fois. |

Les journaux de refus média contiennent le protocole, le code, le nombre de requêtes média et la
décision de repli, sans URL de fournisseur ni jeton du profil.
Sur Android, les préparations de cast peuvent attendre jusqu’à six minutes pour laisser se terminer
les phases et le repli ; les requêtes de suivi sont limitées à quinze secondes. Le lecteur local
continue jusqu’à confirmation du transfert. Un délai plus long ne garantit pas qu’un appareil
injoignable finira par répondre.

## Validation ciblée

Tests TLS Cast : refus, connexion interrompue puis rétablie, lecteur déjà disponible, lancement
en plusieurs étapes et échec de décodage. Tests supplémentaires : mise à jour mDNS, DLNA imbriqué,
position DLNA indisponible, repli de format, libération des ressources, sources Live TV alternatives,
conservation de la limite de capacité et remplacement d’un accès AirPlay sans lecture cachée.

Les essais sur les récepteurs physiques concernés restent à effectuer. Une découverte en lecture
seule depuis le poste de développement n’a trouvé aucun récepteur lors de cette intervention ;
l’accès SSH au NAS n’était pas disponible avec l’authentification existante. Le serveur NAS répondait
en 0.6.0 r1 au début de l’intervention. Aucune installation ni modification réseau n’a été faite.

## Commande dans les clients

- **Commande Cast à gauche.** Icône dans le coin supérieur gauche de l’accueil et des lecteurs.
  Sur Android TV, la commande d’envoi est masquée ; la réception et le pilotage depuis un
  téléphone ou une tablette restent disponibles.
