package tv.flixtunes.app.playback

import android.content.Intent
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import tv.flixtunes.app.LecteurDirectActivity
import tv.flixtunes.app.PlayerActivity
import tv.flixtunes.app.data.FlixTunesApi

fun etatDiffusionAndroid(genre: String? = null, id: String = "", titre: String = "FlixTunes",
    lecture: String = "repos", position: Double = 0.0, duree: Double = 0.0, volume: Float = 1f): JSONObject = JSONObject()
    .put("contenu", if (genre == null) JSONObject.NULL else JSONObject().put("genre", genre).put("id", id).put("titre", titre.take(240)))
    .put("lecture", lecture).put("position", position.takeIf { it.isFinite() }?.coerceIn(0.0, 604800.0) ?: 0.0)
    .put("duree", duree.takeIf { it.isFinite() }?.coerceIn(0.0, 604800.0) ?: 0.0)
    .put("volume", volume.takeIf { it.isFinite() }?.coerceIn(0f, 1f)?.toDouble() ?: 1.0).put("navigation", genre == "media").put("erreur", JSONObject.NULL)

/** Un seul lecteur annoncé par processus, y compris pendant le passage accueil → film → direct.
 * Le registre ne retient aucune activité arrêtée ; une mise en veille arrête les battements.
 * Les commandes et accusés restent séparés des reprises et du décodeur vidéo existants. */
object TelecommandeAndroid {
    private data class Cible(val api: FlixTunesApi, val profil: String, val etat: () -> JSONObject,
        val executer: suspend (JSONObject) -> Unit, val charger: (JSONObject) -> Unit)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var cible: Cible? = null
    private var boucle: Job? = null
    private var identite: String? = null
    private var inscription: JSONObject? = null
    val id: String? get() = inscription?.optString("id")

    fun attacher(activity: ComponentActivity, api: FlixTunesApi, profil: String, etat: () -> JSONObject,
        executer: suspend (JSONObject) -> Unit): () -> Unit {
        val c = Cible(api, profil, etat, executer) { commande ->
            val contenu = commande.getJSONObject("contenu")
            val direct = contenu.getString("genre") == "direct"
            activity.startActivity(Intent(activity, if (direct) LecteurDirectActivity::class.java else PlayerActivity::class.java).apply {
                // Les deux lecteurs utilisent des noms d'extras distincts : ne pas les confondre.
                if (direct) {
                    putExtra(LecteurDirectActivity.EXTRA_SERVER, api.serverUrl)
                    putExtra(LecteurDirectActivity.EXTRA_PROFILE_ID, profil)
                    putExtra(LecteurDirectActivity.EXTRA_PROFILE_TOKEN, api.profileAccessToken())
                    putExtra(LecteurDirectActivity.EXTRA_CHANNEL_ID, contenu.getString("id"))
                } else {
                    putExtra(PlayerActivity.EXTRA_SERVER, api.serverUrl)
                    putExtra(PlayerActivity.EXTRA_PROFILE_ID, profil)
                    putExtra(PlayerActivity.EXTRA_PROFILE_TOKEN, api.profileAccessToken())
                    putExtra(PlayerActivity.EXTRA_MEDIA_ID, contenu.getString("id"))
                    putExtra(PlayerActivity.EXTRA_TITLE, contenu.optString("titre", "FlixTunes"))
                    putExtra(PlayerActivity.EXTRA_PROGRESS_SECONDS, commande.optDouble("position", 0.0))
                    putExtra(PlayerActivity.EXTRA_RESUME_MODE, "continue")
                    putExtra(PlayerActivity.EXTRA_RESUME_REWIND, 0)
                }
            })
            if (activity is PlayerActivity || activity is LecteurDirectActivity) activity.finish()
        }
        val observer = object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) { cible = c; demarrer() }
            override fun onStop(owner: LifecycleOwner) { if (cible === c) cible = null }
            override fun onDestroy(owner: LifecycleOwner) { if (cible === c) cible = null; owner.lifecycle.removeObserver(this) }
        }
        activity.lifecycle.addObserver(observer)
        return { activity.lifecycle.removeObserver(observer); if (cible === c) cible = null }
    }
    private fun demarrer() {
        if (boucle?.isActive == true) return
        boucle = scope.launch {
            var accuses = JSONArray()
            var silence = 0
            while (isActive && silence < 20) {
                val c = cible
                if (c == null) { silence++; delay(2000); continue }
                silence = 0
                try {
                    val identifiant = "${c.api.serverUrl}|${c.profil}"
                    if (identite != identifiant) { inscription = null; accuses = JSONArray(); identite = identifiant }
                    if (inscription == null) inscription = c.api.diffusion("lecteurs", JSONObject().put("nom", "${Build.MANUFACTURER} ${Build.MODEL}".take(120)))
                    val i = inscription!!
                    val reponse = c.api.diffusion("lecteurs/${i.getString("id")}", JSONObject()
                        .put("cle", i.getString("cle")).put("etat", c.etat()).put("accuses", accuses))
                    accuses = JSONArray()
                    val ordres = reponse.getJSONArray("ordres")
                    for (rang in 0 until ordres.length()) {
                        val ordre = ordres.getJSONObject(rang)
                        val accuse = JSONObject().put("id", ordre.getString("id"))
                        try {
                            check(cible === c) { "Le lecteur ou le profil a changé" }
                            val commande = ordre.getJSONObject("commande")
                            if (commande.getString("type") == "charger") {
                                c.charger(commande)
                                val contenu = commande.getJSONObject("contenu")
                                var pret = false
                                for (tentative in 0 until 80) {
                                    delay(250)
                                    val actif = cible
                                    val e = actif?.etat?.invoke()
                                    pret = actif?.profil == c.profil && e?.optJSONObject("contenu")?.optString("id") == contenu.getString("id") && e.optString("lecture") == "lecture"
                                    if (pret) break
                                }
                                check(pret) { "Le contenu n’a pas démarré sur le lecteur" }
                            } else {
                                check(cible === c) { "Le lecteur a changé" }
                                c.executer(commande)
                            }
                            accuse.put("ok", true)
                        } catch (e: Exception) { accuse.put("ok", false).put("erreur", (e.message ?: "Commande impossible").take(300)) }
                        accuses.put(accuse)
                    }
                } catch (_: Exception) { inscription = null }
                delay(2000)
            }
        }
    }
}
