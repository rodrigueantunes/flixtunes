package tv.flixtunes.app.data

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo

/**
 * La découverte Android, par le service NSD du système.
 *
 * Elle met en œuvre [DecouverteServeurs] : le reste de l'application ne connaît que « commencer » et
 * « arrêter », et ignore jusqu'au nom du protocole.
 */
class ServerDiscovery(context: Context, private val onServer: (DiscoveredServer) -> Unit) : DecouverteServeurs {
    private val manager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private var active = false
    private val listener = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(serviceType: String) { active = true }
        override fun onDiscoveryStopped(serviceType: String) { active = false }
        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { active = false }
        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) { active = false }
        override fun onServiceLost(serviceInfo: NsdServiceInfo) = Unit
        override fun onServiceFound(serviceInfo: NsdServiceInfo) {
            if (serviceInfo.serviceType.startsWith(SERVICE_TYPE)) manager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) = Unit
                override fun onServiceResolved(resolved: NsdServiceInfo) {
                    val host = resolved.host?.hostAddress ?: return
                    val formatted = if (host.contains(':')) "[$host]" else host
                    onServer(DiscoveredServer(resolved.serviceName, "http://$formatted:${resolved.port}"))
                }
            })
        }
    }

    override fun start() { if (!active) manager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener) }
    override fun stop() { if (active) runCatching { manager.stopServiceDiscovery(listener) }; active = false }
    companion object { const val SERVICE_TYPE = "_flixtunes._tcp." }
}
