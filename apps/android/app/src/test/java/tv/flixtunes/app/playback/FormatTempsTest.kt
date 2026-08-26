package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * L'horloge du lecteur, à parité avec le Web.
 *
 * Ces règles ne sont pas cosmétiques : l'horloge est le seul endroit où l'on constate que le lecteur
 * a compris la durée réelle du film. C'est elle qui affichait « 1:31 » pour un film de 1:41:51.
 */
class FormatTempsTest {
    @Test
    fun `sous une heure l heure n est pas ecrite`() {
        assertEquals("0:00", formatTempsLecture(0.0))
        assertEquals("0:07", formatTempsLecture(7.4))
        assertEquals("12:05", formatTempsLecture(725.0))
        assertEquals("59:59", formatTempsLecture(3599.0))
    }

    @Test
    fun `au dela d une heure elle apparait et les champs sont completes`() {
        assertEquals("1:00:00", formatTempsLecture(3600.0))
        assertEquals("1:41:51", formatTempsLecture(6111.0))
        assertEquals("2:03:04", formatTempsLecture(7384.9))
    }

    @Test
    fun `une duree absurde ne casse pas l affichage`() {
        // Le lecteur rend une durée inconnue tant que le manifeste n'est pas lu.
        assertEquals("0:00", formatTempsLecture(Double.NaN))
        assertEquals("0:00", formatTempsLecture(Double.POSITIVE_INFINITY))
        assertEquals("0:00", formatTempsLecture(-12.0))
    }

    @Test
    fun `la barre est vide tant que la duree est inconnue`() {
        assertEquals(0f, partDe(30.0, 0.0), 0f)
        assertEquals(0f, partDe(0.0, 6000.0), 0f)
    }

    @Test
    fun `la barre ne deborde jamais`() {
        assertEquals(0.5f, partDe(3000.0, 6000.0), 0.0001f)
        // Le tampon peut dépasser la durée annoncée d'une fraction de seconde : la barre reste pleine.
        assertEquals(1f, partDe(6100.0, 6000.0), 0f)
    }

    @Test
    fun `la mention encodee ne parait qu en conversion et tant qu il reste a produire`() {
        assertEquals(" · encodé 20:00", mentionEncodee(1200.0, 6000.0))
        // Lecture directe : rien n'est « encodé », la mention n'a pas lieu d'être.
        assertNull(mentionEncodee(0.0, 6000.0))
        // Le serveur a rattrapé la fin : la mention disparaît au lieu de doubler l'horloge.
        assertNull(mentionEncodee(6000.0, 6000.0))
        assertNull(mentionEncodee(5999.5, 6000.0))
    }
}
