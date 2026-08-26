[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Source,
  [string]$InstallRoot = (Join-Path $env:ProgramData "FlixTunes Server"),
  [switch]$NoStart
)

$installer = Join-Path $PSScriptRoot "Install-FlixTunesServer.ps1"
if (-not (Test-Path -LiteralPath (Join-Path $InstallRoot "state.json"))) {
  throw "Aucune installation FlixTunes existante n'a été trouvée dans $InstallRoot."
}
$state = Get-Content (Join-Path $InstallRoot "state.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$configuredPort = if ($null -ne $state.port) { [int]$state.port } else { 4000 }
& $installer -Source $Source -InstallRoot $InstallRoot -DataRoot $state.dataRoot -Port $configuredPort -NoStart:$NoStart
exit $LASTEXITCODE
