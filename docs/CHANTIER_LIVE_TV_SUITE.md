# Chantier — la suite de la télévision en direct

*31 août 2026. La 0.5.7r1 est sortie ; ce document dit ce qu'on peut encore en tirer. Comme le
précédent, il ne construit rien : il mesure, il chiffre, et il attend un feu vert.*

**La contrainte, posée d'entrée : rien de ce qui suit ne doit dégrader ce qui marche.** Ouvrir la
grille coûte 0,4 ms, chercher « tf1 » 0,2 ms. Toute proposition est jugée d'abord là-dessus, et celles
qui ne peuvent pas tenir cette promesse sont écartées ou repoussées derrière un réglage.

---

## 1. Le chiffre qui change la valeur du repli

Le chantier précédent tenait la fusion des doublons pour une réserve abondante — 57 % des entrées
réunies. C'est vrai des **entrées**, et trompeur sur les **chaînes**. Relevé sur la base produite :

| Chaînes ayant… | Nombre | Part |
| --- | --- | --- |
| au moins 1 adresse | 76 823 | 100 % |
| **au moins 2 adresses** | **12 828** | **16,7 %** |
| au moins 3 | 4 843 | 6,3 % |
| au moins 5 | 2 135 | 2,8 % |
| au moins 10 | 724 | 0,9 % |

**Cinq chaînes sur six n'ont qu'une seule adresse.** Le repli ne les concerne pas : quand leur unique
source refuse, il n'y a rien à essayer. Les doublons se concentrent sur les chaînes les plus reprises
— précisément celles qui marchaient déjà.

Cela ne condamne pas le repli, cela **borne ce qu'on peut en attendre** : il sauve une chaîne sur six,
et ce sont les plus connues. Ce qui compte davantage, pour les cinq autres, c'est de **savoir avant
de cliquer** qu'une chaîne ne répondra pas — c'est le §2.

---

## 2. Le test préalable, et ce qu'il coûte vraiment

Trois formes, très différentes. La première est presque gratuite, la dernière ne se fait pas.

### 2.a La course — essayer les adresses **en même temps** (recommandé)

Aujourd'hui le lecteur essaie l'adresse 1, attend jusqu'à douze secondes, puis passe à la 2. Une
chaîne à trois adresses dont les deux premières sont mortes met donc jusqu'à vingt-quatre secondes à
démarrer.

La course inverse la logique : **on demande les N manifestes simultanément, et on joue le premier qui
répond**. Le coût pour le client est de N requêtes de quelques kilooctets ; pour le NAS, **zéro** —
elles partent du lecteur. Latence mesurée d'un manifeste : p50 **835 ms**, p95 **2,0 s**.

| | Aujourd'hui | Avec la course |
| --- | --- | --- |
| Chaîne dont la 1ʳᵉ adresse répond | ~1 s | ~1 s |
| Chaîne dont la 1ʳᵉ est morte, la 2ᵉ vivante | **jusqu'à 13 s** | **~1 s** |
| Chaîne dont les 3 premières sont mortes | jusqu'à 36 s | ~2 s (délai de la plus lente) |

Cela ne concerne que les 16,7 % de chaînes à plusieurs adresses, mais sur celles-là c'est la
différence entre « ça marche » et « j'ai changé de chaîne avant ». **Effort : faible.** C'est une
réécriture de la boucle d'essai, dans les deux lecteurs.

### 2.b Le sondage au focus — savoir avant de cliquer

Sur un téléviseur, le focus se pose sur une carte **avant** qu'on valide. Ce moment est gratuit : on
peut y demander le manifeste de la chaîne visée, et afficher une pastille dès que la réponse arrive.
Sur mobile, l'équivalent est la carte visible au centre de l'écran.

Deux gains : la pastille dit ce qui répond, et le manifeste est déjà en cache quand on valide — le
démarrage y gagne les 835 ms.

Le risque est le **maintien de la croix directionnelle** : traverser vingt cartes ne doit pas lancer
vingt requêtes. Un délai avant sondage — 400 ms de focus stable — et une seule requête en vol à la
fois suffisent, c'est exactement ce que fait déjà le préchargement des jaquettes sur téléviseur.
**Effort : moyen.** À faire après la course.

### 2.c Le sondage de fond — non, et voici pourquoi

Sonder tout le corpus veut dire **100 213 adresses uniques**. À vingt-quatre requêtes en parallèle et
840 ms l'unité, cela fait **environ une heure de machine et cent mille requêtes sortantes**, à
répéter — l'état d'un flux ne vaut pas une semaine. Sur le Celeron du NAS, et vu du côté des
hébergeurs, c'est disproportionné pour un corpus dont la personne regarde vingt chaînes.

**Ce qui est proportionné**, en revanche :

- **sonder une liste choisie**, à la demande, depuis l'écran de configuration — quelques centaines
  d'adresses, quelques dizaines de secondes, et on sait ce que vaut cette liste ;
- **retenir ce que la lecture apprend**, ce qui existe déjà depuis l'étape 3 ;
- **masquer les chaînes mortes**, une fois qu'on en sait assez pour le dire — un réglage, éteint par
  défaut, parce qu'une chaîne « morte » l'était peut-être seulement hier soir.

---

## 3. Le guide des programmes — le chiffre à connaître avant de décider

Le chantier précédent le repoussait ; le voici chiffré.

### Ce à quoi un guide peut s'accrocher

Un XMLTV se relie aux chaînes par `tvg-id`. Relevé sur la base :

| | Nombre |
| --- | --- |
| Chaînes visibles | 76 823 |
| **portant un `tvg-id`** | **30 200 — 39 %** |
| Chaînes françaises | 1 081 |
| **françaises portant un `tvg-id`** | **685 — 63 %** |

**Un guide couvrirait donc au mieux 685 chaînes françaises sur 1 081.** C'est beaucoup en valeur — ce
sont les chaînes qu'on regarde — et c'est loin d'être tout. Il faut le savoir avant, pas après.

### Ce que pèse un guide

Relevé le 31 août 2026 :

| Source | Poids | Couverture |
| --- | --- | --- |
| `i.mjh.nz/PlutoTV/fr.xml.gz` | **0,36 Mio** | les chaînes Pluto TV françaises |
| `i.mjh.nz/SamsungTVPlus/fr.xml.gz` | **0,20 Mio** | Samsung TV Plus France |
| Un guide **national** complet | **à mesurer** sur la source retenue | les chaînes de la TNT et du câble |

Les guides des chaînes gratuites sont donc **négligeables** — un demi-mégaoctet pour les deux. C'est
un point important : **on peut livrer le guide des chaînes FAST pour presque rien**, et décider
ensuite pour le national, qui est d'un autre ordre.

### Ce qu'il coûterait en base, et la règle qui protège la grille

Un guide national, c'est de l'ordre de cent mille émissions pour une semaine. Deux décisions suffisent
à ce que la grille n'en souffre pas :

1. **Une table à part**, `live_programmes(tvg_id, debut, fin, titre, resume)`, indexée sur
   `(tvg_id, debut)`. La grille des chaînes **ne la joint jamais** : elle reste la requête à 0,4 ms
   d'aujourd'hui.
2. **« Ce qui passe maintenant » est une seconde requête**, demandée pour les seules chaînes visibles
   — soixante `tvg_id`, une requête indexée. Elle arrive après la grille, jamais avant.

Et la purge : tout ce qui est fini depuis plus d'un jour part au rafraîchissement suivant. Sans elle,
la table grossit indéfiniment pour des émissions passées que personne ne relira.

### Ce que le guide apporterait, dans l'ordre

| | Apport | Effort |
| --- | --- | --- |
| 1 | **Ce qui passe maintenant**, sous le nom de la chaîne dans la grille | faible une fois la table là |
| 2 | **La fiche d'une chaîne** : maintenant, ensuite, et la soirée | faible |
| 3 | **Une vraie grille horaire**, chaînes en lignes et heures en colonnes | **moyen à élevé** — c'est un écran entier, et à la télécommande c'est une navigation à deux dimensions |
| 4 | **Chercher une émission** et non une chaîne | moyen |

**Ma recommandation : les points 1 et 2 avec les guides FAST**, qui coûtent un demi-mégaoctet et se
livrent vite. Le national et la grille horaire se décident ensuite, au vu de ce que ça donne.

---

## 4. Tout le reste, classé par ce qu'il rapporte

Rangé par rapport entre l'usage et le coût. Les six premiers sont ceux que je ferais.

| | Ce que c'est | Pourquoi | Effort |
| --- | --- | --- | --- |
| 1 ✅ | **La chaîne précédente**, sur une touche | Le geste le plus employé d'un téléviseur, après le numéro. Aller-retour entre deux chaînes sans repasser par la grille | **très faible** |
| 2 ✅ | **Les favorites** | Vingt chaînes sur 76 823 : c'est le vrai usage. Une étoile, un filtre, et la grille s'ouvre dessus | faible |
| 3 ✅ | **La course à l'ouverture** (§2.a) | 13 s → 1 s sur une chaîne sur six | faible |
| 4 ✅ | **Reprendre la dernière chaîne** au lancement | Un téléviseur rallume sur ce qu'on regardait | très faible |
| 5 ✖ | **Guide « maintenant / ensuite »** (§3, points 1-2) — **écarté à la demande** | Une chaîne cesse d'être un nom | faible |
| 6 ✅ | **Masquer les chaînes mortes**, réglage éteint par défaut | Le corpus se dégrade tout seul ; à un moment on veut ne plus les voir | faible |
| 7 | **Sondage au focus** (§2.b) | Savoir avant de cliquer | moyen |
| 8 | **Choix de la qualité** quand le flux en propose plusieurs | Beaucoup de manifestes sont des masters à trois paliers ; on subit celui que l'adaptation choisit | moyen |
| 9 | **Pistes audio et sous-titres du direct** | Certains flux en portent. Ni l'un ni l'autre n'est exposé aujourd'hui | moyen |
| 10 | **Contrôle parental par chaîne ou par pays** | Le corpus mondial contient de tout, et les profils enfants existent déjà | moyen |
| 11 | **Grille horaire complète** (§3, point 3) | Le vrai téléviseur | **élevé** |
| 12 | **Enregistrement / différé** | Non demandé, et c'est un sous-système : stockage, planification, conflits, purge | **très élevé** |
| 13 | **Multidiffusion de la box opérateur** | Analyse de la r88 : routage IGMP à traverser, passerelle HLS à écrire | élevé, et bloqué par le réseau |

Deux que je **déconseille** franchement :

- **Le portail Stalker/Ministra** : protocole non documenté qui change tous les trimestres. C'est la
  dette dont parlait la r88, et rien n'a changé.
- **Le sondage de fond du corpus entier** (§2.c) : une heure de machine et cent mille requêtes, pour
  vingt chaînes regardées.

---

## 5. Android TV — ce qui est corrigé, et ce qui reste à voir chez vous

**Un défaut trouvé en relisant, avant votre essai.** La saisie du numéro passait par `onKeyDown`, qui
n'est appelé qu'**après** que l'arbre de vues a décliné la touche — or il y a un `PlayerView` dans un
`AndroidView` et le système de focus de Compose par-dessus, l'un comme l'autre capables de consommer
un chiffre. Le lecteur de la médiathèque avait déjà tranché la question dans l'autre sens, avec la
raison écrite dans son code : `dispatchKeyEvent` intercepte **avant** l'arbre. C'est corrigé, et la
croix haut/bas répond désormais comme P+/P−, parce que beaucoup de boîtiers Android TV n'ont aucune
touche de chaîne.

**Ce que je ne peux pas affirmer**, et que seul votre essai dira :

- **que votre télécommande envoie des chiffres.** Beaucoup de boîtiers Android TV n'ont pas de pavé
  numérique du tout — dans ce cas la saisie n'a rien à intercepter, et c'est la croix haut/bas qui
  sert. Une télécommande d'ampli ou une application de télécommande sur téléphone en envoie ;
- **que rien d'autre ne consomme la touche** sur votre modèle précis. `dispatchKeyEvent` est le bon
  endroit, mais un lanceur ou une surcouche constructeur peut s'interposer avant l'application.

**Comment le vérifier en trente secondes** : ouvrir une chaîne, taper un chiffre, et regarder si la
surimpression apparaît en haut à droite. Si elle apparaît, tout le chemin est bon. Si rien ne vient,
un `adb shell getevent` pendant l'appui dira si la touche existe seulement.

---

## 6. Ce que je propose, et ce qu'il faut décider

**Livré en 0.5.7.r2** — les points 1, 2, 3, 4 et 6 du §4 : la chaîne précédente, les favorites, la
course à l'ouverture, la reprise de la dernière chaîne et le masquage des chaînes mortes. **Le guide
a été écarté à la demande**, et ce qui en a été mesuré reste écrit au §3 pour le jour où la question
reviendra.

Aucun de ces cinq points ne touche à la requête de la grille : la performance est conservée par
construction, et l'étoile est lue en une fois pour la page plutôt que ligne à ligne.

**Ajouté ensuite, hors des six points** — deux gênes rapportées à l'usage :

- **La grille garde ses filtres au retour d'une chaîne.** Une mémoire de session sans péremption,
  `apps/web/src/memoire-direct.ts` : recherche, cases cochées, pages parcourues, défilement. Deux
  pièges relevés à la console avant d'y arriver. Le mode strict de React annulait le premier
  chargement quand la marque « déjà servi » était posée au départ de la requête plutôt qu'à son
  arrivée — la grille restait à « 0 chaîne ». Et un écouteur de défilement retenait le recadrage du
  navigateur au démontage (282 au lieu de 1 500) : c'est au clic qu'on note, avant que la page ne
  rétrécisse. Android n'a pas ce défaut, ses filtres vivant dans `MainViewModel`.
- **L'ordre de la grille : la France, puis l'alphabet.** Un quatrième indice de pays reconnaît les
  chaînes françaises à leur seul nom (**1 081 → 1 337**, +256 sur le corpus réel), et le rang du pays
  est rangé en base pour que le tri suive un index. Mesure sur 79 966 chaînes : 0,07 ms la première
  page, 0,19 ms la centième — l'index **partiel** `WHERE adresses > 0` fait toute la différence,
  puisque sans lui SQLite retombait sur un tri complet à 8,8 ms.

**Un second lot, à décider** : le sondage au focus, le choix de la qualité, les pistes audio.

**À trancher avant de commencer :**

1. **Le guide national** : quelle source, et avec quelle licence ? Les guides FAST sont publiés par
   leurs éditeurs ; un guide national complet vient d'ailleurs, et cela se regarde avant de le
   télécharger chaque jour.
2. **La grille horaire** en fait-elle partie, ou s'arrête-t-on à « maintenant / ensuite » ?
3. **Le contrôle parental** : le corpus est mondial et les profils enfants existent. Faut-il un
   verrou par défaut sur le direct ?
4. **Les favorites** : par profil, ou pour le foyer ?
