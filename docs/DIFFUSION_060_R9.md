# Diffusion 0.6.0 r9 — le direct sur un téléviseur, comme sans cast

*Analyse et mesures du 2 octobre 2026, sur le Philips 58PUS7304 (Cast et DLNA) et la Pixel Tablet.*

## Ce qui n'allait pas

Le direct ne passait correctement qu'en DLNA sur le 58PUS7304, et encore. Trois causes, toutes
relevées sur de vraies chaînes :

### La plus petite image de la chaîne

Une source HLS peut proposer plusieurs variantes. CNews en propose quatorze, du 416×234 au 1080p50,
et la **première est un 480×270**. La conversion lisait `-map 0:v:0` : le premier flux vidéo venu.
En Cast, la r8 copiait donc ce 480×270 « en qualité source ». En DLNA, elle le convertissait sans
l'agrandir : le téléviseur recevait l'image d'une vignette.

### Une analyse qui échouait sans le dire

L'analyse préalable de la source (`ffprobe`) refusait toute liste HLS qui déclare des sous-titres
WebVTT, absents de la liste des formats permis. Sans analyse, le serveur convertissait à l'aveugle,
en logiciel, à 720p au plus.

### TF1, une source entrelacée

TF1 est un H.264 1080 entrelacé (`field_order=tt`), avec des erreurs de référence dans le flux de
diffusion. Recopié tel quel, le lecteur Cast ne démarre jamais : la r8 attendait 40 s avant de
retomber sur une conversion 720p à 30 images par seconde, lue au bout de 79 s.

## Ce que fait la r9

### La bonne variante, pour chaque récepteur

- Chaque variante est analysée : définition, codec, entrelacement, cadence, débit annoncé, et le son
  de son programme.
- La copie va à la plus belle variante que le récepteur lit telle quelle : **1080p50 pour le
  58PUS7304, 720p25 pour la Pixel Tablet**, qui refuse le HLS au-delà du 720p.
- Sinon, la conversion part de la variante la plus proche de la définition visée, jamais d'une petite.
- **Liste maîtresse réduite.** Quand la liste annonce ses variantes, le serveur choisit avant toute
  sonde et ne donne à FFmpeg que la variante retenue, son son par défaut (hors audiodescription), sans
  sous-titres. Elle lui est passée en `data:`, sans fichier, et sans ouvrir le protocole `file` à une
  liste distante. Sur CNews : 0,5 s d'analyse au lieu de 3,9 s, 0,9 s jusqu'au troisième segment au
  lieu de 5 s.

### Le bon traitement

- Une source progressive que le récepteur lit est copiée.
- Une source entrelacée est désentrelacée **trame par trame** : 1080p50 par le circuit vidéo du NAS
  (`deinterlace_vaapi`, `scale_vaapi`, `h264_vaapi`), comme un téléviseur restitue un 1080i sans cast.
  En logiciel, le processeur du NAS ne tient pas un 1080p50 : 720p25 avec `yadif`.
- Une conversion logicielle ne dépasse jamais 30 images par seconde.
- Images clés toutes les 2 s, segments de 2 s pour une conversion, son AAC 160 kb/s, erreurs de
  référence ignorées plutôt qu'un arrêt.

### Une lecture qui tient

- Chaque relance de FFmpeg écrit dans son propre dossier. Le téléviseur lit une **liste composée** de
  toutes les passes, avec une rupture déclarée à chaque relance : il continue sans s'arrêter.
- Quinze secondes sans nouveau segment relancent la passe. Une passe matérielle qui ne produit rien
  repart en logiciel ; une source qui se tait cède à la suivante de la chaîne, analysée à son tour.
- Le conteneur des segments est fixé pour la session : une liste ne mêle jamais fMP4 et MPEG-TS.
- En DLNA, le MPEG-TS continu suit la liste composée et part des trois derniers segments.
- Le lecteur Cast du téléviseur s'ouvre pendant que le NAS prépare la vidéo.

### Aussi

- La recherche par nom dans les filtres « pays » et « listes » du Live TV échouait toujours : la
  requête envoyait à SQLite un caractère d'échappement vide.
- Les journaux de diffusion nomment ce qui est diffusé.

## Mesures

Banc du PC (encodage logiciel : le circuit vidéo du NAS n'y est pas), avec le vrai code du serveur.

| Récepteur | Chaîne | Traitement | Démarrage | Tenue |
| --- | --- | --- | --- | --- |
| 58PUS7304, Cast | CNews | 1080p50 copié | 6,9 s (r8 : 12,6 s, en 480×270) | 90 s, position juste à 0,1 s près |
| 58PUS7304, Cast | TF1 | 720p25 désentrelacé | 6,9 s (r8 : 79 s) | 30 s |
| 58PUS7304, DLNA | CNews | conversion MPEG-TS continue | 5,3 s | 60 s |
| 58PUS7304, DLNA | TF1 | 720p25 désentrelacé | 4,5 s | 60 s |
| Pixel Tablet, Cast | CNews | 720p25 copié | 2,9 s | 30 s |
| Pixel Tablet, Cast | TF1 | 720p25 désentrelacé | 8,9 s | 30 s |

Pause et reprise réussies à chaque essai. **FFmpeg tué en pleine lecture** sur le 58PUS7304 : la passe
repart, le téléviseur marque une seule attente de 0,4 s en atteignant la rupture, et la position
avance de 70,2 s en 70,1 s. Les segments copiés de CNews, relus après coup : 6 048 images en
120,98 s, soit 50 images par seconde sans trou.

Sur le NAS, le chemin matériel (1080p50 désentrelacé par le circuit vidéo) n'a pas pu être mesuré
depuis le PC. S'il ne produit aucun segment, la passe repart d'elle-même en logiciel, en 720p25.

## Ce qui reste hors de portée

Les autres appareils du réseau affichent « Default Media Receiver » : c'est le nom du lecteur Cast
générique de Google. Afficher « FlixTunes » demande un lecteur Cast propre, déclaré dans la console
des développeurs Cast et servi en HTTPS. Le titre, l'image et la pause, eux, sont déjà publiés par
le téléviseur pendant la lecture.
