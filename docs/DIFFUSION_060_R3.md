# Diffusion 0.6.0 r3

## Incident signalé

La capture Android montre `CAST_DELAI_GET_STATUS` avec « Pixel Tablet » sélectionnée.
Cette étape précède la préparation du média. Le serveur avait établi TLS, mais le transport
n'avait pas obtenu la réponse attendue à la demande d'état dans les douze secondes.
L'utilisateur n'avait pas essayé « Tv Salon » avec cette erreur.

## Défaut reproduit côté serveur

Le transport émet l'état du volume lorsqu'il reçoit `RECEIVER_STATUS`. La route de diffusion
traitait déjà cette notification, alors que sa variable média et son entrée de lecture étaient
encore absentes. La comparaison `l?.media === media` devenait `undefined === undefined`, puis
l'accès à `l.etat` levait une exception. Le signalement de cette erreur pouvait rappeler le même
observateur et lever une seconde exception, avant la résolution de la requête GET_STATUS.

Le nouveau test de route envoie le volume pendant la vérification : il échoue avant la correction
et passe après. La route conserve maintenant le volume initial sans accéder à une lecture absente.
Le transport ferme aussi proprement la liaison et rejette la requête si un observateur lève, au
lieu de laisser une exception non gérée et un délai trompeur. Le récepteur TLS simulé transmet
également le volume dans son état initial, comme les récepteurs réels.

## Modifications

- L'émetteur utilise `sender-0` pour la plateforme Cast, un message `CONNECT` enrichi
  (`connType`, `userAgent`, `senderInfo`) et un premier `PING` immédiat.
- Une notification `RECEIVER_STATUS` sans identifiant, ou avec l'identifiant zéro, peut satisfaire
  une demande de lecture de l'état. Elle doit provenir de `receiver-0` sur le canal receiver et
  viser notre émetteur ou la destination de diffusion `*`. Elle ne confirme pas une commande média.
- Les identifiants numériques encodés en texte sont acceptés. Les réponses sont corrélées aussi
  par leur espace de noms, leur source et leur destination, pas uniquement par le numéro.
- Deux essais au maximum portent maintenant sur l'ensemble TLS, ouverture du canal et état.
  Les adresses alternatives annoncées restent bornées à deux. Aucun lancement d'application,
  chargement média ou conversion n'a lieu si la vérification échoue.
- Le délai final indique combien de messages et de battements ont été reçus au dernier essai.
  Le journal serveur distingue la phase `connexion` de la phase `chargement`, sans URL média ni jeton.
- La découverte mDNS émet sur chaque interface IPv4 privée, au maximum huit. Les appareils vus
  sur plusieurs interfaces restent dédoublonnés ; ils ne disparaissent qu'après retrait de
  leurs observations restantes. Les sockets et navigateurs sont fermés à l'arrêt.

Les échanges ont été comparés au
[code du canal Cast de Chromium](https://github.com/chromium/chromium/blob/main/components/media_router/common/providers/cast/channel/cast_message_util.cc)
et au [transport PyChromecast](https://github.com/home-assistant-libs/pychromecast/blob/master/pychromecast/socket_client.py).
Les tests du récepteur TLS utilisent désormais un codec de fixture indépendant de celui de
production, pour éviter qu'une erreur commune à l'encodage et au décodage ne passe inaperçue.

## Récepteur Web

La première construction complète a révélé une erreur asynchrone Vitest dans la boucle de
réception Web : accès à un import avant initialisation. L'état passif du lecteur est désormais
séparé des modules React et des modules chargés à la demande. Les réponses arrivant après l'arrêt
ne réinscrivent plus l'ancien profil et ne déclenchent pas de lecture. Deux tests couvrent ces
réponses tardives, en plus des tests de transfert et de refus déjà présents.

## Vérifications matérielles et limites

Depuis le PC de développement, la découverte par défaut ne trouvait aucun appareil. Une recherche
sur son interface LAN explicite a trouvé Pixel Tablet et Tv Salon. Tous deux ont répondu à la
demande d'état, sans lancement d'application ni de média. Le transport r2 et le transport r3 ont
ensuite été vérifiés sur ces deux récepteurs : les deux versions ont réussi à lire leur état.
La nouvelle classe de découverte par interface a également retrouvé Pixel Tablet, suivie d'une
vérification d'état réussie par le transport r3.

Ces observations ne reproduisent pas le trajet NAS → récepteur qui a échoué sur la capture.
Le défaut serveur décrit plus haut est reproduit par les tests et cohérent avec ce symptôme ;
son effet sur l’appareil depuis le NAS reste à confirmer après installation. Le NAS répondait en r2 pendant
l'intervention ; aucun paquet n'a été installé et aucun service n'a été redémarré.
Les tests de lecture réelle, du transfert depuis Android et de la continuité restent à effectuer
depuis le NAS après installation. La r3 corrige les fragilités identifiées, sans promettre que
tout appareil ou tout réseau acceptera le cast.

## Contenus et appareils

Films, épisodes, vidéos Web et Live TV conservent les voies Google Cast, DLNA et lecteur FlixTunes.
AirPlay reste disponible depuis Safari compatible sur un appareil Apple. Les conversions de
compatibilité et les autorisations par profil sont conservées. Le direct dépend toujours du
tampon et des commandes acceptées par le récepteur.

L'icône reste en haut à gauche. Android téléphone et tablette conservent l'envoi ; Android TV
conserve la réception et le pilotage distant, avec le bouton d'envoi masqué. Aucun changement
du moteur vidéo local, des reprises Philips ou de VLC n'est introduit par cette révision.
