package tv.flixtunes.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import tv.flixtunes.app.playback.SuiviDiffusion
import tv.flixtunes.app.playback.dureeLisible
import tv.flixtunes.app.playback.libelleEtatDiffusion

/** Une commande à la fois vers le téléviseur, et son erreur affichée là où on l'a donnée. */
@Composable
private fun rememberCommandes(cible: JSONObject): Pair<Boolean, (JSONObject) -> Unit> {
    val scope = rememberCoroutineScope()
    var travail by remember(cible.optString("id")) { mutableStateOf(false) }
    return travail to { commande: JSONObject ->
        scope.launch {
            travail = true
            try { SuiviDiffusion.commander(cible.getString("id"), commande) } catch (_: Exception) { /* l'état du serveur le dira */ }
            finally { travail = false }
        }
    }
}

/** La position avance entre deux relevés du serveur, pour que la barre ne saute pas de seconde en seconde. */
@Composable
private fun positionLissee(etat: JSONObject): Double {
    val position = etat.optDouble("position", 0.0)
    val enLecture = etat.optString("lecture") == "lecture"
    var releve by remember(position, enLecture) { mutableStateOf(position to System.currentTimeMillis()) }
    var maintenant by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(enLecture) { while (enLecture) { delay(1000); maintenant = System.currentTimeMillis() } }
    val ecoule = if (enLecture) (maintenant - releve.second).coerceAtLeast(0) / 1000.0 else 0.0
    val duree = etat.optDouble("duree", 0.0)
    return (releve.first + ecoule).let { if (duree > 0) it.coerceAtMost(duree) else it }
}

@Composable
private fun BoutonTelecommande(texte: String, actif: Boolean, principal: Boolean = false, description: String? = null, action: () -> Unit) {
    val modifier = if (description != null) Modifier.semantics { contentDescription = description } else Modifier
    if (principal) Button(onClick = action, enabled = actif, modifier = modifier, colors = ButtonDefaults.buttonColors(containerColor = Bleu)) { Text(texte) }
    else OutlinedButton(onClick = action, enabled = actif, modifier = modifier) { Text(texte, color = Texte) }
}

/** Posé sur le lecteur dont le contenu passe sur un téléviseur : le lecteur devient la télécommande. */
@Composable
fun TelecommandeLecteur(contenuId: String, reprendreIci: (Double) -> Unit) {
    val cible by SuiviDiffusion.active.collectAsState()
    val c = cible ?: return
    val etat = c.optJSONObject("etat") ?: return
    if (etat.optJSONObject("contenu")?.optString("id") != contenuId) return
    val nom = c.optString("nom")
    val (travail, envoyer) = rememberCommandes(c)
    val position = positionLissee(etat)
    val prete = etat.optString("lecture") in setOf("lecture", "pause")
    val scope = rememberCoroutineScope()
    // La couche absorbe les gestes : un tape ne doit pas relancer le lecteur local qui attend dessous.
    Box(Modifier.fillMaxSize().background(Brush.radialGradient(listOf(Color(0xCC16284A), Color(0xF2050A14))))
        .pointerInput(Unit) { detectTapGestures { } },
        contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 640.dp).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(etat.optJSONObject("contenu")?.optString("titre").orEmpty(), color = TexteDoux, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            Text(libelleEtatDiffusion(etat, nom), color = Texte, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            etat.optString("qualite").takeIf { it.isNotBlank() && it != "null" && etat.optString("lecture") != "chargement" }?.let { Text(it, color = Muet) }
            if (etat.optString("lecture") == "chargement") {
                CircularProgressIndicator(color = BleuClair, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
                BoutonTelecommande("Annuler", !travail) { envoyer(JSONObject().put("type", "arreter")) }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    val enPause = etat.optString("lecture") == "pause"
                    BoutonTelecommande(if (enPause) "▶" else "❚❚", !travail && prete, principal = true,
                        description = if (enPause) "Reprendre sur le téléviseur" else "Mettre en pause sur le téléviseur") {
                        envoyer(JSONObject().put("type", if (enPause) "reprendre" else "pause"))
                    }
                    BoutonTelecommande("Arrêter la diffusion", !travail) { envoyer(JSONObject().put("type", "arreter")) }
                }
                val duree = etat.optDouble("duree", 0.0)
                if (prete && etat.optBoolean("navigation") && duree > 0) {
                    var glisse by remember(c.optString("id")) { mutableStateOf<Float?>(null) }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(dureeLisible(glisse?.toDouble() ?: position), color = Muet)
                        Slider(value = glisse ?: position.toFloat().coerceIn(0f, duree.toFloat()), valueRange = 0f..duree.toFloat(), enabled = !travail,
                            onValueChange = { glisse = it },
                            onValueChangeFinished = { glisse?.let { envoyer(JSONObject().put("type", "position").put("valeur", it.toDouble())) }; glisse = null },
                            modifier = Modifier.weight(1f).semantics { contentDescription = "Position sur le téléviseur" })
                        Text(dureeLisible(duree), color = Muet)
                    }
                }
                if (prete) {
                    var volume by remember(c.optString("id"), etat.optDouble("volume")) { mutableFloatStateOf(etat.optDouble("volume", 1.0).toFloat()) }
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.widthIn(max = 360.dp)) {
                        Text("Volume", color = Muet)
                        Slider(value = volume, onValueChange = { volume = it }, enabled = !travail,
                            onValueChangeFinished = { envoyer(JSONObject().put("type", "volume").put("valeur", volume.toDouble())) },
                            modifier = Modifier.weight(1f).semantics { contentDescription = "Volume du téléviseur" })
                    }
                }
                var reprise by remember { mutableStateOf(false) }
                BoutonTelecommande("Reprendre ici", !reprise, principal = true) {
                    reprise = true
                    scope.launch {
                        try { SuiviDiffusion.commander(c.getString("id"), JSONObject().put("type", "arreter")) } catch (_: Exception) {}
                        reprendreIci(position)
                    }
                }
            }
        }
    }
}

/** Sur l'accueil, tant qu'une diffusion est en cours. */
@Composable
fun MiniTelecommande(ouvrir: () -> Unit, modifier: Modifier = Modifier) {
    val cible by SuiviDiffusion.active.collectAsState()
    val c = cible ?: return
    val etat = c.optJSONObject("etat") ?: return
    val (travail, envoyer) = rememberCommandes(c)
    val nom = c.optString("nom")
    Row(modifier.fillMaxWidth().background(Color(0xEE0E182A), RoundedCornerShape(18.dp)).border(1.dp, Color(0xFF3E5273), RoundedCornerShape(18.dp))
        .padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(Modifier.weight(1f).clickable(onClick = ouvrir).semantics { contentDescription = "Ouvrir la télécommande de $nom" }) {
            Text(etat.optJSONObject("contenu")?.optString("titre").orEmpty(), color = Texte, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(libelleEtatDiffusion(etat, nom), color = Muet, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        when (etat.optString("lecture")) {
            "chargement" -> TextButton(onClick = { envoyer(JSONObject().put("type", "arreter")) }, enabled = !travail) { Text("Annuler", color = BleuClair) }
            else -> {
                val enPause = etat.optString("lecture") == "pause"
                TextButton(onClick = { envoyer(JSONObject().put("type", if (enPause) "reprendre" else "pause")) }, enabled = !travail,
                    modifier = Modifier.semantics { contentDescription = if (enPause) "Reprendre sur le téléviseur" else "Mettre en pause sur le téléviseur" }) {
                    Text(if (enPause) "▶" else "❚❚", color = Texte)
                }
                TextButton(onClick = { envoyer(JSONObject().put("type", "arreter")) }, enabled = !travail) { Text("Arrêter", color = BleuClair) }
            }
        }
    }
}
