package tv.flixtunes.app.playback

import org.junit.Assert.*
import org.junit.Test

class DiffusionTest {
    @Test fun etatNePublieAucunJeton() {
        val etat = etatDiffusionAndroid("media", "episode-1", "Été à la télé", "lecture", 120.0, 3600.0, .5f)
        assertEquals("Été à la télé", etat.getJSONObject("contenu").getString("titre"))
        assertEquals(120.0, etat.getDouble("position"), 0.0)
        assertFalse(etat.toString().contains("token"))
        assertFalse(etat.toString().contains("http"))
    }
    @Test fun valeursDuDecodeurRestentSerialisables() {
        val etat = etatDiffusionAndroid("direct", "tv", position = Double.NaN, duree = Double.POSITIVE_INFINITY, volume = Float.NaN)
        assertEquals(0.0, etat.getDouble("position"), 0.0)
        assertEquals(0.0, etat.getDouble("duree"), 0.0)
        assertEquals(1.0, etat.getDouble("volume"), 0.0)
        assertFalse(etat.getBoolean("navigation"))
    }
    @Test fun accueilSansLecture() { assertTrue(etatDiffusionAndroid().isNull("contenu")) }
}
