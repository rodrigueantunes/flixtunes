# Validation FlixTunes 0.2.0

Date de recette : 13 août 2026  
Version serveur : `0.2.0` — phase 20

## Résultat

La recette 0.2.0 est validée sur une copie propre des sources, avec une base de données neuve et des données de test isolées. Les clients Windows et Android ont été construits depuis les mêmes contrats d'API que le serveur.

## Suites automatisées

| Cible | Validation | Résultat |
| --- | --- | --- |
| Serveur Node.js | Vitest | 57 tests, 13 fichiers, 0 échec |
| Web/PWA | Vitest | 6 tests, 2 fichiers, 0 échec |
| Monorepo | TypeScript `typecheck` | validé |
| Monorepo | build production | validé |
| Windows | tests .NET | 8 tests, 0 échec |
| Windows x64 | publication autonome | validée |
| Android | tests JVM | 6 tests, 0 échec |
| Android | lint + assemblage APK | validés |

## Intégrations réelles

- FFmpeg : Direct Play, remux et transcodage HLS fMP4/MPEG-TS validés ;
- matrice réelle : H.264, HEVC, VP9, AV1 dans MP4, MKV, WebM et M2TS ;
- surveillance des dossiers : détection d'un changement et analyse terminée ;
- découverte locale : service `_flixtunes._tcp` publié et retrouvé en mDNS ;
- serveur compilé : démarrage réel, page Web HTTP 200, santé et métriques accessibles ;
- base neuve : migrations, index et premier lancement validés ;
- encodage : 129 fichiers texte lus en UTF-8 strict, aucun motif corrompu détecté.

## Recette d'interface

La PWA a été contrôlée dans le navigateur intégré sur une médiathèque temporaire réellement scannée :

- navigation Accueil, Films, Séries TV et Historique ;
- tri alphabétique par défaut, puis changements vers la date de sortie et la date d'ajout ;
- séparation correcte des catalogues Films et Séries TV ;
- ouverture d'une série, description, saisons et épisodes ;
- centre d'analyse global, Films, Séries, Métadonnées et commandes par bibliothèque.

## Capacités livrées entre les phases 10 et 20

1. centre d'analyse global, Films, Séries et par bibliothèque ;
2. analyse avancée des noms, NFO, identifiants, éditions et épisodes spéciaux/doubles ;
3. fournisseurs de métadonnées configurables avec cache et replis de langue ;
4. score de correspondance explicable et file de revue manuelle ;
5. inventaire FFprobe : pistes, chapitres, HDR et audio immersif ;
6. Direct Play, remux et transcodage adaptatif au client et au réseau ;
7. préférences audio/sous-titres par profil et sous-titres externes ;
8. ergonomie TV/mobile/clavier, accessibilité et liste personnelle ;
9. recommandations locales, privées et explicables ;
10. cache, coupe-circuit, télémétrie, métriques et index NAS ;
11. durcissement sécurité, recette multiplateforme et artefacts 0.2.0.

## Livrables

- `FlixTunes-Android-0.2.0-debug.apk` ;
- `FlixTunes-Windows-x64-0.2.0.zip` ;
- `FlixTunes-NAS-Source-0.2.0.zip` ;
- `SHA256SUMS-0.2.0.txt`.

## Installation serveur et mises à jour

- Windows : installation réelle répétée deux fois dans une racine isolée, releases versionnées et jonction `current` validées ;
- conservation : donnée sentinelle et configuration personnalisée conservées après mise à jour ;
- SQLite : sauvegarde cohérente créée avec `VACUUM INTO`, `PRAGMA quick_check = ok` et profil local conservé ;
- serveur installé : démarrage du build produit, santé `ok`, version `0.2.0`, phase 20 et interface HTTP 200 ;
- Linux/NAS : installation native complète exécutée en environnement Bash compatible, scripts contrôlés par `bash -n` ; service systemd à qualifier sur un hôte Linux réel ;
- ASUSTOR : paquets APKG 2.0 précompilés `x86-64` et `arm64`, runtime Node vérifié par architecture, hooks exécutables, serveur et dépendances de production embarqués ; démarrage du contenu x86-64 et interface HTTP 200 validés hors NAS, installation ADM physique à confirmer ;
- Compose : données externes à l'image, sauvegarde et retour à l'image précédente prévus si le contrôle de santé échoue.

Le moteur Docker n'était pas installé sur la machine de recette. Docker reste une méthode de déploiement optionnelle ; le fonctionnement NAS natif Node.js + FFmpeg, qui évite cette couche, a été compilé et exécuté réellement.

Les appels réels aux fournisseurs de métadonnées externes n'ont pas été exécutés faute de clés/licences configurées. Leurs adaptateurs, délais, scores et replis ont été validés par tests contrôlés. Les limites complètes et la vérification de chaque jalon figurent dans `AUDIT_PHASES_0_20.md`.
