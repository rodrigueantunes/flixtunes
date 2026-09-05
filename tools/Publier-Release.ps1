<#
.SYNOPSIS
  Publie une livraison FlixTunes sur GitHub : tous les artefacts, et le journal en description.

.DESCRIPTION
  Une livraison existe déjà sur le disque après `Build-Release.ps1` ; ce script ne construit rien, il
  **publie**. La séparation est délibérée : construire est sans conséquence, publier est public et ne
  se reprend pas. Deux gestes, deux décisions.

  Ce qui part : **tout** ce que la livraison a produit pour cette estampille — le client Android,
  l'APKG du NAS, le `.msi` et le `.deb` du bureau, l'archive des sources NAS, les installateurs de
  serveur, et le fichier d'empreintes. Rien n'est trié : ce qui a été construit ensemble s'installe
  ensemble, et une personne qui télécharge doit trouver la pièce qui lui manque.

  La description est **la section correspondante du journal des versions**, reprise telle quelle. Elle
  est écrite pour être lue ; la recopier à la main serait la laisser diverger.

.PARAMETER Version
  La version du produit, « 0.5.7 » par exemple. Déduite du journal si elle est omise.

.PARAMETER Revision
  La révision d'empaquetage, « r26 » par exemple. Déduite du journal si elle est omise.

.PARAMETER Brouillon
  Publie en brouillon : la page existe, les fichiers sont là, mais rien n'est visible tant que vous
  n'avez pas appuyé sur « Publish ». À utiliser pour relire avant de rendre public.

.EXAMPLE
  .\tools\Publier-Release.ps1
  Publie la révision décrite par le premier titre du journal.

.EXAMPLE
  .\tools\Publier-Release.ps1 -Version 0.5.7 -Revision r26 -Brouillon
#>
[CmdletBinding()]
param(
  [string] $Version,
  [string] $Revision,
  [switch] $Brouillon
)

$ErrorActionPreference = "Stop"
$racine = Split-Path -Parent $PSScriptRoot
$journalPath = Join-Path $racine "CHANGELOG.md"

# --- 1. Qui publie, et est-il connu de GitHub ? -------------------------------------------------
# On le vérifie avant tout le reste : découvrir l'absence d'authentification après avoir téléversé
# quatre cents mégaoctets serait une plaisanterie de mauvais goût.
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
  throw @"
L'outil GitHub CLI est introuvable. Installez-le puis authentifiez-vous :

    winget install --id GitHub.cli
    gh auth login

L'authentification reste chez vous : ce script n'a jamais besoin de voir votre jeton.
"@
}
& gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "gh n'est pas authentifie. Lancez « gh auth login », puis reessayez." }

# --- 2. Quelle livraison ------------------------------------------------------------------------
$journal = Get-Content $journalPath -Raw -Encoding UTF8
if (-not $Version -or -not $Revision) {
  # Le premier titre du journal décrit la livraison en cours : c'est la même source que celle dont
  # `construire.mjs` tire l'estampille des paquets, pour que les deux ne puissent pas diverger.
  $premier = [regex]::Match($journal, '(?m)^##\s+(\d+\.\d+\.\d+)\.(r\d+)\s')
  if (-not $premier.Success) { throw "Aucune revision lisible dans le premier titre de CHANGELOG.md." }
  if (-not $Version) { $Version = $premier.Groups[1].Value }
  if (-not $Revision) { $Revision = $premier.Groups[2].Value }
}
$estampille = "$Version.$Revision"
$etiquette = "v$estampille"

# --- 3. La description : la section du journal, telle quelle ------------------------------------
# On prend du titre de cette révision jusqu'au titre suivant. Reprendre le texte au lieu de le
# réécrire est ce qui garantit que la page publique dit la même chose que le dépôt.
$motif = [regex]::Escape("## $estampille")
$section = [regex]::Match($journal, "(?ms)^##\s+$([regex]::Escape($estampille))\s.*?(?=^##\s+\d|\z)")
if (-not $section.Success) { throw "Aucune section « ## $estampille » dans CHANGELOG.md." }
$corps = $section.Value.Trim()
# Le titre de la section devient celui de la page GitHub : on ne le répète pas dans le corps.
$titre = ($corps -split "`n")[0] -replace '^##\s+', ''
$corps = (($corps -split "`n") | Select-Object -Skip 1) -join "`n"
$corps = $corps.Trim()

$notes = Join-Path ([System.IO.Path]::GetTempPath()) "flixtunes-notes-$estampille.md"
Set-Content -Path $notes -Value $corps -Encoding utf8

# --- 4. Ce qui part -----------------------------------------------------------------------------
# Le filtre porte sur l'estampille : une livraison ne publie que ses propres fichiers, jamais les
# restes d'une précédente restés dans le dossier.
$dossier = Join-Path $racine "artifacts"
$fichiers = Get-ChildItem $dossier -File | Where-Object { $_.Name -like "*$estampille*" }
if (-not $fichiers) { throw "Aucun artefact pour $estampille dans $dossier. Construisez d'abord." }

Write-Host "Livraison $estampille — $($fichiers.Count) fichier(s) :"
$total = 0
foreach ($f in $fichiers) {
  $total += $f.Length
  "{0,10:N1} Mio  {1}" -f ($f.Length / 1MB), $f.Name | Write-Host
}
"{0,10:N1} Mio  au total" -f ($total / 1MB) | Write-Host

# --- 5. Publication -----------------------------------------------------------------------------
# `--target` fige le commit publié : sans lui, l'etiquette suivrait la branche et designerait autre
# chose que ce qui a ete construit.
$commit = (& git -C $racine rev-parse HEAD).Trim()
$arguments = @("release", "create", $etiquette,
  "--title", "FlixTunes $estampille — $titre",
  "--notes-file", $notes,
  "--target", $commit)
if ($Brouillon) { $arguments += "--draft" }
$arguments += $fichiers.FullName

Write-Host "`nPublication de $etiquette sur $((& git -C $racine remote get-url origin))…"
& gh @arguments
if ($LASTEXITCODE -ne 0) { throw "La publication a echoue." }

Remove-Item $notes -ErrorAction SilentlyContinue
Write-Host "Publie : $etiquette"
