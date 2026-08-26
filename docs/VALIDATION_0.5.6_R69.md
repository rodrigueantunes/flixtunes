# Validation 0.5.6.r69 — le lecteur dit ce qu'on regarde, et les génériques se voient

*25 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §6 liste le reste.*

## 1. Le bandeau affichait « FlixTunes » pendant tout le film

Non par choix, mais par repli. Le lecteur Android sait composer « Série / S1 E3 · Titre » depuis
quatre champs — il le faisait déjà pour l'épisode suivant, que le voisinage lui livre complet. Mais à
l'ouverture il ne reçoit que `playback-info`, qui décrit les flux et **ne nommait pas le média** : le
repli s'appliquait donc à chaque lecture.

Le défaut ne se voyait pas en relisant le lecteur, dont la mise en forme était correcte. Il tenait
dans ce que le serveur envoyait.

- Le serveur nomme désormais le média des deux côtés : à l'ouverture comme au passage à l'épisode suivant.
- La mise en forme est celle du **lecteur Web**, référence graphique du projet : la série en gras, le
  numéro d'épisode et son titre en dessous. Elle vit dans `IntituleLecteur.kt`, avec cinq cas.

## 2. La carte d'enchaînement quitte le centre de l'écran

Elle s'y trouvait, et masquait la fin de l'épisode au moment précis où le générique se joue. Le Web
la pose en bas à droite depuis toujours (`.player-next`) ; Android s'y aligne, jetons compris.

Les deux ont été retravaillées ensemble :

- **surtitre** « ÉPISODE SUIVANT » en bleu, titre de l'épisode en gras, numéro en dessous ;
- **une jauge** qui se vide pendant l'attente : le temps qui reste se voit plutôt qu'il ne se lit, et
  l'on sait d'un coup d'œil s'il reste le temps d'attraper « Annuler » ;
- **une entrée en glissement** — un panneau qui surgit d'un coup sur un générique se remarque mal ;
- deux actions distinctes plutôt que deux boutons identiques : « Lire maintenant » plein, « Annuler »
  en contour.

Un défaut de style corrigé au passage : le sélecteur `.player-next div` attrapait aussi la jauge, dont
la barre tombait alors à **zéro de large**. La rangée d'actions porte maintenant son propre nom.

## 3. Les génériques sont repérés — et mesurés avant d'être exploités

Rien ne les « détecte » au sens de l'analyse d'image : ce qui est lu, ce sont les **chapitres** que
porte une partie des fichiers. Mesuré sur la médiathèque, 9 761 médias :

Sur 8 190 épisodes, **4 258 (52 %) portent des chapitres** — c'est le plafond de ce que cette
approche peut atteindre. En deçà de ce plafond :

| | épisodes | part de ceux qui ont des chapitres |
| --- | --- | --- |
| générique de fin **nommé** | 1 577 | 37 % |
| générique de fin **déduit de la position** | 1 994 | 47 % |
| **total générique de fin** | **3 571 (44 %)** | **84 %** |
| introduction nommée | 1 538 | 36 % |

Le générique de fin commence en médiane à **97,1 %** du film et dure **56 s** ; l'introduction dure
**79 s** en médiane et commence vers **55 s**.

Deux élargissements ont porté la couverture de 17 % à 44 %, tous deux tirés de la mesure :

- **le préfixe numéroté est toléré** et « Ending » reconnu — la médiathèque porte 45 chapitres
  « 8. End Credits » que le point d'ancrage rejetait : **+160 épisodes** ;
- **le dernier chapitre se déduit de sa seule place** quand rien n'est nommé. La plupart des épisodes
  numérotent leurs chapitres — « Chapter 6 », « Scene 8 ». Or un dernier chapitre qui s'ouvre après
  88 % du film et dure de 20 à 150 s n'est pratiquement jamais une scène : mesurés sur ces 1 994
  épisodes, ces segments durent **42 s en médiane**, le profil exact d'un générique nommé.

Cette seconde règle est une **déduction, assumée comme telle**. Se tromper coûte une carte qui s'ouvre
un peu tôt sur la dernière scène ; la lecture n'est pas touchée et « Annuler » la referme. Sa fenêtre
est donc plus étroite que celle des chapitres nommés, des deux côtés — un nom est une affirmation, une
position n'est qu'un indice.

- **L'épisode suivant s'annonce dès le générique**, et non l'écran déjà noir. Le départ, lui, ne bouge
  pas : il reste la fin du média. Enchaîner sur la jauge couperait un générique qu'on regarde peut-être.
- **Un bouton « Passer le générique »** apparaît pendant l'introduction, au même coin que la carte —
  ils ne se croisent jamais, l'un vivant au début du fichier et l'autre à la fin.
- **Sur les séries seulement**, comme demandé : un film n'a qu'une introduction, c'est l'épisode qu'on
  enchaîne vingt fois de suite. La règle est posée **une fois, côté serveur**.
- **Sur un téléviseur, le bouton prend le focus** le temps qu'il est proposé : la télécommande n'a pas
  de curseur, et un bouton qu'on ne peut pas atteindre n'existe pas.

### 3.1 Les garde-fous viennent de la mesure, pas de l'intuition

Les mêmes fichiers portent des chapitres mal étiquetés : un « Credits » de **7 445 secondes** — deux
heures, soit tout le film — et une « Intro » de **2 336**. Un générique de fin est donc ignoré hors du
dernier cinquième, ou s'il dure moins de 12 s ou plus de 10 min ; une introduction, hors de la
première moitié, ou hors de 8 s à 5 min.

« Générique » seul, enfin, désigne les deux en français, et la médiathèque en porte des deux sortes
sous ce seul intitulé : **seule sa position tranche**.

## 4. Un harnais de tests débloqué au passage

`test.ps1` ne compilait plus : `NavigationCatalogueTest` appelle `prochaineInitialeCatalogue`, qui
vivait dans `MainActivity.kt` — un fichier à composables, que ce harnais écarte par construction
(un composable réclame le greffon Compose, qu'il ne monte pas). **Toute** la suite Android restait
bloquée derrière. Le raisonnement est sorti dans `IndexAlphabetique.kt` ; il n'avait rien à faire dans
une activité.

## 5. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Suite serveur | **72 fichiers, 679 tests, 0 échec** |
| Suite Web | **20 fichiers, 172 tests, 0 échec** |
| Suite Android (JVM) | **200 tests, 0 échec** — harnais réparé |
| Typechecks serveur, contrats, Web, Kotlin | aucune erreur |
| Rendu de la carte et du bouton | vérifiés dans un navigateur, captures à l'appui |

## 6. Reste à exécuter

| Sujet | Pourquoi |
| --- | --- |
| **Les deux cartes sur l'appareil** | Rendu vérifié sur le Web ; ni la carte Android ni le bouton n'ont été vus sur un mobile ou un téléviseur. |
| L'annonce au générique, en conditions réelles | Le déclenchement est testé sur la logique, pas observé sur un épisode qui se termine. |
| Décalage audio après un saut (r67) | toujours pas éprouvé sur l'appareil |
| Mesures de capacité au repos | rétabliront les 471 im/s et le plafond à 7 |

## 7. Confirmé sur l'appareil

**Validé par l'utilisateur le 26 août 2026**, en testant le paquet r72 — dont l'application Android est
identique à celle de r69, aucun code client n'ayant changé depuis. Sont donc confirmés sur mobile : le
titre dans le bandeau du lecteur, la carte d'enchaînement en bas à droite avec sa jauge, et le bouton
« Passer le générique ».

C'était la plus ancienne réserve encore ouverte de la série r67–r73.
