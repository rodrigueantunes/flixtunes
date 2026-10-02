package tv.flixtunes.app.playback

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build

/** Rattachée à l'écran visible ; aucun observateur ne reste actif après sa fermeture. */
class SurveillanceReseauDirect(contexte: Context, private val disponible: () -> Unit) {
    private val gestionnaire = contexte.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private var inscrite = false
    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { disponible() }
    }
    fun demarrer() {
        if (inscrite) return
        runCatching {
            if (Build.VERSION.SDK_INT >= 24) gestionnaire.registerDefaultNetworkCallback(callback)
            else gestionnaire.registerNetworkCallback(NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build(), callback)
            inscrite = true
        }
    }
    fun arreter() {
        if (inscrite) runCatching { gestionnaire.unregisterNetworkCallback(callback) }
        inscrite = false
    }
}
