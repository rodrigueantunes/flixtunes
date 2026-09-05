package tv.flixtunes.app

import android.app.Application
import coil3.SingletonImageLoader
import coil3.request.CachePolicy
import coil3.request.ImageRequest
import coil3.size.Size
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import org.json.JSONObject
import java.text.Normalizer
import tv.flixtunes.app.data.ChaineDirect
import tv.flixtunes.app.data.Details
import tv.flixtunes.app.data.FlixTunesApi
import tv.flixtunes.app.data.FlixTunesRepository
import tv.flixtunes.app.data.FiabiliteDirect
import tv.flixtunes.app.data.Home
import tv.flixtunes.app.data.ListeDirect
import tv.flixtunes.app.data.Media
import tv.flixtunes.app.data.PersonCredit
import tv.flixtunes.app.data.PersonDetails
import tv.flixtunes.app.data.PaysDirect
import tv.flixtunes.app.data.Profile
import tv.flixtunes.app.data.ProfileGroup
import tv.flixtunes.app.data.Season
import tv.flixtunes.app.data.Reglages
import tv.flixtunes.app.data.SessionStore
import tv.flixtunes.app.ui.nombreAffichesInitialesTv
import tv.flixtunes.app.ui.tailleTextureJaquetteTv

private const val CATALOG_PAGE_SIZE = 60
private const val CATALOG_PAGE_SIZE_TV = 120

/**
 * Chaînes demandées par page.
 *
 * Soixante, comme le catalogue du Web. Le corpus en compte 76 823 : tout charger d'avance coûterait
 * plusieurs mégaoctets de JSON pour une grille dont on voit vingt cartes.
 */
private const val taillePageDirect = 60

/**
 * Étapes réelles du démarrage, dans l'ordre où elles surviennent.
 * Le pourcentage jalonne une séquence effective : il n'est pas une animation décorative qui avancerait
 * sans rien attendre.
 */
enum class StartupStep(val libelle: Int, val progress: Float) {
    // Une enumeration porte des constantes : elle ne peut pas resoudre un texte, faute de contexte.
    // Elle transporte donc l'identifiant de ressource, que l'ecran resout au moment de l'afficher.
    CONNEXION(R.string.etat_connexion, .18f),
    PROFILS(R.string.etat_profils, .5f),
    MEDIATHEQUE(R.string.etat_mediatheque, .70f),
    // La télévision en direct vient **après** la médiathèque, et seulement si elle est réglée : c'est
    // l'accueil qu'on veut voir en premier, et une grille de chaînes ne vaut pas de le retarder.
    DIRECT(R.string.etat_direct, .82f),
    AFFICHES(R.string.etat_affiches_tv, .92f),
}

/**
 * Une section de catalogue chargée page par page, avec ses critères.
 *
 * `total` est le nombre de fiches annoncé par le serveur, `items` ce qui a été reçu jusqu'ici. Tant que
 * les deux diffèrent, il reste à charger. `loading` empêche deux demandes concurrentes de la même page.
 *
 * Tri, état, recherche et genres vivent ici plutôt que dans l'écran : ils partent au serveur, qui
 * seul peut les appliquer sur le catalogue entier. Les appliquer sur les fiches déjà reçues donnerait
 * un décompte faux dès la deuxième page — c'est le raisonnement que le client Web tient déjà.
 */
@Immutable
data class CatalogSection(
    val items: List<Media> = emptyList(),
    val total: Int = 0,
    /** Rang absolu du premier élément reçu ; non nul après un saut A–Z. */
    val offset: Int = 0,
    /** Ancre A–Z à positionner une fois lorsque la page correspondante arrive. */
    val anchor: Int? = null,
    val loading: Boolean = false,
    val loaded: Boolean = false,
    /** « title », « release » ou « added ». */
    val sort: String = "title",
    /** « all », « progress », « watched » ou « unwatched ». */
    val filter: String = "all",
    val query: String = "",
    val genres: List<String> = emptyList(),
    /** Index alphabétique TV actif, ou null pour le catalogue entier. */
    val letter: String? = null,
    /** Les genres du catalogue entier, établis par le serveur. */
    val availableGenres: List<String> = emptyList(),
) {
    val hasMore: Boolean get() = offset + items.size < total
    val hasPrevious: Boolean get() = offset > 0
}

@Immutable
data class MainState(
    val startup: StartupStep? = null,
    val server: String? = null,
    val groups: List<ProfileGroup> = emptyList(),
    val group: ProfileGroup? = null,
    val profiles: List<Profile> = emptyList(),
    val profile: Profile? = null,
    val home: Home? = null,
    val details: Details? = null,
    val personDetails: PersonDetails? = null,
    val search: List<Media> = emptyList(),
    val query: String = "",
    val movies: CatalogSection = CatalogSection(),
    val shows: CatalogSection = CatalogSection(),
    /** Les chaînes du rayon Web. Même forme que les deux autres : ce sont des fiches de catalogue. */
    val web: CatalogSection = CatalogSection(),
    /** Le serveur offre-t-il un rayon Web ? Un dossier déclaré suffit. */
    val webDisponible: Boolean = false,
    /**
     * La télévision en direct, ou son absence.
     *
     * `direct` reste à `null` tant que le serveur n'a pas répondu, et la section n'apparaît dans le
     * menu que lorsqu'il a dit **oui** : une installation qui ne s'en sert pas ne voit rien changer,
     * et un serveur plus ancien qui ignore la route se comporte comme une installation éteinte.
     */
    val direct: SectionDirect? = null,
    val loading: Boolean = false,
    val error: String? = null,
)

/**
 * La grille des chaînes en direct et ses filtres.
 *
 * Elle est paginée comme le catalogue et pour la même raison, en plus fort : le corpus mesuré compte
 * **76 823 chaînes**. Rien n'est chargé d'avance, et une page en appelle une autre quand on approche
 * du bas.
 */
@Immutable
data class SectionDirect(
    val disponible: Boolean = false,
    /**
     * Le profil pour qui cette section a été bâtie.
     *
     * Il sert à savoir si l'on peut la garder au retour d'une chaîne. Les favorites et la dernière
     * chaîne sont par profil : conserver la grille d'un autre serait pire que de la recharger.
     */
    val profileId: String? = null,
    val items: List<ChaineDirect> = emptyList(),
    val total: Int = 0,
    val loading: Boolean = false,
    val loaded: Boolean = false,
    val query: String = "",
    val listes: List<ListeDirect> = emptyList(),
    val listesChoisies: List<String> = emptyList(),
    val pays: List<PaysDirect> = emptyList(),
    val paysChoisis: List<String> = emptyList(),
    val fiabilites: List<FiabiliteDirect> = emptyList(),
    val fiabilitesChoisies: List<String> = emptyList(),
    /** Ne montrer que les chaînes retenues par le profil. */
    val favorisSeuls: Boolean = false,
    /** Écarter celles dont la dernière lecture a échoué. Éteint par défaut : « morte » n'est pas définitif. */
    val masquerMortes: Boolean = false,
    /** La dernière chaîne regardée, pour la rallumer d'un geste. */
    val derniere: ChaineDirect? = null,
) {
    val hasMore: Boolean get() = items.size < total
}

class MainViewModel(application: Application) : AndroidViewModel(application) {
    // Le type déclaré est le contrat, pas la mise en œuvre : c'est ce qui permettra de fournir un
    // autre stockage sans toucher à cette classe.
    private val store: Reglages = SessionStore(application)

    /** Les textes affiches viennent des ressources, jamais du code : ils doivent pouvoir se traduire. */
    private fun texte(id: Int): String = getApplication<Application>().getString(id)
    private val repository = FlixTunesRepository(store)
    // Deux fois moins de raccords réseau et de remplacements de `MainState` pendant un long
    // défilement TV. La grille reste paresseuse : recevoir 120 fiches ne les compose pas toutes.
    // Mobile et tablette conservent la page légère de 60 éléments.
    private val estTelevision = estAppareilTv(application)
    // Mesuré une fois : la classe de mémoire ne change pas pendant la vie du processus, et les
    // fonctions de taille ne prennent plus qu'elle — plus de `Context` pour choisir un nombre.
    private val memoire = memoireTv(application)
    private val taillePageCatalogue = if (estTelevision) CATALOG_PAGE_SIZE_TV else CATALOG_PAGE_SIZE
    private var searchJob: Job? = null
    private var criteresJob: Job? = null
    var state by mutableStateOf(MainState())
        private set

    init { repository.restore()?.let(::connect) }

    fun connect(address: String, username: String = "", password: String = "") = viewModelScope.launch {
        state = state.copy(loading = true, error = null, startup = StartupStep.CONNEXION)
        runCatching {
            val groups = repository.connect(address, username, password)
            state = state.copy(startup = StartupStep.PROFILS)
            state = state.copy(
                server = repository.api?.serverUrl, groups = groups, group = null,
                profiles = emptyList(), profile = null, home = null, loading = false, startup = null,
            )
        }.onFailure {
            state = state.copy(loading = false, startup = null, error = it.message ?: texte(R.string.erreur_serveur_introuvable))
        }
    }

    fun disconnect() { repository.disconnect(); state = MainState() }

    fun selectGroup(group: ProfileGroup) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        state = state.copy(loading = true, error = null)
        runCatching { currentApi.profiles(group.id) }
            .onSuccess { profiles ->
                state = state.copy(group = group, profiles = profiles, profile = null, home = null, loading = false)
            }
            .onFailure { state = state.copy(loading = false, error = it.message ?: texte(R.string.erreur_groupes)) }
    }

    fun leaveGroup() {
        repository.clearProfileSelection()
        state = state.copy(group = null, profiles = emptyList(), profile = null, home = null, error = null)
    }

    fun createGroup(name: String) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        state = state.copy(loading = true, error = null)
        runCatching { currentApi.createProfileGroup(name.trim()) }
            .onSuccess { group -> state = state.copy(groups = state.groups + group, loading = false) }
            .onFailure { state = state.copy(loading = false, error = it.message ?: texte(R.string.erreur_groupes)) }
    }

    fun updateGroup(group: ProfileGroup, name: String) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        state = state.copy(loading = true, error = null)
        runCatching { currentApi.updateProfileGroup(group.id, name.trim()) }
            .onSuccess { updated -> state = state.copy(
                groups = state.groups.map { if (it.id == updated.id) updated else it },
                group = if (state.group?.id == updated.id) updated else state.group, loading = false,
            ) }
            .onFailure { state = state.copy(loading = false, error = it.message ?: texte(R.string.erreur_groupes)) }
    }

    fun deleteGroup(group: ProfileGroup) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        state = state.copy(loading = true, error = null)
        runCatching { currentApi.deleteProfileGroup(group.id) }
            .onSuccess { state = state.copy(groups = state.groups.filterNot { it.id == group.id }, loading = false) }
            .onFailure { state = state.copy(loading = false, error = it.message ?: texte(R.string.erreur_groupes)) }
    }

    /** Ouvre le sélecteur de profils sans transformer ce geste en déconnexion du NAS. */
    fun leaveProfile() {
        repository.clearProfileSelection()
        searchJob?.cancel()
        criteresJob?.cancel()
        state = state.copy(
            profile = null,
            home = null,
            details = null,
            query = "",
            search = emptyList(),
            movies = CatalogSection(),
            shows = CatalogSection(),
            loading = false,
            error = null,
        )
    }

    /** Crée un profil puis le sélectionne, comme le fait le client Web. */
    fun createProfile(
        name: String, avatarColor: String, language: String, pin: String?, isChild: Boolean, age: Int?,
    ) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        val currentGroup = state.group ?: return@launch
        state = state.copy(loading = true, error = null)
        runCatching { currentApi.createProfile(currentGroup.id, name.trim(), avatarColor, language, pin, isChild, age) }
            .onSuccess { created ->
                state = state.copy(profiles = state.profiles + created, loading = false)
                selectProfile(created)
            }
            .onFailure { state = state.copy(loading = false, error = it.message ?: texte(R.string.erreur_creation_profil)) }
    }

    /**
     * Modifie un profil sans le sélectionner : nom, couleur, langue, code PIN.
     *
     * Cette possibilité n'existait que dans le client Web. Une personne qui n'a qu'un téléphone ne
     * pouvait donc ni changer sa couleur, ni poser un code PIN, ni corriger une faute dans son
     * prénom — il fallait supprimer le profil et le recréer, ce qui emporte l'historique.
     *
     * `pin` distingue trois intentions : `null` ne touche pas au code existant, une chaîne vide le
     * retire, une chaîne de quatre à huit chiffres le remplace.
     */
    fun updateProfile(
        profile: Profile, name: String, avatarColor: String, language: String, pin: String?, ancienPin: String?,
        isChild: Boolean, age: Int?,
    ) =
        viewModelScope.launch {
            val currentApi = repository.api ?: return@launch
            state = state.copy(loading = true, error = null)
            val champs = JSONObject()
                .put("name", name.trim()).put("avatarColor", avatarColor).put("language", language)
                .put("isChild", isChild).put("age", if (isChild) age else JSONObject.NULL)
            if (pin != null) champs.put("pin", pin)
            if (pin != null && !ancienPin.isNullOrBlank()) champs.put("ancienPin", ancienPin)
            runCatching { currentApi.updateProfile(profile.id, champs) }
                .onSuccess { modifie ->
                    state = state.copy(
                        profiles = state.profiles.map { if (it.id == modifie.id) modifie else it },
                        profile = if (state.profile?.id == modifie.id) modifie else state.profile,
                        loading = false,
                    )
                }
                .onFailure { state = state.copy(loading = false, error = it.message ?: texte(R.string.erreur_profil_modification)) }
        }

    /** Enregistre les réglages de lecture déjà portés par le profil serveur. */
    fun updatePlaybackPreferences(preferences: Profile) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        state = state.copy(loading = true, error = null)
        runCatching { currentApi.updatePlaybackPreferences(preferences) }
            .onSuccess { modifie ->
                state = state.copy(
                    profiles = state.profiles.map { if (it.id == modifie.id) modifie else it },
                    profile = if (state.profile?.id == modifie.id) modifie else state.profile,
                    home = state.home?.let { accueil ->
                        if (accueil.profile.id == modifie.id) accueil.copy(profile = modifie) else accueil
                    },
                    loading = false,
                )
            }
            .onFailure {
                state = state.copy(
                    loading = false,
                    error = it.message ?: texte(R.string.erreur_profil_modification),
                )
            }
    }

    /** Supprime un profil. Le serveur refuse la suppression du dernier profil restant. */
    fun deleteProfile(profile: Profile) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        state = state.copy(loading = true, error = null)
        runCatching { currentApi.deleteProfile(profile.id) }
            .onSuccess {
                val remaining = state.profiles.filterNot { it.id == profile.id }
                val active = if (state.profile?.id == profile.id) null else state.profile
                state = state.copy(profiles = remaining, profile = active, home = if (active == null) null else state.home, loading = false)
            }
            .onFailure { state = state.copy(loading = false, error = it.message ?: texte(R.string.erreur_suppression)) }
    }

    fun selectProfile(profile: Profile) = viewModelScope.launch {
        repository.selectProfile(profile)
        // Les sections de catalogue sont vidées avec le reste : les conserver montrerait au profil
        // suivant les fiches du précédent, progressions et liste d'envies comprises.
        state = state.copy(profile = profile, details = null, query = "", search = emptyList(), home = null,
            movies = CatalogSection(), shows = CatalogSection())
        assurerSessionProfil(profile)
        loadHome(silent = false)
    }

    /**
     * Ouvre une session de profil si elle manque, avant toute lecture.
     *
     * Un profil protégé en obtient une par son code, à l'écran de déverrouillage. Un profil **sans**
     * code n'en demandait aucune : inoffensif sur le réseau local, où rien n'en réclame, mais bloquant
     * depuis Internet où chaque lecture en exige une — l'application s'arrêtait sur « Session requise ».
     *
     * L'échec est volontairement silencieux : en local la session ne sert à rien, et à distance c'est
     * la lecture suivante qui dira elle-même ce qui manque, avec son propre message.
     */
    private suspend fun assurerSessionProfil(profile: Profile) {
        if (profile.protected) return
        val currentApi = repository.api ?: return
        if (currentApi.aUneSessionProfil()) return
        runCatching { currentApi.unlockProfile(profile.id) }
    }

    fun unlockProfile(profile: Profile, pin: String) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        state = state.copy(loading = true, error = null)
        runCatching { currentApi.unlockProfile(profile.id, pin) }
            .onSuccess { selectProfile(profile) }
            .onFailure { state = state.copy(loading = false, error = it.message ?: texte(R.string.erreur_pin)) }
    }

    /**
     * Recharge l'accueil.
     *
     * `silent` est vrai dès qu'un accueil est déjà affiché : le rafraîchissement se fait alors en fond,
     * sans indicateur. Sans cela, chaque retour au premier plan — sortie du lecteur, fermeture d'une
     * boîte de dialogue, retour de veille ou de PiP — rallumait une barre de chargement, ce qui donnait
     * l'impression que l'application charge en permanence.
     */
    fun loadHome(silent: Boolean = state.home != null) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        val profile = state.profile ?: return@launch
        val premierDemarrageTv = estTelevision && !silent && state.home == null
        state = state.copy(loading = !silent, error = null,
            startup = if (premierDemarrageTv) StartupStep.MEDIATHEQUE else state.startup)
        try {
            val accueil = currentApi.home(profile.id)
            if (!premierDemarrageTv) {
                state = state.copy(home = accueil, loading = false, startup = null)
                // Sur téléphone, la question se pose sans écran de démarrage : l'entrée de menu
                // apparaît quand la réponse arrive, et pas avant.
                chargerDirect(currentApi, profile.id)
                return@launch
            }

            // Le téléviseur paie le coût réseau une fois au choix du profil. Les menus Films/Séries
            // disposent ensuite immédiatement de toutes leurs fiches : plus de requête ni de fusion
            // de page pendant un maintien de la télécommande ou un saut A–Z.
            state = state.copy(home = accueil, startup = StartupStep.MEDIATHEQUE)
            val (films, series) = coroutineScope {
                val films = async { chargerCatalogueTv(currentApi, profile.id, "movies") }
                val series = async { chargerCatalogueTv(currentApi, profile.id, "shows") }
                films.await() to series.await()
            }
            state = state.copy(movies = films, shows = series, startup = StartupStep.DIRECT)
            chargerDirect(currentApi, profile.id)
            state = state.copy(startup = StartupStep.AFFICHES)

            val urls = urlsAffiches(currentApi, films.items, series.items)
            prechargerAffichesTv(urls.take(nombreAffichesInitialesTv(memoire)))
            state = state.copy(loading = false, startup = null)
        } catch (failure: Throwable) {
            if (profile.protected) {
                currentApi.clearProfileAccess()
                state = state.copy(profile = null, home = null, loading = false, startup = null,
                    error = texte(R.string.erreur_session_expiree))
            } else state = state.copy(loading = false, startup = null, error = failure.message)
        }
    }

    private suspend fun chargerCatalogueTv(api: FlixTunesApi, profileId: String, kind: String): CatalogSection {
        val items = mutableListOf<Media>()
        val connus = mutableSetOf<String>()
        var total = Int.MAX_VALUE
        var offset = 0
        var genres = emptyList<String>()
        while (offset < total) {
            val page = api.catalog(profileId, kind, offset, CATALOG_PAGE_SIZE_TV)
            if (page.items.isEmpty()) { total = page.total; break }
            page.items.filterTo(items) { connus.add(it.id) }
            total = page.total
            genres = page.availableGenres.ifEmpty { genres }
            val suivant = page.offset + page.items.size
            if (suivant <= offset) break
            offset = suivant
        }
        return CatalogSection(items = items, total = total.coerceAtLeast(items.size), offset = 0,
            loaded = true, availableGenres = genres)
    }

    private fun urlsAffiches(api: FlixTunesApi, films: List<Media>, series: List<Media>): List<String> {
        // Entrelacer les deux catalogues évite de préparer tous les films avant la première série.
        val maximum = maxOf(films.size, series.size)
        return buildList {
            for (index in 0 until maximum) {
                films.getOrNull(index)?.posterUrl?.let(api::absolute)?.let(::add)
                series.getOrNull(index)?.posterUrl?.let(api::absolute)?.let(::add)
            }
        }.distinct()
    }

    private suspend fun prechargerAffichesTv(urls: List<String>) {
        if (urls.isEmpty()) return
        val application = getApplication<Application>()
        val chargeur = SingletonImageLoader.get(application)
        val largeurTexture = tailleTextureJaquetteTv(memoire)
        suspend fun charger(url: String) {
            runCatching {
                chargeur.execute(ImageRequest.Builder(application).data(url)
                    // Même clé de taille que les cartes visibles : le démarrage prépare le bitmap
                    // réellement réutilisé, pas une variante 320 px redécodée quelques instants après.
                    .size(Size(largeurTexture, largeurTexture * 3 / 2))
                    .memoryCachePolicy(CachePolicy.ENABLED)
                    .diskCachePolicy(CachePolicy.ENABLED).build())
            }
        }
        coroutineScope {
            val concurrence = Semaphore(4)
            urls.map { url -> async { concurrence.withPermit { charger(url) } } }.awaitAll()
        }
    }

    fun open(media: Media) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        val profile = state.profile ?: return@launch
        state = state.copy(loading = true, error = null)
        runCatching { currentApi.details(media.catalogId ?: media.id, profile.id) }
            .onSuccess { state = state.copy(details = it, personDetails = null, loading = false) }
            .onFailure { state = state.copy(loading = false, error = it.message) }
    }

    fun closeDetails() { state = state.copy(details = null) }

    fun openPerson(person: PersonCredit) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        val profile = state.profile ?: return@launch
        state = state.copy(loading = true, error = null)
        runCatching { currentApi.person(person.id, profile.id) }
            .onSuccess { state = state.copy(personDetails = it, loading = false) }
            .onFailure { state = state.copy(loading = false, error = it.message) }
    }

    fun closePerson() { state = state.copy(personDetails = null) }

    /** Relit silencieusement la fiche après une lecture afin que progression et actions restent justes. */
    fun refreshDetails() = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        val profile = state.profile ?: return@launch
        val current = state.details ?: return@launch
        val cible = current.item.catalogId ?: current.item.id
        runCatching { currentApi.details(cible, profile.id) }
            .onSuccess { refreshed -> state = state.copy(details = refreshed) }
    }

    /**
     * Met la fiche ouverte dans la liste d'envies, ou l'en retire.
     *
     * La fiche affichée est mise à jour sur-le-champ, sans attendre le rechargement : c'est un
     * basculement, et une action qui ne se voit qu'après un aller-retour réseau se fait appuyer deux
     * fois. L'accueil, lui, se recharge en fond pour que le rail « Ma liste » suive.
     */
    fun toggleWatchlist(media: Media? = state.details?.item) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        val profile = state.profile ?: return@launch
        val target = media ?: return@launch
        val details = state.details
        val cible = target.catalogId ?: target.id
        val voulu = !target.inWatchlist
        if (details != null && (details.item.catalogId ?: details.item.id) == cible) {
            state = state.copy(details = details.copy(item = details.item.copy(inWatchlist = voulu)))
        }
        runCatching { currentApi.setWatchlist(cible, profile.id, voulu) }
            .onSuccess { loadHome(silent = true) }
            .onFailure { echec ->
                // Le serveur a refusé : la fiche reprend son état réel plutôt que de mentir.
                state = state.copy(
                    details = state.details?.let { current -> if ((current.item.catalogId ?: current.item.id) == cible)
                        current.copy(item = current.item.copy(inWatchlist = !voulu)) else current },
                    error = echec.message,
                )
            }
    }

    /**
     * Marque un média comme vu, ou le rend non vu.
     *
     * « Vu » n'est pas un champ distinct côté serveur : c'est une progression achevée. Retirer la
     * marque revient donc à effacer la progression, ce qui est aussi ce que fait le client Web.
     */
    fun toggleWatched(media: Media) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        val profile = state.profile ?: return@launch
        val vu = media.completed
        runCatching {
            if (media.kind == "episode") {
                if (vu) currentApi.clearProgress(media.id, profile.id) else currentApi.markWatched(media.id, profile.id)
            } else {
                currentApi.setCatalogWatched(media.catalogId ?: media.id, profile.id, !vu)
            }
        }.onSuccess {
            if (media.kind == "show") appliquerSerieVue(!vu) else appliquerVu(media.id, !vu)
            loadHome(silent = true)
        }.onFailure { state = state.copy(error = it.message) }
    }

    fun toggleSeasonWatched(season: Season) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        val profile = state.profile ?: return@launch
        runCatching { currentApi.setCatalogWatched(season.id, profile.id, !season.completed) }
            .onSuccess {
                appliquerSaisonVue(season.id, !season.completed)
                loadHome(silent = true)
            }
            .onFailure { state = state.copy(error = it.message) }
    }

    /**
     * Répercute le nouvel état « vu » dans la fiche ouverte, sans la redemander au serveur.
     *
     * Recharger la fiche entière pour une case cochée ferait sauter la liste d'épisodes et perdrait la
     * saison sélectionnée. Le serveur reste la source de vérité : le prochain chargement de la fiche
     * confirmera.
     */
    private fun appliquerVu(mediaId: String, vu: Boolean) {
        val details = state.details ?: return
        var item = if (details.item.id == mediaId || details.item.playableMediaId == mediaId) details.item.copy(completed = vu,
            progressPercent = if (vu) 100 else 0) else details.item
        val seasons = details.seasons.map { saison ->
            val episodes = saison.episodes.map { episode ->
                if (episode.id == mediaId) episode.copy(completed = vu, progressPercent = if (vu) 100 else 0)
                else episode
            }
            saison.copy(episodes = episodes, completed = episodes.isNotEmpty() && episodes.all { it.completed })
        }
        if (item.kind == "show") item = item.copy(completed = seasons.any { it.episodes.isNotEmpty() }
            && seasons.filter { it.episodes.isNotEmpty() }.all { it.completed })
        state = state.copy(details = details.copy(item = item, seasons = seasons))
    }

    private fun appliquerSaisonVue(seasonId: String, vu: Boolean) {
        val details = state.details ?: return
        val seasons = details.seasons.map { saison -> if (saison.id != seasonId) saison else saison.copy(
            completed = vu,
            episodes = saison.episodes.map { it.copy(completed = vu, progressPercent = if (vu) 100 else 0) },
        ) }
        val serieVue = seasons.any { it.episodes.isNotEmpty() }
            && seasons.filter { it.episodes.isNotEmpty() }.all { it.completed }
        state = state.copy(details = details.copy(item = details.item.copy(completed = serieVue), seasons = seasons))
    }

    private fun appliquerSerieVue(vu: Boolean) {
        val details = state.details ?: return
        val seasons = details.seasons.map { saison -> saison.copy(
            completed = vu,
            episodes = saison.episodes.map { it.copy(completed = vu, progressPercent = if (vu) 100 else 0) },
        ) }
        state = state.copy(details = details.copy(
            item = details.item.copy(completed = vu, progressPercent = if (vu) 100 else 0), seasons = seasons,
        ))
    }

    /** Donne un avis sur une recommandation. L'accueil se recharge : le moteur en tient compte. */
    fun recommendationFeedback(media: Media, valeur: String) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        val profile = state.profile ?: return@launch
        val cible = media.catalogId ?: media.id
        runCatching { currentApi.recommendationFeedback(cible, profile.id, valeur) }
            .onSuccess { loadHome(silent = true) }
            .onFailure { state = state.copy(error = it.message) }
    }

    fun search(value: String) {
        state = state.copy(query = value)
        searchJob?.cancel()
        if (value.isBlank()) { state = state.copy(search = emptyList()); return }
        searchJob = viewModelScope.launch {
            delay(250)
            val currentApi = repository.api ?: return@launch
            val profile = state.profile ?: return@launch
            runCatching { currentApi.search(value, profile.id) }
                .onSuccess { state = state.copy(search = it, error = null) }
                .onFailure { state = state.copy(error = it.message) }
        }
    }

    /** Relance uniquement la surface visible après une coupure, sans effacer ce qui est déjà affiché. */
    fun retry(section: String) {
        when (section) {
            "movies", "shows", "web" -> loadCatalog(section, reset = true)
            else -> loadHome(silent = true)
        }
    }

    /**
     * Change un critère de catalogue et repart de la première page.
     *
     * Un seul point d'entrée pour les quatre critères : ils se combinent, et le serveur les applique
     * ensemble. Changer le tri sans vider les fiches déjà reçues laisserait un catalogue trié de deux
     * façons à la fois — les premières pages dans l'ancien ordre, les suivantes dans le nouveau.
     *
     * La recherche est temporisée : chaque lettre frappée déclencherait sinon une requête, et la
     * réponse de l'avant-dernière pourrait arriver après celle de la dernière.
     */
    fun setCatalogCriteria(
        kind: String,
        sort: String? = null,
        filter: String? = null,
        query: String? = null,
        genres: List<String>? = null,
    ) {
        update(kind) { section ->
            section.copy(
                sort = sort ?: section.sort,
                filter = filter ?: section.filter,
                query = query ?: section.query,
                genres = genres ?: section.genres,
                // Une modification explicite des critères revient au catalogue correspondant. Une
                // ancienne ancre alphabétique ne doit pas reprendre la main sur le nouveau résultat.
                letter = null,
                anchor = null,
            )
        }
        criteresJob?.cancel()
        criteresJob = viewModelScope.launch {
            if (query != null) delay(280)
            attendreCatalogueDisponible(kind)
            loadCatalog(kind, reset = true).join()
        }
    }

    /** Saute à une initiale sans charger toutes les pages qui la précèdent. */
    fun setCatalogLetter(kind: String, letter: String?) {
        val section = sectionDe(kind)
        val catalogueCompletEnMemoire = estTelevision && section.loaded && section.offset == 0
            && section.items.size >= section.total && section.sort == "title" && section.filter == "all"
            && section.query.isBlank() && section.genres.isEmpty()
        if (catalogueCompletEnMemoire && !letter.isNullOrBlank()) {
            val cible = letter.uppercase()
            val index = section.items.indexOfFirst { initialePourCatalogue(it.title) == cible }.takeIf { it >= 0 }
                ?: return
            update(kind) { it.copy(sort = "title", letter = cible, anchor = index) }
            return
        }
        update(kind) { it.copy(sort = "title", letter = letter) }
        criteresJob?.cancel()
        criteresJob = viewModelScope.launch {
            // Les répétitions de la télécommande arrivent plus vite qu'une réponse réseau lente. La
            // dernière lettre reste en attente au lieu d'être perdue parce que la précédente charge.
            delay(40)
            attendreCatalogueDisponible(kind)
            loadCatalog(kind, reset = true).join()
        }
    }

    private fun initialePourCatalogue(titre: String): String {
        val normalise = Normalizer.normalize(titre, Normalizer.Form.NFD)
            .replace(Regex("\\p{M}+"), "").trim().uppercase()
        return normalise.firstOrNull()?.takeIf { it in 'A'..'Z' }?.toString() ?: "#"
    }

    private suspend fun attendreCatalogueDisponible(kind: String) {
        while ((sectionDe(kind)).loading) delay(25)
    }

    /**
     * Charge la page suivante d'une section de catalogue.
     *
     * L'accueil ne transmet plus que les premières fiches : sur une médiathèque de plusieurs milliers
     * de titres, tout envoyer d'un bloc représentait près d'un mégaoctet à chaque ouverture.
     */
    /**
     * Ce que le serveur dit de la télévision en direct, et les filtres qui vont avec.
     *
     * Un serveur plus ancien ignore ces routes : l'échec vaut « non disponible », ce qui est aussi
     * l'état d'une installation qui ne s'en sert pas. Les filtres ne sont demandés que si la réponse
     * est oui — trois requêtes de plus au démarrage pour une fonction éteinte n'auraient aucun sens.
     */
    private suspend fun chargerDirect(api: FlixTunesApi, profileId: String) {
        state = state.copy(webDisponible = api.etatWeb(profileId))
        val etat = runCatching { api.etatDirect(profileId) }.getOrNull()
        if (etat?.disponible != true) { state = state.copy(direct = SectionDirect(disponible = false)); return }
        /*
         * **On complète la section, on ne la refait pas.**
         *
         * Elle était reconstruite à neuf à chaque retour d'une chaîne : la grille repartait vide, les
         * cases se décochaient, et l'écran annonçait « 0 chaîne » là où il y en avait une minute plus
         * tôt. Relevé sur téléviseur. Ce qui doit être rafraîchi, ce sont les facettes et la dernière
         * chaîne regardée ; ce qui doit rester, c'est ce que la personne avait choisi et parcouru.
         *
         * Le profil garde son droit de veto : ses favorites et sa dernière chaîne sont les siennes, et
         * une grille bâtie pour quelqu'un d'autre se recharge plutôt que de mentir.
         */
        val ancienne = state.direct?.takeIf { it.disponible && it.profileId == profileId }
        val listes = runCatching {
            api.listesDirect(profileId, ancienne?.paysChoisis.orEmpty(),
                ancienne?.fiabilitesChoisies.orEmpty(), ancienne?.query.orEmpty())
        }.getOrDefault(emptyList())
        val pays = runCatching {
            api.paysDirect(profileId, ancienne?.listesChoisies.orEmpty(),
                ancienne?.fiabilitesChoisies.orEmpty(), ancienne?.query.orEmpty())
        }.getOrDefault(emptyList())
        val fiabilites = runCatching { api.fiabilitesDirect(profileId) }.getOrDefault(emptyList())
        val derniere = api.derniereChaineDirect(profileId)
        state = state.copy(direct = (ancienne ?: SectionDirect()).copy(
            disponible = true, profileId = profileId,
            listes = listes, pays = pays, fiabilites = fiabilites, derniere = derniere,
        ))
    }

    /**
     * Recompter les facettes sous les filtres cochés.
     *
     * Elles étaient comptées une fois au démarrage, sur le corpus entier : l'écran promettait
     * « France 1 355 » alors qu'une playlist déjà cochée n'en contenait aucune, on cochait, et on
     * tombait sur zéro. Chacune ignore son propre critère — sinon cocher France ne laisserait plus
     * voir que la France.
     *
     * Mesuré côté serveur sur 92 204 chaînes : 18,3 ms pour les pays sous une playlist, soit moins
     * que les 24,5 ms de l'ancien compte global, qui parcourait tout. Filtrer réduit le travail.
     */
    private fun recompterLesFacettes() = viewModelScope.launch {
        val courantApi = repository.api ?: return@launch
        val profileId = state.profile?.id ?: return@launch
        val section = state.direct ?: return@launch
        val listes: List<ListeDirect>? = runCatching {
            courantApi.listesDirect(profileId, section.paysChoisis, section.fiabilitesChoisies, section.query)
        }.getOrNull()
        val pays: List<PaysDirect>? = runCatching {
            courantApi.paysDirect(profileId, section.listesChoisies, section.fiabilitesChoisies, section.query)
        }.getOrNull()
        val courante = state.direct ?: return@launch
        state = state.copy(direct = courante.copy(
            listes = listes ?: courante.listes,
            pays = pays ?: courante.pays,
        ))
    }

    /**
     * Une page de la grille des chaînes.
     *
     * `reset` reprend depuis le début : c'est ce que fait tout changement de recherche ou de filtre.
     * Sans lui, la nouvelle page s'ajouterait à l'ancienne et la grille mélangerait deux critères.
     */
    fun chargerChaines(reset: Boolean = false) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        val profile = state.profile ?: return@launch
        val section = state.direct ?: return@launch
        if (!section.disponible || section.loading) return@launch
        if (!reset && section.loaded && !section.hasMore) return@launch
        state = state.copy(direct = section.copy(loading = true))
        runCatching {
            currentApi.chainesDirect(profile.id, if (reset) 0 else section.items.size, taillePageDirect,
                query = section.query, listes = section.listesChoisies,
                pays = section.paysChoisis, fiabilites = section.fiabilitesChoisies,
                favoris = section.favorisSeuls, masquerMortes = section.masquerMortes)
        }
            .onSuccess { page ->
                val courante = state.direct ?: return@onSuccess
                // Une réponse lancée pour un critère peut arriver après qu'on en a changé : elle ne
                // doit pas repeupler la grille avec ce qu'on ne demande plus.
                if (courante.query != section.query || courante.listesChoisies != section.listesChoisies ||
                    courante.paysChoisis != section.paysChoisis || courante.fiabilitesChoisies != section.fiabilitesChoisies ||
                    courante.favorisSeuls != section.favorisSeuls || courante.masquerMortes != section.masquerMortes) {
                    state = state.copy(direct = courante.copy(loading = false)); return@onSuccess
                }
                val connues = if (reset) emptySet() else courante.items.mapTo(mutableSetOf()) { it.id }
                val base = if (reset) emptyList() else courante.items
                state = state.copy(direct = courante.copy(
                    items = base + page.items.filterNot { it.id in connues },
                    total = page.total, loading = false, loaded = true))
            }
            .onFailure { failure ->
                state = state.copy(direct = (state.direct ?: section).copy(loading = false), error = failure.message)
            }
    }

    /** Un critère changé repart de la première page : c'est une autre grille, pas la suite de celle-ci. */
    fun filtrerDirect(
        query: String? = null, listes: List<String>? = null,
        pays: List<String>? = null, fiabilites: List<String>? = null,
        favorisSeuls: Boolean? = null, masquerMortes: Boolean? = null,
    ) {
        val section = state.direct ?: return
        state = state.copy(direct = section.copy(
            query = query ?: section.query,
            listesChoisies = listes ?: section.listesChoisies,
            paysChoisis = pays ?: section.paysChoisis,
            fiabilitesChoisies = fiabilites ?: section.fiabilitesChoisies,
            favorisSeuls = favorisSeuls ?: section.favorisSeuls,
            masquerMortes = masquerMortes ?: section.masquerMortes,
        ))
        chargerChaines(reset = true)
        recompterLesFacettes()
    }

    /**
     * L'étoile bascule à l'écran d'abord, et se confirme ensuite.
     *
     * Attendre le serveur pour repeindre une étoile ferait clignoter la grille sur un geste qui ne
     * peut presque pas échouer. En cas de refus, elle revient comme elle était.
     */
    fun basculerFavoriDirect(chaine: ChaineDirect) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        val profile = state.profile ?: return@launch
        val voulu = !chaine.favori
        peindreFavori(chaine.id, voulu)
        runCatching { currentApi.favoriDirect(profile.id, chaine.id, voulu) }
            .onFailure { peindreFavori(chaine.id, !voulu) }
    }

    private fun peindreFavori(channelId: String, favori: Boolean) {
        val section = state.direct ?: return
        state = state.copy(direct = section.copy(
            items = section.items.map { if (it.id == channelId) it.copy(favori = favori) else it },
        ))
    }

    fun loadCatalog(kind: String, reset: Boolean = false) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        val profile = state.profile ?: return@launch
        val section = sectionDe(kind)
        if (section.loading) return@launch
        if (!reset && section.loaded && !section.hasMore) return@launch
        val offset = if (reset) 0 else section.offset + section.items.size
        update(kind) { it.copy(loading = true) }
        runCatching {
            currentApi.catalog(profile.id, kind, offset, taillePageCatalogue,
                sort = section.sort, query = section.query, filter = section.filter, genres = section.genres,
                // La lettre ne sert qu'à calculer le point d'entrée de la première page. La suite
                // reprend sa pagination absolue normale et ne filtre donc jamais le catalogue.
                letter = if (reset) section.letter else null)
        }
            .onSuccess { page ->
                update(kind) { current ->
                    // Une réponse lancée pour B peut arriver après que le maintien a déjà sélectionné
                    // C. Elle ne doit ni déplacer la grille vers B, ni mélanger deux tris/filtres.
                    val toujoursDemandee = current.sort == section.sort && current.filter == section.filter &&
                        current.query == section.query && current.genres == section.genres &&
                        current.letter == section.letter
                    if (!toujoursDemandee) return@update current.copy(loading = false)
                    // Une analyse en cours peut décaler les rangs d'une page à l'autre : on écarte les
                    // doublons plutôt que d'afficher deux fois la même affiche.
                    val known = if (reset) emptySet() else current.items.mapTo(mutableSetOf()) { media -> media.id }
                    val base = if (reset) emptyList() else current.items
                    current.copy(items = base + page.items.filterNot { media -> media.id in known },
                        total = page.total, offset = if (reset) page.offset else current.offset,
                        anchor = if (reset) page.anchor else current.anchor,
                        loading = false, loaded = true,
                        // Les genres sont établis sur le catalogue entier ; une réponse qui n'en
                        // porte pas — filtre trop étroit, serveur ancien — ne doit pas vider la liste
                        // des choix, sans quoi le filtre disparaîtrait au moment où l'on s'en sert.
                        availableGenres = page.availableGenres.ifEmpty { current.availableGenres })
                }
            }
            .onFailure { failure ->
                update(kind) { it.copy(loading = false) }
                state = state.copy(error = failure.message)
            }
    }

    /**
     * Recharge les titres placés avant la fenêtre courante.
     *
     * Après un saut A–Z, la cible est entourée d'une page légère. Lorsque l'on remonte vers son début,
     * les pages précédentes sont préfixées ; la grille reste donc le catalogue complet, jamais un
     * filtre déguisé.
     */
    fun loadPreviousCatalog(kind: String) = viewModelScope.launch {
        val currentApi = repository.api ?: return@launch
        val profile = state.profile ?: return@launch
        val section = sectionDe(kind)
        if (section.loading || !section.hasPrevious) return@launch
        val pageLimit = section.offset.coerceAtMost(taillePageCatalogue)
        val pageOffset = section.offset - pageLimit
        update(kind) { it.copy(loading = true) }
        runCatching {
            currentApi.catalog(profile.id, kind, pageOffset, pageLimit,
                sort = section.sort, query = section.query, filter = section.filter, genres = section.genres)
        }
            .onSuccess { page ->
                update(kind) { current ->
                    val toujoursDemandee = current.sort == section.sort && current.filter == section.filter &&
                        current.query == section.query && current.genres == section.genres &&
                        current.letter == section.letter
                    if (!toujoursDemandee) return@update current.copy(loading = false)
                    val known = current.items.mapTo(mutableSetOf()) { media -> media.id }
                    current.copy(
                        items = page.items.filterNot { media -> media.id in known } + current.items,
                        total = page.total,
                        offset = page.offset,
                        loading = false,
                        loaded = true,
                        availableGenres = page.availableGenres.ifEmpty { current.availableGenres },
                    )
                }
            }
            .onFailure { failure ->
                update(kind) { it.copy(loading = false) }
                state = state.copy(error = failure.message)
            }
    }

    /** L'ancre est une commande ponctuelle : la consommer empêche qu'un retour de fiche la rejoue. */
    fun consumeCatalogAnchor(kind: String) = update(kind) { it.copy(anchor = null) }

    /**
     * La section que désigne une clé de rayon.
     *
     * Elle était lue par un `if` recopié à quatre endroits. Ajouter un rayon obligeait à les retrouver
     * tous, et l'oubli d'un seul n'aurait rien signalé : la page Web se serait simplement remplie
     * avec les séries.
     */
    private fun sectionDe(kind: String): CatalogSection = when (kind) {
        "movies" -> state.movies
        "web" -> state.web
        else -> state.shows
    }

    private fun update(kind: String, transform: (CatalogSection) -> CatalogSection) {
        state = when (kind) {
            "movies" -> state.copy(movies = transform(state.movies))
            "web" -> state.copy(web = transform(state.web))
            else -> state.copy(shows = transform(state.shows))
        }
    }

    fun image(path: String?) = repository.api?.absolute(path)
    fun profileAccessToken() = repository.api?.profileAccessToken()
}
