package tv.flixtunes.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProfilePlaybackPreferencesTest {
    @Test fun `parse les préférences de continuité du lecteur`() {
        val profile = Profile("p1", "g1", "Principal", "#2968ff", "fr-FR", false,
            resumeMode = "ask", resumeRewindSeconds = 10, defaultPlaybackRate = 1.25f,
            autoplayNext = false, autoplayLimit = 5)
        assertEquals("ask", profile.resumeMode)
        assertEquals(10, profile.resumeRewindSeconds)
        assertEquals(1.25f, profile.defaultPlaybackRate)
        assertFalse(profile.autoplayNext)
        assertEquals(5, profile.autoplayLimit)
    }

    @Test fun `le payload de réglages ne touche ni identité ni PIN`() {
        val profile = Profile("p1", "g1", "Principal", "#2968ff", "fr-FR", true,
            preferredAudioLanguages = listOf("original", "fr", "en"),
            preferredSubtitleLanguages = listOf("fr", "en"), subtitleMode = "always",
            audioOutputMode = "ac3", audioNormalization = true, nightMode = true,
            resumeMode = "ask", resumeRewindSeconds = 10, defaultPlaybackRate = 1.25f,
            autoplayNext = false, autoplayLimit = 5)
        val json = profile.playbackPreferencesJson()

        assertFalse(json.has("name"))
        assertFalse(json.has("avatarColor"))
        assertFalse(json.has("language"))
        assertFalse(json.has("pin"))
        assertEquals("original", json.getJSONArray("preferredAudioLanguages").getString(0))
        assertEquals("always", json.getString("subtitleMode"))
        assertTrue(json.getBoolean("nightMode"))
        assertEquals(5, json.getInt("autoplayLimit"))
    }
}
