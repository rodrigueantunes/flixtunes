# Système de composants — client Web

Ce document décrit ce qui existe, pas ce qu'on aimerait avoir. Il sert à répondre à une question
précise quand on ajoute un écran : *quel composant réutiliser, et avec quelles contraintes ?*

## Jetons

Les jetons vivent dans `:root`, en tête de `apps/web/src/styles.css`.

### Couleurs

| Jeton | Rôle |
| --- | --- |
| `--blue` | action principale, état actif |
| `--blue-light` | survol, accent secondaire |
| `--muted` | texte secondaire, étiquettes |
| `--panel` | fond des panneaux et fenêtres |
| `--line` | séparations, contours |

### Rayons et durées

| Jeton | Valeur | Usage |
| --- | --- | --- |
| `--rayon-commande` | `10px` | boutons, champs, cartes |
| `--rayon-panneau` | `14px` | panneaux, fenêtres modales |
| `--rayon-pastille` | `999px` | pastilles, jetons de filtre |
| `--duree-reponse` | `.18s` | ce qui répond au doigt |
| `--duree-transition` | `.32s` | ce qui se déplie ou disparaît |

**Une dérive constatée, laissée en l'état.** La feuille contient encore quinze rayons à `9px`, huit à
`8px` et six à `12px`, là où `10px` aurait sans doute suffi. Ces écarts ne sont pas intentionnels :
ils viennent de retouches successives. Ils n'ont **pas** été unifiés, parce que cela modifierait
l'apparence, ce qui est une décision de conception et non de nettoyage. Le jour où elle est prise,
`scripts/geometrie.mjs` en mesurera l'effet exact.

### Rythme fluide

| Jeton | Valeur |
| --- | --- |
| `--pas-1` … `--pas-5` | de `clamp(.25rem, .5vw, .4rem)` à `clamp(1.5rem, 2.8vw, 2.8rem)` |
| `--texte-detail` / `--texte-courant` / `--texte-section` | échelle typographique fluide |

Ces jetons se resserrent sur un téléphone et s'élargissent sur un téléviseur : la respiration de
l'interface suit la taille de l'écran au lieu d'être figée. **Ils sont définis mais pas encore
adoptés** : les appliquer déplacerait l'existant, et ce déplacement doit être voulu. Ils constituent
le vocabulaire des composants à venir, et la cible des composants actuels quand on les reprendra.

## Composants

### `MediaCard`

La brique de base : une jaquette, un titre, une métadonnée. C'est un `<button>`, pas un `<div>`
cliquable — l'activation au clavier, le focus et le rôle annoncé viennent alors gratuitement.

- porte `data-media-id` : c'est ce repère qui permet de **revenir sur la fiche qu'on vient de
  regarder** en quittant le lecteur ;
- l'affiche est chargée paresseusement, et bascule sur l'initiale du titre si elle manque ou échoue ;
- le titre est abrégé à deux lignes, avec le titre complet en `title` — l'abrègement est visuel, le
  texte reste entier pour qui l'écoute.

### `Rail`

Carrousel horizontal. Il **dépasse par construction** : c'est ce qu'on lui demande, et les contrôles
de mise en page l'excluent explicitement à ce titre. Ses flèches disparaissent aux extrémités et
sortent de l'ordre de tabulation quand elles ne servent à rien.

### `CatalogPage`

Grille paginée, servie par le serveur. Tri, filtres et recherche s'appliquent **en SQL, avant le
découpage en pages** : les appliquer sur les seules cartes chargées donnerait un décompte faux dès la
deuxième page.

- affichage immédiat depuis le cache, puis réconciliation en arrière-plan ;
- les pages accumulées au défilement ne sont conservées que si la première n'a pas bougé ;
- `content-visibility: auto` avec `contain-intrinsic-size` : les cartes hors écran ne coûtent rien à
  la mise en page, sans machinerie de virtualisation.

### Fenêtres modales

Fiche détaillée, profils, bibliothèques, correspondances.

- `role="dialog"`, `aria-modal`, et **un nom** — une fenêtre sans nom est annoncée « dialogue » sans
  qu'on sache lequel ;
- focus capturé à l'ouverture, enfermé pendant, rendu à la fermeture ;
- **piège à connaître** : `role="dialog"` sur une `<section>` lui retire sa valeur de section, ce qui
  promeut son `<header>` interne en repère du document. Utiliser un conteneur neutre à l'intérieur.

### Lecteur

Commandes superposées à la vidéo, masquées après trois secondes d'inactivité — jamais en pause.

- le temps affiché est celui **du film**, pas celui du flux : un transcodage peut commencer ailleurs
  qu'au début ;
- la barre de progression garde ses flèches en navigation directionnelle — les lui prendre
  empêcherait de se déplacer à la télécommande.

## Règles qui valent pour tout nouveau composant

1. **Une commande porte un nom.** Sans nom, elle est annoncée « bouton » et rien d'autre.
2. **24 px de cible minimum** (WCAG 2.5.8).
3. **Aucun débordement horizontal** entre 320 px et 4K, hors conteneurs défilants.
4. **Pas de mouvement imposé** : tout défilement animé passe par `scrollBehavior()`, qui respecte la
   préférence système — une règle CSS seule n'atteint pas les défilements demandés en JavaScript.
5. **Atteignable aux quatre flèches**, pas seulement à la tabulation : une télécommande n'a pas de
   touche de tabulation.

## Outils de contrôle

Tous demandent le client construit et le serveur démarré. **Redémarrer le serveur après chaque
construction** : `@fastify/static` indexe son dossier au démarrage, et servirait sinon des fichiers
qui n'existent plus.

| Commande | Ce qu'elle vérifie |
| --- | --- |
| `pnpm --filter web budgets` | poids du premier affichage — bloquante, intégrée à `build` |
| `pnpm --filter web viewports` | aucun débordement, 4 écrans × 7 largeurs |
| `pnpm --filter web vitals` | LCP, FCP, CLS, coût d'un appui |
| `pnpm --filter web a11y-tree` | arbre lu par les technologies d'assistance |
| `node scripts/geometrie.mjs relever\|comparer` | déplacement de la mise en page entre deux états |

`geometrie.mjs` est le filet des retouches de style : on relève avant, on compare après. Une
modification censée être sans effet visuel qui déplace une jaquette de 40 px n'est pas ce qu'on
croyait faire.
