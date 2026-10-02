package tv.flixtunes.app.playback

import org.junit.Assert.*
import org.junit.Test

class MemoireDirectTest {
    private val mio = 1024 * 1024

    @Test fun `un petit tas ne cumule pas deux lecteurs et le cache de 64 Mio`() {
        val budget = budgetMemoireDirect(128L * mio, false)
        assertEquals(4 * mio, budget.cacheOctets)
        assertEquals(16 * mio, budget.tamponOctets)
        assertFalse(budget.doubleLecture)
        assertFalse(budget.peutPreparer(128L * mio, false, 2))
    }

    @Test fun `un appareil sobre ne prépare pas un second décodeur`() {
        assertFalse(budgetMemoireDirect(512L * mio, true).doubleLecture)
    }

    @Test fun `la relève exige une marge réelle et un système non saturé`() {
        val budget = budgetMemoireDirect(256L * mio, false)
        assertEquals(8 * mio, budget.cacheOctets)
        assertEquals(32 * mio, budget.tamponOctets)
        assertFalse(budget.peutPreparer(64L * mio, false, 2))
        assertFalse(budget.peutPreparer(128L * mio, true, 2))
        assertFalse(budget.peutPreparer(128L * mio, false, 1))
        assertTrue(budget.peutPreparer(128L * mio, false, 2))
    }

    @Test fun `les grandes mémoires ne font pas croître les réserves sans limite`() {
        val budget = budgetMemoireDirect(4_096L * mio, false)
        assertEquals(8 * mio, budget.cacheOctets)
        assertEquals(48 * mio, budget.tamponOctets)
    }

    @Test fun `le cache tourne sans grossir pendant mille segments et refuse les gros segments`() {
        val budget = budgetMemoireDirect(128L * mio, false)
        val cache = CacheSegmentsDirect(maximum = budget.cacheOctets, horloge = { 0L })
        val segment = ByteArray(256 * 1024) { 1 }
        repeat(1_000) {
            cache.garder("segment-$it", segment)
            assertTrue(cache.tailleOctets() <= budget.cacheOctets)
        }
        assertNull(cache.lire("segment-0"))
        assertArrayEquals(segment, cache.lire("segment-999"))
        cache.garder("trop-gros", ByteArray(cache.maximumSegment + 1))
        assertNull(cache.lire("trop-gros"))
        cache.vider()
        assertEquals(0, cache.tailleOctets())
    }
}
