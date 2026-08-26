package tv.flixtunes.app.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.flixtunes.app.CatalogSection

/**
 * L'accueil ne transmet plus tout le catalogue mais une première page accompagnée des totaux. Un
 * serveur plus ancien que l'application n'annonce aucun total : l'application doit alors considérer la
 * page reçue comme le catalogue entier, faute de quoi elle afficherait « 0 titre » sur une médiathèque
 * pleine et proposerait indéfiniment de charger une suite qui n'existe pas.
 */
class CatalogPaginationTest {
    private fun media(id: String) = JSONObject()
        .put("id", id).put("catalogId", "catalog-$id").put("kind", "movie").put("title", "Titre $id")

    private fun home(vararg extra: Pair<String, Any>) = JSONObject().apply {
        put("profile", JSONObject().put("id", "p1").put("name", "Principal").put("avatarColor", "#2968ff"))
        put("movies", listOf(media("a"), media("b")).fold(org.json.JSONArray()) { array, item -> array.put(item) })
        put("shows", org.json.JSONArray())
        extra.forEach { (key, value) -> put(key, value) }
    }

    @Test fun `retient les totaux annoncés par le serveur`() {
        val parsed = parseHome(home("movieTotal" to 2000, "showTotal" to 200))
        assertEquals(2, parsed.movies.size)
        assertEquals(2000, parsed.movieTotal)
        assertEquals(200, parsed.showTotal)
    }

    @Test fun `considère la page reçue comme le catalogue entier sans total annoncé`() {
        val parsed = parseHome(home())
        assertEquals(2, parsed.movieTotal)
        assertEquals(0, parsed.showTotal)
    }

    @Test fun `analyse une page de catalogue`() {
        val page = parseCatalogPage(JSONObject()
            .put("items", org.json.JSONArray().put(media("a")))
            .put("total", 137).put("offset", 60).put("limit", 60).put("anchor", 80))
        assertEquals(1, page.items.size)
        assertEquals(137, page.total)
        assertEquals(60, page.offset)
        assertEquals(80, page.anchor)
    }

    @Test fun `sait s'il reste des fiches à charger`() {
        val loaded = List(60) { index -> Media("m$index", null, null, "movie", "T", null, null, null, null, null, null, null, null, 0, false, null) }
        assertTrue(CatalogSection(items = loaded, total = 137).hasMore)
        assertFalse(CatalogSection(items = loaded, total = 60).hasMore)
        assertFalse(CatalogSection(items = emptyList(), total = 0, loaded = true).hasMore)
        assertTrue(CatalogSection(items = loaded, total = 137, offset = 60).hasPrevious)
        assertFalse(CatalogSection(items = loaded, total = 137, offset = 0).hasPrevious)
    }
}
