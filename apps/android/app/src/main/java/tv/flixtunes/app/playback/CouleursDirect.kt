package tv.flixtunes.app.playback

import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi

/** Un raccord ne doit pas conserver la configuration colorimétrique de l'ancien décodeur. */
@UnstableApi
fun rearmerCouleursDirect(avant: Format?, apres: Format?): Boolean {
    fun hdr(format: Format?): Boolean =
        format?.sampleMimeType == MimeTypes.VIDEO_DOLBY_VISION ||
            format?.colorInfo?.colorTransfer == C.COLOR_TRANSFER_ST2084 ||
            format?.colorInfo?.colorTransfer == C.COLOR_TRANSFER_HLG
    return hdr(avant) || hdr(apres) ||
        (avant?.colorInfo != null && apres?.colorInfo != null && avant.colorInfo != apres.colorInfo)
}
