# Validation 0.5.6.r34 — films exacts contre bonus homonymes

## Cause confirmée par le journal r33

`Iron Man 3 (2013).mkv` était encore enregistré comme Wikidata `Q209538`. TMDB était sain et rendait
le film `68721`, mais également des bonus tels que `Iron Man 3 Unmasked`. La reconnaissance des suites
donnait au bonus un score pouvant égaler celui du film exact ; la marge d'ambiguïté annulait alors la
fiche TMDB complète et son affiche.

Le même profil apparaît sur `Spider-Man 2`, `Spider-Man 3`, `Jurassic Park III` et
`Back to the Future Part II`.

## Invariants r34

1. Titre exact et année exacte gagnent sur un résultat seulement reconnu comme suite.
2. Deux fiches réellement exactes du même fournisseur restent en revue.
3. Une détection locale « à revoir » peut être départagée par le fournisseur ; une détection rejetée ne le peut pas.
4. Un article initial peut être retiré comme variante de requête, sans modifier le titre conservé ni le score final.
5. Les captures vidéo restent interdites comme jaquettes, conformément à r33.

## Vérifications automatisées

- `Iron Man 3` contre `Iron Man 3 Unmasked` : automatique sur TMDB `68721`.
- Deux fiches `Superman (2025)` réellement exactes : revue conservée.
- `The Avengers EndGame` : variante `Avengers EndGame` générée.
- 82 tests ciblés réussis et compilation TypeScript réussie.
