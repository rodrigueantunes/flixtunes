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
import tv.flixtunes.app.playback.SuiviDiffusion
import tv.flixtunes.app.playback.TelecommandeAndroid
import tv.flixtunes.app.playback.etatDiffusionAndroid
import tv.flixtunes.app.playback.libelleEtatDiffusion
import tv.flixtunes.app.playback.libelleProtocole

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
    SuiviDiffusion.relancer()
}

@Composable
private fun PanneauDiffusion(api: FlixTunesApi, etatLocal: () -> JSONObject, pauseLocale: () -> Unit, fermer: () -> Unit) {
    val suivies by SuiviDiffusion.cibles.collectAsState()
    val cibles = suivies.filter { it.optString("id") != TelecommandeAndroid.id }
    // La diffusion déjà en cours est sélectionnée d'office : le dialogue s'ouvre sur sa télécommande.
    var selection by remember { mutableStateOf(SuiviDiffusion.active.value?.optString("id")) }
    var erreur by remember { mutableStateOf<String?>(null) }
    var occupe by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun envoyer(commande: JSONObject) {
        val id = selection ?: return
        scope.launch {
            occupe = true; erreur = null
            try {
                // Un téléviseur suit l'étape de sa préparation par l'état de la cible : la commande répond
                // tout de suite, et le lecteur local ne se met en pause qu'à la lecture confirmée.
                val charger = commande.optString("type") == "charger"
                val asynchrone = charger && !id.startsWith("ft-")
                val resultat = api.diffusion("cibles/$id/commande" + if (asynchrone) "?asynchrone=1" else "", commande)
                when {
                    resultat.has("operation") -> SuiviDiffusion.attendreTransfert(id,
                        commande.getJSONObject("contenu").getString("id"), pauseLocale)
                    resultat.has("ordre") -> {
                        var accuse: JSONObject? = null
                        for (tentative in 0 until 60) {
                            delay(500)
                            accuse = api.diffusion("cibles/$id/ordres/${resultat.getString("ordre")}").optJSONObject("resultat")
                            if (accuse != null) break
                        }
                        check(accuse != null) { "Le lecteur n’a pas confirmé la commande. La lecture locale est conservée." }
                        check(accuse.optBoolean("ok")) { accuse.optString("erreur", "Commande refusée") }
                        if (charger) pauseLocale()
                    }
                    // Un serveur antérieur à la r7 répond à la fin de la préparation.
                    charger -> pauseLocale()
                }
                SuiviDiffusion.relancer()
            } catch (e: Exception) { erreur = e.message ?: "Diffusion impossible" }
            finally { occupe = false }
        }
    }
    val cible = cibles.find { it.optString("id") == selection }
    val etat = cible?.optJSONObject("etat")
    Column(Modifier.padding(22.dp).heightIn(max = 560.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Caster et piloter", style = MaterialTheme.typography.headlineSmall)
        Text("Appareils du réseau local et lecteurs FlixTunes du même profil.", color = Muet)
        erreur?.let { Text(it, color = Erreur) }
        if (occupe) { LinearProgressIndicator(Modifier.fillMaxWidth()); Text("En attente du récepteur…", color = Muet) }
        if (cibles.isEmpty()) Text("Aucun appareil détecté. Vérifiez qu’il est allumé et sur le même réseau que le NAS.")
        cibles.forEach { c ->
            OutlinedButton(onClick = { selection = c.getString("id") }, enabled = !occupe && !c.optBoolean("occupe"), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.fillMaxWidth()) {
                    Text((if (selection == c.optString("id")) "✓ " else "") + c.optString("nom"), color = Texte)
                    val titre = c.optJSONObject("etat")?.optJSONObject("contenu")?.optString("titre")
                    Text(libelleProtocole(c) + when {
                        c.optBoolean("occupe") -> " · utilisé par un autre profil"
                        titre != null -> " · $titre" + (c.optString("proprietaire").takeIf { it.isNotBlank() && it != "null" }?.let { " · $it" } ?: "")
                        else -> ""
                    }, color = Muet)
                }
            }
        }
        if (cible != null) {
            val nom = cible.optString("nom")
            val local = etatLocal()
            val enCours = etat?.optString("lecture")
            local.optJSONObject("contenu")?.let { contenu ->
                if (enCours != "chargement" || etat.optJSONObject("contenu")?.optString("id") != contenu.optString("id")) {
                    Button(enabled = !occupe, onClick = { envoyer(JSONObject().put("type", "charger").put("contenu", contenu).put("position", local.optDouble("position", 0.0))) }) {
                        Text("Diffuser « ${contenu.optString("titre")} »")
                    }
                }
            }
            if (etat?.optJSONObject("contenu") != null) {
                Text(etat.getJSONObject("contenu").optString("titre"))
                Text(libelleEtatDiffusion(etat, nom), color = if (enCours == "erreur") Erreur else TexteDoux)
                etat.optString("qualite").takeIf { it.isNotBlank() && it != "null" && enCours != "chargement" }?.let { Text(it, color = Muet) }
                if (enCours == "chargement") {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    OutlinedButton(enabled = !occupe, onClick = { envoyer(JSONObject().put("type", "arreter")) }) { Text("Annuler") }
                } else {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(enabled = !occupe && enCours in setOf("lecture", "pause"), onClick = { envoyer(JSONObject().put("type", if (enCours == "pause") "reprendre" else "pause")) }) {
                            Text(if (enCours == "pause") "Reprendre" else "Pause")
                        }
                        OutlinedButton(enabled = !occupe, onClick = { envoyer(JSONObject().put("type", "arreter")) }) { Text("Arrêter") }
                    }
                }
                if (enCours in setOf("lecture", "pause")) {
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
        }
        if (cible != null && cible.optString("protocole") != "flixtunes") {
            // Un téléviseur resté bloqué se libère d'ici, sans avoir à le redémarrer.
            TextButton(enabled = !occupe, onClick = { envoyer(JSONObject().put("type", "reinitialiser")) }) {
                Text("Réinitialiser le téléviseur", color = BleuClair)
            }
        }
        Text("AirPlay est disponible depuis Safari sur un appareil Apple. Le cast lancé continue après fermeture de cette fenêtre.", color = Muet)
        TextButton(onClick = fermer, enabled = !occupe) { Text("Fermer") }
    }
}
