package tv.flixtunes.app.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SourceDetailsTest {
    private fun media() = JSONObject()
        .put("id", "m1").put("catalogId", "c1").put("kind", "movie").put("title", "BAC Nord")

    @Test fun `lit le nom de source renvoyé par le serveur`() {
        val details = parseDetails(JSONObject()
            .put("item", media())
            .put("seasons", JSONArray()).put("related", JSONArray())
            .put("source", JSONObject().put("kind", "file").put("name", "BAC Nord (2021) REMUX.mkv")))

        assertEquals("file", details.source?.kind)
        assertEquals("BAC Nord (2021) REMUX.mkv", details.source?.name)
    }

    @Test fun `reste compatible avec un serveur sans détail de source`() {
        val details = parseDetails(JSONObject()
            .put("item", media()).put("seasons", JSONArray()).put("related", JSONArray()))

        assertNull(details.source)
    }
}
