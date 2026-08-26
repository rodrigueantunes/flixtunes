<#
.SYNOPSIS
  Construit l'APK Android.

.DESCRIPTION
  Enveloppe `gradlew` avec le réglage sans lequel Gradle ne démarre pas sur ce poste.

  Le symptôme est trompeur : « Unable to establish loopback connection », qui fait penser au réseau ou
  au pare-feu. Il n'en est rien. Depuis Java 17, le sélecteur NIO — qu'ouvrent aussi bien le lanceur
  Gradle que son démon — repose sur un tuyau bâti sur une **socket de domaine Unix**, créée dans le
  répertoire temporaire. Ce répertoire est annoncé ici sous sa forme courte 8.3
  (« C:\Users\ANTUNE~1\AppData\Local\Temp »), et `connect` sur un tel chemin échoue avec
  « Invalid argument ». Isolé en réduisant le cas à `Selector.open()` seul :
  `sun.nio.ch.UnixDomainSockets.connect0`.

  La correction porte sur l'environnement, pas sur Gradle. Passer la propriété Java par `GRADLE_OPTS`
  ne soigne que le lanceur ; la placer dans `gradle.properties` ne l'atteint même pas — le démon
  démarre sans elle, vérification faite dans son propre journal. `TEMP` et `TMP`, eux, sont hérités
  par tous les processus de la chaîne, démon compris, et c'est bien la racine du problème qu'ils
  déplacent : le répertoire lui-même.

.PARAMETER Task
  Tâches Gradle à exécuter. Par défaut la validation complète de l'étape : tests JVM, analyse
  statique, APK installable (signé par la clé de débogage) et APK de diffusion.
#>
param([string[]]$Task = @("testDebugUnitTest", "lintDebug", "assembleDebug", "assembleRelease"))

$ErrorActionPreference = "Continue"
$racine = $PSScriptRoot

# Un chemin ordinaire, sans forme 8.3 : c'est tout ce que réclame la socket.
$tmp = "C:\jvmtmp"
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$env:TEMP = $tmp
$env:TMP = $tmp

Write-Output "Construction : $($Task -join ' ')"
Push-Location $racine
try {
  & ".\gradlew.bat" @Task
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($code -ne 0) { Write-Output "Échec de la construction (code $code)."; exit $code }

$apks = @(Get-ChildItem (Join-Path $racine "app\build\outputs\apk") -Recurse -Filter "*.apk" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending)
if ($apks.Count -eq 0) { Write-Output "Construction réussie, mais aucun APK trouvé."; exit 1 }

Write-Output ""
foreach ($apk in $apks) {
  # « unsigned » dans le nom n'est pas un détail : un APK non signé ne s'installe pas. C'est celui de
  # débogage, signé par la clé locale, qu'on pose sur un appareil pour essayer.
  $signe = if ($apk.Name -match 'unsigned') { "NON SIGNÉ — ne s'installe pas" } else { "signé" }
  Write-Output "APK     : $($apk.FullName)"
  Write-Output "État    : $signe"
  Write-Output "Taille  : $([math]::Round($apk.Length / 1MB, 1)) Mio"
  Write-Output "SHA-256 : $((Get-FileHash $apk.FullName -Algorithm SHA256).Hash)"
  Write-Output ""
}
