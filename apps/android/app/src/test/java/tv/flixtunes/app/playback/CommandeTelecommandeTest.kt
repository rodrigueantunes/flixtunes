package tv.flixtunes.app.playback

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * La télécommande dans le lecteur.
 *
 * Le lecteur n'y répondait pas du tout, et la cause n'était pas dans les touches : la barre de
 * commandes n'est composée que lorsqu'elle est visible, et seul un appui tactile la réveillait. Sur
 * un téléviseur, il n'y a pas de doigt — donc jamais de barre, donc rien de focusable.
 *
 * Ces tests fixent les deux régimes. Ils tiennent sans appareil : `KeyEvent` n'apporte ici que des
 * constantes entières, que le stub d'`android.jar` expose sans lever « not mocked ».
 */
class CommandeTelecommandeTest {
    @Test
    fun `barre retirée, la croix pilote la lecture`() {
        // C'est ce qu'on attend d'un lecteur quand rien n'est affiché : gauche et droite naviguent,
        // le centre pilote la lecture. Haut et bas révèlent les options sans agir sur le film.
        assertEquals(GesteTelecommande.RECULER, gesteTelecommande(KeyEvent.KEYCODE_DPAD_LEFT, false))
        assertEquals(GesteTelecommande.AVANCER, gesteTelecommande(KeyEvent.KEYCODE_DPAD_RIGHT, false))
        assertEquals(GesteTelecommande.BASCULER_LECTURE, gesteTelecommande(KeyEvent.KEYCODE_DPAD_CENTER, false))
        assertEquals(GesteTelecommande.REVEILLER, gesteTelecommande(KeyEvent.KEYCODE_DPAD_UP, false))
        assertEquals(GesteTelecommande.REVEILLER, gesteTelecommande(KeyEvent.KEYCODE_DPAD_DOWN, false))
    }

    @Test
    fun `barre visible, le transport reste direct tant que les options ne sont pas parcourues`() {
        assertEquals(GesteTelecommande.RECULER, gesteTelecommande(KeyEvent.KEYCODE_DPAD_LEFT, true))
        assertEquals(GesteTelecommande.AVANCER, gesteTelecommande(KeyEvent.KEYCODE_DPAD_RIGHT, true))
        assertEquals(GesteTelecommande.BASCULER_LECTURE, gesteTelecommande(KeyEvent.KEYCODE_DPAD_CENTER, true))
        assertEquals(GesteTelecommande.PARCOURIR_COMMANDES, gesteTelecommande(KeyEvent.KEYCODE_DPAD_UP, true))
        assertEquals(GesteTelecommande.PARCOURIR_COMMANDES, gesteTelecommande(KeyEvent.KEYCODE_DPAD_DOWN, true))
    }

    @Test
    fun `dans les options la croix et ok sont rendus au focus`() {
        for (code in listOf(KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT,
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER)) {
            assertEquals(GesteTelecommande.LAISSER,
                gesteTelecommande(code, garnitureVisible = true, parcoursCommandes = true))
        }
    }

    @Test
    fun `dans un panneau toutes les directions et ok restent disponibles`() {
        for (code in listOf(KeyEvent.KEYCODE_DPAD_LEFT, KeyEvent.KEYCODE_DPAD_RIGHT,
            KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN, KeyEvent.KEYCODE_DPAD_CENTER)) {
            assertEquals(GesteTelecommande.LAISSER,
                gesteTelecommande(code, garnitureVisible = true, panneauOuvert = true))
        }
    }

    @Test
    fun `les touches multimédias ne dépendent pas de ce que l'écran affiche`() {
        // Une télécommande qui porte un bouton « pause » l'a fait faire, barre visible ou non.
        for (visible in listOf(true, false)) {
            assertEquals(GesteTelecommande.BASCULER_LECTURE, gesteTelecommande(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, visible))
            assertEquals(GesteTelecommande.LIRE, gesteTelecommande(KeyEvent.KEYCODE_MEDIA_PLAY, visible))
            assertEquals(GesteTelecommande.PAUSE, gesteTelecommande(KeyEvent.KEYCODE_MEDIA_PAUSE, visible))
            assertEquals(GesteTelecommande.PAUSE, gesteTelecommande(KeyEvent.KEYCODE_MEDIA_STOP, visible))
            assertEquals(GesteTelecommande.RECULER, gesteTelecommande(KeyEvent.KEYCODE_MEDIA_REWIND, visible))
            assertEquals(GesteTelecommande.AVANCER, gesteTelecommande(KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, visible))
        }
    }

    @Test
    fun `le retour referme d'abord le panneau ouvert`() {
        // Sans cela, sortir de la liste des pistes fermait le film entier — un geste de trop, et pas
        // celui qu'on croyait faire.
        for (visible in listOf(true, false)) {
            assertEquals(
                GesteTelecommande.FERMER_PANNEAU,
                gesteTelecommande(KeyEvent.KEYCODE_BACK, visible, panneauOuvert = true),
            )
        }
    }

    @Test
    fun `le retour masque ensuite les commandes avant de quitter`() {
        assertEquals(GesteTelecommande.MASQUER,
            gesteTelecommande(KeyEvent.KEYCODE_BACK, garnitureVisible = true))
        assertEquals(GesteTelecommande.LAISSER,
            gesteTelecommande(KeyEvent.KEYCODE_BACK, garnitureVisible = false))
    }

    @Test
    fun `le retour et le volume restent au système`() {
        // Les avaler ferait du lecteur une impasse : on n'en sortirait plus, et le volume cesserait
        // de répondre pendant tout le film.
        for (visible in listOf(true, false)) {
            assertEquals(GesteTelecommande.LAISSER, gesteTelecommande(KeyEvent.KEYCODE_VOLUME_UP, visible))
            assertEquals(GesteTelecommande.LAISSER, gesteTelecommande(KeyEvent.KEYCODE_VOLUME_DOWN, visible))
            assertEquals(GesteTelecommande.LAISSER, gesteTelecommande(KeyEvent.KEYCODE_HOME, visible))
        }
    }

    @Test
    fun `le pas de navigation est celui des boutons`() {
        // Deux pas différents pour le même geste selon qu'on appuie sur un bouton ou sur la croix
        // rendraient la navigation imprévisible.
        assertEquals(10.0, PAS_NAVIGATION_SECONDES, 0.0)
    }

    @Test
    fun `seule la timeline transforme gauche droite en transport quand les commandes sont parcourues`() {
        assertEquals(GesteTelecommande.RECULER, gesteBarreProgression(KeyEvent.KEYCODE_DPAD_LEFT))
        assertEquals(GesteTelecommande.AVANCER, gesteBarreProgression(KeyEvent.KEYCODE_DPAD_RIGHT))
        assertEquals(GesteTelecommande.BASCULER_LECTURE, gesteBarreProgression(KeyEvent.KEYCODE_DPAD_CENTER))
        assertEquals(GesteTelecommande.LAISSER, gesteBarreProgression(KeyEvent.KEYCODE_DPAD_UP))
        assertEquals(GesteTelecommande.LAISSER, gesteBarreProgression(KeyEvent.KEYCODE_DPAD_DOWN))
    }

}
