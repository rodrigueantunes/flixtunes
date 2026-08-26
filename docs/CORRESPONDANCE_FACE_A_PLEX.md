# Correspondance FlixTunes face à Plex

## Pourquoi Plex paraît tout trouver

Plex sépare le scanner, qui interprète le chemin, de l'agent, qui résout l'identité dans son service
de métadonnées. Il bénéficie donc simultanément du nom du fichier, du dossier, des tags intégrés, des
identifiants externes et d'un graphe de données centralisé. FlixTunes disposait des fournisseurs, mais
perdait encore plusieurs de ces preuves avant la décision : un tag interne ne levait pas le rejet du
nom, un `tvshow.nfo` placé au-dessus de `Saison 1` n'était pas lu, et 2020/2021 faisait passer une même
œuvre pour deux candidates.

Références Plex utilisées :

- [nommage des films et identifiants dans le dossier](https://support.plex.tv/articles/naming-and-organizing-your-movie-media-files/)
- [nommage des séries et identifiants TMDB/TVDB/IMDb](https://support.plex.tv/articles/naming-and-organizing-your-tv-show-files/)
- [fichiers `.plexmatch`](https://support.plex.tv/articles/plexmatch/)
- [recherche manuelle et résolution par identifiant](https://support.plex.tv/articles/201018497-fix-match-match/)
- [agents et métadonnées intégrées](https://support.plex.tv/articles/200241558-agents/)

## Pipeline retenu

1. Lire indépendamment le fichier, le dossier individuel/racine, les tags FFprobe, les NFO et les
   fichiers de correspondance.
2. Une identité explicite TMDB, IMDb ou TVDB résout directement l'œuvre.
3. Un nom externe faible peut être remplacé par une identité interne complète ; deux preuves qui se
   contredisent déclenchent une revue au lieu d'un choix silencieux.
4. Interroger les fournisseurs, rescoring toujours contre l'identité complète et non contre une
   requête de recherche raccourcie.
5. Regrouper comme corroboration les fournisseurs décrivant le même titre à ±1 an, tout en conservant
   comme ambiguës deux fiches différentes issues du même fournisseur.
6. N'appliquer au catalogue qu'une victoire automatique non ambiguë. La revue reste détachée.

## Ce qui dépasse Plex

FlixTunes rend chaque décision explicable, conserve les propositions sans modifier l'identité, refuse
un conflit fichier/dossier au lieu de le trancher silencieusement, accepte les conventions `.plexmatch`
sans dépendre de Plex et permet de surcharger celles-ci avec `.flixtunesmatch`.

## Limite incompressible

Plex possède son propre service central et ses accords de données. FlixTunes ne peut promettre la même
couverture distante sans fournisseur riche configuré. Avec TMDB activé, il obtient affiches, fonds,
durée, genres et identifiants croisés ; sans TMDB, Wikidata peut retrouver l'identité d'un film mais
fournit souvent une fiche et des visuels plus pauvres. Cette différence de données ne doit jamais être
masquée derrière un score artificiellement élevé.
