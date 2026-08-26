# Validation 0.5.6.r29 — correspondance

## Invariants

1. Une proposition classée `review` ou `rejected` n'alimente jamais `external_provider`, `external_id`, le titre distant ou le regroupement du catalogue.
2. Une correspondance automatique exige le seuil de score et une avance d'au moins 8 points sur une œuvre distincte.
3. Deux fournisseurs décrivant le même titre à ±1 an se corroborent ; un résultat distinct du même fournisseur reste une œuvre concurrente.
4. Un identifiant explicite TMDB, IMDb ou TheTVDB est une preuve exacte et prime sur la recherche textuelle.
5. Une correction manuelle est validée auprès du fournisseur avant la transaction, puis inscrite dans `correction_audit`.
6. Tous les fichiers texte modifiés sont UTF-8 sans BOM, sans séquence de mojibake ; les scripts shell restent LF et les scripts PowerShell CRLF conformément à `.gitattributes`.

## Cas de non-régression

| Source | Candidate dangereuse | Résultat r29 |
| --- | --- | --- |
| `Destination Finale I (2000)` | *Destination finale 4* (2009) | revue, puis élargissement vers le film de 2000 |
| `The Avengers EndGame (2019)` | *Avengers* (2012) | jamais automatique ; la candidate 2019 gagne si elle est rendue |
| `Dune` sans année | films de 1984 et 2021 | revue pour ambiguïté |
| `Blanche Neige (1937)` | film de 2025 | revue pour année éloignée |
| `La French (2014)` | titre amputé en `La` | titre conservé intégralement |
| `[imdbid-tt1160419]` | recherche textuelle approximative | résolution directe TMDB `/find` |
| `千と千尋の神隠し (2001)` | titre vidé par normalisation ASCII | comparaison Unicode exacte |
| `BAC Nord` 2021 | Wikidata 2020 et TMDB 2021 | une même œuvre corroborée, pas une ambiguïté |
| `BAC Nord (2021)/video.mkv` | fichier générique | identité sûre lue dans le dossier individuel |
| `video_001.mkv` + tags série/saison/épisode | nom inutilisable | épisode reconstruit et détection automatique |
| `Nom opaque/.plexmatch` | dossier sans identité exploitable | titre, année, IDs et numérotation imposés |

## Commandes de validation

```powershell
pnpm typecheck
pnpm test
pnpm build
$env:FLIXTUNES_PACKAGE_REVISION="r29"
.\apps\android\build-apk.ps1 -Task testDebugUnitTest,lintDebug,assembleDebug,assembleRelease
.\packaging\asustor\Build-AsustorApkg.ps1 -Architectures x86-64 -PackageRevision r29
```

Le script Android reçoit la révision par la propriété Gradle `-PflixtunesRevision=r29` ou par la variable `FLIXTUNES_PACKAGE_REVISION=r29` ; la seconde forme est utilisée pour `build-apk.ps1`.
