package tv.flixtunes.app.playback

/** Seuils proportionnés à la réserve réellement possible (fenêtre et budget mémoire). */
class DebitContinu {
    private var changement = -20_000L
    private var sainDepuis: Long? = null
    fun ajuster(tamponMs: Long, actuel: Int, plafond: Int, maintenant: Long,
        capaciteMs: Long = 40_000, segmentMs: Long = 8_000, chargementRecent: Boolean = true,
        peutReduire: Boolean = true): Int {
        val capacite = capaciteMs.coerceIn(2_000, 60_000)
        val sain = minOf(25_000L, capacite * 3 / 5)
        val bas = minOf(15_000L, capacite / 3)
        val critique = minOf(6_000L, capacite / 6)
        // Un flux à fenêtre courte oscille naturellement au rythme de ses segments.
        val suffisant = tamponMs >= sain ||
            (chargementRecent && tamponMs >= maxOf(bas, capacite - segmentMs * 2))
        if (!suffisant || !chargementRecent) sainDepuis = null else if (sainDepuis == null) sainDepuis = maintenant
        if (peutReduire && actuel > 0 && tamponMs < bas && !suffisant && maintenant - changement >= 5_000) {
            changement = maintenant
            return minOf(plafond, (actuel * if (tamponMs < critique) 0.45 else 0.7).toInt().coerceAtLeast(150_000))
        }
        if (plafond != Int.MAX_VALUE && sainDepuis != null && maintenant - sainDepuis!! >= 20_000 && maintenant - changement >= 20_000) {
            changement = maintenant
            // Une minute saine libère entièrement la limite, même si le débit est inconnu.
            return if (maintenant - sainDepuis!! >= 60_000 || plafond >= 20_000_000) Int.MAX_VALUE else (plafond * 1.5).toInt()
        }
        return plafond
    }
}

fun doitPreparerSecours(tamponMs: Long, depuisSegmentMs: Long, segmentMs: Long): Boolean =
    tamponMs < 30_000 && depuisSegmentMs > maxOf(6_000, segmentMs * 3 / 2)

fun positionDeRaccord(debutPrincipalMs: Long?, positionMs: Long, debutSecoursMs: Long?, dureeMs: Long): Long? {
    if (debutPrincipalMs == null || debutSecoursMs == null) return null
    return (debutPrincipalMs + positionMs - debutSecoursMs).takeIf { it >= 0 && it + 500 < dureeMs }
}
