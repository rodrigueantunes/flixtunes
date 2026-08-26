package tv.flixtunes.app.playback

/**
 * Temps du film contre temps du flux.
 *
 * En conversion, le serveur n'encode pas le film d'un coup : il produit une fenêtre qui commence à un
 * décalage et s'allonge au fil de la lecture. Le lecteur, lui, ne connaît que cette fenêtre — sa durée
 * est celle de ce qui est déjà encodé, et sa position part de zéro à l'intérieur.
 *
 * S'en remettre à ces valeurs donne une interface qui ment : une barre de progression dont le temps
 * total grandit pendant la lecture, un film de deux heures annoncé à trois minutes, et un curseur
 * qu'on ne peut pas déplacer au-delà. C'est ce que faisait le lecteur Android, quand le lecteur Web
 * fait la traduction depuis l'étape 55.
 *
 * Deux repères suffisent : le décalage auquel la session a démarré, et la durée réelle du film mesurée
 * par FFprobe côté serveur.
 */

/** L'état de la fenêtre encodée, en secondes. */
data class FenetreLecture(
    /** Point du film où cette session a commencé à encoder. */
    val decalageSecondes: Double,
    /** Durée réelle du film, mesurée sur le fichier — jamais celle de la fenêtre. */
    val dureeReelleSecondes: Double,
)

/** Position dans le film, à partir de la position rapportée par le lecteur. */
fun tempsFilm(positionFlux: Double, fenetre: FenetreLecture): Double =
    (fenetre.decalageSecondes + positionFlux).coerceAtLeast(0.0)

/** Position dans le flux, à partir d'une position visée dans le film. */
fun tempsFlux(positionFilm: Double, fenetre: FenetreLecture): Double =
    (positionFilm - fenetre.decalageSecondes).coerceAtLeast(0.0)

/**
 * Marge de sécurité avant le bord de la fenêtre encodée, en secondes.
 *
 * Viser exactement la fin de ce qui est encodé revient à viser un point que le serveur n'a pas fini
 * d'écrire : la lecture s'y arrête au lieu de reprendre. Quelques secondes de recul suffisent, et
 * coûtent moins qu'une relance de session.
 */
const val MARGE_FENETRE = 6.0

/**
 * Faut-il redemander une session au serveur pour atteindre [cibleFilm] ?
 *
 * Vrai quand la cible tombe hors de ce qui est encodé — avant le début de la fenêtre, ou au-delà de
 * son bord. Dans ce cas seulement il faut relancer : une relance coûte une négociation complète et
 * quelques secondes d'attente, on ne la déclenche pas pour un déplacement que la fenêtre couvre déjà.
 *
 * [dureeFluxSecondes] est la durée que le lecteur rapporte, c'est-à-dire la portion encodée.
 */
fun relanceNecessaire(cibleFilm: Double, fenetre: FenetreLecture, dureeFluxSecondes: Double): Boolean {
    if (cibleFilm < fenetre.decalageSecondes) return true
    // Une durée de flux inconnue — le lecteur n'a pas encore de manifeste — ne prouve rien : mieux
    // vaut laisser le lecteur essayer que relancer une session dont on n'a pas montré le besoin.
    if (dureeFluxSecondes <= 0.0) return false
    return cibleFilm > fenetre.decalageSecondes + dureeFluxSecondes - MARGE_FENETRE
}

/**
 * La durée à afficher, en millisecondes.
 *
 * La durée réelle dès qu'on la connaît ; sinon celle du lecteur, qui vaut mieux que rien. En lecture
 * directe les deux coïncident — la traduction est alors sans effet, et c'est voulu : un seul chemin
 * pour les deux modes évite qu'un seul des deux soit entretenu.
 */
fun dureeAffichee(fenetre: FenetreLecture, dureeLecteurMs: Long): Long =
    if (fenetre.dureeReelleSecondes > 0) (fenetre.dureeReelleSecondes * 1000).toLong() else dureeLecteurMs

/**
 * Un seek direct flushe le décodeur de certains téléviseurs sans réarmer leur sortie HDR.
 * Une fenêtre HLS/remuxée est déjà recréée par la navigation hors fenêtre ; le contournement ne doit
 * donc concerner que le fichier direct HDR, jamais le SDR ni une session encodée.
 */
fun reinitialisationHdrApresSeek(sessionMode: String?, formatSourceHdr: String?): Boolean =
    sessionMode == "direct" && !formatSourceHdr.isNullOrBlank() && formatSourceHdr != "sdr"
