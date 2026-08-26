# Audit — un client de bureau identique à Android, par Compose Multiplatform

*26 août 2026. Audit demandé après le constat que le client Windows actuel est un prototype. Aucun
code n'a été écrit pour ce document ; il mesure, découpe et chiffre. La mise en œuvre attend un accord
explicite.*

## 1. Ce qu'on remplace, et ce qu'on vise

Le client Windows compte une dizaine de fichiers : accueil, fiche, lecteur. Pas d'administration, pas
d'accès distant, dix-sept tests. Il fait ce qu'il fait correctement — la lecture directe par libVLC
fonctionne — mais il n'a jamais suivi les trois autres clients.

L'objectif retenu est le plus exigeant des trois envisagés : **le même code d'interface que sur
Android**, et non une troisième transcription des mêmes écrans.

## 2. Ce que la mesure dit du terrain

C'est là que le projet a de la chance, et il faut le dire avant de chiffrer la peine.

| Couche | Volume | Portabilité |
| --- | --- | --- |
| `ui/` (hors activités) | 14 fichiers, 2 887 lignes, ~48 composables | **12 fichiers sur 14 n'importent rien d'Android** |
| Écrans dans `MainActivity` | 2 253 lignes, **26 composables** | portables, mais enfermés dans une activité |
| `PlayerActivity` | 1 753 lignes, **0 composable** | plomberie pure : Media3, surface, PiP, touches |
| `playback/` | 21 fichiers, 1 838 lignes | **Android uniquement** — c'est le vrai chantier |
| `data/` | 6 fichiers, 703 lignes | trois dépendances seulement : `Context`, `NsdManager`, `@Immutable` |

Deux découvertes qui changent l'estimation :

- **Aucun composant `androidx.tv`.** L'interface téléviseur est bâtie sur Material3 ordinaire avec un
  traitement du focus écrit ici (`IndicationFocus.kt`). Rien de ce qui fait la navigation à la
  télécommande n'est propre à Android — tout est portable.
- **Seuls deux fichiers d'interface touchent Android** : `Gabarit.kt`, qui reconnaît le gabarit de
  l'écran, et `PleinEcran.kt`, qui manipule la fenêtre. Deux frontières nettes, pas une contamination
  diffuse.

Autrement dit : l'interface est déjà presque multiplateforme sans l'avoir cherché. Ce qui ne l'est pas
du tout, c'est **la lecture**.

## 3. Le seul vrai obstacle : Media3 n'existe pas hors Android

Les 1 838 lignes de `playback/` reposent sur ExoPlayer et `MediaSession`. Il n'y a pas d'équivalent
multiplateforme, et il n'y en aura pas. Le remplaçant naturel sur Windows est **VLCJ**, la liaison Java
de libVLC — le même moteur que celui déjà embarqué dans le client WPF actuel, ce qui veut dire que la
connaissance accumulée sur ses comportements ne se perd pas.

Ce que cela implique, sans le minimiser : le lecteur Android fait beaucoup de choses précises — mode
tunnel, préférence de lecture directe HDR, fabrique de rendus, relevé des images perdues, reprise de
session. Aucune ne se transpose mécaniquement. Le contrat commun sera donc **étroit et explicite** :
ouvrir, positionner, choisir une piste, arrêter, rapporter un état. Le reste vit de chaque côté.

Un acquis : `ClientCapabilities`, écrit et testé en r79 pour le client WPF, décrit déjà ce qu'une
machine Windows avec libVLC sait rendre. Cette logique remonte en Kotlin partagé sans être réinventée.

## 4. Découpage proposé — six étapes, l'Android livrable à chacune

La règle qui gouverne tout le découpage : **l'application Android ne doit à aucun moment régresser.**
Les 208 tests restent verts et l'APK se construit à la fin de chaque étape, sans quoi l'étape n'est pas
finie. C'est ce qui permet d'arrêter le chantier n'importe où sans rien perdre.

| N° | Contenu | Preuve de fin |
| --- | --- | --- |
| ~~**1**~~ | ~~Sortir les 26 composables de `MainActivity` vers `ui/ecrans/`.~~ **Fait le 27 août 2026** — voir `VALIDATION_0.5.6_R81.md`. | **208 tests verts, 47 avertissements inchangés, APK construit, et les 8 562 mots déplacés vérifiés identiques** |
| ~~**2**~~ | ~~Isoler les frontières plateforme derrière des interfaces.~~ **Fait le 27 août 2026** — voir `VALIDATION_0.5.6_R82.md`. | **211 tests verts, plus un seul `import android.` dans `ui/`, contrats `Reglages` et `DecouverteServeurs` en place** |
| **3** | Restructurer Gradle : `shared` (UI + données), `androidApp`, `desktopApp`. Compose Multiplatform entre ici. | l'APK se construit depuis `androidApp`, et une fenêtre desktop vide s'ouvre |
| **4** | Ressources : 266 lignes de chaînes, polices, images, sons — **215 appels à `stringResource`** à reporter. | l'application Android affiche exactement les mêmes textes |
| **5** | Le lecteur desktop : VLCJ derrière le contrat commun, capacités déclarées depuis `ClientCapabilities`. | une lecture directe et une lecture convertie, sur Windows |
| **6** | Fenêtre, clavier au lieu de la télécommande, empaquetage `jpackage` **Windows et Linux**, retrait du client WPF. | un installateur Windows, un paquet `.deb`, une archive Linux ordinaire, et un dépôt d'interface en moins |

Les étapes 1 et 2 ont une valeur **même si le chantier s'arrête là** : c'est le découpage du monolithe
que l'audit d'industrialisation réclamait, fait pour une raison précise plutôt que par principe.

## 5. Estimation, et ce qui peut la faire déraper

**Trois à cinq semaines** pour une personne, les six étapes. La fourchette est large parce que
l'étape 5 est la seule dont je ne connais pas le fond : le reste est du déplacement de code mesuré.

Trois risques, par ordre de gravité :

1. **Le lecteur VLCJ ne rendra pas ce que Media3 rend.** Sous-titres incrustés, HDR transmis tel quel,
   mode tunnel : il faudra constater, pas espérer. C'est l'étape à faire *tôt* si l'on veut savoir, et
   je propose de la sonder dès l'étape 3 par un essai jetable avant de s'engager sur la suite.
2. ~~**Compose Multiplatform impose ses versions.**~~ **Levé le 27 août 2026.** Compose Multiplatform
   1.9.3 compile **et s'exécute** avec Kotlin 2.3.21 — la version exacte de l'application Android.
   Vérifié en rejouant la sonde sur cette combinaison : 23,98 i/s en régime, 5,0 ms par image, chiffres
   identiques à ceux obtenus avec Kotlin 2.2.20. Aucun alignement à attendre, aucune rétrogradation.
3. **Les 215 reports de ressources** sont mécaniques mais nombreux : c'est là qu'un texte se perd sans
   qu'aucun test ne le voie. Un cas qui compare les clés déclarées et les clés utilisées éviterait ça.

## 6. Ce que ce chantier retire

À la fin, il reste **deux interfaces** au lieu de trois : le Web, et Compose pour Android et Windows.
Le client WPF disparaît, avec ses dix-sept tests et son statut expérimental.

Et Windows gagne ce qu'il n'a jamais eu : les écrans d'administration, l'accès distant, la liste
personnelle, l'historique, les réglages de profil — tout ce qu'Android a déjà, sans que rien ne soit
écrit deux fois.

## 7. La sonde a été faite — et le pari est levé

*26 août 2026, mesuré sur le poste de développement avec Compose Multiplatform 1.9.3, vlcj 4.12.1 et
les binaires libVLC 3.0.23 déjà embarqués par le client WPF.*

Le doute portait sur un point précis : **Compose ne peut pas dessiner sur une surface vidéo native.**
Sur un bureau, une telle surface est « lourde » au sens AWT, et l'interface légère de Compose passerait
dessous. Le seul chemin est donc de faire écrire libVLC dans un tampon mémoire et de peindre ce tampon
comme une image Compose — ce qui **copie chaque image**. La question n'était pas « est-ce que ça
marche » mais « combien ça coûte ».

### 7.1 Ce que ça coûte

| Définition | Copie du tampon | Conversion Compose | Total par image | Débit en régime | Part d'une image à 24 i/s |
| --- | --- | --- | --- | --- | --- |
| **1920 × 960** | 0,9 ms | 4,0 ms | **4,9 ms** | plein débit | **11,7 %** |
| **3840 × 1600** | 3,5 ms | 14,7 ms | **18,2 ms** | **24,00 i/s** | **43,6 %** |

**Aucune image ne tombe**, 4K comprise. Le délai avant la première image est de **514 ms** — ouverture
du fichier et mise en mémoire tampon.

### 7.2 Deux mesures qui ont menti, et ce qu'elles ont appris

**La première mensongère portait sur le coût.** La sonde donnait 25,8 ms par image en 4K, et j'aurais
pu conclure là-dessus. Le détail des deux moitiés a montré que la copie native ne coûtait que 3,5 ms :
les 22,2 ms restantes venaient d'un bitmap Skia **alloué à neuf à chaque image**, ce que fait
`toComposeImageBitmap()`. Réutiliser un unique bitmap ramène la conversion à 14,7 ms — trente pour cent
du coût total tenaient dans l'écart entre « le premier exemple venu » et « ce qu'un vrai lecteur doit
faire ».

**La seconde portait sur le débit, et elle a failli condamner la 4K.** La sonde comptait les images sur
quinze secondes **à partir du lancement**, ouverture comprise. Elle annonçait 23,1 i/s pour une source
à 23,976, et j'en ai conclu par écrit que des images tombaient. C'était faux : les 514 ms d'ouverture
étaient comptés comme du temps de lecture. Mesuré après trois secondes d'échauffement, le débit est de
**24,00 i/s** — le débit exact de la source, sur vingt-deux secondes.

La correction vient d'une objection posée en retour : *« sur Windows on n'a pas 24 images par seconde,
c'est un problème non ? »*. Elle l'était, et le banc en était la seule cause.

### 7.3 Verdict

**La voie B est praticable, sans réserve à 24 images par seconde**, 4K comprise.

Le chiffre à retenir n'est donc pas un débit manqué, c'est une **occupation** : 18,2 ms par image, soit
43,6 % du budget d'une image à 24 i/s, dépensés uniquement à porter les pixels jusqu'à Compose. Cela
laisse de la marge sur ce poste, et cela en laisserait moins ailleurs.

Une seule limite reste, et elle est arithmétique : **une source 4K à 50 ou 60 images par seconde**
donne un budget de 16,7 ms, inférieur aux 18,2 ms mesurés. Ce cas-là ne passerait pas en l'état. Il
existe une marge non explorée pour y répondre — Skia sait envelopper de la mémoire native sans la
copier, ce qui supprimerait la dernière copie — et la négociation de capacités sait déjà, au besoin,
demander au serveur de convertir. Rien de tout cela n'est nécessaire pour décider aujourd'hui.

### 7.4 Ce que la sonde n'a pas testé

Elle a répondu à la question qui pouvait tout arrêter, pas aux autres. Restent inconnus, et ce sont des
travaux, non des paris : le HDR transmis tel quel, les sous-titres, le déplacement dans le flux, le
changement de piste audio, et la lecture du flux HLS du serveur — ce dernier point étant déjà établi
par le client WPF actuel, qui emploie le même moteur.

Une contrainte de version que je croyais confirmée **ne l'est pas** : la sonde a d'abord été écrite en
Kotlin 2.2.20, et j'en avais conclu que Compose Multiplatform imposerait cette version à un projet qui
est en 2.3.21. Rejouée telle quelle en **2.3.21**, elle compile et rend exactement les mêmes chiffres.
La supposition venait de moi, pas de l'outil.

## 7 bis. Deux directives reçues en cours de route

### Tirer parti de la machine, au lieu de la ménager

Le poste de bureau est puissant, le NAS ne l'est pas — et c'est ce déséquilibre qu'il faut exploiter.
Trois conséquences concrètes pour l'étape 5 :

- **Déclarer largement, et honnêtement.** libVLC décode presque tout : conteneurs, HEVC, AV1, TrueHD,
  DTS. Un client qui l'annonce obtient de la **lecture directe** presque toujours, et le Celeron du
  NAS ne convertit plus rien. C'est le gain le plus important du chantier, et il ne coûte qu'une
  déclaration juste — celle que `ClientCapabilities` sait déjà construire depuis l'écran réel.
- **Décoder par le circuit graphique.** VLC sait le faire sur les deux systèmes — D3D11VA sous
  Windows, VA-API sous Linux. Le client WPF actuel le demande déjà (`--avcodec-hw=any`), et ça se
  reprend tel quel.
- **Ne payer le transport des pixels qu'une fois.** Les 18,2 ms mesurées en 4K sont deux copies : la
  mémoire native vers le tas, puis le tas vers Skia. Skia sait envelopper de la mémoire native sans la
  copier. C'est là qu'ira l'effort si la 4K à 50 ou 60 images le demande.

Autrement dit : que le poste décode, et que le NAS se contente de servir des octets.

### Linux, au même titre que Windows

Le chantier ne vise plus un client Windows mais un **client de bureau**. Compose Multiplatform y est
indifférent, et `jpackage` produit les deux familles de paquets. Ce qui diffère est ailleurs :

| | Windows | Linux |
| --- | --- | --- |
| Paquet | `.msi` ou `.exe` | **`.deb`**, plus une archive ordinaire pour le reste |
| libVLC | **embarqué**, comme aujourd'hui dans le client WPF | **dépendance déclarée** (`libvlc5`, `vlc-plugin-base`) : l'embarquer irait contre les usages, et la distribution le tient à jour |
| Décodage matériel | D3D11VA | VA-API — le même chemin que celui du NAS, déjà éprouvé ici |

L'archive ordinaire compte autant que le `.deb` : elle couvre ce qui n'est pas Debian, et elle ne
demande qu'un JRE embarqué, ce que `jpackage` fait de toute façon.

## 8. Ce que j'attends avant de commencer

Un accord sur le découpage. Le point « par où commencer » est tranché : la sonde est faite.

- Soit **dans l'ordre**, étapes 1 puis 2 — deux étapes sûres, sans surprise possible, qui améliorent
  Android au passage ;
- soit **par la sonde de l'étape 5** — un essai jetable de VLCJ sur une lecture directe et une lecture
  convertie, avant tout engagement, pour savoir ce que vaut le seul pari du chantier.

Je recommande la seconde. Les étapes 1 et 2 sont du travail certain ; l'étape 5 est la seule qui puisse
condamner l'ensemble, et une semaine passée à déplacer du code avant de découvrir que le lecteur ne
tient pas serait une semaine perdue. Mieux vaut apprendre la mauvaise nouvelle tant qu'elle ne coûte
qu'un essai.
