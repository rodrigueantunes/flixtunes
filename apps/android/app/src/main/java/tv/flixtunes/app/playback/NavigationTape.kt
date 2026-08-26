package tv.flixtunes.app.playback

/**
 * Le saut demandé par des tapes répétées sur le bord de l'écran.
 *
 * Le geste existait, mais il ne se déclenchait jamais. Le détecteur était installé par un
 * `pointerInput` dont les clés incluaient la position de lecture — laquelle change quatre fois par
 * seconde. Compose recrée le détecteur à chaque changement de clé : un double tape, qui s'étale sur
 * environ trois cents millisecondes, était donc détruit avant d'avoir pu se former. La simple tape
 * qui réveille les commandes se perdait de la même façon, ce qui rendait la barre de progression
 * difficile à faire apparaître.
 *
 * Une fois le détecteur stable, reste à cumuler. Un seul saut de dix secondes oblige à attendre la
 * fin de l'animation avant de recommencer ; ce qu'on veut, en tapotant, c'est avancer de plus en plus
 * loin. Chaque tape supplémentaire du même côté, dans la foulée, ajoute donc un pas — et la série
 * part **de la position d'avant le premier saut**, non de la position courante, sans quoi les sauts
 * se contrarieraient : la lecture n'a pas encore atteint la cible précédente quand la suivante est
 * demandée.
 *
 * Fonction pure, éprouvée sans appareil : c'est la seule façon de vérifier un geste depuis ce poste.
 */

/** Un pas de navigation, aligné sur les boutons ±10 de la barre et sur ceux du lecteur Web. */
const val PAS_NAVIGATION_S = 10.0

/**
 * Au-delà de ce silence, la série est close et la tape suivante repart de la position courante.
 *
 * Assez long pour tapoter sans se presser, assez court pour qu'une tape isolée une minute plus tard
 * ne s'ajoute pas à un saut oublié depuis longtemps.
 */
const val FENETRE_CUMUL_MS = 1_500L

/** Une série de tapes en cours, et où elle veut mener. */
data class SerieTapes(
    /** Position du film au moment où la série a commencé. */
    val base: Double,
    /** Somme des pas demandés depuis, négative vers l'arrière. */
    val cumul: Double,
    /** Sens de la série : -1 vers l'arrière, +1 vers l'avant. */
    val cote: Int,
    /** Instant de la dernière tape, en millisecondes. */
    val instantMs: Long,
) {
    /** L'instant du film visé par la série. Jamais avant le début. */
    val cible: Double get() = maxOf(0.0, base + cumul)
}

/**
 * Ajoute une tape à la série, ou en ouvre une nouvelle.
 *
 * Une série se poursuit tant que la tape suivante vient du **même côté** et dans la fenêtre. Changer
 * de côté ouvre une série neuve plutôt que de retrancher au cumul : quelqu'un qui tape à gauche après
 * avoir trop avancé veut revenir en arrière depuis là où il est, pas annuler son geste précédent.
 */
fun cumulerTape(
    precedente: SerieTapes?,
    positionSecondes: Double,
    cote: Int,
    instantMs: Long,
    pasSecondes: Double = PAS_NAVIGATION_S,
    fenetreMs: Long = FENETRE_CUMUL_MS,
): SerieTapes {
    val sens = if (cote < 0) -1 else 1
    val enchaine = precedente != null && precedente.cote == sens && instantMs - precedente.instantMs <= fenetreMs
    if (enchaine) {
        return precedente!!.copy(cumul = precedente.cumul + pasSecondes * sens, instantMs = instantMs)
    }
    // Une position aberrante — un lecteur qui n'a pas encore de durée — ne doit pas produire une cible
    // absurde : on repart de zéro plutôt que de propager le NaN dans un `seekTo`.
    val depart = if (positionSecondes.isFinite() && positionSecondes > 0) positionSecondes else 0.0
    return SerieTapes(base = depart, cumul = pasSecondes * sens, cote = sens, instantMs = instantMs)
}
