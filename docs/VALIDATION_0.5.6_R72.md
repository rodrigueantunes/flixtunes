# Validation 0.5.6.r72 — la passe sonore descend de cent heures à moins de dix

*25 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §7 liste le reste.*

## 1. Le défaut livré en r71

La passe de repérage annonçait une à cinq heures pour la médiathèque. Mesurée sur le NAS, elle avançait
d'un épisode toutes les **quatre-vingt-dix secondes** : plus de **cent heures** pour 6 637 épisodes.

L'estimation venait d'une mesure faite **sur un poste de travail**, et ne chronométrait que
l'extraction audio — 0,8 s par épisode. La comparaison, elle, avait été mesurée sur des fenêtres de
300 secondes, tandis que r71 en analyse 900.

Or **le coût croît avec le carré de la fenêtre** : chercher sur quinze minutes coûte neuf fois plus
que sur cinq. Mes propres relevés sur *Silo* le disaient déjà — 3,4 à 3,8 secondes par épisode — et je
ne les ai pas rapprochés de l'estimation annoncée.

## 2. Le remède : commencer court

| Fenêtre | Séries retrouvées sur cinq | Coût par épisode |
| --- | --- | --- |
| **300 s** | **4** — seul *Silo* manque, son générique s'ouvrant à 347 s | **789 ms** |
| 600 s | **5** | 3 034 ms |
| 900 s | 5 | ~7 000 ms |

La passe analyse désormais cinq minutes, puis dix, puis quinze — et n'élargit qu'à défaut d'avoir
trouvé. Mesuré sur 1 538 introductions nommées, cinq minutes en couvrent **84,7 %** et dix **98,9 %** :
la grande majorité des épisodes ne paiera jamais que le premier palier.

## 3. Un défaut de production, trouvé par la mesure

La passe comparait chaque épisode à **trois** témoins. Or sur *The Office*, **deux paires seulement
s'accordent sur quatre** — les deux autres ne trouvent rien, les prologues n'ayant pas la même
longueur. Avec trois témoins, la série tombait sous le quorum de deux paires et **n'était pas
repérée**, alors que l'algorithme la trouve parfaitement.

Le nombre passe à quatre. Le défaut ne concernait que les séries au générique court, et n'apparaissait
sur aucun des cas d'essai retenus jusque-là.

## 4. Quatre raccourcis essayés, quatre échecs mesurés

Le coût est quadratique ; la tentation était d'approximer. Chacune de ces tentatives est documentée
dans le code **avec la raison de son échec**, pour que personne ne la retente :

| Tentative | Résultat |
| --- | --- |
| Enveloppe résumée à une valeur par seconde | 3 séries sur 5 — la structure fine disparaît |
| Ces alignements classés par nombre de fenêtres concordantes | 3 sur 5 |
| Classés par pic de corrélation | 3 sur 5 |
| Corrélation croisée par transformée de Fourier | 3 sur 5 — rate les thèmes de vingt secondes |
| **Recherche exhaustive, sommes glissantes, fenêtre progressive** | **5 sur 5** |

La recherche exhaustive est conservée : elle est **juste**, et la vitesse vient d'ailleurs — des sommes
qui glissent d'une position à la suivante au lieu d'être recalculées, et d'une fenêtre qui ne s'élargit
qu'en cas de besoin.

### 4.1 Une régression qui n'existait pas

Quatre tours ont été dépensés à poursuivre une régression imaginaire. Mon banc d'essai comparait chaque
épisode à **trois** témoins quand la validation de r71 en prenait quatre : *The Office* et *Bleach*
« échouaient » à cause de l'outil de mesure, pas du code. J'ai successivement accusé le dégrossissage,
le classement, puis la dérive numérique des sommes glissantes — et réécrit trois fois une fonction qui
était juste.

**La leçon est la même que celle des chapitres de *Silo*** : vérifier le banc avant de suspecter le
code. Elle aura été apprise deux fois dans la même journée.

## 5. La progression, enfin visible

Une passe qui dure des heures sans rien dire se confond avec un blocage. Elle s'affiche désormais sous
les analyses de bibliothèque : saisons traitées sur total, introductions repérées, série en cours
d'écoute, et une barre.

Elle ne pouvait pas devenir une « analyse » au sens de la table `scan_jobs` — celle-ci exige une
bibliothèque, et le repérage traverse les saisons, pas les dossiers. Elle est donc exposée à part
(`/api/system/generiques`, ajoutée à la liste blanche de l'accès distant) et rendue au même endroit,
qui est celui où l'on vient regarder.

## 6. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Suite serveur | **78 fichiers, 729 tests, 0 échec** |
| Suite Web | **20 fichiers, 172 tests, 0 échec** |
| Typechecks serveur, contrats, Web, Kotlin | aucune erreur |
| Justesse sur cinq séries réelles | **5 sur 5**, dont *Dragon Ball Z* qui n'a aucun chapitre |

## 7. Reste à exécuter

| Sujet | Pourquoi |
| --- | --- |
| **La passe sur le NAS, à sa nouvelle vitesse** | Le gain est mesuré sur ce poste ; la cadence réelle du NAS reste à constater. |
| r69, r70, r71 sur l'appareil | testés ensemble, comme convenu |
| Mesures de capacité au repos | rétabliront le plafond à 7 |

## 8. Ce que l'audit Vulkan a conclu

Mené en parallèle et clos : **la voie est fermée**. Mesuré sur le NAS, libplacebo rend **11 images par
seconde** là où la chaîne seule en fait 178 et le tone mapping logiciel 51 à 75. Il est donc **sept
fois plus lent que le processeur** sur ce circuit graphique de onzième génération, et ne pourrait pas
soutenir un seul film en temps réel.

Sans cette mesure, r72 aurait embarqué 11,4 Mio de bibliothèques — dont une pile X11 complète sur un
NAS sans écran — pour dégrader la conversion HDR d'un facteur sept. Le détail est dans
`AUDIT_VULKAN_R72.md`.
