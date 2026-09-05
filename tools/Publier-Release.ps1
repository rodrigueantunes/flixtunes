<#
.SYNOPSIS
  Publie une livraison FlixTunes sur GitHub : tous les artefacts, et le journal en description.

.DESCRIPTION
  Une livraison existe deja sur le disque apres `Build-Release.ps1` ; ce script ne construit rien, il
  **publie**. La separation est deliberee : construire est sans consequence, publier est public et ne
  se reprend pas. Deux gestes, deux decisions.

  Ce qui part : **tout** ce que la livraison a produit pour cette estampille - le client Android,
  l'APKG du NAS, le `.msi` et le `.deb` du bureau, l'archive des sources NAS, les installateurs de
  serveur, et le fichier d'empreintes. Rien n'est trie : ce qui a ete construit ensemble s'installe
  ensemble, et une personne qui telecharge doit trouver la piece qui lui manque.

  La description est **la section correspondante du journal des versions**, reprise telle quelle. Elle
  est ecrite pour etre lue ; la recopier a la main serait la laisser diverger.

  ## Pourquoi ce fichier n'a aucun accent

  Ce n'est pas de la negligence, c'est la convention des scripts PowerShell du depot, et elle a une
  raison mecanique. Windows PowerShell 5.1 lit un `.ps1` sans BOM avec la page de codes ANSI. Un
  caractere UTF-8 accentue s'y decompose en plusieurs octets, et le tiret cadratin devient
  `a`, `EUR`, `"` - dont le dernier est un **guillemet courbe**, que PowerShell accepte comme
  delimiteur de chaine. Une seule ligne commentee suffit alors a fermer une chaine par erreur et a
  faire echouer l'analyse du fichier entier, avec des erreurs qui designent des lignes parfaitement
  saines vingt lignes plus loin.

  Le journal des versions, lui, garde ses accents : il est lu comme une **donnee**, en UTF-8 explicite,
  jamais interprete comme du code.

.PARAMETER Version
  La version du produit, '0.5.7' par exemple. Deduite du journal si elle est omise.

.PARAMETER Revision
  La revision d'empaquetage, 'r26' par exemple. Deduite du journal si elle est omise.

.PARAMETER Brouillon
  Publie en brouillon : la page existe, les fichiers sont la, mais rien n'est visible tant que vous
  n'avez pas appuye sur 'Publish'. A utiliser pour relire avant de rendre public.

.EXAMPLE
  .\tools\Publier-Release.ps1
  Publie la revision decrite par le premier titre du journal.

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
# On le verifie avant tout le reste : decouvrir l'absence d'authentification apres avoir televerse
# quatre cents megaoctets serait une plaisanterie de mauvais gout.
$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
  throw "GitHub CLI est introuvable. Installez-le puis authentifiez-vous : winget install --id GitHub.cli, puis gh auth login. L'authentification reste chez vous : ce script n'a jamais besoin de voir votre jeton."
}
& gh auth status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "gh n'est pas authentifie. Lancez 'gh auth login', puis reessayez." }

# --- 2. Quelle livraison ------------------------------------------------------------------------
$journal = Get-Content $journalPath -Raw -Encoding UTF8
if (-not $Version -or -not $Revision) {
  # Le premier titre du journal decrit la livraison en cours : c'est la meme source que celle dont
  # `construire.mjs` tire l'estampille des paquets, pour que les deux ne puissent pas diverger.
  $premier = [regex]::Match($journal, '(?m)^##\s+(\d+\.\d+\.\d+)\.(r\d+)\s')
  if (-not $premier.Success) { throw "Aucune revision lisible dans le premier titre de CHANGELOG.md." }
  if (-not $Version) { $Version = $premier.Groups[1].Value }
  if (-not $Revision) { $Revision = $premier.Groups[2].Value }
}
$estampille = "$Version.$Revision"
$etiquette = "v$estampille"

# --- 3. La description : la section du journal, telle quelle ------------------------------------
# On prend du titre de cette revision jusqu'au titre suivant. Reprendre le texte au lieu de le
# reecrire est ce qui garantit que la page publique dit la meme chose que le depot.
$section = [regex]::Match($journal, "(?ms)^##\s+$([regex]::Escape($estampille))\s.*?(?=^##\s+\d|\z)")
if (-not $section.Success) { throw "Aucune section '## $estampille' dans CHANGELOG.md." }
$lignes = $section.Value.Trim() -split "`r?`n"
# Le titre de la section devient celui de la page GitHub : on ne le repete pas dans le corps, et l'on
# retire l'estampille qu'il porte deja - sans quoi la page s'intitulerait 'FlixTunes 0.5.7.r26 -
# 0.5.7.r26 - un ecran qui...', ce qui n'aide personne.
$titre = $lignes[0] -replace '^##\s+', '' -replace "^$([regex]::Escape($estampille))\s*[-\u2014]\s*", ''
$corps = (($lignes | Select-Object -Skip 1) -join "`n").Trim()

# Sans BOM : gh transmet le fichier tel quel, et un BOM apparaitrait comme un caractere parasite en
# tete de la description publiee.
$notes = Join-Path ([System.IO.Path]::GetTempPath()) "flixtunes-notes-$estampille.md"
[System.IO.File]::WriteAllText($notes, $corps, (New-Object System.Text.UTF8Encoding($false)))

# --- 4. Ce qui part -----------------------------------------------------------------------------
# Le filtre porte sur l'estampille : une livraison ne publie que ses propres fichiers, jamais les
# restes d'une precedente restes dans le dossier.
$dossier = Join-Path $racine "artifacts"
$fichiers = @(Get-ChildItem $dossier -File | Where-Object { $_.Name -like "*$estampille*" })
if ($fichiers.Count -eq 0) { throw "Aucun artefact pour $estampille dans $dossier. Construisez d'abord." }

Write-Host "Livraison $estampille - $($fichiers.Count) fichier(s) :"
$total = 0
foreach ($f in $fichiers) {
  $total += $f.Length
  Write-Host ("{0,10:N1} Mio  {1}" -f ($f.Length / 1MB), $f.Name)
}
Write-Host ("{0,10:N1} Mio  au total" -f ($total / 1MB))

# --- 5. Publication -----------------------------------------------------------------------------
# `--target` fige le commit publie : sans lui, l'etiquette suivrait la branche et designerait bientot
# autre chose que ce qui a ete construit.
$commit = (& git -C $racine rev-parse HEAD).Trim()
$arguments = @("release", "create", $etiquette,
  "--title", "FlixTunes $estampille - $titre",
  "--notes-file", $notes,
  "--target", $commit)
if ($Brouillon) { $arguments += "--draft" }
$arguments += $fichiers.FullName

$origine = (& git -C $racine remote get-url origin).Trim()
Write-Host ""
Write-Host "Publication de $etiquette sur $origine ..."
& gh @arguments
if ($LASTEXITCODE -ne 0) { throw "La publication a echoue." }

Remove-Item $notes -ErrorAction SilentlyContinue
Write-Host "Publie : $etiquette"
