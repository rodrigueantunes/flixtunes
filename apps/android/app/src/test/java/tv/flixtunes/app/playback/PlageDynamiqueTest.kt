package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Sélecteur de plage dynamique, à parité avec le lecteur Web.
 *
 * Il ne s'agit pas d'un réglage d'agrément : quand un écran annonce un HDR qu'il rend mal, c'est le
 * seul moyen de demander au serveur la version convertie. Le lecteur Android ne l'offrait pas.
 */
class PlageDynamiqueTest {
    @Test
    fun `une source sdr ne propose rien`() {
        assertFalse(sourceEstHdr("sdr"))
        assertTrue(plagesProposees("sdr", emptyList()).isEmpty())
    }

    @Test
    fun `un format inconnu ne propose rien non plus`() {
        // Le flux n'est pas encore décrit : proposer un choix reviendrait à inventer une capacité.
        assertFalse(sourceEstHdr(null))
        assertFalse(sourceEstHdr(""))
        assertTrue(plagesProposees(null, emptyList()).isEmpty())
        assertTrue(plagesProposees("", emptyList()).isEmpty())
    }

    @Test
    fun `le lecteur ne montre que les sorties du fichier acceptees par l appareil`() {
        assertEquals(listOf("auto", "hdr10plus", "hdr10", "sdr"),
            plagesProposees("hdr10plus", listOf("hdr10plus", "hdr10", "hlg")).map { it.cle })
        assertEquals(listOf("auto", "dolbyvision", "hdr10", "sdr"),
            plagesProposees("dolbyvision", listOf("dolbyvision", "hdr10"), "hdr10").map { it.cle })
    }

    @Test
    fun `un master hybride propose dolby vision et hdr10 plus`() {
        assertEquals(listOf("auto", "dolbyvision", "hdr10plus", "hdr10", "sdr"),
            plagesProposees(
                "dolbyvision",
                listOf("dolbyvision", "hdr10plus", "hdr10"),
                coucheBase = "hdr10",
                formatsSource = listOf("dolbyvision", "hdr10plus"),
            ).map { it.cle })
    }

    @Test
    fun `les libelles sont ceux du lecteur web`() {
        // Un réglage nommé autrement d'un appareil à l'autre est un réglage qu'on croit différent.
        assertEquals(listOf("Automatique · DV → HDR10+ → HDR10 → HLG → SDR", "HDR10", "SDR (conversion)"),
            plagesProposees("hdr10", listOf("hdr10")).map { it.libelle })
    }

    @Test
    fun `le choix automatique vient en tete`() {
        // Comme pour la qualité : l'absence de contrainte se présente en premier, sinon on croit
        // qu'un réglage forcé est l'état normal.
        assertEquals("auto", plagesProposees("dolbyvision", listOf("dolbyvision")).first().cle)
    }

    @Test fun `le profil dolby vision 8 expose sa couche hdr10`() {
        assertEquals("hdr10", coucheBaseDolbyVision(8, null))
        assertEquals("hlg", coucheBaseDolbyVision(8, 4))
        assertEquals(null, coucheBaseDolbyVision(5, null))
    }
}
