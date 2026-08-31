# Chantier 0.5.7.r3 — le lecteur du direct

*Trois demandes : changer de source à la main, voir une barre de progression, et tenir sans à-coup
quand le flux hoquette. Ce document mesure d'abord, propose ensuite. Rien n'est construit avant le
feu vert.*

---

## 1. Ce que le lecteur fait aujourd'hui

`apps/web/src/LecteurDirect.tsx` et `LecteurDirectActivity.kt` partagent le même modèle : les
adresses d'une chaîne sont **courues** en parallèle, l'ordre des réponses devient l'ordre d'essai, et
un échec fait passer à la suivante — après une seconde chance par le relais du serveur côté Web.
L'écran l'annonce discrètement : « source 2/3 ».

Ce qui manque, et que la demande nomme :

- le passage à la source suivante est **subi**, jamais choisi ;
- il n'y a **aucun contrôle** : ni barre, ni pause, ni retour en arrière ;
- une erreur fatale, quelle qu'elle soit, **abandonne l'adresse** — même celles qui se réparent.

---

## 2. La mesure qui décide de tout : la fenêtre glissante

Une barre de progression sur un direct ne montre qu'une chose — ce que l'hébergeur publie encore
derrière le bord. Soixante chaînes françaises tirées du corpus, treize manifestes lisibles depuis le
poste (les autres sont mortes, géobloquées ou exigent des en-têtes) :

| | Fenêtre derrière le direct |
| --- | --- |
| minimum | 60 s |
| **médiane** | **61 s** |
| 9<sup>e</sup> décile | 100 s |
| maximum | 14 400 s — Arte, 1 875 segments, quatre heures |

92 % des chaînes tiennent entre 30 s et 2 min. **Durée de segment : 8 s de médiane**, 10 s au pire,
huit segments publiés à la fois.

Trois conséquences directes :

1. **La barre a un sens, mais elle est courte.** Une minute de recul sur presque tout le corpus,
   quatre heures sur Arte. Elle doit donc afficher la fenêtre **réelle** de la chaîne en cours, et non
   une échelle inventée — sans quoi elle promet un retour en arrière qui n'existe pas.
2. **La latence est le prix de la stabilité, et son plafond est mesuré.** hls.js se cale trois
   segments derrière le bord, soit **24 s** sur des segments de 8 s. Il reste donc environ **37 s de
   marge** avant de tomber par l'arrière de la fenêtre médiane. C'est tout ce qu'on peut acheter.
3. **Au-delà, augmenter le tampon ne sert à rien** : il n'y a pas plus de média publié devant le
   point de lecture. Le seul vrai levier est **la distance au bord**, et elle est bornée par la
   fenêtre.

---

## 3. Changer de source à la main

**Ce qu'il y a déjà** : la liste ordonnée des adresses vit dans l'état du lecteur (`adresses`,
`rang`), le relais est connu pour chacune, et le rapport de résultat au serveur existe.

**Proposition.** Le « source 2/3 » de la barre devient cliquable et ouvre la liste : *Source 1 —
directe*, *Source 2 — relayée*, chacune avec son état connu. Le choix ouvre l'adresse immédiatement.
Une source choisie à la main **ne compte pas comme un échec** si elle échoue tout de suite : c'est un
essai délibéré, pas une mesure d'usage, et le classement des adresses ne doit pas s'en trouver faussé.

À la télécommande : la touche **verte** ou un appui long sur *droite* fait défiler les sources. Sur
mobile, un appui sur le libellé.

**Coût** : quelques dizaines de lignes de chaque côté, aucun appel serveur nouveau.
**Risque** : faible. Le seul piège est le verrou `essai` du repli automatique, qu'un changement
manuel doit remettre à zéro proprement — c'est le même bug que les quatre `POST /resultat` de la r2.

---

## 4. La barre de progression

**Proposition.** Une barre qui montre la fenêtre de la chaîne, pas une durée : le bord droit est le
direct, le curseur la position, et un bouton **« ⏵ Revenir au direct »** apparaît dès qu'on décroche.
Elle se lit de `video.seekable` côté Web et de `Player.getCurrentTimeline()` / `getCurrentLiveOffset()`
côté Android — les deux donnent la fenêtre réellement publiée, y compris les quatre heures d'Arte.

Elle apporte au passage ce qui manquait : **la pause**. Sur un direct, mettre en pause revient à
reculer dans la fenêtre — et à en sortir si l'on s'absente trop longtemps, ce que la barre doit dire
plutôt que de laisser l'image se figer.

Une chaîne sans fenêtre exploitable (moins de deux segments) n'affiche **pas** de barre : mieux vaut
rien qu'un décor qui ne répond pas.

**Coût** : c'est le plus gros des trois. Nouvelle barre de commande sur les deux clients, le Web
d'abord puisqu'il est la référence graphique, `Design.kt` transcrit ensuite.
**Risque** : moyen — la barre doit se masquer d'elle-même et ne pas voler le focus de la télécommande.

---

## 5. « Une stabilité parfaite en cas de lag »

C'est la demande la plus intéressante, parce qu'elle a un prix chiffrable : **la stabilité s'achète
en secondes de retard**, et le §2 dit combien il y en a à dépenser.

Quatre points, du plus sûr au plus discutable :

1. **Réparer avant d'abandonner.** Une erreur fatale de *média* (un segment mal décodé) se répare par
   `hls.recoverMediaError()` sur la même adresse ; aujourd'hui elle fait changer de source, ce qui
   coupe l'image pour un incident d'une seconde. Même chose côté ExoPlayer, dont
   `PlaybackException` distingue les causes. **Gain net, aucun coût.**
2. **Le mode faible latence, à éteindre quand il ne sert à rien.** `lowLatencyMode: true` vise le
   LL-HLS et ses segments partiels ; aucune chaîne mesurée n'en publie — 8 s de segment, huit
   segments. Il ne fait donc que serrer la marge. À activer seulement si le manifeste porte
   `#EXT-X-PART`.
3. **Reculer quand ça hoquette, et le dire.** Plutôt qu'un réglage à choisir, un comportement :
   trois blocages en deux minutes et le lecteur passe de trois à cinq segments de retard — dans les
   37 s de marge mesurées —, avec une mention discrète « + 16 s de sécurité ». Il revient au bord
   dès qu'on change de chaîne. **Ni réglage, ni base : cela ne coûte rien au NAS**, tout se passe
   dans le client.
4. **Côté Android, ce qu'ExoPlayer sait déjà faire et qu'on ne lui demande pas.** Le lecteur est
   construit nu : `ExoPlayer.Builder(this).build()`. Une `MediaItem.LiveConfiguration` avec un
   décalage cible et une plage de vitesse de 0,97 à 1,03 lui permet de **glisser** vers sa cible au
   lieu de se figer puis de sauter. C'est le mécanisme prévu pour exactement ce cas.

**Ce que je ne promets pas.** « Parfaite » n'est pas atteignable : cinq chaînes sur six n'ont
**qu'une seule adresse** (16,7 % en ont plusieurs, mesuré en r2), et une source qui s'effondre
s'effondre. Ce qui est atteignable, c'est qu'un hoquet de vingt secondes ne se voie pas, et qu'un
incident réparable ne coupe plus l'image.

---

## 6. Ce qui a été fait, et ce que la mesure a donné

Les trois points sont construits, dans l'ordre convenu — stabilité, choix de source, barre —, plus
deux demandes venues en cours de route.

**La meilleure source.** `apps/server/src/live-qualite.ts` lit le manifeste et en retient la meilleure
variante ; `chaineDetaillee` classe désormais par échecs, puis définition, puis débit, puis succès. La
sonde part **après** la réponse, quatre adresses à la fois, une fois par semaine : la première
ouverture n'en profite pas, toutes les suivantes oui. Vérifié sur le corpus : les douze adresses
d'« Arte » se rangent derrière `artesimulcast.akamaized.net`, **720p à 3,15 Mb/s**, au lieu d'une
adresse IP nue. La course, elle, ne reclasse plus rien — elle ne répond qu'à *qui est joignable*.

**La barre.** Elle lit `seekable` côté Web et `duration`/`currentLiveOffset` côté Android, donc la
fenêtre réellement publiée. Vérifiée à l'écran sur Arte : « − 0:31 », le retour au direct, la pause et
la reprise.

**La stabilité.** `lowLatencyMode` éteint, réparation des erreurs de média avant abandon, recul de deux
segments après trois blocages en deux minutes, et côté Android un tampon et une `LiveConfiguration`
que le lecteur n'avait pas du tout.

**La télécommande.** Haut/bas la chaîne, gauche/droite la fenêtre, OK la pause, verte les sources. La
flèche gauche ne fait donc plus « chaîne précédente » : c'est le seul recul de cette étape, assumé
parce qu'une barre sans flèches pour la parcourir n'aurait servi à rien. `LAST_CHANNEL` et
`MEDIA_PREVIOUS` la portent toujours.

**Les cartes de chaînes, sur Android.** Elles suivaient la hauteur de leur contenu là où une grille CSS
étire ses cellules : un logo absent faisait un damier. Elles sont carrées, comme le squelette du Web.

---

## 7. Ce qu'il reste à trancher

1. **La latence de départ.** Rester au bord (≈ 24 s de retard, réactif) et reculer seulement en cas
   de hoquet, ou partir d'emblée plus en retrait ? Ma proposition est la première : on ne paie que
   quand il faut.
2. **La pause sur un direct.** Elle vient avec la barre. Faut-il l'offrir partout, sachant qu'une
   pause de plus d'une minute fait sortir de la fenêtre sur 92 % des chaînes ?
3. **L'ordre des trois.** Le plus utile d'abord me semble être la stabilité (§5, points 1, 2 et 4 :
   petits, sûrs, immédiats), puis le choix de source (§3), puis la barre (§4).
