package tv.flixtunes.app.playback

/**
 * L'avance prise derrière le bord du direct : de quoi traverser une coupure sans que l'image s'arrête.
 * Transcrite de `avance-direct.ts`, le client Web étant la référence.
 *
 * Un direct ne se met en réserve que sur ce que la chaîne a déjà publié : l'avance maximale possible
 * **est** la distance au bord. Elle se prend donc dans la fenêtre, jamais au-delà, en gardant une marge
 * arrière pour ne pas réclamer un segment que l'hébergeur vient de retirer.
 *
 * **Décidé le 13 septembre 2026 : jusqu'à 60 s, selon la fiabilité.** Une source qui n'a jamais calé
 * reste à 40 s du bord ; une source qui a déjà calé depuis qu'on la regarde, ou que le serveur connaît
 * pour ses échecs, prend jusqu'à 60 s. Sur la fenêtre médiane du corpus — 61 s —, cela ne donne pas
 * plus de 41 s.
 */

/** L'avance d'une source qui n'a jamais calé. */
const val AVANCE_NORMALE_MS = 40_000L

/** L'avance d'une source fragile, là où la fenêtre le permet. */
const val AVANCE_FRAGILE_MS = 60_000L

/** Ce qu'on refuse de laisser entre le point de lecture et le bord arrière de la fenêtre. */
const val MARGE_ARRIERE_AVANCE_MS = 20_000L

/**
 * L'avance visée, en millisecondes : ce que la fenêtre permet, relevé à deux segments, plafonné selon
 * la fiabilité, puis rabattu dans la fenêtre avec un segment de garde.
 */
fun avanceViseeMs(fenetreMs: Long, segmentMs: Long, fragile: Boolean): Long {
    val segment = segmentMs.coerceAtLeast(1_000L)
    val plafond = if (fragile) AVANCE_FRAGILE_MS else AVANCE_NORMALE_MS
    val souhaitee = minOf(plafond, maxOf(2 * segment, fenetreMs - MARGE_ARRIERE_AVANCE_MS))
    return maxOf(0L, minOf(plafond, souhaitee, fenetreMs - minOf(segment, fenetreMs / 2)))
}

/*
 * r12 — **aucun saut que l'on puisse éviter.**
 *
 * Le direct joue désormais toujours à 1× : la vitesse variable (0,97× à 1,06×) recalait la latence en
 * continu, et chaque écart à 1× désaccorde la cadence des images d'avec l'écran — des micro-saccades,
 * visibles sur un téléviseur réglé à 50 Hz. Sans rattrapage, le retard ne grandit qu'à chaque calage,
 * et l'on ne bouge que lorsque la fenêtre de la chaîne l'impose : au bord arrière. Là, on reprend au
 * plus près de ce bord, pas à l'avance visée — sur une fenêtre de cinq minutes, revenir à 40 s du
 * direct faisait sauter quatre minutes de programme.
 */

/** Sous cette marge au bord arrière, la lecture va tomber hors de ce que la chaîne publie encore. */
const val SEUIL_BORD_ARRIERE_MS = 12_000L

/** La marge où l'on reprend : trois segments ordinaires, de quoi absorber un rechargement de playlist. */
const val MARGE_REPRISE_MS = 24_000L

/** Faut-il reprendre parce que le bord arrière approche ? Jamais sur une fenêtre trop courte pour en avoir un. */
fun doitReprendreAuBordArriere(positionMs: Long, fenetreMs: Long, segmentMs: Long): Boolean {
    val segment = segmentMs.coerceAtLeast(1_000L)
    if (fenetreMs <= 2 * segment + MARGE_REPRISE_MS) return false
    return positionMs in 1 until maxOf(SEUIL_BORD_ARRIERE_MS, segment * 3 / 2)
}

/** Le point de reprise, compté depuis le bord arrière : le moins de programme sauté, sans retomber aussitôt. */
fun repriseAuBordArriereMs(fenetreMs: Long, segmentMs: Long): Long {
    val segment = segmentMs.coerceAtLeast(1_000L)
    return minOf(maxOf(MARGE_REPRISE_MS, 3 * segment), fenetreMs - segment).coerceAtLeast(0L)
}
