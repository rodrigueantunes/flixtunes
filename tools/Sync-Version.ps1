<#
.SYNOPSIS
  Propage la version du produit à tous les fichiers qui la déclarent.

.DESCRIPTION
  La version vivait à sept endroits, et ils avaient divergé : le produit annonçait 0.5.6, les
  contrats 0.5.3, le client Windows 0.4.0, l'image Compose et le titre du README 0.2.0. Un écran de
  diagnostic ne veut plus rien dire dans ces conditions, et une matrice de compatibilité encore moins.

  La source unique est `package.json` à la racine. Ce script y lit la version et réécrit les autres.
  Il est vérifié par un test — `versions-coherentes.test.ts` — qui échoue si l'un d'eux dérive : la
  cohérence ne dépend donc pas de la mémoire de celui qui livre.

.PARAMETER Verifier
  N'écrit rien : rend un code de sortie non nul si un fichier diverge. C'est le mode qu'emploie une
  chaîne d'intégration.
#>
param([switch]$Verifier)

$ErrorActionPreference = "Stop"
$racine = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $racine "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
$pnpm = ((Get-Content (Join-Path $racine "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).packageManager -replace '^pnpm@', '')

$cibles = @(
  @{ Fichier = "packages/contracts/package.json"; Motif = '("version"\s*:\s*")[^"]+(")'; Valeur = $version },
  @{ Fichier = "apps/server/package.json";        Motif = '("version"\s*:\s*")[^"]+(")'; Valeur = $version },
  @{ Fichier = "apps/web/package.json";           Motif = '("version"\s*:\s*")[^"]+(")'; Valeur = $version },
  @{ Fichier = "apps/desktop/package.json";       Motif = '("version"\s*:\s*")[^"]+(")'; Valeur = $version },
  @{ Fichier = "apps/windows/FlixTunes.Windows.csproj"; Motif = '(<Version>)[^<]+(</Version>)'; Valeur = $version },
  @{ Fichier = "compose.yaml";                    Motif = '(image:\s*flixtunes:)[^\s]+()';  Valeur = $version },
  @{ Fichier = "README.md";                       Motif = '(^# FlixTunes )[0-9][^\s]*()';   Valeur = $version },
  @{ Fichier = "apps/windows/README.md";          Motif = '(^# Client Windows FlixTunes )[0-9][^\s]*()'; Valeur = $version },
  @{ Fichier = "Dockerfile";                      Motif = '(--global pnpm@)[^\s]+()';       Valeur = $pnpm }
)

$divergents = @()
foreach ($cible in $cibles) {
  $chemin = Join-Path $racine $cible.Fichier
  if (-not (Test-Path $chemin)) { continue }
  $contenu = Get-Content $chemin -Raw -Encoding UTF8
  $attendu = $contenu -replace $cible.Motif, "`${1}$($cible.Valeur)`${2}"
  if ($attendu -ne $contenu) {
    $divergents += $cible.Fichier
    if (-not $Verifier) {
      [System.IO.File]::WriteAllText($chemin, $attendu, (New-Object System.Text.UTF8Encoding($false)))
      Write-Output "  mis à jour : $($cible.Fichier) -> $($cible.Valeur)"
    } else {
      Write-Output "  diverge : $($cible.Fichier)"
    }
  }
}

if ($divergents.Count -eq 0) { Write-Output "Versions cohérentes : $version (pnpm $pnpm)."; exit 0 }
if ($Verifier) { Write-Error "$($divergents.Count) fichier(s) divergent de la version $version."; exit 1 }
Write-Output "Version propagée : $version (pnpm $pnpm)."
