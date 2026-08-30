<#
.SYNOPSIS
  Construit tous les clients FlixTunes d'une même révision : NAS, Android, bureau.

.DESCRIPTION
  Une commande, une estampille, tous les paquets. Le script demande la version et la révision si on
  ne les lui donne pas, puis produit dans le dossier de sortie :

    - le paquet du NAS      `flixtunes_<version>.<revision>_x86-64.apk`   (ASUSTOR)
    - le client Android     `FlixTunes-Android-<version>.<revision>-debug.apk`
    - le client de bureau   `.msi` sous Windows, `.deb` et AppImage sous Linux
    - les archives de sources et les empreintes SHA-256

  ## Ce qu'on lui passe

    .\tools\Build-Release.ps1
        Demande la version puis la révision. La valeur proposée entre crochets est celle du journal
        des versions : appuyer sur Entrée l'accepte.

    .\tools\Build-Release.ps1 -Version 0.5.6 -Revision r88
        Ne demande rien. C'est la forme à employer dans un enchaînement automatique.

    .\tools\Build-Release.ps1 -Sortie D:\paquets
        Écrit ailleurs que dans le dossier par défaut.

  ## Le dossier de sortie

  `$SORTIE_PAR_DEFAUT`, juste en dessous, vaut `N:\Application\Web-Android\FlixTunes\artifacts`.
  C'est une valeur en dur, et volontairement : c'est là que les paquets de ce projet sont rangés
  depuis le début. Une seule ligne à changer pour la déplacer, ou le paramètre `-Sortie` pour un
  écart ponctuel.

  ## Ce que la version et la révision décident

  La version est écrite dans `package.json` puis propagée partout par `Sync-Version.ps1` — contrats,
  serveur, Web, bureau, image Compose, README. La révision estampille les paquets et le titre du
  journal des versions.

  Si l'une des deux diffère de ce que le journal annonce, le script **restampille le premier titre**
  du journal et le dit. C'est la règle du projet : une révision ne monte qu'à la génération, et
  l'entrée en cours porte le numéro du paquet qu'on est en train de produire.

  ## Ce que Windows produit, et la seule chose qu'il ne produit pas

  Lancé sous Windows, le script sort tout sauf une pièce : le paquet ASUSTOR, l'APK Android, le
  `.msi` **et** le `.deb`. Ce dernier n'a pas besoin d'une machine Linux — ni son VLC, tiré des
  paquets Ubuntu, ni son format, dont `packaging/bureau/` fabrique l'outillage manquant.

  Reste l'**AppImage**. Son agencement pose un lien symbolique, que Windows refuse de créer sans un
  privilège qu'une session ordinaire n'a pas. Elle se construit sur une machine Linux, où le même
  script remplit le même dossier de sortie.

.PARAMETER Version
  Version du produit, `0.5.6` par exemple. Demandée si absente.

.PARAMETER Revision
  Révision d'empaquetage, `r88` par exemple. Demandée si absente.

.PARAMETER Sortie
  Dossier où déposer les paquets. Par défaut celui du projet.

.PARAMETER Architectures
  Architectures du paquet NAS. `x86-64` seul par défaut : l'étage VA-API embarque le pilote iHD
  d'Intel, absent du paquet arm64, et aucun appareil ARM n'a jamais été qualifié.

.PARAMETER AutoriserPartageReseau
  Autorise la construction depuis un partage réseau. Sans ce commutateur, le script refuse : pnpm n'y
  sait pas créer ses liens symboliques — mesuré, `UNKNOWN: unknown error, symlink` — et son
  installation y laisse des arborescences à demi écrites, ce qui a déjà interrompu deux constructions
  du paquet ASUSTOR. Une livraison reproductible se construit depuis un disque local.
#>
param(
  [string]$Version,
  [string]$Revision,
  [string]$Sortie,
  [ValidateSet("x86-64", "arm64")]
  [string[]]$Architectures = @("x86-64"),
  [switch]$AutoriserPartageReseau
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$env:CI = "true"

# Le dossier de sortie du projet. Une ligne, et c'est la seule à changer pour tout déplacer.
$SORTIE_PAR_DEFAUT = "N:\Application\Web-Android\FlixTunes\artifacts"
if (-not $Sortie) { $Sortie = $SORTIE_PAR_DEFAUT }

# PowerShell 5.1 ne definit pas $IsWindows : son absence vaut Windows.
$surWindows = $IsWindows -or ($null -eq $IsWindows)

# --- 1. Quel numero l'on construit -------------------------------------------------------------
#
# Le journal des versions fait foi tant qu'on ne dit rien : son premier titre porte la version et la
# revision de l'entree en cours. Ce qu'on saisit l'emporte, et restampille ce titre.
$versionDeclaree = (Get-Content (Join-Path $root "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
$journal = Join-Path $root "CHANGELOG.md"
$titre = (Select-String -Path $journal -Pattern '^##\s+(\d+\.\d+\.\d+)\.(r\d+)' | Select-Object -First 1)
if (-not $titre) { Write-Error "Aucun titre de version exploitable dans CHANGELOG.md."; exit 1 }
$versionJournal = $titre.Matches[0].Groups[1].Value
$revisionJournal = $titre.Matches[0].Groups[2].Value

if (-not $Version) {
  $saisie = Read-Host "Version [$versionJournal]"
  $Version = if ([string]::IsNullOrWhiteSpace($saisie)) { $versionJournal } else { $saisie.Trim() }
}
if (-not $Revision) {
  $saisie = Read-Host "Revision [$revisionJournal]"
  $Revision = if ([string]::IsNullOrWhiteSpace($saisie)) { $revisionJournal } else { $saisie.Trim() }
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { Write-Error "Version attendue sous la forme 0.5.6, recu « $Version »."; exit 1 }
if ($Revision -notmatch '^r\d+$') { Write-Error "Revision attendue sous la forme r88, recu « $Revision »."; exit 1 }

$estampille = "$Version.$Revision"
Write-Output "Livraison $estampille -> $Sortie"

# La version est ecrite a sa source unique, puis propagee. Sans cela, les fichiers qui la declarent
# resteraient sur l'ancienne et le test de coherence ferait echouer la livraison plus loin.
if ($Version -ne $versionDeclaree) {
  Write-Output "  version : $versionDeclaree -> $Version"
  $manifeste = Join-Path $root "package.json"
  $contenu = Get-Content $manifeste -Raw -Encoding UTF8
  $contenu = [regex]::Replace($contenu, '("version"\s*:\s*")[^"]+(")', "`${1}$Version`${2}", 1)
  [System.IO.File]::WriteAllText($manifeste, $contenu, (New-Object System.Text.UTF8Encoding($false)))
}
if ("$versionJournal.$revisionJournal" -ne $estampille) {
  Write-Output "  journal : $versionJournal.$revisionJournal -> $estampille"
  $lignes = Get-Content $journal -Encoding UTF8
  $lignes[$titre.LineNumber - 1] = $lignes[$titre.LineNumber - 1] -replace '^##\s+\d+\.\d+\.\d+\.r\d+', "## $estampille"
  [System.IO.File]::WriteAllLines($journal, $lignes, (New-Object System.Text.UTF8Encoding($false)))
}

# --- 2. Les versions declarees concordent -------------------------------------------------------
& (Join-Path $PSScriptRoot "Sync-Version.ps1")
if ($LASTEXITCODE -ne 0) { exit 1 }

# --- 3. Sur un partage reseau : on recopie, et on se relance sur le disque local ----------------
#
# pnpm n'y cree pas ses liens symboliques — mesure, « UNKNOWN: unknown error, symlink » — et son
# installation y laisse des arborescences a demi ecrites. Plutot que de refuser et de renvoyer la
# personne cloner elle-meme, le script fait le trajet : il recopie le depot, s'y relance avec les
# memes reponses, et depose les paquets au meme endroit.
$surPartage = $false
if ($surWindows) {
  $lecteur = New-Object System.IO.DriveInfo((Split-Path $root -Qualifier) + "\")
  $surPartage = $root.StartsWith("\\") -or $lecteur.DriveType -eq "Network"
}
if ($surPartage -and -not $AutoriserPartageReseau) {
  Write-Output "  depot sur un partage reseau : recopie vers $TRAVAIL_LOCAL"
  [System.IO.Directory]::CreateDirectory($TRAVAIL_LOCAL) | Out-Null
  # Les dossiers ecartes ne sont ni copies ni effaces : ce sont ceux que la construction fabrique sur
  # place — dependances, sorties, caches — et les recopier a chaque fois couterait des minutes pour
  # rien. `.git` reste au clone, qui a le sien.
  $exclusRecopie = @("node_modules", "dist", "build", "release", "vendor", ".git", ".gradle",
                     ".kotlin", ".vitest-data", ".pnpm-store", "artifacts", "TestResults")
  robocopy $root $TRAVAIL_LOCAL /MIR /NFL /NDL /NJH /NJS /NP /XD @exclusRecopie | Out-Null
  # robocopy rend 0 a 7 pour un succes ; 8 et au-dela sont des echecs.
  if ($LASTEXITCODE -ge 8) { Write-Error "La recopie vers $TRAVAIL_LOCAL a echoue (code $LASTEXITCODE)."; exit 1 }
  $global:LASTEXITCODE = 0
  & (Join-Path $TRAVAIL_LOCAL "tools/Build-Release.ps1") -Version $Version -Revision $Revision -Sortie $Sortie -Architectures $Architectures
  exit $LASTEXITCODE
}

# --- 4. pnpm, s'il est joignable ----------------------------------------------------------------
$pnpm = (Get-Command pnpm -ErrorAction SilentlyContinue)
if ($pnpm) {
  $lancerPnpm = { param($arguments) & $pnpm.Source @arguments }
} elseif (Get-Command corepack -ErrorAction SilentlyContinue) {
  $lancerPnpm = { param($arguments) & corepack pnpm @arguments }
} else {
  Write-Error "pnpm est introuvable, et corepack aussi. Installez l'un des deux avant de livrer."
  exit 1
}

[System.IO.Directory]::CreateDirectory($Sortie) | Out-Null
$produits = @()
$absents = @()
Push-Location $root
try {
  & $lancerPnpm @("install", "--frozen-lockfile")
  if ($LASTEXITCODE -ne 0) { throw "pnpm install a echoue." }
  foreach ($etape in @("typecheck", "test", "build")) {
    & $lancerPnpm @("-r", "--filter", "@flixtunes/*", $etape)
    if ($LASTEXITCODE -ne 0) { throw "pnpm $etape a echoue." }
  }

  # --- 5. Le client de bureau, avec son VLC ----------------------------------------------------
  #
  # L'installateur emporte tout : moteur Electron, coque, et une copie taillee de VLC. Rien n'est
  # demande a la machine qui le recoit — c'est la seule facon de donner un programme a quelqu'un sans
  # lui donner aussi une liste de prealables.
  # La revision voyage par l'environnement : c'est elle qui nomme les paquets, du bureau comme
  # d'Android. Sans elle, deux revisions differentes porteraient le meme nom de fichier.
  $env:FLIXTUNES_PACKAGE_REVISION = $Revision
  # Sous Windows on produit les deux paquets : le .msi, puis le .deb. Le VLC embarque differe d'un
  # systeme a l'autre et occupe le meme dossier, alors les passes s'enchainent — chacune repose le
  # sien avant d'appeler electron-builder.
  $constructeur = Join-Path $root "packaging/bureau/construire.mjs"
  $ciblesBureau = if ($surWindows) { @("windows", "linux") } else { @("linux") }
  Push-Location (Join-Path $root "apps/desktop")
  try {
    foreach ($cibleBureau in $ciblesBureau) {
      if ($cibleBureau -eq "linux") { & node $constructeur "--linux" } else { & node $constructeur }
      if ($LASTEXITCODE -ne 0) { throw "La construction du client de bureau ($cibleBureau) a echoue." }
    }
  } finally { Pop-Location }
  $motifs = if ($surWindows) { @("*.msi", "*.deb") } else { @("*.deb", "*.AppImage") }
  foreach ($motif in $motifs) {
    $paquets = Get-ChildItem (Join-Path $root "apps/desktop/release") -Filter $motif -ErrorAction SilentlyContinue
    if (-not $paquets) { throw "Aucun paquet de bureau en $motif." }
    foreach ($paquet in $paquets) {
      Copy-Item $paquet.FullName (Join-Path $Sortie $paquet.Name) -Force
      $produits += $paquet.Name
    }
  }
  if ($surWindows) { $absents += "AppImage (elle pose un lien symbolique : machine Linux requise)" }
  else { $absents += ".msi (a construire sur une machine Windows)" }

  # --- 6. Android, a la meme estampille --------------------------------------------------------
  if ($surWindows) {
    & (Join-Path $root "apps/android/build-apk.ps1")
    if ($LASTEXITCODE -ne 0) { throw "La construction de l'APK a echoue." }
    # Le nom du fichier porte la revision : on le retrouve par motif plutot que par nom fige, faute de
    # quoi un changement d'archivesName fait mourir la livraison a cette ligne.
    $apk = Get-ChildItem (Join-Path $root "apps/android/app/build/outputs/apk/debug") -Filter "*$estampille*-debug.apk" | Select-Object -First 1
    if (-not $apk) { throw "Aucun APK en $estampille dans les sorties Gradle." }
    Copy-Item $apk.FullName (Join-Path $Sortie $apk.Name) -Force
    $produits += $apk.Name

    # --- 7. Le paquet ASUSTOR, a la meme estampille --------------------------------------------
    & (Join-Path $root "packaging/asustor/Build-AsustorApkg.ps1") -SourceRoot $root -BuildRoot $root -OutputDirectory $Sortie -PackageRevision $Revision -Architectures $Architectures
    if ($LASTEXITCODE -ne 0) { throw "La construction du paquet ASUSTOR a echoue." }
    $produits += "flixtunes_${estampille}_$($Architectures -join '_').apk"
  } else {
    $absents += "APK Android et paquet ASUSTOR (chaines outillees sous Windows)"
  }

  # --- 8. Archives de sources ------------------------------------------------------------------
  #
  # Le tar de Windows, nomme par son chemin complet et non par « tar.exe ». Lance depuis un terminal
  # ou Git est dans le chemin, « tar.exe » designe celui de Git, un portage d'outil Unix qui lit
  # « N:\... » comme une machine distante nommee N — d'ou l'echec « Cannot connect to N: resolve
  # failed », a la toute derniere etape d'une livraison de dix minutes.
  #
  # Et deux formats, parce que ce ne sont pas les memes tar. Celui de Windows est bsdtar : « -a »
  # choisit le format d'apres l'extension, et il sait ecrire du zip. Celui de Linux est GNU tar :
  # « -a » y signifie autre chose et le zip lui est etranger. Un .tar.gz y est de toute facon la forme
  # attendue.
  $exclus = @(
    "--exclude=apps/server/node_modules", "--exclude=apps/web/node_modules",
    "--exclude=packages/contracts/node_modules", "--exclude=apps/server/dist",
    "--exclude=apps/web/dist", "--exclude=packages/contracts/dist",
    "--exclude=.vitest-data", "--exclude=*.key", "--exclude=*.db", "--exclude=*.db-shm",
    "--exclude=*.db-wal", "--exclude=TestResults", "--exclude=.env",
    "--exclude=apps/android/.gradle", "--exclude=apps/android/.kotlin",
    "--exclude=apps/android/build", "--exclude=apps/android/app/build",
    "--exclude=apps/desktop/vendor", "--exclude=apps/desktop/release", "--exclude=apps/desktop/dist"
  )
  $sourcesNas = @("apps", "packages", "docs", "tools", "install", "packaging", ".dockerignore",
    ".env.example", ".gitattributes", ".gitignore", "compose.yaml", "Dockerfile",
    "Logo.png", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "README.md", "CHANGELOG.md",
    "tsconfig.base.json")
  $sourcesServeur = @("apps/server", "apps/web", "packages/contracts", "install", "packaging",
    "docs/SERVER_INSTALLATION.md", "docs/NAS_DEPLOYMENT.md", "compose.yaml", "Dockerfile",
    ".dockerignore", ".env.example", ".gitattributes", "package.json", "pnpm-lock.yaml",
    "pnpm-workspace.yaml", "README.md", "tsconfig.base.json")
  if ($surWindows) {
    $tar = Join-Path $env:SystemRoot "System32" | Join-Path -ChildPath "tar.exe"
    if (-not (Test-Path $tar)) { throw "tar.exe de Windows introuvable : $tar" }
    $extension = "zip"
    $forme = @("-a", "-cf")
  } else {
    $tar = "tar"
    $extension = "tar.gz"
    $forme = @("-czf")
  }
  $archiveNas = "FlixTunes-NAS-Source-$estampille.$extension"
  $archiveServeur = "FlixTunes-Server-Installers-$estampille.$extension"
  & $tar @exclus @forme (Join-Path $Sortie $archiveNas) @sourcesNas
  if ($LASTEXITCODE -ne 0) { throw "L'archive des sources a echoue." }
  & $tar @exclus @forme (Join-Path $Sortie $archiveServeur) @sourcesServeur
  if ($LASTEXITCODE -ne 0) { throw "L'archive des installateurs a echoue." }
  $produits += $archiveNas, $archiveServeur

  # --- 9. Empreintes ---------------------------------------------------------------------------
  Push-Location $Sortie
  try {
    Get-ChildItem -File | Where-Object { $_.Name -like "*$estampille*" -and $_.Extension -in @(".zip", ".gz", ".apk", ".apkg", ".msi", ".deb", ".AppImage") } |
      Get-FileHash -Algorithm SHA256 |
      ForEach-Object { "$($_.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($_.Path))" } |
      Set-Content -Encoding utf8 "SHA256SUMS-$estampille.txt"
  } finally { Pop-Location }

  Write-Output ""
  Write-Output "Livraison $estampille complete dans $Sortie"
  foreach ($nom in $produits) { Write-Output "  + $nom" }
  foreach ($manque in $absents) { Write-Output "  - $manque" }
} finally {
  Pop-Location
}
