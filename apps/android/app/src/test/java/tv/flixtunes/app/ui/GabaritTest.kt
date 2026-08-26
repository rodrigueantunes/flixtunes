package tv.flixtunes.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Le gabarit de chaque surface.
 *
 * Ces valeurs étaient dispersées en quarante-huit conditions dans le code d'écran, donc invérifiables
 * autrement qu'en affichant l'application sur chacun des deux appareils. Rassemblées, elles se
 * relisent — et une régression sur la surface télévision se voit sans téléviseur.
 */
class GabaritTest {
    @Test
    fun `la surface télévision est plus grande en tout point`() {
        // Trois mètres de recul : ce n'est pas une préférence esthétique, c'est ce qui rend le texte
        // lisible et les jaquettes distinguables depuis un canapé.
        val tv = gabaritPour(televiseur = true)
        val tactile = gabaritPour(televiseur = false)
        assertTrue(tv.tailleTitre > tactile.tailleTitre)
        assertTrue(tv.tailleTexte > tactile.tailleTexte)
        assertTrue(tv.largeurCarte > tactile.largeurCarte)
        assertTrue(tv.margeEcran > tactile.margeEcran)
        assertTrue(tv.tailleLogo > tactile.tailleLogo)
    }

    @Test
    fun `la grille télévision reste dense sans réduire le texte`() {
        val tv = gabaritPour(televiseur = true)
        fun colonnes(largeur: Int): Int {
            val disponible = largeur - 2 * tv.margeBord
            return (disponible + tv.ecartCartes) / (tv.largeurMiniGrille + tv.ecartCartes)
        }

        assertEquals(4, colonnes(720))
        assertEquals(6, colonnes(960))
        assertEquals(8, colonnes(1280))
        assertTrue(tv.largeurMiniGrille < tv.largeurCarte)
        assertTrue(tv.tailleTexte > GABARIT_TACTILE.tailleTexte)
    }

    @Test
    fun `seule la surface télévision navigue au focus`() {
        // C'est le drapeau qui commande la navigation à la croix directionnelle, pas la taille des
        // éléments : sans pointeur, tout ce qui est actionnable doit pouvoir recevoir le focus.
        assertTrue(gabaritPour(true).naviguerAuFocus)
        assertFalse(gabaritPour(false).naviguerAuFocus)
    }

    @Test
    fun `la surface tactile réserve la place de sa barre de navigation`() {
        // Elle est en bas de l'écran et recouvrirait la dernière rangée de jaquettes. Le téléviseur
        // n'en a pas, et cette réserve y serait du vide.
        assertTrue(gabaritPour(false).margeBasse > gabaritPour(true).margeBasse)
    }

    @Test
    fun `le gabarit se déduit du seul type d'appareil`() {
        // Une seule décision, prise au démarrage : c'est ce qui permet aux écrans de ne plus porter le
        // drapeau de bout en bout.
        assertEquals(GABARIT_TELEVISION, gabaritPour(true))
        assertEquals(GABARIT_TACTILE, gabaritPour(false))
    }

    @Test
    fun `un écran tactile déplié reçoit le gabarit tablette mais jamais le focus TV`() {
        assertEquals(GABARIT_TACTILE, gabaritPour(televiseur = false, largeurDp = 599))
        assertEquals(GABARIT_TABLETTE, gabaritPour(televiseur = false, largeurDp = 600))
        assertEquals(GABARIT_TELEVISION, gabaritPour(televiseur = true, largeurDp = 480))
        assertFalse(GABARIT_TABLETTE.naviguerAuFocus)
        assertEquals(48, GABARIT_TABLETTE.cibleTactile)
    }

    @Test
    fun `chaque gabarit se déclare pour ce qu'il est`() {
        assertTrue(GABARIT_TELEVISION.televiseur)
        assertFalse(GABARIT_TACTILE.televiseur)
    }

    @Test
    fun `seule la surface télévision montre le focus`() {
        // Au doigt, il n'y a pas de focus à montrer : un élément qui grossirait sous le pouce serait
        // du bruit. À la télécommande, ne pas le montrer rend la navigation aveugle — on ne sait pas
        // où l'on est tant qu'on n'a pas validé.
        assertTrue(GABARIT_TELEVISION.focusEchelle > 1f)
        assertTrue(GABARIT_TELEVISION.focusBordure > 0)
        assertEquals(1f, GABARIT_TACTILE.focusEchelle, 0.0001f)
        assertEquals(0, GABARIT_TACTILE.focusBordure)
    }

    @Test
    fun `l'indication de focus accompagne toujours la navigation au focus`() {
        // Les deux vont ensemble : activer la navigation à la croix sans rien montrer reviendrait à
        // déplacer un curseur invisible.
        for (gabarit in listOf(GABARIT_TELEVISION, GABARIT_TACTILE)) {
            assertEquals(gabarit.naviguerAuFocus, gabarit.focusBordure > 0)
        }
    }
}
