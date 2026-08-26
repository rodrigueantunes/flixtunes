package tv.flixtunes.app.data

import org.junit.Assert.assertEquals
import org.junit.Test

class MediaLabelTest {
    private fun media(kind: String, season: Int? = null, episode: Int? = null, count: Int? = null) = Media(
        "id", "catalog", "id", kind, "Titre", 2026, null, null, null, if (kind == "episode") "Série" else null,
        season, episode, 100, 0, false, count,
    )

    @Test fun `formate les épisodes pour mobile et TV`() = assertEquals("S2 · E7", media("episode", 2, 7).secondaryText)
    @Test fun `accorde le nombre de saisons`() {
        assertEquals("1 saison", media("show", count = 1).secondaryText)
        assertEquals("3 saisons", media("show", count = 3).secondaryText)
    }
    @Test fun `affiche l'année des films`() = assertEquals("2026", media("movie").secondaryText)
}
