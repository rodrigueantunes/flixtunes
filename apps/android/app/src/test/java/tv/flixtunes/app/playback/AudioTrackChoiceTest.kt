package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Choix de la piste audio en lecture directe.
 *
 * Le défaut visé se remarque immédiatement et passe pour une panne : le film démarre en anglais alors
 * que le profil demande le français. En conversion le serveur choisissait déjà ; en lecture directe
 * — c'est-à-dire chaque fois que tout se passe bien — personne ne choisissait.
 */
class AudioTrackChoiceTest {
    private fun piste(index: Int, langue: String?, canaux: Int = 2, descriptive: Boolean = false) =
        PisteAudio(index, langue, canaux, descriptive)

    @Test
    fun `suit l'ordre du profil, pas l'ordre du fichier`() {
        // La piste anglaise est la première du conteneur, donc celle que Media3 prendrait seul.
        val pistes = listOf(piste(0, "eng"), piste(1, "fra"))
        assertEquals(1, choisirPisteAudio(pistes, listOf("fr", "en"))?.index)
    }

    @Test
    fun `respecte le second choix quand le premier manque`() {
        val pistes = listOf(piste(0, "eng"), piste(1, "spa"))
        assertEquals(0, choisirPisteAudio(pistes, listOf("fr", "en"))?.index)
    }

    @Test
    fun `reconnaît les codes de langue équivalents`() {
        // Un même fichier annonce « fr », « fra », « fre » ou « fr-FR » selon l'outil qui l'a produit.
        // Comparer les chaînes telles quelles ferait manquer la piste française d'un fichier sur deux.
        for (code in listOf("fra", "fre", "fr-FR", "FR")) {
            assertEquals("code $code", 1, choisirPisteAudio(listOf(piste(0, "eng"), piste(1, code)), listOf("fr"))?.index)
        }
    }

    @Test
    fun `préfère le multicanal à langue égale`() {
        // Entre un 5.1 et un stéréo de la même langue, personne ne choisit le stéréo.
        val pistes = listOf(piste(0, "fra", canaux = 2), piste(1, "fra", canaux = 6))
        assertEquals(1, choisirPisteAudio(pistes, listOf("fr"))?.index)
    }

    @Test
    fun `comprend le mot-clé « original »`() {
        val pistes = listOf(piste(0, "fra"), piste(1, "jpn"))
        assertEquals(1, choisirPisteAudio(pistes, listOf("original"), langueOriginale = "ja")?.index)
    }

    @Test
    fun `ignore « original » quand la langue de tournage est inconnue`() {
        // Le fournisseur ne la rend pas toujours. Sauter cette préférence vaut mieux que choisir au
        // hasard une piste en la faisant passer pour la langue d'origine.
        val pistes = listOf(piste(0, "eng"), piste(1, "fra"))
        assertEquals(1, choisirPisteAudio(pistes, listOf("original", "fr"), langueOriginale = null)?.index)
    }

    @Test
    fun `n'impose pas une audiodescription à qui ne l'a pas demandée`() {
        // Elle porte la même langue que la piste ordinaire : sans cette règle, elle peut gagner et le
        // film se retrouve commenté d'un bout à l'autre.
        val pistes = listOf(piste(0, "fra", canaux = 6, descriptive = true), piste(1, "fra", canaux = 2))
        assertEquals(1, choisirPisteAudio(pistes, listOf("fr"))?.index)
    }

    @Test
    fun `accepte une audiodescription s'il n'y a rien d'autre`() {
        // Mieux vaut un film commenté qu'un film muet.
        val pistes = listOf(piste(0, "fra", descriptive = true))
        assertEquals(0, choisirPisteAudio(pistes, listOf("fr"))?.index)
    }

    @Test
    fun `choisit tout de même quelque chose quand aucune préférence ne correspond`() {
        // Se taire ici laisserait Media3 reprendre son choix par défaut, celui qu'on cherche justement
        // à remplacer.
        val pistes = listOf(piste(0, "jpn"), piste(1, "kor"))
        assertEquals(0, choisirPisteAudio(pistes, listOf("fr", "en"))?.index)
    }

    @Test
    fun `ignore une piste sans langue déclarée plutôt que de la croire`() {
        // « und » est la valeur que met un encodeur qui ne sait pas. La traiter comme une langue
        // ferait correspondre n'importe quelle préférence.
        assertNull(langueNormalisee("und"))
        assertNull(langueNormalisee(null))
        assertEquals(1, choisirPisteAudio(listOf(piste(0, "und"), piste(1, "fra")), listOf("fr"))?.index)
    }

    @Test
    fun `rend null sur un fichier sans piste audio`() {
        assertNull(choisirPisteAudio(emptyList(), listOf("fr")))
    }
}
