package tv.flixtunes.app.playback

private const val MIO = 1024 * 1024

/** Le cache, les deux tampons et les décodeurs partagent le même budget de l'application. */
data class BudgetMemoireDirect(val cacheOctets: Int, val tamponOctets: Int, val doubleLecture: Boolean) {
    fun peutPreparer(octetsDisponibles: Long, systemeSature: Boolean, instancesDecodeur: Int): Boolean =
        doubleLecture && instancesDecodeur >= 2 && !systemeSature &&
            octetsDisponibles >= tamponOctets.toLong() * 2 + 16 * MIO
}

fun budgetMemoireDirect(tasMaximumOctets: Long, appareilSobre: Boolean): BudgetMemoireDirect {
    val mio = (tasMaximumOctets / MIO).coerceAtLeast(32)
    return BudgetMemoireDirect(
        cacheOctets = (mio / 32).coerceIn(1, 8).toInt() * MIO,
        tamponOctets = (mio / 8).coerceIn(4, 48).toInt() * MIO,
        doubleLecture = !appareilSobre && mio >= 192,
    )
}
