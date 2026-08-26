[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$Source = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
  [string]$InstallRoot = (Join-Path $env:ProgramData "FlixTunes Server"),
  [string]$DataRoot = (Join-Path $env:ProgramData "FlixTunes Server\data"),
  [ValidateRange(1, 65535)][int]$Port = 4000,
  [switch]$NoPrerequisites,
  [PSCredential]$ServiceCredential,
  [switch]$NoService,
  [switch]$NoStart,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$TaskName = "FlixTunes Server"
$MinimumNodeMajor = 24
$PnpmVersion = "11.16.0"

function Write-Step([string]$Message) { Write-Host "[FlixTunes] $Message" -ForegroundColor Cyan }

function Invoke-Checked([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory = (Get-Location).Path) {
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) { throw "La commande '$FilePath $($Arguments -join ' ')' a échoué avec le code $LASTEXITCODE." }
}

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  return ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Ensure-Prerequisites {
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  $nodeMajor = if ($node) { [int]((& $node.Source --version).TrimStart("v").Split(".")[0]) } else { 0 }
  $ffmpeg = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
  $ffprobe = Get-Command ffprobe.exe -ErrorAction SilentlyContinue

  if (($nodeMajor -lt $MinimumNodeMajor -or -not $ffmpeg -or -not $ffprobe) -and -not $NoPrerequisites) {
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) { throw "Node.js 24+ et FFmpeg sont requis. Winget est absent : installez-les puis relancez le script." }
    if ($nodeMajor -lt $MinimumNodeMajor) {
      Write-Step "Installation de Node.js 24"
      Invoke-Checked $winget.Source @("install", "--id", "OpenJS.NodeJS.LTS", "--exact", "--accept-package-agreements", "--accept-source-agreements", "--silent")
    }
    if (-not $ffmpeg -or -not $ffprobe) {
      Write-Step "Installation de FFmpeg"
      Invoke-Checked $winget.Source @("install", "--id", "Gyan.FFmpeg", "--exact", "--accept-package-agreements", "--accept-source-agreements", "--silent")
    }
    Refresh-Path
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    $ffmpeg = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    $ffprobe = Get-Command ffprobe.exe -ErrorAction SilentlyContinue
    $nodeMajor = if ($node) { [int]((& $node.Source --version).TrimStart("v").Split(".")[0]) } else { 0 }
  }
  if ($nodeMajor -lt $MinimumNodeMajor) { throw "Node.js $MinimumNodeMajor ou supérieur est requis." }
  if (-not $ffmpeg -or -not $ffprobe) { throw "FFmpeg et FFprobe doivent être accessibles dans PATH." }
  return @{ Node = $node.Source; Ffmpeg = $ffmpeg.Source; Ffprobe = $ffprobe.Source }
}

function Resolve-Source([string]$InputSource) {
  $downloadDirectory = $null
  if ($InputSource -match '^https?://') {
    $downloadDirectory = Join-Path ([IO.Path]::GetTempPath()) "flixtunes-download-$([guid]::NewGuid())"
    New-Item -ItemType Directory -Path $downloadDirectory | Out-Null
    $download = Join-Path $downloadDirectory "flixtunes.zip"
    Write-Step "Téléchargement de la distribution"
    Invoke-WebRequest -Uri $InputSource -OutFile $download -UseBasicParsing
    $InputSource = $download
  }
  $resolved = (Resolve-Path -LiteralPath $InputSource).Path
  if (Test-Path -LiteralPath $resolved -PathType Leaf) {
    if ([IO.Path]::GetExtension($resolved) -ne ".zip") { throw "La source doit être un dossier ou une archive ZIP FlixTunes." }
    $temporary = Join-Path ([IO.Path]::GetTempPath()) "flixtunes-source-$([guid]::NewGuid())"
    Expand-Archive -LiteralPath $resolved -DestinationPath $temporary
    $package = Get-ChildItem -LiteralPath $temporary -Filter package.json -Recurse | Where-Object { $_.Directory.GetDirectories("apps").Count -gt 0 } | Select-Object -First 1
    if (-not $package) { throw "L'archive ne contient pas une distribution serveur FlixTunes valide." }
    return @{ Root = $package.Directory.FullName; Temporary = $temporary; Download = $downloadDirectory }
  }
  if (-not (Test-Path (Join-Path $resolved "apps\server\package.json"))) { throw "Le dossier source FlixTunes est invalide." }
  return @{ Root = $resolved; Temporary = $null; Download = $downloadDirectory }
}

function Copy-Tree([string]$From, [string]$To, [string[]]$ExcludedDirectories = @()) {
  New-Item -ItemType Directory -Path $To -Force | Out-Null
  $arguments = @($From, $To, "/MIR", "/R:2", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
  if ($ExcludedDirectories.Count) { $arguments += "/XD"; $arguments += $ExcludedDirectories }
  & robocopy.exe @arguments | Out-Null
  if ($LASTEXITCODE -gt 7) { throw "La copie de $From vers $To a échoué avec le code $LASTEXITCODE." }
}

function Write-Configuration([string]$ConfigPath, [hashtable]$Prerequisites) {
  if (Test-Path -LiteralPath $ConfigPath) { return }
  $escapedData = $DataRoot.Replace("\", "\\")
  @(
    "NODE_ENV=production",
    "HOST=0.0.0.0",
    "PORT=$Port",
    "FLIXTUNES_DATA_DIR=$escapedData",
    "FFMPEG_PATH=$($Prerequisites.Ffmpeg.Replace('\', '\\'))",
    "FFPROBE_PATH=$($Prerequisites.Ffprobe.Replace('\', '\\'))",
    "FLIXTUNES_HW_ACCEL=auto",
    "FLIXTUNES_WATCH=1",
    "FLIXTUNES_MDNS=1"
  ) | Set-Content -LiteralPath $ConfigPath -Encoding utf8
}

function Backup-Database([string]$NodePath, [string]$ReleasePath) {
  $database = Join-Path $DataRoot "flixtunes.db"
  if (-not (Test-Path -LiteralPath $database)) { return $null }
  $backupDirectory = Join-Path $DataRoot "backups"
  New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
  $backup = Join-Path $backupDirectory "pre-update-$((Get-Date).ToString('yyyyMMdd-HHmmss')).db"
  Invoke-Checked $NodePath @((Join-Path $ReleasePath "install\common\backup-sqlite.cjs"), $database, $backup)
  return $backup
}

function Restore-Database([string]$Backup) {
  if (-not $Backup -or -not (Test-Path -LiteralPath $Backup)) { return }
  $database = Join-Path $DataRoot "flixtunes.db"
  Copy-Item -LiteralPath $Backup -Destination $database -Force
  Remove-Item -LiteralPath "$database-wal", "$database-shm" -Force -ErrorAction SilentlyContinue
}

function Set-CurrentRelease([string]$ReleasePath) {
  $current = Join-Path $InstallRoot "current"
  $next = Join-Path $InstallRoot "current-next"
  if (Test-Path -LiteralPath $next) { cmd.exe /d /c rmdir "$next" | Out-Null }
  New-Item -ItemType Junction -Path $next -Target $ReleasePath | Out-Null
  if (Test-Path -LiteralPath $current) { cmd.exe /d /c rmdir "$current" | Out-Null }
  Move-Item -LiteralPath $next -Destination $current
}

function Write-Launcher([string]$NodePath) {
  $launcher = @'
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Get-Content (Join-Path $root "config\flixtunes.env") -Encoding UTF8 | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
    $parts = $line.Split("=", 2)
    [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim().Replace("\\", "\"), "Process")
  }
}
$current = Join-Path $root "current"
Set-Location $current
& "__NODE__" "apps/server/dist/index.js"
exit $LASTEXITCODE
'@
  $launcher.Replace("__NODE__", $NodePath.Replace("`"", "`"`"")) | Set-Content -LiteralPath (Join-Path $InstallRoot "bin\Launch-FlixTunes.ps1") -Encoding utf8
}

function Register-FlixTunesTask {
  if (-not (Test-Administrator)) { throw "Exécutez PowerShell en administrateur pour installer le démarrage automatique." }
  $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-NetFirewallRule -DisplayName $TaskName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  New-NetFirewallRule -DisplayName $TaskName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Private | Out-Null
  if ($existingTask) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    return
  }
  $launcher = Join-Path $InstallRoot "bin\Launch-FlixTunes.ps1"
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$launcher`""
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
  if ($ServiceCredential) {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -User $ServiceCredential.UserName -Password $ServiceCredential.GetNetworkCredential().Password -RunLevel Highest -Force | Out-Null
  } else {
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  }
}

function Wait-ForHealth([int]$ExpectedPort, [int]$TimeoutSeconds = 45) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:$ExpectedPort/api/health" -TimeoutSec 2
      if ($health.status -eq "ok") { return $true }
    } catch { Start-Sleep -Milliseconds 750 }
  }
  return $false
}

$sourceInfo = $null
try {
  Write-Step "Vérification des prérequis"
  $prerequisites = Ensure-Prerequisites
  $sourceInfo = Resolve-Source $Source
  $sourceRoot = $sourceInfo.Root
  $version = (Get-Content (Join-Path $sourceRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
  $releaseId = "$version-$((Get-Date).ToString('yyyyMMddHHmmss'))"
  $releasePath = Join-Path $InstallRoot "releases\$releaseId"
  $statePath = Join-Path $InstallRoot "state.json"
  $previousRelease = if (Test-Path $statePath) { (Get-Content $statePath -Raw | ConvertFrom-Json).currentRelease } else { $null }

  New-Item -ItemType Directory -Path $releasePath, $DataRoot, (Join-Path $InstallRoot "config"), (Join-Path $InstallRoot "bin") -Force | Out-Null
  Write-Step "Préparation de FlixTunes $version"
  Copy-Tree (Join-Path $sourceRoot "apps\server") (Join-Path $releasePath "apps\server") @("node_modules", "dist")
  Copy-Tree (Join-Path $sourceRoot "apps\web") (Join-Path $releasePath "apps\web") @("node_modules", "dist")
  Copy-Tree (Join-Path $sourceRoot "packages\contracts") (Join-Path $releasePath "packages\contracts") @("node_modules", "dist")
  Copy-Tree (Join-Path $sourceRoot "install") (Join-Path $releasePath "install")
  foreach ($file in @("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json")) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $file) -Destination (Join-Path $releasePath $file) -Force
  }

  $pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if (-not $pnpm) {
    $npm = Get-Command npm.cmd -ErrorAction Stop
    $pnpmRoot = Join-Path $InstallRoot "runtime\pnpm"
    Invoke-Checked $npm.Source @("install", "--silent", "--no-audit", "--no-fund", "--prefix", $pnpmRoot, "pnpm@$PnpmVersion") $releasePath
    $pnpm = Get-Item (Join-Path $pnpmRoot "node_modules\.bin\pnpm.cmd")
  }
  Write-Step "Installation des dépendances et compilation"
  Push-Location $releasePath
  try {
    Invoke-Checked $pnpm.Source @("install", "--frozen-lockfile") $releasePath
    Invoke-Checked $pnpm.Source @("--filter", "@flixtunes/contracts", "build") $releasePath
    Invoke-Checked $pnpm.Source @("--filter", "@flixtunes/web", "build") $releasePath
    Invoke-Checked $pnpm.Source @("--filter", "@flixtunes/server", "build") $releasePath
  } finally { Pop-Location }
  if (-not (Test-Path (Join-Path $releasePath "apps\server\dist\index.js")) -or -not (Test-Path (Join-Path $releasePath "apps\web\dist\index.html"))) {
    throw "La compilation serveur est incomplète."
  }

  $configPath = Join-Path $InstallRoot "config\flixtunes.env"
  Write-Configuration $configPath $prerequisites
  Write-Launcher $prerequisites.Node
  if (-not $NoService) {
    Register-FlixTunesTask
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }
  $backup = Backup-Database $prerequisites.Node $releasePath
  Set-CurrentRelease $releasePath
  @{ version = $version; currentRelease = $releasePath; previousRelease = $previousRelease; dataRoot = $DataRoot; port = $Port; backup = $backup; installedAt = (Get-Date).ToString("o") } |
    ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8

  if (-not $NoService -and -not $NoStart) {
    Start-ScheduledTask -TaskName $TaskName
    if (-not (Wait-ForHealth $Port)) {
      Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
      if ($previousRelease -and (Test-Path -LiteralPath $previousRelease)) {
        Restore-Database $backup
        Set-CurrentRelease $previousRelease
        Start-ScheduledTask -TaskName $TaskName
      }
      throw "La nouvelle version ne répond pas. Retour automatique vers la version précédente effectué."
    }
  }
  Write-Host "FlixTunes Server $version est installé. Données conservées dans $DataRoot" -ForegroundColor Green
  if (-not $NoStart) { Write-Host "Interface : http://localhost:$Port" -ForegroundColor Green }
} finally {
  if ($sourceInfo -and $sourceInfo.Temporary -and (Test-Path -LiteralPath $sourceInfo.Temporary)) {
    Remove-Item -LiteralPath $sourceInfo.Temporary -Recurse -Force
  }
  if ($sourceInfo -and $sourceInfo.Download -and (Test-Path -LiteralPath $sourceInfo.Download)) {
    Remove-Item -LiteralPath $sourceInfo.Download -Recurse -Force
  }
}
