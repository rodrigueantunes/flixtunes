[CmdletBinding()]
param([switch]$BuildAsustor)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$failures = [Collections.Generic.List[string]]::new()

foreach ($file in Get-ChildItem (Join-Path $root "install"), (Join-Path $root "packaging") -Recurse -Filter *.ps1) {
  $tokens = $null; $errors = $null
  [Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors) | Out-Null
  foreach ($error in $errors) { $failures.Add("$($file.Name): $($error.Message)") }
}

$bash = @((Get-Command bash -ErrorAction SilentlyContinue).Source, "C:\Program Files\Git\bin\bash.exe", "/bin/bash") | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if ($bash) {
  foreach ($file in Get-ChildItem (Join-Path $root "install"), (Join-Path $root "packaging\asustor\CONTROL") -Recurse -Filter *.sh) {
    $shellPath = $file.FullName
    if ($shellPath -match '^([A-Za-z]):(.*)$') { $shellPath = "/$($matches[1].ToLowerInvariant())$($matches[2].Replace('\', '/'))" }
    & $bash -n $shellPath
    if ($LASTEXITCODE -ne 0) { $failures.Add("Syntaxe shell invalide : $($file.FullName)") }
    $bytes = [IO.File]::ReadAllBytes($file.FullName)
    for ($index = 0; $index -lt $bytes.Length; $index++) {
      if ($bytes[$index] -eq 13) { $failures.Add("Fin de ligne CRLF interdite pour $($file.FullName)"); break }
    }
  }
}

$configuration = Get-Content (Join-Path $root "packaging\asustor\CONTROL\config.json") -Raw -Encoding UTF8 | ConvertFrom-Json
if ($configuration.general.package -ne "flixtunes") { $failures.Add("Identifiant APKG incorrect") }
$shortcut = $configuration.'adm-desktop'.app
if ($shortcut.type -ne "custom" -or $shortcut.protocol -ne "http" -or $shortcut.port -ne 4000 -or $shortcut.url -ne "/") {
  $failures.Add("Le raccourci ADM doit ouvrir http://<adresse-du-NAS>:4000/")
}
if ($configuration.general.firmware -notmatch '^\d+\.\d+\.\d+$') { $failures.Add("Version ADM minimale invalide") }
$configBytes = [IO.File]::ReadAllBytes((Join-Path $root "packaging\asustor\CONTROL\config.json"))
if ($configBytes.Length -ge 3 -and $configBytes[0] -eq 0xEF -and $configBytes[1] -eq 0xBB -and $configBytes[2] -eq 0xBF) { $failures.Add("BOM UTF-8 interdit dans config.json") }
foreach ($required in @("start-stop.sh", "post-install.sh", "pre-uninstall.sh")) {
  if (-not (Test-Path (Join-Path $root "packaging\asustor\CONTROL\$required"))) { $failures.Add("Contrôle APKG absent : $required") }
}
$postInstall = Get-Content (Join-Path $root "packaging\asustor\CONTROL\post-install.sh") -Raw -Encoding UTF8
foreach ($forbidden in @("pnpm", "npm install", "install-flixtunes.sh", "opkg update")) {
  if ($postInstall -match [regex]::Escape($forbidden)) { $failures.Add("Installation ASUSTOR lente interdite dans post-install.sh : $forbidden") }
}
if (-not (Test-Path (Join-Path $root "install\common\backup-sqlite.cjs"))) { $failures.Add("Outil de sauvegarde SQLite absent") }

if ($BuildAsustor -and $failures.Count -eq 0) {
  & (Join-Path $root "packaging\asustor\Build-AsustorApkg.ps1") -SourceRoot $root -OutputDirectory (Join-Path $root "artifacts")
  if ($LASTEXITCODE -ne 0) { $failures.Add("Construction APKG échouée") }
  foreach ($architecture in @("x86-64", "arm64")) {
    $package = Join-Path $root "artifacts\flixtunes_$($configuration.general.version)_${architecture}.apk"
    if (-not (Test-Path -LiteralPath $package)) { $failures.Add("Artefact APKG $architecture absent"); continue }
    if ((Get-Command python -ErrorAction SilentlyContinue) -or (Get-Command python3 -ErrorAction SilentlyContinue)) {
    $python = (Get-Command python -ErrorAction SilentlyContinue).Source
    if (-not $python) { $python = (Get-Command python3 -ErrorAction SilentlyContinue).Source }
    & $python (Join-Path $root "packaging\asustor\Build-Apkg.py") verify $package
    if ($LASTEXITCODE -ne 0) { $failures.Add("Validation structurelle APKG échouée") }
    }
  }
}

if ($failures.Count) {
  $failures | ForEach-Object { Write-Error $_ }
  exit 1
}
Write-Host "Installateurs Windows/Linux/NAS et structure ASUSTOR : validation réussie." -ForegroundColor Green
