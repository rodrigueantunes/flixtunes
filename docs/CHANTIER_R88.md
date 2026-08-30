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
| 10 | Live TV et fournisseurs | **reporté** — voir §10 | — | la question des sources |

Les points 2, 3, 7 et 8 sont petits et sûrs : ils peuvent partir tout de suite. **Le 10 est reporté**
— la décision est prise et sa raison est en tête de sa section. La r88 porte donc les neuf autres.

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

**Ce qui peut partir sans rien attendre :**

1. **7 et 8** ensemble — mêmes écrans, correction visible tout de suite.
2. **2** — un bouton, une route, rien de risqué.
3. **5** — la cause est connue, et c'est celle qui gêne le plus au quotidien.

**Ce qui attend une décision de votre part :**

4. **3** — dès que le plafond voulu est fixé.
5. **6** — quand on aura dit ce qu'on attend d'IMDb.

**Ce qui attend une mesure chez vous :**

6. **1** — le symptôme exact.
7. **9** — un titre où le dédoublement se voit.
8. **4** — la liste des vingt films, ou l'accès pour la produire.

**Reporté :** le 10.

Rien ne commence sans un feu vert. Les trois premiers n'ont besoin d'aucune réponse : un mot suffit à
les lancer, et les autres suivront à mesure que les décisions et les mesures arriveront.
