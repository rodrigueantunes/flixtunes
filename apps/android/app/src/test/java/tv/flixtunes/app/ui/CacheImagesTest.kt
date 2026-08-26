package tv.flixtunes.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Dimensionnement du cache de jaquettes.
 *
 * Sans cache disque, quitter l'accueil et y revenir retélécharge toutes les images : sur un téléviseur
 * en Wi-Fi, la grille se remplit par à-coups à chaque retour. Avec un cache mal dimensionné, on
 * remplace ce défaut par un autre — un disque saturé sur un boîtier qui n'a que quelques gigaoctets.
 */
class CacheImagesTest {
    private val gio = 1024L * 1024 * 1024

    @Test
    fun `prend une part de l'espace libre sur un appareil confortable`() {
        // 64 Gio libres : deux pour cent font 1,28 Gio, ramenés au plafond.
        assertEquals(CACHE_MAXIMUM_OCTETS, tailleCacheImages(64 * gio))
    }

    @Test
    fun `ne dépasse jamais le plafond`() {
        // Au-delà, on prend la place d'un appareil qui manque plus de disque que de réseau.
        assertTrue(tailleCacheImages(512 * gio) <= CACHE_MAXIMUM_OCTETS)
    }

    @Test
    fun `applique le plancher sur un appareil modeste`() {
        // 8 Gio libres : deux pour cent ne font que 160 Mio… au-dessus du plancher, donc conservés.
        val taille = tailleCacheImages(8 * gio)
        assertTrue(taille >= CACHE_MINIMUM_OCTETS)
        assertTrue(taille < CACHE_MAXIMUM_OCTETS)
    }

    @Test
    fun `renonce au cache plutôt que de saturer un disque presque plein`() {
        // L'application fonctionne sans cache ; elle ne fonctionne pas sans espace disque.
        assertEquals(0L, tailleCacheImages(64L * 1024 * 1024))
        assertEquals(0L, tailleCacheImages(0))
        assertEquals(0L, tailleCacheImages(-1))
    }

    @Test
    fun `accorde le plancher dès que l'espace le permet largement`() {
        // Quatre fois le plancher : l'appareil est modeste mais pas à l'étroit.
        assertEquals(CACHE_MINIMUM_OCTETS, tailleCacheImages(CACHE_MINIMUM_OCTETS * 5))
    }
}
