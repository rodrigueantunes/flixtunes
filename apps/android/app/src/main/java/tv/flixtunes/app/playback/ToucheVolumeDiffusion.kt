package tv.flixtunes.app.playback

import android.view.KeyEvent
import androidx.lifecycle.LifecycleCoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Pendant une diffusion, les touches de volume du téléphone règlent le téléviseur, comme dans les
 * applications qui castent. Rend `true` quand la touche a été prise en charge.
 */
fun toucheVolumeDiffusion(evenement: KeyEvent, scope: LifecycleCoroutineScope): Boolean {
    val monter = when (evenement.keyCode) { KeyEvent.KEYCODE_VOLUME_UP -> true; KeyEvent.KEYCODE_VOLUME_DOWN -> false; else -> return false }
    val cible = SuiviDiffusion.active.value ?: return false
    val etat = cible.optJSONObject("etat") ?: return false
    if (etat.optString("lecture") !in setOf("lecture", "pause")) return false
    if (evenement.action == KeyEvent.ACTION_DOWN) {
        val volume = volumeApresTouche(etat.optDouble("volume", 1.0), monter)
        // L'état local suit tout de suite : des appuis rapprochés s'additionnent au lieu de repartir du même volume.
        etat.put("volume", volume)
        scope.launch { runCatching { SuiviDiffusion.commander(cible.getString("id"), JSONObject().put("type", "volume").put("valeur", volume)) } }
    }
    return true
}
