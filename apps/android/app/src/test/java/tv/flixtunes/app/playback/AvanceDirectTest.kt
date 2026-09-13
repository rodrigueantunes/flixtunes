package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Les mêmes fenêtres que le client Web : l'avance la plus grande possible, jamais hors de la fenêtre. */
class AvanceDirectTest {
    @Test
    fun `40 s pour une source qui n'a jamais calé, 60 s pour une fragile`() {
        assertEquals(40_000L, avanceViseeMs(300_000L, 9_000L, fragile = false))
        assertEquals(60_000L, avanceViseeMs(300_000L, 9_000L, fragile = true))
    }

    @Test
    fun `la fenêtre médiane ne permet pas plus de 41 s`() {
        assertEquals(40_000L, avanceViseeMs(61_000L, 8_000L, fragile = false))
        assertEquals(41_000L, avanceViseeMs(61_000L, 8_000L, fragile = true))
    }

    @Test
    fun `une fenêtre courte garde le point de lecture dedans`() {
        val avance = avanceViseeMs(20_000L, 8_000L, fragile = true)
        assertEquals(12_000L, avance)
        assertTrue(avance < 20_000L)
    }
}
