# Validation 0.5.6.r75 — une saison qui revient ne se réécoute plus en entier

*26 août 2026. Cette note ne rapporte que des résultats **réellement exécutés** ; le §5 liste le reste.*

## 1. Ce que r74 a rendu visible

L'écran de r74 affichait, à quelques minutes d'intervalle, des noms de séries déjà traitées. La
question posée en retour — *« je vois des noms de séries qu'on avait déjà vues »* — portait juste.

La cause est dans le choix des épisodes à traiter. Il n'écartait que ceux dont les **chapitres**
renseignent l'introduction :

```ts
const aTraiter = episodes.map((episode, index) => ({ episode, index }))
  .filter(({ episode }) => introDesChapitres(episode) == null);
```

Rien n'y écartait les épisodes **déjà écoutés**. Or une saison rentre dans la file dès que deux de ses
épisodes n'ont ni repère ni écoute — ce que produit n'importe quelle analyse qui ajoute des épisodes.
La saison entière était alors redécodée pour ces deux-là.

## 2. Deux torts, dont le second n'est pas du gaspillage

**Le coût d'un ajout n'était pas celui de l'ajout, mais celui de la saison.** Tout le dispositif
repose sur « on n'écoute jamais deux fois » — c'est la raison d'être de `ecoute_le`, et ce qui rend la
passe supportable sur un Celeron à quatre cœurs. Le modèle de coût de r73 chiffre l'écart :

| Saison de vingt épisodes revenue pour deux nouveautés | Épisodes décodés |
| --- | --- |
| r74 | **20** |
| r75 | **2** |

**Et la seconde écoute pouvait abîmer la première.** `remplace` accepte une source de rang égal :
`empreinte` l'emporte sur `empreinte`. La deuxième passe ne travaillant pas sur les mêmes témoins que
la première — les nouveaux épisodes en font partie —, elle pouvait remplacer un repère juste par un
moins bon, sans que rien ne le signale. C'est ce point-là qui a fait basculer la décision : un
gaspillage se supporte, une régression silencieuse non.

## 3. Le remède

Trois familles d'épisodes n'ont rien à recevoir : ceux que leurs chapitres renseignent, ceux qui ont
déjà une introduction quelle qu'en soit la source, et ceux qu'on a **déjà écoutés, même bredouilles**.

Aucun n'est retiré de la liste des épisodes pour autant : **ils restent témoins**. Les écarter
appauvrirait la comparaison de ceux qui restent, alors qu'un épisode déjà entendu est justement un
excellent point de repère.

Le prédicat retenu est **exactement celui de `saisonsIncompletes`** : ce qui met une saison dans la
file et ce qu'on y fait doivent désigner les mêmes épisodes. C'est cette règle qui manquait.

## 3 bis. La révision s'affiche partout où la version s'affiche

`0.5.6` ne suffit pas à savoir ce qu'une machine porte : deux paquets qui embarquent des correctifs
différents annonçaient le même numéro, et aucun diagnostic à distance n'était possible.

- **Serveur** : `/api/system/status` rend désormais `packageRevision`, comme `/api/health` le faisait
  déjà. La tuile du diagnostic Web affiche `v0.5.6 r75 · étape 56`.
- **Android** : une puce `v0.5.6 r75` posée **contre l'enseigne, sur l'accueil seulement**. Elle est
  dessinée comme une puce de filtre au repos — contour fin, coins à dix, texte en retrait — mais
  **sans focus ni clic** : c'est une mention, pas une commande, et l'ajouter au parcours de la
  télécommande allongerait le chemin vers la grille pour un texte qu'on ne fait que lire.

  Deux essais avant celui-là, et chacun disait quelque chose. À côté du titre du catalogue, elle était
  invisible sur l'accueil — précisément l'écran où on la cherche. Contre l'enseigne mais sur toutes les
  pages, elle cohabitait avec le titre de section et les filtres, où elle n'a rien à dire : une mention
  utile une fois par ouverture n'a pas à occuper la barre en permanence. Le nom de l'application n'y
  figure pas non plus : le mot-symbole est juste à gauche, et « FlixTunes FlixTunes v0.5.6 r75 » ne se
  lit pas.

Le texte vient de `BuildConfig.VERSION_NAME`, que Gradle renseigne depuis la même variable que le
paquet du NAS. Rien n'est écrit en dur, donc rien ne peut diverger : livrer une révision sans mettre
ce texte à jour est impossible. `intituleVersion` détache la révision du numéro — Android exige un nom
d'un seul tenant, `0.5.6.r75`, quand on veut lire `v0.5.6 r75` — et trois cas la vérifient, révision
absente comprise.

## 3 ter. Les commandes du diagnostic serveur rejoignent la règle de r74

Le panneau de diagnostic avait échappé à l'uniformisation : ses boutons retombaient sur le rendu du
navigateur, gris très clair sur fond sombre. Ils relèvent maintenant de la même règle que le reste de
la configuration, **12,5 à 12,67:1 de contraste mesuré**, et leurs champs ont la forme des autres.

Deux défauts de mise en page découverts en le faisant, tous deux mesurés dans le navigateur :

- **Les réglages détaillés n'avaient aucune mise en forme.** `.expert-controls` n'existait pas dans la
  feuille de style : étiquettes et listes se suivaient sans espace — « Mode expertAccélérateur
  Automatique (mesuré) Conversion HDR → SDR… ». Chaque réglage occupe désormais sa ligne.
- **Un bouton seul dans une grille en occupe toute la largeur.** « Refaire les mesures » barrait le
  panneau sur 661 px et prenait l'allure de l'action principale ; il en fait 157, la largeur de son
  texte.

## 4. Résultats mesurés

| Mesure | Résultat |
| --- | --- |
| Suite serveur | **78 fichiers, 737 tests, 0 échec** |
| Suite Web | 20 fichiers, 174 tests, 0 échec |
| Tests JVM Android | **verts**, `intituleVersion` compris |
| APK vérifié par extraction | `0.5.6.r75` dans le dex, `PuceVersion` présente |
| APKG vérifié par extraction | `packageRevision`, la peau du diagnostic et le filtre de r75 y sont |
| Typechecks serveur, contrats, Web, Kotlin | aucune erreur |
| Contraste des commandes du diagnostic | **12,5 à 12,67:1**, mesuré dans le navigateur |

Un cas vérifie les deux moitiés de la règle sur une saison de cinq épisodes dont trois ont déjà été
entendus : seuls les deux nouveaux sont repérés, les trois anciens ne sont pas retouchés — **et leur
enveloppe est tout de même lue**, preuve qu'ils servent encore de témoins.

## 5. Reste à exécuter, et une découverte à arbitrer

**Une saison entièrement chapitrée ne quitte jamais la file.** Mesuré en construisant ce correctif,
sur un banc jeté depuis : une saison dont tous les épisodes portent leurs propres chapitres reste
comptée « restante » indéfiniment, et la passe la revisite à chaque analyse pour n'y rien faire.

La cause est que les repères de chapitre **ne se rangent pas en base** — décision documentée, et juste
en soi : ils se relisent du fichier. Mais la file, elle, ne lit que la base, et n'y voyant rien conclut
qu'il reste tout à faire.

L'effet en machine est négligeable — la saison est écartée en une requête. L'effet à l'écran ne l'est
pas : **les 434 saisons restantes ne descendront jamais jusqu'à zéro**, alors que 44 % des épisodes
sont chapitrés. C'est précisément le genre de compteur qui ne converge pas et qu'on finit par ne plus
croire.

Le remède tiendrait en peu de chose — ranger l'introduction déduite des chapitres avec sa provenance
`chapitre`, qu'aucune autre source ne peut écraser — mais il revient sur une décision de conception
écrite noir sur blanc. Il demande donc un arbitrage, pas une initiative.

| Sujet | Pourquoi |
| --- | --- |
| **Les saisons chapitrées bloquées dans la file** | Mesuré ci-dessus ; correctif proposé, arbitrage attendu. |
| La cadence de r73 sur le NAS | Le gain est raisonné sur des unités de coût mesurées ; la cadence réelle reste à constater. |
| Le lecteur sur téléviseur | Le mobile est validé ; la TV ne l'est pas encore. |
| Mesures de capacité au repos | rétabliront le plafond à 7 |
