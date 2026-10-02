# Validation de la livraison 0.6.0 r1

Date : 26 septembre 2026. Construction par `tools/Build-Release.ps1` dans une copie locale isolée.
Les paquets ont été copiés dans `artifacts` puis relus pour vérifier leurs SHA-256.
Aucun paquet n’a été installé sur le NAS, le PC ou le téléviseur.

## Vérifications réussies

- Vérification TypeScript de tous les projets.
- Serveur : **1 168 tests réussis**, 2 ignorés par la suite existante.
- Web : **355 tests réussis**, dont transfert confirmé, refus distant, maintien de la lecture locale
  et annulation AirPlay sans lecture cachée.
- Bureau : **30 tests réussis**.
- Android : **270 tests réussis**, sans échec ni test ignoré.
- Android lint : **0 erreur, 56 avertissements**. APK debug signé et APK release non signé construits.
  L’APK distribué est le debug signé, conformément au processus existant.
- Budgets Web respectés : entrée 96,0 Kio gzip, CSS inférieur à 18 Kio, modules différés inférieurs
  à 220 Kio. Le plafond de démarrage est inchangé ; celui des modules différés passe de 215 à 220 Kio
  pour le sélecteur de diffusion et le récepteur de commandes.
- Panneau vérifié visuellement dans Opera GX en 1280 × 800 et 390 × 844, sans débordement horizontal.
- Lecture réelle Electron/VLC pendant **240 secondes**, sur un flux de test local avec interruption
  HTTP 503 simulée : fin du banc réussie, maximum de gel mesuré **1 seconde**, aucune requête refusée
  par l’authentification du relais. Ce test n’est pas une qualification d’endurance de plusieurs heures.
- Fichiers nouveaux de diffusion et journal des versions décodés en UTF-8 strict.

## Paquets

| Paquet | Vérification |
| --- | --- |
| Android | Manifeste `0.6.0.r1`, code `60001`, application `tv.flixtunes.app` |
| Windows MSI | Métadonnée MSI `0.6.0.0`, fichier de livraison estampillé `0.6.0.r1` |
| Linux DEB | Champ `Version: 0.6.0.r1`, archive ar et `debian-binary` valides, contrôles en LF |
| ASUSTOR | Validation APKG 2.0 par la chaîne de construction, contrôle UTF-8 et runtime inclus |
| Archives de sources | CRC ZIP et version racine `0.6.0` vérifiés |

Six livrables et le fichier `SHA256SUMS-0.6.0.r1.txt` sont disponibles dans `artifacts`.
L’AppImage requiert une construction sous Linux et n’a pas été générée sous Windows.

## Limites de validation

La découverte réelle a repéré deux récepteurs Google Cast du LAN, sans leur envoyer de lecture.
Le transport Cast a été testé par un récepteur TLS simulé. Les essais de lecture sur les appareils
physiques Google Cast, DLNA et AirPlay restent à réaliser après installation, comme les essais de
veille/réveil, les longues pauses du direct et la continuité Android TV Philips sur cette version.
La réussite des tests ne constitue pas une garantie d’absence de toute régression matérielle.

Les limites fonctionnelles sont détaillées dans [DIFFUSION_060_R1.md](DIFFUSION_060_R1.md), notamment
AirPlay via Safari compatible, les formats acceptés par DLNA, la capacité de conversion du NAS et
les pauses du direct limitées au tampon du récepteur.
