# Préparation — rendre le plafond de conversions réglable

*24 août 2026. Spécification de préparation. **Rien n'est implémenté** ; ce document décrit ce qu'il
faudra faire et où, pour être repris tel quel le moment venu.*

## 1. Le constat : ce n'est pas un manque, c'est un oubli

`apps/server/src/preferences-conversion.ts` a été écrit précisément pour ce problème. Son
commentaire d'en-tête l'énonce :

> Les réglages de conversion, modifiables sans redémarrer ni ouvrir un terminal. Ils n'existaient que
> sous forme de variables d'environnement […] écrites dans un fichier que seul un accès SSH permet
> d'atteindre. Le réglage était donc théorique : personne ne pouvait forcer un chemin pour comparer,
> ni revenir en arrière après un essai malheureux.

Le module a récupéré l'accélérateur, le tone mapping, le codec de sortie et la résolution maximale.
**`FLIXTUNES_TRANSCODE_CONCURRENCY` est resté derrière.** Le 24 août 2026 il a fallu monter le
partage SMB du NAS, modifier `flixtunes.env` à la main et prévoir un redémarrage du service pour
changer un seul entier — exactement la situation que ce module existe pour supprimer.

Il n'y a donc pas de mécanisme à inventer : il y a un réglage à faire rejoindre les autres.

## 2. Le vrai défaut à corriger au passage : un défaut constant

Aujourd'hui `config.ts:88` :

```ts
transcodeConcurrency: Math.max(1, Math.min(8, Number(process.env.FLIXTUNES_TRANSCODE_CONCURRENCY ?? 2))),
```

Le `?? 2` est une **constante**, identique sur toutes les machines. C'est la source du problème
relevé au §13.4 de `AUDIT_ACCES_INTERNET.md` : un défaut à 6 serait dangereux sur un NAS faible, un
défaut à 2 bride une machine qui en soutient 7. Aucune valeur fixe ne peut être juste sur les deux.

**Or la machine sait déjà.** `capacity.ts` mesure un budget par micro-banc — 7,5 unités sur l'AS5404T
— et calcule déjà le nombre de sessions 1080p soutenables : 7. Le défaut ne devrait pas être une
constante, il devrait être **dérivé de cette mesure**.

Proposition, lisible et explicable :

> **Le plafond automatique vaut ce que la mesure annonce pour du 1080p, moins une session de marge.**

Sur ce NAS : 7 mesurées → **plafond 6**. Exactement la valeur choisie à la main, mais obtenue par la
machine plutôt que par un humain qui lit un rapport. Un NAS plus faible mesure un budget plus petit
et obtient un plafond plus petit — **le danger décrit au §13.4 disparaît de lui-même**, sans que
personne ait à connaître son matériel.

## 3. Ordre de priorité, aligné sur la règle déjà posée

Le module énonce sa propre règle : « La variable d'environnement reste la valeur par défaut : une
installation qui la pose garde son comportement tant que personne n'a choisi autre chose depuis
l'interface. » On la respecte à l'identique :

1. **choix explicite enregistré depuis l'interface**, s'il existe ;
2. sinon **`FLIXTUNES_TRANSCODE_CONCURRENCY`**, si elle est posée ;
3. sinon **`auto`** — dérivé de la mesure (§2).

### 3.1 Le piège : distinguer « non posée » de « posée à 2 »

Le `?? 2` actuel rend les deux cas indiscernables : une installation qui ne configure rien ressemble
à une installation qui a délibérément choisi 2. Tant que ce défaut est en place, le rang 3 ne peut
pas exister.

`config.transcodeConcurrency` doit donc devenir **`number | null`**, `null` signifiant « non posée ».
Les bornes `1..8` restent, mais ne s'appliquent qu'à une valeur réellement fournie. C'est le
changement le plus facile à oublier de toute la liste, et rien ne le signalerait : le comportement
resterait simplement figé à 2 pour tout le monde.

## 4. Points de modification

| Fichier | Nature |
| --- | --- |
| `apps/server/src/config.ts:88` | `?? 2` retiré ; le réglage devient `number \| null` (§3.1) |
| `apps/server/src/preferences-conversion.ts` | champ `conversionsSimultanees: number \| "auto"`, défaut `"auto"` |
| `apps/server/src/capacity.ts:354` | lire la préférence au lieu de `config.transcodeConcurrency` |
| `apps/server/src/playback.ts:2025` | idem |
| `apps/server/src/capacity.ts` (`buildCapacityAlerts`) | alerte quand le plafond choisi dépasse la mesure (§6) |
| `packages/contracts/src/index.ts` | type et validation du nouveau champ |
| `apps/web/src` — écran capacité | le réglage, posé **à côté de la mesure** (§5) |
| `.env.example` | documenter que la variable n'est plus qu'un défaut, et que `auto` existe |

**Application immédiate, sans redémarrage :** les deux seuls points de lecture
(`capacity.ts:354`, `playback.ts:2025`) construisent leur objet **à chaque appel**, et non au
chargement du module. Lire la préférence au lieu de la configuration suffit donc à rendre le réglage
effectif sur-le-champ — aucune invalidation ni propagation à écrire.

### 4.1 Un piège de validation propre à ce champ

`valide()` dans `preferences-conversion.ts` ne sait traiter que des **chaînes appartenant à une liste
close**. Le nouveau champ est un nombre : il lui faut son propre contrôle — entier, borné, et repli
sur `"auto"` en cas de valeur illisible.

Ce n'est pas théorique : la route `PUT /api/system/conversion-preferences` (`routes.ts:413`) passe
`request.body` au module **sans validation zod**, en s'appuyant entièrement sur `valide()`. Un nombre
non contrôlé y arriverait tel quel — `0`, `-1`, `999` ou `NaN` — et se retrouverait comparé au nombre
de sessions actives dans l'admission. Un `0` fermerait toute lecture sur le serveur ; un `NaN`
rendrait chaque comparaison fausse et **lèverait tout plafond**.

## 5. Où le réglage doit se trouver dans l'interface

**À côté de la mesure, pas dans une page de réglages lointaine.** L'écran de capacité affiche déjà ce
que la machine soutient — 7 sessions 1080p, 5 en HDR converti, 2 en 4K. Le plafond se choisit en
regardant ces chiffres, sinon on choisit à l'aveugle.

La forme qui découle du §3 : un contrôle à trois états — **Automatique** (valeur dérivée affichée, par
exemple « Automatique — 6 »), ou une valeur imposée. Le mode expert du module gouverne déjà
l'affichage des réglages détaillés ; celui-ci s'y range naturellement.

## 6. Ce que le réglage ne doit pas pouvoir faire

**Il ne remplace pas le budget mesuré, il s'ajoute à lui.** L'admission (`capacity.ts:205-207`)
vérifie d'abord le compteur, puis le budget. Le budget doit rester le garde-fou physique : deux
sessions 4K coûtent 7,5 unités à elles seules et resteront refusées, quel que soit le plafond choisi.
De même pour la limite thermique de 85 °C et la réserve de 40 % qui protège interface et analyses.

En conséquence, un plafond supérieur à ce que la mesure annonce **n'est pas une erreur à bloquer,
mais un écart à signaler** — conformément à la philosophie déjà écrite dans le module : « voir ce que
la mesure a trouvé, et la contredire quand on a une raison ». L'alerte revient à
`buildCapacityAlerts`, qui produit déjà ce type de message avec une action corrective.

## 7. Vérification attendue le jour de la réalisation

- une installation sans variable ni réglage enregistré obtient le plafond dérivé de **sa propre**
  mesure, et non 2 ;
- une installation qui pose la variable garde exactement son comportement actuel ;
- un choix depuis l'interface l'emporte sur la variable, et **prend effet sans redémarrage** ;
- `0`, `-1`, `999`, `NaN` et une chaîne vide sont refusés sans jamais atteindre l'admission ;
- un plafond supérieur à la mesure est accepté **et** signalé par une alerte ;
- le budget, la limite thermique et la réserve continuent de refuser ce qui ne tient pas, plafond
  élevé ou non ;
- la route reste **interdite depuis le WAN** — rang 1 du §11.2 de `AUDIT_ACCES_INTERNET.md`.

## 8. Rattachement

Ce travail est petit et sans dépendance. Il n'appelle pas d'étape à lui seul : il se range
naturellement dans **l'étape qui touchera l'écran de capacité ou l'administration** — l'étape 61 du
découpage proposé dans `REVUE_ETAPES_RESTANTES.md`.

Rien n'oblige toutefois à attendre : c'est un candidat évident pour accompagner n'importe quelle
révision, le jour où l'on ouvrira ces fichiers pour autre chose.

**En attendant, le NAS garde son réglage manuel** — `FLIXTUNES_TRANSCODE_CONCURRENCY=6` dans
`/volume1/FlixTunes/config/flixtunes.env`, écrit le 24 août 2026, **actif au prochain redémarrage du
service**.
