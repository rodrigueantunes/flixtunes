# Validation 0.5.6.r41

Trois défauts d'usage signalés sur l'application Android, et ce qu'il faut vérifier pour chacun.

## 1. Un seul appui sur « OK »

Sur téléviseur, tout élément actionnable doit répondre **au premier** appui : jaquettes, sections de
la barre du haut, boutons de profil, puces de filtre, commandes du lecteur, lignes d'épisode, cartes
de saison, versions de fichier.

La cause tenait à deux cibles de focus empilées par élément : l'indication de focus ajoutait son
propre `focusable()` à des composants qui l'étaient déjà. La croix s'arrêtait sur celle qui dessine
le liseré, où valider ne déclenche rien. L'indication lit désormais la cible existante à travers la
source d'interaction du composant.

À vérifier aussi : le liseré blanc et le léger agrandissement suivent bien l'élément visé, sans
décalage d'un cran.

## 2. Filtres de genre repliables

Dans **Films** et **Séries TV** :

- le bloc « Genres » est fermé au premier affichage ; une flèche pivote à l'ouverture ;
- fermé, il continue d'afficher le nombre de genres retenus dans une pastille bleue et leur
  énumération à droite — l'état ne se cache jamais, seul l'outil se range ;
- l'état d'ouverture survit à une rotation et au retour depuis une fiche ;
- l'en-tête fait au moins 48 points de haut, donc atteignable au pouce.

## 3. Pistes audio et sous-titres

Bouton **Pistes** de la barre du haut du lecteur :

- le panneau se déplie et **reste ouvert** pendant qu'on choisit ;
- « Audio » et « Sous-titres » sont deux familles séparées par leur intitulé ;
- la piste active porte un bouton radio rempli ; « Désactivés » en fait partie pour les sous-titres ;
- un choix s'applique sans interrompre la lecture ;
- la barre ne se retire plus au bout de quatre secondes tant que le panneau est ouvert ;
- le retour referme le panneau, et seulement lui ; un second retour quitte le lecteur.

**Limite assumée** : le changement de piste audio à la volée suppose que toutes les pistes soient
présentes dans le flux, ce qui est le cas en **lecture directe**. En remux ou en conversion, le
serveur n'en sert qu'une, et le panneau ne propose donc que celle-là. Le client Web renégocie une
session complète pour ce cas ; ce n'est pas fait ici.

## Contrôles automatiques

- Tests JVM Android : **162 tests, 0 échec**, dont un nouveau sur le retour qui referme un panneau
  avant de quitter le lecteur.
- `lintDebug` : **0 erreur**. Les avertissements `ModifierParameter` de r39 ont disparu.
- `aapt2 compile` accepte les ressources.

## Vérification des modifications apportées au serveur en parallèle

Les fichiers `tmdb.ts`, `open-metadata.ts`, `metadata-providers.ts`, `runtime-services.ts` et leurs
tests ont été modifiés hors de cette étape. Ils n'ont pas été touchés ici, et ont été contrôlés :

- `tsc --noEmit` sur `@flixtunes/contracts`, `@flixtunes/server` et `@flixtunes/web` : **0 erreur** ;
- suite `vitest` complète du serveur : **59 fichiers, 565 tests, 0 échec** (142 s).

## Livrables

- Application Android : `FlixTunes-Android-0.5.6.r41-debug.apk` (`versionCode 56041`, 17,9 Mio),
  signé par la clé de débogage — c'est celui qui s'installe.
  - SHA-256 : `670843D09272452684013F0ECDBC0956FE9DB3FD03B38391112D1D4615DB1A71`.
- Application Android, diffusion : `FlixTunes-Android-0.5.6.r41-release-unsigned.apk` (4,7 Mio),
  **non signé** — il ne s'installe pas tel quel.
  - SHA-256 : `A73D8A7FE48D1ACC4C7EA28F25453CC99F53F634D205ECDA48A0A8A8D0A58563`.
- Empreintes réunies : `artifacts/SHA256SUMS-0.5.6.r41.txt`.

- Paquet ASUSTOR x86-64 : `flixtunes_0.5.6.r41_x86-64.apk`.
  - SHA-256 : *à compléter après construction*.

Le paquet est reconstruit bien qu'aucune source de serveur n'ait changé de ce fait : les deux
artefacts doivent porter le même numéro, sans quoi un APKG r40 en face d'un APK r41 rend tout
diagnostic à distance ambigu. Il embarque les modifications de métadonnées apportées en parallèle,
déjà présentes dans le paquet r40.

La révision ne peut pas se changer en renommant le fichier : elle vit dans `CONTROL/config.json`, et
`start-stop.sh` l'y lit par `sed` pour l'annoncer sur `/api/health`.
