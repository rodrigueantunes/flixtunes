package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Ce que le bandeau du lecteur annonce.
 *
 * Il affichait « FlixTunes » pendant tout le film — non par choix, mais par repli : la réponse qui
 * ouvre une lecture décrit les flux et ne nommait pas le média. Le défaut ne se voyait pas en
 * relisant le code du lecteur, qui savait pourtant composer le libellé ; il tenait dans ce que le
 * serveur envoyait.
 *
 * La forme attendue est celle du lecteur Web, référence graphique du projet : la série en gras, le
 * numéro d'épisode et son titre en dessous.
 */
class IntituleLecteurTest {

    @Test
    fun `un film porte son titre, sans seconde ligne`() {
        val intitule = intituleLecteur("Le Loup et le Lion", serie = null, saison = 0, episode = 0)
        assertEquals("Le Loup et le Lion", intitule.titre)
        assertNull(intitule.sousTitre)
    }

    @Test
    fun `un episode annonce sa serie, puis son numero et son titre`() {
        val intitule = intituleLecteur("Le premier", serie = "H", saison = 1, episode = 1)
        assertEquals("H", intitule.titre)
        assertEquals("S1 E1 · Le premier", intitule.sousTitre)
    }

    @Test
    fun `un element absent ne laisse pas de separateur en trop`() {
        assertEquals("S1 E1", intituleLecteur(titre = null, serie = "H", saison = 1, episode = 1).sousTitre)
        assertEquals("Le premier", intituleLecteur("Le premier", serie = "H", saison = 0, episode = 0).sousTitre)
        assertNull(intituleLecteur(titre = null, serie = "H", saison = 0, episode = 0).sousTitre)
    }

    @Test
    fun `la marque seule vaut mieux qu'un bandeau vide`() {
        // Ce cas ne devrait plus se produire, le serveur nommant désormais le média à l'ouverture
        // comme au passage à l'épisode suivant. S'il revient, il doit rester lisible.
        assertEquals("FlixTunes", intituleLecteur(null, null, 0, 0).titre)
        assertEquals("FlixTunes", intituleLecteur("   ", null, 0, 0).titre)
    }
}
