package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Choix des sous-titres en lecture directe.
 *
 * Le réglage par défaut est « forcé », et c'est le plus facile à rendre de travers : ces sous-titres
 * ne traduisent pas le film mais ce qui reste étranger dedans. Les afficher au mauvais moment donne
 * un film doublé *et* sous-titré, ce que personne ne demande.
 */
class SubtitleChoiceTest {
    private fun st(index: Int, langue: String?, forcee: Boolean = false, sourds: Boolean = false) =
        PisteSousTitre(index, langue, forcee, sourds)

    @Test
    fun `le mode « off » n'affiche rien, quoi que contienne le fichier`() {
        assertNull(choisirSousTitre(listOf(st(0, "fra"), st(1, "fra", forcee = true)), listOf("fr"), "off", "fr"))
    }

    @Test
    fun `le mode « forcé » suit la langue écoutée, pas les préférences`() {
        // Bande son française, sous-titres forcés français : les quelques répliques en langue
        // étrangère seront traduites, le reste non.
        val pistes = listOf(st(0, "fra", forcee = true), st(1, "eng", forcee = true))
        assertEquals(0, choisirSousTitre(pistes, listOf("fr"), "forced", langueAudio = "fra")?.index)
    }

    @Test
    fun `le mode « forcé » n'impose pas des sous-titres d'une autre langue que la bande son`() {
        // Bande son japonaise : des forcés français ne traduiraient pas les passages étrangers, ils
        // doubleraient le film entier par écrit.
        val pistes = listOf(st(0, "fra", forcee = true))
        assertNull(choisirSousTitre(pistes, listOf("fr"), "forced", langueAudio = "jpn"))
    }

    @Test
    fun `le mode « forcé » ne prend jamais une piste complète`() {
        // Une piste complète afficherait tout le dialogue par-dessus une bande son qu'on comprend.
        val pistes = listOf(st(0, "fra", forcee = false))
        assertNull(choisirSousTitre(pistes, listOf("fr"), "forced", langueAudio = "fra"))
    }

    @Test
    fun `le mode « toujours » prend une piste complète dans la langue préférée`() {
        val pistes = listOf(st(0, "eng"), st(1, "fra"))
        assertEquals(1, choisirSousTitre(pistes, listOf("fr", "en"), "always", langueAudio = "eng")?.index)
    }

    @Test
    fun `le mode « toujours » respecte l'ordre des préférences`() {
        val pistes = listOf(st(0, "spa"), st(1, "eng"), st(2, "fra"))
        assertEquals(2, choisirSousTitre(pistes, listOf("fr", "en"), "always", langueAudio = "spa")?.index)
    }

    @Test
    fun `le mode « toujours » se rabat sur une piste forcée s'il n'y a pas mieux`() {
        // Quelques répliques traduites valent mieux que rien quand on a demandé des sous-titres.
        val pistes = listOf(st(0, "eng"), st(1, "fra", forcee = true))
        assertEquals(1, choisirSousTitre(pistes, listOf("fr"), "always", langueAudio = "eng")?.index)
    }

    @Test
    fun `ne préfère pas une piste pour sourds à une piste ordinaire de la même langue`() {
        // Elle décrit des bruits que la personne entend : « [porte qui claque] » n'a pas sa place
        // pour qui n'a rien demandé de tel.
        val pistes = listOf(st(0, "fra", sourds = true), st(1, "fra"))
        assertEquals(1, choisirSousTitre(pistes, listOf("fr"), "always", langueAudio = "eng")?.index)
    }

    @Test
    fun `n'affiche pas une langue que personne n'a demandée`() {
        // Des sous-titres hongrois sur un film français gênent plus que leur absence.
        val pistes = listOf(st(0, "hun"), st(1, "pol"))
        assertNull(choisirSousTitre(pistes, listOf("fr", "en"), "always", langueAudio = "fra"))
    }

    @Test
    fun `reconnaît les codes de langue équivalents`() {
        val pistes = listOf(st(0, "fre", forcee = true))
        assertEquals(0, choisirSousTitre(pistes, listOf("fr"), "forced", langueAudio = "fra")?.index)
    }

    @Test
    fun `rend null sur un fichier sans sous-titres`() {
        assertNull(choisirSousTitre(emptyList(), listOf("fr"), "always", langueAudio = "fra"))
    }
}
