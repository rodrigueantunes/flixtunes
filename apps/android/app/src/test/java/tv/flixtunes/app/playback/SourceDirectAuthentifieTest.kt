package tv.flixtunes.app.playback

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SourceDirectAuthentifieTest {
    @Test fun accepteUniquementLeRelaisDuServeur() {
        val serveur = "https://tv.example"
        assertTrue(estRelaisFlixTunes("https://tv.example/api/live/relais?t=jeton", serveur))
        assertTrue(estRelaisFlixTunes("https://tv.example:443/api/live/relais?t=jeton", serveur))
        for (url in listOf("https://cdn.example/live.m3u8", "https://tv.example.evil/api/live/relais",
            "http://tv.example/api/live/relais", "https://tv.example:444/api/live/relais",
            "https://tv.example/api/autre", "https://tv.example@evil.example/api/live/relais")) {
            assertFalse(url, estRelaisFlixTunes(url, serveur))
        }
    }
}
