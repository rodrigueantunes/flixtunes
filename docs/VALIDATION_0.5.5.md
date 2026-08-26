# Validation FlixTunes 0.5.5 — étape 55 (premier volet)

## Périmètre traité

Trois défauts signalés par l'utilisateur, tous reproduits avant correction, plus la gestion du focus
des fenêtres modales prévue au dossier de l'étape.

## Jaquettes disproportionnées sur la sélection principale

Le rail « Sélection pour … » affichait des jaquettes de tailles hétérogènes qui se chevauchaient et
passaient sous les titres voisins. La lecture de la feuille de style ne montrait rien d'anormal :
`.poster-image` est correctement contraint et `.poster` porte bien un rapport 2/3.

La cause n'est pas dans les règles mais dans le **contexte de mise en forme**. `.media-card` est un
`<button>`. Enfant direct de la grille du rail, il est blockifié et remplit sa colonne ; dans la
sélection, `.recommendation-card` s'intercale, et le bouton redevient `inline-block`, donc rétracté à
la largeur de son contenu — presque rien.

Mesuré sur reproduction, avant et après :

| | carte | jaquette | rapport |
| --- | --- | --- | --- |
| rail normal | 179×327 | 179×269 | 1,50 |
| sélection, avant | **33×107** | **33×50** | 1,50 |
| sélection, après | 179×327 | 179×269 | 1,50 |

La même cause produit deux symptômes opposés selon la version : sur une version antérieure au
positionnement absolu de l'image, une carte rétractée laisse l'image s'afficher à sa taille native et
déborder sur ses voisines. C'est ce que montrait la capture d'écran.

Corrigé aussi : la largeur de la ligne de justification, figée à 160 px, désalignait le rail sur les
colonnes plus étroites ou plus larges.

## Négociation de lecture faussée — une cause, quatre symptômes

L'utilisateur signalait trois symptômes distincts : MKV non lu, bascule en 720p malgré un bon réseau,
HDR ignoré sur écran compatible. Ses captures ont montré que la lecture directe du même fichier
fonctionne parfaitement — MKV, HEVC, Dolby Vision P8, EAC3, 3840×2076. Les refus de la négociation
étaient donc faux.

Une seule cause, dans la détection de capacités du client :

- `codecs="hvc1"` sans profil ni niveau, chaîne que la plupart des navigateurs rejettent même lorsque
  le décodage matériel existe ;
- le conteneur Matroska jamais sondé, refusé d'office ;
- surtout, `maxWidth` et `maxHeight` dérivés de `screen.width × devicePixelRatio`, qui décrivent
  l'écran et non la capacité de décodage. D'où « Définition supérieure à 2560×1600 » sur une source 4K
  qu'un navigateur décode et réduit sans peine.

Le serveur en concluait qu'il devait transcoder du 4K HEVC ; l'admission jugeait ce transcodage trop
lourd et bridait à 1080p. Le message « serveur chargé » était une **conséquence** de la détection
fautive, non un manque réel de capacité.

La sonde interroge désormais `mediaCapabilities.decodingInfo`, qui répond « décodable », « fluide » et
« économe » pour un codec et une définition donnés, avec des chaînes de codec complètes, et sonde
explicitement le Matroska. Chaque codec est éprouvé en 1080p **et** en 2160p : la fluidité peut
différer entre les deux, et c'est cette différence qui fixe la définition annoncée.

Deux règles délibérément séparées : un codec décodable mais poussif est déclaré — le refuser
condamnerait au transcodage un fichier lisible — mais il ne relève pas la définition annoncée, pour ne
pas provoquer de saccades.

### Une seconde source de bridage, distincte

`hls.js` était configuré avec `capLevelToPlayerSize: true`, qui plafonne la qualité aux dimensions
rendues de l'élément vidéo. Dans une fenêtre qui n'occupe pas tout un écran 1080p — le cas ordinaire —
l'élément mesure moins de 1920 pixels et le plafond tombait mécaniquement à 720p, quel que soit le
débit. Sur un lien local vers un NAS, la bande passante n'est pas la ressource rare : le plafond est
retiré et le choix manuel reste offert.

## Choix manuel de la plage dynamique

Nouveau contrôle « Image » à côté de la qualité : Auto, HDR conservé, Converti en SDR. Trois décisions :

- il n'apparaît que sur une source qui possède une plage dynamique — l'offrir sur un fichier SDR
  laisserait croire qu'on peut en fabriquer ;
- « HDR conservé » passe outre la détection du navigateur, car un écran peut être compatible sans que
  le navigateur le déclare ;
- le changement relance la session en conservant la position. Contrairement à la qualité, que hls.js
  bascule sans interruption, la plage dynamique se décide à la négociation : la prétendre instantanée
  aurait demandé de préparer les deux rendus en parallèle, pour un bénéfice douteux.

Le sélecteur de résolution existait déjà et n'apparaît qu'en mode HLS, faute de rendus alternatifs en
lecture directe. Ses propositions étaient tronquées par le faux plafond de définition ; elles sont
désormais justes.

## Focus des fenêtres modales

Les trois fenêtres — profils, code PIN, fiche détaillée — portaient `role="dialog"` et
`aria-modal="true"` sans aucune gestion du focus : il ne se déplaçait pas à l'ouverture, la tabulation
partait dans la page de fond, et la fermeture ne le rendait pas à son déclencheur. `aria-modal` retire
le fond de l'arbre d'accessibilité mais ne le rend pas inatteignable au clavier.

Un défaut de la première version du crochet mérite d'être noté : le filtrage des éléments focalisables
utilisait `offsetParent !== null`, astuce répandue pour tester la visibilité — or `offsetParent` vaut
`null` pour tout élément en `position: fixed`, ce qu'une fenêtre modale est presque toujours. Le
filtre écartait donc les commandes de la fenêtre elle-même. Le filtrage porte désormais sur les
attributs `hidden` et `aria-hidden`, sans dépendre d'aucune mise en page.

## Un défaut majeur trouvé en faisant tourner l'application

Les pages Films et Séries étaient **entièrement noires**, dans les paquets 0.5.4.r1, 0.5.4.r2 et
0.5.5.r1. La méthode de pagination ajoutée à l'étape 54 s'appelait `catalog` — nom déjà pris par le
centre de correspondances. Deux clés homonymes dans un objet littéral ne lèvent aucune erreur : la
seconde écrase la première. Le catalogue partait donc vers `/api/catalog?libraryId=…&query=[object
Object]`, recevait un tableau au lieu d'une page, `items` devenait `undefined`, et React démontait tout
l'arbre au rendu suivant.

Trois enseignements, tous coûteux :

1. **Simuler tout un module masque les défauts de ce module.** Les onze tests d'interface passaient
   alors que la page était inutilisable : ils remplacent `./api` par un double où la collision
   n'existe pas. Un fichier de tests s'exécute désormais contre le module réel, `fetch` intercepté.
   Vérifié par mutation : en réintroduisant la collision, trois des cinq tests tombent.
2. **Faire tourner l'application n'est pas optionnel.** Le composant a été relu trois fois en cherchant
   au mauvais endroit. Ce sont la barrière d'erreur puis le journal réseau qui ont donné la réponse.
3. **Une exception de rendu ne doit pas produire un écran noir muet.** La barrière d'erreur affiche
   désormais une explication, un bouton de rechargement et le détail technique dépliable.

## Cas limites du dossier, mesurés en navigateur

Observations sur l'application réelle, avec un jeu de données conçu pour être pénible — titres
interminables, titre d'une seule lettre, écritures non latines, aucune affiche, résumés très longs.
Il est reproductible : `pnpm --filter @flixtunes/server seed:showcase`.

| Cas | Avant | Après |
| --- | --- | --- |
| **320 px** | 58 titres sur 60 coupés à ~15 caractères sur 60 | deux lignes, hauteur uniforme, infobulle complète |
| **TV 4K** | 22 colonnes de **148 px** | 11 colonnes de **316 px**, jaquettes 316×474 |
| **Zoom 200 %** | 2 cibles à 18 et 20 px de haut | **0 cible sur 73** sous le minimum de 24 px |

- **Titres.** L'ellipse et le nom accessible de la carte étaient corrects — un lecteur d'écran recevait
  le titre entier. Le défaut ne concernait que l'œil : sur une colonne de 134 px, `white-space: nowrap`
  ne laissait voir qu'une quinzaine de caractères. La hauteur de deux lignes est réservée pour que les
  métadonnées restent alignées, qu'un titre tienne sur une ligne ou sur deux.
- **4K.** La largeur minimale de colonne était figée à 145 px. Sur l'écran qui a le plus de place pour
  de grandes jaquettes, elle en produisait 22 minuscules. Elle suit désormais la largeur de la fenêtre,
  tout en conservant deux colonnes à 320 px.
- **Cibles tactiles.** Les deux commandes fautives — champ de recherche et filtre d'état — sont
  précisément celles qu'on cherche quand on agrandit l'affichage. Critère WCAG 2.2 « Target Size
  (Minimum) », 2.5.8.

**Limite assumée :** ces mesures ne sont pas automatisées. jsdom n'a pas de moteur de mise en page, et
les tests visuels multi-viewports que réclame le dossier restent à construire. Ces trois cas ne sont
donc pas protégés contre une régression.

## Preuves

- **Suite Web** : gestion du focus vérifiée sur les trois comportements — entrée, enfermement, retour —
  y compris le focus égaré ramené dans la fenêtre.
- **Synthèse des capacités de décodage : 7 tests** sur la fonction pure — HEVC, Matroska et 4K
  annoncés quand ils sont décodables, définition non déduite de l'écran, codec poussif déclaré sans
  relever la définition, socle universel préservé quand rien n'est reconnu, chaque codec sondé en
  1080p et 2160p, chaînes de codec complètes.
- **Mise en page** : mesures avant/après en navigateur réel, absence de chevauchement et titres sous
  les jaquettes vérifiés par calcul de rectangles.
- **Suite serveur de lecture** : 41 tests, inchangés par la surcharge de plage dynamique.

## Longues grilles : mesurer avant de construire

Le dossier prévoit la virtualisation des listes. Avant de l'écrire, le coût réel a été mesuré sur
2 005 films synthétiques, catalogue entièrement déroulé — 33 pages chargées.

| Cartes affichées | Nœuds du document | Recalcul de mise en page |
| --- | --- | --- |
| 60 (une page) | 556 | **0,8 ms** |
| 2 011 (tout le catalogue) | 16 161 | **38,9 ms** |
| 2 011, avec `content-visibility` | 16 161 | **6,5 ms** |

Le coût suit le nombre de cartes : une image à 60 Hz dure 16,7 ms, franchie vers 900 cartes. Ce
recalcul est payé à chaque changement affectant la mise en page — redimensionnement de la fenêtre,
ouverture d'une fenêtre modale, bascule d'affichage.

**La virtualisation n'a pas été écrite.** `content-visibility: auto` sur les cartes, accompagné d'une
hauteur estimée, laisse le navigateur ignorer la mise en page et le dessin de ce qui est hors écran :
six fois moins cher, et sous une image, pour trois lignes de style. La hauteur estimée tombe juste —
les cartes mesurent exactement 320 px à la largeur testée — et le mot-clé `auto` fait mémoriser au
navigateur la hauteur réelle une fois la carte rendue.

Deux avantages sur une virtualisation classique, qui ont pesé dans la décision : **le contenu reste
dans le document** — vérifié, le titre en 1 800ᵉ position est toujours présent, donc trouvable par la
recherche du navigateur et par un lecteur d'écran — et l'ordre de tabulation n'est pas reconstruit.

**Limite de la mesure :** les intervalles entre images n'ont pas pu être relevés, le volet navigateur
n'étant pas affiché — la page ne compose alors aucune image et `requestAnimationFrame` ne se déclenche
pas. Le coût de recalcul de mise en page a été retenu à la place : indépendant de l'affichage, et payé
à chaque changement de géométrie.

## Reste à exécuter pour clore l'étape 55

Ce volet traite les défauts signalés, pas l'ensemble du dossier. Restent :

- **virtualisation des rails et des fiches** — les listes chargées restent intégralement en mémoire ;
- **budgets JS/CSS/image bloquants** et mesures LCP/INP/CLS ;
- **tests E2E visuels multi-viewports**, axe WCAG 2.2 AA, parcours au lecteur d'écran ;
- **cas limites du dossier** : écran 320 px, TV 4K, zoom 200 %, texte long, session expirée ;
- **système de composants documenté** ;
- **vérification sur appareil réel** que la nouvelle sonde de décodage annonce bien HEVC et Matroska
  sur le navigateur de l'utilisateur — la logique de synthèse est éprouvée, la sonde elle-même dépend
  du navigateur et n'a pas pu être observée en conditions réelles.

### Décision

La barrière de sortie de l'étape 55 **n'est pas franchie**. Les trois défauts signalés sont corrigés
et mesurés, la gestion du focus est livrée, mais la virtualisation, les budgets et la campagne de
preuves d'accessibilité restent à conduire.
