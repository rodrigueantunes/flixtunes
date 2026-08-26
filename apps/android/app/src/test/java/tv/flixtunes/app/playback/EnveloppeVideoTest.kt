package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * L'enveloppe d'image envoyée au serveur.
 *
 * Ce n'est pas un détail d'affichage : c'est elle qui décide si un film est lu directement ou converti,
 * et à quelle définition il l'est. Envoyée à l'envers, elle faisait convertir sans nécessité un film que
 * le téléphone savait lire, en le rabotant à la largeur du panneau tenu debout.
 */
class EnveloppeVideoTest {
    @Test
    fun `un panneau de telephone est retourne dans le sens du film`() {
        // 1080 × 2400 est la forme sous laquelle un téléphone annonce son écran : portrait.
        assertEquals(2400 to 1080, enveloppeVideo(1080, 2400))
    }

    @Test
    fun `un televiseur est deja dans le bon sens et ne bouge pas`() {
        assertEquals(3840 to 2160, enveloppeVideo(3840, 2160))
        assertEquals(1920 to 1080, enveloppeVideo(1920, 1080))
    }

    @Test
    fun `un film 1080p tient dans l enveloppe d un telephone 1080p`() {
        // Le cas qui échouait : 1920 comparé à 1080 concluait à l'incapacité, donc à la conversion.
        val (largeur, hauteur) = enveloppeVideo(1080, 2400)
        assertEquals(true, 1920 <= largeur && 1080 <= hauteur)
    }

    @Test
    fun `un film 4K ne tient pas dans un panneau 1080p et doit bien etre converti`() {
        // La correction ne doit pas rendre l'enveloppe complaisante : ce qui dépasse dépasse toujours.
        val (largeur, hauteur) = enveloppeVideo(1080, 1920)
        assertEquals(false, 3840 <= largeur && 2160 <= hauteur)
    }

    @Test
    fun `un panneau carre reste carre`() {
        assertEquals(1440 to 1440, enveloppeVideo(1440, 1440))
    }

    @Test fun `la definition annoncee vient du decodeur, pas de la dalle`() {
        // Le defaut que le client Web a connu, transpose ici. Une dalle 2400 x 1080 faisait declarer
        // qu'un film 4K depassait l'appareil, alors que son decodeur le lit sans peine et que le
        // systeme reduit ensuite l'image gratuitement. Le serveur partait donc en conversion 4K, qu'un
        // NAS Celeron ne produit pas : le film ne demarrait pas du tout.
        assertEquals(3840 to 2160, enveloppeDecodage(decodeur = 3840 to 2160, dalle = 2400 to 1080))
    }

    @Test fun `la dalle sert de plancher quand aucun decodeur ne se declare`() {
        // Certaines puces anciennes n'exposent pas leur taille maximale. Annoncer moins que ce que
        // l'ecran affiche serait pire que la mesure d'origine.
        assertEquals(2400 to 1080, enveloppeDecodage(decodeur = null, dalle = 2400 to 1080))
        assertEquals(2400 to 1080, enveloppeDecodage(decodeur = 1280 to 720, dalle = 2400 to 1080))
    }

    @Test fun `le resultat reste oriente dans le sens ou une video se regarde`() {
        // `Display.Mode` et `MediaCodecInfo` rapportent tous deux dans l'orientation native du
        // materiel : un decodeur portrait produirait sinon une enveloppe couchee.
        assertEquals(3840 to 2160, enveloppeDecodage(decodeur = 2160 to 3840, dalle = 1080 to 2400))
    }
}
