package tv.flixtunes.app.playback

import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.Path
import org.junit.Assert.assertTrue
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class Hdr10PlusDirectPlayTest {

    @Test fun `le filtre ne depend pas du catalogue HDR10 plus quand la sortie directe est Dolby Vision`() {
        assertEquals(true, filtrerHdr10PlusPourDolbyVisionDirect("direct", "dolbyvision"))
        assertEquals(false, filtrerHdr10PlusPourDolbyVisionDirect("remux", "dolbyvision"))
        assertEquals(false, filtrerHdr10PlusPourDolbyVisionDirect("direct", "hdr10plus"))
    }
    @Test
    fun `retire le NAL HDR10 plus sans toucher au RPU Dolby Vision`() {
        val donnees = byteArrayOf(
            0, 0, 0, 1, 0x4E, 1, // prefix SEI, type 39
            4, 7, 0xB5.toByte(), 0, 0x3C, 0, 1, 4, 1,
            0, 0, 1, 0x7C, 1, // Dolby Vision RPU, type 62
            0xB5.toByte(), 0, 0x3C, 0, 1, 4,
        )
        val tampon = ByteBuffer.wrap(donnees)

        val resultat = retirerHdr10PlusDansHevc(tampon, 0, donnees.size)
        assertEquals(1, resultat.messagesRetires)
        assertEquals(15, resultat.octetsRetires)
        assertArrayEquals(byteArrayOf(0, 0, 1, 0x7C, 1, 0xB5.toByte(), 0, 0x3C, 0, 1, 4),
            donnees.copyOfRange(0, resultat.nouvelleTaille))
    }

    @Test
    fun `laisse un flux Dolby Vision sans HDR10 plus bit pour bit intact`() {
        val donnees = byteArrayOf(0, 0, 1, 0x7C, 1, 0x19, 0x08, 0x06, 0x55)
        val avant = donnees.copyOf()

        assertEquals(0, retirerHdr10PlusDansHevc(ByteBuffer.wrap(donnees), 0, donnees.size).messagesRetires)
        assertArrayEquals(avant, donnees)
    }

    @Test
    fun `respecte la fenetre utile du buffer codec`() {
        val donnees = byteArrayOf(
            0x66, 0x66,
            0, 0, 1, 0x4E, 1, 4, 7, 0xB5.toByte(), 0, 0x3C, 0, 1, 4, 1,
            0x77,
        )

        val resultat = retirerHdr10PlusDansHevc(ByteBuffer.wrap(donnees), 2, donnees.size - 3)
        assertEquals(1, resultat.messagesRetires)
        assertEquals(0, resultat.nouvelleTaille)
        assertEquals(0x66, donnees[0].toInt())
        assertEquals(0x77, donnees.last().toInt())
    }

    @Test
    fun `conserve les autres messages du meme NAL SEI`() {
        val donnees = byteArrayOf(
            0, 0, 1, 0x4E, 1,
            5, 2, 0x44, 0x55, // autre SEI
            4, 7, 0xB5.toByte(), 0, 0x3C, 0, 1, 4, 1,
            0x80.toByte(),
            0, 0, 1, 0x7C, 1, 0x22,
        )
        val resultat = retirerHdr10PlusDansHevc(ByteBuffer.wrap(donnees), 0, donnees.size)
        assertEquals(1, resultat.messagesRetires)
        assertArrayEquals(byteArrayOf(
            0, 0, 1, 0x4E, 1, 5, 2, 0x44, 0x55, 0x80.toByte(),
            0, 0, 1, 0x7C, 1, 0x22,
        ), donnees.copyOfRange(0, resultat.nouvelleTaille))
    }

    @Test
    fun `retire le HDR10 plus du corpus Lucky en conservant chaque RPU`() {
        val chemin = System.getenv("FLIXTUNES_LUCKY_HEVC")?.takeIf { it.isNotBlank() } ?: return
        val donnees = Files.readAllBytes(Path.of(chemin))
        val tampon = ByteBuffer.wrap(donnees)
        val resultat = retirerHdr10PlusDansHevc(tampon, 0, donnees.size)
        println("Lucky: ${resultat.messagesRetires} SEI retirés, ${resultat.rpuDolbyVision} RPU conservés, ${resultat.octetsRetires} octets retirés")
        assertTrue("aucun SEI HDR10+ retiré", resultat.messagesRetires >= 20)
        assertTrue("aucun RPU Dolby Vision conservé", resultat.rpuDolbyVision >= 20)
        assertTrue("la taille du flux n'a pas diminué", resultat.octetsRetires > 0)

        val verification = retirerHdr10PlusDansHevc(tampon, 0, resultat.nouvelleTaille)
        assertEquals(0, verification.messagesRetires)
        assertEquals(resultat.rpuDolbyVision, verification.rpuDolbyVision)
    }

    @Test
    fun `laisse le corpus Asterix bit pour bit intact`() {
        val chemin = System.getenv("FLIXTUNES_ASTERIX_HEVC")?.takeIf { it.isNotBlank() } ?: return
        val donnees = Files.readAllBytes(Path.of(chemin))
        val avant = donnees.copyOf()
        val resultat = retirerHdr10PlusDansHevc(ByteBuffer.wrap(donnees), 0, donnees.size)
        assertEquals(0, resultat.messagesRetires)
        assertEquals(donnees.size, resultat.nouvelleTaille)
        assertTrue("aucun RPU Dolby Vision trouvé", resultat.rpuDolbyVision >= 20)
        assertArrayEquals(avant, donnees)
    }
}
