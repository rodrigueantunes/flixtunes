package tv.flixtunes.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Les sections de l'accueil.
 *
 * Elles étaient écrites deux fois — une liste pour la barre du téléviseur, une autre pour celle du
 * tactile — et avaient déjà divergé. Une seule source, et le test qui l'ancre.
 */
class SectionsTest {
    @Test
    fun `les deux surfaces partagent la même liste de sections`() {
        // C'est tout l'intérêt : une section ajoutée l'est pour les deux, sans oubli possible.
        assertTrue(SECTIONS_TELEVISION.all { it in SECTIONS })
    }

    @Test
    fun `la recherche est absente de la barre du téléviseur`() {
        // Saisir du texte à la télécommande est pénible, et la recherche a son propre bouton. L'y
        // remettre allongerait le parcours au focus vers les sections dont on se sert vraiment.
        assertFalse(SECTIONS_TELEVISION.any { it.cle == "search" })
        assertTrue(SECTIONS.any { it.cle == "search" })
    }

    @Test
    fun `l'accueil vient en premier sur les deux surfaces`() {
        assertEquals("home", SECTIONS.first().cle)
        assertEquals("home", SECTIONS_TELEVISION.first().cle)
    }

    @Test
    fun `chaque section porte un libellé et un pictogramme`() {
        // Le libellé sert au téléviseur, lisible de loin ; le pictogramme à la barre tactile, étroite.
        for (section in SECTIONS) {
            assertTrue(section.cle, section.libelle.isNotBlank())
            assertTrue(section.cle, section.pictogramme.isNotBlank())
        }
    }

    @Test
    fun `aucune clé n'est employée deux fois`() {
        assertEquals(SECTIONS.size, SECTIONS.map { it.cle }.toSet().size)
    }

    @Test
    fun `les sections sont celles du menu du client Web`() {
        // Le Web propose Accueil, Films, Séries TV et Historique, la recherche étant à part. Android
        // n'avait pas d'Historique : un profil pouvait consulter son activité depuis un navigateur et
        // pas depuis son téléphone, alors que la donnée arrive dans la même réponse `/api/home`.
        assertEquals(listOf("home", "movies", "shows", "history"), SECTIONS_TELEVISION.map { it.cle })
        assertEquals(listOf("home", "movies", "shows", "history", "search"), SECTIONS.map { it.cle })
    }
}
