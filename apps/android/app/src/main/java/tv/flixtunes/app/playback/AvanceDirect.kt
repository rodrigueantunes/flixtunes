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
    return maxOf(segment, minOf(souhaitee, fenetreMs - segment))
}
