package tv.flixtunes.app.playback

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Qui peut piloter la lecture, et qui ne le peut pas.
 *
 * Le service de session est exporté par nécessité — le système doit le découvrir pour la notification
 * de lecture et les touches d'un casque. Sans garde, il est aussi joignable par n'importe quelle
 * application installée.
 */
class ControleursAutorisesTest {
    private val nous = "tv.flixtunes.app"

    @Test
    fun `notre propre application entre`() {
        assertTrue(ControleursAutorises.autorise(nous, nous, memeUid = false, composantDeLaSession = false))
    }

    @Test
    fun `notre propre processus entre, quel que soit le nom annonce`() {
        // Le nom de paquet vient du contrôleur ; l'identifiant d'utilisateur, lui, vient du système.
        assertTrue(ControleursAutorises.autorise("inconnu", nous, memeUid = true, composantDeLaSession = false))
    }

    @Test
    fun `les composants que la session reconnait entrent`() {
        // Notification de lecture, compagnon Android Auto, hôte Automotive : ce sont eux qui rendent
        // l'export nécessaire, les refuser reviendrait à couper la fonction qu'on veut garder.
        assertTrue(ControleursAutorises.autorise("com.android.systemui", nous, memeUid = false, composantDeLaSession = true))
    }

    @Test
    fun `une application tierce est refusee`() {
        assertFalse(ControleursAutorises.autorise("com.exemple.curieux", nous, memeUid = false, composantDeLaSession = false))
    }

    @Test
    fun `un nom de paquet approchant ne suffit pas`() {
        // La comparaison est exacte : un paquet nommé « tv.flixtunes.app.faux » n'est pas le nôtre.
        assertFalse(ControleursAutorises.autorise("tv.flixtunes.app.faux", nous, memeUid = false, composantDeLaSession = false))
        assertFalse(ControleursAutorises.autorise("tv.flixtunes", nous, memeUid = false, composantDeLaSession = false))
    }
}
