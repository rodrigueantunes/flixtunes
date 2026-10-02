# Validation de la livraison 0.6.0 r6

Date : 30 septembre 2026. Construction complète par `tools/Build-Release.ps1`, terminée avec
le code 0 dans `C:/src/flixtunes-060-r1`. Aucun paquet installé ni service redémarré.

## Résultats automatisés

- TypeScript et constructions des projets réussis ; budgets Web respectés.
- Serveur : **1 217 tests réussis**, 2 ignorés par la suite existante.
- Web : **358 tests réussis**.
- Bureau : **30 tests réussis**.
- Android : **270 tests réussis**, aucun échec, erreur ou test ignoré.
- Total : **1 875 tests réussis**.
- Android lint : **0 erreur, 56 avertissements**.
- 593 fichiers sources comparés entre copie locale et partage : aucune différence.
- Seize fichiers de la r6 : identiques sur le partage, UTF-8 strict sans BOM ni caractère de remplacement.
- Données temporaires indépendantes de la production pour les tests et les essais FFmpeg.

Les nouveaux tests couvrent la progression réelle, les anciennes sessions, les états vides, les
lectures figées, les pauses et erreurs, le tampon initial, les courts extraits terminés, la copie
source pour films/épisodes/vidéos Web, le refus d'un réencodage 4K implicite et le remux Live fMP4.
La suite TLS vérifie aussi les indications de format fMP4 envoyées dans LOAD. Les profils de repli
restent bornés et les conversions précédentes sont libérées avant un nouvel essai.

## Essais vidéo et récepteur physique

Le banc `test:cast-media` passe avec le vrai FFmpeg et les routes HTTP : fichier SD direct,
source HEVC 4K HDR conservée, conversion 1080p, puis conversion 720p. Il contrôle les codecs,
dimensions, manifestes, segments, décodage et révocation. Le test Live réel contrôle également
la lecture par HTTP d'un HLS fMP4, l'init, la conservation des dimensions et l'isolation des profils.

Sur la Pixel Tablet, depuis le serveur de test temporaire du PC :

- Mire MP4 et HLS H.264/AAC : lecture et progression confirmées par le récepteur.
- Extrait du film réellement concerné : refus du profil 1080p testé, puis lecture du profil 720p.
- Après correction : confirmation différée jusqu'à une progression réelle, puis progression
  observée jusqu'à environ 27 secondes avant arrêt explicite du test.
- Essai source : le flux servi est bien HEVC Main 10, 3840 × 2160, HDR PQ/BT.2020, vidéo copiée ;
  le banc HTTP le décode, mais la Pixel Tablet le refuse dans ce lecteur Cast.

Il ne s'agit pas d'une observation visuelle de l'écran de la tablette : les confirmations viennent
à la fois des états Cast reçus et des contrôles de décodage sur le PC. Aucune lecture 4K physique
réussie sur un autre récepteur n'est revendiquée. Les fichiers du NAS ont été lus sans modification.
Les essais matériels et leur portée sont détaillés dans [DIFFUSION_060_R6.md](DIFFUSION_060_R6.md).

## Livrables

Six livrables et `SHA256SUMS-0.6.0.r6.txt` sont déposés dans le dossier partagé `artifacts`.
Les empreintes ont été contrôlées localement puis après copie, par relecture du partage.

| Livrable | Vérification |
| --- | --- |
| Android | `tv.flixtunes.app`, version `0.6.0.r6`, code `60006` |
| Windows MSI | `ProductVersion=0.6.0.0`, fichier estampillé `0.6.0.r6` |
| Linux DEB | `Version: 0.6.0.r6`, archive ar valide et métadonnées en LF |
| ASUSTOR | APKG 2.0 validé par la construction |
| Deux ZIP | CRC vérifiés, version racine `0.6.0`, sources Cast/Live/Web identiques aux fichiers validés |

Le paquet NAS a utilisé le cache de trois paquets Debian dont l'index était indisponible.
Les bibliothèques et fonctions VA-API ont été vérifiées. Un avertissement pnpm concerne le lanceur
CLI Windows `multicast-dns.CMD` : les modules JavaScript `bonjour-service` et `multicast-dns`
ont été chargés avec succès depuis le répertoire de déploiement du paquet. Le service utilise
ces modules, pas ce lanceur CLI. L'AppImage n'est pas générée sous Windows.

## Mise à jour et vérifications restantes

**Mettre à jour le serveur NAS et le client Android** pour disposer de toutes les corrections.
Le rendu local Android TV/Philips et VLC est inchangé ; le dialogue Cast Android évolue.

La vidéo source est essayée avant réduction, jusqu'à la 4K pour les fichiers, et sans réencodage
vidéo pour le Live. Cela ne certifie pas tous les codecs/HDR sur tous les appareils. La réception
4K effective doit être vérifiée sur un récepteur compatible ; la Pixel Tablet nécessite le repli
sur l'extrait testé. La vitesse du NAS, la lecture prolongée et le parcours Android → NAS → récepteur
restent à confirmer après installation. Aucun déploiement n'a été effectué automatiquement.

Ce rapport, rédigé après la génération, n'est pas inclus dans les archives déjà vérifiées.
