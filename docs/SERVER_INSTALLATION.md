# Installation et mise à jour du serveur FlixTunes

## Principe de conservation

Toutes les installations séparent trois zones :

- `releases` : code compilé et versionné ;
- `config` : clés, port et réglages serveur ;
- `data` : base SQLite, comptes, bibliothèques, progressions, jaquettes, sous-titres extraits et sauvegardes.

Une mise à jour prépare d'abord une nouvelle release sans interrompre le serveur. Elle arrête ensuite le service, copie `flixtunes.db` dans `data/backups`, bascule le lien `current`, redémarre et interroge `/api/health`. En cas d'échec, le lien revient automatiquement sur la release précédente. Aucun média n'est copié, renommé ou supprimé.

## Windows Server, Windows 10 et Windows 11

Dans PowerShell **administrateur** :

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install\windows\Install-FlixTunesServer.ps1
```

Par défaut :

- application : `C:\ProgramData\FlixTunes Server\releases` ;
- données : `C:\ProgramData\FlixTunes Server\data` ;
- configuration : `C:\ProgramData\FlixTunes Server\config\flixtunes.env` ;
- démarrage automatique : tâche système `FlixTunes Server` ;
- pare-feu privé : TCP 4000.

Le compte système par défaut convient aux médias locaux. Pour un partage réseau protégé, fournissez une fois un compte Windows autorisé :

```powershell
.\install\windows\Install-FlixTunesServer.ps1 -ServiceCredential (Get-Credential)
```

Le Planificateur de tâches protège le secret ; FlixTunes ne le stocke pas dans sa configuration. Les mises à jour réutilisent la tâche existante.

L'installateur peut utiliser Winget pour Node.js 24 et FFmpeg. Pour une installation déjà préparée :

```powershell
.\install\windows\Install-FlixTunesServer.ps1 -NoPrerequisites
```

Mise à jour :

```powershell
.\install\windows\Update-FlixTunesServer.ps1 -Source C:\Temp\FlixTunes-NAS-Source-0.3.0.zip
```

## Linux

```bash
sudo bash install/linux/install-flixtunes.sh
```

Le script couvre Debian/Ubuntu, Fedora, Alpine et Arch pour les paquets usuels. Si Node.js 24 n'est pas disponible, le runtime officiel correspondant à `x64`, `arm64` ou `armv7l` est téléchargé et contrôlé avec le fichier SHA-256 officiel. Un service systemd durci est créé.

Le compte `flixtunes` doit disposer au minimum de la lecture sur les dossiers multimédias. Ajoutez-le au groupe propriétaire du partage ou accordez une ACL ; l'installateur ne modifie volontairement pas les permissions des médias.

Mise à jour locale ou depuis une URL :

```bash
sudo bash install/linux/update-flixtunes.sh --source /tmp/FlixTunes-NAS-Source-0.3.0.zip
sudo bash install/linux/update-flixtunes.sh --source https://serveur/releases/FlixTunes-NAS-Source-0.3.0.zip
```

## NAS générique sans Docker

Après activation de SSH :

```bash
bash install/nas/install-nas.sh --nas-root /volume1/FlixTunes
```

Le script recherche automatiquement les volumes courants ASUSTOR/Synology, QNAP, Unraid puis le dossier personnel. Sans systemd, il génère `start.sh`, `stop.sh` et `status.sh`. Ajoutez uniquement `server/bin/start.sh` au planificateur de tâches du NAS.

## NAS avec Docker/Container Manager

Ce mode est optionnel et facilite les NAS verrouillés :

```bash
bash install/nas/install-compose.sh --data-root /volume1/FlixTunes/data --media-root /volume1/Media
bash install/nas/update-compose.sh
```

Les médias sont montés en lecture seule. Les données sont un volume externe à l'image et survivent à sa reconstruction. Le mode natif reste préférable si l'on souhaite éviter la couche conteneur ; en pratique, le coût CPU de Docker est faible, mais l'accès au GPU et aux périphériques de transcodage demande une configuration propre au NAS.

## ASUSTOR ADM

Construire le paquet :

```powershell
.\packaging\asustor\Build-AsustorApkg.ps1
```

Puis ouvrir **App Central → Gestion → Installation manuelle** et choisir le paquet correspondant au processeur : `x86-64` pour Intel/AMD ou `arm64` pour Realtek ARM 64 bits. Les paquets `0.2.0.r4` sont précompilés et n'exécutent plus npm, pnpm, TypeScript ou Vite pendant l'installation. Le paquet :

- crée le partage persistant `/volume1/FlixTunes` ;
- affiche le logo FlixTunes dans App Central et ajoute un raccourci au bureau ADM ouvrant directement `http://<adresse-du-NAS>:4000/` ;
- embarque le runtime Node adapté à l'architecture et le serveur déjà compilé ;
- utilise FFmpeg fourni par ADM ou Entware ;
- arrête proprement le serveur et sauvegarde SQLite avant une mise à jour App Central ;
- ne supprime pas le partage de données lors d'une désinstallation.

Dans l'assistant initial et dans **Bibliothèques**, le bouton **Parcourir le NAS** permet de naviguer dans les volumes locaux (`/volume1`, `/volume2`, etc.) puis de sélectionner un dossier. Le chemin reste également saisissable manuellement, notamment pour un montage personnalisé. Le serveur ne renvoie que les dossiers situés sous les volumes autorisés et bloque les sorties par `..` ou lien symbolique.

Le format suit la documentation APKG 2.0 officielle. Une qualification sur NAS ASUSTOR physique reste nécessaire avant une publication publique dans App Central.

## Sauvegarde et retour arrière manuel

Les sauvegardes automatiques se trouvent dans `data/backups`. Pour revenir manuellement, arrêter le service, faire pointer `current` vers un ancien dossier de `releases`, puis redémarrer. Restaurer une base n'est normalement pas nécessaire : les migrations sont conçues pour être additives et l'installateur conserve la copie `pre-update-*`.
