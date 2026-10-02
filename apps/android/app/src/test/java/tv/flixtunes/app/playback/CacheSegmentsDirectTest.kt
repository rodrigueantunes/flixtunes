package tv.flixtunes.app.playback

import org.junit.Assert.*
import org.junit.Test

class CacheSegmentsDirectTest {
    @Test fun `les octets sont isoles et la reserve bornee`() {
        val cache = CacheSegmentsDirect(maximum = 4)
        val octets = byteArrayOf(1, 2)
        cache.garder("a", octets)
        octets[0] = 9
        cache.lire("a")!![0] = 8
        assertArrayEquals(byteArrayOf(1, 2), cache.lire("a"))
        cache.garder("b", octets)
        cache.garder("c", octets)
        assertNull(cache.lire("a"))
        assertNotNull(cache.lire("b"))
        cache.vider()
        assertNull(cache.lire("c"))
    }

    @Test fun `la lecture ne prolonge pas une entree expiree`() {
        var date = 0L
        val cache = CacheSegmentsDirect(retentionMs = 90, horloge = { date })
        cache.garder("a", byteArrayOf(1))
        date = 89
        assertNotNull(cache.lire("a"))
        date = 90
        assertNull(cache.lire("a"))
    }
}
