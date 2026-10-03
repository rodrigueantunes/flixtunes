package tv.flixtunes.app.playback

import android.content.Context
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionProvider

/**
 * Les options du SDK Cast, déclarées dans le manifeste. Elles ne servent qu'au relais hors de chez soi
 * (r10) : à la maison, c'est le NAS qui caste. Le lecteur est celui de Google, sans application à
 * déclarer ; arrêter la session rend le téléviseur à son écran, comme quand on quitte un cast YouTube.
 */
class OptionsCast : OptionsProvider {
    override fun getCastOptions(context: Context): CastOptions = CastOptions.Builder()
        .setReceiverApplicationId(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID)
        .setStopReceiverApplicationWhenEndingSession(true)
        .build()

    override fun getAdditionalSessionProviders(context: Context): List<SessionProvider>? = null
}
