# Validation FlixTunes 0.4.9 — étape 49

## Périmètre

L'étape 49 traite la capacité du serveur : sonde matérielle au démarrage, micro-banc non destructif,
modèle de coût par session, files séparées lecture/analyse, contrôle d'admission tenant compte de la
mémoire, de la température et des sessions actives, dégradation avant échec et tableau de capacité.

## Cas obligatoires

1. Chaque accélérateur compilé est réellement essayé ; un pilote absent, inaccessible ou refusant la
   session est signalé avec une raison compréhensible.
2. Un accélérateur plus lent que le processeur est écarté au lieu d'être imposé.
3. Le calibrage survit au redémarrage et se refait quand le moteur ou les accélérateurs changent.
4. Le coût estimé d'une session suit la définition, la cadence, le tone mapping et le nombre de variantes.
5. Une lecture directe est acceptée même serveur saturé.
6. Une session trop lourde est proposée à définition réduite avant tout refus.
7. Un refus indique la raison et l'action possible.
8. Les analyses cèdent la place aux conversions et repartent seules.
9. Mémoire libre insuffisante et surchauffe bloquent l'ouverture d'une nouvelle conversion.
10. Le tableau « capacité de mon serveur » expose processeur, mémoire, température, débits mesurés,
    sessions soutenables et alertes actionnables.

## Banc de mesure du modèle de coût

FFmpeg 8.1.1, `libx264 -preset veryfast -crf 21`, mires `testsrc2`, machine de développement
(Intel Core Ultra 9 275HX, 24 cœurs, 31,4 Gio, x64). L'unité vaut un transcodage 1080p à 25 images/s.

| Scénario | Débit mesuré | Coût mesuré | Coût prédit par le modèle |
| --- | --- | --- | --- |
| 720p | 468 i/s | 0,66 | 0,66 *(ajustement)* |
| 1080p | 321 i/s | 1,00 | **1,00** |
| 2160p | 109 i/s | 2,84 | 2,84 *(ajustement)* |
| Réduction 1080p → 720p | 691 i/s | 0,66 | **0,66** |
| Échelle ABR 1080p+720p+480p+360p | 298 i/s | 1,61 | **1,61** |
| Remux copie 1080p | 2369 i/s | 0,20 | 0,20 |
| Incrustation d'un sous-titre texte | 469 i/s | ≈ 1,00 | 1,00 |

Coût de décodage seul à 1080p, qui pèse sur la part fixe du modèle :

| Codec source | Débit de décodage | Facteur retenu |
| --- | --- | --- |
| MPEG-2 | 1901 i/s | 0,73 |
| H.264 | 1388 i/s | 1,00 *(référence)* |
| HEVC | 1322 i/s | 1,05 |
| AV1 | 700 i/s | **1,98** |

Un codec non mesuré conserve le facteur neutre plutôt qu'une valeur supposée. Le décodage représente
environ un tiers du temps total d'un transcodage 1080p, ce qui recoupe la part fixe de 0,39 obtenue
indépendamment par l'ajustement en définition.

Le modèle retenu est
`coût = [0,39 × facteur codec + 0,295 × Σ mégapixels + 0,05 × (variantes − 1)] × cadence / 25`.
Il n'est ajusté que sur deux points — 720p et 2160p — et prédit exactement les trois autres, dont
l'échelle ABR complète. La part fixe représente le démultiplexage et le décodage, mutualisés entre les
variantes d'une même échelle : c'est ce qui explique qu'une échelle à quatre variantes coûte 1,61 et non
la somme naïve de 2,63. L'incrustation d'un sous-titre texte s'est révélée gratuite à la mesure.

Surcoût du tone mapping, mesuré sur 600 images pour amortir l'initialisation :

| Chaîne | Débit | Surcoût |
| --- | --- | --- |
| Sans conversion | 637 i/s | 1,00 |
| `zscale` logiciel | 444 i/s | **1,43** |
| `libplacebo` / Vulkan | 348 i/s | **1,83** |

libplacebo, retenu en 0.4.8 pour sa fidélité supérieure de 1,8 dB, coûte 1,28 fois plus cher que le
chemin logiciel. Le contrôle d'admission en tient compte au lieu de l'ignorer.

## Banc des accélérateurs

Micro-banc 720p, quatre secondes de mire encodées vers `null`, aucun fichier écrit.

| Accélérateur | Résultat | Débit | Rapport au logiciel | Retenu |
| --- | --- | --- | --- | --- |
| libx264 logiciel | succès | 266 i/s | 100 % | — |
| NVIDIA NVENC | succès | 227 i/s | 85 % | **oui** |
| Intel Quick Sync | succès | 84 i/s | 32 % | non |
| AMD AMF | échec `amfrt64.dll` | — | — | non |
| libx265 (sortie HDR10) | succès | 138 i/s | 52 % | — |

Ce banc justifie la règle retenue : un accélérateur n'est préféré que s'il soutient au moins 80 % du
débit logiciel. Quick Sync répond ici parfaitement à une détection par présence — il est compilé, le
périphérique existe, l'encodage aboutit — mais il est trois fois plus lent que le processeur. La
sélection par présence en vigueur jusqu'à 0.4.8 l'aurait imposé sur un NAS Intel.

## Choix d'implémentation à connaître

Le dossier de l'étape prévoit « des files direct/remux/transcode/scan séparées ». La séparation est
obtenue par les règles de priorité plutôt que par quatre files distinctes : une lecture directe coûte zéro
unité et court-circuite l'admission, un remux est facturé 0,20, un transcodage son coût réel, et la
concurrence d'analyse est calculée à partir de la charge de conversion. Le comportement visé — une analyse
ne peut jamais affamer une lecture — est donc atteint sans dupliquer l'ordonnanceur. Si un besoin
d'ordonnancement plus fin apparaît à l'étape 58, la séparation physique des files restera à faire.

## Barrière de sortie

- Contrats, serveur et Web compilés ; suites complètes sans régression.
- Modèle de coût vérifié contre des débits mesurés, pas contre des constantes supposées.
- Tests d'admission, de dégradation, de priorité des analyses et de génération d'alertes.
- Direct Play + deux transcodages + analyse simultanés sans blocage de l'interface.
- Tests Android JVM et APK `versionCode 49`.
- APKG x86-64 et sommes SHA-256.

## Résultats

Cette section n'enregistre que ce qui a été réellement exécuté.

- Mesures des tableaux ci-dessus : exécutées sur la machine de développement décrite.
- Contrats, serveur et Web compilés sans erreur (`tsc --noEmit` serveur, `tsc -b` Web).
- Suite serveur : **20 fichiers / 144 tests réussis**. `capacity.test.ts` en apporte **24**, dont la
  vérification que le modèle de coût reproduit exactement les débits du banc et que Quick Sync est écarté
  au profit du processeur.
- Suite Web : **6 fichiers / 28 tests réussis**, dont quatre nouveaux tests de changement de piste en
  cours de lecture et un test du plafond réseau annoncé par le navigateur.

### Corrections signalées à l'usage pendant l'étape

- Changement de piste audio sans effet immédiat : la sélection n'était que mémorisée, il fallait un bouton
  de relance. La session est désormais renégociée à la position courante, dans le mode déjà choisi.
- Changement de sous-titre : une piste texte est échangée sans recréer le flux ; seule une incrustation
  impose une nouvelle session. Décalage, encodage et position se répercutent également sans relance.
- Qualité bridée à 720p en réseau local : `navigator.connection.downlink` est plafonné à 10 Mb/s par les
  navigateurs, ce qui ramenait la marge à 7,2 Mb/s, sous les 8 Mb/s du palier 1080p. Ce plafond ne
  s'applique plus qu'en réseau mobile ; l'échelle suit sinon l'écran et la source jusqu'en 2160p.
- Android : sections Films, Séries et Recherche passées d'un rail horizontal unique à une grille
  adaptative remplissant l'écran, barre de navigation rendue fixe. **Non compilé** : voir les artefacts.
- Le calibrage est persisté dans les réglages du serveur et rejoué sans micro-banc au redémarrage tant
  que la signature « version FFmpeg + accélérateurs + architecture » est inchangée.

### Artefacts

- Builds de production : contrats, serveur et Web compilés vers `dist`.
- Paquet ASUSTOR **produit et vérifié** : `flixtunes_0.4.9.r1_x86-64.apk`, 160 957 841 octets,
  SHA-256 `6431bddee495e4759c3a93c03caa72d2f77762ca9e50df46d43b6057d6288b78`.
  Reconstruit après les corrections d'usage, afin que l'artefact corresponde à l'arbre validé.
  Conteneur APKG 2.0 valide (`apkg-version`, `control.tar.gz`, `data.tar.gz`), 4 083 entrées.
  `config.json` déclare `version 0.4.9.r1`, `architecture x86-64`, `firmware 5.0.0`.
  Contenu contrôlé : `dist/capacity.js` de l'étape 49, contrats précompilés, interface Web,
  runtime Node officiel et moteur FFmpeg GPL avec `ffmpeg` et `ffprobe`.
  Seule l'architecture `x86-64` a été construite : c'est celle des Lockerstor AS54xxT, dont l'AS5404T
  (Intel Celeron N5105). Le paquet `arm64` ne concerne que les modèles Realtek et n'a pas été produit.
- APK Android : **non produit dans cet environnement**, et les modifications Android de l'étape ne sont
  donc **pas compilées**. Le démon Gradle 9.5 échoue au démarrage sur `java.io.IOException: Unable to
  establish loopback connection`, levée par `TcpIncomingConnector` sur un `SocketException: Invalid
  argument: connect`. Le défaut est propre à la session : un APK a été produit sur la même machine le
  12 août, et un test Java NIO de bouclage réussit hors Gradle. Contournements essayés sans succès :
  shell POSIX et PowerShell, bac à sable désactivé, `--no-daemon`. `-Djava.net.preferIPv4Stack=true` dans
  `org.gradle.jvmargs` est filtré par Gradle et n'atteint jamais le démon, vérifié dans son journal.
  Gradle 9 fork systématiquement un démon : la connexion de bouclage n'est pas évitable.

### Reste à exécuter

- Scénario de charge réel sur le NAS : Direct Play + deux transcodages + analyse simultanés, avec suivi
  au percentile de la latence de l'interface.
- Fuite mémoire sur huit heures de lecture continue.
- Arrêt et reprise du pilote graphique en cours de lecture.
- Vérification de la lecture de température sur ADM : le relevé passe par `/sys/class/thermal`, absent
  sous Windows où il retourne `null`.
- Micro-banc sur matériel VA-API et V4L2 M2M réels : aucun des deux n'était présent sur la machine de
  mesure, seul leur chemin d'échec a été vérifié.
- Rapport de capacité comparé entre une architecture x86-64 et une ARM64.
- Encodeur matériel limité en nombre de sessions : seule la limite globale `FLIXTUNES_TRANSCODE_CONCURRENCY`
  est appliquée, la limite propre au pilote n'est pas interrogée.

### Décision

La barrière de sortie de l'étape 49 **n'est pas encore franchie** : le moteur de capacité, le contrôle
d'admission et le tableau serveur sont livrés et mesurés, la qualification sous charge réelle sur le NAS
reste à conduire.
