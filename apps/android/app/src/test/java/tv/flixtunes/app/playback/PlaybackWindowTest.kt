package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Temps du film contre temps du flux.
 *
 * En conversion, le lecteur ne voit qu'une fenêtre encodée qui s'allonge. S'y fier donne une barre de
 * progression dont le temps total grandit pendant la lecture — un film de deux heures annoncé à trois
 * minutes — et un curseur qu'on ne peut pas déplacer au-delà. Le lecteur Web fait la traduction depuis
 * l'étape 55 ; l'Android ne la faisait pas.
 */
class PlaybackWindowTest {
    private val deuxHeures = 7_200.0

    @Test
    fun `la position du film tient compte du décalage de la session`() {
        // Session démarrée à 1 h : trois minutes de flux, c'est 1 h 03 de film.
        val fenetre = FenetreLecture(decalageSecondes = 3_600.0, dureeReelleSecondes = deuxHeures)
        assertEquals(3_780.0, tempsFilm(180.0, fenetre), 0.001)
    }

    @Test
    fun `la traduction inverse ramène au temps du flux`() {
        val fenetre = FenetreLecture(3_600.0, deuxHeures)
        assertEquals(180.0, tempsFlux(3_780.0, fenetre), 0.001)
    }

    @Test
    fun `une session sans décalage laisse les temps identiques`() {
        // C'est le cas de la lecture directe : la traduction doit alors être sans effet.
        val fenetre = FenetreLecture(0.0, deuxHeures)
        assertEquals(42.0, tempsFilm(42.0, fenetre), 0.001)
        assertEquals(42.0, tempsFlux(42.0, fenetre), 0.001)
    }

    @Test
    fun `aucun temps négatif n'est rendu`() {
        // Viser avant le début de la fenêtre est légitime — c'est ce qui déclenche une relance — mais
        // ne doit jamais produire une position négative au passage.
        val fenetre = FenetreLecture(3_600.0, deuxHeures)
        assertEquals(0.0, tempsFlux(60.0, fenetre), 0.001)
    }

    @Test
    fun `la durée affichée est celle du film, pas celle de la portion encodée`() {
        // Le défaut visible : une barre dont le total grandit au fil de l'encodage.
        val fenetre = FenetreLecture(0.0, deuxHeures)
        assertEquals(7_200_000L, dureeAffichee(fenetre, dureeLecteurMs = 180_000L))
    }

    @Test
    fun `la durée du lecteur sert de repli quand le serveur n'a rien mesuré`() {
        assertEquals(180_000L, dureeAffichee(FenetreLecture(0.0, 0.0), dureeLecteurMs = 180_000L))
    }

    @Test
    fun `un déplacement dans la fenêtre encodée ne relance pas la session`() {
        // Une relance coûte une négociation complète : on ne la déclenche pas pour un déplacement que
        // la fenêtre couvre déjà.
        val fenetre = FenetreLecture(0.0, deuxHeures)
        assertFalse(relanceNecessaire(cibleFilm = 120.0, fenetre, dureeFluxSecondes = 300.0))
    }

    @Test
    fun `un déplacement au-delà de la portion encodée relance la session`() {
        val fenetre = FenetreLecture(0.0, deuxHeures)
        assertTrue(relanceNecessaire(cibleFilm = 3_000.0, fenetre, dureeFluxSecondes = 300.0))
    }

    @Test
    fun `le bord de la fenêtre est tenu à distance`() {
        // Viser exactement la fin de l'encodé revient à viser un point que le serveur n'a pas fini
        // d'écrire : la lecture s'y arrête au lieu de reprendre.
        val fenetre = FenetreLecture(0.0, deuxHeures)
        assertTrue(relanceNecessaire(cibleFilm = 300.0 - MARGE_FENETRE / 2, fenetre, dureeFluxSecondes = 300.0))
        assertFalse(relanceNecessaire(cibleFilm = 300.0 - MARGE_FENETRE * 2, fenetre, dureeFluxSecondes = 300.0))
    }

    @Test
    fun `revenir avant le début de la fenêtre relance la session`() {
        // La session a démarré à 1 h : rien avant cela n'existe dans ce flux.
        val fenetre = FenetreLecture(3_600.0, deuxHeures)
        assertTrue(relanceNecessaire(cibleFilm = 600.0, fenetre, dureeFluxSecondes = 300.0))
    }

    @Test
    fun `une durée de flux inconnue ne déclenche pas de relance`() {
        // Le lecteur n'a pas encore de manifeste : cela ne prouve rien, et relancer sur cette absence
        // ferait repartir une session à chaque ouverture.
        val fenetre = FenetreLecture(0.0, deuxHeures)
        assertFalse(relanceNecessaire(cibleFilm = 120.0, fenetre, dureeFluxSecondes = 0.0))
    }

    @Test fun `un seek HDR direct réarme le décodeur`() {
        assertTrue(reinitialisationHdrApresSeek("direct", "hdr10"))
        assertTrue(reinitialisationHdrApresSeek("direct", "hdr10plus"))
        assertTrue(reinitialisationHdrApresSeek("direct", "dolbyvision"))
    }

    @Test fun `le seek SDR et les fenêtres serveur gardent le chemin léger`() {
        assertFalse(reinitialisationHdrApresSeek("direct", "sdr"))
        assertFalse(reinitialisationHdrApresSeek("remux", "hdr10"))
        assertFalse(reinitialisationHdrApresSeek("transcode", "hdr10"))
    }
}
