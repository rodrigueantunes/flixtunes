# Diffusion 0.6.0 r4

## Incident et correction

Après installation de la r3, la capture Android ne montre plus que Tv Salon en DLNA.
Le point de santé du NAS confirme `0.6.0`, `packageRevision: r3` le 28 septembre 2026.

La r3 passait `{ interface: adresseLocale }` à Bonjour. Dans la version installée de
`multicast-dns`, la liaison UDP est `socket.bind(port, opts.bind || opts.interface, ...)`.
L'interface choisie pour émettre devenait donc aussi l'adresse unicast d'écoute. Sous Linux,
un socket ainsi lié ne reçoit pas les datagrammes destinés à l'adresse multicast du groupe.
La recherche pouvait émettre sans voir les réponses. Le DLNA utilise une autre voie SSDP et
restait visible, comme sur la capture.

La r4 utilise `{ bind: "0.0.0.0", interface: adresseLocale, reuseAddr: true }` : réception
multicast sur le port mDNS partagé, émission et adhésion au groupe par interface privée.
Les limites, contrôles d'adresses, identités stables et dédoublonnage r3 sont conservés.
L'écoute UDP ne publie aucun nouveau service HTTP et les contrôles de session restent identiques.

Référence de la dépendance : [multicast-dns, liaison et choix de l'interface](https://github.com/mafintosh/multicast-dns/blob/master/index.js).
Le filtrage simulé correspond à `__udp_is_mcast_sock` dans le
[code UDP du noyau Linux](https://github.com/torvalds/linux/blob/master/net/ipv4/udp.c),
qui compare l’adresse d’écoute à l’adresse de destination du paquet.
Référence de l'API : [Node.js, sockets UDP et adhésion multicast](https://nodejs.org/api/dgram.html).

## Vérification de la régression

`diffusion-multicast.test.ts` utilise les vrais Bonjour, multicast-dns et codec DNS ; seule
la livraison des datagrammes est simulée selon le filtrage d'adresse Linux. Deux tests échouent
avec la configuration r3, puis passent avec la correction. Ils vérifient la découverte réelle
par la bibliothèque, l'émission sur deux cartes, la déduplication, les retraits mDNS, le refus
d'une adresse publique et l'arrêt de la découverte. Les tests existants de découverte et DLNA
passent également, ainsi que le contrôle TypeScript.

Ce test est une simulation réseau déterministe exécutée sous Windows, pas une exécution du
noyau Linux. Il complète les essais précédents qui se limitaient aux événements Bonjour simulés
et au fonctionnement observé sur Windows.

## Essai matériel en lecture seule

Depuis le PC, la découverte corrigée retrouve Tv Salon et Pixel Tablet en Google Cast ainsi que
Tv Salon en DLNA. Les deux récepteurs Cast répondent ensuite à GET_STATUS. Aucun média ni commande
de lecture, pause, arrêt ou lancement d'application n'est envoyé lors de cet essai.

Le transfert complet depuis Android via le NAS reste à vérifier après installation de la r4.
Aucun déploiement ni redémarrage de service n'est effectué dans cette intervention. Une installation
Docker doit conserver le mode réseau hôte prévu par `compose.yaml` pour accéder au multicast LAN.

## Périmètre

Cette révision corrige uniquement la découverte côté serveur. Les transferts films, épisodes,
Web et Live TV conservent le correctif GET_STATUS et leurs chemins de lecture r3. Le bouton Cast
reste en haut à gauche ; l'envoi demeure disponible sur Android téléphone/tablette et masqué
sur Android TV. Le rendu vidéo Philips, VLC et les contrôles d'accès ne sont pas modifiés.
