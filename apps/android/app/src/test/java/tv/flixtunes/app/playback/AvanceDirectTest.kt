package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Les mêmes fenêtres que le client Web : l'avance la plus grande possible, jamais hors de la fenêtre. */
class AvanceDirectTest {
    @Test fun `une fenetre incomplete et un segment long respectent les bornes`() {
        for (fenetre in listOf(0L, 1_000L, 5_000L, 15_000L, 100_000L, 600_000L)) {
            for (segment in listOf(1_000L, 8_000L, 20_000L, 90_000L)) {
                val avance = avanceViseeMs(fenetre, segment, true)
                assertTrue(avance in 0..minOf(60_000L, fenetre))
            }
        }
    }
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
