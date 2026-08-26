# Validation 0.5.6.r33 — priorité TMDB et vraies jaquettes

## Cas reproduits depuis `server.log`

- `Iron Man 3 (2013).mkv` : Wikidata `Q209538` était retenu sans affiche alors que TMDB `68721` rendait une correspondance parfaite avec jaquette.
- `Spider-Man 2 (2004).mkv` et `Spider-Man 3 (2007).mkv` : même sélection prématurée de Wikidata, suivie d'une capture vidéo utilisée comme poster.
- `SpiderMan Far From Home (2019).mkv` : le séparateur absent dans `SpiderMan` faisait passer le titre intégré `Spider-Man: Far From Home` pour une contradiction.

## Invariants r33

1. Le score reste prioritaire ; à score égal, TMDB précède TVDB puis les fournisseurs ouverts.
2. Wikidata ne court-circuite plus la recherche agrégée.
3. Une candidate TMDB est rechargée par identifiant pour récupérer la fiche détaillée et les illustrations distantes.
4. Une capture vidéo ne peut jamais devenir une jaquette verticale ; les anciennes captures sont retirées lors de la réévaluation.
5. Espaces, tirets et apostrophes ne suffisent pas à rendre contradictoires deux titres intégrés autrement identiques.

## Vérifications automatisées

- `match-engine.test.ts` : Iron Man 3 choisit TMDB même lorsque Wikidata est fourni en premier.
- `ffprobe.test.ts` : `SpiderMan` et `Spider-Man` corroborent la même identité.
- `artwork.test.ts` : la génération vidéo est interdite pour le rôle `poster` et conservée pour `backdrop`.
- `metadata-providers.test.ts` : l'ordre de préférence ne dépasse jamais un meilleur score.
