# Validation FlixTunes 0.5.4 — étape 54 (bibliothèques massives, premier volet)

## Point de départ : une mesure, pas une intuition

La médiathèque visée compte **environ 2 000 films et 200 séries TV**. Plutôt que de supposer, un banc de
montée en charge (`apps/server/integration/catalog-scale.integration.ts`) peuple une base synthétique à
cette échelle exacte et mesure ce que coûtent réellement l'accueil et la recherche.

Le premier tirage a d'abord servi à corriger le banc lui-même : il créait des séries sans saisons, si
bien que l'accueil n'en renvoyait aucune. La vue catalogue exige la hiérarchie série → saison → épisode
que produit le scanner réel. Un banc qui ne reproduit pas la forme des données ne mesure rien.

Une fois le jeu de données représentatif, le verdict était sans appel :

| Mesure | p50 | p95 | Charge utile |
| --- | --- | --- | --- |
| accueil complet | 2519 ms | 2696 ms | 1004 Kio |
| recherche « synthétique 42 » | 2489 ms | 2501 ms | 23 Kio |
| recherche courte « Film » | 2465 ms | 2492 ms | 35 Kio |

La cible du plan est **150 ms p95**. L'accueil était dix-huit fois au-dessus. Signe révélateur : une
recherche qui ne rend que 23 Kio coûtait aussi cher qu'un accueil complet — le volume transmis n'était
donc pas la cause principale.

## Les trois défauts trouvés

**Un N+1 dans la construction des séries.** Pour chaque série, la vue exécutait une requête « épisode
représentatif » — jointure sur `media_items` et deux `catalog_items`, plus la progression — puis une
seconde requête pour la liste d'envies. Soit **400 allers-retours pour 200 séries**, à chaque appel.

**Une recherche qui construisait tout le catalogue.** `searchCatalog` appelait cette même fonction en
entier, puis filtrait les titres en JavaScript. Chaque frappe payait le prix d'un accueil complet.

**Un index inutilisable.** `idx_catalog_library_kind` porte sur `(library_id, kind)`. Un parcours qui ne
connaît pas la bibliothèque — c'est le cas de l'accueil — ne peut pas s'en servir, faute de colonne de
tête. `WHERE kind = 'show'` balayait donc les 10 200 fiches.

## Ce qui a été fait

**Une seule requête pour les séries.** Une fonction de fenêtrage `ROW_NUMBER()` classe les épisodes
disponibles à l'intérieur de chaque série et la jointure ne retient que le premier. Elle remplace du même
coup la condition d'existence : une série sans épisode disponible n'a aucune ligne classée et disparaît
d'elle-même. La liste d'envies devient une jointure.

**Des rails bornés par SQL.** L'accueil chargeait la totalité des médias — épisodes compris — pour n'en
garder que quelques dizaines après filtrage en mémoire. Chaque rail a désormais son `LIMIT`.

**Trois index ajoutés :** `catalog_items(kind, sort_title)`, `catalog_items(parent_id, kind)` et
`media_items(available, kind, created_at DESC)`.

**Pagination du catalogue.** Nouvelle route `GET /api/catalog` : tri, filtre d'état, recherche, décalage
et taille de page. L'accueil ne transmet plus que les soixante premières fiches de chaque type,
accompagnées des totaux réels.

**Tri et filtres déplacés côté serveur.** C'est la partie délicate : les clients triaient et filtraient
en mémoire sur la totalité des fiches reçues. Appliquer ces opérations à une page déjà découpée donne un
classement faux **mais plausible** — juste sur deux films, faux sur deux mille, et sans la moindre
erreur pour le signaler. Ils s'appliquent donc en SQL, avant le découpage.

**Web et Android paginés.** Les deux clients demandent la première page à l'ouverture d'une section puis
la suite au défilement, avec un bouton explicite en repli. Le Web affiche une grille squelette pendant le
premier chargement : amorcer la grille avec la page de l'accueil, classée par date d'ajout, aurait fait
sauter les affiches sous les yeux au moment où le tri alphabétique arrive.

## Résultats après correction, à l'échelle de la médiathèque visée

| Mesure | avant p95 | après p95 | facteur | Charge utile |
| --- | --- | --- | --- | --- |
| accueil complet | 2696 ms | **35,9 ms** | ×75 | 1004 → **78 Kio** |
| recherche « synthétique 42 » | 2501 ms | **21,4 ms** | ×117 | 23 Kio |
| recherche courte « Film » | 2492 ms | **4,9 ms** | ×509 | 35 Kio |
| page de films (tri titre) | — | 1,1 ms | — | 27 Kio |
| page de films (tri sortie + filtre en cours) | — | 0,1 ms | — | — |
| page de films n° 20 (décalage 1140) | — | 2,4 ms | — | 26 Kio |
| page de séries (tri titre) | — | 16,4 ms | — | 30 Kio |

Mesures en régime établi : un tir de chauffe est exclu, puis vingt itérations. Sans cette précaution, le
premier appel — compilation des requêtes, pages du fichier encore froides — devenait à lui seul le p95.

## À l'échelle visée par le plan — 10 000 films, 2 000 séries, 100 000 épisodes

| Mesure | avant correctif de plan | après | Charge utile |
| --- | --- | --- | --- |
| accueil complet | 589 ms | **546 ms** | 78 Kio |
| recherche « synthétique 42 » | 5011 ms | **390 ms** | 35 Kio |
| recherche courte « Film » | 37 ms | **36 ms** | 35 Kio |
| page de films (tri titre) | 11 ms | **5,5 ms** | 27 Kio |
| page de films n° 20 (décalage 1140) | 9,5 ms | **8,1 ms** | 27 Kio |
| page de séries (tri titre) | 474 ms | **387 ms** | 30 Kio |

**La cible de 150 ms p95 n'est pas tenue à cette échelle.** Elle l'est très largement à celle de la
médiathèque visée — 36 ms pour 2 000 films et 200 séries, soit quatre fois moins que le budget — mais
l'accueil reste à 546 ms sur dix fois ce volume.

Ce qui domine est identifié : la condition « cette série a-t-elle un épisode disponible ? » est évaluée
pour les 2 000 séries, une fois pour le décompte et une fois pour la page. Chaque évaluation descend par
index série → saison → épisode, ce qui est bon marché isolément mais se paie 2 000 fois. La page de
séries seule en représente 387 des 546 ms.

Trois pistes, par ordre de rapport :
1. Remplacer la condition d'existence corrélée par une jointure agrégée unique, qui parcourt les
   épisodes une seule fois au lieu de descendre 2 000 fois.
2. Matérialiser la disponibilité au niveau de la série, entretenue par le scanner.
3. Mettre en cache le décompte de séries, qui ne change qu'à l'analyse.

Aucune n'a été retenue pour l'instant : elles n'apporteraient rien à la médiathèque réellement visée, et
la deuxième dépend du volet scanner qui reste à construire.

## Choix d'implémentation à connaître

**Pagination par décalage, pas par curseur.** À l'échelle d'une médiathèque, quelques milliers de fiches
avec index couvrant, un `OFFSET` est négligeable — la vingtième page coûte 2,4 ms. Il préserve les trois
tris et le saut direct dans la liste, là où un curseur imposerait un encodage distinct par critère de
tri, avec le traitement des années absentes. Le prix est connu et assumé : une analyse qui insère des
fiches pendant le défilement peut décaler d'un rang la page suivante. Les deux clients écartent les
doublons à la concaténation plutôt que d'afficher deux fois la même affiche.

**L'accueil charge encore les listes complètes côté serveur.** « Ma liste » et les recommandations
doivent voir tout le catalogue ; les dériver de la seule page transmise les aurait vidées en silence de
tout titre situé plus loin. Ce chargement complet ne coûte plus que quelques dizaines de millisecondes
et ne part jamais sur le réseau. Un test le vérifie explicitement.

**Les séries se construisent en deux requêtes, pas une.** La première version regroupait tout dans une
requête à fonction de fenêtrage. Élégant, et faux à grande échelle : la fenêtre classait la totalité des
épisodes de la médiathèque même pour n'en afficher que soixante. Mesuré sur 100 000 épisodes : 465 ms
pour une page de séries et **4975 ms pour une recherche**. La page de séries se choisit désormais par
tests d'existence indexés, et le classement ne porte que sur les épisodes des séries retenues. Le coût
suit ce qui est affiché, non ce que contient la médiathèque.

**Recherche insensible aux accents.** `LIKE` n'ignore la casse que sur l'ASCII : « SÉRIE » ne trouvait
pas « Série ». Le motif est opposé en minuscules au titre de tri, qui l'est déjà. Vérifié : sans cette
branche, `'Série Accentuée' LIKE '%SÉRIE%'` renvoie 0.

## Deux défauts introduits par cette étape, et corrigés

**Une route déclarée deux fois.** La pagination avait pris le chemin `/api/catalog`, déjà servi par le
centre de correspondances. Fastify refuse le doublon, et ce refus faisait échouer le démarrage de toute
l'application : les autres échecs de la suite n'en étaient que la conséquence. Le parcours du catalogue
vit désormais sur `/api/catalog/browse`. La leçon retenue : la route n'avait aucune couverture propre et
n'a été prise que par un test qui démarre l'application, avec un message qui ne la désignait pas. Elle a
maintenant son test, qui exerce la pagination et refuse sept jeux de paramètres invalides.

**Un plan d'exécution ruineux.** La condition d'existence, écrite en jointures, poussait SQLite à
l'attaquer par `media_items` sur le seul critère « disponible », donc à balayer toute la table pour
chaque série — et intégralement lorsque la série n'a aucun épisode, cas où il faut aller au bout pour
conclure. Mesuré à une trentaine de secondes par recherche sur 110 000 médias. Les `EXISTS` imbriqués
imposent la descente série → saison → épisode : 7,3 ms au lieu de 30 s, et 0,17 ms pour une recherche
sans résultat.

Ce défaut n'a été visible que parce qu'un banc interrompu avait laissé 110 137 lignes orphelines dans la
base de développement : la clé étrangère étant en `ON DELETE SET NULL`, la disparition de la
bibliothèque avait vidé `library_id` au lieu d'emporter les médias, que le nettoyage cherchait par cet
identifiant. Invisibles pour l'application, ces lignes ont joué le rôle d'un test de charge involontaire.
Le banc purge désormais aussi les orphelins, et sème une série sans épisode pour couvrir ce pire cas.

## Preuves

- **Pagination serveur : 11 tests** — parcours complet sans perte ni doublon, total indépendant de la
  taille de page, bornage d'une taille abusive, page au-delà de la fin, les trois tris vérifiés sur
  l'ensemble des pages, années absentes reléguées en fin de tri, partition exacte entre les filtres
  d'état, joker SQL traité comme un caractère ordinaire, série sans épisode disponible écartée, accueil
  borné annonçant le catalogue entier, et « Ma liste » conservant un titre absent de la première page.
- **Web** : le double de serveur applique tri, filtre, recherche puis découpage dans cet ordre — un
  double qui rendrait toujours la même liste ne prouverait rien des critères transmis. Les tests
  vérifient à la fois le critère envoyé et l'ordre rendu, plus le chargement de la suite et l'absence de
  double requête sur une saisie continue.
- **Android** : analyse des totaux, repli lorsqu'un serveur antérieur n'en annonce aucun — sinon
  l'application afficherait « 0 titre » sur une médiathèque pleine — et calcul du reste à charger.

## Reste à exécuter pour clore l'étape 54

Cette livraison est le **premier volet** de l'étape. Le dossier prévoit davantage :

- **Journal de scan incrémental, stabilisation des fichiers en cours de copie, scan récupérable** :
  non abordés. C'est la moitié la plus lourde de l'étape.
- **Transactions par lots dans le scanner** : non fait.
- **FTS5** : non fait. La recherche `LIKE` tient largement les cibles à l'échelle mesurée ; l'index
  plein texte se justifiera sur la recherche par mots dans les résumés, pas sur les titres.
- **Virtualisation réelle des listes** : les clients paginent mais conservent en mémoire tout ce qui a
  été chargé. Suffisant pour quelques centaines de cartes, à revoir au-delà.
- **Fraîcheur d'une grille déjà chargée** : marquer un titre comme vu depuis sa fiche rafraîchit
  l'accueil mais pas la grille de catalogue affichée derrière, qui garde l'ancien état de progression
  jusqu'au prochain changement de tri, de filtre ou de recherche. Rafraîchir la grille entière
  ramènerait la personne en haut de liste après un long défilement ; le correctif propre est une mise à
  jour de la seule fiche concernée, à faire avec le second volet.
- **Déduplication d'images et miniatures AVIF/WebP négociées** : non fait.
- **Tests sur NAS de faible puissance** : les mesures ont été prises sur poste de développement.
- **APK Android** : limite d'environnement inchangée, la construction revient à l'utilisateur.

### Décision

La barrière de sortie de l'étape 54 **n'est pas franchie**, pour deux raisons distinctes.

Les objectifs de latence sont largement dépassés à l'échelle de la médiathèque visée — 36 ms p95 contre
150 de budget — et la charge utile de l'accueil est divisée par treize. Mais ils ne le sont pas à
l'échelle que le plan fixe lui-même, 10 000 films et 2 000 séries, où l'accueil reste à 546 ms.

Et tout le volet scanner — journal incrémental, stabilisation des fichiers en cours de copie, reprise
après coupure — reste à construire. C'est lui qui porte la promesse « catalogue jamais vide pendant un
scan », et il représente la moitié la plus lourde de l'étape.

## Second volet — écriture du catalogue

### Le catalogue pouvait être effacé sans qu'aucune erreur ne soit levée

Une analyse conclut en marquant indisponibles les fichiers qu'elle n'a pas revus. Ce raisonnement
suppose que l'absence vaut suppression. Sur un NAS, l'absence signifie tout aussi souvent : partage
démonté, disque en veille, permissions perdues, point de montage qui répond « répertoire vide » plutôt
qu'une erreur. Dans ces cas la marche réussit, elle ne trouve simplement rien, et **toute la
bibliothèque est marquée indisponible en silence**.

Deux garde-fous, tous deux contournables par une confirmation explicite :

- **racine muette** — aucun fichier rencontré alors que la bibliothèque en comptait ;
- **disparition massive** — plus de la moitié des médias disparus en une seule analyse.

L'exemption des petites bibliothèques passe **avant** ces deux règles. Ce n'était pas le cas dans la
première version, et un test existant l'a immédiatement mis en défaut : supprimer l'unique film d'un
dossier devenait impossible à enregistrer sans confirmation. Le raisonnement correct est que marquer
indisponible n'efface rien — une analyse ultérieure rétablit la disponibilité dès que les fichiers
réapparaissent — donc le préjudice d'une erreur suit le volume, et c'est le volume qui décide de la
prudence à appliquer. En deçà de dix fiches, on fait confiance à l'analyse.

### Fichiers en cours de copie

Analyser un fichier à moitié copié produit une fiche fausse — durée tronquée, pistes manquantes — qui
persiste jusqu'à ce qu'une analyse ultérieure remarque le changement de taille. Deux relevés séparés
tranchent, mais seulement pour les fichiers écrits récemment : un second relevé systématique doublerait
le coût d'une analyse sur des dizaines de milliers de fichiers au repos. Une date d'écriture située
dans le futur — horloge de NAS déréglée — déclenche l'observation par prudence.

### Journal des fichiers restés à la porte

Un fichier qui n'entre jamais dans le catalogue était muet : rien ne disait s'il avait été écarté ou
s'il avait échoué, ni pourquoi. La table `scan_skips` en garde un état courant — motif, détail, nombre
de tentatives — exposé sur `GET /api/scans/skipped`. Le compteur distingue l'incident isolé du problème
installé. Une ligne disparaît dès que le fichier entre, ou dès qu'il quitte le disque. Une annulation
d'analyse n'inscrit rien : elle n'est pas un défaut du fichier.

### Une extraction ffmpeg relancée indéfiniment

Découvert en mesurant, non en lisant : `backfillArtwork` s'exécutait intégralement pour chaque fichier
inchangé, à chaque analyse. Lorsque la fiche n'avait pas encore d'affiche, il lançait une extraction
ffmpeg — et pour les fiches dont l'affiche ne peut pas être produite, cette extraction échouait et
recommençait à chaque passage, indéfiniment. Une sortie anticipée lorsque les deux images existent
suffit. C'est de loin le gain le plus net de ce volet.

### Deux mesures fausses, et ce qu'elles ont appris

Le regroupement des écritures en transactions a été implémenté, mesuré, puis **retiré**.

La première mesure chronométrait ffmpeg et non les transactions : sur des fichiers factices, aucune
affiche ne peut être générée, et l'extraction était retentée à chaque passage. La seconde, sur un banc
corrigé, montrait un écart net et régulier suivant le paramètre de lot — sauf que le regroupement
venait d'être retiré et que **le paramètre était inerte**. L'écart suivait l'ordre des passages, pas la
configuration.

Le banc mesure désormais une seule configuration répétée et publie sa dispersion : sur 400 fichiers,
six passages s'étalent de 977 à 2171 ms, soit **±102 % autour d'une médiane de 1172 ms**. Aucune des
différences observées entre configurations n'atteignait ce seuil. Le regroupement a donc été retiré
plutôt que conservé sur la foi d'un raisonnement — « une transaction par fichier, c'est cher » — que
la mesure ne soutient pas à cette échelle.

Coût de référence d'une analyse répétée : **2,93 ms par fichier**, soit une trentaine de secondes pour
la médiathèque visée.

### Reprise après coupure — ce que le dossier demande et ce qui est réellement nécessaire

Le dossier prévoit un scan récupérable à points de reprise. La lecture du scanner nuance le besoin :
une analyse interrompue ne perd rien. Les médias déjà importés restent, le chemin « fichier inchangé »
évite de tout ré-analyser au passage suivant, et la phase de disparition ne s'exécute pas — une
interruption ne peut donc pas vider le catalogue. Ce qui manque est de ne pas reparcourir
l'arborescence depuis le début. À la volumétrie visée, ce parcours est négligeable devant le reste.
Le mécanisme de points de reprise n'a pas été construit, faute de bénéfice démontrable ici.

### Preuves du second volet

- **Garde-fous : 15 tests** sur les fonctions pures — racine muette, disparition massive, seuils
  exacts, exemption des petites bibliothèques, confirmation explicite, stabilité d'un fichier, choix
  des fichiers à observer, date d'écriture dans le futur.
- **Résilience : 9 tests** sur de vrais dossiers — le catalogue survit à une racine vide et à une
  disparition massive, la confirmation applique tout de même, une copie en cours ne crée aucune fiche
  et ne dégrade pas la fiche existante, le journal compte les tentatives puis oublie le fichier entré
  ou disparu.
- **Valeur des tests vérifiée par mutation** : le garde-fou neutralisé, les deux tests concernés
  tombent. Un test qui passerait aussi sans le correctif ne prouverait rien.

## Livrables

- **Paquet ASUSTOR** : `flixtunes_0.5.4.r1_x86-64.apk`, 153,6 Mio, APKG 2.0, 4115 entrées, x86-64
  (AS5404T). SHA-256 `073B5D0EC6E46AE19BA5BB4684AE31B27657F59F46E6797213234A8A9066F317`. Contenu
  vérifié après coup : le code serveur empaqueté contient bien la route `catalog/browse`, les totaux
  `movieTotal` et la condition d'existence corrigée.
- **APK Android** : à construire depuis un shell de la machine. La construction depuis les sessions
  d'assistance échoue sur `java.io.IOException: Unable to establish loopback connection`, y compris
  hors bac à sable et avec `--no-daemon` : Gradle 9.5 forke une JVM à usage unique pour honorer
  `org.gradle.jvmargs`, et cette JVM n'obtient pas de boucle locale.

## Notes d'environnement utiles à la suite

- **pnpm 10 lit ses options dans `pnpm-workspace.yaml`, pas dans `.npmrc`.** Chaque `pnpm run` y
  déclenchait une installation implicite qui, sur le partage réseau, échoue en `ERR_PNPM_ENOTEMPTY` et
  laisse des arborescences à demi écrites — elle a détruit le manifeste de
  `@rollup/rollup-win32-x64-msvc` et rendu toute la suite de tests inexécutable. `verifyDepsBeforeRun`
  est désormais désactivé au bon endroit.
- **Le paquet se construit en `-SkipBuild`**, après compilation directe par `tsc` et `vite` : trois des
  quatre appels à pnpm disparaissent.
- **Les délais de test sont désormais dans `apps/server/vitest.config.ts`.** Les valeurs par défaut de
  Vitest produisaient des échecs sans rapport avec le code testé, ce qui coûte plus cher qu'une suite
  lente : un échec dont on doute n'est plus un signal.
