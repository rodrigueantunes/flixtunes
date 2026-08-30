# Chantier r88 — audit des dix points

*30 août 2026. Les dix demandes relevées pendant la génération de la r87, chacune confrontée au code
avant d'être chiffrée. Ce document ne construit rien : il dit ce qui est **mesuré**, ce qui est
**supposé**, et ce qu'il faut décider avant de commencer.*

Rien n'est engagé tant que le feu vert n'est pas donné, point par point ou en bloc.

---

## Vue d'ensemble

| | Point | Cause trouvée ? | Effort | À décider |
| --- | --- | --- | --- | --- |
| 1 | Génériques à l'ajout | **oui, prouvée** — SILO S03E09 | ~~moyen~~ | **fait** |
| 2 | Bouton « analyser les génériques restants » | sans objet, c'est un ajout | ~~faible~~ | **fait** |
| 3 | Talent limité | **la cause est ailleurs** — voir §3 | moyen | une mesure sur sa base |
| 4 | ~20 films manquants | non — demande une mesure | moyen | l'accès aux fichiers |
| 5 | TMDB qui disparaît | **oui, mesurée** | ~~moyen~~ | **fait** |
| 6 | Ajouter IMDb | sans objet | **moyen à élevé** | son rôle est tranché : repli de TMDB |
| 7 | Défilement en haut à l'ouverture | **oui** | ~~faible~~ | **fait** |
| 8 | Boutons restants (thème) | oui | ~~faible~~ | **fait** |
| 9 | Sous-titres dédoublés | non | — | **mis de côté** à sa demande |
| 10 | Live TV et fournisseurs | **reporté** — voir §10 | — | la question des sources |

**Cinq points sont faits** — 1, 2, 5, 7 et 8. Le 9 et le 10 sont mis de côté à sa demande. Restent le
3, dont la cause s'est révélée être ailleurs que le plafond, le 4, et le 6 dont le rôle est maintenant
tranché.

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

### Sauf que le plafond n'est pas ce qu'on voit

Réponse du 30 août : « c'est très bien comme c'est mais étrange, j'en ramène pas autant. » Autrement
dit les listes affichées sont **bien en deçà de 24**, et le plafond n'est donc pas ce qui coupe.

Cela déplace entièrement le point. Quatre endroits peuvent perdre des personnes entre TMDB et
l'écran, et il faut mesurer lequel avant de toucher à quoi que ce soit :

1. **La demande** — `credits` n'est joint qu'à l'œuvre racine (`rootWork`) ; un épisode ou une saison
   pourrait n'en recevoir aucun.
2. **L'enregistrement** — la clé de déduplication est `acteur:<id>:<personnage>` ; deux rôles du même
   acteur comptent pour deux, mais un personnage vide pourrait en écraser un autre.
3. **La lecture** — la fiche affichée pourrait tronquer, indépendamment de ce qui est en base.
4. **L'ancienneté** — une fiche enregistrée avant une correction garde ce qu'elle avait ; rien ne
   reprend une correspondance automatique déjà sûre.

Ce qu'il me faut : **un film précis** et le nombre de personnes affichées. Je compare alors à ce que
TMDB rend pour lui, et la marche se voit d'un coup.

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

À dire franchement avant de chiffrer : **IMDb n'a pas d'API publique**. Ce qui existe :

| Voie | Ce qu'on obtient | Ce que ça coûte |
| --- | --- | --- |
| Les **identifiants** IMDb via TMDB | déjà là — TMDB rend `external_ids` | rien, c'est fait |
| Les **jeux de données** publics | titres, années, titres alternatifs, notes, épisodes | un téléchargement périodique — **aucune clé, aucun compte** |
| Une **API licenciée** | tout | le connecteur existe déjà dans le code, en attente d'un accès payant |
| Une **API tierce** (OMDb…) | notes et résumés | une clé, une limite de requêtes, un second point de panne |
| Extraire des pages du site | tout | interdit par leurs conditions — écarté |

### Aucune clé n'est nécessaire

Les fichiers sont servis en clair sur `datasets.imdbws.com`, rafraîchis quotidiennement, sous licence
**non commerciale** — ce qui couvre exactement un serveur personnel. Tailles **relevées le 30 août
2026**, dans les en-têtes HTTP :

| Fichier | Taille | Utile au repli ? |
| --- | --- | --- |
| `title.basics.tsv.gz` | 215,7 Mio | **oui** — titre, titre original, année, type, durée, genres |
| `title.akas.tsv.gz` | 488,5 Mio | **oui** — les titres alternatifs, y compris français |
| `title.ratings.tsv.gz` | 8,2 Mio | **oui** — la note et le nombre de votes |
| `title.episode.tsv.gz` | 52 Mio | **oui** pour les séries — série parente, saison, épisode |
| `title.principals.tsv.gz` | 744,6 Mio | **la distribution — voir ci-dessous** |
| `name.basics.tsv.gz` | 294,6 Mio | les personnes, sans photo |

### La distribution y est, mais elle est plus maigre que celle de TMDB

`title.principals` porte bien les acteurs, avec leurs personnages : colonnes `tconst, ordering,
nconst, category, job, characters`, et les rôles les plus fréquents sont `actor`, `actress`,
`writer`, `director`. Relevé sur 13 520 œuvres du début du fichier :

| Mesure | Valeur |
| --- | --- |
| Personnes par œuvre, **médiane** | **10** |
| Maximum observé | 35 |
| Photo de la personne | **aucune** — `name.basics` n'a pas de colonne d'image |

Le nom du fichier ne ment pas : ce sont les **principaux**, pas la distribution complète. Dix par
œuvre en médiane, là où TMDB en rend jusqu'à vingt-quatre **avec les portraits**. Comme source pour
l'écran « Talents », ce serait donc un recul et non un progrès — ce qui n'enlève rien à son intérêt
comme repli, quand TMDB ne répond pas du tout.

*Réserve honnête sur cette mesure : l'échantillon est le début du fichier, donc des œuvres anciennes
et courtes. La médiane de dix demande à être confirmée sur des films récents avant d'en tirer une
conclusion définitive.*

### Il n'y a pas de résumé, dans aucune langue

Vérifié deux fois : les sept fichiers publiés n'ont aucune colonne de synopsis, et les noms
plausibles d'un huitième fichier — `title.description`, `title.plot`, `title.overview`,
`title.summaries` — répondent tous **absent**.

Le **site** d'IMDb affiche bien des résumés, en français compris — c'est sans doute de là que vient l'impression.
Mais ce que le site affiche et ce que les jeux de données publient sont deux choses différentes, et
seule la seconde est utilisable sans extraire des pages, ce qu'on ne fera pas.

Un résumé venant d'IMDb passerait donc par l'**API licenciée** — le connecteur existe déjà dans le
code, en attente d'un accès payant. C'est une décision de budget, pas de technique.

### Et en français ?

Relevé sur les premières lignes des fichiers, le 30 août 2026, plutôt que supposé.

**Les titres, oui.** `title.akas` porte 9 795 lignes de région `FR` sur les 251 278 premières, soit
près de 4 %. Et **plusieurs variantes par œuvre** — *La sortie de l'usine*, *La sortie de l'usine
Lumière*, *La sortie des ouvriers de l'usine Lumière* pour un seul titre. C'est exactement ce qui
permet de reconnaître un nom de fichier, et c'est ce qui sert aussi au point 4.

Attention toutefois : dans `title.basics`, `primaryTitle` est le titre **le plus connu**, souvent
l'anglais — `Poor Pierrot` là où `originalTitle` dit `Pauvre Pierrot`. C'est `title.akas` qui porte le
français, pas `title.basics`.

**Les genres, en anglais.** `Animation,Comedy,Romance`. Une liste fixe d'environ vingt-huit valeurs,
traduite une fois chez nous — ce n'est pas un obstacle, c'est une table de correspondance.

**Le résumé, non — et dans aucune langue.** Aucun des sept fichiers ne porte de synopsis, ni
d'affiche. Un repli IMDb donnerait donc le bon titre français, l'année, la note et les genres, mais
une fiche **sans résumé et sans jaquette**.

C'est acceptable pour ce qu'on lui demande, et deux choses l'atténuent déjà : Fanart.tv est branché
pour les images, et depuis la r88 une fiche de repli est marquée « à revoir » — elle sera remplacée
par celle de TMDB dès qu'il répondra. Le repli n'est pas un état final.

### Ce qui coûtera vraiment, et qu'il faudra mesurer sur le NAS

Pas le téléchargement — trois quarts de gigaoctet une fois par mois. C'est l'**import**.
`title.akas` porte des dizaines de millions de lignes, et les avaler telles quelles sur un Celeron à
quatre cœurs donnerait une base de plusieurs gigaoctets pour un service de secours. Le filtre se pose
donc à l'entrée, pas après : les régions et langues qui nous concernent, les types d'œuvre qu'on
range. Le chiffre d'après filtrage se mesure sur la machine où ça tourne, pas ici.

Et comme toute fonction qui coûte cela : **elle s'active**. Désactivée au départ, réglage en base,
arrêt net — la même règle que le repérage des génériques, pour la même raison.

**Son rôle est tranché** : « c'est un repli en cas d'échec de TMDB qui reste priorité. » Cela simplifie
beaucoup, et cela change la voie à prendre.

Un repli doit répondre **quand TMDB ne répond pas** — donc être là, hors ligne, sans dépendre d'un
second service qui pourrait tomber en même temps. Les **exports publics** d'IMDb conviennent
exactement : un import périodique, quelques centaines de mégaoctets, aucune requête au moment où l'on
en a besoin. Une API tierce, elle, serait un second point de panne déguisé en filet de sécurité.

À noter : la r88 réduit déjà la fréquence de ce repli. TMDB n'est plus écarté pour une limitation de
débit, et l'analyse automatique attend son retour — le cas où IMDb prendrait la main devient rare, ce
qui est le bon ordre des choses.

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

## 10. La télévision en direct — **reportée**

> **Décision du 30 août 2026 : le point 10 ne fait pas partie de la r88.**
>
> La raison n'est pas technique, elle est factuelle : la connexion se fait avec les identifiants de
> ligne mobile, c'est-à-dire par **l'application B.TV** et non par la Bbox. Or c'est la Bbox qui
> ouvrait la porte intéressante. Sans elle il reste l'application, et l'application demanderait
> d'imiter son authentification et ses appels privés — un code qui marche trois mois puis devient une
> dette. La présence de la télévision sur la ligne Bbox n'est pas confirmée ; elle se lit dans l'espace
> client, pas dans l'interface de la box, où le menu TV n'apparaît que si le service y est rattaché.
>
> Ce qui suit reste écrit pour le jour où la question des sources sera tranchée. Rien n'y est perdu :
> l'analyse tient, et le socle M3U reste la première brique quel que soit le fournisseur.

C'est le point le plus gros de la liste — un sous-système, pas une fonction. Et il commence par une
mauvaise nouvelle qu'il vaut mieux dire maintenant qu'après.

### La porte n'est pas l'application, c'est la box

Première version de ce document : « Bouygues, non — il faudrait déchiffrer. » **C'était faux**, et par
deux fois. D'abord parce qu'un abonné ne déchiffre rien : il obtient une licence légitime, et c'est le
fonctionnement normal du DRM. Ensuite et surtout parce que je regardais la mauvaise porte.

Chaque opérateur a deux visages, et ils n'ont rien à voir :

| | L'application (B.TV, SFR TV, Orange TV) | **La box, sur le réseau local** |
| --- | --- | --- |
| Transport | DASH sur Internet | multidiffusion sur le réseau de l'opérateur |
| Protection | Widevine | **aucune** |
| Interface | privée, non documentée, changeante | une API locale, sur la box |
| Numéros de chaîne | à reconstituer | **fournis** |

C'est la seconde qu'il faut prendre, et elle vaut pour tous les opérateurs à la fois : Bouygues, SFR,
Orange et Free ont chacun une box qui reçoit la télévision et l'expose sur le réseau. Un seul
mécanisme les couvre tous, au lieu de quatre intégrations distinctes.

### Ce que votre installation dit, relevé

| Constaté | Valeur |
| --- | --- |
| Passerelle du réseau | `10.20.30.1` — un routeur **ASUS RT-BE92U**, le vôtre |
| Derrière lui | `192.168.1.254` — **Bbox F@st5688b**, micrologiciel 25.1.22 |
| Son API locale | joignable depuis le réseau : `/api/v1/device` répond sans authentification |
| `/api/v1/iptv` | **existe** — répond `401`, donc il est là et demande l'identification de la Bbox |

Un `401` et non un `404` : le point d'accès de la télévision est présent sur votre Bbox. Je ne l'ai
**pas ouvert** — il demande le mot de passe d'administration de votre box, que je n'ai pas à manipuler.
C'est FlixTunes qui le portera, comme un réglage de fournisseur parmi d'autres, saisi par vous.

**Ce que je n'ai donc pas vérifié :** le contenu de la réponse. J'en attends la liste des chaînes avec
leurs numéros et leurs adresses de diffusion, parce que c'est ce que ce point d'accès sert ailleurs —
mais je ne l'ai pas vu, et je ne le présenterai pas comme acquis.

### Le vrai obstacle, maintenant qu'il est nommé

Il n'est plus le DRM : il est **le routage**. Les flux sont multidiffusés, et une multidiffusion ne
traverse pas un routeur toute seule. Votre NAS est en `10.20.30.x`, la Bbox en `192.168.1.x`, avec
votre ASUS entre les deux. Il faudra que ce dernier relaie les groupes de multidiffusion — c'est un
réglage de votre routeur (`IPTV` → relais IGMP), pas du code.

Et deux clients sur trois ne savent pas lire une multidiffusion : ni un navigateur, ni Media3 sur
Android. VLC le sait, donc le client de bureau s'en tirerait seul — mais un chemin unique vaut mieux
que trois. **Le NAS devient la passerelle** : il reçoit la multidiffusion et la réémet en HLS, en
recopiant les flux sans les réencoder. Sur le Celeron, une recopie ne coûte presque rien — c'est un
réencodage qui coûterait, et il n'y en a pas.

L'application B.TV, elle, reste hors sujet — non pour le DRM, mais parce qu'elle n'a pas d'interface
publique : il faudrait imiter ce que fait leur application, et cela casserait à leur prochaine
modification. La box donne la même chose, en plus stable et sans rien imiter.

### Le découpage que je propose

| Étape | Contenu |
| --- | --- |
| **0** | **Une mesure avant tout code** : ouvrir `/api/v1/iptv` avec le mot de passe de la Bbox et voir ce qu'il rend ; vérifier qu'un flux traverse l'ASUS jusqu'au NAS. Une heure, et elle décide de tout le reste |
| **a** | Le modèle : sources, chaînes, numéros ; la lecture d'un M3U ; les réglages en base |
| **b** | La passerelle du NAS : multidiffusion reçue, réémise en HLS **sans réencodage** |
| **c** | Le chargement au démarrage, après la médiathèque, avec son pourcentage — comme demandé |
| **d** | L'écran Live TV sur le Web, placé après Séries TV et **seulement si une source est réglée** |
| **e** | La recherche et le filtrage par liste de lecture, sur le modèle des genres |
| **f** | Android TV : la grille, et la saisie du numéro de chaîne à la télécommande |
| **g** | Le guide des programmes (XMLTV), si vous le voulez — c'est un chantier à part entière |

L'étape 0 n'est pas une formalité. Si la multidiffusion ne traverse pas votre routeur et qu'aucun
réglage ne l'y autorise, tout ce qui suit change de forme — et il vaut mieux le savoir avant d'avoir
écrit la passerelle que pendant.

### Ce qu'il faut décider avant l'étape a

- **Le guide des programmes** en fait-il partie ? Sans lui, une chaîne est un nom et une image ; avec
  lui, c'est un vrai téléviseur — et c'est au moins autant de travail que tout le reste. La Bbox
  expose peut-être le sien : à voir à l'étape 0.
- **L'enregistrement**, non demandé : je pars du principe que non.
- **Les numéros de chaîne** : la box les fournit, un M3U personnel peut les porter (`tvg-chno`), et on
  peut vouloir les corriger à la main. Trois sources pour un même numéro — il faut dire qui gagne.
- **Où vivent les fichiers M3U** sur le NAS, et à quelle fréquence les relire.
- **Le mot de passe de la Bbox** sera un réglage de FlixTunes, saisi par vous dans l'écran des
  fournisseurs. Rangé comme les autres secrets du serveur — je ne le manipule pas, et il ne passe
  nulle part ailleurs.

---

## Ordre proposé

**Livré en r88 :** les points 1, 2, 5, 7 et 8. Le 1 s'est réglé grâce à *Silo* S03E09 : l'exemple
désignait une ligne de requête, et le test le prouve — sur l'ancienne version, la saison était visitée
zéro fois.

**Ce qui attend une mesure chez vous :**

1. **3** — un film précis et le nombre de personnes affichées. La cause n'est pas le plafond, il faut
   donc trouver où les personnes se perdent entre TMDB et l'écran.
2. **4** — *A Star Is Born* 1976 est identifié ; les autres titres compléteront le tableau.

**Ce qui attend d'être écrit :**

3. **6** — le rôle est tranché (repli de TMDB), la voie est celle des exports publics. La r88 réduit
   déjà la fréquence de ce repli, ce qui laisse le temps de le faire proprement.

**Mis de côté à sa demande :** le 9. **Reporté :** le 10.
