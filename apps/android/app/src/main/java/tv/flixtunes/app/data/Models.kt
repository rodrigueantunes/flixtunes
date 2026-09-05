package tv.flixtunes.app.data

import androidx.compose.runtime.Immutable
import org.json.JSONArray
import org.json.JSONObject

data class Profile(
    val id: String, val groupId: String, val name: String, val avatarColor: String, val language: String,
    val protected: Boolean, val isChild: Boolean = false, val age: Int? = null,
    val preferredAudioLanguages: List<String> = emptyList(), val preferredSubtitleLanguages: List<String> = emptyList(),
    /** « off », « forced » ou « always ». Le serveur retient « forced » à défaut, et le client aussi. */
    val subtitleMode: String = "forced",
    val audioOutputMode: String = "auto", val audioNormalization: Boolean = false, val nightMode: Boolean = false,
    val dynamicRangePriority: String = "auto",
    val resumeMode: String = "continue", val resumeRewindSeconds: Int = 5, val defaultPlaybackRate: Float = 1f,
    val autoplayNext: Boolean = true, val autoplayLimit: Int = 3,
)

@Immutable
data class ProfileGroup(val id: String, val name: String)

/** Les seuls champs envoyés par le centre de réglages de lecture. */
internal fun Profile.playbackPreferencesJson(): JSONObject = JSONObject()
    .put("preferredAudioLanguages", JSONArray(preferredAudioLanguages))
    .put("preferredSubtitleLanguages", JSONArray(preferredSubtitleLanguages))
    .put("subtitleMode", subtitleMode)
    .put("audioOutputMode", audioOutputMode)
    .put("audioNormalization", audioNormalization)
    .put("nightMode", nightMode)
    .put("dynamicRangePriority", dynamicRangePriority)
    .put("resumeMode", resumeMode)
    .put("resumeRewindSeconds", resumeRewindSeconds)
    .put("defaultPlaybackRate", defaultPlaybackRate.toDouble())
    .put("autoplayNext", autoplayNext)
    .put("autoplayLimit", autoplayLimit)

/**
 * Une date `AAAA-MM-JJ` rendue lisible, ou `null` si elle n'en est pas une.
 *
 * Volontairement sans dépendance de formatage : trois nombres et une table de mois se lisent d'un
 * coup d'œil, là où un formateur de plateforme impose une locale, un fuseau et un piège — celui de
 * décaler la veille une date qui n'a pas d'heure.
 */
private val MOIS = listOf(
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
)

internal fun dateLisible(valeur: String?): String? {
    val trouve = Regex("""^(\d{4})-(\d{2})-(\d{2})""").find(valeur ?: return null) ?: return null
    val (annee, mois, jour) = trouve.destructured
    val nom = MOIS.getOrNull(mois.toInt() - 1) ?: return null
    return "${jour.toInt()} $nom $annee"
}

@Immutable
data class Media(
    val id: String,
    val catalogId: String?,
    val playableMediaId: String?,
    val kind: String,
    val title: String,
    val year: Int?,
    val overview: String?,
    val posterUrl: String?,
    val backdropUrl: String?,
    val showTitle: String?,
    val seasonNumber: Int?,
    val episodeNumber: Int?,
    val runtimeSeconds: Int?,
    val progressPercent: Int,
    val completed: Boolean,
    val seasonCount: Int? = null,
    /** Vrai quand la fiche figure dans la liste d'envies du profil. Sert au bouton « Ma liste ». */
    val inWatchlist: Boolean = false,
    /** Seconde exacte enregistrée ; le pourcentage n'est conservé que pour l'affichage/compatibilité. */
    val progressPositionSeconds: Double? = null,
    val progressDurationSeconds: Double? = null,
    val ageRating: Int? = null,
    val ratingLabel: String? = null,
    /**
     * Date de publication, `AAAA-MM-JJ`, pour une vidéo de plateforme.
     *
     * C'est à la fois son critère de tri et ce qui s'affiche sous son titre. Absente ailleurs.
     */
    val airDate: String? = null,
) {
    // Ces libellés sont lus à chaque recomposition d'une jaquette pendant le défilement. Les calculer
    // une fois avec le modèle évite de recréer des chaînes pour chaque image rendue, sans changer l'API.
    val displayTitle: String = showTitle ?: title
    val secondaryText: String = when (kind) {
        "episode" -> "S${seasonNumber ?: 0} · E${episodeNumber ?: 0}"
        "show" -> "${seasonCount ?: 0} saison${if ((seasonCount ?: 0) > 1) "s" else ""}"
        // Une vidéo de plateforme n'a ni saison ni numéro : elle se présente par sa date. Faute de
        // date connue, elle ne s'invente pas — le mot « Vidéo » dit ce qu'on sait, c'est-à-dire peu.
        "video" -> dateLisible(airDate) ?: "Vidéo"
        else -> year?.toString() ?: "Film"
    }
}

/** Une proposition du moteur local, avec le motif qui la justifie. */
data class Recommandation(val item: Media, val score: Double, val reason: String)

@Immutable
data class Home(
    val profile: Profile,
    val featured: Media?,
    val continueWatching: List<Media>,
    val recentlyAdded: List<Media>,
    /** Première page seulement : le catalogue entier se demande à `/api/catalog`. */
    val movies: List<Media>,
    val shows: List<Media>,
    val completed: List<Media>,
    /**
     * Les trois listes que le serveur envoyait déjà et qu'aucun écran Android ne lisait.
     *
     * `/api/home` les renvoie depuis que le Web les affiche — liste d'envies, recommandations locales
     * et activité récente. `parseHome` les ignorait : la donnée traversait le réseau pour être jetée,
     * et l'accueil Android montrait cinq rails là où le Web en montre huit.
     */
    val watchlist: List<Media> = emptyList(),
    val recommendations: List<Recommandation> = emptyList(),
    val watchedRecently: List<Media> = emptyList(),
    /** Nombre total de fiches disponibles, toutes pages confondues. */
    val movieTotal: Int = 0,
    val showTotal: Int = 0,
)

/** Une tranche de catalogue. `total` porte sur le tri et le filtre demandés, pas sur la page reçue. */
@Immutable
data class CatalogPage(
    val items: List<Media>, val total: Int, val offset: Int, val limit: Int,
    /** Rang absolu de la jaquette visée par l'index A–Z, si la réponse vient d'un saut. */
    val anchor: Int? = null,
    /**
     * Les genres présents dans tout le catalogue, pas seulement dans la page reçue.
     *
     * Les calculer sur la page ferait disparaître un choix dès qu'on tourne la page — le serveur les
     * établit donc sur l'ensemble, et le client se contente de les présenter.
     */
    val availableGenres: List<String> = emptyList(),
)

data class Season(
    val id: String, val number: Int, val title: String, val posterUrl: String?, val episodes: List<Media>,
    /** Le résumé de la saison, affiché sous la jaquette comme dans le client Web. */
    val overview: String? = null,
    val completed: Boolean = false,
) {
    /**
     * Ce palier est-il un dossier de chaîne plutôt qu'une saison ?
     *
     * Une chaîne web est stockée comme une série — c'est ce qui lui donne la fiche, la reprise et
     * l'enchaînement sans code neuf. Rien dans la forme ne la distingue donc, et la fiche annonçait
     * « Afficher la saison 3 » là où le palier s'appelle « Documentaires », avec « 5 épisodes » pour
     * cinq vidéos. Le contenu tranche : un palier qui ne contient que des vidéos est un dossier.
     */
    val estDossier: Boolean = episodes.isNotEmpty() && episodes.all { it.kind == "video" }
}
data class SourceDetails(val kind: String, val name: String)

data class PersonCredit(
    val id: String, val name: String, val profileUrl: String?, val role: String,
    val character: String?, val job: String?, val order: Int,
)

data class CollectionDetails(val id: String, val name: String, val items: List<Media>)

data class PersonDetails(
    val person: PersonIdentity,
    val items: List<Media>,
    val roles: List<PersonRole>,
)
data class PersonIdentity(val id: String, val name: String, val profileUrl: String?)
data class PersonRole(val catalogId: String, val role: String, val character: String?, val job: String?)

/** Un fichier physique parmi les versions d'une même œuvre. Le catalogue n'en montre qu'une fiche. */
data class SourceVersion(val mediaId: String, val name: String, val quality: String?, val fileSizeBytes: Long?)

@Immutable
data class Details(
    val item: Media, val seasons: List<Season>, val related: List<Media>, val source: SourceDetails? = null,
    /** Résolution, plage dynamique et codec réellement observés dans les fichiers. */
    val qualities: List<String> = emptyList(),
    /** Les fichiers d'un même film, quand il en existe plusieurs. Vide sinon. */
    val versions: List<SourceVersion> = emptyList(),
    /** Permet d'ouvrir la correction de correspondance depuis la fiche, comme le fait le Web. */
    val libraryId: String? = null,
    /** Chargés avec la fiche uniquement : aucun coût pour l'accueil ou les grilles. */
    val people: List<PersonCredit> = emptyList(),
    val genres: List<String> = emptyList(),
    val collection: CollectionDetails? = null,
)
data class PlaybackSession(val id: String?, val mode: String, val status: String, val url: String?, val error: String?,
    /** Perte colorimétrique annoncée par le serveur avant la lecture, ou null si la chaîne est fidèle. */
    val colorLossNotice: String? = null,
    val sourceDynamicRange: String? = null,
    val outputDynamicRange: String? = null,
    /** Point du film où cette session commence, en secondes. Zéro en lecture directe. */
    val startOffsetSeconds: Double = 0.0,
    /** Ce que le serveur a décidé, et pourquoi — affiché tel quel dans « Infos lecture ». */
    val decisionReasons: List<String> = emptyList(),
    val targetWidth: Int? = null, val targetHeight: Int? = null, val targetVideoBitrate: Int? = null)

internal fun JSONObject.stringOrNull(name: String): String? = if (isNull(name)) null else optString(name).takeIf { it.isNotBlank() }
internal fun JSONObject.intOrNull(name: String): Int? = if (isNull(name) || !has(name)) null else optInt(name)
internal fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

fun parseProfile(json: JSONObject) = Profile(
    id = json.getString("id"), groupId = json.optString("groupId"),
    name = json.getString("name"), avatarColor = json.getString("avatarColor"),
    language = json.optString("language", "fr-FR"), protected = json.optBoolean("protected"),
    isChild = json.optBoolean("isChild"), age = json.intOrNull("age"),
    preferredAudioLanguages = json.optJSONArray("preferredAudioLanguages")
        ?.let { array -> (0 until array.length()).map(array::getString) }.orEmpty(),
    preferredSubtitleLanguages = json.optJSONArray("preferredSubtitleLanguages")
        ?.let { array -> (0 until array.length()).map(array::getString) }.orEmpty(),
    subtitleMode = json.optString("subtitleMode", "forced"), audioOutputMode = json.optString("audioOutputMode", "auto"),
    audioNormalization = json.optBoolean("audioNormalization"), nightMode = json.optBoolean("nightMode"),
    dynamicRangePriority = json.optString("dynamicRangePriority", "auto"),
    resumeMode = json.optString("resumeMode", "continue"), resumeRewindSeconds = json.optInt("resumeRewindSeconds", 5),
    defaultPlaybackRate = json.optDouble("defaultPlaybackRate", 1.0).toFloat(),
    autoplayNext = json.optBoolean("autoplayNext", true), autoplayLimit = json.optInt("autoplayLimit", 3),
)

fun parseProfileGroup(json: JSONObject) = ProfileGroup(json.getString("id"), json.getString("name"))

fun parseMedia(json: JSONObject) = Media(
    id = json.getString("id"), catalogId = json.stringOrNull("catalogId"), playableMediaId = json.stringOrNull("playableMediaId"),
    kind = json.getString("kind"), title = json.getString("title"), year = json.intOrNull("year"), overview = json.stringOrNull("overview"),
    posterUrl = json.stringOrNull("posterUrl"), backdropUrl = json.stringOrNull("backdropUrl"), showTitle = json.stringOrNull("showTitle"),
    seasonNumber = json.intOrNull("seasonNumber"), episodeNumber = json.intOrNull("episodeNumber"), runtimeSeconds = json.intOrNull("runtimeSeconds"),
    progressPercent = json.optInt("progressPercent"), completed = json.optBoolean("completed"), seasonCount = json.intOrNull("seasonCount"),
    inWatchlist = json.optBoolean("inWatchlist"),
    progressPositionSeconds = json.optDouble("progressPositionSeconds").takeIf { json.has("progressPositionSeconds") && it.isFinite() && it >= 0.0 },
    progressDurationSeconds = json.optDouble("progressDurationSeconds").takeIf { json.has("progressDurationSeconds") && it.isFinite() && it > 0.0 },
    ageRating = json.intOrNull("ageRating"), ratingLabel = json.stringOrNull("ratingLabel"),
    airDate = json.stringOrNull("airDate"),
)

private fun mediaList(json: JSONObject, name: String) = json.optJSONArray(name)?.objects()?.map(::parseMedia).orEmpty()
fun parseHome(json: JSONObject): Home {
    val movies = mediaList(json, "movies")
    val shows = mediaList(json, "shows")
    return Home(
        parseProfile(json.getJSONObject("profile")), json.optJSONObject("featured")?.let(::parseMedia),
        mediaList(json, "continueWatching"), mediaList(json, "recentlyAdded"), movies, shows, mediaList(json, "completed"),
        watchlist = mediaList(json, "watchlist"),
        recommendations = json.optJSONArray("recommendations")?.objects()?.map { entry ->
            Recommandation(parseMedia(entry.getJSONObject("item")), entry.optDouble("score", 0.0),
                entry.optString("reason"))
        }.orEmpty(),
        watchedRecently = mediaList(json, "watchedRecently"),
        // Un serveur antérieur à la pagination n'annonce aucun total : la page reçue est alors tout
        // le catalogue, et c'est bien ce nombre-là qu'il faut afficher.
        movieTotal = json.optInt("movieTotal", movies.size), showTotal = json.optInt("showTotal", shows.size),
    )
}

fun parseCatalogPage(json: JSONObject) = CatalogPage(
    mediaList(json, "items"), json.optInt("total"), json.optInt("offset"), json.optInt("limit", 60),
    anchor = if (json.has("anchor") && !json.isNull("anchor")) json.getInt("anchor") else null,
    availableGenres = json.optJSONArray("availableGenres")
        ?.let { array -> (0 until array.length()).map(array::getString) }.orEmpty(),
)

fun parseDetails(json: JSONObject) = Details(
    parseMedia(json.getJSONObject("item")),
    json.optJSONArray("seasons")?.objects()?.map { season -> Season(
        season.getString("id"), season.getInt("number"), season.getString("title"), season.stringOrNull("posterUrl"),
        season.optJSONArray("episodes")?.objects()?.map(::parseMedia).orEmpty(),
        season.stringOrNull("overview"), season.optBoolean("completed", false),
    ) }.orEmpty(),
    mediaList(json, "related"),
    json.optJSONObject("source")?.let { source -> SourceDetails(source.getString("kind"), source.getString("name")) },
    qualities = json.optJSONArray("qualities")
        ?.let { array -> (0 until array.length()).map(array::getString) }.orEmpty(),
    versions = json.optJSONArray("versions")?.objects()?.map { version -> SourceVersion(
        version.getString("mediaId"), version.getString("name"), version.stringOrNull("quality"),
        if (version.isNull("fileSizeBytes")) null else version.optLong("fileSizeBytes"),
    ) }.orEmpty(),
    libraryId = json.getJSONObject("item").stringOrNull("libraryId"),
    people = json.optJSONArray("people")?.objects()?.map { person -> PersonCredit(
        person.getString("id"), person.getString("name"), person.stringOrNull("profileUrl"),
        person.getString("role"), person.stringOrNull("character"), person.stringOrNull("job"), person.optInt("order"),
    ) }.orEmpty(),
    genres = json.optJSONArray("genres")?.let { array -> (0 until array.length()).map(array::getString) }.orEmpty(),
    collection = json.optJSONObject("collection")?.let { collection -> CollectionDetails(
        collection.getString("id"), collection.getString("name"), mediaList(collection, "items"),
    ) },
)

fun parsePersonDetails(json: JSONObject): PersonDetails {
    val person = json.getJSONObject("person")
    return PersonDetails(
        PersonIdentity(person.getString("id"), person.getString("name"), person.stringOrNull("profileUrl")),
        mediaList(json, "items"),
        json.optJSONArray("roles")?.objects()?.map { role -> PersonRole(
            role.getString("catalogId"), role.getString("role"), role.stringOrNull("character"), role.stringOrNull("job"),
        ) }.orEmpty(),
    )
}

fun parsePlaybackSession(json: JSONObject) = PlaybackSession(
    json.stringOrNull("id"), json.getString("mode"), json.getString("status"), json.stringOrNull("url"), json.stringOrNull("error"),
    json.optJSONObject("colorPipeline")?.stringOrNull("lossNotice"),
    json.optJSONObject("colorPipeline")?.stringOrNull("sourceFormat"),
    json.optJSONObject("colorPipeline")?.stringOrNull("outputFormat"),
    json.optDouble("startOffsetSeconds", 0.0),
    json.optJSONArray("decisionReasons")?.let { a -> (0 until a.length()).map(a::getString) }.orEmpty(),
    json.intOrNull("targetWidth"), json.intOrNull("targetHeight"), json.intOrNull("targetVideoBitrate"),
)

/* ------------------------------------------------------------------------ */
/* La télévision en direct                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Une chaîne, telle que la grille l'affiche.
 *
 * `adresses` n'est pas un détail de plomberie : c'est la **profondeur du repli**. Une chaîne reprise
 * dans onze listes a onze chances de répondre, et le corpus mesuré en compte 57 % de doublons.
 */
data class ChaineDirect(
    val id: String,
    val nom: String,
    val numero: Int?,
    val logo: String?,
    val groupe: String?,
    val pays: String?,
    val etat: String,
    val adresses: Int,
    /** Retenue par ce profil. Vingt chaînes sur 76 823 : c'est le vrai usage d'une grille pareille. */
    val favori: Boolean = false,
)

data class PageChaines(val items: List<ChaineDirect>, val total: Int, val offset: Int, val limit: Int)

/** Une adresse d'une chaîne, et son doublon relayé par le serveur — dont Android ne se sert pas. */
/**
 * Une adresse de la chaîne, avec ce que le serveur en sait.
 *
 * `hauteur` et `debit` sont lus dans le manifeste par le serveur, pas ici : c'est lui qui classe les
 * sources, et refaire la mesure de son côté reviendrait à tenir deux avis sur la même question.
 * `null` tant qu'elle n'a pas été sondée — la première ouverture d'une chaîne ne les connaît pas.
 */
data class SourceChaine(
    val url: String,
    val succes: Int,
    val echecs: Int,
    val hauteur: Int? = null,
    val debit: Int? = null,
    /**
     * Ce qui distingue deux adresses **pour l'œil** : l'hôte et le chemin, sans la requête.
     *
     * Calculée par le serveur, pour que les deux clients regroupent de la même façon. C'est une
     * empreinte d'affichage, pas d'équivalence : le repli parcourt toujours chaque adresse.
     */
    val empreinte: String = "",
)

data class ChaineDetaillee(val chaine: ChaineDirect, val sources: List<SourceChaine>)

/** Une liste de lecture proposée au filtre, avec son effectif et sa fiabilité mesurée. */
data class ListeDirect(val id: String, val nom: String, val classement: String, val chaines: Int)

data class PaysDirect(val code: String, val nom: String, val chaines: Int)

data class FiabiliteDirect(val classement: String, val listes: Int)

/** Ce qu'un client demande avant d'afficher quoi que ce soit : l'entrée « Direct » doit-elle exister ? */
data class EtatDirectClient(val disponible: Boolean, val chaines: Int)
