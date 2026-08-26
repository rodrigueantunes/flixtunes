# Validation 0.5.6.r73 — l'escalade se décide par saison, pas par épisode

*25 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §6 liste le reste.*

## 1. Ce que r72 avait mal arbitré

La r72 a ramené la passe sonore de plus de cent heures à **17,2 secondes par épisode**, mesuré en
service. Mais la projection restait à **29,8 heures**, loin des « moins de dix » annoncées.

La cause est dans la conception de l'escalade elle-même : elle accélère les succès et **alourdit les
échecs**.

| Cas | Coût |
| --- | --- |
| Générique trouvé à 300 s | 1 unité |
| Rien trouvé nulle part | **14 unités** — trois extractions, trois comparaisons dont la dernière est neuf fois plus chère |

Or, relevé sur le service après 388 épisodes écoutés : **188 repérés, 200 bredouilles**. La moitié des
épisodes emprunte le chemin cher, et la moyenne en est dominée.

## 2. Le remède, et la question qui l'a rendu sûr

Après **trois échecs complets d'affilée**, la saison est tenue pour dépourvue de thème commun et l'on
cesse d'élargir la fenêtre.

La première formulation prévoyait de marquer les épisodes restants « écoutés » sans les écouter. La
question posée en retour — *« ça ne va pas ne plus fonctionner du tout si on fait ça ? »* — a mis le
doigt sur le défaut : trois épisodes atypiques au début d'une saison — un récapitulatif, un pilote, un
double épisode — auraient condamné tout le reste, **sans rattrapage possible**, l'écoute n'étant notée
qu'une seule fois.

**La règle retenue ne supprime jamais l'écoute, seulement l'escalade.** Chaque épisode passe toujours
par les cinq premières minutes, celles qui couvrent 84,7 % des génériques. Et une soupape : **le
premier épisode qui trouve quelque chose rouvre l'escalade** pour le reste de la saison — un thème
existe, donc la saison en vaut la peine.

Ce qu'on perd se réduit à un cas très étroit : une saison dont les trois premiers épisodes n'ont
d'introduction à aucune fenêtre, **et** dont un épisode ultérieur en aurait une commençant après cinq
minutes. Aucun n'a été rencontré dans la médiathèque de référence.

## 3. Gain attendu

| | Coût d'une saison de vingt épisodes sans thème |
| --- | --- |
| r72 | 20 × 14 = **280 unités** |
| r73 | 3 × 14 + 17 × 1 = **59 unités** |

Les saisons où le générique se trouve à 300 secondes ne changent pas : elles ne payaient déjà qu'une
unité par épisode.

## 4. Justesse préservée, vérifiée sur les fichiers réels

L'escalade complète a été rejouée sur les cinq séries de référence :

| Série | Trouvé | Fenêtre utile |
| --- | --- | --- |
| Dragon Ball Z | 0,7 s | 300 s |
| The Office S5 | 46,0 s | 300 s |
| **Silo S2** | 347,5 s | **600 s** |
| Evangelion S1 | 0,3 s | 300 s |
| Bleach S4 | 15,8 s | 300 s |

**5 sur 5.** La répartition confirme la conception : quatre séries sur cinq n'ont jamais besoin
d'élargir, et *Silo* — la seule qui en ait besoin — réussit dès son premier épisode, ce qui garde
l'escalade ouverte pour toute la saison.

## 5. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Suite serveur | **78 fichiers, 731 tests, 0 échec** |
| Suite Web | 20 fichiers, 172 tests, 0 échec |
| Typechecks serveur, contrats, Web, Kotlin | aucune erreur |
| Justesse sur cinq séries réelles | **5 sur 5** |

## 6. Reste à exécuter

| Sujet | Pourquoi |
| --- | --- |
| **La cadence sur le NAS** | Le gain est raisonné sur des unités de coût mesurées ; la cadence réelle reste à constater, comme pour r72. |
| r69 à r72 sur l'appareil | testés ensemble, comme convenu |
| Mesures de capacité au repos | rétabliront le plafond à 7 |

## 7. Ce que la passe a déjà produit en service

Avant même r73, sur 388 épisodes écoutés : **188 introductions repérées par le son**, soit 48 %. Ce
taux dépasse ce qui était espéré, et il porte sur des séries qu'aucun chapitre ne documente.
