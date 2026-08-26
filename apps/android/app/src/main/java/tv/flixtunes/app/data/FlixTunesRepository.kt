package tv.flixtunes.app.data

// L'entrepôt dépend du contrat, pas du stockage Android : c'est ce qui le rend portable tel quel, et
// vérifiable sans plateforme grâce à `ReglagesEnMemoire`.
class FlixTunesRepository(private val store: Reglages) {
    var api: FlixTunesApi? = null
        private set

    suspend fun connect(address: String, username: String = "", password: String = ""): List<ProfileGroup> {
        val normalisee = ServerUrl.normalize(address)
        val jetonConserve = store.remoteToken.takeIf { store.serverUrl == normalisee }
        val candidate = FlixTunesApi(address, initialRemoteToken = jetonConserve)
        candidate.health()
        val distante = candidate.remoteSession()
        if (distante.required && !distante.authenticated) {
            require(username.isNotBlank() && password.isNotBlank()) { "Compte de connexion requis" }
            candidate.loginRemote(username.trim(), password)
        }
        val groups = candidate.profileGroups()
        require(groups.isNotEmpty()) { "Aucun groupe disponible" }
        api = candidate
        store.serverUrl = candidate.serverUrl
        store.remoteToken = candidate.remoteAccessToken()
        return groups
    }

    fun restore(): String? = store.serverUrl
    fun selectProfile(profile: Profile) { if (!profile.protected) api?.clearProfileAccess(); store.profileId = profile.id }
    /** Revient au choix du profil sans oublier le serveur déjà validé. */
    fun clearProfileSelection() { api?.clearProfileAccess(); store.profileId = null }
    fun disconnect() { api = null; store.serverUrl = null; store.profileId = null; store.remoteToken = null }
}
