# Feuille de route

## Jalon 1 — socle local (terminé en 0.0.1)

- Assistant de premier lancement sans chemin préconfiguré
- Bibliothèques persistantes avec scan au démarrage
- Scan et actualisation de métadonnées par bibliothèque
- Scan films/séries et classement par saison
- Profils locaux
- Reprise et historique de lecture
- Lecture directe avec seek réseau
- Web/PWA responsive

## Jalon 2 — métadonnées hiérarchiques (terminé en 0.0.2)

- Catalogue films, séries, saisons et épisodes
- Titres et synopsis français/anglais avec repli anglais
- Jaquettes locales prioritaires et cache serveur des images TMDB
- Affiches par film, série et saison
- Score de correspondance titre/année
- Correction manuelle verrouillée depuis l'interface

## Jalon 3 — lecture universelle (terminé en 0.0.3)

- Détection des capacités du client et inventaire technique détaillé
- Direct Play, remux HLS fMP4 et transcodage à la volée
- Repli automatique de l'accélération matérielle vers le logiciel
- Intel Quick Sync, NVIDIA NVENC, AMD AMF et VA-API
- Sélection audio/sous-titres, WebVTT et incrustation vidéo
- HDR10, HDR10+, HLG, Dolby Vision, Dolby Atmos, DTS:X et Auro-3D

## Jalon 4 — expérience Web (terminé en 0.0.4)

- Profils locaux créables avec langue et couleur propres
- Progression, contenus terminés et historique isolés par profil
- Recherche côté serveur sur films, séries et épisodes
- Fiches immersives et navigation série → saison → épisode
- Action vu/non vu et reprise dans le lecteur
- Recette desktop et responsive dans un navigateur réel

## Jalon 5 — Android (terminé en 0.0.5)

- Android mobile avec Jetpack Compose + Media3
- Android TV avec navigation D-pad, recommandations et MediaSession
- Découverte DNS-SD et connexion manuelle au NAS
- Négociation HDR10/HDR10+/HLG/Dolby Vision et audio immersif

## Jalon 6 — application Windows (terminé en 0.0.6)

- WPF natif Windows 10/11 avec libVLC embarqué et décodage matériel
- Direct Play, remux/transcodage HLS, pistes audio/sous-titres et passthrough HDR/audio immersif
- Découverte automatique du serveur sur le LAN (mDNS) et connexion manuelle

## Jalon 7 — identité (terminé en 0.0.7)

- Emblème original en ruban F, lecture et onde audio
- Système de marque bleu cohérent Web, Android/TV et Windows
- Animation d’ouverture et signature sonore originale

## Jalon 8 — exploitation NAS (terminé en 0.0.8)

- Service Web et API unifiés sur le port du NAS
- Publication DNS-SD, surveillance temps réel et scans planifiés
- Sauvegardes SQLite rotatives, restauration sécurisée et contrôle d’intégrité
- En-têtes de sécurité, limitation de débit, CORS LAN et jeton d’écriture optionnel
- Image Docker multi-étage et configuration Compose durcie

## Jalon 9 — livraison (terminé en 0.0.9)

- Paquets Windows x64 autonome et Android universel mobile/TV
- Build NAS reproductible, documentation de déploiement et sommes SHA-256
- Recettes unitaires, intégration FFmpeg, mDNS, watcher, navigateur et démarrage exécutable réel

Le plan complet et ses critères de validation se trouvent dans [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md).

## Jalon 10 — centre d’analyse (terminé en 0.1.0)

- Analyse globale, films, séries, métadonnées et bibliothèque individuelle
- Progression, historique, priorité, concurrence, annulation et relance persistés

## Jalons 11 à 13 — détection et métadonnées (terminés en 0.1.3)

- NFO, identifiants, éditions, types de films et conventions séries avancées
- Fournisseurs locaux/TMDB/TheTVDB/Fanart.tv et connecteurs licenciés
- Correspondances explicables, file de revue et corrections verrouillées

## Jalons 14 à 16 — média universel (terminés en 0.1.6)

- Inventaire complet HDR10/HDR10+/HLG/Dolby Vision, Atmos/DTS:X/Auro-3D, chapitres et accessibilité
- Direct Play, remux ou transcodage adaptatif au débit et au client
- Préférences de pistes par profil et sous-titres internes/externes

## Jalons 17 à 20 — expérience 0.2 (terminés en 0.2.0)

- Liste personnelle, ergonomie TV/mobile/clavier et accessibilité
- Recommandations locales, privées et explicables
- Cache, coupe-circuit, métriques et optimisation NAS
- Recette multiplateforme, sécurité, documentation et artefacts 0.2.0
