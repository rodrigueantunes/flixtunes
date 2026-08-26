package tv.flixtunes.app.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Ce que le serveur envoyait et que le client Android jetait.
 *
 * `/api/home` porte depuis longtemps la liste d'envies, les recommandations locales et l'activité
 * récente — le client Web en fait trois rails. `parseHome` ne les lisait pas : la donnée traversait le
 * réseau pour être perdue à l'analyse, et l'accueil Android montrait cinq rails là où le Web en montre
 * huit. Même chose sur la fiche, qui recevait les qualités et les versions sans jamais les exposer.
 *
 * Ces tests ancrent la correspondance : ils échouent si un champ redevient muet.
 */
class AccueilCompletTest {
    private fun media(id: String, extra: JSONObject.() -> Unit = {}) = JSONObject()
        .put("id", id).put("catalogId", "catalog-$id").put("kind", "movie").put("title", "Titre $id")
        .apply(extra)

    private fun tableau(vararg objets: JSONObject) = objets.fold(JSONArray()) { array, item -> array.put(item) }

    private fun accueil(vararg extra: Pair<String, Any>) = JSONObject().apply {
        put("profile", JSONObject().put("id", "p1").put("name", "Principal").put("avatarColor", "#2968ff"))
        put("movies", JSONArray())
        put("shows", JSONArray())
        extra.forEach { (cle, valeur) -> put(cle, valeur) }
    }

    @Test
    fun `la liste d'envies arrive jusqu'au rail`() {
        val analyse = parseHome(accueil("watchlist" to tableau(media("a"), media("b"))))
        assertEquals(listOf("a", "b"), analyse.watchlist.map { it.id })
    }

    @Test
    fun `les recommandations conservent leur motif`() {
        // Le motif est ce qui distingue une recommandation d'un rail ordinaire : sans lui, la section
        // « Sélection pour X » n'est qu'une liste de plus, et rien n'explique pourquoi ces titres-là.
        val proposition = JSONObject()
            .put("item", media("c")).put("score", 0.82).put("reason", "Parce que vous avez vu Arrival")
        val analyse = parseHome(accueil("recommendations" to tableau(proposition)))
        assertEquals(1, analyse.recommendations.size)
        assertEquals("c", analyse.recommendations.first().item.id)
        assertEquals("Parce que vous avez vu Arrival", analyse.recommendations.first().reason)
        assertEquals(0.82, analyse.recommendations.first().score, 0.001)
    }

    @Test
    fun `l'activité récente alimente l'écran Historique`() {
        val analyse = parseHome(accueil("watchedRecently" to tableau(media("d"))))
        assertEquals(listOf("d"), analyse.watchedRecently.map { it.id })
    }

    @Test
    fun `un accueil sans ces sections ne casse rien`() {
        // Un serveur plus ancien que l'application ne les envoie pas. Les listes doivent alors être
        // vides, jamais nulles : un rail vide ne s'affiche pas, une liste nulle ferait tomber l'écran.
        val analyse = parseHome(accueil())
        assertTrue(analyse.watchlist.isEmpty())
        assertTrue(analyse.recommendations.isEmpty())
        assertTrue(analyse.watchedRecently.isEmpty())
    }

    @Test
    fun `la fiche expose ses qualités et ses versions`() {
        val fiche = JSONObject()
            .put("item", media("film"))
            .put("seasons", JSONArray())
            .put("related", JSONArray())
            .put("qualities", JSONArray().put("4K").put("HDR10").put("HEVC"))
            .put("versions", tableau(
                JSONObject().put("mediaId", "v1").put("name", "Film.2016.2160p.mkv")
                    .put("quality", "2160p HDR10 HEVC").put("fileSizeBytes", 42_949_672_960L),
                JSONObject().put("mediaId", "v2").put("name", "Film.2016.1080p.mkv")
                    .put("quality", "1080p H.264").put("fileSizeBytes", JSONObject.NULL),
            ))
        val analyse = parseDetails(fiche)
        assertEquals(listOf("4K", "HDR10", "HEVC"), analyse.qualities)
        assertEquals(listOf("v1", "v2"), analyse.versions.map { it.mediaId })
        assertEquals(42_949_672_960L, analyse.versions.first().fileSizeBytes)
        // Une taille absente reste absente : afficher « 0 Mo » ferait croire à un fichier vide.
        assertEquals(null, analyse.versions[1].fileSizeBytes)
    }

    @Test
    fun `une saison porte son résumé`() {
        val fiche = JSONObject()
            .put("item", media("serie"))
            .put("related", JSONArray())
            .put("seasons", tableau(
                JSONObject().put("id", "s1").put("number", 1).put("title", "Saison 1")
                    .put("overview", "Le début de tout").put("episodes", JSONArray()),
            ))
        val analyse = parseDetails(fiche)
        assertEquals("Le début de tout", analyse.seasons.first().overview)
    }

    @Test
    fun `la liste d'envies est lisible sur une fiche`() {
        val fiche = JSONObject()
            .put("item", media("film") { put("inWatchlist", true) })
            .put("seasons", JSONArray()).put("related", JSONArray())
        assertTrue(parseDetails(fiche).item.inWatchlist)
        val autre = JSONObject()
            .put("item", media("film")).put("seasons", JSONArray()).put("related", JSONArray())
        assertFalse(parseDetails(autre).item.inWatchlist)
    }

    @Test
    fun `les genres du catalogue viennent du serveur`() {
        // Ils sont calculés sur le catalogue entier : les déduire de la page affichée ferait
        // disparaître un choix dès qu'on tourne la page.
        val page = JSONObject()
            .put("items", tableau(media("a"))).put("total", 900).put("offset", 0).put("limit", 60)
            .put("availableGenres", JSONArray().put("Action").put("Comédie"))
        assertEquals(listOf("Action", "Comédie"), parseCatalogPage(page).availableGenres)
    }
}
