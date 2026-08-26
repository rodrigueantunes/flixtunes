package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Le cumul des tapes de navigation.
 *
 * Le geste ne se déclenchait pas du tout — le détecteur était recréé quatre fois par seconde — et une
 * fois réparé il fallait décider ce que veut dire tapoter. Ces cas fixent cette décision, et ils sont
 * la seule façon de l'éprouver depuis un poste sans appareil tactile.
 */
class NavigationTapeTest {
    @Test fun `une tape isolee avance d un pas depuis la position courante`() {
        val serie = cumulerTape(precedente = null, positionSecondes = 120.0, cote = 1, instantMs = 1_000)
        assertEquals(130.0, serie.cible, 0.001)
    }

    @Test fun `une tape a gauche recule d un pas`() {
        val serie = cumulerTape(precedente = null, positionSecondes = 120.0, cote = -1, instantMs = 1_000)
        assertEquals(110.0, serie.cible, 0.001)
    }

    @Test fun `les tapes du meme cote s ajoutent`() {
        // C'est tout l'intérêt du geste : tapoter avance de plus en plus loin, sans attendre que
        // chaque saut aboutisse.
        var serie = cumulerTape(null, 120.0, cote = 1, instantMs = 1_000)
        serie = cumulerTape(serie, positionSecondes = 121.0, cote = 1, instantMs = 1_300)
        serie = cumulerTape(serie, positionSecondes = 122.0, cote = 1, instantMs = 1_600)
        assertEquals(150.0, serie.cible, 0.001)
    }

    @Test fun `la serie part de la position d avant le premier saut`() {
        // La lecture n'a pas encore atteint la cible précédente quand la suivante est demandée : partir
        // de la position courante ferait se contrarier les sauts, et trois tapes n'avanceraient que
        // d'une dizaine de secondes au lieu de trente.
        var serie = cumulerTape(null, 120.0, cote = 1, instantMs = 1_000)
        serie = cumulerTape(serie, positionSecondes = 120.4, cote = 1, instantMs = 1_200)
        assertEquals(120.0, serie.base, 0.001)
        assertEquals(140.0, serie.cible, 0.001)
    }

    @Test fun `passe la fenetre, une nouvelle serie repart de la position courante`() {
        val premiere = cumulerTape(null, 120.0, cote = 1, instantMs = 1_000)
        val seconde = cumulerTape(premiere, positionSecondes = 200.0, cote = 1, instantMs = 1_000 + FENETRE_CUMUL_MS + 1)
        assertEquals(210.0, seconde.cible, 0.001)
    }

    @Test fun `changer de cote ouvre une serie neuve`() {
        // Quelqu'un qui tape à gauche après avoir trop avancé veut revenir en arrière depuis là où il
        // est, pas défaire son geste précédent.
        val avant = cumulerTape(null, 120.0, cote = 1, instantMs = 1_000)
        val arriere = cumulerTape(avant, positionSecondes = 150.0, cote = -1, instantMs = 1_200)
        assertEquals(140.0, arriere.cible, 0.001)
    }

    @Test fun `ne recule jamais avant le debut du film`() {
        var serie = cumulerTape(null, 15.0, cote = -1, instantMs = 1_000)
        serie = cumulerTape(serie, positionSecondes = 5.0, cote = -1, instantMs = 1_200)
        serie = cumulerTape(serie, positionSecondes = 0.0, cote = -1, instantMs = 1_400)
        assertEquals(0.0, serie.cible, 0.001)
    }

    @Test fun `une position inexploitable ne produit pas de cible absurde`() {
        // Un lecteur qui n'a pas encore de durée rapporte parfois NaN : le propager dans un `seekTo`
        // n'échouerait pas bruyamment, il placerait la lecture n'importe où.
        assertEquals(10.0, cumulerTape(null, Double.NaN, cote = 1, instantMs = 1_000).cible, 0.001)
        assertEquals(10.0, cumulerTape(null, -30.0, cote = 1, instantMs = 1_000).cible, 0.001)
    }
}
