# Diffusion 0.6.0 r5

## Incident observé sur le NAS

La capture montre les récepteurs Google Cast retrouvés, puis « Préparation du média indisponible ».
Le NAS annonce r4. Son journal a été lu sur le partage en lecture seule, ainsi que les métadonnées
du média et le calibrage matériel dans la base SQLite ouverte avec `mode=ro`.

Le média concerné est HEVC 3840×2160, 10 bits, Dolby Vision profil 8 avec base HDR10, audio E-AC-3.
Le journal montre deux tentatives de conversion Cast H.264/AAC : VA-API, repli libx264, puis arrêt
par le chien de garde sans premier manifeste. La lecture mobile, elle, copiait la vidéo HEVC et
convertissait seulement l'audio. La réussite d'une autre application Cast ne vérifie donc pas
cette conversion particulière du NAS.

La cause exacte du refus initial VA-API n'est pas conservée par la r4 : son erreur est remplacée
lors du repli. La r5 conserve désormais cette trace dans le diagnostic de transcodage.

## Corrections

- Le chemin de diffusion réduit la définition avant le tone mapping logiciel quand il doit réduire
  une source HDR. Le désentrelacement reste en tête et les filtres colorimétriques sont conservés.
- Les conversions de diffusion à une variante produisent des segments de deux secondes avec les
  images clés correspondantes. Les lectures locales gardent leur réglage précédent.
- FFmpeg envoie sa progression sur sa sortie standard. Seule une augmentation des compteurs
  d'images ou de temps renouvelle le délai de blocage. Les messages répétitifs, erreurs ou valeurs
  invalides ne peuvent pas maintenir une conversion bloquée en vie.
- Chaque processus de repli reçoit un nouveau suivi de démarrage. La surveillance locale existante
  n'est pas modifiée : ce comportement est activé par l'option interne `diffusion`.
- La préparation est bornée à 90 secondes par tentative. Un échec de conversion ou un dépassement
  permet un second essai compatible à 720p, 4 Mb/s maximum, H.264/AAC. Préparation et chargement
  partagent la même limite de deux essais ; un refus de capacité sans session n'est pas retenté.
- L'ancienne conversion est libérée avant un nouvel essai et les URL de média restent révocables,
  liées au profil et limitées aux fichiers de leur session.
- L'erreur de préparation indique le motif du moteur et un code distinct : refus, échec ou délai.

Le rendu Android TV/Philips et VLC n'est pas modifié. Les voies films, séries, vidéos Web et Live TV
restent présentes ; cette correction concerne la préparation des vidéos, pas un nouveau moteur Live TV.
Le profil conservateur H.264/AAC est maintenu : la documentation Google indique notamment que
[HEVC n'est pas pris en charge dans un conteneur Transport Stream](https://developers.google.com/cast/docs/media).

## Vérification

Les tests ciblés couvrent les progressions fragmentées, les blocages réels, le nouveau délai après
relance, le placement du redimensionnement, la libération des conversions, les refus de capacité,
l'attente au-delà de 45 secondes et l'arrêt à 90 secondes, ainsi que la limite des tentatives.

`pnpm --filter @flixtunes/server test:cast-media` exécute un banc isolé : création de clips SD et
4K HDR HEVC/E-AC-3, préparation par MediasDiffusion et le vrai moteur de lecture, service HTTP du
manifeste et des segments, FFprobe des codecs/dimensions, décodage FFmpeg et révocation. Le banc
passe pour le fichier SD, la conversion HDR en 1080p et le profil compatible 720p sur le PC.

Un chemin de média local peut être fourni au script pour remplacer le clip HDR par un extrait
copié de huit secondes à partir de 108 secondes. Le média d'origine est seulement lu. Le banc crée
sa base dans un dossier temporaire indépendant et ne modifie jamais la médiathèque du NAS.

Le 29 septembre 2026, ce second essai a également réussi avec un extrait du fichier réellement
concerné sur le NAS : préparation, manifeste HTTP, segments, contrôle H.264/AAC et décodage
en 1080p puis 720p. Le fichier source a été ouvert en lecture seule via le partage multimédia.

Ces essais ne mesurent pas la vitesse du NAS et ne constituent pas une lecture prolongée sur la
Pixel Tablet. Aucun paquet n'est installé automatiquement. La validation matérielle complète
Android → NAS → récepteur doit être confirmée après mise à jour du serveur en r5.
