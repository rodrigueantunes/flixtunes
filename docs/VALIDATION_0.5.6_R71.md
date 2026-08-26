# Validation 0.5.6.r71 — le générique se reconnaît à son thème

*25 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §7 liste le reste.*

## 1. Ce que les chapitres ne diront jamais

Après r70, 52 % des épisodes ont leur générique de fin, mais **20 % seulement** ont leur introduction.
Le plafond n'est pas dans la méthode : la moitié des fichiers ne porte aucun chapitre, et certaines
séries n'en portent nulle part. Les sept séries *Dragon Ball* de la médiathèque de référence
totalisent **826 épisodes sans un seul chapitre nommé**.

Le thème d'ouverture, lui, est **le même fichier audio** d'un épisode à l'autre. Deux épisodes mis
côte à côte partagent donc une portion identique, et c'est elle, l'introduction.

## 2. Trois versions, et pourquoi les deux premières ont échoué

**La corrélation globale ne voit pas un générique.** Première version : le décalage entre deux
épisodes était choisi en corrélant les extraits sur toute leur longueur. Cela marchait sur des signaux
d'essai où le thème occupait la moitié du signal — et sur rien d'autre. Dans un vrai épisode, vingt
secondes de générique noyées dans trois cents ne déplacent pas une corrélation d'ensemble. **Aucun des
trois cas réels ne ressortait.**

On compte donc, pour chaque décalage, le nombre de fenêtres de deux secondes qui s'accordent.

**Le candidat doit peser sur l'alignement, pas seulement le suivre.** Deuxième version : l'alignement
était choisi au nombre de fenêtres concordantes, puis le candidat cherché dedans. La durée attendue —
connue par les chapitres des épisodes voisins — arrivait trop tard pour peser, et ne pouvait que
départager des candidats d'un alignement déjà choisi contre elle. Chaque alignement propose désormais
son meilleur candidat, et c'est la comparaison de ces candidats qui désigne l'alignement.

**Une seule paire ne prouve rien.** Sur *Bleach*, la paire E1/E2 donnait 65 s là où les trois autres
s'accordaient sur 105 s. Un accident — une coupure commune, un logo de studio — ressemble à un thème
tant qu'on ne l'a vu qu'une fois. Le consensus exige deux paires indépendantes, au même endroit et de
la même longueur.

## 3. Une « vérité terrain » qui mentait

Trois épisodes de *Silo* saison 1 recevaient un repère que les chapitres contredisaient. J'en ai
conclu deux fois à un défaut de l'algorithme. La vérification directe a tranché : les deux zones que
ces chapitres appellent « Intro » **ne partagent aucun son**.

| Comparaison | Corrélation |
| --- | --- |
| Chapitres de Silo S1, E7 contre E8 | **−0,204** |
| Chapitres de Silo S1, E8 contre E9 | **−0,064** |
| Zones trouvées par l'algorithme, E7 contre E8 | **0,987** |
| Chapitres de Silo S2, E3 contre E4 | 0,989 |

Les chapitres de la saison 1 sont faux ; ceux de la saison 2 sont bons, et l'algorithme les retrouve.
La leçon dépasse ce cas : **un chapitre nommé est une affirmation, pas une preuve**, et la seule
vérification qui vaille est de comparer les sons.

## 4. Résultats sur les fichiers réels

| Série | Trouvé | Vérification |
| --- | --- | --- |
| The Office S5 | 45,4 → 66,6 | chapitres 45,5 → 65,2, écart **0,1 s** |
| Evangelion S1 | 0,3 → 90,4 | chapitres 0,0 → 90,4, écart **0,3 s** |
| Bleach S4 | 15,8 → 120,4 | chapitres 20,7 → 120,4 |
| Silo S2, 5 épisodes sur 5 | ~+4 s au début | chapitres corrects, corrélation 0,989 |
| **Dragon Ball Z, 6 sur 6** | 0,7 → 110,0 s | **aucun chapitre** ; corrélation croisée **0,947 à 0,999** |

*Dragon Ball Z* est le cas qui justifie tout le module : générique de 109,5 s retrouvé sur six
épisodes avec moins d'une seconde de dispersion, sur une série qui ne porte aucun chapitre.

## 5. Ce que la passe coûte, et ce qu'elle ne fait jamais

**Elle ne tourne jamais pendant une lecture.** Un repère absent au lancement d'un épisode reste
absent : on ne propose rien plutôt que de faire attendre. La passe se déclenche après une analyse de
bibliothèque et s'efface devant une lecture en cours, comme l'analyse elle-même.

| | |
| --- | --- |
| Extraction | **0,8 s par épisode** mesuré sur *Dragon Ball Z*, jusqu'à 3 s sur de gros fichiers |
| Comparaison | 400 ms pour trois témoins |
| Épisodes à écouter | 6 637, dans 451 saisons |
| Coût total, **une seule fois** | 1,5 h à 5,5 h selon la taille des fichiers |

**Chaque épisode n'est écouté qu'une fois**, et l'écoute est datée même bredouille : une série sans
thème commun n'en aura pas davantage au prochain scan, et la réécouter serait du décodage pur perdu,
répété à chaque analyse.

Les enveloppes ne sont pas rangées en base — plusieurs centaines de mégaoctets pour une donnée qui se
recalcule en trois secondes. Elles ne vivent que le temps d'une saison, parce qu'un épisode sert de
témoin à plusieurs de ses voisins.

## 6. Deux corrections d'instrument, venues d'ailleurs

Le diagnostic du tone mapping VA-API a révélé trois défauts dans la sonde de capacité, corrigés ici :

- **la sortie d'erreur était tronquée par la fin**, alors que la cause est en tête — le détail
  conservé commençait littéralement par « OF », queue d'un mot coupé ;
- **la sonde tournait en `-loglevel error`**, ce qui masque le refus d'un pilote ; elle refait
  maintenant la commande en bavard quand elle échoue ;
- **la règle « pilote absent » passait avant « nœud de rendu invisible »**, si bien que
  `failed to open /dev/dri/renderD128` envoyait chercher un pilote au lieu d'un périphérique. Ce
  dernier défaut a été trouvé par un test écrit pour le premier.

Le refus du HDR par le circuit vidéo a désormais son propre message : « Ce circuit vidéo ne sait pas
convertir le HDR : Intel ne l'expose qu'à partir de sa 12ᵉ génération. »

## 6.1 Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Suite serveur | **78 fichiers, 729 tests, 0 échec** |
| Suite Web | 20 fichiers, 172 tests, 0 échec |
| Suite Android (JVM) | 200 tests, 0 échec |
| Typechecks serveur, contrats, Web, Kotlin | aucune erreur |

Trente-deux tests ont été ajoutés pour ce seul sujet : dix sur l'algorithme, six sur le consensus,
onze sur l'orchestration, quatre sur l'enchaînement des trois sources, un sur le message du HDR.

## 7. Reste à exécuter

| Sujet | Pourquoi |
| --- | --- |
| **La passe sur le NAS** | Éprouvée sur des fichiers réels depuis ce poste, jamais exécutée par le service. |
| r69 et r70 sur l'appareil | testés ensemble avec r71, comme convenu |
| Audit Vulkan | prévu en r72 : `libplacebo` est compilé mais le paquet n'embarque aucune bibliothèque Vulkan |
| Mesures de capacité au repos | rétabliront le plafond à 7 |
