package tv.flixtunes.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.flixtunes.app.ui.ecrans.retourDeNiveau

/**
 * La carte de retour du rayon Web, sur téléviseur comme sur mobile.
 *
 * Elle manquait à la racine d'une chaîne : on remontait de dossier en dossier, puis elle disparaissait
 * sur la dernière marche. Sur mobile il restait le fil d'Ariane, en haut de l'écran ; à la
 * télécommande il fallait en plus remonter toute la grille pour l'atteindre. Elle est là partout, et
 * c'est depuis la racine qu'elle ressort de la chaîne.
 *
 * Les deux surfaces partagent cet écran — seul le gabarit change —, donc ce cas les couvre toutes deux.
 */
class ChaineWebTest {
    @Test
    fun `a la racine d'une chaine, la carte ramene aux chaines`() {
        val retour = retourDeNiveau(emptyList(), "Chaine documentaire")
        assertEquals("Retour aux chaînes", retour.libelle)
        assertEquals("Web", retour.sousTitre)
        assertTrue(retour.sortDeLaChaine)
    }

    @Test
    fun `dans un dossier de premier niveau, elle nomme la chaine`() {
        val retour = retourDeNiveau(listOf("Grands formats"), "Chaine documentaire")
        assertEquals("Dossier parent", retour.libelle)
        assertEquals("Chaine documentaire", retour.sousTitre)
        assertFalse(retour.sortDeLaChaine)
    }

    @Test
    fun `plus profond, elle nomme le dossier au-dessus`() {
        val retour = retourDeNiveau(listOf("Grands formats", "Archives"), "Chaine documentaire")
        assertEquals("Dossier parent", retour.libelle)
        assertEquals("Grands formats", retour.sousTitre)
        assertFalse(retour.sortDeLaChaine)
    }
}
