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
    /** Un serveur qui offre tout, et un qui n'offre rien : les deux bornes du filtrage. */
    private val TOUT = OffreDuServeur(direct = true, web = true)
    private val RIEN = OffreDuServeur()

    @Test
    fun `les deux surfaces partagent la même liste de sections`() {
        // C'est tout l'intérêt : une section ajoutée l'est pour les deux, sans oubli possible.
        assertTrue(sectionsTelevision(TOUT).all { it in SECTIONS })
        assertTrue(sectionsTelevision(RIEN).all { it in SECTIONS })
    }

    @Test
    fun `la recherche est absente de la barre du téléviseur`() {
        // Saisir du texte à la télécommande est pénible, et la recherche a son propre bouton. L'y
        // remettre allongerait le parcours au focus vers les sections dont on se sert vraiment.
        assertFalse(sectionsTelevision(TOUT).any { it.cle == "search" })
        assertTrue(SECTIONS.any { it.cle == "search" })
    }

    @Test
    fun `l'accueil vient en premier sur les deux surfaces`() {
        assertEquals("home", SECTIONS.first().cle)
        assertEquals("home", sectionsTelevision(TOUT).first().cle)
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
        assertEquals(listOf("home", "movies", "shows", "web", "live", "history"), sectionsTelevision(TOUT).map { it.cle })
        assertEquals(listOf("home", "movies", "shows", "web", "live", "history", "search"), sectionsVisibles(TOUT).map { it.cle })
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
        assertFalse(sectionsVisibles(RIEN).any { it.cle == "live" })
        assertFalse(sectionsTelevision(RIEN).any { it.cle == "live" })
        assertEquals(listOf("home", "movies", "shows", "history", "search"), sectionsVisibles(RIEN).map { it.cle })

        val avec = sectionsVisibles(OffreDuServeur(direct = true)).map { it.cle }
        assertEquals(avec.indexOf("shows") + 1, avec.indexOf("live"))
    }

    @Test
    fun `le rayon Web n'apparaît que si un dossier est déclaré`() {
        // Même règle que le direct, et même placement demandé : entre Séries TV et Live TV.
        assertFalse(sectionsVisibles(RIEN).any { it.cle == "web" })
        assertFalse(sectionsTelevision(RIEN).any { it.cle == "web" })

        val avec = sectionsVisibles(OffreDuServeur(web = true)).map { it.cle }
        assertEquals(avec.indexOf("shows") + 1, avec.indexOf("web"))
    }

    @Test
    fun `les deux offres sont indépendantes l'une de l'autre`() {
        /*
         * C'est la raison d'être de l'état nommé. Deux booléens positionnels s'inversent tôt ou tard,
         * et l'inversion ne se voit qu'à l'écran : une entrée « Web » qui apparaît parce qu'une source
         * de direct est réglée. Ce cas échouerait si les deux venaient à se confondre.
         */
        val directSeul = sectionsVisibles(OffreDuServeur(direct = true)).map { it.cle }
        assertTrue(directSeul.contains("live"))
        assertFalse(directSeul.contains("web"))

        val webSeul = sectionsVisibles(OffreDuServeur(web = true)).map { it.cle }
        assertTrue(webSeul.contains("web"))
        assertFalse(webSeul.contains("live"))
    }
}
