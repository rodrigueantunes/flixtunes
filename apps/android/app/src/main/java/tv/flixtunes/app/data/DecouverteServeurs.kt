package tv.flixtunes.app.data

/** Un serveur FlixTunes trouvé sur le réseau local. */
data class DiscoveredServer(val name: String, val url: String)

/**
 * La recherche des serveurs du réseau local.
 *
 * Deux gestes, et rien d'autre : commencer, arrêter. Ce qui trouve les serveurs diffère
 * radicalement d'un système à l'autre — NSD sur Android, Bonjour ou Avahi ailleurs — mais ce que
 * l'application en attend, non.
 */
interface DecouverteServeurs {
    fun start()
    fun stop()
}

/** Une découverte qui ne trouve rien, pour les cas où le réseau ne se cherche pas. */
object AucuneDecouverte : DecouverteServeurs {
    override fun start() = Unit
    override fun stop() = Unit
}
