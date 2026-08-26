# Validation 0.5.6.r31 — titres alternatifs et suites

## Invariants

1. Un titre alternatif ne sert de preuve que s'il est renvoyé par le fournisseur pour une candidate de l'année exacte.
2. Seules les trois premières candidates dans l'ordre de recherche TMDB sont enrichies en alias ; l'indisponibilité de cet endpoint ne bloque jamais le scan.
3. Un rang de suite en chiffres romains exige encore un rang exprimé dans le titre distant ou une année exacte.
4. Le premier volet, identique au titre de franchise sans suffixe, n'est jamais promu par la règle des suites.
5. Une année tirée du titre intégré doit être entre parenthèses ou crochets. Un nombre faisant partie du titre reste un titre.
6. Une fiche existante sans affiche est réévaluée par la génération de métadonnées 5.

## Cas de non-régression

| Source locale | Titre officiel distant | Preuve décisive | Résultat r31 |
| --- | --- | --- | --- |
| `Jurassic Park II (1997).mkv` | `Le Monde perdu : Jurassic Park` | rang `II`, franchise et année 1997 | automatique |
| tag `Jurassic Park II (1997) The Lost World [2160p]` | même film | année encadrée et titre intégré compatible | année 1997, alias conservé |
| `Hulk (2008).mkv` | `L'Incroyable Hulk` | alias TMDB `Hulk` et année 2008 | automatique, sans ambiguïté |
| `Dune 2 (2024).mkv` | `Dune : Deuxième partie` | rang écrit et année | automatique |
| `Dune 2 (2024).mkv` | `Dune` (2021) | aucun rang, mauvaise année | refus de la règle des suites |
| `2001 : L'Odyssée de l'espace` dans le conteneur | film de 1968 | nombre non encadré | aucune année inventée |

Les invariants de sûreté et de non-mutation des propositions restent ceux de
`VALIDATION_0.5.6_R29.md` et `VALIDATION_0.5.6_R30.md`.
