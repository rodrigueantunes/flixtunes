package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceCapabilitiesTest {
    @Test fun `mobile ne promet que les conteneurs directs fiables`() {
        assertEquals(listOf("mp4"), safeContainers(isTv = false, forceTranscode = false))
    }

    @Test fun `repli force AAC et MP4`() {
        assertEquals(listOf("aac"), safeAudioCodecs(listOf("aac", "eac3", "truehd"), isTv = true, forceTranscode = true))
        assertEquals(listOf("mp4"), safeContainers(isTv = true, forceTranscode = true))
        assertEquals("compatible", playbackMode(forceTranscode = true))
    }

    @Test fun `mobile exclut les formats audio de passthrough risqués`() {
        assertEquals(listOf("aac", "opus", "mp3"), safeAudioCodecs(listOf("aac", "eac3", "opus", "truehd", "mp3"), isTv = false, forceTranscode = false))
    }

    @Test fun `lecture normale laisse le serveur choisir le chemin optimal`() {
        assertEquals("auto", playbackMode(forceTranscode = false))
    }

    @Test fun `le repli demande d abord une copie, pas une conversion`() {
        // Le serveur tente désormais la lecture directe sur un conteneur que nous n'avons pas déclaré.
        // Si notre décodeur la refuse, l'échec désigne d'abord le conteneur : demander une conversion
        // complète remplacerait un remux — qui copie l'image au bit près — par le travail que le NAS
        // peine le plus à produire. Le mode intermédiaire existe pour cette marche-là.
        assertEquals("remux", playbackMode(forceTranscode = false, remuxSeulement = true))
    }

    @Test fun `la conversion complète l emporte sur la copie`() {
        // Les deux drapeaux peuvent se retrouver posés ensemble après deux échecs successifs. Le
        // second repli ne doit pas être ramené au premier, sinon la lecture tournerait en rond.
        assertEquals("compatible", playbackMode(forceTranscode = true, remuxSeulement = true))
    }

    @Test fun `TV ne promet le bitstream home cinema que si la sortie HDMI l annonce`() {
        assertEquals(listOf("aac", "eac3", "truehd"), safeAudioCodecs(
            detected = listOf("aac", "ac3", "eac3", "dts", "truehd"), isTv = true, forceTranscode = false,
            passthrough = listOf("eac3", "truehd"),
        ))
    }

    @Test
    fun `l'Atmos se déclare dès qu'un des deux porteurs sort de l'appareil`() {
        // Atmos ne voyage pas seul : E-AC3 marqué JOC, ou TrueHD. L'un suffit.
        //
        // La règle était écrite en ligne et fausse par priorité d'opérateurs :
        // `if (c) A else false || B` se lit `if (c) A else (false || B)`. Sur Android 9 et au-delà,
        // c'est-à-dire sur tous les téléviseurs concernés, le repli TrueHD n'était jamais examiné.
        assertTrue(atmosDisponible(jocDisponible = true, trueHdDisponible = false, forceTranscode = false))
        assertTrue(atmosDisponible(jocDisponible = false, trueHdDisponible = true, forceTranscode = false))
        assertTrue(atmosDisponible(jocDisponible = true, trueHdDisponible = true, forceTranscode = false))
        assertFalse(atmosDisponible(jocDisponible = false, trueHdDisponible = false, forceTranscode = false))
    }

    @Test
    fun `une conversion forcée retire l'Atmos`() {
        // Demander la conversion, c'est demander un flux que le serveur refabrique : rien n'y sort
        // plus sans être décodé, et annoncer l'Atmos ferait promettre ce qui ne peut pas arriver.
        assertFalse(atmosDisponible(jocDisponible = true, trueHdDisponible = true, forceTranscode = true))
    }

    @Test fun `Dolby Vision exige écran et décodeur`() {
        assertEquals(emptyList<Int>(), profilsDolbyVision(decodeurDeclare = false, ecranDeclare = true, profilsCodec = setOf(256)))
        assertEquals(emptyList<Int>(), profilsDolbyVision(decodeurDeclare = true, ecranDeclare = false, profilsCodec = setOf(256)))
    }

    @Test fun `les drapeaux Android Dolby Vision deviennent les vrais numéros de profils`() {
        assertEquals(listOf(5, 7, 8, 9, 10), profilsDolbyVision(
            decodeurDeclare = true, ecranDeclare = true, profilsCodec = setOf(32, 128, 256, 512, 1024),
        ))
    }

    @Test fun `un pilote Dolby Vision sans niveaux ne promet aucun profil au hasard`() {
        assertEquals(emptyList<Int>(), profilsDolbyVision(
            decodeurDeclare = true, ecranDeclare = true, profilsCodec = emptySet(),
        ))
    }

    @Test fun `un pilote Dolby Vision incomplet annonce uniquement le profil du fichier`() {
        assertEquals(listOf(8), profilsDolbyVisionPourSource(
            decodeurDeclare = true, ecranDeclare = true, profilsCodec = emptySet(), profilSource = 8,
        ))
        assertEquals(emptyList<Int>(), profilsDolbyVisionPourSource(
            decodeurDeclare = true, ecranDeclare = false, profilsCodec = emptySet(), profilSource = 8,
        ))
        assertEquals(emptyList<Int>(), profilsDolbyVisionPourSource(
            decodeurDeclare = true, ecranDeclare = true, profilsCodec = emptySet(), profilSource = null,
        ))
    }

    @Test fun `un profil ffprobe devient le drapeau android exact`() {
        assertEquals(32, profilAndroidDolbyVision(5))
        assertEquals(256, profilAndroidDolbyVision(8))
        assertEquals(null, profilAndroidDolbyVision(20))
    }

    @Test fun `une piste dolby vision doit être reconnue comme telle et pas comme hevc`() {
        assertTrue(pisteDolbyVisionReconnue("video/dolby-vision", null))
        assertTrue(pisteDolbyVisionReconnue("video/hevc", "dvhe.08.06"))
        assertTrue(pisteDolbyVisionReconnue("video/hevc", "dvh1.05.06"))
        assertFalse(pisteDolbyVisionReconnue("video/hevc", "hvc1.2.4.L153"))
    }

}
