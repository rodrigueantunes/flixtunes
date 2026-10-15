# Direct 0.6.0 r12 — sans saut visible, à la meilleure qualité

*15 octobre 2026. Sur Android (téléviseur, téléphone, tablette) et dans le navigateur, les sauts signalés :
l'image qui bondit en avant, l'image figée puis reprise, les micro-saccades.*

## Ce qui se voyait, et pourquoi

### Les micro-saccades : une vitesse qui ne restait jamais à 1×

Les deux lecteurs recalaient la latence en faisant varier la vitesse de lecture : Android entre 0,97× et
1,06× (contrôle de vitesse du direct d'ExoPlayer, proportionnel à l'écart), le navigateur entre 0,98× et
1,06×. L'idée était qu'une accélération de quelques pour cent ne se remarque pas. Elle se remarque : à
une vitesse qui n'est pas 1×, les images ne tombent plus en phase avec l'écran, et des images sont
répétées ou sautées à intervalles réguliers.

Mesuré dans le vrai client Web, sur CNews : le bord du direct avance par bonds d'un segment (8 s) à
chaque rechargement de la playlist, si bien que le retard mesuré fait des dents de scie autour de la
cible ; les seuils de vitesse étant serrés, la vitesse basculait **à chaque rechargement — 49 fois en
162 s, 43 % du temps hors de 1×**.

### Les micro-saccades sur téléviseur : un écran resté à 60 Hz

Le lecteur des films accorde la fréquence de l'écran à la cadence de la vidéo ; le direct ne le faisait
pas. Une chaîne française — 50 ou 25 images par seconde — affichée sur un panneau à 60 Hz montre tantôt
une, tantôt deux fois chaque image : le mouvement avance par à-coups réguliers, quel que soit le débit.

### Les bonds en avant : des recalages que rien n'imposait

- **Un retard au-delà de 60 s** ramenait la lecture à 40 s du direct, sur Android comme dans le
  navigateur, et hls.js faisait de même de son côté (`liveMaxLatencyDuration`). Sur une chaîne dont la
  fenêtre fait plusieurs minutes, ce retard ne menaçait rien.
- **Au bord arrière**, la reprise visait l'avance de 40 s, et non le point le plus ancien encore sûr :
  sur CNews, dont la fenêtre fait cinq minutes, cela faisait sauter **environ quatre minutes de
  programme** là où une dizaine de secondes suffisaient.

## Ce que fait la r12

1. **Toujours 1×.** Plus de rattrapage par la vitesse, ni sur Android, ni dans le navigateur. Le retard
   ne grandit plus qu'à chaque calage, et la fenêtre de la chaîne l'absorbe.
2. **On ne bouge que lorsque la fenêtre l'impose.** Plus aucun bond en avant pour un simple retard, ni
   du lecteur ni de hls.js. Seul le bord arrière déclenche une reprise : sous 12 s de marge (ou un
   segment et demi), on reprend **au plus près de ce bord** — trois segments, 24 s d'ordinaire — en
   sautant le moins de programme possible. Une fenêtre trop courte pour avoir un bord arrière distinct
   n'est jamais touchée.
3. **L'écran du téléviseur suit la cadence de la chaîne** : 50 Hz pour une chaîne française. Rien
   n'est demandé quand le mode en cours convient déjà — un zapping entre chaînes de même cadence ne
   renégocie pas le HDMI.

Ce qui ne change pas : l'avance de départ (40 s, 60 s pour une source fragile, dans la limite de la
fenêtre), la relève par une seconde source alignée sur la même heure, les reprises réseau, le cache de
segments.

## Mesures

Vrai client Web sur le banc (serveur sur une copie de la base du NAS), CNews, même parcours avant et
après :

| | Avant | Après |
| --- | --- | --- |
| Changements de vitesse | 49 en 162 s | **0** en 200 s |
| Temps hors de 1× | 43 % | **0 %** |
| Déplacements après le démarrage | 0 | 0 |
| Attentes | 0 | 0 |
| Retard sur le direct | 33 à 41 s, en dents de scie | stable, 36 à 37,5 s |

Les règles de reprise sont testées des deux côtés avec les mêmes fenêtres (Web et Android).

## Reste à mesurer

- Sur un téléviseur Android : le passage à 50 Hz à l'ouverture d'une chaîne, et l'absence de
  micro-saccades. Le banc du poste ne peut pas le montrer.
- Une soirée de direct avec de vrais calages : le retard qui grandit sans bond, et la reprise au bord
  arrière quand la fenêtre est courte.

## La meilleure qualité possible, cast compris

- **La conversion du direct pour un navigateur** — quand il ne lit pas un flux tel quel — convertissait
  toujours, en logiciel, en 720p30 à 2,2 Mbit/s, et à partir de la première variante de la liste : sur
  CNews, un 480×270. Elle profite désormais de l'analyse du direct de la r9 : la meilleure variante,
  copiée quand le navigateur sait la lire (seul le son est converti, cas d'une piste AC-3), sinon
  convertie à pleine définition par le circuit vidéo que le NAS a qualifié, ou en 720p propre.
  Mesuré : CNews copiée en 1080p50, prête en 9,2 s ; TF1 désentrelacée.
- **Démarrer dans la bonne qualité.** Le navigateur comme Android retiennent le débit mesuré lors des
  lectures précédentes, et la chaîne s'ouvre sur la variante que l'appareil tient, au lieu de partir de
  la plus petite et de monter sous les yeux — un saut de qualité de moins. La remontée de qualité du
  navigateur est moins timide (facteur 0,7 au lieu de 0,5) : avec 40 s de réserve, une variante un peu
  juste ne fait pas caler.
- **Les conversions du direct, cast compris** : débits relevés (1080p50 : 10,8 Mbit/s au lieu de 8,1 ;
  720p : 6,1 au lieu de 4,7), qualité constante un cran plus fine (21 au lieu de 23) quand c'est le
  réglage que le NAS a retenu, son à 192 kbit/s.
- Ce qui reste borné l'est par le matériel (720p de la Pixel Tablet) ou par une décision prise (25 Mbit/s
  hors de chez soi, décision D3 de la r10).

## Ne garder que les chaînes qui marchent

Pendant une recherche de chaîne — et seulement alors —, un bouton fait vérifier par le NAS, à
l'instant, les chaînes trouvées (les 200 premières au plus). Il ne suffit pas qu'une playlist réponde :
on descend jusqu'à une variante et l'on va chercher le début d'un vrai segment vidéo, ce qui écarte les
listes figées et les pages d'erreur servies avec un code 200. Seize chaînes à la fois, trois sources au
plus par chaîne, quatre secondes par requête, chaque source retenue une minute.

Pendant le test : « Test en cours… », la progression, et les chaînes muettes qui s'estompent sans
bouger la grille. À la fin, seules celles qui jouent restent. Le filtrage tombe dès que la recherche ou
les filtres changent. Sur le Web (donc aussi Windows et Linux, qui en reprennent l'interface) et
Android, téléviseur compris.

Mesuré sur la copie de la base du NAS : « cnews » 9 chaînes en 1,0 s ; « france » 148 chaînes en
5,5 s, 110 jouent ; « sport » 98 chaînes en 6,1 s, 83 jouent. Dans le vrai client : « france », 109 sur
148, et la grille revient entière à la recherche suivante.

## Une question ouverte

Les images figées viennent d'une coupure plus longue que la réserve, et la réserve, c'est l'avance prise
derrière le direct : 40 s, 60 s pour une source fragile, décidé le 13 septembre 2026. Sur les chaînes à
grande fenêtre (CNews : cinq minutes), on pourrait viser davantage — plus de réserve, au prix d'un
direct un peu plus en retard sur l'antenne. Ce réglage reste tel quel tant qu'il n'est pas tranché.
