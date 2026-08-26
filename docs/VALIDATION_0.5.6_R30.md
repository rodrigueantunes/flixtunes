# Validation 0.5.6.r30 — preuves locales et origine

## Invariants ajoutés à r29

1. Une identité complète lue dans le conteneur peut relever un nom rejeté ; un conflit avec un nom
   déjà sûr passe en revue.
2. `tvshow.nfo`, `season.nfo` et le NFO d'épisode sont fusionnés du général au spécifique.
3. `.plexmatch` est accepté tel quel et `.flixtunesmatch` peut le surcharger.
4. Deux fournisseurs peuvent dater une même œuvre à ±1 an ; deux IDs différents du même fournisseur
   ne sont jamais traités comme corroboration.
5. Le détail d'un film expose seulement son nom de fichier complet. Celui d'une série expose le
   dossier racine original, jamais le dossier de saison ni le chemin absolu du NAS.

## Cas de non-régression

| Source | Résultat r30 |
| --- | --- |
| `BAC Nord` 2021 / fournisseur 2020 | même œuvre corroborée |
| `BAC Nord (2021)/video.mkv` | titre et année lus dans le dossier |
| `video_001.mkv` avec tags titre+année | correspondance automatique autorisée |
| fichier TV opaque avec tags série/saison/épisode | reclassé comme épisode |
| ID IMDb intégré au conteneur | résolution exacte, sans recherche floue |
| `.plexmatch` au niveau série et surcharge au niveau saison | héritage puis surcharge |
| série dans `Nom original/Saison 1/episode.mkv` | détail affiché : `Nom original` |

Les invariants de sûreté r29 restent décrits dans `VALIDATION_0.5.6_R29.md`.
