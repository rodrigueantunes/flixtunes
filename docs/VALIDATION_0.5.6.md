# Validation FlixTunes 0.5.6 — étape 56 (Android mobile et TV, chaîne de conversion)

## Périmètre traité

L'étape 56 telle que le plan la définit — surfaces Android distinctes, lecture Media3, pistes — et,
en cours de route, la chaîne de conversion matérielle du serveur. Ce second volet n'était pas prévu
ici : il s'est imposé parce que les défauts signalés sur Android renvoyaient tous au même endroit.

Cette note rapporte ce qui a été **exécuté**. Ce qui demande le NAS ou un appareil figure en fin de
document, sans être compté comme acquis.

## Le lecteur Android n'affichait pas ce qu'on croyait corriger

Le lecteur employait la barre de commandes de Media3. Le défaut n'était pas cosmétique : son temps
total ne vient pas de `getDuration()` mais de la `Timeline` du lecteur. Le `ForwardingPlayer` qui
traduit position et durée — en place depuis l'étape 55 — n'a donc aucun effet sur elle.

En conversion, cela donnait la position dans le film sur la durée de la fenêtre encodée, soit
« 1:23:45 / 0:03:20 », avec un curseur borné à ce qui était déjà produit. Corriger cela sans changer
de barre aurait demandé de fabriquer une fausse `Timeline` : mentir à Media3 pour qu'il dise vrai.

La barre est désormais la nôtre, en Compose, aux mêmes éléments et aux mêmes mots que le lecteur Web :
trois épaisseurs superposées — encodé, chargé, lu —, repères de chapitres, horloge avec la mention
« encodé », lecture/pause, ±10, Vitesse, Qualité, Image, Minuteur, PiP, Infos, badge de mode. S'y
ajoute un **sélecteur audio et sous-titres manuel**, qui n'existait pas du tout sur Android.

## Les définitions étaient annoncées à l'envers

`DeviceCapabilities` envoyait `maxWidth = physicalWidth` et `maxHeight = physicalHeight`. Or
`Display.Mode` rapporte la définition dans l'orientation **native** du panneau : sur un téléphone,
c'est le portrait, donc 1080 × 2400.

Le serveur testait alors `1920 ≤ 1080` pour un simple film 1080p, en concluait que l'appareil ne
savait pas l'afficher, **forçait la conversion** et rabotait l'image à 1080 de large. Un téléphone
parfaitement capable de lecture directe recevait une image dégradée — à l'endroit précis où la
conversion coûte le plus cher au NAS.

L'enveloppe est désormais orientée dans le sens où une vidéo se regarde : le grand côté par le petit.
Cinq tests, dont celui qui échouait.

## Le tone mapping renvoyait l'encodage au processeur

Une ligne, sans commentaire ni test : dès qu'une conversion HDR vers SDR avait lieu, l'encodeur était
forcé en logiciel. Toute conversion HDR — le cas le plus fréquent et le plus coûteux — était donc
encodée par le processeur, même sur une machine dont l'encodeur matériel fonctionnait.

Relevé sur le NAS de référence pendant une lecture réelle :

```
-vf zscale=…,tonemap=hable:…,scale=w=854:h=480  -c:v libx264
```

Trois défauts dans une seule commande : tone mapping logiciel, encodage logiciel, et 854×480 pour un
téléphone. Rien n'imposait le second — les filtres de l'encodeur, `format=nv12,hwupload`, sont
raccrochés en dernier, après tone mapping et redimensionnement, ce qui est exactement l'ordre voulu
pour encoder sur le circuit vidéo ce que le processeur vient de convertir. L'incrustation d'un
sous-titre image reste en logiciel, elle, pour une vraie raison : `overlay` ne sait pas travailler sur
des images déjà transférées.

## Le tone mapping est maintenant mesuré, non plus supposé

La règle du projet interdit qu'un chemin matériel non mesuré sur la machine cible soit retenu
automatiquement. Elle tenait en respect un risque réel — un pilote qui répond mais traîne coûte plus
cher que le logiciel qu'il remplace, tout en paraissant être un progrès. Seuls `libplacebo` et le
logiciel étaient donc admis, et un NAS capable de convertir sur son circuit vidéo le faisait sur son
processeur.

Le calibrage lève l'interdiction plutôt que de la contourner : chaque chemin est chronométré sur la
machine, et « auto » ne retient un chemin matériel que s'il s'est montré **plus rapide que le
logiciel ici**. Neuf tests, dont celui qui écarte un chemin matériel mesuré plus lent.

## L'accélération matérielle ne pouvait pas démarrer — six causes successives

Six défauts distincts se cachaient l'un derrière l'autre. Chacun a été corrigé, et chacun a révélé le
suivant. Aucun n'était devinable depuis le poste de développement : tous ont été trouvés en lisant les
binaires livrés, puis en faisant parler le NAS.

**`libva-drm.so.2` absente.** Les constructions FFmpeg de BtbN chargent libva par `implib-gen` : la
bibliothèque n'est ni liée ni embarquée, elle est ouverte à l'exécution. Le paquet embarquait
`libva.so.2` mais pas `libva-drm.so.2`, qui porte `vaGetDisplayDRM` — la seule fonction capable
d'ouvrir un nœud de rendu. Le contrôle de dépendances ne pouvait pas le voir : il lit les `DT_NEEDED`,
où une bibliothèque ouverte à l'exécution ne figure pas.

**Le chemin de recherche du binaire est cassé.** `DT_RPATH=-Wl:../lib` — l'option de liaison s'est
retrouvée dans la valeur. Le chargeur y lit un répertoire nommé `-Wl`, inexistant, et `../lib` relatif
au répertoire courant. `post-install.sh` lançait `ffmpeg -decoders` sans poser `LD_LIBRARY_PATH` :
le binaire ne démarrait pas, le script sortait en erreur, et App Central laissait sa barre de
progression tourner sans fin. Trois révisions ont paru « ne jamais s'installer » pour cela seul.

**La sonde de démarrage n'avait aucune limite de temps**, et un `[ -n … ] && break` en fin de boucle
sous `set -e` pouvait arrêter le script avant même de lancer le serveur.

**`vaMapBuffer2` manquait.** FFmpeg l'appelle sur le chemin d'encodage ; elle est apparue dans libva
2.21. Le contrôle l'avait listée le matin même, et le jugement porté fut « aucune n'est sur le chemin
d'une conversion ». Il était faux, et la sanction n'est pas une lenteur :

```
implib-gen: libva.so.2: failed to resolve symbol 'vaMapBuffer2' via dlsym
ffmpeg: _libva_so_2_tramp_resolve: Assertion `0' failed. Aborted
```

Aucune libva de Debian ne réunit ce symbole et la glibc 2.31 de l'ADM : bullseye (2.10) a la bonne
glibc sans le symbole, celles qui l'ont exigent glibc 2.38. Mesuré sur les quatre versions du pool.

**La libva embarquée ignore `LIBVA_DRIVERS_PATH`.** Celle que Jellyfin construit est compilée avec ses
chemins de recherche figés. Relevé sur le NAS, les variables posées : son journal n'en fait aucune
mention et elle n'essaie que `/usr/lib/jellyfin-ffmpeg/lib/dri`, `/usr/lib/x86_64-linux-gnu/dri`,
`/usr/lib/dri` et `/usr/local/lib/dri`. Les cinq pilotes livrés échouaient donc **identiquement** — non
parce qu'ils étaient mauvais, mais parce qu'aucun n'était jamais regardé. Le message identique aux cinq
essais le disait déjà ; il a été lu comme « le pilote n'est pas en cause » sans aller jusqu'à « aucun
pilote n'est consulté ». Le service dépose désormais le pilote là où cette libva regarde, à chaque
démarrage — la racine d'un NAS pouvant être remontée à neuf au redémarrage.

**Le répartiteur oneVPL ne trouvait pas son runtime.** Quick Sync échouait en annonçant un nœud de
rendu absent, ce qui n'avait aucun rapport : oneVPL charge ensuite `libmfxhw64` ou `libmfx-gen`, qu'il
cherche dans ses propres emplacements et non dans `LD_LIBRARY_PATH`. Déposés au même endroit que le
pilote, la session matérielle MFX s'ouvre.

## La pile de conversion passe sur les constructions Jellyfin

Jellyfin construit sa propre libva pour chaque distribution cible. Son paquet bullseye fournit donc ce
qui n'existe nulle part ailleurs : **libva 2.23 compilée contre glibc 2.30**, appariée à son pilote
`iHD` et à sa libdrm.

Vérifié sur les fichiers avant d'y toucher :

| Contrainte | Constat |
| --- | --- |
| glibc exigée par le paquet | 2.30 — la cible en a 2.31 |
| binaire exigeant davantage | aucun |
| `vaMapBuffer2` | exposé |
| dépendances non satisfaites | `libpciaccess` seule, déjà embarquée |

Deux artefacts, et le partage est délibéré : le paquet Debian complet réclame une vingtaine de
bibliothèques que l'ADM n'a pas, tandis que la construction **portable** ne dépend que de la
bibliothèque C. Les binaires viennent de l'une, l'étage VA-API de l'autre.

Trois gains, dont deux non recherchés : libva est liée par `DT_NEEDED` — un symbole manquant redevient
une erreur de chargement propre plutôt qu'une assertion en pleine conversion ; `libmfxhw64`,
`libmfx-gen` et `libvpl` arrivent avec, c'est-à-dire le runtime Intel Media SDK sans lequel Quick Sync
ne pouvait ouvrir aucune session ; et dav1d, SVT-AV1 et libass s'ajoutent au passage.

Le paquet passe de 273 à **154 Mio** : les binaires portables se compressent mieux que l'étage
`libav*` partagé qu'ils remplacent.

## L'accélération matérielle fonctionne — mesurée sur le NAS

Ce n'est plus une possibilité établie par lecture de binaires, c'est un relevé.

```
[2026-08-19 18:47:02] Accélération matérielle active : /usr/lib/jellyfin-ffmpeg/lib/dri (iHD)
```

| Mesure sur AS5404T (Celeron N5105) | Avant | Après |
| --- | --- | --- |
| Encodeur retenu | `libx264` | **`h264_vaapi`** |
| Débit du micro-banc | 57 i/s | **191 i/s — 335 %** |
| Sessions 1080p H.264 soutenables | 1 | **3** |
| Sessions 1080p HDR → SDR | 0 | **2** |
| Sessions 4K H.264 | 0 | **1** |

La comparaison avec Plex, installé sur la même machine, tient en trois lignes — relevées sur ses
propres fichiers, pas sur sa documentation :

| | Plex | FlixTunes |
| --- | --- | --- |
| libva | 1.22.0 | **1.23.0** |
| Pilote iHD | 24.1.5 | **25.4.6** |
| Runtime Quick Sync | absent | `libmfxhw64`, `libmfx-gen`, `libvpl` |

C'est la découverte que Plex fonctionnait sur ce NAS qui a permis de trancher : elle a écarté d'un
coup le matériel, le noyau et les droits, et fait comparer deux libva au lieu de continuer à accuser
les pilotes.

## Quick Sync refusait un mode, pas un pilote

Une fois la session MFX ouverte, l'encodeur refusait encore :

```
Using the intelligent constant quality (ICQ) ratecontrol method
Selected ratecontrol mode is unsupported
```

La sonde demandait ICQ via `-global_quality`, que ce circuit ne rend pas — il n'expose que CQP. Le
panneau concluait « inutilisable » alors que seul le mode de contrôle de débit l'était. La sonde passe
en `-q:v`, qui force CQP.

La conversion, elle, reste sur VA-API : sur cette puce les deux pilotent le même circuit vidéo, et
VA-API sait respecter un débit là où le CQP ne vise qu'une qualité constante — ce que la diffusion
adaptative exige.

## Un affichage qui faisait croire à un rabaissement

En remux, la vidéo est copiée : aucun filtre d'échelle, encodeur `copy`. Le serveur rapportait pourtant
la définition du profil adaptatif calculé pour l'admission — un objectif jamais appliqué. Un film 4K
servi tel quel s'annonçait « Sortie 2560×1440 · 12 Mb/s ». La lecture directe rapportait déjà la
source ; le remux fait de même.

## Réglages de conversion, et mode expert

Ils n'existaient qu'en variables d'environnement, dans un fichier qu'on n'atteint qu'en SSH : le
réglage était théorique. Ils sont désormais persistants et modifiables depuis le diagnostic —
accélérateur, chemin HDR → SDR, codec de sortie, définition maximale — avec au-dessus les chemins
mesurés et leurs débits, pour que forcer un réglage soit un choix informé plutôt qu'un pari.

Le plafond de définition ne peut que **réduire** ce que l'appareil annonce : imposer davantage ne
donne pas une image plus fine mais une lecture qui échoue. Six tests.

S'y ajoute un bouton « Refaire les mesures » : le calibrage survit à ce qui le corrige — une mise à
jour de paquet ou un accès réparé ne changent pas toujours sa signature —, et des mesures de trois
révisions antérieures ont été affichées comme le verdict de la version installée. La révision du
paquet entre désormais dans cette signature.

## Les alertes ne conseillent plus l'impossible

Le tableau affichait « NVIDIA NVENC inutilisable — installez le pilote » sur un NAS Intel, et de même
pour AMD et pour l'encodeur des puces ARM. Trois conseils impossibles à suivre, qui noyaient la seule
ligne utile. FFmpeg compile tous ces encodeurs d'office : leur présence ne dit rien du matériel
installé, ni leur refus. Dès qu'un accélérateur fonctionne, les autres restent au tableau avec leur
raison mais ne réclament plus d'action. Sur un serveur sans accélération, les messages reviennent.

## Le lecteur mobile, perfectionné

Trois défauts signalés à l'usage, tous corrigés sans toucher au rendu télévision — les grandeurs
concernées valent zéro sur cette surface, qui rend donc exactement le code d'avant.

- **Les barres système restaient affichées** par-dessus le film. Elles reviennent au balayage et ne
  repartaient plus ; elles sont remasquées quand les commandes se retirent.
- **Les commandes passaient sous les barres et les encoches.** `safeDrawing` est désormais respecté.
- **Huit boutons sur une rangée dessinée pour un téléviseur** : le minuteur et l'image dans l'image
  sortaient de l'écran d'un téléphone. Deux rangées, séparées par l'usage.
- **Les cibles faisaient trente-six points** — assez pour un curseur de télécommande, qui vise au pixel
  et ne masque rien ; un doigt en couvre dix millimètres et cache sa propre cible. La zone sensible
  passe à quarante-huit sans grossir le dessin, le clic restant porté par le même élément que
  l'indication de focus, sans quoi la croix directionnelle éclairerait un bouton qui ne répond pas.
- **La barre de progression** offre une zone de saisie de cinquante-six points et affiche le temps visé
  pendant le glissement : sur un film de trois heures, la position seule ne dit rien.
- **Double tape à gauche ou à droite** pour reculer ou avancer de dix secondes, avec la couche de
  gestes maintenue en place quand la garniture se retire — c'est écran nu qu'elle sert.
- **L'image dans l'image** ne se couvre plus de commandes : la vignette fait quelques centimètres et le
  système y pose déjà les siennes.

## La lecture directe devient le défaut

Le serveur ne teste jamais ce qu'un appareil sait décoder : il le lui demande, et il le croit. Cette
confiance est mal placée bien plus souvent qu'on ne le pensait. Aucun navigateur ne déclare le
conteneur Matroska que plusieurs lisent. `decodingInfo` répond `supported: true, smooth: false` pour
du HEVC 4K décodé en matériel, ce qui était pris pour un refus. Ni AC-3 ni E-AC-3 n'étaient sondés,
alors que Chrome et Edge les lisent sur la plupart des postes Windows. Et une marge de sécurité de
vingt pour cent sur le débit refusait un fichier de 26,5 Mb/s sur un chemin mesuré à 29,4.

Relevé sur *Avatar : De feu et de cendres* : chacune de ces prudences, prise isolément, envoyait en
conversion 4K — que le NAS ne produit pas — un film qui se lisait sans peine en lecture directe forcée.
Il fallait cliquer « Essayer en direct » à chaque lecture.

**La règle est donc devenue celle-ci : on sert le fichier tel quel, et si ça ne marche pas on
convertit.** L'échec se rattrape par trois signaux déjà mesurés — erreur du lecteur, images perdues,
coupures répétées — et chacun déclenche un repli.

Ne subsistent que les refus portant sur ce que la lecture directe **ne peut structurellement pas
faire**. Y aller quand même ne serait pas un essai : ce serait abandonner un réglage posé, en silence.

| Refus | Raison |
| --- | --- |
| Sous-titres à incruster | le fichier part tel quel, les sous-titres n'y sont pas |
| Traitement audio demandé | normalisation et mode nuit n'existent qu'à l'encodage |
| Piste audio non prioritaire | le fichier part entier, le lecteur joue la piste par défaut |
| Plafond de définition réglé | un réglage expert est une consigne, pas une annonce prudente |
| Codec audio non décodable | un film muet ne lève aucune erreur et rien ne le rattrape |
| Codec en quarantaine | il a déjà échoué deux fois ici : la question est tranchée |
| Débit au-dessus du plafond de coupures | deux coupures réelles l'ont établi |

Trois de ces bornes avaient d'abord été écrites plus larges, et les trois se sont révélées fausses en
conditions réelles. Elles méritent d'être nommées, parce que chacune dit quelque chose de différent.

**Le nombre de canaux ne refuse rien.** `maxAudioChannels` décrit la sortie de l'appareil, pas son
décodeur : un lecteur qui décode une piste huit canaux la mixe lui-même vers la stéréo, exactement
comme le ferait le serveur. Le compter comme une incompatibilité envoyait en conversion complète tous
les films dont la piste principale est en 5.1 ou 7.1, c'est-à-dire presque tous.

**Le HDR ne refuse rien non plus.** Un écran qui ne le rend pas produit une image délavée, ce qui est
une vraie dégradation — mais le réglage de plage dynamique existe déjà pour cela, et l'avertissement
« Conversion d'image » le dit à l'écran. Refuser d'office privait de lecture directe tous les films
HDR au nom d'un cas que l'interface traite mieux.

**Le débit ne refuse plus sur une estimation, et c'est la correction la plus instructive.** Le coussin
de vingt pour cent était déjà trop prudent. Mais surtout, la bande passante est relevée par `hls.js`
**pendant la session en cours** : pendant une conversion, elle mesure la vitesse de l'encodeur et non
celle du réseau. Le garde-fou se nourrissait donc de ce qu'il causait — on convertit, c'est lent, donc
le réseau est déclaré insuffisant, donc on convertit. Un cercle fermé, et invisible depuis le serveur.
Seul subsiste le plafond posé par le lecteur après deux coupures réelles pendant une lecture réelle :
celui-là ne consigne pas une prudence mais un fait.

Trois filets rendent le défaut sûr : la quarantaine par appareil, consultée sur la liste **brute** des
codecs — le filtrage la rendait invisible, ce qui faisait ressembler un codec défaillant à un codec
non déclaré ; la mesure des images perdues, seul mode d'échec muet du décodage ; et un repli **en deux
marches**, direct → remux → conversion. Cette dernière a corrigé une régression que l'essai
introduisait : Firefox et Safari ne lisant pas le Matroska, un repli direct vers la conversion les
aurait fait passer d'un remux — qui copie l'image au bit près — à un transcodage complet.

Un réglage explicite n'est jamais un pari. Le plafond de définition du mode expert abaisse les
capacités annoncées exactement comme le ferait une sonde prudente ; le confondre avec elle aurait servi
du 4K à quelqu'un venant de demander 1080p. La négociation distingue les deux par identité d'objet,
`plafonnerDefinition` rendant l'objet reçu quand le réglage ne s'applique pas.

### Un mot d'écart sur l'étiquette du codec

`hev1` et `hvc1` désignent le **même** codec HEVC, rangé différemment : le premier porte ses
paramètres dans le flux, le second dans l'en-tête du conteneur. Les navigateurs n'acceptent pas les
mêmes, et la sonde n'interrogeait que `hvc1`. Sur la machine même où Chrome venait de lire du HEVC 4K
en lecture directe forcée, la négociation annonçait donc « codec vidéo hevc non pris en charge ».

La conséquence dépassait la lecture directe. Ce verdict entre dans `videoCompatible` : un HEVC non
déclaré écarte le **remux**, qui copie l'image, et impose un transcodage complet. Un mot d'écart
décidait donc entre copier un flux et le réencoder entièrement sur un Celeron.

### Le débit décidait de la compatibilité, et il se mesurait lui-même

Même mécanique, plus grave encore. `bitrateCompatible` appliquait un coussin de vingt pour cent à la
bande passante annoncée par le client. Or ce chiffre est relevé par `hls.js` **pendant la session en
cours** : pendant une conversion, il mesure la vitesse de l'encodeur et non celle du réseau.

Le cercle se referme de lui-même — on convertit, c'est lent, donc le réseau est déclaré insuffisant,
donc `videoCompatible` tombe, donc on convertit — et rien dans le journal ne le montre, puisque chaque
étape prise isolément paraît raisonnable. Le coût de l'erreur était maximal : le serveur se confiait le
travail le plus lourd à cause d'une estimation que ce travail avait lui-même faussée.

Ne subsiste que `maxVideoBitrate`, que le client ne pose **qu'après deux coupures réelles pendant une
lecture réelle**. Il consigne un fait. Et si le réseau ne suit vraiment pas, c'est ce même mécanisme
qui le constatera en deux coupures et redemandera une session plafonnée — le repli existe, il est
mesuré, et il est rapide.

### Deux codecs audio que personne n'interrogeait

`browserCapabilities` sondait AAC, Opus et MP3, et **rien d'autre**. Dolby Digital et Dolby Digital
Plus n'étaient jamais proposés au navigateur. Un film en EAC3 — la piste par défaut de presque tous
les Blu-ray — partait donc en remux pour son seul son, quel que soit le reste.

La réponse exigée est `probably`, plus stricte que le `!== ""` retenu pour le reste. L'asymétrie est
voulue : une erreur sur l'image lève une erreur du lecteur, qu'on rattrape ; une erreur sur le son
donne un film muet, que rien ne signale et que personne ne rattrape. C'est la même raison qui fait du
codec audio le dernier désaccord de capacité à valoir encore refus.

### Un démenti qui partait trop tôt

Le démenti de quarantaine — « ce codec fonctionne, oubliez l'échec précédent » — partait à la première
image, et il **efface** la ligne de quarantaine. Tant que le serveur ne tentait rien, l'ordre était
sans conséquence. Il ne l'est plus : un décodage qui décroche trois secondes plus tard repartait d'un
compteur remis à zéro, et deux échecs étant nécessaires pour retenir la leçon, elle ne l'aurait jamais
été. L'appareil aurait retenté à chaque lecture ce qui ne marche pas chez lui — exactement ce que la
quarantaine existe pour éviter.

Le démenti attend désormais que la lecture ait tenu : sur la mesure d'images perdues côté Web, sur un
délai de huit secondes côté Android, où cette mesure n'est pas accessible depuis un `MediaController`.

Au passage, un défaut qui rendait le démenti Web théorique : `joue` lisait `session?.mode` dans une
fermeture posée au montage, quand la négociation n'a pas encore eu lieu et que `session` vaut `null`.
Il se croyait donc en permanence hors lecture directe. C'est précisément le piège que documentait
`infoRef` quelques lignes plus haut ; `sessionRef` le comble.

## L'accueil payait le lecteur sans l'utiliser

Le budget de poids du client Web a bloqué la construction du paquet : 111,7 Kio de JavaScript au
premier affichage pour un plafond de 100. Le diagnostic n'était pas une dérive diffuse mais une seule
ligne — `App.tsx` importait `Player.tsx` d'emblée. C'est le plus gros module de l'application,
soixante-quinze kilooctets de source, et il emmène avec lui la sonde de décodage, la mesure de débit
et les planches de vignettes. Une grille de jaquettes payait donc un lecteur que personne n'avait
encore demandé.

L'intention était pourtant déjà inscrite dans le contrôle lui-même, qui vérifie que `hls.js` reste
dans un fichier séparé — « sinon l'accueil paierait le coût du lecteur sans l'utiliser ». La
bibliothèque l'était ; le composant qui l'entoure ne l'était pas, et la garantie visait donc à côté.

| Poste | Avant | Après |
| --- | --- | --- |
| JavaScript du premier affichage (gzip) | 111,7 Kio | **81,3 Kio** |
| Lecteur chargé à la demande (gzip) | 157,8 Kio | 188,8 Kio |
| Total expédié | 269,5 Kio | 270,1 Kio |

Le total ne bouge pas : trente kilooctets ont changé de poste, pas de nature. Mais quelqu'un qui
parcourt sans lancer de film en télécharge vingt-sept pour cent de moins, et c'est le chemin qui
compte — on ne lit jamais avant d'avoir parcouru, si bien que le chargement du lecteur se fait
pendant qu'on choisit.

Les deux seuils ont été révisés dans le même mouvement, et dans des directions opposées : le premier
affichage **descend** de 100 à 95 Kio pour retenir le gain — le laisser à 100 aurait rendu vingt
kilooctets à peine gagnés —, le poste différé monte de 175 à 200 pour accueillir ce qu'il héberge
désormais. Refuser ce déplacement au nom du chiffre aurait conservé le poids là où il coûte le plus.

## Quatre défauts Android, deux causes

**La définition annoncée venait de la dalle, non du décodeur.** Un téléphone à panneau 2400 × 1080
déclarait ne pas savoir lire un film 4K — alors que son décodeur matériel le lit et que le système
réduit ensuite l'image gratuitement. Le serveur concluait « définition supérieure » et partait en
conversion 4K, que le NAS ne produit pas : *Avatar* ne démarrait pas du tout. C'est très exactement le
défaut que le client Web a connu, transposé ici ; la définition vient désormais de `MediaCodecInfo`,
la dalle ne servant plus que de plancher.

**Le détecteur de gestes était détruit quatre fois par seconde.** `pointerInput` était installé avec
la position de lecture parmi ses clés, et Compose recrée le détecteur à chaque changement de clé. Un
double tape s'étale sur environ trois cents millisecondes : il n'avait jamais le temps de se former.
La tape simple qui réveille les commandes se perdait de la même façon, ce qui rendait la barre de
progression difficile à faire apparaître. Deux symptômes signalés séparément, une seule cause.

La clé est désormais stable et la position lue **au moment du geste**. Le réveil des commandes passe
par ailleurs sur `onPress` plutôt que `onTap` : ce dernier ne se déclenche qu'après le délai du double
tape, et ce tiers de seconde se ressentait comme une barre qui ne répond pas. Les tapes du même côté
se cumulent enfin, chacune ajoutant dix secondes, la série partant de la position d'**avant** le
premier saut — sans quoi les sauts se contrarient, la lecture n'ayant pas encore atteint la cible
précédente quand la suivante est demandée. Huit cas fixent ce comportement, éprouvé sans appareil.

**Une conversion qui n'a rien produit gardait son créneau dix minutes.** Le délai d'inactivité vaut
pour une lecture en pause, dont le tampon plein cesse de demander des segments ; il ne vaut pas au
démarrage, où le client interroge sans relâche puis abandonne à trente secondes. Deux tentatives
infructueuses sur un film 4K suffisaient donc à faire répondre « limite de 2 conversions simultanées
atteinte » alors qu'aucune lecture n'était en cours — le serveur refusait de démarrer à cause de ses
propres échecs, ce qui rendait le défaut d'origine indiscernable d'une panne de capacité. Une minute
de silence en préparation suffit désormais.

## Les sessions que personne ne pouvait plus arrêter

Le symptôme était déroutant : « limite de 2 conversions simultanées atteinte » en lançant un film,
alors qu'aucune lecture n'était en cours. Il ne s'agissait pas de la comptabilité du serveur —
`releaseSessionCost` est appelé sur-le-champ — mais de sessions devenues **introuvables**.

`preparePlayback`, côté Android, ne se protégeait pas de la ré-entrée. Deux avances rapprochées
lançaient deux coroutines : la seconde remettait `playbackSessionId` à zéro **avant** que la première
ait assigné le sien. La session de la première n'était donc plus référencée nulle part. Ni le lecteur
ni `onDestroy`, qui ne connaît que le dernier identifiant, ne pouvaient l'arrêter, et elle gardait son
créneau jusqu'au ramassage — dix minutes plus tard. En quittant le film pour en lancer un autre, le
serveur refusait donc de démarrer à cause de ce que le client avait oublié derrière lui.

Deux corrections, volontairement redondantes, parce qu'elles ne protègent pas de la même chose.

**Les préparations sont sérialisées.** La précédente est annulée, et si elle avait déjà créé une
session, elle l'arrête avant de se retirer.

**Un appareil ne regarde qu'une chose à la fois.** Chaque session retient l'appareil qui l'a demandée,
et une nouvelle demande libère les précédentes du même appareil. Ce garde-fou ne dépend d'aucun
client, et c'est tout son intérêt : un lecteur peut oublier d'annoncer un arrêt — application tuée,
réseau coupé, préparation dépassée — mais il ne peut pas demander une session sans se nommer. Le
contrôle est placé **après** la réutilisation du cache et avant la création : détruire plus haut aurait
tué la session que le client redemandait.

S'ajoute le ramassage rapide des sessions jamais démarrées : le délai d'inactivité de dix minutes vaut
pour une lecture en pause, dont le tampon plein cesse de demander des segments, mais pas pour une
session en préparation, dont le client interroge sans relâche puis abandonne à trente secondes.

### Et la cause principale, qu'aucun de ces garde-fous n'aurait prise

Le retour d'usage a nommé ce que le raisonnement n'avait pas vu : « ça garde la lecture précédente ».
`PlaybackService` est un `MediaSessionService`, et son lecteur survit **délibérément** à l'activité —
c'est ce qui permet au son de continuer quand on quitte l'écran. `onDestroy` libérait le
`MediaController` sans arrêter ce lecteur.

La conversion précédente restait donc **activement demandée**, segment après segment. Sa session
n'était ni orpheline ni inactive : rien ne la distinguait d'une lecture en cours, parce que c'en était
une. Ni la libération par appareil ni le ramassage n'auraient pu la prendre — le premier ne s'exécute
qu'à la demande suivante du même appareil, et cette demande était précisément celle qui se voyait
refuser.

Le lecteur est désormais arrêté en quittant l'écran, et le service s'arrête quand l'application est
balayée hors des tâches récentes. On ne conserve pas d'arrière-plan pour de la vidéo : quitter le
lecteur, c'est arrêter de regarder.

## La reprise faisait encoder deux fois

La session était ouverte au début, puis le lecteur sautait au point de reprise. Pour une lecture
directe cela ne coûte rien — le fichier est servi entier. Pour une **conversion**, le serveur encode
une fenêtre qui part de zéro, et le saut tombe hors de cette fenêtre : il faut relancer une seconde
session au bon endroit. Le NAS encodait donc deux fois, la personne attendait deux fois, et le premier
encodage — celui que personne ne regardera — occupait un créneau pendant ce temps.

Le point de départ est désormais décidé **avant** de demander la session, sur les deux clients. Le
mode « demander » reste au début, volontairement : tant que la question n'a pas été posée, on ignore
si la personne veut reprendre ou repartir de zéro, et deviner ferait encoder le mauvais bout du film
une fois sur deux.

Un troisième défaut se cachait derrière : `preparePlayback` remettait `initialSeekApplied` à `false`,
si bien qu'après chaque relance le saut de reprise se rejouait et ramenait au point d'origine. Une
avance s'annulait donc d'elle-même, ce qui rendait les deux autres défauts encore plus difficiles à
lire.

## Ce que les contrôles refusent désormais

Chaque défaut ci-dessus a laissé un garde-fou, et chacun a été éprouvé dans les deux sens — il refuse
la version fautive et accepte la corrigée.

| Contrôle | Ce qu'il attrape |
| --- | --- |
| `verify-dlopen.py` | bibliothèque ouverte à l'exécution, absente du paquet ; symbole du chemin de conversion non exposé |
| construction du paquet | script `CONTROL` lançant le FFmpeg embarqué sans poser `LD_LIBRARY_PATH` |
| `typecheck.ps1` | ressource Android refusée par aapt2 — un apostrophe nue avait cassé l'assemblage sans que rien ne le voie |
| `extract-*.py` | ELF exigeant une glibc plus récente que la cible |
| `lintDebug` | appel d'API plus récente que le minimum déclaré — rattrapé jusque-là par un `runCatching` qui n'en disait rien |

Ce dernier mérite une phrase, parce qu'il dit quelque chose de la chaîne de vérification.
`registerDefaultNetworkCallback` n'existe qu'à partir d'Android 7 quand l'application accepte Android
6. L'appel était enveloppé dans un `runCatching` : le `NoSuchMethodError` était rattrapé, la
surveillance réseau ne s'installait pas, et rien ne le signalait. Une limite déguisée en accident.
Elle est désormais dite explicitement — le comportement sur ces appareils ne change pas, la reprise
après coupure y passant par le filet temporisé, mais elle cesse d'être invisible.

`typecheck.ps1` ne pouvait pas l'attraper : il passe le Kotlin au compilateur et les ressources à
aapt2, non le code à lint. C'est le bon partage — lint coûte plusieurs minutes et n'a pas sa place
dans un contrôle rapide — à condition qu'une construction complète soit réellement passée avant de
livrer. Elle l'a été ici.

## Preuves exécutées

| Suite | Résultat |
| --- | --- |
| Tests serveur | **442 verts**, 50 fichiers |
| Tests Web | **122 verts**, 17 fichiers |
| Tests JVM Android | **125 verts**, 19 classes |
| Types serveur, Web, Kotlin | aucune erreur |
| Ressources Android (aapt2) | aucune erreur |
| APKG ASUSTOR x86-64 | `0.5.6.r21`, contrôles VA-API au vert |
| APK Android | `FlixTunes-Android-0.5.6r21-debug.apk`, 17,3 Mio |
| Accélération matérielle sur le NAS | **mesurée**, 335 % du débit logiciel |

Les deux artefacts portent le même numéro de révision, tiré de la même variable. Ils étaient numérotés
séparément — l'APK annonçait `0.5.6` quand le NAS annonçait `0.5.6.r20` —, ce qui rendait impossible
de savoir, depuis un téléphone, si le correctif qu'on cherchait y était.

Une remarque sur la façon dont ces suites ont été passées, parce qu'elle a de l'importance pour la
prochaine fois. Ni la suite serveur ni la suite Web ne s'exécutent d'un seul bloc sur ce poste : le
dépôt vit sur un partage SMB, vitest y ouvre un processus par fichier, et ils s'étranglent
mutuellement — jusqu'à mourir à l'ouverture. Passées fichier par fichier côté serveur, et dans un
processus unique côté Web (`--pool=forks --poolOptions.forks.singleFork`), elles passent toutes. Ce
n'est pas un défaut des tests, et le confondre avec un échec ferait chercher au mauvais endroit.

## Reste à exécuter

Rien de ce qui suit n'est acquis, et aucun ne peut l'être depuis ce poste.

- **Les trois perfectionnements mobiles et l'image dans l'image n'ont pas été vus sur un appareil.**
  Types et ressources sont propres, le raisonnement est écrit, mais un geste tactile et une indication
  de focus se jugent à l'usage. Deux points méritent une vérification : que le double tape n'émousse
  pas la tape simple qui réveille les commandes, et que la croix directionnelle atteigne toujours tous
  les boutons en répondant à la validation.
- **Quick Sync en CQP** n'a pas été revu depuis la correction de la sonde.
- Parcours D-pad filmés, Macrobenchmark, tests instrumentés Compose/Media3, matrice d'appareils réels,
  rapport batterie/mémoire.
- Android 8, mémoire faible, veille, télécommande déconnectée.
- **Mesure comparative de bout en bout contre Plex** : le micro-banc dit 335 %, ce qui compare deux
  encodages de mire. Il ne dit rien du temps de première image, du nombre de rebuffers, ni du
  comportement à trois lectures simultanées — c'est-à-dire de ce qui se ressent. L'étape 62 le prévoit ;
  rien ici ne permet encore de l'affirmer.

## Cas limites du dossier

| Cas | État |
| --- | --- |
| Changement Wi-Fi / Ethernet | traité — `BasculeReseau` |
| Codec annoncé mais défaillant | traité — quarantaine par appareil |
| Reprise après processus tué | traité — l'état sauvegardé prime sur l'intention d'origine |
| Rotation | traité — `configChanges` couvre orientation et définition |
| Image dans l'image | traité — commandes retirées, panneau refermé |
| Android 8, mémoire faible, veille, télécommande déconnectée | demandent un appareil |
