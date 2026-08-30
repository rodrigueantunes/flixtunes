# Chantier r88 — audit des dix points

*30 août 2026. Les dix demandes relevées pendant la génération de la r87, chacune confrontée au code
avant d'être chiffrée. Ce document ne construit rien : il dit ce qui est **mesuré**, ce qui est
**supposé**, et ce qu'il faut décider avant de commencer.*

Rien n'est engagé tant que le feu vert n'est pas donné, point par point ou en bloc.

---

## Vue d'ensemble

| | Point | Cause trouvée ? | Effort | À décider |
| --- | --- | --- | --- | --- |
| 1 | Génériques à l'ajout | **partielle** | moyen | le symptôme exact |
| 2 | Bouton « analyser les génériques restants » | sans objet, c'est un ajout | **faible** | — |
| 3 | Talent limité | **oui, mesurée** | faible | le plafond voulu |
| 4 | ~20 films manquants | non — demande une mesure | moyen | l'accès aux fichiers |
| 5 | TMDB qui disparaît | **oui, mesurée** | moyen | — |
| 6 | Ajouter IMDb | sans objet | **moyen à élevé** | ce qu'on en attend |
| 7 | Défilement en haut à l'ouverture | **oui** | faible | — |
| 8 | Boutons restants (thème) | oui | faible | — |
| 9 | Sous-titres dédoublés | non — trois pistes possibles | moyen | un cas reproductible |
| 10 | Live TV et fournisseurs | sans objet | **élevé** | beaucoup, voir §10 |

Les points 2, 3, 7 et 8 sont petits et sûrs : ils peuvent partir tout de suite. Le 10 est un
sous-système à lui seul et mérite d'être découpé.

---

## 1. Le repérage des génériques à l'ajout

**Ce que fait le code aujourd'hui.** La passe se déclenche à un seul endroit : la fin d'une analyse de
bibliothèque, dans `scan-coordinator.ts:261`. Trois sources en cascade — les chapitres du fichier
(gratuit), les voisins de saison (gratuit), l'empreinte sonore (2 à 3 s par épisode, et seulement si
le repérage est **activé**).

**Deux défauts possibles, trouvés en lisant :**

- La passe reçoit le signal d'annulation **de l'analyse qui l'a lancée**. Elle peut durer des heures ;
  l'analyse, elle, est finie. Annuler une analyse qui n'existe plus n'arrive pas, mais le lien est
  faux et il rend le comportement difficile à prévoir.
- `if (enCours) return bilan` : si plusieurs bibliothèques finissent leur analyse ensemble, seule la
  première lance la passe. Les autres repartent **sans rien faire** — y compris les deux étapes
  gratuites. Un ajout dans une seconde bibliothèque peut donc rester sans repère jusqu'à l'analyse
  suivante.

**Ce qu'il me manque :** ce que vous voyez. « Problème » peut vouloir dire l'analyse qui ne démarre
pas, qui ne finit pas, qui recommence tout, ou qui bloque la machine. La correction n'est pas la même.

## 2. Un bouton pour reprendre les génériques restants

Aujourd'hui il n'y a que l'interrupteur : l'activer lance une passe, le désactiver l'arrête. Il n'y a
pas de « lance-la maintenant, sur ce qui manque, et rien d'autre ».

C'est un ajout simple, et le serveur a déjà tout : `saisonsIncompletes()` donne exactement la liste
des saisons restantes, et la route `POST /api/system/generiques/arret` sait interrompre. Il faut une
route de plus — `POST /api/system/generiques/passe` — et un bouton dans l'écran d'administration, à
côté de l'interrupteur, qui affiche le nombre de saisons restantes avant de partir.

« Et seulement ça » est important et sera tenu : le bouton ne relance **aucune** analyse de
bibliothèque, ne retouche aucune fiche, ne redescend chez aucun fournisseur.

## 3. Les personnes liées à un film sont plafonnées

**Mesuré**, dans `tmdb.ts` :

| Ligne | Plafond | Effet |
| --- | --- | --- |
| 463 | `.slice(0, 24)` sur le casting | 24 acteurs au maximum, quel que soit le film |
| 489 | `>= 12` sur l'équipe | 12 personnes hors acteurs, réalisation comprise |

Rien n'est cassé : ces plafonds ont été posés pour ne pas gonfler la base. Mais ils sont **arbitraires
et invisibles** — rien à l'écran ne dit qu'on regarde une liste tronquée.

Trois questions avant de toucher : quel plafond voulez-vous (50 ? tout le casting ?), faut-il le même
pour les films et les séries, et faut-il **rejouer** les fiches déjà enregistrées — sans quoi les
films déjà en base garderont leurs 24 acteurs jusqu'à une correction manuelle. Le coût réel est là,
pas dans le changement de chiffre.

## 4. Une vingtaine de films manquants

Rien à trouver dans le code sans les fichiers : « manquant » peut arriver par trois chemins
différents, et ils n'ont pas le même remède.

1. **Le fichier n'est pas vu du tout** — extension, dossier écarté, nom illisible par l'analyseur.
2. **Il est vu mais sans correspondance** — la fiche existe, vide, et n'apparaît pas là où on la
   cherche.
3. **Il est vu et mal apparié** — *A Star Is Born* en compte quatre : 1937, 1954, 1976, 2018. Un
   fichier sans année dans son nom tombe sur la plus connue.

Le troisième cas est le plus probable pour l'exemple donné, et c'est le seul des trois qui se
diagnostique depuis mon poste — à condition de lire la base et les noms de fichiers, comme pour la
mesure d'appariement. **Ce qu'il me faut : la liste des vingt titres**, ou l'accès pour la produire.
Sans elle, je corrigerais au hasard.

## 5. TMDB qui disparaît puis revient au bout de trente secondes

**Cause trouvée, et elle correspond exactement à ce que vous décrivez.** `resilience.ts` :

```
export class CircuitBreaker {
  constructor(private readonly threshold = 4, private readonly resetMs = 30_000) {}
```

Quatre échecs de suite isolent TMDB pendant **trente secondes**. C'est le « au bout de 30 s / 1 min il
revient », au réglage près. Ce n'est donc pas TMDB qui tombe : c'est nous qui le mettons de côté.

Reste à savoir **pourquoi les quatre échecs** — et là, le code ne sait pas le dire, ce qui est le vrai
défaut. Il n'y a nulle part dans `tmdb.ts` de traitement du code 429 ni de l'en-tête `Retry-After` :
une limitation de débit est comptée comme une panne. Et rien ne limite notre propre cadence pendant
une session de correspondance, où les requêtes partent en rafale.

Ce que je propose, dans cet ordre :

1. **Dire ce qui se passe.** Journaliser le code HTTP qui a provoqué chaque échec, et afficher
   l'isolement à l'écran au lieu de le subir. Un fournisseur qui disparaît sans un mot est le vrai
   problème.
2. **Distinguer « trop vite » de « en panne ».** Un 429 n'incrémente pas le compteur d'échecs : il
   fait attendre le délai que TMDB indique, puis on recommence.
3. **Ne pas y aller si vite.** Une file à cadence bornée pour les appels TMDB, plutôt que des rafales.

## 6. Ajouter IMDb

À dire franchement avant de chiffrer : **IMDb n'a pas d'interface publique**. Ce qui existe :

| Voie | Ce qu'on obtient | Ce que ça coûte |
| --- | --- | --- |
| Les **identifiants** IMDb via TMDB | déjà là — TMDB rend `external_ids` | rien, c'est fait |
| Les **exports de données** IMDb (fichiers publics) | notes, votes, titres alternatifs, équipe | un import périodique, quelques centaines de Mio |
| Une **API tierce** (OMDb…) | notes et résumés | une clé, une limite de requêtes, une dépendance de plus |
| Extraire des pages du site | tout | interdit par leurs conditions — écarté |

Ma lecture : ce que vous cherchez est probablement la **note IMDb** et peut-être les titres alternatifs
pour mieux apparier — pas un second catalogue. Si c'est cela, la voie des exports publics est la
bonne : elle est légale, hors ligne, et elle sert aussi le point 4 en donnant à l'appariement des
titres alternatifs qu'il n'a pas aujourd'hui. Dites-moi ce que vous en attendez et je chiffre celle-là.

## 7. Le défilement doit repartir en haut à chaque écran

**Trouvé.** `App.tsx:853` remet bien la page en haut — mais seulement dans `navigate()`, la navigation
principale. Les écrans d'ouverture — choix du groupe, puis de l'utilisateur — ne passent pas par là :
ils changent d'état sans repasser par cette fonction, et gardent donc la position laissée par l'écran
précédent.

La correction ne doit pas être un `scrollTo` de plus recopié à chaque endroit : c'est ainsi qu'un des
deux finit par être oublié. Un seul point qui observe le changement d'écran et remet en haut, quel que
soit le chemin par lequel on y est arrivé.

## 8. Les boutons restants à mettre au thème

Les boutons du lecteur ont été repris en r87 et unifiés autour de `.player-icon-button`. Ceux des
écrans d'ouverture — ceux du point 7, donc — n'ont pas été touchés.

À faire en même temps que le 7, puisque ce sont les mêmes écrans, et en réutilisant les mêmes jetons
plutôt qu'en écrivant une troisième variante. Rappel de la règle du projet : le Web est la référence,
Android s'aligne dessus ensuite.

## 9. Des sous-titres qui se dédoublent

Non trouvé, et trois causes possibles, qui ne se ressemblent pas :

1. **Le même sous-titre offert deux fois** — une piste incluse dans le fichier *et* un `.srt` posé à
   côté. `playback.ts:960` retient tout fichier dont le nom commence par celui du média : un film
   accompagné de son `.srt` aura les deux, et rien ne les rapproche.
2. **Deux affichages en même temps** — sur le client de bureau, VLC dessine désormais les sous-titres
   image. Si le calque Web en dessinait un aussi, on les verrait tous les deux. Mais vous le voyez
   aussi sur Android, ce qui affaiblit cette piste.
3. **Des répliques doublées dans le flux converti** — le serveur incrusterait deux fois la même piste.

Que ce soit visible sur Android **comme** sur le Web désigne plutôt le serveur ou la base que
l'affichage. Pour trancher sans deviner : **un titre où vous l'avez vu**, et une capture. Je remonte
de là.

## 10. La télévision en direct

C'est le point le plus gros de la liste — un sous-système, pas une fonction. Et il commence par une
mauvaise nouvelle qu'il vaut mieux dire maintenant qu'après.

### Ce qui est possible, et ce qui ne l'est pas

| Fournisseur | Ce qu'il expose | Verdict |
| --- | --- | --- |
| **M3U personnel** | ce que vous lui donnez | **oui**, sans réserve — c'est le socle |
| **Free** | une liste de lecture officielle servie par la Freebox, sur le réseau local | **oui**, si le NAS est sur le même réseau |
| **Orange** | des flux multidiffusés sur leur réseau, aucune liste officielle | **incertain** — dépend de la Livebox, à vérifier chez vous |
| **Bouygues B.TV** | une application, des flux protégés par DRM | **non** — il faudrait déchiffrer, ce qu'on ne fera pas |
| **SFR** | idem | **non**, même raison |

Je peux écrire l'architecture qui accueille tous les fournisseurs de la même façon, et livrer ceux qui
marchent réellement. Ce que je ne ferai pas, c'est mettre « Bouygues » dans une liste déroulante pour
qu'elle affiche une erreur : une fonction qui promet ce qu'elle ne tient pas est pire que son absence
— c'est la même règle qui a fait éteindre les réglages de sous-titres devant une image en r87.

### Le découpage que je propose

| Étape | Contenu |
| --- | --- |
| **a** | Le modèle : sources, chaînes, numéros ; la lecture d'un M3U ; les réglages en base |
| **b** | Le chargement au démarrage, après la médiathèque, avec son pourcentage — comme demandé |
| **c** | L'écran Live TV sur le Web, placé après Séries TV et **seulement si une source est réglée** |
| **d** | La recherche et le filtrage par liste de lecture, sur le modèle des genres |
| **e** | Android TV : la grille, et la saisie du numéro de chaîne à la télécommande |
| **f** | Le guide des programmes (XMLTV), si vous le voulez — c'est un chantier à part entière |

### Ce qu'il faut décider avant l'étape a

- **Le guide des programmes** en fait-il partie ? Sans lui, une chaîne est un nom et une image ; avec
  lui, c'est un vrai téléviseur — et c'est au moins autant de travail que tout le reste.
- **L'enregistrement**, non demandé : je pars du principe que non.
- **Les numéros de chaîne** viennent-ils du M3U quand il les porte (`tvg-chno`), ou se règlent-ils à
  la main ? Les deux se font ; il faut savoir qui gagne.
- **Où vivent les fichiers M3U** sur le NAS, et à quelle fréquence les relire.

---

## Ordre proposé

1. **7 et 8** ensemble — mêmes écrans, correction visible tout de suite.
2. **2** — un bouton, une route, rien de risqué.
3. **5** — la cause est connue, et c'est celle qui gêne le plus au quotidien.
4. **3** — dès que le plafond voulu est fixé.
5. **1 et 9** — quand j'aurai le symptôme et un cas reproductible.
6. **4** — quand j'aurai la liste des titres.
7. **6** — quand on aura dit ce qu'on attend d'IMDb.
8. **10** — par étapes, et pas avant que le reste soit livré.

Le tout ne tient pas dans une révision. Je propose que la r88 porte les points 1 à 5 et 7 à 9, et que
la télévision en direct ouvre son propre chantier.
