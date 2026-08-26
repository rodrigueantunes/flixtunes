package tv.flixtunes.app

import android.content.Intent
import android.media.MediaPlayer
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalConfiguration
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import tv.flixtunes.app.data.DiscoveredServer
import tv.flixtunes.app.data.Media
import tv.flixtunes.app.data.ServerDiscovery
import tv.flixtunes.app.ui.LocalGabarit
import tv.flixtunes.app.ui.ThemeFlixTunes
import tv.flixtunes.app.ui.ecrans.FlixTunesApp
import tv.flixtunes.app.ui.estAppareilTv
import tv.flixtunes.app.ui.gabaritPour

class MainActivity : ComponentActivity() {
    private val model by viewModels<MainViewModel>()
    private lateinit var discovery: ServerDiscovery
    private var discovered by mutableStateOf<List<DiscoveredServer>>(emptyList())

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) MediaPlayer.create(this, R.raw.flixtunes_startup)?.apply {
            setOnCompletionListener { completed -> completed.release() }
            setOnErrorListener { failed, _, _ -> failed.release(); true }
            start()
        }
        enableEdgeToEdge()
        discovery = ServerDiscovery(this) { server -> runOnUiThread { if (discovered.none { it.url == server.url }) discovered = discovered + server } }
        // Une seule décision, prise ici et fournie en ambiance : les écrans ne transportent plus le
        // drapeau de bout en bout, et la surface se lit d'un seul tenant dans `Gabarit`.
        val televiseur = estAppareilTv(this)
        setContent {
            // La largeur est relue par Compose : rotation et dépliage changent de gabarit sans
            // recréer artificiellement l'activité. Le mode TV reste décidé par le système.
            val gabarit = gabaritPour(televiseur, LocalConfiguration.current.screenWidthDp)
            CompositionLocalProvider(LocalGabarit provides gabarit) {
                ThemeFlixTunes { FlixTunesApp(model, discovered, ::play) }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        discovery.start()
        if (model.state.profile != null) {
            model.loadHome()
            model.refreshDetails()
        }
    }
    override fun onPause() { discovery.stop(); super.onPause() }

    private fun play(media: Media) {
        val playable = media.playableMediaId ?: if (media.kind != "show") media.id else return
        val state = model.state
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_SERVER, state.server); putExtra(PlayerActivity.EXTRA_PROFILE_ID, state.profile?.id)
            putExtra(PlayerActivity.EXTRA_MEDIA_ID, playable); putExtra(PlayerActivity.EXTRA_TITLE, media.displayTitle)
            putExtra(PlayerActivity.EXTRA_PROGRESS, media.progressPercent)
            media.progressPositionSeconds?.let { putExtra(PlayerActivity.EXTRA_PROGRESS_SECONDS, it) }
            media.progressDurationSeconds?.let { putExtra(PlayerActivity.EXTRA_PROGRESS_DURATION_SECONDS, it) }
            putExtra(PlayerActivity.EXTRA_PROFILE_TOKEN, model.profileAccessToken())
            putStringArrayListExtra(PlayerActivity.EXTRA_AUDIO_LANGUAGES, ArrayList(state.profile?.preferredAudioLanguages.orEmpty()))
            putStringArrayListExtra(PlayerActivity.EXTRA_SUBTITLE_LANGUAGES, ArrayList(state.profile?.preferredSubtitleLanguages.orEmpty()))
            putExtra(PlayerActivity.EXTRA_SUBTITLE_MODE, state.profile?.subtitleMode ?: "forced")
            putExtra(PlayerActivity.EXTRA_AUDIO_OUTPUT, state.profile?.audioOutputMode ?: "auto")
            putExtra(PlayerActivity.EXTRA_AUDIO_NORMALIZATION, state.profile?.audioNormalization ?: false)
            putExtra(PlayerActivity.EXTRA_NIGHT_MODE, state.profile?.nightMode ?: false)
            putExtra(PlayerActivity.EXTRA_DYNAMIC_RANGE_PRIORITY, state.profile?.dynamicRangePriority ?: "auto")
            putExtra(PlayerActivity.EXTRA_RESUME_MODE, state.profile?.resumeMode ?: "continue")
            putExtra(PlayerActivity.EXTRA_RESUME_REWIND, state.profile?.resumeRewindSeconds ?: 5)
            putExtra(PlayerActivity.EXTRA_PLAYBACK_RATE, state.profile?.defaultPlaybackRate ?: 1f)
            putExtra(PlayerActivity.EXTRA_AUTOPLAY_NEXT, state.profile?.autoplayNext ?: true)
            putExtra(PlayerActivity.EXTRA_AUTOPLAY_LIMIT, state.profile?.autoplayLimit ?: 3)
        })
    }
}
