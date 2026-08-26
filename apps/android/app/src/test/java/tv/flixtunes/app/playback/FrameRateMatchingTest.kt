package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Accord de la cadence d'affichage avec celle du film.
 *
 * Le défaut visé est le plus visible de toute la chaîne vidéo et le plus invisible dans les
 * spécifications : un film à 23,976 images par seconde sur un écran à 60 Hz saccade, quel que soit le
 * débit, quelle que soit la définition. Le corriger demande de choisir un mode d'affichage, et se
 * tromper de mode coûte cher — une définition changée éteint l'écran plusieurs secondes.
 */
class FrameRateMatchingTest {
    private val hd = { id: Int, hz: Double -> DisplayModeInfo(id, 3840, 2160, hz) }
    private val soixante = hd(1, 60.0)

    @Test
    fun `préfère un mode multiple exact de la cadence du film`() {
        // 24 sur 60 : trois rafraîchissements pour une image, deux pour la suivante. 24 sur 120 :
        // cinq pour chacune. C'est toute la différence entre un travelling qui accroche et un
        // travelling continu.
        val modes = listOf(soixante, hd(2, 120.0), hd(3, 50.0))
        assertEquals(2, chooseDisplayMode(modes, soixante, 24.0)?.id)
    }

    @Test
    fun `reconnaît la cadence cinéma réelle et non son arrondi`() {
        // 23,976 et 24 ne sont pas la même chose : sur une heure, l'écart vaut plus de trois secondes.
        // Un écran à 24,000 Hz exactement n'est donc pas un multiple de 23,976.
        val modes = listOf(soixante, hd(2, 23.976), hd(3, 24.0))
        assertEquals(2, chooseDisplayMode(modes, soixante, 23.976)?.id)
    }

    @Test
    fun `ne change jamais de définition pour gagner en fluidité`() {
        // Un mode 1080p à 24 Hz serait parfait pour la cadence et désastreux à l'usage : l'écran se
        // rallume, l'image disparaît plusieurs secondes, et la chaîne HDR retombe parfois en SDR.
        val modes = listOf(soixante, DisplayModeInfo(2, 1920, 1080, 24.0))
        assertNull(chooseDisplayMode(modes, soixante, 24.0))
    }

    @Test
    fun `ne descend pas sous la cadence du film`() {
        // Afficher 60 images par seconde sur un écran à 24 Hz n'enlève pas la saccade : il en supprime
        // des images. Le remède serait pire que le mal.
        val modes = listOf(soixante, hd(2, 24.0))
        assertEquals(null, chooseDisplayMode(modes, soixante, 60.0))
    }

    @Test
    fun `garde le mode en cours quand il convient déjà`() {
        // Demander un changement inutile provoque tout de même la renégociation HDMI, avec son écran
        // noir. Ne rien faire est ici la bonne réponse.
        val cinquante = hd(1, 50.0)
        assertNull(chooseDisplayMode(listOf(cinquante, hd(2, 100.0)), cinquante, 25.0))
    }

    @Test
    fun `renonce plutôt que d'accepter un mode approximatif`() {
        // Aucun mode ne tombe juste : mieux vaut garder celui en cours que d'imposer une
        // renégociation HDMI pour un résultat qui saccadera autant.
        assertNull(chooseDisplayMode(listOf(soixante, hd(2, 90.0)), soixante, 23.976))
    }

    @Test
    fun `tolère la fréquence annoncée en arrondi par le téléviseur`() {
        // Beaucoup de téléviseurs déclarent « 60,0 » un panneau qui tourne à 59,94. Refuser cet écart
        // rendrait l'accord impossible sur du contenu à 29,97 — c'est-à-dire sur toute la télévision.
        val modes = listOf(hd(1, 50.0), hd(2, 60.0))
        assertEquals(2, chooseDisplayMode(modes, hd(1, 50.0), 29.97)?.id)
    }

    @Test
    fun `choisit la fréquence la plus basse à égalité d'exactitude`() {
        // 48 et 120 conviennent tous deux à 24 images par seconde. Le plus bas consomme moins et
        // correspond plus souvent au mode natif du panneau.
        val modes = listOf(soixante, hd(2, 120.0), hd(3, 48.0))
        assertEquals(3, chooseDisplayMode(modes, soixante, 24.0)?.id)
    }

    @Test
    fun `ignore une cadence absente ou absurde plutôt que de deviner`() {
        // FFprobe ne rend pas toujours une cadence : un flux sans en-tête exploitable, un conteneur
        // exotique. L'absence d'information ne doit pas produire un changement de mode au hasard.
        val modes = listOf(soixante, hd(2, 24.0))
        for (cadence in listOf(0.0, -1.0, Double.NaN, Double.POSITIVE_INFINITY)) {
            assertNull("cadence $cadence", chooseDisplayMode(modes, soixante, cadence))
        }
    }

    @Test
    fun `mesure l'écart de cadence en fraction d'image`() {
        // Le pire cas nommé au dossier : 23,976 sur 60 Hz. L'écart doit ressortir énorme, sans quoi la
        // tolérance laisserait passer précisément le défaut qu'on cherche à supprimer.
        assertEquals(0.0, ecartCadence(120.0, 24.0), 1e-9)
        assertEquals(0.0, ecartCadence(47.952, 23.976), 1e-9)
        assertTrue(ecartCadence(60.0, 23.976) > 0.4)
    }
}
