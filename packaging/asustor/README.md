# Paquet ASUSTOR ADM

Le dossier suit la structure APKG officielle : `CONTROL/config.json`, icône 90 × 90, scripts d'installation et `start-stop.sh`. Le paquet déclare une application Web personnalisée sur le port 4000 et un partage persistant `FlixTunes`.

Construction sous Windows :

```powershell
.\packaging\asustor\Build-AsustorApkg.ps1
```

Deux fichiers sont produits et s'installent manuellement dans **ADM → App Central → Gestion → Installation manuelle** :

- `flixtunes_<version>_x86-64.apk` pour les NAS Intel et AMD ;
- `flixtunes_<version>_arm64.apk` pour les NAS Realtek ARM 64 bits.

Pour ne construire que l'architecture nécessaire :

```powershell
.\packaging\asustor\Build-AsustorApkg.ps1 -Architectures x86-64
```

Repères de modèles : les **Lockerstor AS54xxT et AS66xx**, dont l'**AS5404T** (Intel Celeron N5105, Jasper Lake), sont des NAS **x86-64** — c'est le paquet `x86-64` qu'il faut installer, jamais `arm64`. Les Drivestor AS11xx et AS33xx à processeur Realtek RTD1296 sont eux en `arm64`. `CONTROL/config.json` déclare `firmware: 5.0.0` : le paquet exige ADM 5.0 ou supérieur, ce que l'AS5404T prend en charge. Sur un NAS resté en ADM 4.x, abaissez cette valeur avant construction, sinon App Central refuse l'installation.

Le N5105 embarque un GPU Intel Jasper Lake avec Quick Sync. Depuis 0.4.9, FlixTunes ne se contente pas de détecter Quick Sync : il l'essaie au démarrage et ne le retient que s'il soutient au moins 80 % du débit de l'encodage logiciel. Le verdict réel de votre NAS est visible dans le tableau « capacité de mon serveur » du diagnostic.

Le nom suit la convention officielle `PACKAGE_VERSION_ARCHITECTURE.apk`. Chaque paquet contient déjà le serveur Web compilé, ses dépendances de production, le runtime Node officiel et un moteur FFmpeg GPL complet correspondant au processeur. Aucun téléchargement, `pnpm install`, build TypeScript/Vite ou paquet FFmpeg séparé n'est nécessaire sur le NAS. Le moteur embarqué est vérifié par SHA-256 pendant la construction et sa présence E-AC-3 est contrôlée à l'installation.

La construction utilise le conteneur APKG 2.0 attendu par ADM : `apkg-version`, `control.tar.gz` et `data.tar.gz`, stockés sans double compression. Le manifeste est écrit en UTF-8 sans BOM et les scripts conservent des fins de ligne LF et leurs droits exécutables.

Pendant l'installation, App Central affiche le logo bleu FlixTunes au format PNG transparent 90 × 90. ADM crée ensuite un raccourci **FlixTunes** sur son bureau. Un clic ouvre directement `http://<adresse-réseau-du-NAS>:4000/` ; ADM remplace automatiquement l'adresse par l'IP ou le nom réseau utilisé pour accéder au NAS.

Cette structure respecte le guide APKG 2.0. La version `0.2.0.r2` a remplacé le premier paquet qui compilait sur le NAS et pouvait rester 30 à 45 minutes en installation. La révision `0.2.0.r3` rend l'ajout de bibliothèques compatible avec les navigateurs ouverts en HTTP sur l'adresse locale du NAS. La révision `0.2.0.r4` ajoute un sélecteur sécurisé des dossiers présents sur le NAS, tout en conservant la saisie manuelle. Les données sont placées dans `/volume1/FlixTunes`, hors du paquet, afin de survivre aux mises à jour et désinstallations.
