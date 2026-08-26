# Validation FlixTunes 0.4.8 — étape 48

## Périmètre

L'étape 48 traite la chaîne vidéo HDR et la colorimétrie : modèle colorimétrique complet issu de FFprobe,
négociation par appareil, profils Dolby Vision, sélection du pipeline de tone mapping selon le matériel,
conservation des métadonnées statiques lorsque le conteneur cible le permet, désentrelacement à cadence
conservée, rotation et composition des sous-titres après conversion.

## Cas obligatoires

1. Primaires, matrice, transfert, plage, position chroma, sous-échantillonnage et profondeur relevés pour chaque piste vidéo.
2. Mastering display et MaxCLL/MaxFALL relevés, y compris lorsqu'ils ne sont portés que par les SEI d'image.
3. Profil, niveau, présence RPU/BL/EL et identifiant de rétrocompatibilité Dolby Vision relevés.
4. Flux conservé sans reconversion lorsque toute la chaîne l'accepte.
5. Repli sur la couche de base rétrocompatible : Dolby Vision 8.1 → HDR10, 8.4 → HLG, HDR10+ → HDR10.
6. Profil 5 sans couche rétrocompatible converti en SDR, avec perte annoncée avant la lecture.
7. Tone mapping libplacebo/Vulkan prioritaire, repli zscale logiciel, VA-API et OpenCL sur décision administrateur.
8. Réencodage conservant HDR10 quand un encodeur HEVC 10 bits est disponible et que le client l'accepte.
9. Désentrelacement conservant la cadence source ; rotation du conteneur reflétée dans les dimensions de sortie.
10. Sous-titres composés après la conversion SDR, jamais avant.
11. Chaîne colorimétrique visible dans « Infos lecture » et dans le diagnostic serveur.

## Mesures colorimétriques objectives

Banc reproductible construit avec FFmpeg 8.1.1 (`--enable-libzimg --enable-libplacebo --enable-vulkan`) :

1. Référence SDR BT.709 : `smptehdbars` 640×360, 24 i/s, H.264 CRF 12.
2. Contrepartie HDR10 : conversion de la référence en PQ / BT.2020 / bt2020nc 10 bits, HEVC CRF 12,
   `master-display=…L(10000000,1)`, `max-cll=1000,400`.
3. Retour en SDR par chaque backend, puis PSNR contre la référence et statistiques de luma.

| Chaîne | PSNR vs référence | YAVG | YMAX |
| --- | --- | --- | --- |
| Référence SDR | — | 105,0 | 236 |
| 0.4.7 — `npl=1000` + `tonemap=hable:peak=100` | **10,88 dB** | 37,1 | 68 |
| 0.4.8 — `npl=1000`, ordre corrigé, sans `peak` | 11,18 dB | 39,4 | 74 |
| 0.4.8 — `npl=100`, primaires en lumière linéaire, `peak=10` | **17,40 dB** | 74,3 | 152 |
| 0.4.8 — libplacebo `bt.2390` | **19,19 dB** | 81,2 | 179 |

Lecture : la chaîne livrée en 0.4.7 plafonnait la luma à 68 sur 236, soit une image environ trois fois
trop sombre. La cause n'est pas l'algorithme mais la normalisation : `npl` fixe la luminance qui vaut 1,0
en lumière linéaire. À `npl=1000`, le blanc de référence (100 nits) tombe à 0,1 avant compression.
La correction ramène `npl` à 100 et exprime la crête source en multiples du blanc de référence
(1 000 nits → `peak=10`). Le niveau de noir reste à YMIN 15 dans tous les cas : aucune chaîne ne relève
les noirs, le défaut mesuré portait sur la restitution des hautes lumières.

libplacebo reste supérieur de 1,8 dB au chemin logiciel et devient le choix automatique dès que Vulkan
est présent. Le repli `zscale` est retenu sinon, et une panne du chemin matériel relance la session en
logiciel sans intervention.

## Barrière de sortie

- Contrats, serveur et Web compilés ; suites complètes sans régression.
- Tests unitaires de la chaîne colorimétrique : parsing FFprobe, couche de base Dolby Vision, sélection de
  backend, filtres générés, désentrelacement, rotation, arguments d'encodeur HDR et matrice de diagnostic.
- Mesures PSNR/luma reproductibles ci-dessus.
- Recette navigateur du panneau « Infos lecture » et de l'annonce de perte.
- Tests Android JVM et APK `versionCode 48`.
- APKG x86-64/ARM64 et sommes SHA-256.

## Résultats

Cette section n'enregistre que ce qui a été réellement exécuté.

- Mesures colorimétriques : exécutées, valeurs ci-dessus, sur FFmpeg 8.1.1 GPL complet.
- Contrats, serveur et Web compilés sans erreur (`tsc --noEmit` serveur, `tsc -b` Web).
- Suite serveur : **19 fichiers / 120 tests réussis**, dont 41 pour `playback` et 13 pour `ffprobe`
  (respectivement 30 et 8 avant l'étape). La construction de l'application de test demande environ 42 s
  sur le partage SMB de développement : `hookTimeout` doit y être relevé, sans quoi `app.test.ts` expire
  avant d'avoir démarré.
- Suite Web : **6 fichiers / 23 tests réussis**, sans régression après le passage des affiches en images
  paresseuses, l'ajout des flèches de rail et du squelette d'accueil.
- Les trois lignes de commande réellement émises par le serveur ont été rejouées telles quelles vers une
  sortie HLS fMP4, sur une source HDR10 PQ / BT.2020 10 bits avec piste E-AC-3 :

  | Chemin | Code de sortie | Sortie mesurée |
  | --- | --- | --- |
  | Tone mapping `zscale` puis H.264 | 0 | `h264, yuv420p, bt709, bt709, bt709` |
  | Tone mapping `libplacebo` puis H.264 | 0 | `h264, yuv420p, bt709, bt709, bt709` |
  | Conservation HDR10 en HEVC 10 bits | 0 | `hevc, yuv420p10le, bt2020nc, smpte2084, bt2020` |

- Conservation des métadonnées statiques vérifiée sur les segments HLS produits : le flux HEVC ressorti
  porte bien `Mastering display metadata` (`max_luminance 10000000/10000`, `min_luminance 1/10000`) et
  `Content light level metadata` (`max_content 1000`, `max_average 400`).
- Défaut corrigé au passage : `probeMedia` demandait `stream_side_data`, section inconnue de FFprobe.
  La donnée annexe de flux n'était donc jamais lue et `dolbyVisionProfile` restait nul sur tout média réel.
  La section correcte est `stream_side_data_list`, vérifiée sur fichier réel.

### Reste à exécuter

Ces points de la barrière de sortie n'ont pas pu être couverts dans l'environnement de développement
utilisé et doivent l'être avant de publier 0.4.8 :

- Build de production Web et paquet serveur (l'installation des dépendances n'aboutit pas de façon fiable
  depuis le partage SMB : voir « Prérequis d'environnement de développement » dans le plan).
- Recette navigateur du panneau « Infos lecture », de l'annonce de perte et des nouvelles affiches.
- Corpus HDR réel : Dolby Vision double couche, profil 5, profil 8.1, HDR10+, HLG, 10/12 bits,
  chroma 4:2:2 et 4:4:4, source entrelacée, source pivotée, sous-titre image sur source HDR.
- Chemins VA-API, OpenCL et CUDA sur matériel réel : ils restent hors sélection automatique tant qu'ils
  ne sont pas mesurés sur le NAS cible.
- Restitution du réencodage HDR10 sur téléviseur réel : les métadonnées sont bien présentes dans le flux
  produit, mais l'affichage effectif en HDR par un téléviseur n'a pas été observé.
- Sortie HEVC HDR accélérée : volontairement écartée. Seul `libx265` sait réinjecter le mastering display,
  et c'est le seul chemin mesuré. NVENC, QSV, VA-API et AMF relèvent de l'étape 49.
- Tests Android JVM, assemblage APK `versionCode 48` et remontée réelle de `displayPeakNits`.
- Paquets APKG x86-64/ARM64, sommes SHA-256 et test de mise à jour sans perte de données.

### Décision

La barrière de sortie de l'étape 48 **n'est pas encore franchie** : le moteur, l'interface et les mesures
colorimétriques sont livrés, la qualification sur corpus HDR réel et sur appareils reste à conduire.
