# Préparation de la r71 — repérage des génériques par le son

Ces cinq fichiers sont **écrits, testés et éprouvés sur la médiathèque**, mais volontairement tenus
hors du dépôt compilé : ils ne sont pas encore assez sûrs pour être livrés. Ils reprennent leur place
dans `apps/server/src/` le jour où le défaut décrit au §3 est corrigé.

| Fichier | Rôle |
| --- | --- |
| `empreinte-sonore.ts` | l'algorithme : enveloppe d'énergie, alignement, segment commun |
| `empreinte-sonore.test.ts` | 10 cas sur signaux fabriqués |
| `empreinte-extraction.ts` | lecture d'une fenêtre audio par FFmpeg, sans décoder le fichier entier |
| `marqueurs-empreinte.ts` | le consensus entre plusieurs paires d'épisodes |
| `marqueurs-empreinte.test.ts` | 6 cas sur le consensus |

## 1. Ce qui marche

Le thème d'ouverture d'une série est **le même fichier audio** d'un épisode à l'autre. Deux épisodes
mis côte à côte partagent donc une portion identique, et c'est elle qu'on cherche. Aucune analyse
d'image, et rien qui tourne pendant une lecture.

Éprouvé contre les chapitres, qui font office de vérité terrain :

| Série | Trouvé | Chapitres | Écart au début |
| --- | --- | --- | --- |
| The Office S5 | 45,4 → 66,6 | 45,5 → 65,2 | **0,1 s** |
| Evangelion S1 | 0,3 → 90,4 | 0,0 → 90,4 | **0,3 s** |
| Bleach S4 | 15,8 → 120,4 | 20,7 → 120,4 | 4,9 s |
| Silo S2, 5 épisodes sur 5 | ~+4 s / +18 s | 77,0 s partout | +4,0 à +4,7 s |

Coût mesuré : **2 à 3 s d'extraction par épisode**, 400 ms de comparaison, une seule fois.

## 2. Deux leçons déjà payées, à ne pas repayer

**L'alignement se choisit sur la concordance locale, jamais globale.** Première version : le décalage
était choisi en corrélant les deux extraits sur toute leur longueur. Cela marchait sur des signaux
d'essai où le thème occupait la moitié du signal — et sur rien d'autre. Dans un vrai épisode le
générique fait vingt secondes sur trois cents : noyé, il ne déplace pas une corrélation d'ensemble.
Aucun des trois cas réels ne ressortait. On compte donc, pour chaque décalage, le nombre de fenêtres
de deux secondes qui s'accordent.

**Une seule paire ne prouve rien.** Sur *Bleach*, la paire E1/E2 donnait 65 s là où les trois autres
s'accordaient sur 105 s. D'où le consensus : au moins deux paires indépendantes, au même endroit et
de la même longueur.

## 3. Le défaut qui reste, et le correctif que la mesure indique

Sur **Silo S1**, trois épisodes sur quatre reçoivent un mauvais repère : un autre passage récurrent de
90 s, situé juste avant le générique. Trois paires s'accordent dessus — le consensus ne le rattrape
donc pas. Un faux positif de cette taille couperait 90 secondes de contenu.

Les chapitres de Silo donnent le correctif. L'introduction y dure **exactement 77,0 s** dans toute la
saison 1 et la saison 2, et 97,8 s en saison 3 : **c'est une propriété de la saison**. Or tous les
candidats sonores font ~90 s.

> **Le correctif : quand une série possède des chapitres nommés, ne serait-ce que sur quelques
> épisodes, leur durée doit arbitrer les candidats sonores des autres.** Silo est chapitré en S1E7–E10
> et sur toute la S2 : de quoi trancher pour S1E1–E6, qui ne le sont pas.

Faute de tout chapitre dans la série, le consensus reste seul juge — et devra alors être plus exigeant.

## 4. Un générique peut changer **au sein** d'une même saison

Signalé le 25 août 2026, et c'est rare mais réel : l'animation japonaise change souvent d'ouverture
tous les vingt ou trente épisodes, parfois sans changer de saison. *Dragon Ball Z* en est l'exemple.

Deux conséquences, opposées :

- **Pour la déduction entre voisins (r70), le cas est sans danger** : soit les deux génériques
  occupent la même place et durent le même temps — la déduction reste juste — soit ils diffèrent, la
  dispersion dépasse le seuil, et le repli s'abstient. La règle se protège d'elle-même.
- **Pour le repérage par le son, c'est une contrainte de conception.** Comparer un épisode à des
  témoins pris au hasard dans la saison mènerait à des paires sans thème commun, et le consensus
  s'effondrerait. Les témoins doivent être choisis **parmi les épisodes voisins par leur numéro**, et
  un désaccord franc entre deux groupes doit être lu comme « cette saison en a deux » plutôt que
  comme un échec.

La médiathèque de référence rend ce point pressant : les sept séries *Dragon Ball* y totalisent **826
épisodes et pas un seul chapitre nommé**. Elles dépendent donc entièrement de cette méthode, et sont
précisément celles qui changent de générique en cours de saison.

## 5. Deux mesures à reporter dans la mise en œuvre

- **La fenêtre d'analyse doit couvrir quinze minutes.** Silo S1E9 commence son générique à **809 s**.
  Mesuré sur 1 538 introductions nommées : 5 min en couvrent 84,7 %, 10 min 98,9 %, 15 min 100 %.
- **Le calcul se fait au scan, par saison, jamais à la lecture.** Un repère manquant au lancement ne
  se calcule pas à ce moment-là : on ne propose simplement rien. Les enveloppes ne se rangent pas en
  base — plusieurs centaines de mégaoctets pour une donnée qui se recalcule en trois secondes.
