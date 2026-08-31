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
        assertTrue(sectionsTelevision(true).all { it in SECTIONS })
        assertTrue(sectionsTelevision(false).all { it in SECTIONS })
    }

    @Test
    fun `la recherche est absente de la barre du téléviseur`() {
        // Saisir du texte à la télécommande est pénible, et la recherche a son propre bouton. L'y
        // remettre allongerait le parcours au focus vers les sections dont on se sert vraiment.
        assertFalse(sectionsTelevision(true).any { it.cle == "search" })
        assertTrue(SECTIONS.any { it.cle == "search" })
    }

    @Test
    fun `l'accueil vient en premier sur les deux surfaces`() {
        assertEquals("home", SECTIONS.first().cle)
        assertEquals("home", sectionsTelevision(true).first().cle)
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
        // Le Web propose Accueil, Films, Séries TV, Live TV et Historique, la recherche étant à part.
        assertEquals(listOf("home", "movies", "shows", "live", "history"), sectionsTelevision(true).map { it.cle })
        assertEquals(listOf("home", "movies", "shows", "live", "history", "search"), sectionsVisibles(true).map { it.cle })
    }

    @Test
    fun `le direct n'apparaît que si le serveur en offre`() {
        /*
         * C'est la règle des fonctions qui coûtent : éteinte, la fonction n'existe nulle part. Une
         * installation qui ne s'en sert pas — et c'est l'état par défaut — ne voit rien changer, et
         * un serveur antérieur qui ignore la route se comporte exactement pareil.
         *
         * Le placement compte autant que la présence : « après Séries TV », comme demandé.
         */
        assertFalse(sectionsVisibles(false).any { it.cle == "live" })
        assertFalse(sectionsTelevision(false).any { it.cle == "live" })
        assertEquals(listOf("home", "movies", "shows", "history", "search"), sectionsVisibles(false).map { it.cle })

        val avec = sectionsVisibles(true).map { it.cle }
        assertEquals(avec.indexOf("shows") + 1, avec.indexOf("live"))
    }
}
