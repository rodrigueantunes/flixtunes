package tv.flixtunes.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import tv.flixtunes.app.data.Details
import tv.flixtunes.app.data.Media
import tv.flixtunes.app.data.Season
import tv.flixtunes.app.ui.ecrans.estChaineWeb
import tv.flixtunes.app.ui.ecrans.retourDeNiveau

/**
 * La carte de retour du rayon Web, sur téléviseur comme sur mobile.
 *
 * Elle manquait à la racine d'une chaîne : on remontait de dossier en dossier, puis elle disparaissait
 * sur la dernière marche. Sur mobile il restait le fil d'Ariane, en haut de l'écran ; à la
 * télécommande il fallait en plus remonter toute la grille pour l'atteindre. Elle est là partout, et
 * c'est depuis la racine qu'elle ressort de la chaîne.
 *
 * Les deux surfaces partagent cet écran — seul le gabarit change —, donc ce cas les couvre toutes deux.
 */
class ChaineWebTest {
    @Test
    fun `a la racine d'une chaine, la carte ramene aux chaines`() {
        val retour = retourDeNiveau(emptyList(), "Chaine documentaire")
        assertEquals("Retour aux chaînes", retour.libelle)
        assertEquals("Web", retour.sousTitre)
        assertTrue(retour.sortDeLaChaine)
    }

    @Test
    fun `dans un dossier de premier niveau, elle nomme la chaine`() {
        val retour = retourDeNiveau(listOf("Grands formats"), "Chaine documentaire")
        assertEquals("Dossier parent", retour.libelle)
        assertEquals("Chaine documentaire", retour.sousTitre)
        assertFalse(retour.sortDeLaChaine)
    }

    @Test
    fun `plus profond, elle nomme le dossier au-dessus`() {
        val retour = retourDeNiveau(listOf("Grands formats", "Archives"), "Chaine documentaire")
        assertEquals("Dossier parent", retour.libelle)
        assertEquals("Grands formats", retour.sousTitre)
        assertFalse(retour.sortDeLaChaine)
    }
}

/** Un média minimal : seuls le type et le titre comptent pour ces cas. */
private fun media(kind: String, titre: String = "Un titre", seasonCount: Int? = null, airDate: String? = null) = Media(
    id = titre, catalogId = titre, playableMediaId = null, kind = kind, title = titre, year = null,
    overview = null, posterUrl = null, backdropUrl = null, showTitle = null, seasonNumber = 1,
    episodeNumber = 2, runtimeSeconds = null, progressPercent = 0, completed = false,
    seasonCount = seasonCount, airDate = airDate,
)

private fun palier(titre: String, episodes: List<Media>) =
    Season(id = titre, number = 1, title = titre, posterUrl = null, episodes = episodes)

/**
 * Une chaîne web n'a ni saison ni épisode, et ne doit pas s'en donner l'air.
 *
 * Elle est pourtant **stockée** comme une série : c'est ce qui lui vaut la fiche, la reprise et
 * l'enchaînement sans code neuf. Rien dans sa forme ne la distingue, si bien que chaque écran qui
 * s'en remet à la forme la présente en saisons — la grille du rayon disait « 3 saisons » pour trois
 * dossiers, et la fiche retombait sur celle des séries dès qu'un dossier était vide.
 */
class ChaineWebPresentationTest {
    @Test
    fun `une chaine n'annonce pas de saisons dans le rayon Web`() {
        assertEquals("3 saisons", media("show", seasonCount = 3).secondaryText)
        assertEquals("", media("show", seasonCount = 3).texteSecondaireWeb)
    }

    @Test
    fun `une video garde sa date dans le rayon Web`() {
        val video = media("video", airDate = "2024-05-01")
        assertEquals(video.secondaryText, video.texteSecondaireWeb)
        assertTrue(video.texteSecondaireWeb.contains("2024"))
    }

    @Test
    fun `le rayon annonce par le serveur tranche`() {
        // Une chaine dont tous les paliers seraient vides, ou dont un palier porterait autre chose :
        // la forme ne sait pas conclure, le rayon si.
        val chaine = Details(
            item = media("show", "Chaine documentaire"),
            seasons = listOf(palier("Archives", emptyList())),
            related = emptyList(),
            libraryKind = "web",
        )
        assertTrue(chaine.estChaineWeb)

        // Et l'inverse : une serie annoncee comme telle ne devient jamais une chaine, quelle que
        // soit la forme de ses paliers.
        val serie = Details(
            item = media("show", "Une serie"),
            seasons = listOf(palier("Saison 1", listOf(media("video", "Un pilote mal type")))),
            related = emptyList(),
            libraryKind = "tv",
        )
        assertFalse(serie.estChaineWeb)
    }

    @Test
    fun `un dossier vide ne fait pas passer une chaine pour une serie`() {
        // Un dossier dont aucune video n'est disponible ne prouve rien et ne doit rien refuter :
        // exiger que tous les paliers portent des videos faisait retomber la chaine sur la fiche des
        // series, ou elle s'annoncait en saisons et en episodes.
        val chaine = Details(
            item = media("show", "Chaine documentaire"),
            seasons = listOf(
                palier("Grands formats", listOf(media("video", "Les routes du sel"))),
                palier("Archives", emptyList()),
            ),
            related = emptyList(),
        )
        assertTrue(chaine.estChaineWeb)
    }

    @Test
    fun `une serie reste une serie`() {
        val serie = Details(
            item = media("show", "Une serie"),
            seasons = listOf(palier("Saison 1", listOf(media("episode", "Le pilote")))),
            related = emptyList(),
        )
        assertFalse(serie.estChaineWeb)
    }

    @Test
    fun `une fiche sans palier n'est pas une chaine`() {
        val film = Details(item = media("movie", "Un film"), seasons = emptyList(), related = emptyList())
        assertFalse(film.estChaineWeb)
    }
}
