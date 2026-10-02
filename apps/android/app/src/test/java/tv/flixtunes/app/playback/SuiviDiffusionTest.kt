package tv.flixtunes.app.playback

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Ce que le téléphone montre pendant une diffusion : la cible en cours, son étape, et le volume. */
class SuiviDiffusionTest {
    private fun cible(id: String, protocole: String, lecture: String?, occupe: Boolean = false, etape: String? = null) = JSONObject()
        .put("id", id).put("nom", "Tv Salon").put("protocole", protocole).put("modele", "Philips").put("occupe", occupe)
        .put("etat", if (lecture == null) JSONObject.NULL else JSONObject().put("lecture", lecture)
            .put("contenu", JSONObject().put("genre", "media").put("id", "film").put("titre", "Film"))
            .put("qualite", "Conversion compatible · 720p maximum").put("volume", .4).apply { if (etape != null) put("etape", etape) })

    @Test fun retientLaDiffusionEnCoursVersUnTeleviseurLibre() {
        val active = diffusionActive(listOf(
            cible("ft-1", "flixtunes", "lecture"),
            cible("cast-occupe", "googlecast", "lecture", occupe = true),
            cible("cast-repos", "googlecast", "repos"),
            cible("cast-tv", "googlecast", "pause"),
        ))
        assertEquals("cast-tv", active?.getString("id"))
        assertNull(diffusionActive(listOf(cible("cast-tv", "googlecast", null))))
    }

    @Test fun direLEtapeDeLaPreparation() {
        val etat = cible("cast-tv", "googlecast", "chargement", etape = "preparation").getJSONObject("etat")
        assertEquals("Préparation de la vidéo · Conversion compatible · 720p maximum…", libelleEtatDiffusion(etat, "Tv Salon"))
        assertEquals("Vérification des formats que lit Tv Salon…", libelleEtatDiffusion(etat.put("etape", "sonde"), "Tv Salon"))
        assertEquals("Lecture terminée", libelleEtatDiffusion(JSONObject().put("lecture", "repos").put("motifRepos", "fin"), "Tv Salon"))
        assertEquals("Tv Salon a été repris par une autre application", libelleEtatDiffusion(JSONObject().put("lecture", "repos").put("motifRepos", "tiers"), "Tv Salon"))
    }

    @Test fun nommeLeProtocoleEtLeModele() {
        assertEquals("Google Cast · Philips", libelleProtocole(cible("cast-tv", "googlecast", null)))
        assertEquals("DLNA", libelleProtocole(JSONObject().put("protocole", "dlna").put("nom", "TV")))
    }

    @Test fun lesTouchesDeVolumeAvancentDeCinqPourCentEtRestentBornees() {
        assertEquals(.4, volumeApresTouche(.35, monter = true), 1e-9)
        assertEquals(1.0, volumeApresTouche(.98, monter = true), 1e-9)
        assertEquals(0.0, volumeApresTouche(.02, monter = false), 1e-9)
    }

    @Test fun formateLesDurees() {
        assertEquals("1:02:03", dureeLisible(3723.4))
        assertEquals("4:05", dureeLisible(245.0))
    }
}
