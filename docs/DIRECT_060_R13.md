# Direct 0.6.0 r13 — ne garder que ce qui marche, jusqu'au bout

*15 octobre 2026. Suite du bouton « Ne garder que les chaînes qui marchent » de la r12, sur Android
(téléphone, tablette, téléviseur), le bureau Windows et Linux, et le Web.*

## Ce qui manquait

Le test de la r12 jugeait une chaîne à sa première source qui répondait, et s'arrêtait là. Une chaîne
retenue pouvait donc garder des sources mortes : le lecteur les proposait dans la liste des sources, et
sa bascule automatique pouvait les essayer. Sur la recherche « france » (148 chaînes, 420 sources),
environ la moitié des sources seulement étaient testées.

Deuxième défaut, côté Web et bureau : ouvrir une chaîne démonte l'écran des chaînes. La recherche était
retrouvée au retour (`memoire-direct.ts`), mais pas le résultat du test : la grille revenait
entière, et il fallait relancer le test.

## Ce que fait la r13

1. **Toutes les sources des chaînes qui jouent sont testées.** Le verdict d'une chaîne reste rendu à sa
   première source vivante (trois essais au plus), ce qui garde la barre de progression aussi rapide
   qu'avant. Les sources suivantes sont mises de côté et testées ensuite par les mêmes seize fils, en
   fond, avec le même critère : jusqu'au début d'un vrai segment vidéo. Au plus 1 500 sources par
   test.
2. **Le serveur retire les sources mortes au lecteur qui cite le test.** Les trois lecteurs (hls.js,
   VLC du bureau, ExoPlayer) demandent les sources d'une chaîne avec `?verification=<id>` tant qu'une
   grille filtrée est en vigueur. Le serveur ôte alors celles qui n'ont pas répondu, du choix comme de
   la bascule automatique ; le relais et la relève silencieuse n'en voient jamais d'autres. Une source
   pas encore testée reste proposée. Une chaîne ne se vide jamais : sans source vivante, elle s'ouvre
   entière. Un test inconnu (serveur redémarré, autre profil) ne retire rien.
3. **Le filtrage tient jusqu'à la recherche suivante.** Il est retenu dans la mémoire de session du Web,
   avec ses critères, et retrouvé au retour d'une chaîne ; sur Android, l'écran des chaînes était déjà
   complété plutôt que reconstruit au retour, et l'identifiant du test suit la grille. Il tombe à toute
   modification de la recherche, à sa remise à zéro, ou au changement d'un filtre. Le serveur garde le
   dernier test de chaque profil douze heures après sa dernière consultation, au lieu de cinq minutes.
4. **Le nombre de sources des cartes suit.** Le client continue d'interroger le test une fois par
   seconde jusqu'à la fin des sources, et met à jour ce nombre sans faire bouger la grille.

Un rechargement de la page Web ou un redémarrage de l'application perd le filtrage, comme il perd déjà
la recherche.

## Mesures

Serveur du banc sur une copie de la base du NAS, test lancé par l'API :

| Recherche | Chaînes | Jouent | Verdict | Toutes les sources | Sources retirées |
| --- | --- | --- | --- | --- | --- |
| france | 148 | 107 | 5,8 s (r12 : 5,5 s) | 12,5 s | 68 sur 337, 19 chaînes |
| sport | 98 | 74 | 7,5 s (r12 : 6,1 s) | 9,6 s | 39 sur 175, 26 chaînes |

L'écart du verdict sur « sport » tient au réseau des hébergeurs d'un essai à l'autre : la seconde
passe ne prend un fil qu'une fois toutes les chaînes distribuées.

Dans le vrai client Web : « france », 103 chaînes sur 148 ; France 3 Lorraine s'ouvre avec sa seule
source vivante au lieu de trois (la requête du lecteur cite le test) ; au retour, la grille filtrée est
là, 103 chaînes ; la recherche modifiée la fait tomber. Aucune erreur de l'application à la console.

## Reste à voir sur place

- Android TV et téléphone : la liste des sources d'une chaîne ouverte depuis une grille filtrée, et le
  retour sur la grille filtrée.
