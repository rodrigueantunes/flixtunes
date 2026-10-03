package tv.flixtunes.app.playback

import android.content.Context
import android.net.Uri
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.mediarouter.media.MediaRouteSelector
import androidx.mediarouter.media.MediaRouter
import com.google.android.gms.cast.CastDevice
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.HlsSegmentFormat
import com.google.android.gms.cast.HlsVideoSegmentFormat
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaSeekOptions
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.common.api.PendingResult
import com.google.android.gms.common.api.Result
import com.google.android.gms.common.images.WebImage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject
import tv.flixtunes.app.data.FlixTunesApi
import kotlin.coroutines.resume

/**
 * Le relais Cast du téléphone, hors de chez soi (r10).
 *
 * Le NAS ne voit pas les téléviseurs du réseau où l'on se trouve : ce téléphone, si. Il annonce au NAS
 * chaque téléviseur Cast qu'il découvre, puis exécute les ordres du NAS — ouvrir la session, sonder,
 * charger, piloter, libérer — et lui rapporte l'état du téléviseur à chaque battement. Toute la
 * décision reste au NAS : qualité, préparation, replis, progression. Les téléviseurs relayés
 * apparaissent donc parmi les cibles comme les autres, et se pilotent avec le même dialogue.
 *
 * Il ne tourne que connecté par l'accès distant : à la maison, c'est le NAS qui caste.
 */
object RelaisCast {
    private class Inscription(val id: String, val cle: String, var route: MediaRouter.RouteInfo, val appareil: String) {
        val accuses = JSONArray()
    }
    private class ErreurRelais(val code: String, message: String) : Exception(message)

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var api: FlixTunesApi? = null
    private var contexte: Context? = null
    private var cast: CastContext? = null
    private var routeur: MediaRouter? = null
    private var selecteur: MediaRouteSelector? = null
    private var boucle: Job? = null
    private var visibles = 0
    private var distant: Boolean? = null
    private val inscrits = mutableMapOf<String, Inscription>()
    private var finDeSession: Job? = null
    private val decouverte = object : MediaRouter.Callback() {}
    /** Connecté par l'accès distant : les téléviseurs proposés sont ceux du Wi-Fi où se trouve le téléphone. */
    val horsDeChezSoi: Boolean get() = distant == true

    fun attacher(proprietaire: LifecycleOwner, context: Context, client: FlixTunesApi): () -> Unit {
        val observateur = object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                if (api?.serverUrl != client.serverUrl) { distant = null; inscrits.clear() }
                api = client; contexte = context.applicationContext; visibles++; demarrer()
            }
            override fun onStop(owner: LifecycleOwner) { visibles = (visibles - 1).coerceAtLeast(0); ajusterDecouverte() }
        }
        proprietaire.lifecycle.addObserver(observateur)
        return { proprietaire.lifecycle.removeObserver(observateur) }
    }

    /** Le SDK Cast exige les services Google Play : sans eux, ou sur un appareil qui les refuse, pas de relais. */
    private fun preparerCast(): Boolean {
        if (cast != null) return true
        val c = contexte ?: return false
        return try {
            @Suppress("DEPRECATION")
            cast = CastContext.getSharedInstance(c)
            routeur = MediaRouter.getInstance(c)
            selecteur = MediaRouteSelector.Builder()
                .addControlCategory(CastMediaControlIntent.categoryForCast(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID)).build()
            true
        } catch (_: Exception) { false }
    }

    private fun sessionActive(): CastSession? = cast?.sessionManager?.currentCastSession?.takeIf { it.isConnected }

    /** La découverte coûte de la batterie : seulement écran visible, ou pendant une diffusion relayée. */
    private fun ajusterDecouverte() {
        val r = routeur ?: return; val s = selecteur ?: return
        r.removeCallback(decouverte)
        if (visibles > 0) r.addCallback(s, decouverte, MediaRouter.CALLBACK_FLAG_REQUEST_DISCOVERY)
    }

    private fun demarrer() {
        if (boucle?.isActive == true) { ajusterDecouverte(); return }
        boucle = scope.launch {
            var silence = 0
            while (isActive && silence < 30) {
                val client = api
                if (client == null) { delay(2000); continue }
                if (distant == null) distant = runCatching { client.remoteSession().required }.getOrNull()
                if (distant != true || !preparerCast()) { silence++; delay(5000); continue }
                ajusterDecouverte()
                val active = sessionActive()
                if (visibles == 0 && active == null) silence++ else silence = 0
                try { tour(client, active) } catch (_: Exception) { /* le NAS est momentanément injoignable */ }
                delay(if (active != null) 1000 else 2500)
            }
            routeur?.removeCallback(decouverte)
        }
    }

    /** Un tour : annoncer les téléviseurs vus, battre pour chacun, exécuter les ordres reçus. */
    private suspend fun tour(client: FlixTunesApi, active: CastSession?) {
        val r = routeur ?: return; val s = selecteur ?: return
        val routes = r.routes.filter { !it.isDefault && it.isEnabled && it.matchesSelector(s) }
        val appareilActif = active?.castDevice?.deviceId
        for (route in routes) {
            val appareil = CastDevice.getFromBundle(route.extras) ?: continue
            if (inscrits.containsKey(appareil.deviceId)) { inscrits[appareil.deviceId]?.route = route; continue }
            val reponse = client.diffusion("relais", JSONObject().put("nom", appareil.friendlyName.take(120))
                .apply { appareil.modelName.takeIf { it.isNotBlank() }?.let { put("modele", it.take(120)) } })
            inscrits[appareil.deviceId] = Inscription(reponse.getString("id"), reponse.getString("cle"), route, appareil.deviceId)
        }
        // Un téléviseur disparu du réseau est oublié, sauf celui qui diffuse : le NAS l'oubliera en 30 s.
        val vus = routes.mapNotNull { CastDevice.getFromBundle(it.extras)?.deviceId }.toSet()
        inscrits.keys.retainAll { it in vus || it == appareilActif }
        for (inscription in inscrits.values.toList()) {
            val (etat, media) = if (inscription.appareil == appareilActif) etatTeleviseur(active) else etatDiffusionAndroid() to null
            val corps = JSONObject().put("cle", inscription.cle).put("etat", etat).put("accuses", JSONArray(inscription.accuses.toString()))
            if (media != null) corps.put("media", media)
            while (inscription.accuses.length() > 0) inscription.accuses.remove(0)
            val reponse = try { client.diffusion("lecteurs/${inscription.id}", corps) }
            catch (_: Exception) { inscrits.remove(inscription.appareil); continue }
            val ordres = reponse.optJSONArray("ordres") ?: continue
            for (rang in 0 until ordres.length()) {
                val ordre = ordres.getJSONObject(rang)
                val action = ordre.optJSONObject("relais") ?: continue
                // Un chargement dure jusqu'à 35 s : les battements continuent pendant ce temps.
                scope.launch {
                    val accuse = JSONObject().put("id", ordre.getString("id"))
                    try { executer(inscription, action, accuse); accuse.put("ok", true) }
                    catch (e: ErreurRelais) { accuse.put("ok", false).put("code", e.code).put("erreur", (e.message ?: "Commande refusée").take(300)) }
                    catch (e: Exception) { accuse.put("ok", false).put("code", "CAST_RELAIS").put("erreur", (e.message ?: "Commande impossible").take(300)) }
                    inscription.accuses.put(accuse)
                }
            }
        }
    }

    private fun etatTeleviseur(session: CastSession): Pair<JSONObject, String?> {
        val client = session.remoteMediaClient
        val volume = session.volume.takeIf { it.isFinite() }?.toFloat() ?: 1f
        val statut = client?.mediaStatus
        val info = client?.mediaInfo
        if (client == null || statut == null || info == null) return etatDiffusionAndroid(volume = volume) to null
        val lecture = when (statut.playerState) {
            MediaStatus.PLAYER_STATE_PLAYING -> "lecture"
            MediaStatus.PLAYER_STATE_PAUSED -> "pause"
            MediaStatus.PLAYER_STATE_BUFFERING, MediaStatus.PLAYER_STATE_LOADING -> "chargement"
            else -> if (statut.idleReason == MediaStatus.IDLE_REASON_ERROR) "erreur" else "repos"
        }
        val etat = etatDiffusionAndroid(lecture = lecture, position = client.approximateStreamPosition / 1000.0,
            duree = client.streamDuration.takeIf { it > 0 }?.div(1000.0) ?: 0.0, volume = volume)
        if (lecture == "repos") etat.put("motifRepos", when (statut.idleReason) {
            MediaStatus.IDLE_REASON_FINISHED -> "fin"; MediaStatus.IDLE_REASON_INTERRUPTED -> "tiers"; else -> "arret" })
        if (lecture == "erreur") etat.put("erreur", "Le téléviseur a interrompu la lecture")
        return etat to info.contentId
    }

    /** Ouvre la session Cast vers ce téléviseur, ou confirme qu'elle l'est déjà. */
    private suspend fun session(inscription: Inscription): CastSession {
        sessionActive()?.takeIf { it.castDevice?.deviceId == inscription.appareil }?.let { return it }
        val r = routeur ?: throw ErreurRelais("CAST_CONNEXION", "Le SDK Cast n’est pas prêt")
        r.selectRoute(inscription.route)
        val limite = System.currentTimeMillis() + 20_000
        while (System.currentTimeMillis() < limite) {
            sessionActive()?.takeIf { it.castDevice?.deviceId == inscription.appareil }?.let { return it }
            delay(250)
        }
        throw ErreurRelais("CAST_CONNEXION", "Le téléviseur n’a pas ouvert la session Cast")
    }

    private suspend fun <R : Result> attendreResultat(resultat: PendingResult<R>): R = suspendCancellableCoroutine { suite ->
        resultat.setResultCallback { suite.resume(it) }
    }

    private fun mediaInfo(action: JSONObject): MediaInfo {
        val m = action.getJSONObject("metadonnees")
        val genre = m.optString("genre")
        val meta = MediaMetadata(when (genre) {
            "film" -> MediaMetadata.MEDIA_TYPE_MOVIE; "episode" -> MediaMetadata.MEDIA_TYPE_TV_SHOW; else -> MediaMetadata.MEDIA_TYPE_GENERIC })
        meta.putString(MediaMetadata.KEY_TITLE, m.optString("titre", "FlixTunes"))
        if (genre == "episode") {
            meta.putString(MediaMetadata.KEY_SERIES_TITLE, m.optString("serie", m.optString("titre")))
            if (m.has("saison")) meta.putInt(MediaMetadata.KEY_SEASON_NUMBER, m.getInt("saison"))
            if (m.has("episode")) meta.putInt(MediaMetadata.KEY_EPISODE_NUMBER, m.getInt("episode"))
        }
        m.optString("sousTitre").takeIf { it.isNotBlank() && genre != "episode" }?.let { meta.putString(MediaMetadata.KEY_SUBTITLE, it) }
        m.optString("image").takeIf { it.startsWith("https://") || it.startsWith("http://") }?.let { meta.addImage(WebImage(Uri.parse(it))) }
        val url = action.getString("url")
        return MediaInfo.Builder(url)
            .setContentType(action.getString("mime"))
            .setStreamType(if (action.optBoolean("direct")) MediaInfo.STREAM_TYPE_LIVE else MediaInfo.STREAM_TYPE_BUFFERED)
            .setMetadata(meta)
            .apply { if (action.optBoolean("fmp4")) { setHlsSegmentFormat(HlsSegmentFormat.FMP4); setHlsVideoSegmentFormat(HlsVideoSegmentFormat.FMP4) } }
            .build()
    }

    /** Attend que le téléviseur lise le média donné, ou le refuse. */
    private suspend fun suivre(session: CastSession, url: String, delai: Long): String {
        val limite = System.currentTimeMillis() + delai
        while (System.currentTimeMillis() < limite) {
            val client = session.remoteMediaClient
            val statut = client?.mediaStatus
            if (client?.mediaInfo?.contentId == url && statut != null) {
                if (statut.playerState == MediaStatus.PLAYER_STATE_PLAYING ||
                    (statut.playerState == MediaStatus.PLAYER_STATE_BUFFERING && client.approximateStreamPosition > 0)) return "lecture"
                if (statut.playerState == MediaStatus.PLAYER_STATE_IDLE && statut.idleReason == MediaStatus.IDLE_REASON_ERROR) return "refus"
            }
            delay(250)
        }
        return "delai"
    }

    private suspend fun charger(session: CastSession, action: JSONObject, position: Double): Boolean {
        val client = session.remoteMediaClient ?: throw ErreurRelais("CAST_CONNEXION", "Le lecteur du téléviseur n’est pas prêt")
        val requete = MediaLoadRequestData.Builder().setMediaInfo(mediaInfo(action)).setAutoplay(true)
            .setCurrentTime((position * 1000).toLong()).build()
        return attendreResultat(client.load(requete)).status.isSuccess
    }

    private suspend fun executer(inscription: Inscription, action: JSONObject, accuse: JSONObject) {
        if (action.optString("type") != "liberer") { finDeSession?.cancel(); finDeSession = null }
        when (action.optString("type")) {
            "verifier" -> session(inscription)
            "sonder" -> {
                val s = session(inscription)
                val sonde = JSONObject(action.toString()).put("direct", false)
                    .put("metadonnees", JSONObject().put("genre", "video").put("titre", "FlixTunes"))
                val verdict = if (!charger(s, sonde, 0.0)) "refuse" else when (suivre(s, action.getString("url"), 6_000)) {
                    "lecture" -> "accepte"; "refus" -> "refuse"; else -> "inconnu" }
                accuse.put("verdict", verdict)
            }
            "charger" -> {
                val s = session(inscription)
                val direct = action.optBoolean("direct")
                if (!charger(s, action, if (direct) 0.0 else action.optDouble("position", 0.0)))
                    throw ErreurRelais("CAST_LOAD_FAILED", "Le téléviseur a refusé la vidéo")
                when (suivre(s, action.getString("url"), 35_000)) {
                    "refus" -> throw ErreurRelais("CAST_MEDIA_ERREUR", "Le téléviseur n’a pas pu lire la vidéo")
                    "delai" -> throw ErreurRelais("CAST_DEMARRAGE", "Le téléviseur n’a pas confirmé le démarrage de la vidéo")
                }
            }
            "commande" -> {
                val s = sessionActive()?.takeIf { it.castDevice?.deviceId == inscription.appareil }
                    ?: throw ErreurRelais("CAST_CONNEXION", "La session Cast de ce téléviseur est fermée")
                val c = action.getJSONObject("commande")
                if (c.optString("type") == "volume") { s.volume = c.getDouble("valeur").coerceIn(0.0, 1.0); return }
                val client = s.remoteMediaClient ?: throw ErreurRelais("CAST_RELAIS", "Aucune lecture en cours sur le téléviseur")
                val resultat = when (c.optString("type")) {
                    "pause" -> client.pause(); "reprendre" -> client.play(); "arreter" -> client.stop()
                    "position" -> client.seek(MediaSeekOptions.Builder().setPosition((c.getDouble("valeur") * 1000).toLong()).build())
                    else -> throw ErreurRelais("CAST_RELAIS", "Commande inconnue")
                }
                if (!attendreResultat(resultat).status.isSuccess) throw ErreurRelais("CAST_RELAIS", "Le téléviseur a refusé la commande")
            }
            "liberer" -> {
                // Le média s'arrête tout de suite ; la session ne se ferme qu'après cinq secondes sans
                // nouveau chargement, pour qu'un repli reparte sans rouvrir le lecteur du téléviseur.
                val s = sessionActive()?.takeIf { it.castDevice?.deviceId == inscription.appareil } ?: return
                s.remoteMediaClient?.let { client -> runCatching { attendreResultat(client.stop()) } }
                finDeSession?.cancel()
                finDeSession = scope.launch { delay(5_000); cast?.sessionManager?.endCurrentSession(true) }
            }
            else -> throw ErreurRelais("CAST_RELAIS", "Ordre inconnu")
        }
    }
}
