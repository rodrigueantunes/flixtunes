# Validation 0.5.6.r70 — les épisodes muets héritent des repères de leurs voisins

*25 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §6 liste le reste.*

## 1. Ce que r69 laissait de côté

La r69 repère les génériques dans les **chapitres du fichier**, et couvre ainsi 44 % des épisodes. Le
plafond n'est pas dans la méthode : seuls **52 % des épisodes portent des chapitres**. Les autres ne
sont pas irrécupérables pour autant — leurs voisins de saison, eux, en portent.

Une saison est fabriquée d'un bloc : même thème d'ouverture, même carton de fin, souvent le même
encodage. Quand trois épisodes sur douze sont chapitrés, les neuf autres ont la même forme.

## 2. Ce que la régularité vaut, mesuré

Sur 246 saisons portant au moins trois repères, la durée du générique de fin varie d'un **écart
absolu médian de 0,5 seconde** d'un épisode à l'autre. Au 90ᵉ centile, 8,2 s. Au 95ᵉ, 12 s.

Le seuil retenu est **10 secondes**, ce qui accepte 94 % des saisons et écarte la queue franchement
irrégulière — les lots dépareillés rangés sous un même titre.

### 2.1 Un défaut de conception attrapé par un test

La dispersion se mesurait d'abord à l'**écart-type**. Un cas d'essai l'a mis à terre : une saison
parfaitement régulière où **un seul** épisode porte un chapitre mal nommé — un « Credits » de dix
minutes — a un écart-type énorme, et se voyait rejetée en bloc alors que ses onze autres épisodes
s'accordaient à la seconde près.

L'**écart absolu médian** ignore l'intrus, comme le fait la médiane qu'il accompagne. Le seuil a été
remesuré sur la médiathèque après ce changement, et non transposé.

## 3. Deux questions posées pendant la conception, deux cas de test

**« Et si je n'ai qu'un seul épisode dans la saison ? »** Elle emprunte alors au reste de la série.
Sans ce repli, un pilote rangé seul n'aurait jamais rien, alors que la saison d'à côté dit tout.

L'emprunt reste sûr **parce qu'il ne relâche rien** : le consensus exigé est le même, et une série qui
change de générique d'une saison à l'autre s'écarte d'elle-même. *Silo* le démontre — 77,0 s
d'introduction en saisons 1 et 2, **97,8 s en saison 3** : mélangées, ces valeurs dépassent la
dispersion tolérée et le repli refuse de conclure. Son carton de fin, lui, fait 56,0 s dans les trois
saisons et passe sans peine.

**« Et si j'ajoute un épisode ? »** La passe se relance après chaque analyse et recalcule tout. Un
épisode ajouté sans chapitres est complété au scan suivant ; un épisode ajouté **avec** chapitres
enrichit ses voisins à son tour, et peut débloquer une saison qui n'atteignait pas le quorum. Une
source plus sûre n'est jamais écrasée par une plus faible.

## 4. Où le calcul a lieu, et où il n'a pas lieu

**Après un scan, jamais pendant une lecture.** C'est la règle qui gouverne tout le module. Un repère
absent au moment où l'on lance un épisode ne se calcule pas à ce moment-là : on ne propose simplement
rien. Le lecteur ne paie jamais.

La passe ne lit **aucun fichier** — tout vient des métadonnées déjà rangées — et traverse les 8 190
épisodes de la médiathèque de référence en quelques centaines de millisecondes.

Les enveloppes sonores, elles, ne sont pas rangées en base : plusieurs centaines de mégaoctets pour
une donnée qui se recalcule en trois secondes. Ce qu'on garde, c'est le résultat, avec sa provenance.

## 5. Résultats mesurés

Sur les 8 190 épisodes de la médiathèque de référence :

| | avant r70 | après r70 |
| --- | --- | --- |
| générique de fin | 3 571 (44 %) | **4 241 (52 %)** |
| introduction | 1 538 (19 %) | **1 648 (20 %)** |

Le repli sur la série apporte une centaine d'épisodes au-delà de la seule saison.

| Mesure | Résultat |
| --- | --- |
| Suite serveur | **74 fichiers, 697 tests, 0 échec** |
| Suite Web | **20 fichiers, 172 tests, 0 échec** |
| Suite Android (JVM) | **200 tests, 0 échec** |
| Typechecks serveur, contrats, Web, Kotlin | aucune erreur |

Aucun client n'a changé : r70 est entièrement côté serveur, et l'APK de r69 reste valable.

## 6. Reste à exécuter

| Sujet | Pourquoi |
| --- | --- |
| **La passe sur le NAS** | Mesurée sur une copie de la base, pas exécutée sur le service. |
| Le repérage par le son | Écrit et éprouvé, mis de côté : voir `docs/prepare-r71/`. Trois épisodes de *Silo* S1 sur quatre reçoivent un mauvais repère, et le correctif est identifié. |
| Les cartes de r69 sur l'appareil | toujours pas observées sur un mobile ni un téléviseur |
| Décalage audio après un saut (r67) | même réserve |
| Mesures de capacité au repos | rétabliront les 471 im/s et le plafond à 7 |
