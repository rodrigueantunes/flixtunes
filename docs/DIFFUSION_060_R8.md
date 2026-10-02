# Diffusion 0.6.0 r8 — stable, et qui prend le dessus

*Analyse du 2 octobre 2026, sur les essais de la r7 relevés dans le journal du NAS.*

## Ce que montrent les essais de ce soir

| Récepteur | Résultat r7 |
| --- | --- |
| Tv Salon, Philips Google TV (`TA5`), Cast | film 4K HDR en copie de source, lecture confirmée |
| 58PUS7304, Philips Android TV 2019 (`TPM191E`), Cast | copie de source en échec, 720p lu, puis échecs en série jusqu'au redémarrage |
| 58PUS7304, DLNA | trois échecs sans une seule requête vers le NAS |
| Un second renderer DLNA | lu en copie de source |

### Le téléviseur qu'il fallait redémarrer

Relevé sur le 58PUS7304, une heure après les essais : son lecteur Cast affichait encore
« Casting: The Mandalorian and Grogu », en chargement à 0 s, sur une adresse de flux que le NAS avait
révoquée après l'échec, avec l'erreur 310. **Le serveur libère sa conversion et ferme sa connexion,
mais ne dit jamais au téléviseur d'arrêter.** Le lecteur tourne alors en boucle sur un flux mort, et
chaque envoi suivant tombe dans ce lecteur bloqué : `CAST_DEMARRAGE`, puis `CAST_MEDIA_100`.

Un simple arrêt de l'application Cast (`STOP` sur la session du récepteur) l'a rendu à son écran
d'accueil, sans redémarrage. Rejoué ensuite depuis le PC, le même film en copie de source a démarré
en 10,7 s sur ce téléviseur : le format n'était pas en cause, ni le NAS, qui copie la source à 13×
puis 2× le temps réel.

### Le DLNA qui ne demandait rien

Le 58PUS7304 déclare `audio/x-mpegurl` (une liste audio) parmi ses formats. La r7 y a vu du HLS
vidéo et lui a envoyé un flux qu'il ne lit pas. Il déclare en revanche le MKV, le MP4 et le MPEG-TS :
il peut lire le fichier du film tel quel, avec le déplacement natif du téléviseur.

### La chaîne matérielle sur le NAS

Mesurée au démarrage : HEVC 4K → 720p à 9 im/s par le circuit vidéo, 41 im/s par le processeur avec
`tonemapx`. La qualification a fait son travail : le chemin matériel n'est pas retenu pour le HDR, le
sera pour le SDR (114 im/s).

## Plan de la r8

### 1. Le téléviseur n'est jamais laissé bloqué

- Tout échec, abandon, annulation ou arrêt envoie au téléviseur l'arrêt du média, puis la fermeture de
  l'application Cast quand la lecture n'a pas abouti. Une conversion n'est révoquée qu'après.
- Avant un envoi, un lecteur Cast déjà ouvert dans un état douteux — erreur, chargement figé, média
  qui n'est pas le nôtre — est fermé et relancé. **La diffusion prend le dessus** sur ce qui occupe le
  téléviseur, comme YouTube, au lieu de s'y glisser.
- Un bouton « Réinitialiser le téléviseur » dans la télécommande ferme son application Cast, même
  sans diffusion connue du serveur — après un redémarrage du NAS, par exemple.
- Un vrai essai qui échoue corrige la sonde, même lentement : un récepteur qui ne lit pas une copie
  4K ne se la voit plus proposer en premier.

### 2. DLNA : le fichier tel quel quand le téléviseur sait le lire

- Détection du HLS corrigée : seules les listes vidéo comptent.
- Le fichier d'origine est servi directement quand le téléviseur déclare son conteneur (MKV, MP4,
  MPEG-TS), avec le déplacement natif.
- Sinon, conversion en MPEG-TS continu, avec les en-têtes DLNA (`contentFeatures`, `transferMode`).
- Arrêt envoyé au téléviseur sur tout échec.

### 3. Voir ce qui est diffusé, comme sur YouTube

- Le téléviseur affiche l'affiche, le titre, l'épisode ou la chaîne, et la durée, au lieu d'un titre
  seul : métadonnées Cast de film, d'épisode ou de direct, et pochette DLNA.
- La télécommande montre la même affiche sur le téléphone, la tablette et le Web.
- *(à confirmer)* Tous les appareils FlixTunes du réseau voient la diffusion en cours et peuvent la
  piloter, comme YouTube le fait pour tous ses téléphones.

### 4. Toutes les destinations

- Google Cast et DLNA : ci-dessus.
- Lecteurs FlixTunes (Android TV, téléphones, Web, bureau) : réception confirmée, état et étapes
  comme pour un téléviseur.
- AirPlay : depuis Safari uniquement. Apple ne laisse pas un serveur ou une application Android
  envoyer vers un Apple TV sans son appairage propriétaire ; je ne le promets donc pas ailleurs.

### Mesures attendues

- Après un échec volontaire (flux coupé), le téléviseur revient à son écran sans intervention, et
  l'envoi suivant démarre.
- Trente envois successifs sur Tv Salon, le 58PUS7304 et la tablette, alternés avec des arrêts et des
  annulations : aucun téléviseur à redémarrer.
- DLNA du 58PUS7304 : film 4K lu tel quel, déplacement compris.

## Décision du 2 octobre 2026

« Voir le média partagé comme YouTube » : **la diffusion se voit de tous les appareils FlixTunes du
réseau**, quel que soit le profil, et chacun peut la piloter. Un nouvel envoi d'un autre profil
remplace celle en cours au lieu d'être refusé ; le nom du profil qui a lancé la diffusion
l'accompagne. Le téléviseur affiche aussi l'affiche, le titre, l'épisode ou la chaîne.

## Construit et mesuré

- Arrêt, échec, abandon, annulation et expiration rendent le téléviseur libre : arrêt du média, puis
  fermeture de l'application Cast, ou `Stop` en DLNA. Le flux n'est révoqué qu'après.
- Un lecteur Cast trouvé en chargement ou en erreur est fermé et relancé avant l'envoi. Rejoué en
  recréant la panne de ce soir sur le 58PUS7304 (lecteur laissé sur une adresse morte) : la diffusion
  suivante a démarré, et « Arrêter » a rendu le téléviseur à son écran.
- « Réinitialiser le téléviseur », dans la télécommande Web et Android, ferme son application Cast
  même sans diffusion connue du serveur.
- La sonde commence par le HEVC 4K HDR10 et s'arrête là s'il est lu : un seul clip au lieu de trois
  sur la plupart des téléviseurs.
- DLNA du 58PUS7304 : le MKV 4K HDR du film est servi tel quel, confirmé en 6,1 s, pause, reprise et
  déplacement compris.

Endurance, vrai code du serveur sur le PC :

| Récepteur | Cycles | Échecs |
| --- | --- | --- |
| Pixel Tablet, Cast | 8 | 0 |
| 58PUS7304, Cast | 4 | 0 |
| 58PUS7304, DLNA | 4 | 0 |

Chaque série enchaîne arrêt, annulation en pleine préparation, remplacement par un autre média et
réinitialisation. Aucun récepteur n'est resté bloqué.

Tv Salon était en veille : la lancer l'aurait allumée. Elle a réussi la copie 4K HDR en r7 ce soir.
