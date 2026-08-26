<#
.SYNOPSIS
  Vérifie les types du code Kotlin sans passer par Gradle.

.DESCRIPTION
  Gradle est inutilisable dans certains environnements : son client parle à son démon par un sélecteur
  NIO, et sous Windows ce sélecteur crée une paire de sockets sur la boucle locale dont il vérifie
  l'identité. Quand cette vérification échoue, Gradle s'arrête sur « Unable to establish loopback
  connection » — avant même de lire le projet. Diagnostiqué précisément : `Selector.open()` échoue
  alors que les connexions locales ordinaires fonctionnent.

  Ce script contourne l'obstacle. Il n'assemble pas d'APK — ni ressources, ni dexing, ni signature —
  mais il fait passer **tout le code Kotlin par le compilateur**, ce qui attrape la grande majorité
  des fautes : syntaxe, types, API mal employée, référence manquante. C'est la différence entre écrire
  du Kotlin à l'aveugle et écrire du Kotlin vérifié.

  Les dépendances viennent du cache Gradle : les `.jar` directement, et les `.aar` — format des
  bibliothèques Android — dont le `classes.jar` interne est extrait une fois puis réutilisé.

.PARAMETER Refresh
  Reconstruit le cache des dépendances extraites. Utile après l'ajout d'une bibliothèque.
#>
param([switch]$Refresh)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$racine = $PSScriptRoot
$travail = Join-Path $env:TEMP "flixtunes-kotlin-typecheck"
$classes = Join-Path $travail "aar-classes"
$sortie = Join-Path $travail "out"
New-Item -ItemType Directory -Path $travail, $classes, $sortie -Force | Out-Null

$kotlinc = Get-ChildItem $travail -Recurse -Filter "kotlinc.bat" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $kotlinc) {
  # La distribution officielle est autonome : le compilateur « embeddable » du cache Gradle réclame
  # ses dépendances une à une, ce qui n'en finit pas.
  $version = "2.3.21"
  $zip = Join-Path $travail "kotlin-compiler.zip"
  if (-not (Test-Path $zip)) {
    Write-Output "Téléchargement du compilateur Kotlin $version…"
    Invoke-WebRequest -UseBasicParsing `
      "https://github.com/JetBrains/kotlin/releases/download/v$version/kotlin-compiler-$version.zip" -OutFile $zip
  }
  Expand-Archive -Path $zip -DestinationPath (Join-Path $travail "kotlinc") -Force
  $kotlinc = Get-ChildItem $travail -Recurse -Filter "kotlinc.bat" | Select-Object -First 1
}

if ($Refresh) { Remove-Item "$classes\*" -Force -ErrorAction SilentlyContinue }
if (-not (Get-ChildItem $classes -Filter *.jar -ErrorAction SilentlyContinue)) {
  Write-Output "Extraction des dépendances Android…"
  Get-ChildItem "$env:USERPROFILE\.gradle\caches" -Recurse -Filter "*.aar" -ErrorAction SilentlyContinue | ForEach-Object {
    $cible = Join-Path $classes ($_.BaseName + "-" + $_.Directory.Name.Substring(0, 6) + ".jar")
    if (Test-Path $cible) { return }
    try {
      $archive = [System.IO.Compression.ZipFile]::OpenRead($_.FullName)
      $entree = $archive.Entries | Where-Object { $_.FullName -eq "classes.jar" } | Select-Object -First 1
      if ($entree) { [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entree, $cible, $true) }
      $archive.Dispose()
    } catch { }
  }
}

$androidJar = Get-ChildItem "$env:LOCALAPPDATA\Android\Sdk\platforms" -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName "android.jar" } |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $androidJar) { throw "android.jar introuvable : installez une plateforme du SDK Android." }

# `R.jar` porte les identifiants de ressources fabriqués par aapt pendant le build : sans lui, tout
# `R.raw.…` du code reste introuvable. Celui du dernier build suffit — ces identifiants ne changent
# qu'à l'ajout d'une ressource.
$rJar = Get-ChildItem (Join-Path $racine "app\build") -Recurse -Filter "R.jar" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName

$dependances = @($rJar, $androidJar) | Where-Object { $_ }
$dependances += (Get-ChildItem $classes -Filter *.jar | ForEach-Object { $_.FullName })
$dependances += (Get-ChildItem "$env:USERPROFILE\.gradle\caches" -Recurse -Filter "*.jar" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notmatch 'sources|javadoc' } | ForEach-Object { $_.FullName })

# La ligne de commande Windows est bornée : le classpath passe par un fichier d'arguments.
$argfile = Join-Path $travail "args.txt"
$sources = Get-ChildItem (Join-Path $racine "app\src\main") -Recurse -Filter *.kt | ForEach-Object { '"' + $_.FullName.Replace('\', '/') + '"' }
$contenu = '-classpath "' + (($dependances | Select-Object -Unique) -join ';').Replace('\', '/') + '"' + "`n" + ($sources -join "`n")
[IO.File]::WriteAllText($argfile, $contenu, [Text.UTF8Encoding]::new($false))

Write-Output "Vérification de $($sources.Count) fichiers Kotlin…"
# Le compilateur écrit ses diagnostics sur la sortie d'erreur. Windows PowerShell 5.1 emballe chaque
# ligne d'un programme externe dans un enregistrement d'erreur : avec la préférence « Stop », la
# première ligne de diagnostic ferait échouer le script avant qu'on ait pu la lire.
$ancienne = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$journal = & $kotlinc.FullName -nowarn -d $sortie "@$argfile" 2>&1 | ForEach-Object { $_.ToString() }
$ErrorActionPreference = $ancienne
# Forme exacte d'un diagnostic : « chemin.kt:ligne:colonne: error: … ». S'en tenir au mot « error »
# ferait passer pour une faute de code le message d'échec du générateur de bytecode, qui contient
# « Internal error ».
$diagnostics = @($journal | Where-Object { $_ -match '\.kt:\d+:\d+: (error|warning):' })
$diagnostics | ForEach-Object { Write-Output $_ }

# Le compilateur travaille en deux temps : il analyse d'abord — c'est ce qu'on vient vérifier — puis
# produit du bytecode. La distribution autonome ne porte pas le greffon Compose, et la production
# échoue donc sur les fonctions `@Composable`. Cet échec-là n'apprend rien sur la justesse du code :
# seules comptent les lignes `error:`, toutes émises pendant l'analyse.
$codegenCompose = $journal -match 'Exception while generating code'
if ($diagnostics.Count -gt 0) { Write-Output "`nErreurs de compilation ci-dessus."; exit 1 }

# Les ressources, ensuite. Le compilateur Kotlin ne les voit pas, et `generateDebugRFile` les lit avec
# un analyseur plus permissif que celui du build : une apostrophe ASCII nue dans un `<string>` passe
# les deux, puis fait échouer `mergeDebugResources` — c'est-à-dire l'assemblage de l'APK, dix minutes
# plus loin. C'est arrivé : la migration des textes vers `strings.xml` a laissé deux chaînes fautives,
# invisibles jusqu'au premier assemblage suivant. aapt2 rend le verdict en une seconde, autant le lui
# demander ici.
$aapt2 = Get-ChildItem (Join-Path $env:LOCALAPPDATA "Android\Sdk\build-tools") -Filter "aapt2.exe" -Recurse -ErrorAction SilentlyContinue |
  Sort-Object FullName | Select-Object -Last 1
if (-not $aapt2) { Write-Output "aapt2 introuvable : ressources non vérifiées." }
else {
  # aapt2 refuse un chemin UNC en entrée comme en sortie : les ressources sont recopiées en local le
  # temps de la vérification.
  $bac = Join-Path ([IO.Path]::GetTempPath()) "flixtunes-res"
  if (Test-Path $bac) { Remove-Item $bac -Recurse -Force }
  New-Item -ItemType Directory -Path $bac -Force | Out-Null
  Copy-Item (Join-Path $PSScriptRoot "app\src\main\res\*") $bac -Recurse -Force
  $ErrorActionPreference = "Continue"
  $sortieRes = & $aapt2.FullName compile --dir $bac -o (Join-Path $bac "res.zip") 2>&1 | ForEach-Object { $_.ToString() }
  $codeRes = $LASTEXITCODE
  $ErrorActionPreference = $ancienne
  $fautes = @($sortieRes | Where-Object { $_ -match 'error:' })
  if ($fautes.Count -gt 0 -or $codeRes -ne 0) {
    $fautes | ForEach-Object { Write-Output $_ }
    Write-Output "`nRessources refusées par aapt2 : l'APK ne s'assemblera pas."
    exit 1
  }
  Write-Output "Ressources vérifiées par aapt2 : aucune erreur."
}
if ($codegenCompose) { Write-Output "Types vérifiés : aucune erreur (bytecode Compose non produit, sans objet ici)." }
else { Write-Output "Types vérifiés : aucune erreur." }
# Le code de sortie du compilateur vaut 2 lorsque la production de bytecode a échoué. Le laisser
# remonter ferait échouer un script qui vient d'annoncer le succès.
exit 0
