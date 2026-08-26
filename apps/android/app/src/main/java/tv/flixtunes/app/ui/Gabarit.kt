package tv.flixtunes.app.ui


/**
 * Ce qui distingue la surface télévision de la surface tactile.
 *
 * Ces différences étaient dispersées dans le code d'écran sous forme de quarante-huit `if (isTv)`,
 * et le drapeau devait être passé en paramètre à chaque composable pour les atteindre. Trois défauts
 * en découlaient : aucune des deux surfaces n'était lisible d'un seul tenant, tout ajout devait penser
 * aux deux cas à la fois, et il était impossible de vérifier l'un sans afficher l'autre.
 *
 * Les regrouper ici les rend consultables — et vérifiables sans appareil ni rendu.
 *
 * Le principe qui les gouverne : un téléviseur se regarde à trois mètres et se commande au pouce sur
 * une croix directionnelle. Tout y est plus grand, plus espacé, et rien ne suppose qu'on puisse
 * désigner un point de l'écran.
 */
data class Gabarit(
    /** Vrai sur téléviseur. Décidé une seule fois, au démarrage. */
    val televiseur: Boolean,
    /** Marge extérieure des écrans, en points de densité. */
    val margeEcran: Int,
    /** Marge latérale des rails et grilles. */
    val margeBord: Int,
    /** Réserve basse : la barre de navigation tactile en bas, rien de tel sur téléviseur. */
    val margeBasse: Int,
    /** Largeur d'une jaquette. */
    val largeurCarte: Int,
    /** Largeur d'une carte de saison, un cran plus large qu'une jaquette de film. */
    val largeurSaison: Int,
    /** Corps du titre principal. */
    val tailleTitre: Int,
    /** Corps d'un intitulé de section. */
    val tailleSection: Int,
    /** Corps du texte courant. */
    val tailleTexte: Int,
    /** Côté du logo au démarrage. */
    val tailleLogo: Int,
    /** Corps du grand titre d'une fiche, plus imposant que celui d'un écran. */
    val tailleTitreFiche: Int,
    /** Corps d'un sous-titre ou d'une accroche. */
    val tailleAccroche: Int,
    /** Hauteur de l'image d'ambiance d'une fiche. */
    val hauteurBandeau: Int,
    /** Écart entre deux jaquettes d'un rail ou d'une grille. */
    val ecartCartes: Int,
    /** Marge intérieure d'une carte ou d'un bloc de texte. */
    val margeInterne: Int,
    /** Corps du mot « FlixTunes » sous le logo, au démarrage. */
    val tailleEnseigne: Int,
    /** Corps du titre d'un catalogue vide — plus discret que le titre d'un écran. */
    val tailleTitreCatalogue: Int,
    /** Largeur minimale d'une case de grille : c'est elle qui décide du nombre de colonnes. */
    val largeurMiniGrille: Int,
    /** Corps du titre affiché dans la vitrine d'accueil, le plus grand de l'application. */
    val tailleTitreVitrine: Int,
    /** Hauteur de la vitrine d'accueil. */
    val hauteurVitrine: Int,
    /** Marge d'un bloc de texte posé sur une image, qui doit s'écarter davantage des bords. */
    val margeSurImage: Int,
    /**
     * Agrandissement de l'élément qui a le focus.
     *
     * Sur téléviseur, c'est la moitié de l'indication : l'élément visé avance vers le spectateur. Au
     * doigt, il n'y a pas de focus à montrer — la valeur est 1, et l'effet disparaît.
     */
    val focusEchelle: Float,
    /** Épaisseur du liseré qui entoure l'élément visé. Zéro au doigt. */
    val focusBordure: Int,
    /**
     * Navigation par croix directionnelle plutôt qu'au doigt.
     *
     * Ce n'est pas qu'une question de taille : sans pointeur, tout élément actionnable doit pouvoir
     * recevoir le focus et se distinguer visuellement quand il l'a. C'est ce drapeau qui commande cette
     * partie-là, et non l'aspect.
     */
    val naviguerAuFocus: Boolean,
    /**
     * Les commandes du lecteur tiennent-elles sur une seule rangée ?
     *
     * Un téléviseur est large et regardé de loin : tout y tient de front. Un téléphone tenu debout ne
     * fait pas la moitié de cette largeur, et les huit commandes s'y écrasaient jusqu'à sortir de
     * l'écran — les dernières, minuteur et image dans l'image, devenaient inatteignables.
     */
    val commandesEmpilees: Boolean,
    /**
     * Côté d'une cible tactile, en points de densité.
     *
     * Quarante-huit est le minimum sous lequel un doigt rate sa cible plus souvent qu'il ne l'atteint.
     * Les boutons du lecteur en faisaient trente-six : dimensionnés pour un curseur de télécommande,
     * qui vise au pixel près et ne masque rien.
     *
     * **Zéro sur téléviseur, et ce n'est pas un oubli.** Là-bas rien ne se touche : élargir la zone
     * sensible n'apporterait rien et déplacerait le liseré de focus, qui se dessine autour de la zone
     * cliquable. Le rendu télévision reste donc exactement celui d'avant.
     */
    val cibleTactile: Int,
    /** Épaisseur du trait de la barre de progression. */
    val epaisseurBarre: Int,
    /**
     * Hauteur de la zone qui capte la saisie sur la barre, bien plus haute que le trait lui-même.
     *
     * Viser un trait de six points avec un pouce revient à viser à l'aveugle : le doigt le masque
     * avant de l'atteindre. La zone sensible déborde donc largement au-dessus et au-dessous.
     */
    val hauteurZoneBarre: Int,
    /** Côté de la pastille qui marque la position. */
    val tailleCurseur: Int,
    /**
     * Double tape à gauche ou à droite pour reculer ou avancer de dix secondes.
     *
     * C'est le geste que tous les lecteurs mobiles emploient, et il évite d'aller chercher un petit
     * bouton pendant qu'on regarde. Sur téléviseur il n'a pas de sens : la télécommande a ses touches,
     * et il n'y a pas de « côté de l'écran » sous le doigt.
     */
    val tapeDoubleNavigation: Boolean,
)

/** Le gabarit de la surface tactile — téléphone et tablette. */
val GABARIT_TACTILE = Gabarit(
    televiseur = false, margeEcran = 24, margeBord = 18, margeBasse = 104, largeurCarte = 130, largeurSaison = 152,
    tailleTitre = 30, tailleSection = 16, tailleTexte = 14, tailleLogo = 96,
    tailleTitreFiche = 38, tailleAccroche = 21, hauteurBandeau = 420, ecartCartes = 12, margeInterne = 16,
    tailleEnseigne = 26, tailleTitreCatalogue = 24, largeurMiniGrille = 116, tailleTitreVitrine = 40, hauteurVitrine = 390, margeSurImage = 20,
    focusEchelle = 1f, focusBordure = 0, naviguerAuFocus = false, commandesEmpilees = true, cibleTactile = 48, epaisseurBarre = 6, hauteurZoneBarre = 56, tailleCurseur = 20, tapeDoubleNavigation = true,
)

/**
 * Budget graphique de l'appareil, approché par la mémoire qu'il accorde.
 *
 * L'énumération vit ici, avec les tailles qu'elle commande ; **la façon de la déterminer vit côté
 * plateforme** — voir `AppareilAndroid`. C'est la frontière : ce fichier dit ce qu'on fait d'une
 * classe de mémoire, pas comment on la découvre.
 */
enum class MemoireTv { CONTRAINTE, STANDARD, LARGE }

/** Une taille d'écran décodée, puis davantage uniquement si la mémoire le permet. */
fun nombreAffichesInitialesTv(memoire: MemoireTv): Int = when (memoire) {
    MemoireTv.CONTRAINTE -> 24
    MemoireTv.STANDARD -> 48
    MemoireTv.LARGE -> 64
}

/**
 * Largeur de décodage commune aux cartes, au préchargement et au cache TV.
 *
 * Une carte de catalogue mesure environ 132–148 dp. Sur la densité habituelle d'une dalle 4K, un
 * décodage 320 px dépassait sa surface, puis la prélecture et la carte pouvaient demander deux tailles
 * voisines — donc deux bitmaps pour la même affiche. Ces plafonds gardent une marge pour le zoom de
 * focus de 6 %, tout en réduisant de 19 à 51 % le nombre de pixels selon la classe mémoire. À trois
 * mètres, la différence est sous la taille d'un pixel logique de la carte.
 */
fun tailleTextureJaquetteTv(memoire: MemoireTv): Int = when (memoire) {
    // R58 retire environ 12 % sur chaque axe par rapport à R57. À la taille réelle d'une carte
    // (132–148 dp), ces valeurs couvrent encore les pixels utiles, y compris le relief de focus,
    // mais chaque rangée demande près d'un quart de pixels en moins à décoder et transférer au GPU.
    MemoireTv.CONTRAINTE -> 208
    MemoireTv.STANDARD -> 240
    MemoireTv.LARGE -> 272
}

/** Largeur d'un bandeau TV : assez fine pour rester nette sous ses voiles, sans évincer les affiches. */
fun tailleTextureBandeauTv(memoire: MemoireTv): Int = when (memoire) {
    MemoireTv.CONTRAINTE -> 1024
    MemoireTv.STANDARD -> 1280
    MemoireTv.LARGE -> 1440
}

/**
 * Tablette et écran pliable déplié.
 *
 * Le téléphone agrandi tel quel laisse d'immenses marges vides autour de cartes de 130 dp et garde
 * une vitrine très haute. Ce gabarit densifie la grille, élargit légèrement les cartes et limite les
 * grands aplats, sans activer la navigation au focus réservée au téléviseur.
 */
val GABARIT_TABLETTE = Gabarit(
    televiseur = false, margeEcran = 32, margeBord = 28, margeBasse = 104, largeurCarte = 152, largeurSaison = 176,
    tailleTitre = 34, tailleSection = 18, tailleTexte = 15, tailleLogo = 108,
    tailleTitreFiche = 44, tailleAccroche = 23, hauteurBandeau = 440, ecartCartes = 14, margeInterne = 18,
    tailleEnseigne = 29, tailleTitreCatalogue = 26, largeurMiniGrille = 142, tailleTitreVitrine = 46, hauteurVitrine = 420, margeSurImage = 32,
    focusEchelle = 1f, focusBordure = 0, naviguerAuFocus = false, commandesEmpilees = false, cibleTactile = 48, epaisseurBarre = 7, hauteurZoneBarre = 56, tailleCurseur = 20, tapeDoubleNavigation = true,
)

/**
 * Le gabarit de la surface télévision, pensée pour trois mètres de recul.
 *
 * Les textes restent agrandis, mais une jaquette n'a pas besoin d'occuper un quart de la largeur.
 * Avec une largeur logique courante de 960 dp, 180 dp ne laissaient que quatre colonnes et donnaient
 * au catalogue l'allure d'un carrousel. La grille vise désormais six colonnes à cette largeur, quatre
 * sur une petite surface de 720 dp et huit autour de 1280 dp. Les rails gardent des cartes un peu plus
 * larges que la grille afin de rester confortables à trois mètres.
 */
val GABARIT_TELEVISION = Gabarit(
    televiseur = true, margeEcran = 56, margeBord = 44, margeBasse = 40, largeurCarte = 148, largeurSaison = 188,
    tailleTitre = 42, tailleSection = 20, tailleTexte = 16, tailleLogo = 132,
    tailleTitreFiche = 52, tailleAccroche = 26, hauteurBandeau = 500, ecartCartes = 14, margeInterne = 18,
    tailleEnseigne = 34, tailleTitreCatalogue = 30, largeurMiniGrille = 132, tailleTitreVitrine = 54, hauteurVitrine = 470, margeSurImage = 52,
    focusEchelle = 1.06f, focusBordure = 2, naviguerAuFocus = true, commandesEmpilees = false, cibleTactile = 0, epaisseurBarre = 10, hauteurZoneBarre = 44, tailleCurseur = 18, tapeDoubleNavigation = false,
)

/** Le gabarit correspondant à l'appareil. */
fun gabaritPour(televiseur: Boolean): Gabarit = if (televiseur) GABARIT_TELEVISION else GABARIT_TACTILE

/**
 * Variante sensible à la largeur pour les surfaces tactiles.
 *
 * 600 dp est le seuil Android usuel d'une tablette compacte. La télévision gagne toujours, même si
 * un boîtier annonce une largeur atypique : sa télécommande et son focus sont une capacité, pas une
 * conséquence de la taille.
 */
fun gabaritPour(televiseur: Boolean, largeurDp: Int): Gabarit = when {
    televiseur -> GABARIT_TELEVISION
    largeurDp >= 600 -> GABARIT_TABLETTE
    else -> GABARIT_TACTILE
}
