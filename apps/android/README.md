# Client Android FlixTunes 0.4.9

Une seule application couvre Android mobile (API 23+) et Android TV. L'interface adapte dimensions, focus et navigation au type d'appareil.

## Fonctionnalités

- connexion manuelle au serveur NAS et découverte DNS-SD `_flixtunes._tcp.` ;
- sélection persistante du profil sans mélanger les historiques ;
- accueil, recherche, films, séries, saisons, épisodes et contenus terminés ;
- négociation des codecs, de la définition, HDR10/HDR10+/HLG/Dolby Vision et Dolby Atmos ;
- Direct Play, HLS remuxé ou transcodé via Media3 ExoPlayer ;
- commandes tactiles, clavier et télécommande, avec `MediaSessionService` ;
- remontée périodique de la progression au serveur.

## Construction

Le dépôt ne contient pas de `local.properties` : l'emplacement du SDK doit venir de l'environnement.

```powershell
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"; ./gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

L'APK de développement est produit sous `app/build/outputs/apk/debug/`.

Gradle 9 fork toujours un démon et lui parle par une socket de bouclage. Si la construction échoue sur
`java.io.IOException: Unable to establish loopback connection`, le défaut n'est ni dans le projet ni dans
le SDK : c'est l'accès à `127.0.0.1` du processus démon qui est bloqué. Ni `--no-daemon`, ni
`-Djava.net.preferIPv4Stack=true` ne le contournent, puisque le fork reste obligatoire. Construisez alors
depuis un terminal ordinaire, sans interposition de pare-feu applicatif ni bac à sable.
