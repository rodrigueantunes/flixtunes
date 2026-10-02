package tv.flixtunes.app.playback

import android.content.Context
import android.os.Handler
import androidx.media3.common.Format
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.DecoderReuseEvaluation
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.mediacodec.MediaCodecInfo
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.video.MediaCodecVideoRenderer
import androidx.media3.exoplayer.video.VideoRendererEventListener

/** Les métadonnées inconnues restent inconnues : aucune conversion HDR/SDR n'est imposée. */
@UnstableApi
fun reconfigurerRenduDirectTv(avant: Format, apres: Format): Boolean =
    avant.width != apres.width || avant.height != apres.height ||
        avant.sampleMimeType != apres.sampleMimeType || avant.colorInfo != apres.colorInfo

/**
 * Le secours peut charger des segments sans initialiser un codec vidéo hors écran.
 * Le codec est créé sur la vraie SurfaceView ; changer de surface le recrée au lieu de lui
 * transférer la configuration d'une PlaceholderSurface. Le chemin audio reste celui de Media3.
 */
@UnstableApi
class RenduDirectTv(context: Context) : DefaultRenderersFactory(context) {
    override fun buildVideoRenderers(context: Context, extensionRendererMode: Int,
        mediaCodecSelector: MediaCodecSelector, enableDecoderFallback: Boolean,
        eventHandler: Handler, eventListener: VideoRendererEventListener,
        allowedVideoJoiningTimeMs: Long, out: ArrayList<Renderer>) {
        out.add(object : MediaCodecVideoRenderer(MediaCodecVideoRenderer.Builder(context)
            .setCodecAdapterFactory(codecAdapterFactory)
            .setMediaCodecSelector(mediaCodecSelector)
            .setEnableDecoderFallback(enableDecoderFallback)
            .setAllowedJoiningTimeMs(allowedVideoJoiningTimeMs)
            .setEventHandler(eventHandler).setEventListener(eventListener)
            .setMaxDroppedFramesToNotify(50)) {
            override fun shouldUsePlaceholderSurface(codecInfo: MediaCodecInfo) = false
            override fun shouldUseDetachedSurface(codecInfo: MediaCodecInfo) = false
            override fun codecNeedsSetOutputSurfaceWorkaround(name: String) = true

            override fun canReuseCodec(codecInfo: MediaCodecInfo, oldFormat: Format,
                newFormat: Format, isAdaptiveFormatChange: Boolean): DecoderReuseEvaluation {
                if (reconfigurerRenduDirectTv(oldFormat, newFormat)) return DecoderReuseEvaluation(
                    codecInfo.name, oldFormat, newFormat, DecoderReuseEvaluation.REUSE_RESULT_NO,
                    DecoderReuseEvaluation.DISCARD_REASON_WORKAROUND)
                return super.canReuseCodec(codecInfo, oldFormat, newFormat, isAdaptiveFormatChange)
            }
        })
    }
}
