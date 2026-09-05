package tv.flixtunes.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaLabelTest {
    private fun media(
        kind: String, season: Int? = null, episode: Int? = null, count: Int? = null, airDate: String? = null,
    ) = Media(
        "id", "catalog", "id", kind, "Titre", 2026, null, null, null, if (kind == "episode") "Série" else null,
        season, episode, 100, 0, false, count, airDate = airDate,
    )

    @Test fun `formate les épisodes pour mobile et TV`() = assertEquals("S2 · E7", media("episode", 2, 7).secondaryText)
    @Test fun `accorde le nombre de saisons`() {
        assertEquals("1 saison", media("show", count = 1).secondaryText)
        assertEquals("3 saisons", media("show", count = 3).secondaryText)
    }
    @Test fun `affiche l'année des films`() = assertEquals("2026", media("movie").secondaryText)

    @Test fun `une vidéo se présente par sa date, jamais par un numéro d'épisode`() {
        // Elles étaient enregistrées en « episode » : les écrans annonçaient « S1 · E20024 », le
        // numéro d'épisode étant un nombre de jours. Une vidéo n'est pas un épisode.
        assertEquals("15 janvier 2024", media("video", airDate = "2024-01-15").secondaryText)
        assertEquals("1 février 2025", media("video", airDate = "2025-02-01").secondaryText)
    }

    @Test fun `un palier de vidéos est un dossier, pas une saison`() {
        // La fiche annonçait « Afficher la saison 3 » là où le palier s'appelle « Documentaires », et
        // « 5 épisodes » pour cinq vidéos. Le contenu tranche, faute d'une forme qui les distingue.
        val dossier = Season("s", 3, "Documentaires", null, listOf(media("video", airDate = "2024-01-15")))
        val saison = Season("s", 3, "Saison 3", null, listOf(media("episode", 3, 1)))

        assertTrue(dossier.estDossier)
        assertFalse(saison.estDossier)
    }

    @Test fun `un palier vide n'est pas déclaré dossier`() {
        // Sans contenu, rien ne permet de trancher : on ne devine pas, on reste sur la saison.
        assertFalse(Season("s", 1, "Vide", null, emptyList()).estDossier)
    }

    @Test fun `une vidéo sans date connue ne s'en invente pas`() {
        // L'année du modèle vaut 2026 ici : la reprendre laisserait croire à une date de publication.
        assertEquals("Vidéo", media("video").secondaryText)
        assertEquals("Vidéo", media("video", airDate = "pas une date").secondaryText)
    }
}
