# Diffusion 0.6.0 r7 — un cast qui démarre, et vite

*Analyse et plan du 2 octobre 2026. Le NAS répond en `0.6.0` / `r6`.*

## Constat mesuré

### Ce que la r6 fait réellement sur le NAS

Le journal du NAS montre deux essais r6 sur la Pixel Tablet, avec le même film : *The Mandalorian
and Grogu*, en HEVC Main 10, 3840 × 2160, Dolby Vision profil 8 sur une base HDR10, avec de l'audio
E-AC-3. Les deux essais ont échoué sur les trois niveaux :

| Niveau | Résultat | Requêtes média |
| --- | --- | --- |
| Source (HEVC copié, fMP4) | `CAST_MEDIA` en 2 s | 3 |
| 1080p H.264 | `CAST_DEMARRAGE` puis `CAST_MEDIA` | 2 |
| 720p H.264 | `CAST_DEMARRAGE` | 17 et 21 |

Le diagnostic de conversion du NAS (`/api/system/playback`, `recentFailures`) en donne la cause :
chaque conversion HDR commence par `-init_hw_device vulkan=flixvk` et échoue aussitôt, sur
« Unable to open the libvulkan library ». Le tone mapping retenu est `libplacebo`.

Le NAS avait pourtant mesuré que `libplacebo`, `tonemap_vaapi` et `tonemap_opencl` sont
inutilisables, et désigné le logiciel. Mais cette mesure n'est lue que lorsque le rapport de
capacité est ouvert. Après un redémarrage, `calibratedToneMapping()` rend `null`, et le choix
automatique prend `libplacebo` dès que le filtre figure dans la compilation. Le repli qui suit
abandonne alors **aussi** l'encodeur `h264_vaapi`, qui fonctionne : décodage, tone mapping et
encodage passent tous en logiciel.

Mesuré par l'API du NAS, sur le même film, avec le tone mapping logiciel et `h264_vaapi` :
**0,33× le temps réel** en 1080p. Le récepteur reçoit ses premiers segments, puis attend les suivants
indéfiniment. C'est exactement « 17 requêtes, aucune progression ».

### Ce que le récepteur accepte

Banc matériel sur la Pixel Tablet, depuis le PC. Le banc emploie le vrai code de préparation et le
vrai transport Cast du serveur :

| Flux | Pixel Tablet |
| --- | --- |
| MP4 H.264 1080p, lecture directe | lu, démarré en 1 à 3 s |
| HLS H.264 1080p (TS ou fMP4, High ou Main, mire ou film, VOD complet) | **`LOAD_FAILED` au premier segment** |
| HLS H.264 720p, même au niveau 4.0 | lu |
| HLS HEVC 4K HDR10 en fMP4 | `LOAD_FAILED` |
| Liste maîtresse 1080p + 720p | le récepteur écarte le 1080p seul, joue le 720p |
| Clips de sonde noirs de 2 s (17 à 25 Ko) | verdict en 0,4 à 0,6 s |

La r6 essayait donc à l'aveugle un 1080p que ce récepteur ne lira jamais, en payant une conversion
complète à chaque niveau.

### Ce que voit la personne

La commande `charger` est une requête HTTP qui dure toute la préparation. Android lui accorde dix
minutes. L'écran affiche « En attente du récepteur… », sans étape, sans qualité visée et sans
possibilité d'annuler. Une fois la diffusion lancée, le lecteur local est mis en pause, et la
télécommande n'existe que dans le panneau.

## Architecture de la r7

### 1. Le moteur de conversion choisit ce qui marche

- La mesure du tone mapping est relue en base au démarrage. Un chemin matériel jamais mesuré n'est
  plus retenu d'office : sans mesure, le choix se fait en logiciel.
- Un nouveau tone mapping, `tonemapx`, est mesuré comme les autres. C'est le filtre SIMD que
  Jellyfin développe pour son FFmpeg, présent dans la version embarquée 7.1.4. Il convertit
  correctement le PQ en BT.709, ce que le chemin « logiciel » actuel ne fait pas, puisqu'il applique
  `tonemap` sans linéariser.
- **Décodage matériel pour la diffusion.** Le circuit vidéo décode le HEVC 10 bits et réduit l'image
  (`scale_vaapi`). Le tone mapping se fait ensuite sur l'image déjà réduite, puis `h264_vaapi`
  l'encode. Ce chemin est qualifié par un micro-banc sur le NAS au calibrage, sur une mire HEVC 4K
  HDR10. Il n'est retenu que s'il fonctionne et va plus vite ; sinon, c'est le chemin d'avant.
- L'échec d'un filtre matériel ne fait plus abandonner l'encodeur matériel. Le second essai retire
  seulement ce qui a échoué.

### 2. Le serveur connaît le récepteur avant de convertir

- **Sonde de capacités.** Au premier cast vers un récepteur Google Cast, le serveur lui envoie trois
  clips noirs embarqués : HLS H.264 1080p, HLS HEVC 1080p SDR et HLS HEVC 4K HDR10. Cela prend
  environ 2 s. Le verdict est conservé en base, par récepteur, et refait si le modèle ou son
  micrologiciel change.
- **Plan de qualité.** La source n'est copiée que si le récepteur accepte son codec, sa définition et
  son HDR. Sinon, la conversion vise directement la plus haute définition acceptée : 720p pour la
  Pixel Tablet. Le repli reste en place si un essai échoue malgré tout, et son verdict met la sonde à
  jour.
- **Codes d'erreur détaillés.** Les `detailedErrorCode` et motifs du récepteur sont gardés dans
  l'erreur et dans le journal.
- **DLNA.** `GetProtocolInfo` dit quels formats le téléviseur accepte. S'il refuse le HLS, la
  conversion est servie en flux MPEG-TS continu, que presque tous les téléviseurs DLNA lisent.

### 3. Une diffusion qui se suit et s'annule

- `charger` répond tout de suite (202) quand le client le demande. L'état de la cible porte alors une
  **étape** — connexion, sonde, préparation, démarrage — et la qualité visée. « Arrêter » annule une
  préparation en cours et libère la conversion. Les anciens clients gardent la réponse synchrone.
- Un déplacement **dans la partie déjà convertie** est envoyé au récepteur, sans relancer de
  conversion. Hors de cette partie, la conversion repart à la nouvelle position, comme avant.
- **Fin et reprise par un tiers.** La fin du média marque la progression comme terminée et libère la
  conversion. Une autre application qui prend le récepteur fait passer la diffusion au repos, sans
  la déclarer en erreur.
- La découverte démarre avec le serveur : la liste est prête à la première ouverture du panneau.
- Les battements des lecteurs FlixTunes, un toutes les deux secondes, ne sont plus journalisés. Le
  journal du NAS pèse 940 Mo, et ces battements en sont l'essentiel.

### 4. Le cast se pilote là où on regarde

Pour le Web, le bureau Windows/Linux, Android téléphone et tablette :

- Le bouton Cast montre qu'une diffusion est active, et sur quel appareil.
- Pendant la préparation, le panneau affiche l'étape en cours et un bouton « Annuler ».
- **Le lecteur devient la télécommande.** Après le transfert, le lecteur affiche « Lecture sur
  Tv Salon ». Lecture, pause, barre de progression et volume pilotent le récepteur.
  « Reprendre ici » arrête le cast et reprend la lecture locale à la position du récepteur.
- **Mini-télécommande sur l'accueil** tant qu'une diffusion est active.
- Sur Android, les touches de volume règlent le récepteur pendant la diffusion.
- Android TV reste récepteur et télécommande ; l'envoi depuis la télévision n'est pas demandé.

## Décisions

- **Le cast reste piloté par le NAS sur tous les clients, Android compris.** Le SDK Google Cast
  Android apporterait la notification système, mais il ouvrirait une seconde voie Google Cast. Le NAS
  ne verrait plus les diffusions lancées par Android, ne pourrait ni enregistrer leur progression ni
  les piloter depuis le Web, et la sonde comme la préparation seraient à dupliquer. Une seule voie se
  teste et se répare une fois.
- **Sonde plutôt que liste maîtresse.** La liste maîtresse laisse le récepteur choisir, mais elle
  oblige à produire toutes les variantes, ou à les produire au fil des demandes. Sur le Celeron, c'est
  doubler une conversion déjà coûteuse. La sonde dit en 2 s ce qu'il faut produire, et ne le dit
  qu'une fois par récepteur.
- **Le décodage matériel est limité à la diffusion.** Les lectures locales gardent leur chemin
  actuel, qui est éprouvé. Le correctif du tone mapping, lui, vaut pour toutes les conversions : la
  sélection de `libplacebo` sans mesure est un défaut, quel que soit le client.

## Cas limites

- Un récepteur éteint ou parti entre la sonde et le chargement : erreur de connexion, aucune
  conversion lancée.
- Un récepteur qui lit déjà une autre application : la sonde le prend, comme le ferait le chargement.
  On ne sonde qu'au moment où la personne choisit de diffuser sur lui.
- Une sonde contredite par un essai réel, par exemple après une mise à jour du récepteur : l'essai
  fait foi, et le verdict est corrigé.
- Un NAS dont le décodage matériel échoue en cours de conversion : second essai sans décodage
  matériel, comme pour tout filtre matériel.
- Le direct : la copie vidéo n'est tentée que si la définition de la source tient dans ce que le
  récepteur accepte. Sinon, la conversion compatible est lancée d'emblée.
- Plusieurs clients ouverts sur le même profil : l'état et l'étape viennent du serveur. Tous les voient
  et peuvent annuler.

## Preuves attendues

- Tests unitaires : relecture du calibrage, choix sans mesure, repli qui garde l'encodeur, chaîne de
  filtres matérielle, plan de qualité selon la sonde, cache de sonde, réponse asynchrone, annulation,
  déplacement dans la fenêtre convertie, fin de média, reprise par un tiers, DLNA par protocole.
- Banc matériel Pixel Tablet, avec le vrai code : film 4K HDR, film 1080p, vidéo Web, chaîne du
  direct. Démarrage confirmé, progression, pause, déplacement, arrêt.
- Tv Salon, s'il est allumé pendant les essais : même banc, en Google Cast et en DLNA.
- Sur le NAS, une fois la r7 installée : le rapport de capacité doit montrer le chemin de diffusion
  mesuré, et une conversion 4K HDR → 720p au-dessus du temps réel. Les deux se lisent par l'API, sans
  rien installer.

## Métrique d'acceptation

- Film 4K HDR vers la Pixel Tablet depuis le NAS : lecture confirmée en moins de 20 s, sans
  échec visible, et une conversion qui tient le temps réel.
- Vidéo déjà compatible : lecture confirmée en moins de 5 s.
- Pause, reprise, déplacement et arrêt confirmés par le récepteur en moins de 2 s.
- Aucune requête de plus de 15 s entre un client et le serveur pendant un cast.

## Livrables

APK Android, APKG ASUSTOR x86-64, MSI et DEB du bureau, et les deux archives, tous en `0.6.0.r7`.

## Construit le 2 octobre 2026

### Ce qui a changé par rapport au plan

- **Une conversion en cours se déclare comme un événement.** Le banc a montré un second défaut, plus
  grave que prévu. Une conversion en cours (liste HLS sans `#EXT-X-ENDLIST`) était prise pour un
  direct : la tablette démarrait au deuxième segment, puis sautait de 8,1 à 18,0 s dès qu'une mise à
  jour ajoutait plusieurs segments d'un coup. Une liste qui grandit régulièrement ne le montre pas ;
  il faut une vraie conversion, qui produit par rafales. Avec `#EXT-X-PLAYLIST-TYPE:EVENT` et
  `#EXT-X-START:TIME-OFFSET=0`, la lecture part de 0 et suit le temps réel.
- **Le direct repart en arrière dans sa source.** Sur CNews, la tablette alternait lecture et attente
  toutes les trois secondes, et sautait un segment sur deux : la conversion, partie du dernier
  segment de la source, produisait exactement au temps réel, sans réserve. Elle repart désormais
  cinq segments en arrière (`-live_start_index -5`), et le téléviseur n'est lancé qu'avec trois
  segments prêts. Les lecteurs locaux gardent leur réglage.
- **Une sonde ne compte un refus que si le segment a été téléchargé.** Un récepteur qui ne joint pas le
  NAS refuse aussi les trois clips, et serait sinon retenu un mois comme ne lisant rien.
- **Une progression qui ne s'écrit pas n'arrête plus la diffusion.** Le test des routes l'a montré :
  l'exception de la base remontait jusqu'au transport.

### Mesures finales, Pixel Tablet, vrai code du serveur sur le PC

| Parcours | Résultat |
| --- | --- |
| Sonde des trois clips | 0,4 à 0,8 s ; H.264 1080p, HEVC 1080p et HEVC 4K HDR10 refusés |
| Film 4K HDR, de la commande à la lecture confirmée | 5,8 à 6,2 s, conversion 720p directe |
| MP4 H.264 1080p | 2,8 s, source servie telle quelle |
| CNews | 6,5 s, puis 30 s de lecture continue |
| Pause, reprise, volume, arrêt | confirmés en moins de 0,1 s |
| Déplacement dans la partie convertie | sur le récepteur, sans nouvelle conversion |

Le comparatif d'une image du film montre le défaut du chemin « logiciel » que le NAS avait retenu :
image terne et sombre, alors que `zscale` et `tonemapx` rendent le titre doré attendu. `tonemapx` ne
coûte presque rien à 720p : c'est le décodage 4K qui domine, et le circuit vidéo le prend désormais.

### Ce qui reste à mesurer sur le NAS, après installation

Je n'ai pas d'accès au NAS pour y lancer FFmpeg. La chaîne matérielle (décodage VA-API, `scale_vaapi`,
`tonemapx`, `h264_vaapi`) y est donc qualifiée par le serveur lui-même au démarrage. Deux lectures de
l'API suffisent à vérifier le résultat, sans rien installer :

- `GET /api/system/capacity` → `diffusion.retenue.hdr` doit valoir `true`, avec des images par
  seconde au-dessus de celles de `logiciel-hdr` ;
- une conversion 4K HDR → 720p par l'API doit tenir au-dessus du temps réel.

Si la qualification échoue, la diffusion garde le chemin d'avant, désormais en tone mapping logiciel
correct et en encodage matériel : plus lent, mais plus jamais tout en logiciel par erreur.

Tv Salon était éteint pendant les essais : ni Google Cast ni DLNA n'ont pu y être éprouvés.
