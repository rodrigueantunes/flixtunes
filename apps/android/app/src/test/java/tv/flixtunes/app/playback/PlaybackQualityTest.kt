package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Sélecteur de qualité et panneau d'infos, à parité avec le lecteur Web.
 *
 * L'enjeu n'est pas décoratif : devant une lecture qui hésite, c'est le seul moyen de savoir si le
 * serveur convertit, à quel débit, et pourquoi. Le lecteur Android n'offrait que la barre par défaut
 * de Media3.
 */
class PlaybackQualityTest {
    private fun q(index: Int, hauteur: Int, debit: Int) = Qualite(index, hauteur, debit)

    @Test
    fun `propose le choix automatique en tête`() {
        // C'est le réglage par défaut et celui qu'on veut retrouver après avoir essayé autre chose.
        val liste = qualitesProposees(listOf(q(0, 720, 3_000_000), q(1, 1080, 8_400_000)))
        assertEquals(-1, liste.first().index)
        assertEquals("Automatique", liste.first().libelle)
    }

    @Test
    fun `ordonne de la plus définie à la moins définie`() {
        val liste = qualitesProposees(listOf(q(0, 480, 1_200_000), q(1, 1080, 8_400_000), q(2, 720, 3_000_000)))
        assertEquals(listOf(0, 1080, 720, 480), liste.map { it.hauteur })
    }

    @Test
    fun `ne propose aucun menu quand il n'y a qu'une variante`() {
        // Un menu à une entrée laisse croire à un réglage qui n'en est pas un.
        assertTrue(qualitesProposees(listOf(q(0, 1080, 8_400_000))).isEmpty())
        assertTrue(qualitesProposees(emptyList()).isEmpty())
    }

    @Test
    fun `libelle une variante par sa définition et son débit`() {
        assertEquals("1080p · 8,4 Mb/s", q(0, 1080, 8_400_000).libelle)
    }

    @Test
    fun `se contente de la définition quand le débit est inconnu`() {
        assertEquals("720p", q(0, 720, 0).libelle)
    }

    @Test
    fun `nomme tout de même une variante sans définition ni débit`() {
        // Un manifeste incomplet ne doit pas produire une entrée vide, impossible à désigner.
        assertEquals("Variante 3", q(2, 0, 0).libelle)
    }

    @Test
    fun `le panneau reprend les intitulés du Web, dans le même ordre`() {
        // Les mêmes mots des deux côtés : comparer un problème entre deux appareils ne doit pas
        // obliger à traduire mentalement.
        val lignes = infosLecture("direct", "matroska", "hevc", "3840×2160", "eac3", 24_000_000, 12.5,
            3, "3840×2160 · direct", "HDR10", listOf("Le décodeur accepte HEVC Main10"))
        assertEquals(listOf("Mode", "Conteneur", "Vidéo", "Audio", "Débit source", "Tampon",
            "Images perdues", "Sortie", "Plage dynamique", "Décision"), lignes.map { it.intitule })
        assertEquals("DIRECT", lignes.first { it.intitule == "Mode" }.valeur.uppercase())
        assertEquals("HEVC · 3840×2160", lignes.first { it.intitule == "Vidéo" }.valeur)
        assertEquals("24,0 Mb/s", lignes.first { it.intitule == "Débit source" }.valeur)
        assertEquals("12,5 s", lignes.first { it.intitule == "Tampon" }.valeur)
    }

    @Test
    fun `écrit un tiret plutôt que de retirer une ligne absente`() {
        // Une ligne manquante se remarque moins qu'une ligne vide, et c'est son absence qui renseigne.
        val lignes = infosLecture(null, null, null, null, null, null, null, null, null, null, emptyList())
        assertEquals(9, lignes.size)
        assertEquals("négociation", lignes.first { it.intitule == "Mode" }.valeur)
        assertTrue(lignes.filter { it.intitule != "Mode" }.all { it.valeur == "—" })
    }

    @Test
    fun `liste toutes les raisons de la décision, la première seule intitulée`() {
        val lignes = infosLecture("compatible", null, null, null, null, null, null, null, null, null,
            listOf("Le conteneur n'est pas lisible", "La piste audio doit être convertie"))
        val raisons = lignes.takeLast(2)
        assertEquals("Décision", raisons.first().intitule)
        assertEquals("", raisons.last().intitule)
        assertEquals("La piste audio doit être convertie", raisons.last().valeur)
    }
}
