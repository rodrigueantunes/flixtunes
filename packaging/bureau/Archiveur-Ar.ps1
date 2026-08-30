<#
.SYNOPSIS
  Fabrique un `ar.exe` minimal, celui qu'attend fpm pour refermer un paquet Debian.

.DESCRIPTION
  Un `.deb` n'est pas un format compliqué : c'est une archive `ar` de trois membres — `debian-binary`,
  `control.tar.gz` et `data.tar.gz` —, et fpm appelle `ar -qc` pour les rassembler. Windows n'a pas
  `ar`, et l'installer voudrait dire ajouter MSYS2 ou LLVM à la liste des prérequis, c'est-à-dire
  renoncer à ce que le script suffise.

  Le format tient en une ligne d'en-tête par membre : un nom sur seize octets, une date, un
  propriétaire, un groupe, un mode, une taille, et deux octets de fin. Les données suivent, complétées
  à une longueur paire. Il n'a pas bougé depuis quarante ans, et c'est exactement ce qu'écrit le `ar`
  de GNU quand fpm l'appelle sous Linux.

  On l'écrit donc, en quarante lignes, plutôt que d'exiger une chaîne d'outils entière. Le résultat se
  vérifie sans rien installer non plus : le `tar` de Windows sait lire une archive `ar`, et donc lire
  le paquet produit.

  **Ce que ce programme ne fait pas** : lire, extraire, mettre à jour, lister. Il ne sert qu'à créer,
  parce que c'est tout ce que fpm lui demande. Un `ar` complet serait du travail sans usage ici.

.PARAMETER Destination
  Dossier où déposer `ar.exe`. Il devra être placé dans le chemin de recherche.
#>
param([Parameter(Mandatory = $true)][string]$Destination)

$ErrorActionPreference = "Stop"
[System.IO.Directory]::CreateDirectory($Destination) | Out-Null
$exe = Join-Path $Destination "ar.exe"

$source = @'
using System;
using System.IO;
using System.Text;

// Un « ar » de creation seule, pour refermer un paquet Debian.
static class Archiveur {
  // Un champ d'en-tete : la valeur, complete par des espaces jusqu'a la longueur voulue.
  static void Champ(Stream sortie, string valeur, int longueur) {
    string cadre = valeur.Length > longueur ? valeur.Substring(0, longueur) : valeur.PadRight(longueur);
    byte[] octets = Encoding.ASCII.GetBytes(cadre);
    sortie.Write(octets, 0, octets.Length);
  }

  static int Main(string[] arguments) {
    // « ar -qc archive membre... » : on ecarte les options, le premier nom restant est l'archive.
    string archive = null;
    var membres = new System.Collections.Generic.List<string>();
    foreach (string argument in arguments) {
      if (argument.StartsWith("-")) continue;
      if (archive == null) { archive = argument; continue; }
      membres.Add(argument);
    }
    if (archive == null || membres.Count == 0) {
      Console.Error.WriteLine("usage : ar -qc <archive> <membre>...");
      return 2;
    }

    long horodatage = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds;
    using (var sortie = new FileStream(archive, FileMode.Create, FileAccess.Write)) {
      byte[] entete = Encoding.ASCII.GetBytes("!<arch>\n");
      sortie.Write(entete, 0, entete.Length);
      foreach (string membre in membres) {
        var fichier = new FileInfo(membre);
        // Le nom porte une barre finale, comme l'ecrit le « ar » de GNU : c'est la forme que dpkg
        // rencontre dans tous les paquets construits avec fpm sous Linux.
        Champ(sortie, fichier.Name + "/", 16);
        Champ(sortie, horodatage.ToString(), 12);
        Champ(sortie, "0", 6);                       // proprietaire
        Champ(sortie, "0", 6);                       // groupe
        Champ(sortie, "100644", 8);                  // mode, en octal
        Champ(sortie, fichier.Length.ToString(), 10);
        sortie.WriteByte(0x60); sortie.WriteByte(0x0A);
        using (var entree = fichier.OpenRead()) entree.CopyTo(sortie);
        // Les membres commencent a une adresse paire : on complete d'un saut de ligne au besoin.
        if (fichier.Length % 2 != 0) sortie.WriteByte(0x0A);
      }
    }
    return 0;
  }
}
'@

if (-not (Test-Path $exe)) {
  Add-Type -TypeDefinition $source -OutputType ConsoleApplication -OutputAssembly $exe
}
Write-Output $exe
