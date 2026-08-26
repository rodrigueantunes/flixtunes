# Serveur Windows

Ouvrir **PowerShell en administrateur** depuis le dossier extrait de FlixTunes :

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install\windows\Install-FlixTunesServer.ps1
```

L'installateur vérifie ou installe Node.js 24 et FFmpeg, compile le serveur, crée la tâche de démarrage automatique **FlixTunes Server**, ouvre le port privé 4000 et place les données sous `C:\ProgramData\FlixTunes Server\data`. Utilisez `-NoPrerequisites` pour interdire l'installation automatique.

Si le serveur doit lire un partage UNC protégé (`\\NAS\Médias`), installez la tâche sous un compte autorisé :

```powershell
.\install\windows\Install-FlixTunesServer.ps1 -ServiceCredential (Get-Credential)
```

Le secret est confié au stockage protégé du Planificateur de tâches et n'est écrit dans aucun fichier FlixTunes. Les mises à jour conservent la tâche existante sans redemander le mot de passe.

Mise à jour depuis une nouvelle archive source :

```powershell
.\install\windows\Update-FlixTunesServer.ps1 -Source C:\Téléchargements\FlixTunes-NAS-Source-0.3.0.zip
```

La base est sauvegardée avant la bascule. Le code précédent reste dans `releases` et sert au retour arrière automatique si le contrôle de santé échoue. Le fichier `config\flixtunes.env` et le dossier `data` ne sont jamais remplacés.
