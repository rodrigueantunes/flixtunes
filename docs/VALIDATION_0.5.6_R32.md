# Validation 0.5.6.r32 — corroboration multilingue et affiches noires

## Diagnostic réel ayant conduit au correctif

Sur le NAS r31, `Ant-Man 2 (2018)` produisait trois réponses correctes à 0,94 :

| Fournisseur | Identifiant | Titre rendu |
| --- | --- | --- |
| TMDB | 363088 | `Ant-Man et la Guêpe` |
| TVDB | 28 | `Ant-Man and the Wasp` |
| Wikidata | Q22957393 | `Ant-Man et la Guêpe` |

TMDB exposait aussi `Ant-Man and the Wasp` comme titre original. L'ancien dédoublonnage ne comparait
que les titres affichés : TVDB devenait donc une prétendue seconde œuvre à zéro point d'écart, malgré
l'année identique. La fiche passait en revue et son poster de secours était un JPEG 600×900 de 3 470
octets, entièrement noir.

## Invariants r32

1. Deux résultats de fournisseurs différents se corroborent si au moins un de leurs titres principal,
   original ou alternatif est identique après normalisation, et si leurs années diffèrent au plus d'un an.
2. Deux identifiants distincts du même fournisseur restent deux œuvres distinctes.
3. Une image extraite de la vidéo dont FFmpeg mesure au moins 96 % de pixels noirs n'est jamais inscrite.
4. Les erreurs d'illustration n'annulent pas les métadonnées textuelles, mais elles ne sont plus muettes.
5. Le journal structuré n'inclut aucun jeton, en-tête d'autorisation ou URL de requête fournisseur.
6. La génération 6 réanalyse les décisions de r31 après installation.
