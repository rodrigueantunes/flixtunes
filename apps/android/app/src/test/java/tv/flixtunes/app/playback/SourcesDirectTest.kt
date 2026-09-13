package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Le repli et le menu des sources, éprouvés sans le lecteur — les mêmes cas que le client Web. Deux
 * promesses : toutes les sources entrent dans le repli et dans le menu, et celles qui ne répondent pas
 * ne font plus attendre.
 */
class SourcesDirectTest {
    @Test
    fun `le repli parcourt toutes les adresses, bien au-delà de la huitième`() {
        val urls = (0 until 30).map { "u$it" }
        assertEquals(8, prochaineAdresse(urls, 7, emptySet()))
        assertEquals(29, prochaineAdresse(urls, 28, emptySet()))
        assertNull(prochaineAdresse(urls, 29, emptySet()))
    }

    @Test
    fun `le repli saute les adresses que le serveur a trouvées muettes`() {
        val urls = listOf("a", "b", "c", "d")
        assertEquals(3, prochaineAdresse(urls, 0, setOf("b", "c")))
        assertNull(prochaineAdresse(urls, 0, setOf("b", "c", "d")))
    }

    @Test
    fun `la reprise part de la mieux classée qui répond, sinon de la première`() {
        assertEquals(1, premiereAdresse(listOf("a", "b", "c"), setOf("a")))
        assertEquals(0, premiereAdresse(listOf("a", "b"), setOf("a", "b")))
    }

    @Test
    fun `la course va par vagues de douze`() {
        assertEquals(12, COURSE_MAX)
        assertEquals(listOf(0, 0, 12, 12, 24, 72), listOf(0, 11, 12, 23, 24, 80).map(::debutDeVague))
    }

    @Test
    fun `le menu montre tout, et range les muettes à la fin`() {
        val urls = (0 until 20).map { "u$it" }
        val groupes = regrouperLesSources(urls, urls, setOf("u0", "u5"))
        assertEquals(20, groupes.size)
        assertEquals(listOf(0 to true, 5 to true), groupes.takeLast(2).map { it.index to it.muette })
        assertEquals(GroupeDeSources(1, 1, false), groupes.first())
    }

    @Test
    fun `le menu réunit les doublons d'affichage, et ouvre le membre qui répond`() {
        val urls = listOf("h/flux?jeton=1", "autre/flux", "h/flux?jeton=2")
        val empreintes = listOf("h/flux", "autre/flux", "h/flux")
        val groupes = regrouperLesSources(empreintes, urls, setOf("h/flux?jeton=1"))
        assertEquals(listOf(GroupeDeSources(2, 2, false), GroupeDeSources(1, 1, false)), groupes)
    }
}
