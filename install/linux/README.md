# Serveur Linux

```bash
sudo bash install/linux/install-flixtunes.sh
```

Le script installe les paquets système courants, utilise Node.js 24 déjà présent ou télécharge le runtime officiel avec vérification SHA-256, compile FlixTunes, crée l'utilisateur et le service `flixtunes.service`, puis vérifie `/api/health`.

```bash
sudo bash install/linux/update-flixtunes.sh --source /tmp/FlixTunes-NAS-Source-0.3.0.zip
```

Le code réside dans `/opt/flixtunes/releases`, la configuration dans `/etc/flixtunes` et les données dans `/var/lib/flixtunes`. Les deux derniers emplacements sont conservés pendant les mises à jour.
