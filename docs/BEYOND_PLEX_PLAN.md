# FlixTunes — plan de développement au-delà de Plex

## Ambition et règle de preuve

FlixTunes doit offrir une lecture locale plus prévisible, une détection plus transparente et une expérience plus rapide que Plex sur NAS, Web, Android mobile, Android TV et Windows. Une étape n'est terminée que lorsque son code, ses migrations, son interface et ses tests passent sur des médias réels.

La promesse « universelle » signifie que tout flux reconnu par FFprobe obtient une décision explicable : lecture directe, remux sans perte, conversion de la seule piste incompatible, transcodage complet, ou erreur documentée. Elle ne contourne ni DRM, ni brevet, ni limite matérielle du client.

## Indicateurs cibles

- Décision de lecture mise en cache en moins de 50 ms au 95e percentile.
- Première image en moins de 2 s en lecture directe et 4 s en transcodage sur le LAN de référence.
- Seek en moins de 800 ms en direct et 2 s en transcodage.
- Zéro transcodage vidéo lorsque seuls le conteneur ou l'audio sont incompatibles.
- 95 % d'affiches automatiques sans clé sur le corpus de référence, avec moins de 1 % de faux positifs automatiques.
- Catalogue de 10 000 titres servi en moins de 150 ms au 95e percentile.
- Aucune perte de profil, progression, correspondance manuelle ou bibliothèque pendant une mise à jour.
- Tous les scénarios critiques couverts par un test reproductible et un diagnostic utilisateur compréhensible.

## Étapes 43 à 62

### Étape 43 — 0.4.3 — moteur de compatibilité vérifiable

- Inventorier au démarrage les décodeurs, encodeurs, filtres, accélérations et formats réels du FFmpeg installé.
- Remplacer les suppositions par un profil de capacité appris et versionné par appareil.
- Exposer un graphe de décision piste par piste et quatre modes : Auto, Direct forcé, Remux préféré, Compatible.
- Tester H.264, HEVC Main/Main10, AV1, VP8/VP9, MPEG-2, VC-1, ProRes, Theora ; MP4, MKV, MOV, AVI, WebM, TS/M2TS ; AAC, MP3, Opus, Vorbis, FLAC, ALAC, PCM, AC-3, E-AC-3, TrueHD et DTS selon la disponibilité légale du moteur.

Sortie : aucune décision « codec non pris en charge » sans indiquer quel client ou composant manque et quel repli est disponible.

### Étape 44 — 0.4.4 — moteur universel de sous-titres

- Détecter les pistes internes et fichiers externes SRT, WebVTT, ASS/SSA, TTML/DFXP, SAMI, MicroDVD, SubViewer, MPL2, VobSub SUB/IDX, PGS, DVB et CEA-608/708.
- Normaliser langue BCP-47, forcé, SDH/SME, commentaires, encodage texte et ordre des pistes.
- Choisir extraction, conversion WebVTT, rendu client ou incrustation sans transcoder inutilement la vidéo.
- Ajouter décalage ±10 min, style, taille, fond, position, police, encodage manuel et synchronisation persistée par fichier/profil.
- Prévoir OCR PGS/VobSub local optionnel et connecteurs de téléchargement uniquement officiels/licenciés.

Sortie : matrice de tests par format, langue, piste forcée, seek et changement en cours de lecture.

### Étape 45 — 0.4.5 — langues et audio home cinéma

- Règles de langue par profil : originale, français, anglais, ordre de repli, sous-titres forcés et SDH.
- Identifier commentaire, audiodescription, doublage, piste originale et canaux réels.
- Passthrough AC-3/E-AC-3/TrueHD/Atmos/DTS/DTS-HD/DTS:X selon la chaîne appareil → HDMI/eARC → ampli.
- Conversion multicanale configurable AAC/AC-3/Opus, downmix mesuré, normalisation EBU R128 optionnelle et protection contre l'écrêtement.

Sortie : sélection correcte sans interaction sur le corpus multilingue et absence de perte de canaux quand le client les accepte.

### Étape 46 — 0.4.6 — lecteur instantané et contrôlable

- Démarrage optimiste, changement de piste sans redémarrage quand le protocole le permet, seek exact, chapitres et vignettes de timeline.
- Afficher qualité, mode, codecs, débit, buffer, dropped frames, HDR, audio et raison du transcodage dans « Infos lecture ».
- Auto-play épisode suivant, reprise avec retour configurable, vitesse, image dans l'image, minuteur et protection anti-lecture infinie.
- Bouton « Lire directement » et repli automatique non destructif si l'appareil refuse le flux.

Sortie : tests navigateur et Android sur démarrage, pause, seek, reprise, changement de piste, fin et erreur réseau.

### Étape 47 — 0.4.7 — streaming adaptatif local

- Profils HLS fMP4/MPEG-TS et DASH, échelle de qualité adaptée à la source, au client et au NAS.
- Estimation continue du débit, buffer prédictif, bascule de qualité sans coupure et reprise après perte Wi-Fi.
- Cache de segments partagé, reprise des sessions et préparation de l'épisode suivant sous quotas disque/CPU.

Sortie : aucune mise en mémoire tampon durable lors des profils réseau 100/40/15/5 Mb/s du banc de test.

### Étape 48 — 0.4.8 — qualité vidéo HDR

- Préserver BT.709/BT.2020, plage, primaires, matrice, mastering display, MaxCLL/MaxFALL et rotation.
- Direct Play HDR10/HDR10+/HLG/Dolby Vision par profil, repli HDR10 ou tone mapping SDR explicite.
- Tone mapping libplacebo/Vulkan, VA-API, QSV ou CUDA avec repli logiciel ; désentrelacement et cadence source.
- Composition de sous-titres correcte avant/après tone mapping et dimensions toujours compatibles encodeur.

Sortie : comparaison objective des couleurs et absence de niveau noir/gris ou sous-titre surexposé sur le corpus HDR.

### Étape 49 — 0.4.9 — performance NAS et GPU

- Détection Intel QSV/VA-API, NVIDIA NVENC/NVDEC, AMD VA-API/AMF et V4L2 M2M lorsque disponible.
- Pipelines zéro-copie, limites thermiques/mémoire, files prioritaires et admission control par coût estimé.
- Dégrader résolution ou qualité avant l'échec et protéger scans, interface et lectures directes d'un transcodage lourd.

Sortie : tableau de capacité du NAS et tests simultanés Direct Play + transcodage + scan sans blocage UI.

### Étape 50 — 0.5.0 — qualification lecture 0.5

- Corpus de régression versionné par propriété technique et générateur légal de fixtures.
- Banc Web Chromium/Firefox/Safari, Android 8–16, Android TV, Windows et profils de TV/amplis connus.
- Tests de durée, A/V sync, seek, changement de piste, HDR, canaux, sous-titres, reprise et corruption partielle.

Sortie : rapport public avec résultat par cas, limites connues et aucun échec critique ouvert.

### Étape 51 — 0.5.1 — détection de fichiers v2

- Parseur par candidats avec confiance pour films, documentaires, concerts, courts-métrages, sagas, multi-parties et versions/editions.
- Séries SxxExx, 1x02, dates, numérotation absolue/anime, doubles épisodes, spéciaux et ordre DVD/diffusion.
- Empreinte technique, hash partiel, identifiants NFO/nom de fichier et regroupement multi-version sans déplacer les fichiers.

Sortie : plus de 99 % de parsing correct sur le corpus de noms et aucune fusion destructive automatique.

### Étape 52 — 0.5.2 — fédération de métadonnées

- NFO/local en priorité, TVmaze et Wikidata/Wikipedia sans clé, fournisseurs optionnels officiels/licenciés.
- Fusion champ par champ avec provenance, qualité d'image, langue, année/pays et identifiants croisés.
- Affiches film/série/saison/épisode, logos et fonds, repli français → anglais → image extraite.
- Cache conditionnel, quotas respectés, réparation planifiée et fonctionnement hors ligne après enrichissement.

Sortie : objectifs de couverture/faux positifs mesurés, jamais de scraping non autorisé.

### Étape 53 — 0.5.3 — revue et corrections durables

- File des correspondances ambiguës, recherche multi-source, comparaison visuelle et explication du score.
- Fusion/séparation de doublons, changement d'ordre d'épisodes, correction en masse et verrou par champ.
- Export NFO facultatif, journal d'audit et conservation de toute correction lors d'un nouveau scan.

Sortie : scénarios d'erreur réparables depuis l'interface sans SQL ni suppression de bibliothèque.

### Étape 54 — 0.5.4 — bibliothèques massives

- Journal incrémental SMB/NFS/local, stabilisation des fichiers en cours de copie et scan récupérable.
- Transactions par lots, FTS5, pagination/virtualisation, déduplication d'images et miniatures AVIF/WebP/JPEG négociées.
- Tests 10 000 films, 2 000 séries et 100 000 épisodes sur NAS de faible puissance.

Sortie : objectifs de latence atteints sans pic mémoire ni catalogue vide pendant un scan.

**Premier volet livré en 0.5.4** — lecture du catalogue. Un banc de montée en charge a mesuré l'accueil
à 2696 ms p95 et 1004 Kio pour 2000 films et 200 séries, contre une cible de 150 ms : un N+1 de 400
requêtes sur les séries, une recherche qui reconstruisait tout le catalogue et un index inutilisable
faute de colonne de tête. Après correction — fonction de fenêtrage, rails bornés par SQL, trois index,
pagination serveur avec tri et filtres en SQL, Web et Android paginés — l'accueil tient **35,9 ms p95**
et **78 Kio**.

À l'échelle que ce plan fixe lui-même — 10 000 films, 2 000 séries, 100 000 épisodes — la cible n'est
**pas** atteinte : l'accueil reste à 546 ms p95, dominé par l'évaluation de la disponibilité des séries,
répétée pour chacune des 2 000. La recherche, elle, est passée de 5011 ms à 390 ms après correction d'un
plan d'exécution qui balayait toute la table des médias par série. Détail, pistes et limites :
`VALIDATION_0.5.4.md`.

**Second volet livré** — écriture du catalogue. Défaut principal trouvé : une racine devenue illisible
ou vide — partage démonté, disque en veille, point de montage muet — faisait marquer indisponible
**toute** la bibliothèque, sans qu'aucune erreur ne soit levée. Deux garde-fous le refusent désormais,
avec confirmation possible. S'y ajoutent la stabilisation des fichiers en cours de copie, un journal
des fichiers restés à la porte exposé sur `/api/scans/skipped`, et la suppression d'une extraction
ffmpeg relancée indéfiniment pour toute fiche sans affiche.

Le regroupement des écritures en transactions a été implémenté puis **retiré** : le banc montre une
dispersion de ±102 % d'un passage à l'autre, largement supérieure à l'écart attribué au regroupement.
La reprise à points de reprise n'a pas été construite — une analyse interrompue ne perd déjà rien, et
seul le reparcours de l'arborescence subsiste, négligeable à cette volumétrie. Détail :
`VALIDATION_0.5.4.md`.

**Reste de l'étape 54** : déduplication d'images, miniatures AVIF/WebP négociées, FTS5, virtualisation
réelle des listes, et les mesures sur NAS de faible puissance.

### Étape 55 — 0.5.5 — expérience Web premium

- Accueil instantané et personnalisable, rails virtualisés, recherche tolérante, filtres combinables et collections.
- Fiches cohérentes film/série/saison/épisode, progression immédiate et navigation clavier complète.
- WCAG 2.2 AA, lecteurs d'écran, contraste, réduction de mouvement et interface responsive du mobile au 4K.
- **Excellence de lecture** : lecture stable de bout en bout, sans coupure ni rebuffering, meilleure
  que Plex en qualité comme en réactivité — Direct Play chaque fois que le client sait décoder,
  transcodage seulement en dernier recours et jamais à qualité dégradée sans raison mesurée,
  première image rapide, navigation dans le film immédiate, reprise fiable après incident réseau.

Sortie : parcours critiques automatisés au clavier, tactile et lecteur d'écran.

**Premier volet livré en 0.5.5** — trois défauts signalés sur l'usage réel, tous reproduits avant
correction. Les jaquettes du rail « Sélection » se rétractaient à 33 px de large : `.media-card` est un
bouton, blockifié comme enfant direct de la grille mais redevenu `inline-block` une fois enveloppé.
La négociation de lecture refusait à tort MKV, HEVC et les sources 4K — chaînes de codec incomplètes,
conteneur jamais sondé, et définition maximale déduite de la taille de l'écran plutôt que du décodage
réel ; le transcodage inutile qui s'ensuivait saturait l'admission et bridait à 1080p. S'y ajoutait un
second plafond, `capLevelToPlayerSize`, qui ramenait à 720p dans toute fenêtre non maximisée. Livrés
également : le choix manuel de la plage dynamique en cours de lecture, et la gestion du focus des
fenêtres modales — entrée, enfermement, retour. Détail : `VALIDATION_0.5.5.md`.

**Deuxième volet livré en 0.5.5** — la campagne de preuves a d'abord servi à trouver des défauts,
pas à confirmer un travail fait. L'audit axe a relevé cinq manquements sur cinq écrans : une liste
sans nom, une fiche détaillée qui se déclarait fenêtre modale **sans jamais avoir de nom**, et une
bannière en double — la fenêtre des profils est une `<section>` portant `role="dialog"`, ce qui lui
retire sa valeur de section et promeut son `<header>` interne en second repère du document. Les
budgets, eux, ont montré que le poids ne venait pas du code : `flixtunes-mark.png` (284 Kio) n'était
référencée par aucun code du client Web, et le son de démarrage partait en PCM non compressé
(266 Kio pour 1,42 s). Premier affichage ramené de **731 à 206 Kio**. Le manifeste annonçait par
ailleurs une icône 1254×1254 pour un fichier de 512×512. Livrés également : recherche insensible aux
accents, aux ligatures et à la ponctuation — `sort_title` n'abaissait que la casse, donc « amelie »
ne trouvait pas « Amélie » — ; réduction de mouvement appliquée aux défilements **demandés en
JavaScript**, que la règle CSS ne peut pas atteindre ; retour du focus depuis le lecteur, restauré
par identité puisque le lecteur remplace toute l'application ; et le nettoyage hérité du prototype
mis derrière un marqueur qui lui est propre — il était gardé par la seule *absence* d'un réglage, si
bien qu'une table de réglages réinitialisée effaçait toute la médiathèque.

**Excellence de lecture — premier volet.** Deux causes mesurées, pas supposées.

Les segments HLS duraient **10 secondes au lieu des 4 demandées**. `-hls_time` n'est qu'un souhait :
ffmpeg ne peut couper que sur une image-clé, et l'intervalle par défaut de libx264 — 250 images —
fait 10 s à 25 im/s. Le lecteur devait donc télécharger dix secondes avant d'afficher la première
image, et ne pouvait se déplacer que par pas de dix secondes. Mesuré sur une sortie réelle de 40 s :
4 segments de 10 s sans images-clés forcées, 10 segments de 4 s avec. Le chemin adaptatif les forçait
déjà ; le chemin à variante unique — celui qu'emprunte la majorité des lectures — ne les forçait pas.
Durée de segment et rythme d'images-clés tiennent désormais d'une seule constante.

Se déplacer au-delà de la portion encodée était **impossible** : le transcodage part du début et
encode linéairement, et la playlist ne porte aucun `#EXT-X-PLAYLIST-TYPE` tant que l'encodage tourne.
Le serveur sait maintenant démarrer une session à un point donné — `-ss` placé **avant** `-i`, donc
recherche dans le conteneur au lieu d'un décodage jeté — et annonce son décalage ; le lecteur
distingue le temps du flux de celui du film, et redemande une session quand la cible sort de la
fenêtre encodée. La relance attend l'immobilisation du curseur : la barre émet un événement par
pixel parcouru, et sans cette attente un seul glissement lancerait des dizaines de transcodages.
Corrigé au passage : le bouton « Reprendre » calculait sa position sur `video.duration`, c'est-à-dire
sur la portion encodée, et retombait donc près du début du film.

**Reste sur ce volet** : playlist complète déclarée d'avance avec segments produits à la demande —
la seule façon d'obtenir un déplacement instantané sans relance de session — mesures de première
image, de rebuffering et de reprise après incident réseau sur le NAS lui-même.

**État serveur et télécommande.** Les pages du catalogue étaient démontées à chaque changement de
vue : revenir sur Films retéléchargeait tout, écran de chargement compris, et perdait les pages déjà
parcourues. Elles s'affichent désormais aussitôt depuis ce qu'on sait, la vérification partant en
arrière-plan. Les pages accumulées par le défilement ne sont conservées que si la première page n'a
pas bougé — si l'ordre a changé, les garder afficherait des trous ou des doublons. Le cache est
oublié dès qu'une modification a eu lieu, jamais au simple changement de vue : c'est ce qui lui
laisse son intérêt. Vérifié par mutation — sans le cache, la grille repart vide.

Une télécommande n'a pas de touche de tabulation : l'application restait inutilisable sur un
téléviseur, alors qu'Android TV est une cible annoncée. Les quatre flèches déplacent maintenant le
focus par géométrie, en pénalisant l'écart latéral pour ne jamais sauter en diagonale, sans
enroulement aux bords, et en laissant leurs flèches aux champs où elles ont déjà un sens — la barre
de progression du lecteur en fait partie. Le choix de la cible est une fonction pure, éprouvée sans
navigateur ; c'est elle qui contient toute la difficulté.

**Filtres combinables.** Le genre manquait — non parce que TMDB ne le fournit pas, mais parce que le
champ `genres` de ses réponses n'était jamais lu ni stocké. Il l'est maintenant, dans une table dédiée
plutôt qu'une colonne texte : « Action, Aventure » obligerait à chercher par sous-chaîne, ce qui n'est
pas indexable et ferait trouver « Action & Aventure » quand on demande « Action ». Deux genres cochés
ensemble exigent les deux — une comédie d'action, pas la réunion des deux rayons. L'année, présente en
base mais jamais filtrable, se règle par décennie. Les trois critères se croisent avec l'état et la
recherche, en SQL et avant le découpage en pages : un décompte juste sur la première page mais faux
ensuite tromperait plus qu'un filtre absent. Les genres n'apparaissent qu'après une analyse des
métadonnées : un catalogue analysé avant cette version en est dépourvu.

**Collections, et des fiches liées qui le sont vraiment.** `belongs_to_collection` — la saga chez
TMDB — subissait le même sort que les genres : présent dans la réponse, jamais lu. Il l'est
maintenant. Surtout, la section « à voir ensuite » tirait **douze films au hasard** : elle promettait
un rapprochement sans en offrir aucun, et sur deux mille films le hasard ne tombe pratiquement jamais
juste. Elle propose désormais la saga d'abord, dans l'ordre de sortie, puis les films partageant le
plus de genres — et **rien** quand il n'y a rien. Une section vide dit la vérité sur l'état de la
médiathèque ; une section pleine de liens inventés ment.

**Preuves visuelles multi-viewports.** La limite que je répétais depuis le début de l'étape — jsdom
n'a pas de moteur de rendu, donc aucun test ne peut dire qu'une page déborde à 320 px — est levée.
`scripts/viewports.mjs` mesure l'application réellement rendue sur 4 écrans × 7 largeurs, de 320 px
au 4K, zoom 200 % compris : **28 combinaisons, aucun débordement**.

Deux points de méthode, appris en se trompant. Une capture d'écran ne suffit pas : Chrome sans
interface impose une fenêtre d'au moins 504 px, si bien qu'une capture demandée à 320 px est rendue à
504 puis **rognée** — la page paraît coupée alors qu'elle va bien, et j'ai signalé un faux défaut
avant de m'en apercevoir. La sonde charge donc l'application dans un cadre à la largeur voulue, qui a
son propre viewport et fait répondre les requêtes de média pour de bon. Second point : les éléments
d'un conteneur défilant sont ignorés, un carrousel dépassant par construction.

**LCP / INP / CLS mesurés.** `scripts/vitals.mjs` pilote Chrome par son protocole de débogage, sur
le client construit servi par le serveur — la topologie de production — et évalue les mesures dans la
page elle-même. Aucune dépendance ajoutée : Node embarque désormais un client WebSocket.

Relevé, cache vidé et service worker contourné à chaque mesure : accueil **LCP 1564 ms / FCP 1500 ms**,
films **LCP 544 ms**, films sur téléphone **312 ms**, séries **328 ms** ; **CLS = 0 partout** ; coût
d'un appui 12 à 16 ms. Le CLS nul valide le travail d'ossature — les rails occupent leur place exacte
pendant le chargement, donc rien ne saute.

Trois fausses pistes, toutes instructives. Une capture d'écran ne prouve rien à petite largeur :
Chrome sans interface impose une fenêtre d'au moins 504 px et rogne le reste. `--virtual-time-budget`
ne convient pas : l'application garde une connexion ouverte, le temps virtuel reste suspendu et un
minuteur posé dans la page n'arrive jamais à échéance. Enfin, vider le cache HTTP ne vide pas celui du
service worker — sans le contourner, tout sauf la première mesure paraissait bien meilleur qu'une
vraie première visite.

Ces chiffres viennent de la machine de développement. **Le relevé sur le NAS reste à faire** : son
Celeron n'a rien à voir avec ce processeur, et le réseau local est ici absent.

**Arbre d'accessibilité vérifié.** Un lecteur d'écran ne lit pas le HTML : il lit l'arbre que le
navigateur calcule à partir du HTML, du CSS et des attributs ARIA. `scripts/a11y-tree.mjs` inspecte
cet arbre sur l'application réellement rendue — ce que jsdom ne sait pas produire, faute de calculer
la visibilité, l'héritage de `aria-hidden` ou le nom accessible dans tous les cas. Résultat : **104
commandes nommées sur l'accueil**, 38 sur Films, aucun repère indiscernable, aucune hiérarchie de
titres rompue, sur les quatre écrans.

Une erreur de méthode corrigée en cours de route : l'ordre des nœuds rendus par `getFullAXTree` ne
suit pas celui du document. La hiérarchie des titres paraissait rompue sur Séries — un `h2` semblait
précéder le `h1` — alors que la source dit l'inverse. Les titres sont désormais relus depuis le
document, seul à faire foi sur l'ordre de lecture.

Ce contrôle attrape le mécanique. **Un essai avec un vrai lecteur d'écran reste à faire par une
personne** : aucun outil ne juge la pertinence d'un libellé ni la fluidité d'un parcours.

**Jetons de style et système de composants.** Les valeurs de style avaient dérivé : quinze rayons à
9 px, douze à 10 px, huit à 8 px, six à 12 px — des arrondis censés être identiques et qui ne
l'étaient que par hasard ; des transitions à .18, .2 et .22 s. Les jetons nomment désormais ce qui
existe, **sans rien redessiner** : seules les correspondances exactes sont devenues des jetons, et la
dérive est consignée dans `docs/SYSTEME_COMPOSANTS.md` comme une décision de conception à prendre,
pas comme un nettoyage à faire en passant. Une échelle fluide d'espacement et de typographie est
définie et documentée, non adoptée : l'appliquer déplacerait l'existant, et ce déplacement doit être
voulu.

L'outil qui rend cela sûr est `scripts/geometrie.mjs` : il relève la géométrie des éléments
structurants à trois largeurs sur deux écrans, et compare deux états. Après la pose des jetons,
**six combinaisons, aucun déplacement**. Une retouche censée être sans effet visuel qui déplacerait
une jaquette de 40 px n'est pas ce qu'on croyait faire — c'est exactement ce que cet outil rend
visible.

Au passage, une règle de méthode apprise deux fois : `@fastify/static` indexe son dossier au
démarrage. Reconstruire le client sans redémarrer le serveur fait servir des fichiers qui n'existent
plus, et toutes les mesures deviennent absurdes.

**Lecteur indépendant du catalogue.** Il exigeait une fiche complète déjà chargée : on ne pouvait y
entrer que depuis une page de catalogue, et un rechargement en plein film renvoyait à l'accueil. Il ne
reçoit plus qu'un identifiant et va chercher lui-même ce dont il a besoin. Le corps du lecteur est
monté seulement une fois la fiche là, plutôt que de traiter son absence à chaque ligne pour un état
qui ne dure qu'un instant. Gain concret : une adresse de lecture, donc **une lecture qui survit à un
rechargement**, et un contrat que les autres clients peuvent réutiliser sans reproduire la forme du
catalogue.

**Une découverte qui invalide des vérifications antérieures.** `apps/web/tsconfig.json` contient
`"files": []` et ne fait que référencer d'autres projets : `tsc --noEmit -p tsconfig.json` ne vérifie
**rien**. Tous les contrôles de types que je croyais avoir faits sur le client au cours de cette étape
étaient vides de sens. La bonne commande est `tsc -b`, celle du script `typecheck` du dépôt. Passé à
`tsc -b`, il a immédiatement révélé une erreur introduite plus tôt dans l'étape : en faisant passer la
fiche détaillée de `<article>` à `<div>` pour l'accessibilité, le type du `ref` ne correspondait plus.
Les tests passaient, le contrôle de types était creux, et l'erreur aurait éclaté à `pnpm validate`.

**Playlist déclarée d'avance : étudiée, mesurée, non livrée.** L'idée est de publier la playlist
entière dès le départ et de produire chaque segment à la demande — c'est ce qui supprimerait la
relance de session au déplacement. Éprouvée sur un fichier de test de 60 s, elle bute sur deux
obstacles précis :

1. **Les segments produits séparément repartent tous de zéro.** `-ss` avant `-i` remet les
   horodatages à zéro, et ni `-output_ts_offset` ni `-copyts` ne les replacent sur la ligne de temps
   du film dans ce montage. hls.js sait recaler un segment fMP4 à partir du cumul des `EXTINF`, donc
   ce n'est pas rédhibitoire — mais cela fait de la playlist la seule autorité sur le positionnement.
2. **Les durées réelles ne valent pas la durée nominale.** Mesuré : 4,023 s pour le premier segment,
   4,040 s pour les suivants, là où la playlist annoncerait 4,000 s. La cause est la granularité des
   trames AAC — 1024 échantillons, soit 21,3 ms à 48 kHz — qu'une coupe à 4 s ne respecte jamais.
   Sur un film d'une heure, l'écart cumulé atteint **21 à 36 secondes** : la correspondance entre le
   temps demandé et le segment servi dérive progressivement.

Le second point condamne une playlist annoncée avec des durées nominales. Deux issues connues : livrer
l'audio en piste séparée, pour que les segments vidéo tombent exactement sur les images-clés ; ou
calculer d'avance la durée exacte de chaque segment à partir du compte de trames AAC. Les deux sont
des chantiers d'architecture, pas un ajustement.

Rien n'a été livré sur ce point : une chaîne de segments à la demande à moitié validée mettrait en
péril exactement ce qui compte le plus — la stabilité de la lecture — et cet environnement ne permet
pas de la vérifier sur un vrai film. Le déplacement fonctionne aujourd'hui par relance de session au
point visé, ce qui est éprouvé.

**Dette de test soldée : la suite écrivait dans la base du serveur.** `correction-persistence.test.ts`
créait une bibliothèque réelle par cas, la scannait, et ne nettoyait que les dossiers du disque — pas
les lignes en base. Trois bibliothèques s'y ajoutaient à **chaque exécution** : vingt-sept avaient fini
par s'accumuler, toutes pointant vers des dossiers temporaires depuis longtemps effacés. Elles
faussaient les comptages des autres fichiers, qui interrogent la même base — c'est la cause des tests
qui se polluaient mutuellement, diagnostiquée trois fois au cours de l'étape sans que la racine soit
traitée.

S'y ajoutait un piège de schéma : `media_items.library_id` est en `ON DELETE SET NULL`. Supprimer une
bibliothèque ne supprime pas ses médias, elle les **détache** — ils deviennent invisibles, les requêtes
exigeant une bibliothèque, mais restent en base. Les quatre fichiers concernés les retirent désormais
explicitement.

Enfin, la suite dispose de son propre répertoire de données (`apps/server/.vitest-data`). Sur cette
machine l'ancien comportement était sans conséquence visible ; sur une installation où `data/` contient
une vraie médiathèque, une suite de tests aurait écrit dedans.

Base nettoyée et compactée : **119,3 Mio → 0,4 Mio**, l'essentiel étant des pages libérées par un
ancien banc d'essai à 110 000 lignes. Une exécution complète ne laisse plus rien.

**Reste de l'étape 55** : le relevé des signaux **sur le NAS lui-même** — la seule mesure qui décrive
l'appareil réel — et, côté lecture, la playlist complète déclarée d'avance avec segments produits à la
demande, qui supprimerait la relance de session au déplacement.


### Étape 56 — 0.5.6 — Android mobile et TV de référence

- Media3 avec capacité réelle par appareil, tunneling, frame-rate matching, passthrough et changement de piste fiable.
- UI mobile tactile, UI TV 10-foot distincte, focus D-pad prévisible, MediaSession, PiP et reprise après mise en veille.
- Télécommande mobile du lecteur TV et lecture directe NAS → TV sans relai par le téléphone.

Sortie : matrice d'appareils réels et tests instrumentés Compose/Media3 sans régression Web.

**Premier volet livré en 0.5.6 — la chaîne de construction d'abord.** Gradle ne démarrait pas sur ce
poste : « Unable to establish loopback connection », avant même la lecture du projet. Le message
désigne le réseau ; il n'y était pour rien. Depuis Java 17, le sélecteur NIO par lequel le lanceur
Gradle et son démon se parlent se construit autour d'un tuyau bâti sur une **socket de domaine
Unix**, créée dans le répertoire temporaire. Ce répertoire est annoncé ici sous sa forme courte 8.3,
`C:\Users\ANTUNE~1\AppData\Local\Temp`, et `connect` sur un tel chemin échoue avec « Invalid
argument ». Isolé en réduisant le cas à `Selector.open()` seul, jusqu'à
`sun.nio.ch.UnixDomainSockets.connect0`.

Ni `GRADLE_OPTS` ni `org.gradle.jvmargs` ne corrigent le tir — le journal du démon montre qu'il
démarre sans la propriété. Ce qu'il faut déplacer, c'est le répertoire : `TEMP` et `TMP`, hérités par
tous les processus de la chaîne. `build-apk.ps1` s'en charge et enchaîne la validation complète.
Restent utiles, pour vérifier sans payer les dix minutes d'un build : `typecheck.ps1`, qui passe tout
le Kotlin au compilateur, et `test.ps1`, qui exécute les tests JVM.

**Lecture Android.** Quatre défauts traités, tous nommés au dossier. **La cadence d'affichage n'était
pas accordée** : un film à 23,976 images par seconde sur un panneau à 60 Hz impose une image pendant
trois rafraîchissements puis la suivante pendant deux, et les mouvements lents avancent par à-coups —
le défaut de fluidité le plus visible de la chaîne, et le seul qu'aucun débit ne corrige. Le lecteur
demande maintenant le mode dont la fréquence est un multiple entier de la cadence, à définition
constante : en changer rallume l'écran et fait parfois retomber la chaîne HDR.

**Toute panne de lecture menait au transcodage.** Une coupure de Wi-Fi — la plus courante sur un NAS
domestique, et la seule qui se répare seule — lançait donc le NAS dans une conversion inutile. Media3
numérote ses erreurs par familles : réseau, analyse, décodage, sortie audio. Chacune appelle
désormais sa réponse, et le codec n'est mis en cause que lorsque le décodeur a réellement refusé.

**Le mode tunnel** est activé sur téléviseur — le matériel y synchronise lui-même l'image et le son,
ce que l'application ne fait qu'approximativement — mais plusieurs téléviseurs l'annoncent et le
rendent mal. Devant un refus de décodage, c'est lui qu'on écarte en premier : le perdre coûte un peu
de synchronisation, tandis qu'accuser le codec priverait l'appareil de lecture directe sur tous les
films qui l'emploient.

**La reprise après destruction du processus** repartait au mauvais endroit. Android recrée l'activité
avec l'intention d'origine, celle du début de séance : un film tué à 74 % reprenait à 10 %. Ce que
l'activité sauvegarde juste avant de disparaître prime maintenant, sans reposer la question de la
reprise — on y avait déjà répondu.

**Quarantaine des codecs, côté Android.** Un appareil annonce ce qu'il sait décoder et le serveur le
croit : c'est ce qui permet la lecture directe. La déclaration ment parfois, et le serveur ne peut
pas le constater — en lecture directe il n'a fait que servir le fichier. Le client Android signale
donc l'échec, et le dément dès qu'une image apparaît. Web et Android partagent la même règle.

**Deuxième volet livré en 0.5.6 — les pistes, en lecture directe.** Le serveur ne choisit qu'en
conversion : il fabrique alors un flux et n'y met qu'une piste. En lecture directe — c'est-à-dire
chaque fois que tout se passe bien — il sert le fichier entier, et personne ne choisissait. Media3
gardait la piste par défaut du conteneur, souvent l'anglais sur un fichier multilingue, alors que le
profil demandait le français. Le défaut se remarque immédiatement et passe pour une panne.

Le choix suit maintenant l'ordre du profil sans le réinterpréter, reconnaît les codes équivalents —
`fr`, `fra`, `fre`, `fr-FR`, qu'un fichier sur deux écrit autrement —, préfère le multicanal à langue
égale et n'impose jamais une audiodescription à qui ne l'a pas demandée.

Les sous-titres souffraient du même angle mort, aggravé d'un oubli : leurs préférences n'étaient même
pas transmises au lecteur. Le mode « forcé », qui est le réglage par défaut, demande une attention
particulière — ces sous-titres ne traduisent pas le film mais ce qui reste étranger dedans, et n'ont
de sens qu'avec une bande son qu'on comprend. Ils ne s'affichent donc que dans la langue de la piste
sonore effectivement retenue, jamais par-dessus un doublage étranger. Le mode « toujours » cherche
une piste complète dans l'ordre des préférences, se rabat sur une forcée à défaut, et n'affiche
jamais une langue que personne n'a demandée. Une piste pour sourds et malentendants ne l'emporte
jamais sur une piste ordinaire de la même langue.

La préférence « langue originale » a demandé de rouvrir la chaîne jusqu'au fournisseur. TMDB donne la
langue de tournage, et FlixTunes la lisait déjà — pour choisir les affiches — avant de la jeter. Elle
est désormais conservée en base, distincte de la langue des textes demandés, et transmise au lecteur :
sans elle, rien ne distingue la piste japonaise d'un film japonais du doublage japonais d'un film
américain. Colonne migrée, valeur reprise du fournisseur, exposée à la lecture, honorée par le client.

**Troisième volet livré en 0.5.6 — deux surfaces, une seule base de code.** L'écart entre téléviseur
et téléphone vivait sous forme de quarante-huit `if (isTv)` disséminés dans les écrans, le drapeau
devant être passé de composable en composable pour les atteindre. Aucune des deux surfaces n'était
lisible d'un seul tenant, tout ajout devait penser aux deux cas à la fois, et vérifier l'une obligeait
à afficher l'autre. Ces différences sont désormais réunies dans un `Gabarit` — dix-neuf grandeurs,
deux valeurs chacune — fourni par le contexte de composition : plus un seul `if (isTv)` dans les
écrans, et les deux surfaces se relisent chacune en un bloc.

Ce n'est pas qu'une affaire de tailles. Sans pointeur, tout élément actionnable doit pouvoir recevoir
le focus et se distinguer quand il l'a : le gabarit porte donc aussi cette règle-là, séparément de
l'aspect. L'élément visé avance vers le spectateur et s'entoure d'un liseré ; au doigt, l'agrandissement
vaut 1 et l'effet disparaît de lui-même, sans condition à écrire.

**Quatrième volet livré en 0.5.6 — le lecteur Android à parité stricte avec le Web.** Il en était
loin, et la barre de progression le montrait : en conversion, le serveur n'encode pas le film d'un
coup mais une fenêtre qui s'allonge. Le lecteur ne connaissant que cette fenêtre, un film de deux
heures s'annonçait à trois minutes, le temps total grandissait pendant la lecture, et le curseur
refusait d'aller au-delà de ce qui était produit. La traduction entre temps du film et temps du flux,
que le Web fait depuis l'étape 55, existe maintenant des deux côtés — et viser hors de la fenêtre
redemande une session au point voulu au lieu de buter.

Sont venus avec : le sélecteur de qualité listant les variantes du manifeste, le panneau « Infos
lecture » avec les mêmes intitulés et le même ordre qu'à l'écran Web — un intitulé différent d'un
appareil à l'autre oblige à traduire mentalement pour comparer une panne —, le compteur d'images
perdues, relevé sur ExoPlayer parce que le `MediaController` de l'activité ne l'expose pas, et le
sélecteur de plage dynamique. Ce dernier ne s'affiche que si le fichier dépasse le SDR, exactement
comme sur le Web : proposer de convertir ce qui est déjà converti ferait croire à un réglage. Il sert
quand un écran annonce un HDR qu'il rend mal, cas où la conversion serveur vaut mieux que la
restitution locale ; comme la plage se décide à la négociation, le choix redemande une session en
retenant la position.

**Cinquième volet livré en 0.5.6 — cache d'images, bascule réseau, textes.** Les jaquettes se
retéléchargeaient à chaque ouverture : un cache disque les retient désormais entre deux sessions. Le
passage du Wi-Fi aux données mobiles — ou l'inverse — cassait la lecture au lieu de la reprendre. Et
les quatre-vingt-sept chaînes écrites en dur dans le Kotlin sont sorties dans `strings.xml` : aucune
traduction n'était possible tant qu'elles y restaient, ni aucune relecture d'ensemble.

**Sixième volet livré en 0.5.6 — l'accélération matérielle ne pouvait pas démarrer.** Sept révisions
d'empaquetage l'ont cherchée ailleurs : une bibliothèque GMM absente, une version de pilote mal
appariée, une glibc trop récente. Chacune était un vrai défaut, chacune a été corrigée, et le NAS
continuait de convertir sur son processeur.

La cause tenait à la manière dont FFmpeg est construit. Les distributions de BtbN passent libva par
**`implib-gen`** : la bibliothèque n'est ni liée ni embarquée, elle est ouverte par `dlopen` au
premier appel. Le paquet embarquait donc `libva.so.2`, utile, mais pas `libva-drm.so.2` — celle qui
porte `vaGetDisplayDRM`, la seule fonction capable d'ouvrir un nœud de rendu. Le message obtenu ne
parlait même pas d'un pilote : « failed to load library `libva-drm.so.2` via dlopen ».

Le contrôle de dépendances du paquet ne pouvait pas le voir : il lit les `DT_NEEDED`, et une
bibliothèque ouverte à l'exécution n'y figure pas. Il déclarait donc complet un paquet dans lequel
VA-API n'avait aucune chance de s'initialiser. `verify-dlopen.py` relève désormais, dans les binaires
qui seront livrés, la liste réelle de ce que `implib-gen` enveloppe, et refuse de produire un paquet
où l'essentiel manque. Vérifié dans les deux sens : il échoue sur la r12 telle qu'elle a été livrée,
il passe sur la r13.

Une seconde vérification a suivi le même raisonnement — et s'est trompée, ce qui mérite d'être écrit.
FFmpeg est compilé contre une libva récente, tandis que celle du paquet venait de bullseye, la seule
base dont la glibc corresponde à celle d'ADM. Huit fonctions manquaient à l'appel. Le contrôle les a
listées, et le jugement porté fut : « aucune n'est sur le chemin d'une conversion ». Il était faux.
`vaMapBuffer2` s'y trouve, et son absence ne dégrade pas la conversion — `implib-gen` **lève une
assertion et abandonne le processus** :

    implib-gen: libva.so.2: failed to resolve symbol 'vaMapBuffer2' via dlsym
    ffmpeg: _libva_so_2_tramp_resolve: Assertion `0' failed. Aborted

Le NAS l'a montré après que ce jugement eut été écrit en commentaire au lieu d'être vérifié. La leçon
est dans le contrôle : ce qu'on déclare « hors chemin » doit l'être par preuve, jamais par
ressemblance de nom, parce que la sanction n'est pas une lenteur mais un transcodage tué.

**Septième volet livré en 0.5.6 — la négociation croyait le client sur parole.** Le serveur ne teste
jamais ce qu'un appareil sait décoder : il le lui demande. Cette confiance est mal placée bien plus
souvent qu'on ne le pensait. Aucun navigateur ne déclare le conteneur Matroska que plusieurs lisent ;
`decodingInfo` répond « décodable mais peut-être pas fluide » pour du HEVC 4K décodé en matériel, ce
qui était pris pour un refus ; ni AC-3 ni E-AC-3 n'étaient sondés, alors que Chrome les lit sur la
plupart des postes Windows ; et une marge de vingt pour cent sur le débit refusait un fichier de
26,5 Mb/s sur un chemin mesuré à 29,4. Chacune de ces prudences, seule, envoyait en conversion 4K —
que le NAS ne produit pas — un film qui se lisait sans peine.

La règle est donc devenue celle-ci : **on sert le fichier tel quel, et si ça ne marche pas on
convertit.** L'échec se rattrape par trois signaux déjà mesurés — erreur du lecteur, images perdues,
coupures répétées. Ne subsistent que les refus portant sur ce que la lecture directe ne peut
structurellement pas faire : incruster des sous-titres, appliquer une normalisation, jouer une piste
autre que celle du fichier, respecter un plafond de définition réglé à la main, et sortir un son que
le lecteur ne décode pas — ce dernier étant le seul échec du lot qui ne lève ni erreur ni compteur,
un film muet n'ayant aucun repli.

La correction la plus instructive porte sur le débit. La bande passante est relevée par `hls.js`
pendant la session en cours : pendant une conversion, elle mesure la vitesse de l'encodeur et non
celle du réseau. Le garde-fou se nourrissait donc de ce qu'il causait — on convertit, c'est lent, donc
le réseau est déclaré insuffisant, donc on convertit. Un cercle fermé, invisible depuis le serveur.
Seul subsiste le plafond que le lecteur pose après deux coupures réelles : celui-là consigne un fait.

Trois filets rendent ce défaut sûr : la quarantaine par appareil, consultée sur la liste brute des
codecs — le filtrage la rendait invisible, ce qui faisait ressembler un codec défaillant à un codec
non déclaré ; la mesure des images perdues, seul mode d'échec muet du décodage ; et un repli **en deux
marches**, direct → remux → conversion. Cette dernière a corrigé une régression que l'essai
introduisait : Firefox et Safari ne lisant pas le Matroska, un repli droit vers la conversion les
aurait fait passer d'un remux, qui copie l'image au bit près, à un transcodage complet.

**Reste sur ce volet** : parcours D-pad filmés, PiP, Macrobenchmark, tests instrumentés Compose/Media3,
matrice d'appareils réels et rapport batterie/mémoire — tous demandent des appareils, et aucun ne peut
être établi depuis ce poste.

### Étape 57 — 0.5.7 — lecteur Windows home cinéma

- Moteur libmpv/libplacebo ou équivalent qualifié, D3D11VA/Vulkan, cadence écran et bitstream HDMI.
- Mode fenêtré/plein écran, raccourcis, multi-écrans, HDR Windows et diagnostic identique aux autres clients.

Sortie : Direct Play prioritaire de la matrice locale et installateur/mise à jour sans perte de configuration.

### Étape 58 — 0.5.8 — direct, cast, multiroom et Live TV

- Contrôle d'un lecteur TV depuis mobile/Web, transfert de session et synchronisation locale optionnelle.
- Casting avec flux NAS → cible direct, sans faire transiter la vidéo par le contrôleur.
- Module Live TV/DVR optionnel : M3U/XMLTV, timeshift, enregistrement, conflits de tuners et lecture en cours d'enregistrement.

Sortie : changement de contrôleur sans coupure et tests de timeshift/seek/enregistrement sur flux de test légaux.

### Étape 59 — 0.5.9 — analyse intelligente locale

- Détection locale d'intros par empreinte audio, génériques par image/audio et chapitres/vignettes de timeline.
- Boutons passer/manuellement/automatiquement par profil, correction des marqueurs et aucun abonnement requis.
- Synchronisation de sous-titres par activité vocale optionnelle et traitement basse priorité planifié.

Sortie : précision mesurée, faux sauts impossibles sans confiance suffisante et correction utilisateur persistée.

### Étape 60 — 0.6.0 — résilience et mises à jour signées

- Paquets Windows/Linux/ASUSTOR/Android reproductibles, manifeste signé, canal stable/bêta et retour arrière applicatif.
- Sauvegarde avant migration, contrôle d'intégrité, reprise après coupure et restauration testée automatiquement.
- Chaos tests : perte réseau, disque plein, FFmpeg tué, NAS redémarré et fournisseur indisponible.

Sortie : mise à jour sans perte et diagnostic/restauration utilisables sans terminal.

### Étape 61 — 0.6.1 — confidentialité, comptes et administration

- Fonctionnement LAN sans compte cloud, permissions administrateur/adulte/enfant/invité et restrictions par bibliothèque/classification.
- Sessions locales sécurisées, journal d'accès, limites de débit, audit de dépendances et secrets hors sauvegardes exportables.
- Tableau de bord temps réel : lectures, mode, CPU/GPU, température, débit, erreurs et action corrective.

Sortie : audit de sécurité, tests de permissions et aucune dépendance cloud obligatoire.

### Étape 62 — 0.6.2 — qualification comparative finale

- Banc comparatif reproductible face aux comportements documentés de Plex : détection, première image, seek, transcodage minimal, sous-titres, HDR, clients et reprise.
- Publier mesures, échecs et limites ; corriger tout bloqueur avant d'avancer la version.
- Aligner documentation utilisateur, administrateur et développeur sur les fonctions réellement testées.

Sortie : FlixTunes ne revendique « meilleur » que sur les axes où le banc mesuré le prouve.

## Dossiers de réalisation individuels — étapes 47 à 62

Les fiches ci-dessous rendent explicite le niveau de profondeur attendu. Aucune validation d'une étape ne peut être héritée, mutualisée ou reportée sur une autre.

### Dossier de l'étape 47 — streaming adaptatif local

- **Architecture :** ordonnanceur de sessions, estimateur de débit glissant, profils HLS et DASH générés depuis la résolution et le débit source, segments adressés par contenu, cache partagé borné et état de reprise sérialisé.
- **Décisions :** Direct Play reste prioritaire ; l'ABR n'est activé que pour un client ou un réseau qui le nécessite. Les changements de qualité conservent audio, sous-titres, timeline et horodatages sans recréer la progression.
- **Cas limites :** Wi‑Fi oscillant, veille mobile, changement d'adresse du NAS, segment incomplet, seek hors fenêtre, fichier encore copié, plusieurs clients demandant le même profil, cache plein et arrêt brutal de FFmpeg.
- **Preuves :** profils réseau reproductibles avec latence/perte, mesure première image/rebuffer/seek, comparaison fMP4 contre MPEG‑TS, test de reprise après coupure et contrôle qu'un flux direct ne consomme aucun encodeur.
- **Livrables :** moteur ABR, écran de statistiques de buffer, quotas administrables, corpus réseau, rapport 0.4.7 et procédure de diagnostic.

### Dossier de l'étape 48 — chaîne vidéo HDR et colorimétrie

- **Architecture :** modèle colorimétrique complet issu de FFprobe, négociation par écran, profils Dolby Vision, pipeline de tone mapping sélectionné selon le matériel et conservation des métadonnées statiques/dynamiques lorsque le conteneur cible le permet.
- **Décisions :** préserver le flux original si toute la chaîne l'accepte ; sinon repli Dolby Vision vers HDR10 compatible, puis HDR vers SDR. Toute perte de format est annoncée avant la lecture.
- **Cas limites :** Dolby Vision double couche, profil 5 sans couche HDR10, HDR10+, HLG, plage complète/limitée, 10/12 bits, chroma 4:2:2/4:4:4, vidéo entrelacée, rotation et sous-titre image HDR.
- **Preuves :** mires BT.709/BT.2020/PQ/HLG, captures mesurées, histogrammes et contrôles MaxCLL/MaxFALL ; tests CPU, QSV, VA‑API, CUDA/Vulkan et repli logiciel avec tolérance chiffrée.
- **Métrique d'acceptation :** aller‑retour SDR → HDR10 → SDR sur mires, PSNR mesuré contre la référence SDR et statistiques de luma. Un backend n'est retenu en sélection automatique qu'au‑dessus de 15 dB de PSNR et avec un YMAX à moins de 40 % de la référence. Référence 0.4.8 : zscale corrigé 17,40 dB, libplacebo 19,19 dB, chaîne 0.4.7 rejetée à 10,88 dB.
- **Livrables :** graphe de pipeline visible dans le diagnostic, fixtures HDR légales, rapport de fidélité colorimétrique et liste précise des profils directs par client.

### Dossier de l'étape 49 — capacité NAS, GPU et admission

- **Architecture :** sonde de GPU au démarrage, micro-benchmark non destructif, modèle de coût par codec/définition/HDR, files direct/remux/transcode/scan séparées et admission control tenant compte de RAM, température et sessions actives.
- **Décisions :** les lectures directes ne sont jamais affamées par un scan ; priorité configurable aux lectures ; repli matériel vers logiciel une seule fois ; réduction de qualité proposée avant rejet d'une nouvelle session.
- **Cas limites :** pilote présent mais inutilisable, périphérique `/dev/dri` inaccessible, mémoire GPU saturée, throttling thermique, NAS sans GPU, encodeur limité en sessions et perte du GPU en lecture.
- **Preuves :** Direct Play + deux transcodages + scan simultanés, fuite mémoire sur huit heures, arrêt/reprise du pilote, température et latence UI suivies au percentile.
- **Métrique d'acceptation :** modèle de coût ajusté sur deux définitions et vérifié sur au moins trois scénarios indépendants — dont une échelle ABR complète — avec moins de 10 % d'écart. Un accélérateur n'entre en sélection automatique qu'au‑dessus de 80 % du débit de l'encodage logiciel mesuré sur la même machine. Référence 0.4.9 : modèle exact sur 1080p, réduction 1080p→720p et échelle ABR ; Quick Sync écarté à 32 % du débit logiciel.
- **Livrables :** tableau « capacité de mon serveur », calibrage conservé par version de pilote, alertes actionnables et rapport par architecture x86‑64/ARM64.

### Dossier de l'étape 50 — qualification lecture 0.5.0

- **Architecture de test :** manifeste de corpus décrivant conteneur, codecs, profil, niveau, débit, cadence, HDR, canaux, sous-titres et résultat attendu ; fixtures synthétiques reproductibles et médias de référence dont les droits autorisent le test.
- **Matrice :** Chromium, Firefox, Safari, WebView Android, Media3 mobile/TV, Windows ; appareils bas/milieu/haut de gamme ; LAN, Wi‑Fi et reprise hors veille.
- **Cas limites :** durée inconnue, timestamps négatifs, piste par défaut incorrecte, fichier tronqué, index MKV absent, VFR, B‑frames, audio retardé, changement de piste et seek proche de la fin.
- **Preuves :** résultat machine lisible et rapport humain, synchronisation A/V mesurée, zéro échec critique, limites connues liées aux appareils documentées sans les masquer.
- **Métrique d'acceptation :** synchronisation A/V vérifiée à ±40 ms contre une valeur attendue déclarée par la fixture, et non simplement relevée. Toute fixture dont l'échec est toléré doit porter une limite écrite ; sans limite déclarée, l'échec est critique. Référence 0.5.0 : 47 cas, 0 échec critique, décalage nominal mesuré à 0 ms et décalage injecté de 500 ms retrouvé exactement.
- **Portée à ne pas confondre :** le banc rejoue la **décision serveur** face à des profils de capacité de référence. Il ne remplace pas la lecture réelle en navigateur et sur appareils, qui reste une preuve distincte de l'étape.
- **Livrables :** version 0.5.0 installable, rapport signé, hashes, restauration 0.4.x→0.5.0 testée et procédure de reproduction de chaque échec.

### Dossier de l'étape 51 — détection de fichiers v2

- **Architecture :** tokenizeur Unicode, générateur de candidats, règles typées film/série/spécial, score explicable, parseurs NFO/identifiants et empreinte partielle indépendante du nom.
- **Décisions :** année entre parenthèses prioritaire pour les films ; saison/épisode jamais déduits d'un nombre isolé sans contexte ; seuils distincts pour auto-validation, revue humaine et rejet.
- **Cas limites :** documentaires, concerts, éditions director's cut, parties CD1/CD2, remakes homonymes, anime absolu, épisodes datés, doubles épisodes, saison 0, mini-série, accents et noms multilingues.
- **Preuves :** corpus d'au moins 10 000 noms anonymisés/synthétiques, précision et rappel par catégorie, tests de mutations de noms et vérification qu'aucune opération ne déplace ni fusionne destructivement les fichiers.
- **Métrique d'acceptation :** 99 % de détections exactes sur le corpus, **et** 99 % sous chaque mutation de nom prise séparément. Un score élevé sur le seul corpus généré ne vaut pas preuve : c'est la mesure sous mutation qui atteste la robustesse. Référence 0.5.1 : 100 % sur corpus, de 99,33 % à 100 % sous mutation, le préfixe d'équipe `[Team]` ayant fait chuter la première mesure à 5,55 % avant correction.
- **Livrables :** explication du parsing dans l'administration, file d'ambiguïtés, export du corpus d'échec et rapport 0.5.1.

### Dossier de l'étape 52 — fédération de métadonnées

- **Architecture :** adaptateurs fournisseurs isolés, identifiants croisés, cache HTTP conditionnel, fusion par champ avec provenance, arbitre de langue et pipeline d'images contrôlant format, dimensions et contenu.
- **Décisions :** local/NFO et verrous utilisateur gagnent toujours ; titre et affiche suivent la langue de bibliothèque ; repli français→anglais→image extraite ; aucune source non autorisée n'est scrapée.
- **Cas limites :** fournisseur hors ligne, quota, résultat homonyme, année divergente, série relancée, saison sans affiche, image supprimée, titre traduit absent et métadonnée locale partielle.
- **Preuves :** jeu vérité films/séries/documentaires, couverture et faux positifs par fournisseur, simulation hors ligne après cache, contrôle des licences et test de stabilité lors d'un ré-enrichissement.
- **Livrables :** provenance visible par champ, état/latence/quota de chaque fournisseur, réparation ciblée et rapport 0.5.2.

### Dossier de l'étape 53 — correction, verrouillage et audit

- **Architecture :** commandes transactionnelles fusionner/séparer/rematcher, verrous par champ, historique avant/après, annulation, export NFO optionnel et règles de correction en masse prévisualisées.
- **Décisions :** aucune correction manuelle n'est écrasée ; toute action de masse affiche portée et conflits ; les doublons sont regroupés sans supprimer les versions physiques.
- **Cas limites :** saisons issues de deux dossiers, versions 4K/1080p, épisodes mal numérotés, doublon de provider, changement de langue et média déplacé entre bibliothèques.
- **Preuves :** cycles scan→correction→rescan→mise à jour, rollback après interruption et audit exhaustif ; restauration depuis sauvegarde avec mêmes verrous et associations.
- **Livrables :** centre de revue, comparaison côte à côte, journal filtrable, annulation et rapport 0.5.3.

### Dossier de l'étape 54 — bibliothèques massives

- **Architecture :** scanner incrémental à checkpoints, file persistante, transactions bornées, index FTS5, pagination par curseur, virtualisation UI et stockage d'images dédupliqué par hash.
- **Décisions :** un fichier n'est importé qu'après stabilisation taille/date ; un scan ne vide jamais le catalogue visible ; suppression logique puis purge différée ; reprise exacte après redémarrage.
- **Cas limites :** partage SMB lent, déconnexion, renommage massif, horloge NAS incorrecte, 100 000 épisodes, millions de fichiers non média et copie en cours pendant un scan.
- **Preuves :** jeux 10 000 films/2 000 séries/100 000 épisodes, p50/p95/p99 API et mémoire, redémarrage à chaque checkpoint, recherche concurrente et absence de verrou UI.
- **Livrables :** tableau de progression fiable, estimation restante, diagnostic des fichiers ignorés et rapport de capacité NAS 0.5.4.

### Dossier de l'étape 55 — expérience Web premium

- **Architecture :** état serveur mis en cache puis réconcilié, rails/fiches virtualisés, routeur avec retour de focus, design tokens responsive, composants accessibles et lecteur indépendant du catalogue.
- **Parcours :** accueil, films, séries, saison, épisode, recherche, reprise, historique, profil, administration et correction doivent rester cohérents au clavier, tactile et télécommande.
- **Cas limites :** écran 320 px, TV 4K, zoom 200 %, texte long, affiche absente, catalogue vide, chargement lent, session expirée et retour depuis le lecteur.
- **Preuves :** tests E2E visuels multi-viewports, axe WCAG 2.2 AA, navigation clavier seule, lecteur d'écran, budgets JS/CSS/image et mesure LCP/INP/CLS sur NAS.
- **Livrables :** système de composants documenté, parcours enregistrés, budgets bloquants en CI et rapport 0.5.5.

### Dossier de l'étape 56 — Android mobile et Android TV

- **Architecture :** couche API partagée, UIs Compose distinctes mobile/TV, Media3, profil de capacité remonté au serveur, cache d'images disque et MediaSession indépendante de l'activité.
- **Décisions :** surface TV optimisée D-pad à dix pieds ; mobile tactile et orientation ; flux NAS→TV direct ; piste/passthrough/frame-rate choisis depuis les capacités réelles du codec et de la sortie HDMI.
- **Cas limites :** Android 8, mémoire faible, changement Wi‑Fi/Ethernet, veille, rotation, PiP, télécommande déconnectée, codec annoncé mais défaillant et reprise après processus tué.
- **Preuves :** tests JVM, Compose, instrumentation Media3, Macrobenchmark démarrage/scroll, appareils et émulateurs ; lecture réelle H.264/HEVC/AV1, E‑AC‑3, sous-titres et HDR selon matériel.
- **Textes :** fait. Les quatre-vingt-sept chaînes écrites en dur dans le Kotlin sont sorties vers `strings.xml`
  — tant qu'elles y restaient, aucune traduction n'était possible et aucune relecture d'ensemble non plus.
- **Livrables :** APK mobile/TV signables, matrice appareil, rapport batterie/mémoire, parcours D-pad filmés et rapport 0.5.6.

### Dossier de l'étape 57 — client Windows home cinéma

- **Architecture :** shell natif et moteur libmpv/libplacebo qualifié, IPC avec le serveur, D3D11VA/Vulkan, Media Session Windows et mise à jour atomique.
- **Décisions :** Direct Play local prioritaire, bitstream seulement si la chaîne HDMI l'annonce, fréquence écran adaptée sans oscillation et HDR Windows conservé ou converti explicitement.
- **Cas limites :** multi-écrans SDR/HDR, changement d'écran en lecture, sortie HDMI perdue, veille, mode exclusif, clavier/télécommande et GPU ancien.
- **Preuves :** matrice GPU Intel/NVIDIA/AMD, analyse dropped frames/A‑V sync, bitstream vérifié sur ampli, installation/mise à jour/désinstallation sans perte serveur.
- **Livrables :** installateur, diagnostic identique au Web/Android, raccourcis documentés, crash dumps consentis localement et rapport 0.5.7.

### Dossier de l'étape 58 — contrôle direct, cast, multiroom et Live TV

- **Architecture :** protocole local authentifié de découverte/contrôle, propriété transférable de session, horloge de synchronisation multiroom et module Live TV/DVR isolé du catalogue VOD.
- **Décisions :** le contrôleur ne relaie jamais la vidéo ; la cible négocie directement avec le NAS ; Live TV reste optionnel et n'accepte que sources configurées par l'administrateur.
- **Cas limites :** contrôleur qui disparaît, cible en veille, deux commandes concurrentes, tuner occupé, guide absent, changement d'heure, émission prolongée et disque DVR plein.
- **Preuves :** transfert mobile→TV→Web sans perte de position, dérive multiroom mesurée, timeshift/seek/enregistrement simultanés et résolution déterministe des conflits tuners.
- **Livrables :** écran « appareils », permissions locales, planificateur DVR, récupération après coupure et rapport 0.5.8.

### Dossier de l'étape 59 — analyse intelligente strictement locale

- **Architecture :** workers basse priorité, empreintes audio inter-épisodes, détection visuelle de générique, stockage de marqueurs versionné et génération de vignettes/chapitres incrémentale.
- **Décisions :** seuil élevé avant proposition, seuil encore plus élevé avant saut automatique ; aucun faux saut irréversible ; corrections utilisateur verrouillées ; calcul suspendu dès qu'une lecture manque de ressources.
- **Cas limites :** cold open, générique variable, recap, épisode sans intro, musique réutilisée, crédits interrompus par scène et langues différentes.
- **Preuves :** vérité annotée par série, précision/rappel et taux de faux positifs, tests CPU/énergie, reprise de job, synchronisation vocale des sous-titres comparée à des offsets connus.
- **Livrables :** éditeur de marqueurs, politique par profil, planification nocturne, explication du score et rapport 0.5.9.

### Dossier de l'étape 60 — résilience et mises à jour signées

- **Architecture :** manifeste signé, artefacts reproductibles, migrations transactionnelles, sauvegarde vérifiée avant activation, deux emplacements applicatifs A/B et journal de reprise.
- **Décisions :** aucune mise à jour si sauvegarde ou signature échoue ; retour automatique à la version précédente si santé non obtenue ; données jamais rétro-migrées sans copie.
- **Cas limites :** courant coupé à chaque point de migration, disque plein, paquet tronqué, signature invalide, FFmpeg absent, permissions perdues et redémarrage NAS retardé.
- **Preuves :** chaos automatisé Windows/Linux/ASUSTOR, comparaison bit à bit des builds, restauration de bases anciennes et test de rollback en conservant profils/progressions/corrections.
- **Livrables :** installateurs, updater, canaux stable/bêta, centre de restauration sans terminal et rapport 0.6.0.

### Dossier de l'étape 61 — sécurité, confidentialité et administration

- **Architecture :** sessions locales à durée bornée, rôles et ACL par bibliothèque, secrets séparés, TLS local optionnel, journal d'audit, limitation de débit et inventaire SBOM.
- **Décisions :** aucun compte cloud requis ; télémétrie externe absente par défaut ; moindre privilège ; profils enfants filtrés côté serveur et non seulement dans l'interface.
- **Cas limites :** vol de jeton, brute force PIN, URL de média devinée, traversée de chemin, image distante hostile, CORS, partage NAS multi-utilisateur et sauvegarde exportée.
- **Preuves :** tests d'autorisation négatifs, analyse dépendances/SBOM, fuzz des entrées et audit des routes ; vérification qu'un profil ne peut lire, modifier ou découvrir une bibliothèque interdite.
- **Livrables :** assistant sécurité, journal lisible, rotation des secrets, procédure d'incident locale et rapport 0.6.1.

### Dossier de l'étape 62 — preuve comparative finale

- **Architecture du banc :** mêmes médias, serveur, réseau, client et chronométrage pour FlixTunes et Plex ; scénarios automatisés et résultats bruts conservés avec version de chaque composant.
- **Axes :** précision de détection, couverture d'affiches FR, première image, seek, rebuffer, transcodage minimal, CPU/GPU, sous-titres, langues, HDR, reprise, ergonomie et résilience.
- **Règles :** aucune comparaison sur une configuration favorisant artificiellement FlixTunes ; répétitions et intervalles de confiance ; échec publié ; revendication « meilleur » limitée aux résultats significatifs.
- **Preuves :** exécution sur NAS faible et puissant, Web/Android/TV/Windows, bibliothèque petite et massive, réseau stable/dégradé et mise à jour avec données existantes.
- **Livrables :** rapport reproductible 0.6.2, données brutes, limites connues, guide administrateur/utilisateur aligné et décision finale de disponibilité.

## Validation obligatoire de chaque étape

1. Tests unitaires du domaine et migrations.
2. Tests d'intégration avec fichiers audio/vidéo générés légalement.
3. Test de non-régression de toute la suite serveur/Web/Android.
4. Test visuel Web et D-pad/tactile selon l’étape.
5. Mesure de performance avant/après.
6. Paquet de mise à jour et restauration des données.
7. Note de validation listant aussi les limites restantes.

## Tenue du plan

Ces règles sont issues d'écarts constatés en cours de route ; elles s'appliquent à toutes les étapes restantes.

- **Aucune version n'entre dans `CHANGELOG.md` avant que son `docs/VALIDATION_<version>.md` n'existe.** L'étape 47 a été publiée sans note de validation : la dette est enregistrée dans `docs/VALIDATION_0.4.7.md` et doit être soldée avant la qualification 0.5.0 de l'étape 50.
- **Une note de validation ne rapporte que des résultats réellement mesurés.** Ce qui n'a pas pu être exécuté est listé sous « Reste à exécuter » avec la raison, jamais omis ni supposé.
- **Chaque étape qui produit une conversion définit une métrique chiffrée et un seuil**, pas seulement une observation visuelle. Une régression de qualité invisible à l'œil mais mesurable est un échec d'étape.
- **Un chemin matériel non mesuré sur le NAS cible n'est jamais choisi automatiquement.** Il reste derrière une variable d'environnement jusqu'à sa qualification, et tout échec relance la session sur le chemin logiciel.

### Prérequis d'environnement de développement

Le dépôt est exploité depuis un partage SMB. `pnpm install` y échoue par intermittence en laissant des
répertoires `node_modules/*_tmp_*` orphelins, ce qui casse ensuite l'exécution des suites de tests.
Avant toute recette d'étape : construire et tester sur un disque local NTFS, ou purger ces répertoires
temporaires avant de relancer l'installation.

## Ordre d'exécution

Les étapes sont strictement séquentielles. Une étape peut préparer du code pour la suivante, mais sa version n'est publiée qu'après tous ses critères. Les plages numériques ne sont que des repères de lecture : elles ne constituent ni des lots, ni des validations groupées. Chaque étape 43 à 62 possède sa propre livraison, sa propre recette et sa propre décision de passage.
