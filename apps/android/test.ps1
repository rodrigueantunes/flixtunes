<#
.SYNOPSIS
  Exécute les tests JVM Android sans passer par Gradle.

.DESCRIPTION
  Même obstacle que `typecheck.ps1` : le client Gradle n'atteint pas son démon parce que
  `Selector.open()` échoue sous Windows sur cette machine. Le code Kotlin reste compilable et les
  tests restent exécutables — il suffit de les lancer soi-même.

  Ce script compile `app/src/main` et `app/src/test`, puis passe les classes de test à JUnit. Il ne
  remplace pas les tests instrumentés, qui demandent un appareil : ce qui touche à `Context`, à
  `MediaCodecList` ou à l'affichage n'est pas couvert ici. Ce qui est arithmétique ou textuel l'est
  entièrement, et c'est là que se logent les fautes de raisonnement.

  `android.jar` du SDK n'est qu'une façade : chacune de ses méthodes lève « not mocked ». Les tests
  qui parsent du JSON fonctionnent quand même, à condition de placer la vraie implémentation
  `org.json` **avant** la façade sur le classpath — même ordre que celui déclaré dans `build.gradle.kts`.

.PARAMETER Filter
  Ne lance que les classes de test dont le nom contient ce fragment.
#>
param([string]$Filter = "")

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$racine = $PSScriptRoot
$travail = Join-Path $env:TEMP "flixtunes-kotlin-typecheck"   # cache partagé avec typecheck.ps1
$classes = Join-Path $travail "aar-classes"
$sortie = Join-Path $travail "test-out"
New-Item -ItemType Directory -Path $sortie -Force | Out-Null

$kotlinc = Get-ChildItem $travail -Recurse -Filter "kotlinc.bat" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $kotlinc) { throw "Compilateur Kotlin absent : lancez d'abord .\typecheck.ps1" }
$java = Join-Path (Split-Path (Split-Path $kotlinc.FullName)) "..\jre\bin\java.exe"
if (-not (Test-Path $java)) { $java = (Get-Command java -ErrorAction SilentlyContinue).Source }
if (-not $java) { throw "Java introuvable." }

$cache = Join-Path $env:USERPROFILE ".gradle\caches"
function Jar([string]$motif) {
  Get-ChildItem $cache -Recurse -Filter $motif -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -notmatch 'sources|javadoc' } | Select-Object -First 1 -ExpandProperty FullName
}
$junit = Jar "junit-4.13.2.jar"; $hamcrest = Jar "hamcrest-core-1.3.jar"; $json = Jar "json-20240303.jar"
if (-not $junit) { throw "junit-4.13.2.jar absent du cache Gradle." }

$androidJar = Get-ChildItem "$env:LOCALAPPDATA\Android\Sdk\platforms" -Directory -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName "android.jar" } |
  Where-Object { Test-Path $_ } | Select-Object -First 1

# `R.jar` porte les identifiants de ressources, qu'aapt fabrique pendant le build. Sans lui, tout
# `R.raw.…` du code reste introuvable. Celui du dernier build suffit : ces identifiants ne changent
# qu'à l'ajout d'une ressource.
$rJar = Get-ChildItem (Join-Path $racine "app\build") -Recurse -Filter "R.jar" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName

# `org.json` d'abord, la façade `android.jar` ensuite : l'inverse ferait lever « not mocked ».
$dependances = @($json, $junit, $hamcrest, $rJar, $androidJar) | Where-Object { $_ }
$dependances += (Get-ChildItem $classes -Filter *.jar -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
$dependances += (Get-ChildItem $cache -Recurse -Filter "*.jar" -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notmatch 'sources|javadoc' } | ForEach-Object { $_.FullName })
$classpath = (($dependances | Select-Object -Unique) -join ';')

# Les fichiers Compose sont écartés. Le compilateur les *vérifie* correctement, mais ne sait pas en
# produire du bytecode sans son extension dédiée. Aucune perte pour ces tests — une fonction Compose se
# juge à l'écran, par instrumentation, pas sur la JVM. `typecheck.ps1` couvre ces fichiers de son côté.
#
# Le critère vise ce que le greffon doit réécrire : l'annotation `@Composable`, mais aussi
# `Modifier.composed { … }`, qui appelle des fonctions composables sans qu'aucune annotation
# n'apparaisse dans le fichier. Chercher la seule annotation laissait passer ce second cas — la
# compilation échouait, et JUnit exécutait les classes du passage précédent.
#
# Écarter plus large, sur le simple import d'`androidx.compose`, retirait au passage `MainViewModel`,
# qui emploie l'état Compose sans réclamer le greffon — et privait de compilation les tests qui en
# dépendent.
#
# Troisième cas : `setContent { … }`. Le bloc qu'on lui passe est composable, et une activité qui en
# ouvre un réclame le greffon sans porter d'annotation ni de `composed`. C'est le cas de
# `PlayerActivity` depuis qu'elle installe ses propres commandes. `typecheck.ps1` et le build Gradle
# la vérifient tous les deux ; ce harnais-ci n'y perd rien, une activité ne se teste pas sur la JVM.
$argfile = Join-Path $travail "test-args.txt"
$sources = Get-ChildItem (Join-Path $racine "app\src\main"), (Join-Path $racine "app\src\test") -Recurse -Filter *.kt |
  Where-Object { (Get-Content $_.FullName -Raw) -notmatch '@Composable|composed\s*[\({]|setContent\s*[\({]' } |
  ForEach-Object { '"' + $_.FullName.Replace('\', '/') + '"' }
[IO.File]::WriteAllText($argfile,
  '-classpath "' + $classpath.Replace('\', '/') + '"' + "`n" + ($sources -join "`n"), [Text.UTF8Encoding]::new($false))

Write-Output "Compilation de $($sources.Count) fichiers…"
# Le répertoire de sortie est vidé à chaque fois.
#
# Sans cela, une compilation qui échoue laisse en place les classes du passage précédent, et JUnit les
# exécute en annonçant « OK ». Constaté : un fichier de test dont deux cas venaient d'être ajoutés
# rendait toujours l'ancien décompte, sans le moindre signe d'erreur. Un test vert qui n'a pas
# compilé le code qu'on croit vérifier est pire que pas de test du tout.
Remove-Item "$sortie\*" -Recurse -Force -ErrorAction SilentlyContinue

# Voir `typecheck.ps1` : sous PowerShell 5.1, la sortie d'erreur d'un programme externe devient une
# erreur du script, ce qui interromprait la compilation dès le premier diagnostic.
$ancienne = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $kotlinc.FullName -nowarn -d $sortie "@$argfile" 2>&1 |
  ForEach-Object { $_.ToString() } | Where-Object { $_ -match '\.kt:\d+:\d+: error:' } | ForEach-Object { Write-Output $_ }
$codeCompilation = $LASTEXITCODE
$ErrorActionPreference = $ancienne
if ($codeCompilation -ne 0) { throw "La compilation a échoué (code $codeCompilation) : aucun test n'a été exécuté." }

# `$env:TEMP` s'écrit en nom court 8.3 (« ANTUNE~1 ») là où `Get-ChildItem` rend le nom long : sans
# cette résolution, le préfixe retiré n'a pas la bonne longueur et les classes sortent tronquées.
$racineClasses = (Get-Item $sortie).FullName.TrimEnd('\')
# `@(…)` est indispensable : sur une seule classe retenue, le résultat serait une chaîne, et l'étaler
# avec `@` passerait à la JVM chacune de ses lettres comme un argument distinct.
$testClasses = @(Get-ChildItem $sortie -Recurse -Filter "*Test.class" | ForEach-Object {
  $_.FullName.Substring($racineClasses.Length + 1) -replace '\\', '.' -replace '\.class$', ''
} | Where-Object { $_ -notmatch '\$' } | Where-Object { -not $Filter -or $_ -like "*$Filter*" } | Sort-Object)
if (-not $testClasses) { throw "Aucune classe de test compilée : la compilation a échoué." }

Write-Output "Exécution de $($testClasses.Count) classes de test…`n"
$stdlib = Get-ChildItem (Split-Path (Split-Path $kotlinc.FullName)) -Filter "kotlin-stdlib.jar" -Recurse |
  Select-Object -First 1 -ExpandProperty FullName

# Le classpath dépasse largement la limite d'une ligne de commande Windows : la JVM accepte un fichier
# d'arguments, où les chemins s'écrivent en barres obliques pour ne pas être pris pour des échappements.
$javaArgs = Join-Path $travail "java-args.txt"
$complet = (@($sortie, $stdlib) + ($classpath -split ';')) -ne '' | Select-Object -Unique
[IO.File]::WriteAllText($javaArgs,
  '-cp "' + (($complet -join ';').Replace('\', '/')) + '"', [Text.UTF8Encoding]::new($false))

& $java "@$javaArgs" org.junit.runner.JUnitCore @testClasses
$code = $LASTEXITCODE
if ($null -eq $code) { throw "La JVM n'a pas démarré : aucun résultat de test." }
exit $code
