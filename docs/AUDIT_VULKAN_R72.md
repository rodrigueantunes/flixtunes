# Audit — rendre la conversion HDR au circuit graphique (r72)

*25 août 2026. Audit demandé après le constat que le tone mapping VA-API est impossible sur ce NAS.
Aucun code n'a été écrit pour cette révision ; ce document propose et chiffre.*

## 1. Le problème, mesuré

Douze pour cent de la médiathèque est en HDR — **1 172 fichiers**, dont 820 en Dolby Vision. Chacun,
regardé sur un écran SDR, déclenche une conversion. Faute de chemin matériel, elle se fait par le
processeur :

| Chemin de conversion HDR → SDR | Débit | Processeur |
| --- | --- | --- |
| Tone mapping logiciel | 51 à 75 i/s | **833 %** |
| Tone mapping logiciel zscale | 4 à 9 i/s | 100 % |
| VA-API, OpenCL, Vulkan | *aucun disponible* | — |

Huit cent trente-trois pour cent sur un Celeron N5105 à quatre cœurs, c'est la machine entière. La
capacité annoncée le dit autrement : **6 sessions** 1080p H.264 simultanées, mais **4 seulement** si
elles convertissent du HDR.

## 2. Ce qui est établi, et comment

### 2.1 VA-API est définitivement hors course

Relevé en clair sur le NAS, filtre à l'appui :

```
[Parsed_tonemap_vaapi_2] VAAPI driver doesn't support HDR
```

Le N5105 porte un circuit graphique de **11ᵉ génération**. Intel n'expose la conversion HDR de son
moteur vidéo qu'à partir de la **12ᵉ**. Aucune configuration, aucun pilote, aucune version de
FlixTunes n'y changera rien. C'est acquis, et l'interface le dit désormais.

### 2.2 Le FFmpeg embarqué sait déjà tout faire

Lu dans le binaire livré, par analyse de ses chaînes :

```
--enable-vulkan  --enable-libplacebo  --enable-libshaderc  --enable-opencl  --enable-vaapi
```

Les filtres `libplacebo`, `tonemap_opencl` et `tonemap_vaapi` y sont tous compilés, et **libplacebo
embarque son propre compilateur de nuanceurs** (libshaderc) : rien à ajouter de ce côté. Le binaire
cherche `libvulkan.so.1` et `libOpenCL.so` par chargement dynamique, et réclame les extensions
`VK_EXT_external_memory_dma_buf` et `VK_EXT_image_drm_format_modifier` — celles qui permettent
d'échanger une image avec VA-API **sans la recopier**.

### 2.3 Il manque une bibliothèque, pas une fonction

Les messages d'erreur distinguent nettement les deux chemins restants :

| Chemin | Message relevé | Ce qui manque |
| --- | --- | --- |
| Vulkan | `Unable to open the libvulkan library!` | le **chargeur** *et* le pilote |
| OpenCL | `Failed to get number of OpenCL platforms: -1001` | le **pilote seul** |

Le code `-1001` est `CL_PLATFORM_NOT_FOUND_KHR` : il n'est émis que par un chargeur OpenCL **qui
s'est chargé** et n'a trouvé aucun fournisseur déclaré. Autrement dit, `libOpenCL.so` existe déjà sur
ce NAS — il vient d'ADM, le paquet FlixTunes n'en embarque aucune.

Le paquet embarque 22 bibliothèques, toutes VA-API. Ni Vulkan, ni OpenCL, ni Mesa.

## 3. Les deux voies, comparées

### Voie A — Vulkan et libplacebo

Ajouter le chargeur `libvulkan.so.1`, le pilote Vulkan d'Intel (Mesa ANV, `libvulkan_intel.so`) et son
fichier de déclaration `intel_icd.x86_64.json`, puis pointer `VK_ICD_FILENAMES` dessus.

- **Pour** : libplacebo est le meilleur convertisseur de la chaîne, et de loin le plus fidèle sur du
  Dolby Vision. Il est déjà compilé, avec son compilateur de nuanceurs.
- **Contre** : Mesa doit venir de Debian **bullseye**, seule distribution dont la glibc 2.31 corresponde
  à celle d'ADM — c'est déjà la contrainte qui a dicté le choix du FFmpeg portable. Bullseye livre
  Mesa 20.3, où la prise en charge de Jasper Lake est **récente**. À vérifier avant toute chose.
- **Taille estimée** : 40 à 60 Mio. Le pilote Intel n'a pas besoin de LLVM — c'est le paquet Debian qui
  l'exige, parce qu'il réunit aussi les pilotes AMD et logiciel. N'extraire que `libvulkan_intel.so`
  devrait éviter cette dépendance, ce qui reste **à confirmer**.

### Voie B — OpenCL et `tonemap_opencl`

Ajouter le pilote de calcul d'Intel (NEO : `libigdrcl.so`), son compilateur (IGC) et un fichier `.icd`
dans `/etc/OpenCL/vendors`. Le chargeur, lui, est déjà là.

- **Pour** : c'est la voie recommandée par Jellyfin pour les circuits Intel dépourvus de conversion HDR
  matérielle — exactement notre cas. Une brique de moins à embarquer, et `libigdgmm.so.12`, dont NEO
  dépend, **est déjà dans le paquet**.
- **Contre** : NEO et son compilateur pèsent lourd, et `tonemap_opencl` rend un peu moins bien que
  libplacebo sur les sources Dolby Vision.
- **Taille estimée** : 150 à 200 Mio, soit un doublement du paquet actuel (182 Mio).

## 4. Ce qu'il faut vérifier avant d'écrire une ligne

Trois inconnues décident du choix, et **une seule expérience les lève toutes**. Elle demande vingt
minutes en SSH sur le NAS, ne modifie pas le paquet, et ne touche à rien d'installé.

1. **Mesa 20.3 connaît-il ce circuit graphique ?** Jasper Lake est arrivé tard dans Mesa. Si son
   identifiant PCI manque, le pilote se chargera sans trouver de périphérique.
2. **Le pilote Intel Vulkan se suffit-il à lui-même ?** S'il réclame LLVM, la voie A passe de 50 à
   150 Mio et perd son avantage.
3. **Quel débit réel ?** C'est la seule chose qui justifie l'effort. Le tone mapping logiciel plafonne
   à 75 i/s ; en dessous de 200 i/s, le gain ne vaudrait pas le doublement du paquet.

### L'expérience

Télécharger les deux paquets Debian bullseye `libvulkan1` et `mesa-vulkan-drivers` en amd64, les
extraire dans un répertoire temporaire du NAS — `dpkg-deb -x`, ou `ar x` suivi de `tar xf data.tar.xz`
— puis, sans rien installer :

```bash
export PKG=/volume1/.@plugins/AppCentral/flixtunes; export LD_LIBRARY_PATH="$PWD/usr/lib/x86_64-linux-gnu:/usr/lib/jellyfin-ffmpeg/lib:$PKG/runtime/va"; export VK_ICD_FILENAMES="$PWD/usr/share/vulkan/icd.d/intel_icd.x86_64.json"; "$PKG/runtime/ffmpeg/bin/ffmpeg" -hide_banner -loglevel verbose -init_hw_device vulkan=v -f lavfi -i testsrc2=size=1920x1080:rate=30:duration=10 -vf "format=yuv420p10,hwupload,libplacebo=tonemapping=bt.2390:format=yuv420p,hwdownload,format=yuv420p" -f null - 2>&1 | tail -20
```

Trois réponses possibles, et chacune tranche :

- **le débit s'affiche** : la voie A est ouverte, et le chiffre dit si elle vaut l'effort ;
- **« no devices found »** : Mesa 20.3 ne connaît pas ce circuit ; la voie A est fermée, on passe à B ;
- **une bibliothèque manque** : elle se nomme dans le message, et l'on saura ce que le paquet doit
  porter en plus.

## 5. Ce que ça rapporterait, et ce que ça ne rapporterait pas

**Ce qui changerait.** Les 1 172 fichiers HDR seraient convertis par le circuit graphique. La capacité
passerait vraisemblablement de 4 à 6 sessions HDR simultanées, et surtout le NAS cesserait d'être
saturé par une seule conversion — ce qui explique la lenteur ressentie de l'interface pendant qu'un
film HDR se convertit.

**Ce qui ne changerait pas.** Rien pour les 88 % restants : ils ne passent par aucun tone mapping.
Rien non plus quand le téléviseur reçoit le HDR tel quel, ce qui est le cas courant sur la TV — la
conversion ne concerne que les écrans SDR, donc surtout le mobile et le Web.

**Ce que ça coûterait.** Un paquet plus lourd de 40 à 200 Mio selon la voie, une brique de plus à
maintenir à chaque mise à jour du FFmpeg embarqué, et une nouvelle famille de pannes possibles — un
pilote graphique qui échoue en cours de lecture est plus difficile à diagnostiquer qu'un filtre absent.

## 6. Verdict de l'expérience — la voie est fermée

L'expérience du §4 a été menée le 25 août 2026, et elle tranche contre la voie A.

| Chemin | Débit sur ce NAS |
| --- | --- |
| Chaîne seule, sans conversion | **178 i/s** |
| **libplacebo sur Vulkan** | **11 i/s** |
| Tone mapping logiciel | 51 à 75 i/s |

libplacebo est **sept fois plus lent que le processeur**, et ne soutiendrait pas un seul film en temps
réel. Le contrôle sans le filtre — 178 i/s — écarte l'hypothèse d'une mire trop coûteuse.

Les trois inconnues sont levées, et deux l'étaient favorablement : le pilote Intel pèse **7,4 Mio** et
n'a pas besoin de LLVM, Mesa 20.3 reconnaît bien ce Jasper Lake. Il ne manquait que treize
bibliothèques d'affichage — X11, Wayland, XDMCP, BSD, FFI — soit **11,4 Mio** en tout, sur un NAS qui
n'a pas d'écran. Tout cela pour **dégrader** la conversion d'un facteur sept.

L'explication tient probablement à la mémoire partagée : chaque image traverse mémoire centrale →
circuit graphique → mémoire centrale, et sur un circuit intégré ce transfert coûte plus cher que le
calcul lui-même.

**Sans cette expérience, ce paquet aurait été livré.** Elle a coûté une heure ; elle a évité une
révision entière et une régression de performance chez l'utilisateur.

La voie B — OpenCL — reste ouverte sur le papier, mais mérite exactement le même traitement : une
expérience avant tout engagement, et le même refus si le débit n'y est pas.

## 7. Recommandation initiale, conservée pour mémoire

**Faire l'expérience du §4 avant de décider.** Elle coûte vingt minutes et lève les trois inconnues ;
sans elle, on s'engagerait sur une estimation de taille et un espoir de débit.

Si elle réussit, **la voie A** : plus légère, meilleure qualité sur le Dolby Vision qui représente sept
HDR sur dix dans cette médiathèque, et déjà entièrement outillée dans le binaire.

Si elle échoue, **la voie B** reste ouverte, avec un paquet deux fois plus lourd — un arbitrage qui
mérite alors d'être posé plutôt que subi.

## 8. Ce que cet audit a déjà rapporté

Trois défauts de la sonde de capacité, corrigés en r71 et sans lesquels ce diagnostic n'aurait pas
abouti :

- la sortie d'erreur était tronquée **par la fin**, alors que la cause est en tête ;
- la sonde tournait en `-loglevel error`, ce qui masque le refus d'un pilote ;
- la règle « pilote absent » passait avant « nœud de rendu invisible », envoyant chercher un pilote
  quand c'est un périphérique qui manque.

C'est ce qui a permis de lire, enfin, la phrase qui explique des semaines de recherche.
