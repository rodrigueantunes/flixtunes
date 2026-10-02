# Diffusion 0.6.0 r6

## Constat et essais matériels

Le serveur NAS a été observé en r5. Les derniers journaux montraient le chargement du manifeste
et du premier segment, suivi de relectures du manifeste sans progression des segments. La Pixel
Tablet confirmait sa connexion mais ne signalait plus de session active lors du diagnostic.

Des essais réseau ont été effectués sur la Pixel Tablet depuis un serveur de test temporaire
sur le PC, sans installation sur le NAS :

- Mire H.264/AAC en MP4 puis HLS : lecture et progression confirmées par le récepteur.
- Extrait de 60 secondes du fichier concerné, ouvert en lecture seule : le profil 1080p H.264
  est refusé, tandis que le profil 720p démarre et progresse.
- Après correction de la confirmation, le même profil 720p n'est annoncé en lecture qu'après
  progression effective, observée ensuite jusqu'à environ 27 secondes.
- Essai source : HEVC Main 10, 3840 × 2160, HDR PQ/BT.2020, vidéo copiée en fMP4. FFprobe et
  FFmpeg lisent correctement la sortie HTTP. La Pixel Tablet refuse toutefois cette présentation
  dans le lecteur Cast ; ce récepteur ne valide donc pas la lecture 4K HDR de cet extrait.

Ces observations concernent le média et le lecteur Cast testés, et ne constituent pas une
limitation générale de tout le matériel de la tablette. La 4K n'est pas déclarée universellement
compatible et aucun essai matériel 4K réussi sur un autre récepteur n'est revendiqué.

## Parcours de qualité

Les fichiers films, épisodes et vidéos Web partagent le même parcours : essai source jusqu'à
3840 × 2160, puis 1080p H.264/AAC SDR, puis 720p compatible. La définition d'origine n'est jamais
augmentée. Le premier essai est écarté si le moteur devrait réencoder l'image : il ne déclenche
pas une conversion 4K coûteuse. Le moteur existant gère la sélection audio et le remux HDR.

Le Live TV tente la copie vidéo et l'encodage audio AAC dans un HLS fMP4, puis le profil compatible
720p s'il échoue. Le chemin source conserve la définition, la cadence et les données vidéo ;
les sources initialement SD/HD ne deviennent donc pas artificiellement 4K. La copie garde une
fenêtre de 18 segments et un plafond de stockage de 1 Gio ; le mode compatible garde ses limites
précédentes. Le répertoire de travail du processus est celui de la session, afin que init.mp4
soit servi avec ses segments. Les clients locaux continuent d'utiliser leur parcours précédent.

Le HEVC est envoyé en fMP4, avec les indications de format du message Cast, et jamais en MPEG-TS :
[formats pris en charge par Google Cast](https://developers.google.com/cast/docs/media).
La confirmation porte sur une lecture effective, pas sur la seule acceptation de LOAD. Elle exige
le contentId attendu, la session correspondante et une avancée supérieure à 0,5 seconde. Un état
PLAYING figé pendant plus de 20 secondes devient une erreur ; les pauses ne sont pas confondues
avec un blocage. Le panneau Android affiche les erreurs reçues même après la commande initiale.

## Limites et validation

La préparation vidéo attend six secondes de contenu ou ENDLIST pour un extrait plus court.
Les tentatives sont bornées : trois profils pour les fichiers, deux pour le Live TV. Chaque essai
révoque les ressources précédentes. Les refus de capacité restent bloquants. Le délai client
Android de commande Cast est adapté à cette succession, sans changer les requêtes ordinaires.

Les tests couvrent les notifications périmées, le chargement sans progression, les sessions vides,
les erreurs, les pauses, les profils source, les limites de repli et la libération des ressources.
Le banc FFmpeg réel contrôle les sorties SD, 4K source, 1080p et 720p via HTTP. Un test de vrai
Live HLS contrôle le remux fMP4, init.mp4, le décodage par HTTP et l'isolation des profils.

La vitesse du NAS et une lecture prolongée Android → NAS → récepteur doivent encore être vérifiées
après mise à jour. Le rendu vidéo Android TV/Philips et VLC n'est pas modifié. Aucun serveur ou
client n'est installé automatiquement. Le rapport de livraison détaillera les résultats finaux.
