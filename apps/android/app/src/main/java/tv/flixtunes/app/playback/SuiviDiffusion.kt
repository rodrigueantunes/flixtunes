package tv.flixtunes.app.playback

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import tv.flixtunes.app.data.FlixTunesApi

/**
 * La diffusion vue d'Android : un seul suivi des cibles pour toute l'application.
 *
 * Il sert au bouton Cast, qui montre qu'une diffusion est en cours, à la mini-télécommande de l'accueil,
 * au lecteur qui devient la télécommande du téléviseur, et aux touches de volume. Il ne tourne que tant
 * qu'un écran de l'application est visible : plus serré pendant une diffusion, au repos sinon.
 */
object SuiviDiffusion {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val _cibles = MutableStateFlow<List<JSONObject>>(emptyList())
    val cibles: StateFlow<List<JSONObject>> = _cibles.asStateFlow()
    private val _active = MutableStateFlow<JSONObject?>(null)
    /** La diffusion en cours de ce profil vers un téléviseur, s'il y en a une. */
    val active: StateFlow<JSONObject?> = _active.asStateFlow()
    private var api: FlixTunesApi? = null
    private var visibles = 0
    private var boucle: Job? = null
    private var transfert: Transfert? = null
    private var reveil: kotlinx.coroutines.CompletableDeferred<Unit>? = null
    /** Le lecteur de ce téléphone, exclu des cibles : on ne se diffuse pas à soi-même. */
    var moi: String? = null

    /** Le lecteur local ne se met en pause qu'à la lecture confirmée sur le téléviseur. */
    private data class Transfert(val cible: String, val contenu: String, val pause: () -> Unit)

    fun attacher(proprietaire: LifecycleOwner, api: FlixTunesApi): () -> Unit {
        val observateur = object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) { this@SuiviDiffusion.api = api; visibles++; demarrer() }
            override fun onStop(owner: LifecycleOwner) { visibles = (visibles - 1).coerceAtLeast(0) }
        }
        proprietaire.lifecycle.addObserver(observateur)
        return { proprietaire.lifecycle.removeObserver(observateur); if (proprietaire.lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)) visibles = (visibles - 1).coerceAtLeast(0) }
    }

    fun attendreTransfert(cible: String, contenu: String, pause: () -> Unit) { transfert = Transfert(cible, contenu, pause); relancer() }

    suspend fun commander(id: String, commande: JSONObject) {
        val client = api ?: error("Serveur indisponible")
        client.diffusion("cibles/$id/commande", commande)
        relancer()
    }

    fun relancer() { reveil?.complete(Unit) }

    private fun demarrer() {
        if (boucle?.isActive == true) { relancer(); return }
        boucle = scope.launch {
            while (isActive && visibles > 0) {
                val client = api
                if (client != null) {
                    try {
                        val liste = client.diffusion("cibles").getJSONArray("cibles")
                        val cibles = (0 until liste.length()).map { liste.getJSONObject(it) }.filter { it.optString("id") != moi }
                        _cibles.value = cibles
                        _active.value = diffusionActive(cibles)
                        transfert?.let { t ->
                            val cible = cibles.find { it.optString("id") == t.cible }
                            val etat = cible?.optJSONObject("etat")
                            when {
                                etat?.optJSONObject("contenu")?.optString("id") == t.contenu && etat.optString("lecture") == "lecture" -> {
                                    transfert = null; t.pause()
                                }
                                cible == null || etat?.optString("lecture") == "erreur" -> transfert = null
                            }
                        }
                    } catch (_: Exception) { /* Serveur momentanément injoignable : le prochain tour réessaiera. */ }
                }
                val attente = kotlinx.coroutines.CompletableDeferred<Unit>(); reveil = attente
                val pas = if (_active.value != null || transfert != null) 1_500L else 5_000L
                kotlinx.coroutines.withTimeoutOrNull(pas) { attente.await() }
            }
        }
    }
}

/** La diffusion en cours : en préparation, en lecture ou en pause, sur un téléviseur libre. */
fun diffusionActive(cibles: List<JSONObject>): JSONObject? = cibles.firstOrNull { c ->
    val etat = c.optJSONObject("etat")
    !c.optBoolean("occupe") && c.optString("protocole") != "flixtunes" && etat?.optJSONObject("contenu") != null &&
        etat.optString("lecture") in setOf("chargement", "lecture", "pause")
}

fun libelleProtocole(cible: JSONObject): String {
    val protocole = when (cible.optString("protocole")) { "googlecast" -> "Google Cast"; "dlna" -> "DLNA"; else -> "Lecteur FlixTunes" }
    val modele = cible.optString("modele").takeIf { it.isNotBlank() && it != "null" && it != cible.optString("nom") }
    return if (modele != null) "$protocole · $modele" else protocole
}

/** Ce qui se passe, dit à la personne : l'étape de la préparation, puis l'état de la lecture. */
fun libelleEtatDiffusion(etat: JSONObject, nom: String): String {
    val qualite = etat.optString("qualite").takeIf { it.isNotBlank() && it != "null" }
    return when (etat.optString("lecture")) {
        "chargement" -> when (etat.optString("etape")) {
            "connexion" -> "Connexion à $nom…"
            "sonde" -> "Vérification des formats que lit $nom…"
            "preparation" -> "Préparation de la vidéo" + (qualite?.let { " · $it" } ?: "") + "…"
            "demarrage" -> "Démarrage sur $nom…"
            else -> "Chargement sur $nom…"
        }
        "lecture" -> "Lecture sur $nom"
        "pause" -> "En pause sur $nom"
        "erreur" -> etat.optString("erreur").takeIf { it.isNotBlank() && it != "null" } ?: "La lecture sur $nom a échoué"
        else -> when (etat.optString("motifRepos")) {
            "fin" -> "Lecture terminée"
            "tiers" -> "$nom a été repris par une autre application"
            else -> "Aucune lecture en cours"
        }
    }
}

fun dureeLisible(secondes: Double): String {
    val s = secondes.coerceAtLeast(0.0).toLong(); val h = s / 3600; val m = (s / 60) % 60; val r = s % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, r) else "%d:%02d".format(m, r)
}

/** Les touches de volume pendant une diffusion : un pas de 5 %, borné, à partir du volume du téléviseur. */
fun volumeApresTouche(actuel: Double, monter: Boolean): Double =
    Math.round((if (monter) actuel + 0.05 else actuel - 0.05).coerceIn(0.0, 1.0) * 100) / 100.0
