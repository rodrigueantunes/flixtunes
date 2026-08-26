[CmdletBinding()]
param(
  [string]$SourceRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
  [string]$BuildRoot = $SourceRoot,
  [string]$OutputDirectory = (Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "artifacts"),
  [ValidateSet("x86-64", "arm64")]
  [string[]]$Architectures = @("x86-64", "arm64"),
  [string]$PackageRevision = "r1",
  [string]$NodeVersion = "24.15.0",
  [string]$CaddyVersion = "2.11.4",
  [string]$FfmpegVersion = "8.1",
  # `stable` s'en tient aux publications finales de Jellyfin ; `preview` accepte aussi les preversions,
  # ou vit la lignee FFmpeg la plus recente. Voir `Get-JellyfinRelease`.
  [ValidateSet("stable", "preview")]
  [string]$JellyfinCanal = "stable",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

<#
.SYNOPSIS
  Rend un chemin UNC sous la lettre de lecteur qui le désigne, quand il en existe une.

.DESCRIPTION
  Le dépôt est sur un partage réseau. Selon la façon dont ce script est lancé, `$PSScriptRoot` vaut
  soit `N:\…`, soit `\\serveur\Documents\…` — et la seconde forme casse la construction.

  pnpm exécute les scripts de paquet à travers `CMD.EXE`, qui ne sait pas se placer dans un chemin
  UNC : il le refuse, retombe sur le répertoire Windows, et `tsc` — cherché dans le `node_modules`
  du dépôt, relativement au répertoire courant — devient introuvable. L'erreur est trompeuse, elle
  ressemble à une dépendance manquante.
#>
function ConvertTo-LocalPath([string]$Path) {
  if (-not $Path.StartsWith("\\")) { return $Path }
  foreach ($lecteur in Get-PSDrive -PSProvider FileSystem) {
    $racine = $lecteur.DisplayRoot
    if ($racine -and $Path.StartsWith($racine, [StringComparison]::OrdinalIgnoreCase)) {
      return $lecteur.Name + ":" + $Path.Substring($racine.Length)
    }
  }
  return $Path
}

$SourceRoot = ConvertTo-LocalPath $SourceRoot
$BuildRoot = ConvertTo-LocalPath $BuildRoot
$OutputDirectory = ConvertTo-LocalPath $OutputDirectory

$applicationVersion = (Get-Content (Join-Path $SourceRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
$packageVersion = if ($PackageRevision) { "$applicationVersion.$PackageRevision" } else { $applicationVersion }
$temporaryBase = if ($env:PUBLIC -and (Test-Path -LiteralPath $env:PUBLIC)) { $env:PUBLIC } else { [IO.Path]::GetTempPath() }
$temporary = Join-Path $temporaryBase "flixtunes-asustor-$([guid]::NewGuid())"
$runtimeCache = Join-Path $temporaryBase "FlixTunes-Runtime-Cache"
$deploy = Join-Path $temporary "server-deploy"
New-Item -ItemType Directory -Path $temporary, $runtimeCache, $OutputDirectory -Force | Out-Null

<#
.SYNOPSIS
  Le `tar` de Windows, designe par son chemin complet.

.DESCRIPTION
  Windows fournit bsdtar dans System32, qui comprend les chemins a lettre de lecteur. Git en installe
  un autre, GNU tar, qui prend un chemin commencant par une lettre de lecteur pour un hote distant et
  s'arrete sur « Cannot connect to C: resolve failed ». Lequel des deux repond a « tar.exe » depend de
  l'ordre du PATH, donc de la facon dont ce script a ete lance — un shell POSIX place celui de Git en
  premier.

  Le designer par son chemin complet supprime cette dependance : la construction donne le meme
  resultat quel que soit le terminal.
#>
function Get-WindowsTar {
  $chemin = Join-Path $env:SystemRoot "System32/tar.exe"
  if (Test-Path $chemin) { return $chemin }
  $secours = (Get-Command tar.exe -ErrorAction SilentlyContinue).Source
  if ($secours) { return $secours }
  throw "tar introuvable."
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Invoke-Pnpm([Parameter(ValueFromRemainingArguments = $true)][string[]]$PnpmArguments) {
  # pnpm annonce chaque script qu'il lance sur la sortie d'erreur (« $ tsc -p tsconfig.json »).
  # Windows PowerShell 5.1 emballe ces lignes en erreurs du script : avec la préférence « Stop »,
  # la construction s'arrête sur l'annonce d'une commande qui n'a pas encore échoué. Seul le code
  # de sortie dit la vérité.
  $ancienne = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    if (Get-Command corepack -ErrorAction SilentlyContinue) { & corepack pnpm @PnpmArguments }
    else { & pnpm @PnpmArguments }
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $ancienne }
  if ($code -ne 0) { throw "pnpm $($PnpmArguments -join ' ') a échoué (code $code)." }
}

<#
.SYNOPSIS
  Exécute le script `build` d'un paquet, sans passer par la résolution d'espace de travail de pnpm.

.DESCRIPTION
  Le détour est imposé par esbuild, que Vite emploie pour préparer sa configuration.

  pnpm canonise le répertoire de travail : `N:\…`, lettre d'un lecteur réseau, devient
  `\\serveur\…`. Node s'en accommode parfaitement — `require.resolve` retrouve `vite` et
  `@vitejs/plugin-react` depuis `apps/web`. esbuild, écrit en Go, ne sait pas remonter l'arborescence
  depuis un chemin UNC : il annonce « Failed to resolve entry for package "vite" », ce qui donne à
  croire à une dépendance manquante ou à un manifeste abîmé. Mesuré : la même construction lancée
  sous `N:\…` réussit en trente-trois secondes.

  Le script exécuté reste celui du `package.json` — pas de duplication de la recette de construction
  ici. Seuls changent le répertoire et l'interpréteur : bash, qui accepte le `&&` des scripts et
  reçoit `node_modules/.bin` dans son PATH.
#>
function Invoke-PackageBuild([string]$PackageDirectory, [string]$ErrorMessage) {
  $manifeste = Get-Content (Join-Path $PackageDirectory "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
  $script = $manifeste.scripts.build
  if (-not $script) { throw "$($manifeste.name) n'a pas de script « build »." }

  $bash = "C:\Program Files\Git\bin\bash.exe"
  if (-not (Test-Path $bash)) { throw "bash introuvable : $bash" }

  # `PATH` sépare ses entrées par un deux-points : « N:/… » y serait coupé en deux, et le répertoire
  # des exécutables perdu. Bash attend la forme « /n/… » pour un lecteur Windows.
  $binPath = (Join-Path $SourceRoot "node_modules\.bin") -replace '\\', '/'
  $binPath = [regex]::Replace($binPath, '^([A-Za-z]):', { "/" + $args[0].Groups[1].Value.ToLower() })

  Write-Output "  $($manifeste.name) : $script"
  $ancienne = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    Push-Location $PackageDirectory
    & $bash -c "export PATH=`"$binPath`":`$PATH; $script"
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
    $ErrorActionPreference = $ancienne
  }
  if ($code -ne 0) { throw $ErrorMessage }
}

function New-AdmIcon([string]$Destination) {
  Add-Type -AssemblyName System.Drawing
  # La marque n'est plus deposee dans le dossier expedie du client Web : aucun code Web ne l'utilisait,
  # et elle y pesait 284 Kio dans chaque paquet. Les copies entretenues par tools/New-BrandAssets.ps1
  # restent la source. Une image 512x512 suffit largement pour une icone ADM reduite a 90x90.
  $markCandidates = @(
    (Join-Path $SourceRoot "apps\windows\Assets\flixtunes-mark.png"),
    (Join-Path $SourceRoot "apps\android\app\src\main\res\drawable-nodpi\flixtunes_mark.png"),
    (Join-Path $SourceRoot "apps\web\public\brand\flixtunes-logo.png")
  )
  $markPath = $markCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $markPath) { throw "Aucune image de marque trouvee. Executez tools/New-BrandAssets.ps1." }
  $sourceImage = [Drawing.Image]::FromFile($markPath)
  try {
    $icon = [Drawing.Bitmap]::new(90, 90, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [Drawing.Graphics]::FromImage($icon)
    try {
      $graphics.Clear([Drawing.Color]::Transparent)
      $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceOver
      $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.DrawImage($sourceImage, 0, 0, 90, 90)
      $icon.Save($Destination, [Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $icon.Dispose() }
  } finally { $sourceImage.Dispose() }
}

function Get-NodeRuntime([string]$Architecture, [string]$Destination) {
  $nodeArchitecture = if ($Architecture -eq "x86-64") { "x64" } else { "arm64" }
  $filename = "node-v$NodeVersion-linux-$nodeArchitecture.tar.gz"
  $baseUrl = "https://nodejs.org/dist/v$NodeVersion"
  $archive = Join-Path $runtimeCache $filename
  $checksums = (Invoke-WebRequest -UseBasicParsing "$baseUrl/SHASUMS256.txt").Content
  $checksumLine = ($checksums -split "`n" | Where-Object { $_ -match "\s+$([regex]::Escape($filename))\s*$" } | Select-Object -First 1).Trim()
  if (-not $checksumLine) { throw "Somme Node.js introuvable pour $filename." }
  $expected = ($checksumLine -split "\s+")[0].ToLowerInvariant()
  if (-not (Test-Path -LiteralPath $archive) -or (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant() -ne $expected) {
    Invoke-WebRequest -UseBasicParsing "$baseUrl/$filename" -OutFile $archive
  }
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "Somme SHA-256 Node.js invalide pour $filename." }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  & (Get-WindowsTar) -xzf $archive -C $Destination --strip-components=1 "node-v$NodeVersion-linux-$nodeArchitecture/bin/node" "node-v$NodeVersion-linux-$nodeArchitecture/LICENSE"
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $Destination "bin\node"))) {
    throw "Extraction du runtime Node.js impossible pour $Architecture."
  }
}

function Get-CaddyRuntime([string]$Architecture, [string]$Destination) {
  # Caddy ne publie pas de binaire ASUSTOR : c'est le binaire Linux statique, ecrit en Go, sans
  # dependance partagee. Il est embarque comme le reste — rien a installer sur le NAS.
  $caddyArchitecture = if ($Architecture -eq "x86-64") { "amd64" } else { "arm64" }
  $filename = "caddy_${CaddyVersion}_linux_$caddyArchitecture.tar.gz"
  $baseUrl = "https://github.com/caddyserver/caddy/releases/download/v$CaddyVersion"
  $archive = Join-Path $runtimeCache $filename
  # Caddy publie ses sommes en SHA-512, la ou Node.js les publie en SHA-256.
  #
  # Et son fichier de sommes revient en `Byte[]`, non en chaine : GitHub le sert sans jeu de
  # caracteres que `Invoke-WebRequest` reconnaisse. Un `-split` applique tel quel decoupe alors octet
  # par octet — des milliers de « lignes », aucune correspondance, et une erreur finale illisible.
  # nodejs.org annonce `text/plain`, d'ou l'absence du probleme dans la fonction voisine.
  $reponse = Invoke-WebRequest -UseBasicParsing "$baseUrl/caddy_${CaddyVersion}_checksums.txt"
  $checksums = if ($reponse.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($reponse.Content) } else { [string]$reponse.Content }
  $checksumLine = $checksums -split "`n" | Where-Object { $_ -match "\s+$([regex]::Escape($filename))\s*$" } | Select-Object -First 1
  if (-not $checksumLine) { throw "Somme Caddy introuvable pour $filename." }
  $checksumLine = $checksumLine.Trim()
  $expected = ($checksumLine -split "\s+")[0].ToLowerInvariant()
  if (-not (Test-Path -LiteralPath $archive) -or (Get-FileHash -Algorithm SHA512 -LiteralPath $archive).Hash.ToLowerInvariant() -ne $expected) {
    Invoke-WebRequest -UseBasicParsing "$baseUrl/$filename" -OutFile $archive
  }
  $actual = (Get-FileHash -Algorithm SHA512 -LiteralPath $archive).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "Somme SHA-512 Caddy invalide pour $filename." }
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  & (Get-WindowsTar) -xzf $archive -C $Destination "caddy" "LICENSE"
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $Destination "caddy"))) {
    throw "Extraction du runtime Caddy impossible pour $Architecture."
  }
}

<#
.SYNOPSIS
  Telecharge une bibliotheque du pool Debian et la pose dans un dossier.

.DESCRIPTION
  Le pool est un index navigable : on y lit les fichiers presents et on retient le dernier par ordre
  de version. Une resolution au moment de la construction survit aux mises a jour de Debian, ce qu'une
  URL ecrite en dur ne fait pas — constate sur `libigdgmm12` et `libdrm2`, dont la disparition avait
  produit un paquet sans acceleration materielle.
#>
function Get-DebianLibrary([string]$Dossier, [string]$Prefixe, [string]$Destination) {
  $index = "https://deb.debian.org/debian/pool/main/$Dossier/"
  try {
    $page = Invoke-WebRequest -UseBasicParsing $index
    $noms = [regex]::Matches($page.Content, [regex]::Escape($Prefixe) + '[^"'']*?_amd64\.deb') |
      ForEach-Object { $_.Value } | Sort-Object -Unique
    if (-not $noms) { throw "Aucun paquet $Prefixe dans $index" }
    # Tri naturel sur la version : « 22.3.0 » doit passer avant « 22.10.0 ».
    $dernier = $noms | Sort-Object { ($_ -replace '^.*?_', '' -replace '_amd64\.deb$', '') -replace '\d+', { $args[0].Value.PadLeft(6, '0') } } |
      Select-Object -Last 1
    $deb = Join-Path $runtimeCache $dernier
    if (-not (Test-Path -LiteralPath $deb)) { Invoke-WebRequest -UseBasicParsing "$index$dernier" -OutFile $deb }
    if ($Destination) { Invoke-Extracteur "extract-va-driver.py" @($Destination, $deb) "Extraction de $Prefixe impossible." }
    return $deb
  } catch {
    # L'index Debian peut etre momentanement indisponible alors que le paquet valide a deja ete
    # telecharge. Ne jamais supprimer une capacite d'un APKG simplement a cause de cet incident : le
    # cache rend aussi les reconstructions reproductibles.
    $cache = Get-ChildItem -LiteralPath $runtimeCache -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like "$Prefixe*_amd64.deb" } |
      Sort-Object Name |
      Select-Object -Last 1
    if ($cache) {
      Write-Warning "Index Debian indisponible pour $Prefixe ; utilisation du cache $($cache.Name)."
      if ($Destination) {
        Invoke-Extracteur "extract-va-driver.py" @($Destination, $cache.FullName) "Extraction de $Prefixe depuis le cache impossible."
      }
      return $cache.FullName
    }
    Write-Warning "Bibliotheque Debian non recuperee ($Prefixe) : $($_.Exception.Message)"
  }
}

<#
.SYNOPSIS
  Le runtime FFmpeg et l'etage VA-API, tires des constructions Jellyfin.

.DESCRIPTION
  Le choix de Jellyfin plutot que des constructions generiques n'est pas une preference : c'est la
  seule combinaison connue qui fonctionne sur ce materiel.

  FFmpeg appelle `vaMapBuffer2` sur le chemin d'encodage VA-API. Ce symbole est apparu dans libva
  2.21. Or l'ADM tourne en glibc 2.31, et aucune libva de Debian ne reunit les deux : bullseye (2.10)
  a la bonne glibc mais pas le symbole, et celles qui l'ont exigent glibc 2.38. Les constructions de
  BtbN chargent libva par `implib-gen`, qui **abandonne le processus** devant un symbole absent :

      implib-gen: libva.so.2: failed to resolve symbol 'vaMapBuffer2' via dlsym
      ffmpeg: _libva_so_2_tramp_resolve: Assertion `0' failed. Aborted

  Jellyfin construit sa propre libva pour chaque distribution cible. Son paquet bullseye fournit donc
  une libva 2.23 compilee contre glibc 2.30, apparie a son pilote iHD et a sa libdrm — verifie sur les
  fichiers : aucun binaire n'exige plus que la glibc de la cible.

  Deux artefacts, et le partage entre eux est deliberer : le paquet Debian complet reclame une
  vingtaine de bibliotheques que l'ADM n'a pas, tandis que la construction **portable** ne depend que
  de la bibliotheque C. On prend donc les binaires de l'une et l'etage VA-API de l'autre.
#>
<#
.SYNOPSIS
  La publication Jellyfin la plus avancee qui porte les deux artefacts dont le paquet a besoin.

.DESCRIPTION
  `releases/latest` ecarte les preversions, et c'est precisement la ou vit la lignee la plus recente :
  la branche FFmpeg 8 y est publiee en preversion tant que Jellyfin 12 n'est pas sorti, alors qu'elle
  sort de la meme chaine de construction que la lignee stable.

  L'ecart n'est pas cosmetique. Mesure sur les artefacts : la lignee 7 apporte libva 2.23 et le pilote
  iHD 25.4.6, la lignee 8 libva 2.24 et le pilote 26.2.4 — la ou Plex, sur la meme machine, tourne en
  libva 2.22 et pilote 24.1.5. Les deux lignees exigent glibc 2.30, donc tiennent dans l'ADM.

  La publication n'est retenue que si elle porte **les deux** artefacts : le binaire portable et le
  paquet Debian d'ou vient l'etage VA-API. Ils doivent venir de la meme publication, faute de quoi
  libva et son pilote se desapparient — un pilote n'expose qu'un seul point d'entree, celui de la
  libva contre laquelle il a ete construit, et une libva plus ancienne le refuse net.

  La lignee la plus recente n'est pourtant **pas** prise par defaut, et ce choix se justifie. Le NAS de
  reference porte un Celeron N5105, dont le circuit video est de generation 11. Les pilotes recents
  travaillent les generations Xe et suivantes ; sur les anciennes ils n'apportent guere, et il leur
  arrive d'en retirer le support. La lignee stable a par ailleurs ete eprouvee sur la machine, la
  preversion non — et la regle du projet veut qu'un chemin materiel non mesure ne soit pas retenu
  d'office.
  `-JellyfinCanal preview` l'essaie deliberement ; la sonde de demarrage retombe alors sur le pilote
  precedent si le plus recent n'ouvre pas de session.
#>
function Get-JellyfinRelease {
  if ($script:JellyfinRelease) { return $script:JellyfinRelease }
  $publications = Invoke-RestMethod -Headers @{ "User-Agent" = "FlixTunes-APKG-Builder" } `
    "https://api.github.com/repos/jellyfin/jellyfin-ffmpeg/releases?per_page=15"
  foreach ($publication in $publications) {
    if ($publication.draft) { continue }
    if ($publication.prerelease -and $JellyfinCanal -ne "preview") { continue }
    $noms = $publication.assets | ForEach-Object { $_.name }
    $aPortable = $noms | Where-Object { $_ -like "*_portable_linux64-gpl.tar.xz" }
    $aPaquet = $noms | Where-Object { $_ -like "*-bullseye_amd64.deb" }
    if ($aPortable -and $aPaquet) {
      Write-Output "Runtime FFmpeg retenu : $($publication.tag_name)$(if ($publication.prerelease) { ' (preversion)' })"
      $script:JellyfinRelease = $publication
      return $script:JellyfinRelease
    }
  }
  throw "Aucune publication Jellyfin ne porte a la fois le binaire portable et le paquet bullseye."
}

function Get-JellyfinAsset([string]$Name) {
  $release = Get-JellyfinRelease
  $asset = $release.assets | Where-Object { $_.name -eq $Name } | Select-Object -First 1
  if (-not $asset) { throw "Artefact Jellyfin introuvable dans $($release.tag_name) : $Name" }
  $fichier = Join-Path $runtimeCache $Name
  if (-not (Test-Path -LiteralPath $fichier)) {
    Invoke-WebRequest -UseBasicParsing $asset.browser_download_url -OutFile $fichier
  }
  # La somme est verifiee quand GitHub l'annonce. Elle ne l'est pas toujours ; dans ce cas les
  # extracteurs valent controle : ils refusent un binaire absent, et un ELF exigeant une glibc trop
  # recente pour la cible.
  if ($asset.digest -and $asset.digest -match '^sha256:([0-9a-fA-F]{64})$') {
    $attendu = $Matches[1].ToLowerInvariant()
    $obtenu = (Get-FileHash -Algorithm SHA256 -LiteralPath $fichier).Hash.ToLowerInvariant()
    if ($obtenu -ne $attendu) { throw "Somme SHA-256 invalide pour $Name." }
  }
  return $fichier
}

function Get-PythonPath {
  $python = (Get-Command python -ErrorAction SilentlyContinue).Source
  if (-not $python) { $python = (Get-Command python3 -ErrorAction SilentlyContinue).Source }
  if (-not $python) { throw "Python 3 est requis pour construire le paquet." }
  return $python
}

function Invoke-Extracteur([string]$Script, [string[]]$Arguments, [string]$Echec) {
  $python = Get-PythonPath
  $ancienne = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & $python (Join-Path $PSScriptRoot $Script) @Arguments
  $code = $LASTEXITCODE
  $ErrorActionPreference = $ancienne
  if ($code -ne 0) { throw $Echec }
}

function Get-FfmpegRuntime([string]$Architecture, [string]$Destination) {
  $release = Get-JellyfinRelease
  $version = $release.tag_name -replace '^v', ''
  $cible = if ($Architecture -eq "x86-64") { "linux64" } else { "linuxarm64" }
  $archive = Get-JellyfinAsset "jellyfin-ffmpeg_${version}_portable_${cible}-gpl.tar.xz"
  Invoke-Extracteur "extract-jellyfin-ffmpeg.py" @($archive, $Destination) `
    "Extraction du runtime FFmpeg impossible pour $Architecture."
}

function Get-VaapiRuntime([string]$Architecture, [string]$Destination) {
  $release = Get-JellyfinRelease
  $version = $release.tag_name -replace '^v', ''
  $arch = if ($Architecture -eq "x86-64") { "amd64" } else { "arm64" }
  # `bullseye` et pas plus recent : sa glibc est exactement celle de l'ADM. Un paquet bookworm se
  # charge puis plante, et le message qui en sort ne designe jamais la vraie cause — trois revisions
  # y sont passees.
  $lignee = ($version -split '\.')[0]
  $deb = Get-JellyfinAsset "jellyfin-ffmpeg${lignee}_${version}-bullseye_${arch}.deb"
  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Invoke-Extracteur "extract-jellyfin-va.py" @($deb, $Destination) `
    "Extraction de l'etage VA-API impossible pour $Architecture."

  # `libpciaccess` manque a l'appel : `libdrm_intel` la reclame et Jellyfin ne l'embarque pas. Celle
  # de bullseye convient — meme glibc, et c'est une bibliotheque figee depuis des annees.
  if ($Architecture -ne "x86-64") { return }
  $pciAccess = Get-DebianLibrary "libp/libpciaccess" "libpciaccess0_0.16" $Destination
  if (-not $pciAccess -or -not (Test-Path -LiteralPath (Join-Path $Destination "libpciaccess.so.0"))) {
    throw "Runtime VA-API incomplet : libpciaccess.so.0 est absent."
  }

  # Un second pilote, plus ancien, livre a cote du premier.
  #
  # Celui de Jellyfin est apparie a sa libva et bien plus recent ; celui de bullseye est celui dont le
  # NAS de reference a prouve qu'il s'initialise, la ou le recent echoue avant d'ouvrir une session. Un
  # pilote recent suppose un noyau et un micrologiciel que tous les ADM n'ont pas.
  #
  # Les deux sont livres et sondes tour a tour au demarrage : c'est la machine qui tranche, pas une
  # supposition faite ici. libva sait charger un pilote plus ancien qu'elle, son ABI le prevoit.
  $ancien = Join-Path (Split-Path $Destination -Parent) "va-legacy"
  New-Item -ItemType Directory -Path $ancien -Force | Out-Null
  $debs = @()
  # `libigdgmm11` accompagne obligatoirement `intel-media-va-driver` 21 : le pilote la reclame
  # directement, et sans elle il ne se charge pas du tout. La version 12 que Jellyfin embarque ne
  # convient pas — le nom de la bibliotheque change avec la version majeure.
  foreach ($paquet in @(@{ d = "i/intel-media-driver"; p = "intel-media-va-driver_21." },
                        @{ d = "i/intel-gmmlib"; p = "libigdgmm11_" })) {
    $deb = Get-DebianLibrary $paquet.d $paquet.p $null
    if ($deb) { $debs += $deb }
  }
  if ($debs.Count -eq 2) {
    Invoke-Extracteur "extract-va-driver.py" (@($ancien) + $debs) "Extraction du pilote VA-API ancien impossible."
  } else {
    throw "Runtime VA-API incomplet : le pilote Intel de secours ou libigdgmm11 est absent."
  }
  foreach ($requis in @("iHD_drv_video.so", "libigdgmm.so.11")) {
    if (-not (Test-Path -LiteralPath (Join-Path $ancien $requis))) {
      throw "Runtime VA-API incomplet : $requis est absent du pilote de secours."
    }
  }
}


try {
  if (-not $SkipBuild) {
    Push-Location $BuildRoot
    $previousPnpmProduction = $env:PNPM_CONFIG_PRODUCTION
    try {
      $env:PNPM_CONFIG_PRODUCTION = "false"
      Invoke-PackageBuild (Join-Path $BuildRoot "packages\contracts") "Compilation des contrats impossible."
      Invoke-PackageBuild (Join-Path $BuildRoot "apps\web") "Compilation Web impossible."
      Invoke-PackageBuild (Join-Path $BuildRoot "apps\server") "Compilation serveur impossible."
    } finally {
      if ($null -eq $previousPnpmProduction) { Remove-Item Env:PNPM_CONFIG_PRODUCTION -ErrorAction SilentlyContinue }
      else { $env:PNPM_CONFIG_PRODUCTION = $previousPnpmProduction }
      Pop-Location
    }
  }
  foreach ($required in @("apps\server\dist\index.js", "apps\web\dist\index.html")) {
    if (-not (Test-Path -LiteralPath (Join-Path $BuildRoot $required))) { throw "Build précompilé absent : $required" }
  }

  Push-Location $BuildRoot
  try {
    Invoke-Pnpm --filter '@flixtunes/server' deploy --prod --legacy $deploy
    if ($LASTEXITCODE -ne 0) { throw "Déploiement des dépendances serveur impossible." }
  } finally { Pop-Location }
  # `pnpm deploy` recopie le repertoire du paquet **tel qu'il est sur le disque**, y compris ce que la
  # suite de tests y a laisse. Le paquet r77 embarquait ainsi `.vitest-data/provider-secrets.key` — la
  # cle qui dechiffre les jetons des fournisseurs — jusque sur le NAS, ou elle ne sert a rien. Le
  # `.dockerignore` ne couvre pas ce chemin-la : l'image Docker et ce paquet sont deux canaux
  # distincts, et c'est celui-ci qui est reellement installe.
  #
  # On elague, puis on **verifie** : un elagage muet redeviendrait faux au premier fichier d'un
  # nouveau genre. Mieux vaut refuser de construire que livrer une cle.
  foreach ($indesirable in @(".vitest-data", "TestResults", ".env")) {
    $chemin = Join-Path $deploy $indesirable
    if (Test-Path -LiteralPath $chemin) { Remove-Item -LiteralPath $chemin -Recurse -Force }
  }
  # La verification ne regarde pas `node_modules` : ce qu'une dependance embarque la regarde, et le
  # parcourir sur un partage reseau coute des dizaines de secondes pour rien. Ce qu'on cherche, ce
  # sont **nos** fichiers.
  $motifs = @("*.key", "*.db", "*.db-wal", "*.db-shm", ".env")
  $residus = Get-ChildItem -LiteralPath $deploy -Recurse -File -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notlike "*\node_modules\*" } |
    Where-Object { $nom = $_.Name; ($motifs | Where-Object { $nom -like $_ }).Count -gt 0 }
  if ($residus) {
    throw ("Donnees sensibles dans l'arborescence a empaqueter : " + (($residus | ForEach-Object { $_.FullName.Substring($deploy.Length) }) -join ", "))
  }

  $deployedContractsManifest = Join-Path $deploy "node_modules\@flixtunes\contracts\package.json"
  $deployedContractsBuild = Join-Path $deploy "node_modules\@flixtunes\contracts\dist\index.js"
  if (-not (Test-Path -LiteralPath $deployedContractsBuild)) { throw "Contrats JavaScript précompilés absents du déploiement." }
  $contractsManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $deployedContractsManifest | ConvertFrom-Json
  $contractsManifest.main = "./dist/index.js"
  $contractsManifest.types = "./dist/index.d.ts"
  Write-Utf8NoBom $deployedContractsManifest (($contractsManifest | ConvertTo-Json -Depth 8) + "`n")

  foreach ($architecture in $Architectures) {
    $layout = Join-Path $temporary "flixtunes-$architecture"
    $control = Join-Path $layout "CONTROL"
    $server = Join-Path $layout "app\apps\server"
    $web = Join-Path $layout "app\apps\web\dist"
    $install = Join-Path $layout "app\install"
    $runtime = Join-Path $layout "runtime\node"
    $ffmpegRuntime = Join-Path $layout "runtime\ffmpeg"
    New-Item -ItemType Directory -Path $control, $server, $web, $install -Force | Out-Null

    Copy-Item (Join-Path $PSScriptRoot "CONTROL\*") $control -Recurse -Force
    $configuration = Get-Content (Join-Path $control "config.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $configuration.general.version = $packageVersion
    $configuration.general.architecture = $architecture
    Write-Utf8NoBom (Join-Path $control "config.json") (($configuration | ConvertTo-Json -Depth 8) + "`n")
    New-AdmIcon (Join-Path $control "icon.png")

    Copy-Item (Join-Path $deploy "*") $server -Recurse -Force
    Copy-Item (Join-Path $BuildRoot "apps\web\dist\*") $web -Recurse -Force
    Copy-Item (Join-Path $SourceRoot "install\common\backup-sqlite.cjs") (Join-Path $install "backup-sqlite.cjs") -Force
    Get-NodeRuntime $architecture $runtime
    Get-FfmpegRuntime $architecture $ffmpegRuntime
    Get-VaapiRuntime $architecture (Join-Path $layout "runtime\va")
    Get-CaddyRuntime $architecture (Join-Path $layout "runtime\caddy")

    # Les bibliotheques que FFmpeg ouvre par `dlopen` ne figurent dans aucun `DT_NEEDED` : le controle
    # de dependances du pilote ne pouvait pas les voir, et le paquet est parti plusieurs revisions de
    # suite sans `libva-drm.so.2`, donc sans la moindre chance d'ouvrir /dev/dri/renderD128. Verifie
    # ici, sur ce qui va etre livre.
    if ($architecture -eq "x86-64") {
      $verificateur = (Get-Command python -ErrorAction SilentlyContinue).Source
      if (-not $verificateur) { $verificateur = (Get-Command python3 -ErrorAction SilentlyContinue).Source }
      & $verificateur (Join-Path $PSScriptRoot "verify-dlopen.py") `
        (Join-Path $ffmpegRuntime "bin") (Join-Path $layout "runtime\va")
      if ($LASTEXITCODE -ne 0) { throw "Paquet incomplet : l'acceleration materielle ne demarrerait pas." }
    }

    # Tout script qui lance le FFmpeg embarque doit lui dire ou trouver ses bibliotheques.
    #
    # La variante partagee ne les porte pas, et le chemin de recherche inscrit dans le binaire est
    # inutilisable : `DT_RPATH=-Wl:../lib`, ou l'option de liaison s'est retrouvee dans la valeur, et
    # dont la seule partie exploitable est relative au repertoire courant. `post-install.sh` lancait
    # `ffmpeg -decoders` sans poser `LD_LIBRARY_PATH` : le binaire ne demarrait pas, le script sortait
    # en erreur, et App Central laissait tourner sa barre de progression sans fin. Trois revisions ont
    # paru « ne jamais s'installer » pour cela seul.
    foreach ($script in Get-ChildItem $control -Filter "*.sh") {
      $texte = Get-Content $script.FullName -Raw
      if ($texte -match "runtime/ffmpeg/bin" -and $texte -notmatch "LD_LIBRARY_PATH") {
        throw "$($script.Name) lance le FFmpeg embarque sans poser LD_LIBRARY_PATH : il ne demarrera pas."
      }
    }

    $python = (Get-Command python -ErrorAction SilentlyContinue).Source
    if (-not $python) { $python = (Get-Command python3 -ErrorAction SilentlyContinue).Source }
    if (-not $python) { throw "Python 3 est requis pour construire le paquet APKG 2.0." }
    $localOutputDirectory = Join-Path $temporary "packages"
    New-Item -ItemType Directory -Path $localOutputDirectory -Force | Out-Null
    & $python (Join-Path $PSScriptRoot "Build-Apkg.py") create $layout --destination $localOutputDirectory
    if ($LASTEXITCODE -ne 0) { throw "Création du paquet APKG 2.0 impossible pour $architecture." }
    $localOutput = Join-Path $localOutputDirectory "flixtunes_${packageVersion}_${architecture}.apk"
    & $python (Join-Path $PSScriptRoot "Build-Apkg.py") verify $localOutput
    if ($LASTEXITCODE -ne 0) { throw "Validation du paquet APKG 2.0 impossible pour $architecture." }
    $output = Join-Path $OutputDirectory "flixtunes_${packageVersion}_${architecture}.apk"
    Copy-Item -LiteralPath $localOutput -Destination $output -Force
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $localOutput).Hash -ne (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash) {
      throw "Copie du paquet APKG corrompue pour $architecture."
    }
    Write-Host "Paquet ASUSTOR précompilé créé : $output" -ForegroundColor Green
  }
} finally {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
