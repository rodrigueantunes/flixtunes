package tv.flixtunes.app.ui

import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.activity.ComponentDialog
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import tv.flixtunes.app.data.FlixTunesApi
import tv.flixtunes.app.playback.TelecommandeAndroid
import tv.flixtunes.app.playback.etatDiffusionAndroid

/** Le dialogue vit dans sa propre fenêtre et se détruit entièrement à la fermeture : aucun voile
 * ni calque n'est ajouté à la surface vidéo lors d'une reprise. */
fun ouvrirDialogueDiffusion(activity: ComponentActivity, api: FlixTunesApi,
    etatLocal: () -> JSONObject = { etatDiffusionAndroid() }, pauseLocale: () -> Unit = {}) {
    val dialog = ComponentDialog(activity)
    val vue = ComposeView(activity).apply {
        setContent { ThemeFlixTunes {
            Surface(shape = RoundedCornerShape(20.dp), color = Encre) {
                PanneauDiffusion(api, etatLocal, pauseLocale, dialog::dismiss)
            }
        } }
    }
    dialog.setContentView(vue)
    dialog.setOnDismissListener { vue.disposeComposition() }
    dialog.show()
    dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
}

@Composable
private fun PanneauDiffusion(api: FlixTunesApi, etatLocal: () -> JSONObject, pauseLocale: () -> Unit, fermer: () -> Unit) {
    var cibles by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var selection by remember { mutableStateOf<String?>(null) }
    var erreur by remember { mutableStateOf<String?>(null) }
    var occupe by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(api) {
        while (true) {
            try {
                val liste = api.diffusion("cibles").getJSONArray("cibles")
                cibles = (0 until liste.length()).map { liste.getJSONObject(it) }.filter { it.optString("id") != TelecommandeAndroid.id }
            } catch (e: Exception) { erreur = e.message ?: "Appareils indisponibles" }
            delay(2500)
        }
    }
    fun envoyer(commande: JSONObject) {
        val id = selection ?: return
        scope.launch {
            occupe = true; erreur = null
            try {
                val resultat = api.diffusion("cibles/$id/commande", commande)
                if (resultat.has("ordre")) {
                    var accuse: JSONObject? = null
                    for (tentative in 0 until 60) {
                        delay(500)
                        accuse = api.diffusion("cibles/$id/ordres/${resultat.getString("ordre")}").optJSONObject("resultat")
                        if (accuse != null) break
                    }
                    check(accuse != null) { "Le lecteur n’a pas confirmé la commande. La lecture locale est conservée." }
                    check(accuse.optBoolean("ok")) { accuse.optString("erreur", "Commande refusée") }
                }
                if (commande.optString("type") == "charger") pauseLocale()
            } catch (e: Exception) { erreur = e.message ?: "Diffusion impossible" }
            finally { occupe = false }
        }
    }
    val cible = cibles.find { it.optString("id") == selection }
    val etat = cible?.optJSONObject("etat")
    Column(Modifier.padding(22.dp).heightIn(max = 550.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Caster et piloter", style = MaterialTheme.typography.headlineSmall)
        Text("Appareils du réseau local et lecteurs FlixTunes du même profil.", color = Muet)
        erreur?.let { Text(it, color = androidx.compose.ui.graphics.Color(0xFFFFB7C0)) }
        if (occupe) { LinearProgressIndicator(Modifier.fillMaxWidth()); Text("En attente du récepteur…", color = Muet) }
        if (cibles.isEmpty()) Text("Aucun appareil détecté. Vérifiez qu’il est allumé et sur le même réseau que le NAS.")
        cibles.forEach { c ->
            OutlinedButton(onClick = { selection = c.getString("id") }, enabled = !occupe && !c.optBoolean("occupe"), modifier = Modifier.fillMaxWidth()) {
                Column { Text((if (selection == c.optString("id")) "✓ " else "") + c.optString("nom"))
                    Text(c.optString("protocole") + if (c.optBoolean("occupe")) " · autre profil" else "", color = Muet) }
            }
        }
        if (cible != null) {
            val local = etatLocal()
            local.optJSONObject("contenu")?.let { contenu ->
                Button(enabled = !occupe, onClick = { envoyer(JSONObject().put("type", "charger").put("contenu", contenu).put("position", local.optDouble("position", 0.0))) }) {
                    Text("Diffuser « ${contenu.optString("titre")} »")
                }
            }
            if (etat?.optJSONObject("contenu") != null) {
                Text(etat.getJSONObject("contenu").optString("titre"))
                etat.optString("qualite").takeIf { it.isNotBlank() && it != "null" }?.let { Text(it, color = Muet) }
                Text(when (etat.optString("lecture")) {
                    "lecture" -> "Lecture en cours sur le récepteur"
                    "chargement" -> "Chargement sur le récepteur…"
                    "pause" -> "Lecture en pause"
                    "erreur" -> "La lecture distante a échoué"
                    else -> "Aucune lecture en cours sur le récepteur"
                }, color = Muet)
                etat.optString("erreur").takeIf { it.isNotBlank() && it != "null" }?.let {
                    Text(it, color = androidx.compose.ui.graphics.Color(0xFFFFB7C0))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(enabled = !occupe, onClick = { envoyer(JSONObject().put("type", if (etat.optString("lecture") == "pause") "reprendre" else "pause")) }) {
                        Text(if (etat.optString("lecture") == "pause") "Reprendre" else "Pause")
                    }
                    OutlinedButton(enabled = !occupe, onClick = { envoyer(JSONObject().put("type", "arreter")) }) { Text("Arrêter") }
                }
                var volume by remember(selection, etat.optDouble("volume")) { mutableFloatStateOf(etat.optDouble("volume", 1.0).toFloat()) }
                Text("Volume")
                Slider(value = volume, onValueChange = { volume = it }, enabled = !occupe,
                    onValueChangeFinished = { envoyer(JSONObject().put("type", "volume").put("valeur", volume.toDouble())) })
                val duree = etat.optDouble("duree", 0.0).toFloat()
                if (etat.optBoolean("navigation") && duree > 0) {
                    var position by remember(selection, (etat.optDouble("position") / 5).toInt()) { mutableFloatStateOf(etat.optDouble("position", 0.0).toFloat().coerceIn(0f, duree)) }
                    Text("Position")
                    Slider(value = position, onValueChange = { position = it }, valueRange = 0f..duree, enabled = !occupe,
                        onValueChangeFinished = { envoyer(JSONObject().put("type", "position").put("valeur", position.toDouble())) })
                }
            }
        }
        Text("AirPlay est disponible depuis Safari sur un appareil Apple. Le cast lancé continue après fermeture de cette fenêtre.", color = Muet)
        TextButton(onClick = fermer, enabled = !occupe) { Text("Fermer") }
    }
}
