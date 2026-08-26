package tv.flixtunes.app.playback

/**
 * Ce qu'il faut faire quand le réseau change sous les pieds de la lecture.
 *
 * Une bascule Wi-Fi vers Ethernet, un changement de borne, un téléphone qui passe du Wi-Fi aux données
 * mobiles : la connexion en cours meurt, le lecteur signale une erreur d'entrée-sortie, et la reprise
 * attend son délai avant de réessayer — jusqu'à quatre secondes après la dernière tentative, alors que
 * la nouvelle connexion est déjà prête depuis longtemps.
 *
 * Le système, lui, sait exactement quand une interface devient utilisable. S'en servir remplace
 * l'attente par un fait : on ne réessaie pas parce qu'un délai est écoulé, on réessaie parce que le
 * réseau est revenu.
 */

/** L'état des reprises pour la lecture en cours. */
data class EtatReprises(
    /** Coupures déjà reprises. Au-delà du budget, le lecteur renonce et le dit. */
    val utilisees: Int,
    /** Vrai tant qu'une reprise est programmée mais pas encore tentée. */
    val enAttente: Boolean,
)

/**
 * L'état après le retour du réseau, et s'il faut réessayer sur-le-champ.
 *
 * Le compteur repart de zéro, et c'est le point important. Une bascule d'interface n'est pas une
 * répétition de la même panne : c'est un fait nouveau, qui explique l'échec précédent et le rend
 * caduc. Sans cette remise à zéro, quatre changements de borne au cours d'un long film épuiseraient le
 * budget et fermeraient le lecteur — alors que chacun s'est résolu tout seul.
 *
 * Rien ne se déclenche si aucune reprise n'attend : un réseau qui apparaît pendant une lecture qui se
 * porte bien — une seconde interface qui s'active — ne doit pas interrompre l'image.
 */
fun surRetourReseau(etat: EtatReprises): Pair<EtatReprises, Boolean> =
    if (etat.enAttente) EtatReprises(utilisees = 0, enAttente = false) to true
    else etat to false

/**
 * Vrai si le changement annoncé mérite qu'on réagisse.
 *
 * Le système signale aussi les réseaux qui disparaissent et les capacités qui évoluent sans que la
 * route change. Ne réagir qu'à une interface **devenue utilisable** évite de relancer une lecture à
 * chaque soubresaut de la pile réseau — un téléphone en déplacement en produit beaucoup.
 */
fun changementUtile(estUtilisable: Boolean, memeReseauQuAvant: Boolean): Boolean =
    estUtilisable && !memeReseauQuAvant
