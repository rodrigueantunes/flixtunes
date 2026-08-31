package tv.flixtunes.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import tv.flixtunes.app.playback.JetonSession

data class RemoteSessionStatus(val required: Boolean, val authenticated: Boolean, val account: String?)

class FlixTunesApi(
    server: String,
    initialProfileToken: String? = null,
    initialRemoteToken: String? = null,
) {
    val serverUrl = ServerUrl.normalize(server)
    private val root = ServerUrl.apiRoot(serverUrl)
    /**
     * Le jeton de session, partagé avec le lecteur.
     *
     * Il ne suffit pas de le garder ici : ExoPlayer va chercher lui-même manifeste, segments et
     * sous-titres, avec sa propre pile HTTP. Toute affectation est donc répercutée sur
     * [JetonSession], que la fabrique de sources relit à chaque requête.
     */
    private var profileToken: String? = initialProfileToken
        set(value) { field = value; JetonSession.profil = value }
    /**
     * Le jeton du compte de connexion, repris du processus quand l'appelant ne le fournit pas.
     *
     * Le lecteur construit sa **propre** instance et ne transmettait que le jeton de profil. Deux
     * conséquences, toutes deux constatées sur mobile en 5G : ses appels partaient sans compte — d'où
     * « Compte de connexion requis » au lancement — et surtout le bloc d'initialisation écrasait
     * [JetonSession] avec `null`, emportant au passage celui dont ExoPlayer se sert pour ses segments.
     * Une instance secondaire cassait donc la session de la première.
     */
    private var remoteToken: String? = initialRemoteToken ?: JetonSession.compteDistant
        set(value) { field = value; JetonSession.compteDistant = value }

    init {
        // On ne publie que ce que l'on possède : une instance sans jeton ne doit jamais effacer celui
        // d'une autre. C'est exactement ce qui rendait la lecture impossible à distance.
        initialProfileToken?.let { JetonSession.profil = it }
        (initialRemoteToken ?: JetonSession.compteDistant)?.let { JetonSession.compteDistant = it }
    }

    suspend fun health(): String {
        val reponse = request("/health")
        require(reponse.optString("status") == "ok") { "Ce serveur ne répond pas comme FlixTunes" }
        // L'écoute WAN masque volontairement la version exacte et ne rend que `name`. Exiger
        // `version` faisait échouer l'app Android avant même la lecture des groupes, tandis que le Web
        // atteignait le même serveur. Sur le LAN la version détaillée reste utilisée telle quelle.
        return reponse.optString("version").ifBlank { reponse.optString("name", "FlixTunes") }
    }
    suspend fun remoteSession(): RemoteSessionStatus {
        val reponse = request("/remote/session")
        return RemoteSessionStatus(
            required = reponse.optBoolean("required", false),
            authenticated = reponse.optBoolean("authenticated", false),
            account = reponse.optString("account").takeIf { it.isNotBlank() },
        )
    }
    suspend fun loginRemote(username: String, password: String, deviceName: String = "Application Android") {
        val reponse = request("/remote/login", "POST", JSONObject()
            .put("username", username).put("password", password).put("deviceName", deviceName))
        remoteToken = reponse.getString("token")
    }
    suspend fun profileGroups(): List<ProfileGroup> = withContext(Dispatchers.Default) {
        requestArray("/profile-groups").objects().map(::parseProfileGroup)
    }
    suspend fun createProfileGroup(name: String): ProfileGroup =
        parseProfileGroup(request("/profile-groups", "POST", JSONObject().put("name", name)))
    suspend fun updateProfileGroup(id: String, name: String): ProfileGroup =
        parseProfileGroup(request("/profile-groups/${encode(id)}", "PUT", JSONObject().put("name", name)))
    suspend fun deleteProfileGroup(id: String) { requestRaw("/profile-groups/${encode(id)}", "DELETE", null) }
    suspend fun profiles(groupId: String? = null): List<Profile> = withContext(Dispatchers.Default) {
        requestArray("/profiles" + groupId?.let { "?groupId=${encode(it)}" }.orEmpty())
            .objects().map(::parseProfile)
    }
    /**
     * Ouvre une session de profil. Le code est facultatif.
     *
     * Un profil sans code n'en demandait jamais : sur le réseau local aucune lecture n'en réclame, et
     * cela suffisait. Depuis l'accès distant, **chaque** lecture en exige une, et l'écran s'arrêtait
     * sur « Session requise » pour un profil parfaitement légitime.
     */
    suspend fun unlockProfile(profileId: String, pin: String? = null) {
        val corps = JSONObject().apply { if (!pin.isNullOrBlank()) put("pin", pin) }
        profileToken = request("/profiles/${encode(profileId)}/unlock", "POST", corps).getString("token")
    }

    /** Vrai lorsqu'une session de profil est deja ouverte sur cet appareil. */
    fun aUneSessionProfil(): Boolean = !profileToken.isNullOrBlank()
    /**
     * Crée un profil. Le serveur applique ses valeurs par défaut pour tout ce qui n'est pas transmis :
     * seuls le nom, la couleur, la langue et le code PIN facultatif sont nécessaires.
     */
    suspend fun createProfile(
        groupId: String, name: String, avatarColor: String, language: String, pin: String?,
        isChild: Boolean, age: Int?,
    ): Profile =
        parseProfile(request("/profiles", "POST", JSONObject()
            .put("groupId", groupId).put("name", name).put("avatarColor", avatarColor).put("language", language)
            .put("isChild", isChild).put("age", if (isChild) age else JSONObject.NULL)
            .apply { if (!pin.isNullOrBlank()) put("pin", pin) }))

    suspend fun deleteProfile(profileId: String) { requestRaw("/profiles/${encode(profileId)}", "DELETE", null) }

    fun clearProfileAccess() { profileToken = null }
    fun profileAccessToken(): String? = profileToken
    fun remoteAccessToken(): String? = remoteToken
    // Le réseau travaille déjà sur IO, mais JSONObject et les centaines de modèles qui en sortent
    // s'exécutaient ensuite sur viewModelScope/Main. Une page TV de 120 fiches pouvait ainsi bloquer
    // plusieurs images d'interface d'un seul tenant. Le contrat et les objets rendus ne changent pas.
    suspend fun home(profileId: String): Home = withContext(Dispatchers.Default) {
        parseHome(request("/home?profileId=${encode(profileId)}"))
    }
    suspend fun details(id: String, profileId: String): Details = withContext(Dispatchers.Default) {
        parseDetails(request("/catalog/${encode(id)}/details?profileId=${encode(profileId)}"))
    }
    suspend fun person(id: String, profileId: String): PersonDetails = withContext(Dispatchers.Default) {
        parsePersonDetails(request("/people/${encode(id)}?profileId=${encode(profileId)}"))
    }
    /**
     * Une page de catalogue, avec les mêmes critères que le client Web.
     *
     * Le tri et la recherche étaient déjà transmis ; l'état et les genres ne l'étaient pas, alors que
     * le serveur les accepte depuis que le Web s'en sert. Les appliquer côté client sur les seules
     * fiches déjà reçues donnerait un décompte faux dès la deuxième page : c'est pour cela qu'ils
     * partent dans la requête plutôt que de filtrer la liste au retour.
     *
     * Un nom de genre TMDB ne contient jamais de virgule : elle sépare donc sans risque, comme côté
     * Web.
     */
    suspend fun catalog(
        profileId: String, kind: String, offset: Int, limit: Int,
        sort: String = "title", query: String = "", filter: String = "all", genres: List<String> = emptyList(),
        letter: String? = null,
    ): CatalogPage = withContext(Dispatchers.Default) {
        parseCatalogPage(request(buildString {
            append("/catalog/browse?profileId=${encode(profileId)}&kind=$kind&sort=$sort&offset=$offset&limit=$limit")
            if (query.isNotBlank()) append("&q=${encode(query)}")
            if (filter != "all") append("&filter=$filter")
            if (genres.isNotEmpty()) append("&genres=${encode(genres.joinToString(","))}")
            if (!letter.isNullOrBlank()) append("&letter=${encode(letter)}")
        }))
    }

    /**
     * Met une fiche dans la liste d'envies du profil, ou l'en retire.
     *
     * L'identifiant attendu est celui du **catalogue**, pas celui du fichier : une œuvre à plusieurs
     * versions n'entre qu'une fois dans la liste.
     */
    suspend fun setWatchlist(catalogId: String, profileId: String, present: Boolean) {
        requestRaw("/catalog/${encode(catalogId)}/watchlist?profileId=${encode(profileId)}",
            if (present) "PUT" else "DELETE", null)
    }

    /**
     * Marque un média comme vu, sans l'avoir lu.
     *
     * Le serveur n'a pas de route dédiée : « vu » est une progression achevée. Le Web envoie donc une
     * seconde de position sur une seconde de durée avec `completed`, et c'est ce que l'on reproduit —
     * inventer ici une autre convention ferait diverger les deux clients sur la même base.
     */
    suspend fun markWatched(mediaId: String, profileId: String) {
        request("/media/${encode(mediaId)}/progress?profileId=${encode(profileId)}", "PUT", JSONObject()
            .put("positionSeconds", 1.0).put("durationSeconds", 1.0).put("completed", true))
    }

    /** Efface la progression : c'est ainsi qu'une fiche redevient « non vue ». */
    suspend fun clearProgress(mediaId: String, profileId: String) {
        requestRaw("/media/${encode(mediaId)}/progress?profileId=${encode(profileId)}", "DELETE", null)
    }

    /** Applique l'état à toutes les vidéos d'un film, d'une saison ou d'une série. */
    suspend fun setCatalogWatched(catalogId: String, profileId: String, completed: Boolean) {
        request("/catalog/${encode(catalogId)}/watched?profileId=${encode(profileId)}", "PUT",
            JSONObject().put("completed", completed))
    }

    /**
     * Modifie un profil existant : nom, couleur, langue, code PIN.
     *
     * Seuls les champs transmis changent — le serveur laisse les autres en place. C'est ce qui permet
     * de changer une couleur sans réécrire les préférences de lecture, qui sont nombreuses.
     *
     * `PUT` et non `PATCH`, qui décrirait mieux l'intention : `java.net.HttpURLConnection` refuse
     * `PATCH` par une liste de méthodes figée dans le JDK, et Android en hérite. Le serveur accepte
     * les deux verbes sur ce traitement, pour cette raison précise.
     */
    suspend fun updateProfile(profileId: String, champs: JSONObject): Profile =
        parseProfile(request("/profiles/${encode(profileId)}", "PUT", champs))

    /** Met à jour les préférences du lecteur sans réécrire l'identité ni le code PIN. */
    suspend fun updatePlaybackPreferences(profile: Profile): Profile =
        updateProfile(profile.id, profile.playbackPreferencesJson())

    /** Avis sur une recommandation : « j'aime », « je n'aime pas », ou « ne plus proposer ». */
    suspend fun recommendationFeedback(catalogId: String, profileId: String, valeur: String) {
        requestRaw("/recommendations/feedback?profileId=${encode(profileId)}", "PUT",
            JSONObject().put("catalogId", catalogId).put("value", valeur))
    }
    suspend fun search(query: String, profileId: String): List<Media> = withContext(Dispatchers.Default) {
        requestArray("/search?q=${encode(query)}&profileId=${encode(profileId)}").objects().map(::parseMedia)
    }
    suspend fun saveProgress(mediaId: String, profileId: String, position: Double, duration: Double) {
        request("/media/${encode(mediaId)}/progress?profileId=${encode(profileId)}", "PUT", JSONObject()
            .put("positionSeconds", position.coerceAtLeast(0.0)).put("durationSeconds", duration.coerceAtLeast(1.0)))
    }
    /**
     * Signale qu'un codec annoncé ne s'est pas lu sur cet appareil.
     *
     * Le serveur ne peut pas le constater seul : en lecture directe il sert le fichier, et l'échec se
     * produit dans le décodeur. Sans ce retour, il repropose le même codec à chaque lecture.
     *
     * L'échec de l'envoi est ignoré : c'est un diagnostic de confort, jamais une condition pour lire.
     * Faire échouer une lecture parce qu'un signalement n'est pas parti serait exactement le contraire
     * du but poursuivi.
     */
    suspend fun reportCodecFailure(deviceId: String, codec: String, reason: String? = null) {
        runCatching {
            request("/playback/codec-failure", "POST", JSONObject()
                .put("deviceId", deviceId).put("codec", codec).put("reason", reason ?: JSONObject.NULL))
        }
    }

    /** Une lecture directe réussie vaut démenti : le codec fonctionne, quoi qu'on ait cru. */
    suspend fun reportCodecSuccess(deviceId: String, codec: String) {
        runCatching {
            requestRaw("/playback/codec-success", "POST",
                JSONObject().put("deviceId", deviceId).put("codec", codec))
        }
    }

    suspend fun playbackInfo(mediaId: String, profileId: String): JSONObject =
        request("/media/${encode(mediaId)}/playback-info?profileId=${encode(profileId)}")
    suspend fun playbackNeighbors(mediaId: String, profileId: String): JSONObject = request("/media/${encode(mediaId)}/neighbors?profileId=${encode(profileId)}")
    fun subtitleUrl(mediaId: String, index: Int, profileId: String, external: Boolean = false, offsetSeconds: Double = 0.0): String {
        val segment = if (external) "subtitles/external/$index.vtt" else "subtitles/$index.vtt"
        return "$root/media/${encode(mediaId)}/$segment?offset=$offsetSeconds&profileId=${encode(profileId)}"
    }

    suspend fun startPlayback(mediaId: String, capabilities: JSONObject, profileId: String): PlaybackSession {
        var session = parsePlaybackSession(request("/media/${encode(mediaId)}/playback?profileId=${encode(profileId)}", "POST", capabilities))
        repeat(60) {
            if (session.status != "starting" || session.id == null) return session
            delay(500)
            session = parsePlaybackSession(request("/playback/${encode(session.id)}"))
        }
        return session.copy(status = "failed", error = "Le serveur a dépassé le délai de préparation")
    }

    suspend fun stopPlayback(sessionId: String) { requestRaw("/playback/${encode(sessionId)}", "DELETE", null) }
    fun absolute(path: String?): String? = ServerUrl.resolve(serverUrl, path)

    /* -------------------------------------------------------------------- */
    /* La télévision en direct                                              */
    /* -------------------------------------------------------------------- */

    /**
     * L'entrée « Live TV » doit-elle exister ?
     *
     * Elle n'existe que si la fonction est activée **et** qu'une source a rendu des chaînes. Un
     * serveur plus ancien ne connaît pas cette route : l'erreur est traitée comme un « non » par
     * l'appelant, ce qui est le comportement voulu par défaut.
     */
    suspend fun etatDirect(profileId: String): EtatDirectClient = withContext(Dispatchers.Default) {
        val reponse = request("/live?profileId=${encode(profileId)}")
        EtatDirectClient(reponse.optBoolean("disponible"), reponse.optInt("chaines"))
    }

    suspend fun chainesDirect(
        profileId: String, offset: Int, limit: Int,
        query: String = "", listes: List<String> = emptyList(), pays: List<String> = emptyList(),
        fiabilites: List<String> = emptyList(), favoris: Boolean = false, masquerMortes: Boolean = false,
    ): PageChaines = withContext(Dispatchers.Default) {
        val reponse = request(buildString {
            append("/live/channels?profileId=${encode(profileId)}&offset=$offset&limit=$limit")
            if (query.isNotBlank()) append("&q=${encode(query)}")
            if (listes.isNotEmpty()) append("&listes=${encode(listes.joinToString(","))}")
            if (pays.isNotEmpty()) append("&pays=${encode(pays.joinToString(","))}")
            if (fiabilites.isNotEmpty()) append("&fiabilites=${encode(fiabilites.joinToString(","))}")
            if (favoris) append("&favoris=1")
            if (masquerMortes) append("&masquerMortes=1")
        })
        val items = reponse.optJSONArray("items") ?: JSONArray()
        PageChaines(
            items = (0 until items.length()).map { lireChaine(items.getJSONObject(it)) },
            total = reponse.optInt("total"), offset = reponse.optInt("offset"), limit = reponse.optInt("limit"),
        )
    }

    /**
     * La chaîne qui porte ce numéro. C'est la moitié serveur de la saisie à la télécommande : la
     * grille du client n'en tient que soixante à la fois, composer « 1 340 » ne peut pas en dépendre.
     */
    suspend fun chaineParNumero(profileId: String, numero: Int): ChaineDirect? = withContext(Dispatchers.Default) {
        runCatching { lireChaine(request("/live/numero?profileId=${encode(profileId)}&numero=$numero")) }.getOrNull()
    }

    /** La chaîne voisine, par numéro — P+ et P− d'un téléviseur. Les extrémités bouclent. */
    suspend fun chaineVoisine(profileId: String, numero: Int, sens: Int): ChaineDirect? = withContext(Dispatchers.Default) {
        runCatching { lireChaine(request("/live/numero?profileId=${encode(profileId)}&numero=$numero&sens=$sens")) }.getOrNull()
    }

    /** L'étoile d'une chaîne, pour ce profil. Le même geste que la liste d'envies du catalogue. */
    suspend fun favoriDirect(profileId: String, id: String, favori: Boolean) {
        requestRaw("/live/channels/${encode(id)}/favori?profileId=${encode(profileId)}",
            if (favori) "PUT" else "DELETE", null)
    }

    /**
     * La dernière chaîne regardée par ce profil.
     *
     * Elle vient du serveur : un téléviseur qu'on rallume retrouve ce qu'on regardait, même si on
     * l'avait quitté depuis le téléphone.
     */
    suspend fun derniereChaineDirect(profileId: String): ChaineDirect? = withContext(Dispatchers.Default) {
        runCatching {
            val reponse = request("/live/derniere?profileId=${encode(profileId)}")
            if (reponse.isNull("chaine")) null else lireChaine(reponse.getJSONObject("chaine"))
        }.getOrNull()
    }

    /** Les adresses d'une chaîne, déjà triées par ce que l'usage a appris. */
    suspend fun chaineDirect(profileId: String, id: String): ChaineDetaillee = withContext(Dispatchers.Default) {
        val reponse = request("/live/channels/${encode(id)}?profileId=${encode(profileId)}")
        val sources = reponse.optJSONArray("sources") ?: JSONArray()
        ChaineDetaillee(
            chaine = lireChaine(reponse),
            sources = (0 until sources.length()).map {
                val source = sources.getJSONObject(it)
                SourceChaine(
                    source.optString("url"), source.optInt("succes"), source.optInt("echecs"),
                    // Absentes tant que le serveur n'a pas sondé la chaîne : `null`, et non zéro, qui
                    // se lirait comme « mesurée à rien ».
                    source.optInt("hauteur").takeIf { source.has("hauteur") && !source.isNull("hauteur") },
                    source.optInt("debit").takeIf { source.has("debit") && !source.isNull("debit") },
                )
            },
        )
    }

    /**
     * Ce que la lecture a appris : cette adresse a joué, ou elle n'a pas répondu.
     *
     * C'est ainsi que l'ordre d'essai s'améliore tout seul. L'échec de cet appel n'a aucune
     * conséquence pour la personne qui regarde : il est avalé par l'appelant.
     */
    suspend fun resultatChaineDirect(profileId: String, id: String, url: String, ok: Boolean) {
        requestRaw("/live/channels/${encode(id)}/resultat?profileId=${encode(profileId)}", "POST",
            JSONObject().put("url", url).put("ok", ok))
    }

    /**
     * Les facettes comptent **sous les autres filtres cochés**, jamais sur le corpus entier.
     *
     * Sans cela l'écran promettait « France 1 355 » alors qu'une playlist déjà cochée n'en contenait
     * aucune : on cochait, on tombait sur zéro. Chaque facette ignore son propre critère — sinon
     * cocher France ne laisserait plus voir que la France.
     */
    private fun facette(pays: List<String>, listes: List<String>, fiabilites: List<String>, q: String): String {
        val morceaux = mutableListOf<String>()
        if (listes.isNotEmpty()) morceaux += "listes=${encode(listes.joinToString(","))}"
        if (pays.isNotEmpty()) morceaux += "pays=${encode(pays.joinToString(","))}"
        if (fiabilites.isNotEmpty()) morceaux += "fiabilites=${encode(fiabilites.joinToString(","))}"
        if (q.isNotBlank()) morceaux += "q=${encode(q)}"
        return if (morceaux.isEmpty()) "" else "&" + morceaux.joinToString("&")
    }

    suspend fun listesDirect(
        profileId: String,
        pays: List<String> = emptyList(),
        fiabilites: List<String> = emptyList(),
        q: String = "",
    ): List<ListeDirect> = withContext(Dispatchers.Default) {
        val tableau = requestArray(
            "/live/listes?profileId=${encode(profileId)}" + facette(pays, emptyList(), fiabilites, q),
        )
        (0 until tableau.length()).map {
            val entree = tableau.getJSONObject(it)
            ListeDirect(entree.optString("id"), entree.optString("nom"),
                entree.optString("classement", "inconnue"), entree.optInt("chaines"))
        }
    }

    suspend fun paysDirect(
        profileId: String,
        listes: List<String> = emptyList(),
        fiabilites: List<String> = emptyList(),
        q: String = "",
    ): List<PaysDirect> = withContext(Dispatchers.Default) {
        val tableau = requestArray(
            "/live/pays?profileId=${encode(profileId)}" + facette(emptyList(), listes, fiabilites, q),
        )
        (0 until tableau.length()).map {
            val entree = tableau.getJSONObject(it)
            PaysDirect(entree.optString("code"), entree.optString("nom"), entree.optInt("chaines"))
        }
    }

    suspend fun fiabilitesDirect(profileId: String): List<FiabiliteDirect> = withContext(Dispatchers.Default) {
        val tableau = requestArray("/live/fiabilites?profileId=${encode(profileId)}")
        (0 until tableau.length()).map {
            val entree = tableau.getJSONObject(it)
            FiabiliteDirect(entree.optString("classement"), entree.optInt("listes"))
        }
    }

    private fun lireChaine(entree: JSONObject) = ChaineDirect(
        id = entree.optString("id"),
        nom = entree.optString("nom"),
        numero = if (entree.isNull("numero")) null else entree.optInt("numero"),
        logo = entree.optString("logo").takeIf { it.isNotBlank() && it != "null" },
        groupe = entree.optString("groupe").takeIf { it.isNotBlank() && it != "null" },
        pays = entree.optString("pays").takeIf { it.isNotBlank() && it != "null" },
        etat = entree.optString("etat", "inconnue"),
        adresses = entree.optInt("adresses"),
        favori = entree.optBoolean("favori"),
    )

    private suspend fun request(path: String, method: String = "GET", body: JSONObject? = null): JSONObject {
        val texte = requestRaw(path, method, body)
        return withContext(Dispatchers.Default) { JSONObject(texte) }
    }
    private suspend fun requestArray(path: String): JSONArray {
        val texte = requestRaw(path, "GET", null)
        return withContext(Dispatchers.Default) { JSONArray(texte) }
    }

    private suspend fun requestRaw(path: String, method: String, body: JSONObject?): String = withContext(Dispatchers.IO) {
        val connection = URL("$root$path").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.connectTimeout = 8_000
            connection.readTimeout = 45_000
            connection.setRequestProperty("Accept", "application/json")
            profileToken?.let { connection.setRequestProperty("X-FlixTunes-Profile-Token", it) }
            remoteToken?.let { connection.setRequestProperty("X-FlixTunes-Remote-Token", it) }
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.bufferedWriter().use { it.write(body.toString()) }
            }
            val code = connection.responseCode
            if (code == 204) return@withContext "{}"
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code !in 200..299) throw IOException(runCatching { JSONObject(text).optString("message") }.getOrNull().orEmpty().ifBlank { "Erreur serveur $code" })
            text
        } finally { connection.disconnect() }
    }

    private fun encode(value: String) = java.net.URLEncoder.encode(value, Charsets.UTF_8.name())
}
