package tv.flixtunes.app.playback

import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Choix du mode d'affichage accordé à la cadence du film.
 *
 * Un film de cinéma est tourné à 23,976 images par seconde ; un téléviseur affiche par défaut 60 Hz.
 * 60 ne se divise pas par 23,976 : le lecteur doit alors montrer une image pendant trois
 * rafraîchissements, la suivante pendant deux, et ainsi de suite. C'est le « 3:2 pulldown », et il se
 * voit — les travellings lents saccadent, une caméra qui balaie un paysage avance par à-coups. Aucun
 * réglage de qualité, aucun débit supplémentaire ne le corrige : c'est la cadence qui ne tombe pas
 * juste.
 *
 * La correction consiste à demander à l'écran un mode dont la fréquence est un multiple entier de la
 * cadence du film — 23,976 Hz, ou 47,952, ou 119,88. Chaque image dure alors exactement le même temps,
 * et le mouvement redevient continu.
 *
 * Le calcul est isolé ici, sans dépendance à Android, pour deux raisons : il est vérifiable sur une
 * machine ordinaire, et le juger est affaire d'arithmétique, pas de système. `Display.Mode` ne se
 * fabrique pas dans un test ; [DisplayModeInfo] si.
 */

/** Un mode d'affichage tel que le système le décrit : identifiant, définition, fréquence. */
data class DisplayModeInfo(val id: Int, val width: Int, val height: Int, val refreshRate: Double)

/**
 * Écart maximal toléré entre la fréquence de l'écran et le multiple le plus proche de la cadence,
 * exprimé en fraction d'image.
 *
 * 0,02 laisse passer les imprécisions d'annonce des téléviseurs (59,94 déclaré « 60,0 ») sans jamais
 * accepter un mode qui imposerait un pulldown : le pire cas, 23,976 sur 60 Hz, se situe à 0,5 — vingt-
 * cinq fois au-delà.
 */
const val TOLERANCE_CADENCE = 0.02

/**
 * Le mode à demander pour lire à [contentFps], ou `null` s'il faut garder celui en cours.
 *
 * Ne sont retenus que les modes de même définition que [current] : changer de définition en cours de
 * lecture rallume l'écran, coupe l'image plusieurs secondes et fait parfois retomber la chaîne HDR.
 * Le gain de fluidité ne vaut pas ce prix.
 *
 * Aucun mode plus lent que le film n'est retenu non plus : afficher 60 images par seconde sur un écran
 * à 24 Hz n'enlève pas la saccade, il en supprime des images.
 */
fun chooseDisplayMode(modes: List<DisplayModeInfo>, current: DisplayModeInfo, contentFps: Double): DisplayModeInfo? {
    if (contentFps <= 0.0 || !contentFps.isFinite()) return null
    val candidats = modes.filter {
        it.width == current.width && it.height == current.height &&
            it.refreshRate >= contentFps - contentFps * TOLERANCE_CADENCE &&
            ecartCadence(it.refreshRate, contentFps) <= TOLERANCE_CADENCE
    }
    // À écart égal, la fréquence la plus basse : elle consomme moins, chauffe moins, et sur beaucoup
    // de téléviseurs c'est le mode natif du panneau — celui où le traitement d'image est le plus sobre.
    val meilleur = candidats.minWithOrNull(
        compareBy({ arrondi(ecartCadence(it.refreshRate, contentFps)) }, { it.refreshRate }, { it.id }),
    ) ?: return null
    return if (meilleur.id == current.id) null else meilleur
}

/**
 * Distance à la cadence idéale, en fraction d'image.
 *
 * Zéro quand la fréquence est un multiple exact : chaque image dure alors le même nombre de
 * rafraîchissements. 0,5 au pire — une image sur deux tiendrait un rafraîchissement de trop.
 */
fun ecartCadence(refreshRate: Double, contentFps: Double): Double {
    val multiple = (refreshRate / contentFps).roundToInt().coerceAtLeast(1)
    return abs(refreshRate - multiple * contentFps) / contentFps
}

/** Comparer des écarts au millième : au-delà, on départage du bruit de virgule flottante. */
private fun arrondi(valeur: Double): Int = (valeur * 1000).roundToInt()
