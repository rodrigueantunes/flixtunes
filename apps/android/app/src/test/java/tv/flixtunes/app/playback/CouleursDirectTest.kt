package tv.flixtunes.app.playback

import androidx.media3.common.C
import androidx.media3.common.ColorInfo
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@UnstableApi
class CouleursDirectTest {
    private fun format(transfert: Int, plage: Int = C.COLOR_RANGE_LIMITED): Format = Format.Builder()
        .setSampleMimeType(MimeTypes.VIDEO_H265)
        .setColorInfo(ColorInfo.Builder().setColorTransfer(transfert).setColorRange(plage).build()).build()

    @Test fun `un raccord ou un seek HDR réarme la sortie`() {
        val hdr = format(C.COLOR_TRANSFER_ST2084)
        val hlg = format(C.COLOR_TRANSFER_HLG)
        val sdr = format(C.COLOR_TRANSFER_SDR)
        assertTrue(rearmerCouleursDirect(hdr, hdr))
        assertTrue(rearmerCouleursDirect(hlg, hlg))
        assertTrue(rearmerCouleursDirect(hdr, sdr))
        assertTrue(rearmerCouleursDirect(sdr, hlg))
        val dv = Format.Builder().setSampleMimeType(MimeTypes.VIDEO_DOLBY_VISION).build()
        assertTrue(rearmerCouleursDirect(null, dv))
    }

    @Test fun `le SDR inchangé conserve sa surface et les couleurs inconnues ne sont pas inventées`() {
        assertFalse(rearmerCouleursDirect(format(C.COLOR_TRANSFER_SDR), format(C.COLOR_TRANSFER_SDR)))
        assertFalse(rearmerCouleursDirect(null, null))
    }

    @Test fun `une variation de plage des noirs réarme aussi la sortie`() {
        assertTrue(rearmerCouleursDirect(format(C.COLOR_TRANSFER_SDR), format(C.COLOR_TRANSFER_SDR, C.COLOR_RANGE_FULL)))
    }
}
