package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Les mêmes valeurs que le client Web : démarrer dans la qualité tenue, sans qu'une soirée lente la fixe. */
class DebitRetenuTest {
    @Test fun `retient le premier debit tel quel, puis lisse`() {
        assertEquals(10_000_000L, DebitRetenu.lisser(null, 10_000_000L))
        assertEquals(7_600_000L, DebitRetenu.lisser(10_000_000L, 2_000_000L))
    }

    @Test fun `ignore une mesure absurde et borne une mesure extreme`() {
        assertNull(DebitRetenu.lisser(null, 100_000L))
        assertEquals(7_600_000L, DebitRetenu.lisser(7_600_000L, 0L))
        assertEquals(200_000_000L, DebitRetenu.lisser(null, 5_000_000_000L))
    }
}
