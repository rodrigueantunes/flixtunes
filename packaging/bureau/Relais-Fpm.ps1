<#
.SYNOPSIS
  Fabrique un relais `fpm.exe` qui transmet ses arguments intacts.

.DESCRIPTION
  electron-builder construit la description d'un paquet Debian avec un saut de ligne en dur —
  `${synopsis}\n ${description}`, dans `FpmTarget.js`. RubyGems, lui, installe `fpm` sous Windows
  comme un **fichier de commandes**. Or un fichier de commandes ne peut pas porter un argument
  contenant un saut de ligne : `cmd` coupe la ligne là, et fpm ne reçoit jamais les chemins à
  empaqueter. Il se plaint alors de n'avoir aucun paramètre, et le paquet ne sort pas.

  Ce n'est pas une limite de Windows : une ligne de commande Windows accepte parfaitement un saut de
  ligne dans un argument entre guillemets. C'est `cmd` qui ne sait pas la relire. Il suffit donc que
  `fpm` soit un **exécutable** et non un fichier de commandes : Node l'appelle alors directement,
  sans passer par `cmd`, et l'argument arrive entier.

  Ce script compile un relais de trente lignes qui fait exactement cela : il reçoit les arguments
  déjà découpés par Windows, et les redonne à Ruby. Rien n'est réécrit ni deviné en chemin.

  Le compilateur employé est celui du .NET Framework, présent sur toute machine Windows : il n'y a
  rien à installer.

.PARAMETER Destination
  Dossier où déposer `fpm.exe`. Il devra être placé en tête du chemin de recherche.

.PARAMETER Ruby
  `ruby.exe` à employer. Cherché dans le chemin, puis dans les installations habituelles.
#>
param(
  [Parameter(Mandatory = $true)][string]$Destination,
  [string]$Ruby
)

$ErrorActionPreference = "Stop"

if (-not $Ruby) {
  $trouve = (Get-Command ruby.exe -ErrorAction SilentlyContinue).Source
  if (-not $trouve) {
    $trouve = Get-ChildItem "C:\" -Filter "ruby.exe" -Recurse -Depth 3 -ErrorAction SilentlyContinue |
      Select-Object -First 1 -ExpandProperty FullName
  }
  $Ruby = $trouve
}
if (-not $Ruby -or -not (Test-Path $Ruby)) {
  Write-Error "ruby.exe est introuvable. Installez Ruby, puis « gem install fpm »."
  exit 1
}

# Le script de la gemme — celui que le fichier de commandes appelait.
#
# RubyGems ne le pose pas toujours a cote de ruby.exe : une installation par utilisateur le range
# ailleurs, et n'expose que son fichier de commandes dans le chemin. On part donc de ce dernier, dont
# le script porte le meme nom sans extension, et on garde deux replis.
$candidats = @()
$commande = (Get-Command fpm -ErrorAction SilentlyContinue).Source
if ($commande) { $candidats += ($commande -replace '\.(bat|cmd)$', '') }
$candidats += (Join-Path (Split-Path $Ruby -Parent) "fpm")
$dossierGemmes = (& $Ruby -e "print Gem.bindir" 2>$null)
if ($dossierGemmes) { $candidats += (Join-Path $dossierGemmes "fpm") }

$scriptFpm = $candidats | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $scriptFpm) {
  Write-Error "Le script « fpm » est introuvable. Lancez « gem install fpm »."
  exit 1
}

[System.IO.Directory]::CreateDirectory($Destination) | Out-Null
$exe = Join-Path $Destination "fpm.exe"

$source = @'
using System;
using System.Diagnostics;
using System.Text;

// Relais vers fpm. Windows a deja decoupe les arguments pour nous ; on les recompose a l'identique
// pour Ruby, sans jamais passer par cmd — c'est tout l'objet de ce programme.
static class Relais {
  // La regle de citation de Windows, telle que CommandLineToArgvW la lit : les antislashs qui
  // precedent un guillemet se doublent, le guillemet s'echappe. Un saut de ligne, lui, n'a besoin de
  // rien : il traverse tant que personne ne fait relire la ligne par cmd.
  static string Citer(string valeur) {
    var sortie = new StringBuilder("\"");
    int antislashs = 0;
    foreach (char c in valeur) {
      if (c == '\\') { antislashs++; continue; }
      if (c == '"') { sortie.Append('\\', antislashs * 2 + 1).Append('"'); antislashs = 0; continue; }
      sortie.Append('\\', antislashs); antislashs = 0;
      sortie.Append(c);
    }
    sortie.Append('\\', antislashs * 2);
    return sortie.Append('"').ToString();
  }

  static int Main(string[] arguments) {
    string ruby = Environment.GetEnvironmentVariable("FLIXTUNES_RUBY");
    string script = Environment.GetEnvironmentVariable("FLIXTUNES_FPM");
    if (string.IsNullOrEmpty(ruby) || string.IsNullOrEmpty(script)) {
      Console.Error.WriteLine("FLIXTUNES_RUBY et FLIXTUNES_FPM doivent designer ruby.exe et le script fpm.");
      return 2;
    }
    var ligne = new StringBuilder();
    // La rustine corrige, en memoire, la recherche d'outils de fpm sous Windows. Voir rustine-fpm.rb.
    string rustine = Environment.GetEnvironmentVariable("FLIXTUNES_RUSTINE_FPM");
    if (!string.IsNullOrEmpty(rustine)) ligne.Append("-r").Append(Citer(rustine)).Append(' ');
    ligne.Append(Citer(script));
    foreach (string argument in arguments) ligne.Append(' ').Append(Citer(argument));
    var demarrage = new ProcessStartInfo(ruby, ligne.ToString());
    demarrage.UseShellExecute = false;
    using (var processus = Process.Start(demarrage)) {
      processus.WaitForExit();
      return processus.ExitCode;
    }
  }
}
'@

if (-not (Test-Path $exe)) {
  Add-Type -TypeDefinition $source -OutputType ConsoleApplication -OutputAssembly $exe
}
# De quoi renseigner l'environnement du relais, sans que l'appelant ait a chercher lui-meme.
[pscustomobject]@{ exe = $exe; ruby = $Ruby; script = $scriptFpm } | ConvertTo-Json -Compress
