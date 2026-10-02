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
class RenduDirectTvTest {
    private val sdr = Format.Builder().setSampleMimeType(MimeTypes.VIDEO_H264)
        .setWidth(1920).setHeight(1080).setAverageBitrate(4_000_000)
        .setColorInfo(ColorInfo.Builder().setColorSpace(C.COLOR_SPACE_BT709)
            .setColorRange(C.COLOR_RANGE_LIMITED).setColorTransfer(C.COLOR_TRANSFER_SDR).build()).build()

    @Test fun `la baisse de definition reconfigure le codec meme si les couleurs SDR ne changent pas`() {
        val reduit = sdr.buildUpon().setWidth(1280).setHeight(720).build()
        assertTrue(reconfigurerRenduDirectTv(sdr, reduit))
        assertTrue(reconfigurerRenduDirectTv(reduit, sdr))
    }

    @Test fun `le changement de debit seul conserve le codec`() {
        assertFalse(reconfigurerRenduDirectTv(sdr, sdr.buildUpon().setAverageBitrate(2_000_000).build()))
        assertFalse(reconfigurerRenduDirectTv(sdr, sdr))
    }

    @Test fun `une plage ou des metadonnees differentes imposent une nouvelle configuration`() {
        val pleine = sdr.buildUpon().setColorInfo(sdr.colorInfo!!.buildUpon().setColorRange(C.COLOR_RANGE_FULL).build()).build()
        val inconnue = sdr.buildUpon().setColorInfo(null).build()
        assertTrue(reconfigurerRenduDirectTv(sdr, pleine))
        assertTrue(reconfigurerRenduDirectTv(sdr, inconnue))
        assertTrue(reconfigurerRenduDirectTv(inconnue, sdr))
    }

    @Test fun `un passage SDR HDR ne reutilise pas le codec`() {
        val hdr = sdr.buildUpon().setColorInfo(sdr.colorInfo!!.buildUpon()
            .setColorSpace(C.COLOR_SPACE_BT2020).setColorTransfer(C.COLOR_TRANSFER_HLG).build()).build()
        assertTrue(reconfigurerRenduDirectTv(sdr, hdr))
        assertTrue(reconfigurerRenduDirectTv(hdr, sdr))
        assertTrue(reconfigurerRenduDirectTv(sdr, sdr.buildUpon().setSampleMimeType(MimeTypes.VIDEO_H265).build()))
    }
}
