package tv.flixtunes.app.playback

/** Segments complets ; le lecteur fixe la capacité selon le tas disponible sur l'appareil. */
class CacheSegmentsDirect(
    private val maximum: Int = 8 * 1024 * 1024,
    private val retentionMs: Long = 90_000,
    private val horloge: () -> Long = System::currentTimeMillis,
) {
    private data class Entree(val octets: ByteArray, val date: Long)
    private val entrees = LinkedHashMap<String, Entree>()
    private var taille = 0
    val maximumSegment: Int get() = minOf(maximum, 4 * 1024 * 1024)
    @Synchronized fun tailleOctets(): Int = taille

    @Synchronized fun lire(cle: String): ByteArray? {
        purger()
        return entrees[cle]?.octets?.copyOf()
    }

    @Synchronized fun garder(cle: String, octets: ByteArray) {
        purger()
        if (octets.isEmpty() || octets.size > maximumSegment) return
        retirer(cle)
        while (taille + octets.size > maximum) retirer(entrees.keys.first())
        entrees[cle] = Entree(octets.copyOf(), horloge())
        taille += octets.size
    }

    @Synchronized fun vider() { entrees.clear(); taille = 0 }
    private fun retirer(cle: String) { taille -= entrees.remove(cle)?.octets?.size ?: 0 }
    private fun purger() {
        entrees.filterValues { horloge() - it.date >= retentionMs }.keys.toList().forEach(::retirer)
    }
}
