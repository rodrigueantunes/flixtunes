# Validation 0.5.6.r81 — les écrans quittent l'activité

*27 août 2026. Première étape du chantier « client de bureau identique à Android ». Cette note ne
rapporte que des résultats **réellement exécutés**.*

## 1. Ce qui a bougé, et rien d'autre

`MainActivity.kt` portait la classe d'activité **et vingt-six composables** — 2 253 lignes où
cohabitaient le cycle de vie Android et tous les écrans de l'application. Les écrans sont désormais
dans `ui/ecrans/`, répartis par sujet :

| Fichier | Contenu | Lignes |
| --- | --- | --- |
| `Racine.kt` | `FlixTunesApp` — l'aiguillage entre les écrans | 114 |
| `Demarrage.kt` | écran de démarrage, enseigne animée | 68 |
| `Connexion.kt` | connexion au serveur | 71 |
| `Profils.kt` | groupes, profils, dialogues de profil et de lecture | 524 |
| `Accueil.kt` | accueil, vitrine, rails | 335 |
| `Historique.kt` | historique de lecture | 40 |
| `Recherche.kt` | panneau de recherche | 61 |
| `Catalogue.kt` | grille, index alphabétique, filtres | 464 |
| `Personnes.kt` | fiches de personnes et rôles | 82 |
| `FicheMedia.kt` | fiche d'un film ou d'un épisode | 233 |

`MainActivity.kt` fait maintenant **64 lignes** : la classe, ses vingt-trois imports, rien de plus.

## 2. Pourquoi c'est la première étape

Ce n'est pas un rangement de principe. Ces vingt-six composables sont **portables tels quels** — ils
n'importent rien d'Android — mais ils étaient enfermés dans une classe qui, elle, ne l'est pas. Tant
qu'ils y restaient, aucun module partagé ne pouvait les atteindre.

Deux fichiers d'interface seulement touchent encore Android — `Gabarit.kt` et `PleinEcran.kt` — et
c'est l'étape 2 qui les isolera derrière des interfaces.

## 3. La preuve que rien n'a changé

Un déplacement de code se vérifie autrement qu'à l'œil. Les blocs extraits ont été comparés au texte
d'origine après normalisation des espaces et des deux seules modifications voulues — `private`
devenant `internal`, puisqu'une déclaration privée de premier niveau ne franchit pas son fichier :

```
mots dans l'original  : 8562
mots après extraction : 8562
identiques            : True
```

**Huit mille cinq cent soixante-deux mots, à l'identique.** Aucune ligne n'a été perdue, réécrite ni
réordonnée.

| Mesure | Avant | Après |
| --- | --- | --- |
| Tests JVM Android | 208, 0 échec | **208, 0 échec** |
| Avertissements lint | 47 | **47** |
| APK debug | construit | **construit**, 18,1 Mio |

## 4. Un piège du dépôt, et un piège de l'outil

**Le fichier mêlait les deux fins de ligne** — 989 CRLF et 1 264 LF. Une première analyse par lignes
en comptait 990 au lieu de 2 254, et aurait découpé n'importe où. C'est une conséquence directe du
défaut corrigé en r77 : le dépôt n'imposait pas ses fins de ligne, et les fichiers en gardent la trace.

**Le report des imports a failli tout casser.** Le tri automatique gardait un import si son nom
apparaissait dans le texte déplacé — ce qui écarte `getValue` et `setValue`, jamais écrits nulle part
alors que ce sont eux qui rendent possible le `by remember`. Vingt et une erreurs de compilation, une
seule cause. Ces deux-là partent maintenant avec tout fichier qui délègue une propriété.

## 5. Suite

L'étape 2 isole les frontières plateforme — gabarit d'écran, plein écran, stockage de session,
découverte mDNS, sons — derrière des interfaces, toujours sur Android seul. Voir
`AUDIT_CLIENT_WINDOWS_COMPOSE.md`, dont le périmètre s'est élargi en cours de route : le chantier vise
un **client de bureau**, Windows *et* Linux, avec paquet `.deb` et archive ordinaire.
