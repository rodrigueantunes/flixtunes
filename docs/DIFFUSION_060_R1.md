# Diffusion et télécommande — 0.6.0 r1

## Utilisation

Ouvrir FlixTunes par l’adresse locale du NAS, sélectionner un profil et lancer un film, un épisode,
une vidéo du rayon Web ou une chaîne. Le bouton **Caster** ouvre les appareils disponibles.
Choisir un appareil, puis **Diffuser ici**. Le lecteur source se met en pause après confirmation
du démarrage distant. Fermer le panneau laisse le cast actif ; **Arrêter** termine la diffusion.
Le même bouton dans l’accueil permet de piloter une lecture déjà lancée.

Pour piloter un autre lecteur FlixTunes, ouvrir l’application sur cet appareil avec le même serveur
et le même profil. Un lecteur Android est disponible tant que son activité reste visible ; il ne
constitue pas un service de réception en arrière-plan. Le profil doit avoir une session valide.

## Compatibilité

| Destination | Contrôleurs | Films, épisodes, vidéos Web | Live TV |
| --- | --- | --- | --- |
| Google Cast | Web, Windows, Linux, Android | MP4 direct si compatible, sinon HLS H.264/AAC | HLS converti par le NAS |
| DLNA MediaRenderer | Web, Windows, Linux, Android | MP4/HLS selon les formats du téléviseur | Nécessite un récepteur acceptant HLS |
| Lecteur FlixTunes | Web, Windows, Linux, Android | Lecteur existant de l’appareil cible | Lecteur existant de l’appareil cible |
| AirPlay | Safari compatible sur appareil Apple | Préparation puis menu natif Apple | Même voie, selon le récepteur |

Les vidéos Web concernées sont les médias disponibles dans le catalogue FlixTunes. Il ne s’agit
pas d’une recopie de l’écran, d’un onglet quelconque, ni d’un contournement des protections DRM.
Les sous-titres externes et le choix interactif des pistes ne sont pas transférés dans cette première
révision. La préparation utilise les préférences audio du profil et un profil de compatibilité SDR.
Un appareil DLNA découvert peut ne pas savoir lire le HLS : son nom visible ne garantit pas la lecture.

La télécommande propose pause/reprise, arrêt, volume et position pour les vidéos navigables.
AirPlay utilise également les commandes natives Apple. La pause du direct dépend du récepteur :
le flux n’est pas enregistré pour un différé illimité et une longue pause peut nécessiter de relancer
la diffusion. La fenêtre du convertisseur est d’environ 72 secondes ; une conversion sans requête
de média depuis 60 secondes est libérée. Les accès sont limités à douze heures ; relancer ensuite.

Références : [formats Google Cast](https://developers.google.com/cast/docs/media),
[bouton AirPlay Safari](https://developer.apple.com/documentation/webkitjs/adding_an_airplay_button_to_your_safari_media_controls).

## Réseau et NAS

Le NAS effectue la découverte mDNS de Google Cast et SSDP des récepteurs DLNA. L’application Web
n’a pas besoin du SDK Cast du navigateur. Les appareils doivent être joignables en IPv4 privée
depuis le NAS et pouvoir ouvrir son port HTTP. Un Wi-Fi invité isolé ou un multicast bloqué empêche
la découverte. La configuration Compose utilise déjà `network_mode: host`.

Par défaut, l’adresse du flux provient de l’adresse IP utilisée pour ouvrir FlixTunes. Si le serveur
est ouvert par un nom DNS local, définir par exemple `FLIXTUNES_CAST_BASE_URL=http://10.20.30.254:4000`.
Cette valeur doit être une origine HTTP/HTTPS à adresse IPv4 privée, sans chemin ni identifiant.
En HTTPS, l’origine annoncée et son certificat doivent être accessibles et acceptés par le récepteur.
Pour Safari ouvert en HTTPS, conserver une origine de média HTTPS afin d’éviter le contenu mixte.

Une conversion consomme les ressources du NAS. Les limites existantes de mémoire et de conversions
s’appliquent, notamment au Live TV (une conversion simultanée par défaut). Un manque de capacité
affiche une erreur et conserve la lecture locale. La source principale de la chaîne est utilisée
pour le cast ; les reprises et changements de source du lecteur local ne sont pas pilotés à distance
par le convertisseur cast.

## Protection et préservation de l’existant

- Aucune commande cast n’est exposée par l’écoute WAN. Une session de profil est requise sur le LAN.
- Les lecteurs FlixTunes nécessitent une clé propre pour publier leur état et recevoir des ordres.
  Les ordres ont une durée limitée et un accusé d’exécution ; l’envoi seul ne vaut pas réussite.
- Une URL de média aléatoire donne accès à une seule diffusion, jamais au catalogue ou à un proxy
  générique. Les droits du profil sont réévalués lors des lectures ; arrêt et expiration révoquent l’accès.
- Les commandes d’un autre profil ne peuvent pas remplacer un cast actif lancé par FlixTunes.
  Les appareils Cast/DLNA eux-mêmes restent soumis à la sécurité de leur réseau local.
- Les découvertes et réponses sont bornées. Les services DLNA doivent être à l’adresse privée qui
  répond à la découverte ; les redirections et les entités XML externes sont refusées.
- Le contrôle ne modifie pas les algorithmes de décodage/récupération Android TV ni le moteur VLC.
  Les conversions cast possèdent des identifiants distincts des lectures locales.

## Validation

Les tests automatisés couvrent le transport Cast sur une connexion TLS simulée, les refus de lecture,
les commandes, la découverte et la validation des adresses, l’isolation des profils, les flux MP4/HLS,
les plages HTTP, les droits, CORS et la conservation de la lecture locale lors d’un échec.
Les suites existantes Web, serveur, bureau et Android font partie de la validation de livraison.

La découverte réelle a identifié deux appareils Google Cast sur le LAN sans démarrer de lecture.
Les lectures sur téléviseurs physiques Google Cast, DLNA et AirPlay restent à vérifier après installation,
ainsi que la veille/réactivation du contrôleur et les pauses longues du direct. Une simulation de
protocole ne remplace pas cette qualification matérielle.
