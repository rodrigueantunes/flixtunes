# Audit de fluidité Android TV — R56

## Ce que cet audit a lu, et ce qu'il n'a pas pu mesurer

Lecture statique des sources R56, du rapport du compilateur Compose R55
(`apps/android/app/build/compose_audit_r55/`), du manifeste fusionné release et du bytecode de Coil 3
dans le cache Gradle. `adb.exe` est bien installé sur le poste
(`%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`) mais `adb devices` ne renvoie aucun appareil :
comme en R55, **aucune mesure sur le téléviseur n'a été possible**.

C'est la troisième révision consécutive optimisée à l'aveugle. Le premier résultat de cet audit est
donc une constatation de méthode, développée en fin de document : les comparaisons R54 → R56 faites
quelques minutes après un transfert d'APK **ne mesurent pas ce qu'elles croient mesurer**.

## Pourquoi le symptôme survit à R55 et R56

R55 et R56 ont travaillé sur la **composition** et sur le **GPU** : lecture du focus déplacée en phase
de dessin, suppression des `composed`, plafond de texture des jaquettes, fenêtre paresseuse ajustée à
la classe mémoire. Ces corrections sont justes, et le rapport Compose confirme que le chemin chaud est
skippable.

Or la lecture du code R56 montre que les blocages restants ne sont, pour l'essentiel, **pas des
problèmes de Compose**. Ce sont trois choses que ni le compilateur Compose ni les tests JVM ne peuvent
voir : de l'analyse JSON exécutée sur le fil principal, des images sans plafond de définition, et une
prélecture qui s'annule elle-même exactement pendant le geste qu'elle doit couvrir.

---

## P0-1 — Tout le JSON est analysé sur le fil principal

**Le fait.** `requestRaw` bascule bien sur `Dispatchers.IO` (`FlixTunesApi.kt:185`) — mais il rend une
**chaîne**. La construction du `JSONObject` a lieu dans `request`, une fonction `suspend` sans
`withContext` (`FlixTunesApi.kt:182`), donc dans le contexte de l'appelant. Et l'appelant est toujours
`viewModelScope`, c'est-à-dire `Dispatchers.Main.immediate`. Les `parseHome`, `parseCatalogPage` et
`parseDetails` (`Models.kt:190-240`) s'exécutent au même endroit.

**Le volume.** `parseMedia` fait vingt-deux consultations de table par fiche, plus une allocation
`Media`, plus les deux chaînes dérivées `displayTitle` et `secondaryText`. Une page de catalogue TV en
contient cent vingt. Une fiche de série contient tous les épisodes de toutes les saisons.

**Où cela se voit.**

| Moment | Charge sur le fil principal |
| --- | --- |
| `onResume` (`MainActivity.kt:233`) | `loadHome()` + `refreshDetails()` — huit rails plus la fiche ouverte, **à chaque retour du lecteur** |
| Ouverture d'une fiche de série | `parseDetails` de toutes les saisons et de tous leurs épisodes |
| Démarrage TV | `chargerCatalogueTv` boucle le catalogue entier par pages de 120 ; les deux `async` héritent de Main, donc films **et** séries s'analysent en file sur ce même fil |
| Pagination, filtre, recherche, saut A–Z hors cache | une page de 120 fiches analysée pendant que la grille défile |

`JSONObject(texte)` sur une centaine de kilo-octets, suivi de cent vingt `parseMedia`, forme un bloc
d'un seul tenant, sans point de reprise possible pour le compositeur. C'est exactement la forme d'un
à-coup : pas une dégradation progressive, un arrêt net puis une reprise.

**La correction est sans risque visuel** : envelopper l'analyse dans `withContext(Dispatchers.Default)`.
Aucun pixel ne change, aucun contrat ne bouge.

---

## P0-2 — La prélecture s'annule pendant le maintien qu'elle est censée couvrir

`MainActivity.kt:1468-1505` :

```
snapshotFlow { dernier index visible }
    .distinctUntilChanged()
    .collectLatest { delay(140); … prélecture de douze affiches … }
```

Une répétition de touche de télécommande arrive toutes les quarante à soixante millisecondes. Le
dernier index visible change donc plus vite que le délai de cent quarante millisecondes, et
`collectLatest` annule la prélecture **avant qu'elle ne commence**. Elle ne s'exécute que lorsque la
personne s'arrête — c'est-à-dire au seul moment où l'on n'en a pas besoin.

La `LazyLayoutCacheWindow` réglée en R55 souffre du même principe : elle remplit son avance pendant
les **temps morts d'image**. Un maintien vertical n'en laisse pas.

Autrement dit, pendant les trente secondes de maintien inscrites au protocole de qualification R55,
**aucun des deux mécanismes de préparation n'est actif**, et chaque rangée nouvelle est composée,
mesurée et décodée dans l'image même où le focus y arrive.

À cela s'ajoute un détail vérifié dans le bytecode : le `RealImageLoader` de Coil 3 s'appuie sur
`getMainCoroutineContextLazy`. **Chaque `execute()` démarre et se termine sur le fil principal** —
seuls le téléchargement et le décodage partent ailleurs. Douze prélectures par pause, ce sont douze
allers-retours de fil principal ; le préchauffage de démarrage (`MainViewModel.kt:380`) en lance
vingt-quatre à soixante-quatre d'un coup, le sémaphore ne bornant que la concurrence, pas les
publications.

---

## P0-3 — Les grandes images ne sont plafonnées nulle part

R56 a plafonné les **jaquettes** (224/256/288 px selon la classe mémoire). Cinq `AsyncImage` échappent
encore à tout plafond et se décodent à la taille de leur emplacement :

| Emplacement | Fichier | Surface sur TV |
| --- | --- | --- |
| Fond de vitrine d'accueil | `MainActivity.kt:1223` | pleine largeur × 470 dp |
| Bandeau de fiche | `MainActivity.kt:2028` | pleine largeur × 500 dp |
| Portrait de personne | `MainActivity.kt:1916`, `:1946` | variable |
| Affiche de saison | `ui/Fiche.kt:104` | carte de saison |

Sur une dalle 1080p à densité 2, le bandeau de fiche fait 1920 × 1000 px, soit **7,7 Mio en
ARGB_8888**. Le cache mémoire est réglé à 28 % du tas (`FlixTunesApplication.kt`), c'est-à-dire
environ 72 Mio sur un boîtier de classe 256 Mio.

**Un seul bandeau occupe donc la place d'une quinzaine de jaquettes** — précisément celles que R56
s'est employé à garder. Ouvrir une fiche, revenir : la grille redécode ce qu'elle avait déjà. Ce
cycle-là correspond au symptôme décrit — « marche très bien », puis saccade — beaucoup mieux qu'une
lenteur uniforme.

À noter : les visuels extraits localement sont déjà bornés à 1280 × 720 côté serveur
(`apps/server/src/artwork.ts:115`) ; ce sont les visuels TMDB en `original` qui n'ont pas de borne
côté client.

---

## P1-4 — Un seul `MainState` au sommet de l'arbre

`var state by mutableStateOf(MainState())` (`MainViewModel.kt:123`) est lu par `FlixTunesApp`
(`MainActivity.kt:271`). Tout changement d'un seul champ remplace l'objet entier : la barre du haut,
l'en-tête de catalogue et l'écran courant repassent en composition.

Le rapport R55 a raison de dire que ces composables sont *skippables*. Mais ils ne sont pas *skippés*,
puisque le paramètre a réellement changé. Chaque bascule de `loading` d'une section coûte deux
traversées complètes de l'arbre — et elles tombent aux mêmes instants que P0-1.

## P1-5 — Le coût d'une carte est dominé par la mise en page du texte

`ui/Composants.kt:314-390` : par carte, une `Jaquette` (Box + `clip` + `background(Brush)` +
`AsyncImage`), éventuellement la pastille « ✓ Vu » et une `LinearProgressIndicator`, puis **deux
`Text`**, dont le titre en `minLines = 2, maxLines = 2`.

Sur six colonnes, cela fait douze mises en page de texte par rangée composée. C'est le poste le plus
cher d'un élément paresseux, loin devant le reste, et rien ne le met en cache d'une rangée à l'autre.
S'y ajoute un `combinedClickable` installé sur **toutes** les cartes, `menu` n'étant jamais nul
(`MainActivity.kt:1831`), donc une détection de geste par carte.

## P1-6 — La restauration de focus coûte jusqu'à douze images

`ui/Composants.kt:334` : `repeat(12) { withFrameNanos { }; requestFocus() }`. Chaque `requestFocus()`
déclenche un parcours de l'arbre de focus et une demande de mise en vue animée. Cela se produit à
chaque retour de fiche — c'est-à-dire au moment exact où la grille se recompose et où les jaquettes se
redécodent (P0-3). Les trois se superposent sur les mêmes images.

## P2-7 — Détails de dessin

- La vitrine (`MainActivity.kt:1227-1228`) et le bandeau de fiche (`MainActivity.kt:2032-2033`) posent
  **deux dégradés plein écran** par-dessus l'image : trois passes de remplissage sur environ deux
  mégapixels. Les `Brush` y sont réalloués à chaque recomposition, alors que `Jaquette` prend soin de
  mémoriser le sien (`ui/Composants.kt:284`).
- `Theme.FlixTunes` (`values/styles.xml`) ne neutralise pas `windowBackground` : la `DecorView`
  remplit l'écran sous une `Surface` Compose déjà opaque.
- `AccueilEnAttente` (`MainActivity.kt:1195`) crée une cinquantaine de `rememberInfiniteTransition`
  indépendants, chacun invalidant son dessin à chaque image. L'écran de démarrage le masque au premier
  lancement TV, mais pas les suivants.

## P2-8 — La découverte NSD tourne pendant toute la session

`discovery.start()` à chaque `onResume`, arrêt seulement à `onPause` (`MainActivity.kt:233-240`),
serveur connu ou non. Le multicast mDNS reste actif tout le temps que l'application est à l'écran, et
chaque résolution repasse par le fil d'interface. Impact faible, correction gratuite : arrêter la
découverte dès qu'un serveur est retenu.

---

## Le point de méthode : les trois dernières comparaisons sont douteuses

Le Baseline Profile est bien présent — `app/src/main/baseline-prof.txt` contient une règle unique,
`HSPLtv/flixtunes/app/**->**(**)**`, et `ProfileInstallerInitializer` figure bien dans le manifeste
release fusionné (vérifié). Mais **ProfileInstaller ne fait qu'écrire le profil**. C'est ART qui
compile, au prochain passage de `bg-dexopt`, lorsque l'appareil est au repos.

Un APK transféré puis essayé dans la foulée tourne donc **sans compilation anticipée**, en interprété
et JIT. Chaque nouvelle révision repart de zéro sur ce plan. La phrase de l'audit R55 — « le
préchargement réseau R54 n'a produit aucune amélioration visible » — peut donc décrire un écart de
chauffe autant qu'un écart de code.

Avant toute mesure, et avant toute comparaison entre deux révisions :

```bash
adb shell cmd package compile -m speed-profile -f tv.flixtunes.app
```

## Comment mesurer, maintenant que c'est possible

L'absence d'appareil relié n'est plus une fatalité : le téléviseur et le poste de construction sont
sur le même réseau, et `adb` est installé.

1. Sur le téléviseur : Paramètres → Options pour les développeurs → Débogage réseau (ou USB).
2. `adb connect <adresse-du-televiseur>:5555`
3. Forcer la compilation (commande ci-dessus), lancer l'application, la laisser une minute.
4. `adb shell dumpsys gfxinfo tv.flixtunes.app reset`, maintenir Bas trente secondes dans Films, puis
   `adb shell dumpsys gfxinfo tv.flixtunes.app` : pourcentage d'images en retard et centiles
   50/90/95/99.
5. Pour situer la cause et non la compter : `record_android_trace -o trace -t 20s sched freq gfx view
   binder_driver`, puis lire le fil principal dans Perfetto. Les blocs P0-1 y apparaîtront comme des
   segments continus hors `Choreographer#doFrame`.
6. Sans câble ni ADB : `androidx.metrics:metrics-performance` (JankStats) dans la variante debug, qui
   publie ses relevés vers le NAS — le même schéma que la route de diagnostic R54, à retirer ensuite
   de la même façon.

## Ordre de travail proposé — rien n'est construit sans accord

| Rang | Correction | Gain attendu | Risque |
| --- | --- | --- | --- |
| 1 | Analyse JSON sur `Dispatchers.Default` | Supprime les blocs les plus longs : retour du lecteur, ouverture d'une série, pagination | Nul visuellement |
| 2 | Plafonner bandeaux, portraits et affiches de saison | Le cache cesse d'être vidé par une seule image ; fin du cycle fiche → grille | Définition du bandeau, à juger à trois mètres |
| 3 | Prélecture pilotée par l'**index focalisé**, régulée, sans `delay` ni annulation | La préparation fonctionne enfin *pendant* le maintien | Moyen : c'est le mécanisme déjà repris deux fois |
| 4 | Sortir les sections de catalogue de `MainState` | Moins de traversées complètes de l'arbre | Faible, mais chirurgie de structure |
| 5 | Alléger la carte (texte, `combinedClickable` sur TV) | Rangée composée moins chère | Le titre sur deux lignes est un choix graphique venu du Web |
| 6 | Restauration de focus : une tentative et un repli | Retire douze images de travail au retour de fiche | Faible ; régression de focus déjà connue en R47 |

Les points P2 sont volontairement laissés de côté tant que 1 à 3 n'ont pas été mesurés : ce sont des
gains de quelques pour cent, et les mêler aux autres rendrait la mesure illisible.
