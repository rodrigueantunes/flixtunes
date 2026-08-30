<#
.SYNOPSIS
  Construit une livraison complète : serveur, Web, Windows, Android et paquet ASUSTOR.

.DESCRIPTION
  Ce script était cassé de cinq façons, et chacune produisait une livraison silencieusement fausse
  plutôt qu'un échec franc :

  - il copiait `app-debug.apk`, un nom que l'APK ne porte plus depuis qu'il embarque sa révision.
    `$ErrorActionPreference = "Stop"` faisait donc mourir la livraison juste après Gradle ;
  - il appelait le script ASUSTOR **sans révision**, dont le défaut est `r1` : le paquet sortait
    estampillé `0.5.6.r1` ;
  - il lançait Gradle sans `FLIXTUNES_PACKAGE_REVISION`, donc l'APK sortait en `0.5.6` nu. Les deux
    artefacts d'une même livraison annonçaient ainsi des numéros différents — exactement ce que la
    numérotation commune devait empêcher ;
  - il ne lançait **jamais** les tests du client Windows ;
  - ses archives de sources n'excluaient pas `apps/server/.vitest-data` : 125 Mo de données de test,
    dont `provider-secrets.key`, partaient dans le zip distribué.

  La version et la révision se lisent maintenant dans le **journal des versions**, dont le premier
  titre fait foi, et sont recoupées avec `package.json`. Une livraison ne peut donc plus porter un
  numéro que le journal ne documente pas.

.PARAMETER Revision
  Révision d'empaquetage, `r76` par exemple. Par défaut, celle du premier titre du CHANGELOG.

.PARAMETER AutoriserPartageReseau
  Autorise la construction depuis un partage réseau. Sans ce commutateur, le script refuse : pnpm n'y
  sait pas créer ses liens symboliques — mesuré, `UNKNOWN: unknown error, symlink` — et son
  installation y laisse des arborescences à demi écrites, ce qui a déjà interrompu deux constructions
  du paquet ASUSTOR. Une livraison reproductible se construit depuis un disque local.
#>
param(
  [string]$Artifacts = (Join-Path (Split-Path $PSScriptRoot -Parent) "artifacts"),
  [string]$Revision,
  # Les architectures du paquet NAS. x86-64 seul par defaut : l'etage VA-API embarque le pilote iHD
  # d'Intel, absent du paquet arm64, et aucun appareil ARM n'a jamais ete qualifie.
  [ValidateSet("x86-64", "arm64")]
  [string[]]$Architectures = @("x86-64"),
  [switch]$AutoriserPartageReseau
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$env:CI = "true"

# --- 1. D'ou l'on construit ---------------------------------------------------------------------
$lecteur = New-Object System.IO.DriveInfo((Split-Path $root -Qualifier) + "\")
$surPartage = $root.StartsWith("\\") -or $lecteur.DriveType -eq "Network"
if ($surPartage -and -not $AutoriserPartageReseau) {
  Write-Output "Construction refusee : $root est sur un partage reseau."
  Write-Output "pnpm n'y cree pas ses liens symboliques et y laisse des arborescences a demi ecrites."
  Write-Output "Clonez le depot sur un disque local, ou passez -AutoriserPartageReseau en connaissance de cause."
  exit 1
}

# --- 2. Quel numero l'on construit -------------------------------------------------------------
$version = (Get-Content (Join-Path $root "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
$titre = (Select-String -Path (Join-Path $root "CHANGELOG.md") -Pattern '^##\s+(\d+\.\d+\.\d+)\.(r\d+)' | Select-Object -First 1)
if (-not $titre) { Write-Error "Aucun titre de version exploitable dans CHANGELOG.md."; exit 1 }
$versionJournal = $titre.Matches[0].Groups[1].Value
$revisionJournal = $titre.Matches[0].Groups[2].Value
if ($versionJournal -ne $version) {
  Write-Error "Le journal documente $versionJournal, package.json annonce $version. Alignez-les avant de livrer."
  exit 1
}
if (-not $Revision) { $Revision = $revisionJournal }
$estampille = "$version.$Revision"
Write-Output "Livraison $estampille (journal : $versionJournal.$revisionJournal)"

# --- 3. Les versions declarees concordent -------------------------------------------------------
& (Join-Path $PSScriptRoot "Sync-Version.ps1") -Verifier
if ($LASTEXITCODE -ne 0) { exit 1 }

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

[System.IO.Directory]::CreateDirectory($Artifacts) | Out-Null
Push-Location $root
try {
  & $lancerPnpm @("install", "--frozen-lockfile")
  if ($LASTEXITCODE -ne 0) { throw "pnpm install a echoue." }
  foreach ($etape in @("typecheck", "test", "build")) {
    & $lancerPnpm @("-r", "--filter", "@flixtunes/*", $etape)
    if ($LASTEXITCODE -ne 0) { throw "pnpm $etape a echoue." }
  }

  # --- 5. Windows : construction, publication, et ses tests ------------------------------------
  #
  # Les tests se lancent par leur executable, pas par `dotnet test`.
  #
  # Deux raisons, toutes deux mesurees sur cette machine. La premiere : le SDK 10 exige desormais
  # `--project` et rejette le chemin donne en position, ce que l'ancienne ligne faisait. La seconde,
  # plus genante : meme corrigee, `dotnet test` construit l'application de test puis n'y decouvre
  # **aucun** test et sort en code 5. Le meme binaire, lance directement, en execute huit et les
  # reussit. MSTest.Sdk produit une application autonome sous Microsoft.Testing.Platform : l'appeler
  # est le chemin le plus court, et le seul qui rende un resultat.
  dotnet build "apps/windows/tests/FlixTunes.Windows.Tests.csproj" -c Release
  if ($LASTEXITCODE -ne 0) { throw "La construction des tests Windows a echoue." }
  & (Join-Path $root "apps/windows/tests/bin/Release/net8.0-windows/FlixTunes.Windows.Tests.exe")
  if ($LASTEXITCODE -ne 0) { throw "Les tests du client Windows ont echoue." }
  dotnet build "apps/windows/FlixTunes.Windows.csproj" -c Release
  dotnet publish "apps/windows/FlixTunes.Windows.csproj" -p:PublishProfile=Windows-x64 -o (Join-Path $Artifacts "windows-x64")

  # --- 5 bis. Le client de bureau, avec son VLC ------------------------------------------------
  #
  # L'installateur emporte tout : le moteur Electron, la coque, et une copie taillee de VLC. Rien
  # n'est demande a la machine qui le recoit — c'est la seule facon de donner un programme a
  # quelqu'un sans lui donner aussi une liste de prealables.
  #
  # Seule la cible du systeme sur lequel on construit est produite. Le .deb et l'AppImage sont
  # configures mais s'assemblent sur une machine Linux, avec des binaires VLC Linux : ceux d'ici ne
  # leur serviraient a rien.
  Push-Location (Join-Path $root "apps/desktop")
  try {
    & node (Join-Path $root "packaging/bureau/construire.mjs")
    if ($LASTEXITCODE -ne 0) { throw "La construction du client de bureau a echoue." }
  } finally { Pop-Location }
  $paquetBureau = Get-ChildItem (Join-Path $root "apps/desktop/release") -Filter "*.msi" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $paquetBureau) { throw "Aucun installateur de bureau produit." }
  Copy-Item $paquetBureau.FullName (Join-Path $Artifacts $paquetBureau.Name) -Force

  # --- 6. Android : meme revision que le paquet du NAS -----------------------------------------
  $env:FLIXTUNES_PACKAGE_REVISION = $Revision
  & (Join-Path $root "apps/android/build-apk.ps1")
  if ($LASTEXITCODE -ne 0) { throw "La construction de l'APK a echoue." }
  # Le nom du fichier porte la revision : on le retrouve par motif plutot que par nom fige, faute de
  # quoi un changement d'archivesName fait mourir la livraison a cette ligne.
  $apk = Get-ChildItem (Join-Path $root "apps/android/app/build/outputs/apk/debug") -Filter "*$estampille*-debug.apk" | Select-Object -First 1
  if (-not $apk) { throw "Aucun APK en $estampille dans les sorties Gradle." }
  Copy-Item $apk.FullName (Join-Path $Artifacts $apk.Name) -Force

  # --- 7. Le paquet ASUSTOR, a la meme estampille ----------------------------------------------
  & (Join-Path $root "packaging/asustor/Build-AsustorApkg.ps1") -SourceRoot $root -BuildRoot $root -OutputDirectory $Artifacts -PackageRevision $Revision -Architectures $Architectures
  if ($LASTEXITCODE -ne 0) { throw "La construction du paquet ASUSTOR a echoue." }

  # --- 8. Archives de sources ------------------------------------------------------------------
  #
  # Le tar de Windows, nomme par son chemin complet et non par « tar.exe ».
  #
  # Lance depuis un terminal ou Git est dans le chemin, « tar.exe » designe celui de Git, un portage
  # d'outil Unix qui lit « N:\... » comme une machine distante nommee N — d'ou l'echec « Cannot
  # connect to N: resolve failed », a la toute derniere etape d'une livraison de dix minutes. Celui
  # de Windows, lui, comprend les lecteurs reseau.
  $tar = Join-Path $env:SystemRoot "System32" | Join-Path -ChildPath "tar.exe"
  if (-not (Test-Path $tar)) { throw "tar.exe de Windows introuvable : $tar" }
  $exclus = @(
    "--exclude=apps/server/node_modules", "--exclude=apps/web/node_modules",
    "--exclude=packages/contracts/node_modules", "--exclude=apps/server/dist",
    "--exclude=apps/web/dist", "--exclude=packages/contracts/dist",
    "--exclude=.vitest-data", "--exclude=*.key", "--exclude=*.db", "--exclude=*.db-shm",
    "--exclude=*.db-wal", "--exclude=TestResults", "--exclude=.env",
    "--exclude=apps/android/.gradle", "--exclude=apps/android/.kotlin",
    "--exclude=apps/android/build", "--exclude=apps/android/app/build",
    "--exclude=apps/windows/bin", "--exclude=apps/windows/obj",
    "--exclude=apps/windows/tests/bin", "--exclude=apps/windows/tests/obj"
  )
  $sourcesNas = @("apps", "packages", "docs", "tools", "install", "packaging", ".dockerignore",
    ".env.example", ".gitattributes", ".gitignore", "compose.yaml", "Dockerfile", "global.json",
    "Logo.png", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "README.md", "CHANGELOG.md",
    "tsconfig.base.json")
  $sourcesServeur = @("apps/server", "apps/web", "packages/contracts", "install", "packaging",
    "docs/SERVER_INSTALLATION.md", "docs/NAS_DEPLOYMENT.md", "compose.yaml", "Dockerfile",
    ".dockerignore", ".env.example", ".gitattributes", "package.json", "pnpm-lock.yaml",
    "pnpm-workspace.yaml", "README.md", "tsconfig.base.json")
  & $tar @exclus -a -cf (Join-Path $Artifacts "FlixTunes-NAS-Source-$estampille.zip") @sourcesNas
  if ($LASTEXITCODE -ne 0) { throw "L'archive des sources a echoue." }
  & $tar @exclus -a -cf (Join-Path $Artifacts "FlixTunes-Server-Installers-$estampille.zip") @sourcesServeur
  if ($LASTEXITCODE -ne 0) { throw "L'archive des installateurs a echoue." }

  # --- 9. Empreintes ---------------------------------------------------------------------------
  Push-Location $Artifacts
  try {
    & $tar -a -cf "FlixTunes-Windows-x64-$estampille.zip" "windows-x64"
    Get-ChildItem -File | Where-Object { $_.Name -like "*$estampille*" -and $_.Extension -in @(".zip", ".apk", ".apkg") } |
      Get-FileHash -Algorithm SHA256 |
      ForEach-Object { "$($_.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($_.Path))" } |
      Set-Content -Encoding utf8 "SHA256SUMS-$estampille.txt"
    Write-Output "Livraison $estampille complete : $Artifacts"
  } finally { Pop-Location }
} finally { Pop-Location }
