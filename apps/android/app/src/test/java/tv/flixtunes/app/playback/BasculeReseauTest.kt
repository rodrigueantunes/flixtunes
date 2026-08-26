package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Bascule Wi-Fi/Ethernet — cas limite nommé au dossier de l'étape 56.
 *
 * Elle se produit sans que personne ne fasse rien de particulier : un téléviseur qu'on branche en
 * Ethernet, un téléphone qui change de borne. La connexion meurt, et la reprise attendait son délai
 * alors que la nouvelle route était déjà prête.
 */
class BasculeReseauTest {
    @Test
    fun `le retour du réseau déclenche la reprise sans attendre le délai`() {
        val (etat, reprendre) = surRetourReseau(EtatReprises(utilisees = 2, enAttente = true))
        assertTrue(reprendre)
        assertFalse(etat.enAttente)
    }

    @Test
    fun `une bascule remet le budget de reprises à zéro`() {
        // Point essentiel : un changement d'interface n'est pas une répétition de la même panne, c'est
        // un fait nouveau qui explique l'échec précédent. Sans cette remise à zéro, quatre changements
        // de borne au cours d'un long film fermeraient le lecteur — alors que chacun s'est résolu seul.
        val (etat, _) = surRetourReseau(EtatReprises(utilisees = 3, enAttente = true))
        assertEquals(0, etat.utilisees)
    }

    @Test
    fun `un réseau qui apparaît pendant une lecture saine n'interrompt rien`() {
        // Une seconde interface qui s'active ne doit pas relancer une image qui va bien.
        val avant = EtatReprises(utilisees = 0, enAttente = false)
        val (apres, reprendre) = surRetourReseau(avant)
        assertFalse(reprendre)
        assertEquals(avant, apres)
    }

    @Test
    fun `seul un réseau devenu utilisable mérite une réaction`() {
        // Le système signale aussi les réseaux qui disparaissent : y réagir relancerait la lecture au
        // pire moment, celui où plus rien ne passe.
        assertTrue(changementUtile(estUtilisable = true, memeReseauQuAvant = false))
        assertFalse(changementUtile(estUtilisable = false, memeReseauQuAvant = false))
    }

    @Test
    fun `un changement qui ramène le même réseau ne déclenche rien`() {
        // La pile réseau émet beaucoup de soubresauts sur un téléphone en déplacement ; relancer à
        // chacun rendrait la lecture plus instable que la bascule elle-même.
        assertFalse(changementUtile(estUtilisable = true, memeReseauQuAvant = true))
    }
}
