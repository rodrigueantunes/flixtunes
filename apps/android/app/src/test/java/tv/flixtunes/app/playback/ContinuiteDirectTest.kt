package tv.flixtunes.app.playback

import org.junit.Assert.*
import org.junit.Test

class ContinuiteDirectTest {
    @Test fun leRemplissageInitialNeReduitPasLaQualite() {
        assertEquals(Int.MAX_VALUE, DebitContinu().ajuster(3_000, 8_000_000, Int.MAX_VALUE, 0, peutReduire = false))
    }
    @Test fun fenetreCourteNeBloquePasLaRemonteeDeQualite() {
        val q = DebitContinu()
        assertEquals(3_000_000, q.ajuster(8_000, 2_000_000, 3_000_000, 0, 12_000, 4_000))
        assertEquals(4_500_000, q.ajuster(8_000, 2_000_000, 3_000_000, 20_000, 12_000, 4_000))
        assertEquals(Int.MAX_VALUE, q.ajuster(8_000, 2_000_000, 4_500_000, 60_000, 12_000, 4_000))
    }
    @Test fun unDebitInconnuNeConservePasUneLimitePourToujours() {
        val q = DebitContinu()
        q.ajuster(30_000, -1, 1_000_000, 0)
        assertEquals(Int.MAX_VALUE, q.ajuster(30_000, -1, 1_000_000, 60_000))
    }
    @Test fun uneReserveSansNouveauxSegmentsNeFaitPasMonterLaQualite() {
        val q = DebitContinu()
        q.ajuster(30_000, 2_000_000, 3_000_000, 0)
        assertEquals(3_000_000, q.ajuster(30_000, 2_000_000, 3_000_000, 60_000, chargementRecent = false))
    }
    @Test fun anticipationRespecteLeRythmeDesSegments() {
        assertTrue(doitPreparerSecours(25_000, 13_000, 8_000))
        assertFalse(doitPreparerSecours(25_000, 10_000, 8_000))
        assertFalse(doitPreparerSecours(40_000, 13_000, 8_000))
    }
    @Test fun debitNeChangePasAChaqueReleve() {
        val q = DebitContinu()
        assertEquals(2_800_000, q.ajuster(12_000, 4_000_000, Int.MAX_VALUE, 0))
        assertEquals(2_800_000, q.ajuster(12_000, 4_000_000, 2_800_000, 250))
        assertEquals(2_800_000, q.ajuster(30_000, 2_000_000, 2_800_000, 1_000))
        assertEquals(4_200_000, q.ajuster(30_000, 2_000_000, 2_800_000, 21_000))
        assertEquals(4_200_000, q.ajuster(30_000, 2_000_000, 4_200_000, 21_250))
    }
    @Test fun raccordRequiertUneHorlogeCommuneEtUnePositionLisible() {
        assertNull(positionDeRaccord(null, 20_000, 100_000, 60_000))
        assertEquals(30_000L, positionDeRaccord(110_000, 20_000, 100_000, 60_000))
        assertNull(positionDeRaccord(110_000, 70_000, 100_000, 60_000))
    }
}
