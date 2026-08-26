package tv.flixtunes.app.playback

import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

// `DefaultTrackSelector` fait partie des API que Media3 se réserve de faire évoluer. Le lecteur en
// dépend déjà pour la même raison : c'est le seul point d'entrée pour régler le mode tunnel.
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        // Le sélecteur reste accessible : c'est par lui que le lecteur coupe le mode tunnel quand un
        // téléviseur se révèle incapable de le rendre, sans avoir à reconstruire toute la session.
        val selecteur = DefaultTrackSelector(this).apply {
            parameters = buildUponParameters().setTunnelingEnabled(Tunneling.actif(this@PlaybackService)).build()
        }
        trackSelector = selecteur
        // La pile HTTP du lecteur porte desormais le jeton de session : sans elle, manifeste, segments
        // et sous-titres partiraient sans titre d'acces et l'acces distant refuserait la video alors
        // que le catalogue s'afficherait. `DefaultDataSource` conserve les schemas non-HTTP — fichier
        // local, `content://` — que le lecteur utilise aussi.
        val sources = DefaultMediaSourceFactory(DefaultDataSource.Factory(this, FabriqueHttpFlixTunes()))
        val player = ExoPlayer.Builder(this, FlixTunesRenderersFactory(this))
            .setTrackSelector(selecteur)
            .setMediaSourceFactory(sources)
            .build()
        // Le compteur d'images perdues n'existe que sur ExoPlayer : le `MediaController` que pilote
        // l'activite ne l'expose pas. Sans ce releve, la ligne « Images perdues » du panneau d'infos
        // restait vide alors que le lecteur Web l'affiche — c'est pourtant le premier chiffre a
        // regarder quand une lecture saccade sans que le debit soit en cause.
        imagesPerdues = 0
        player.addAnalyticsListener(object : AnalyticsListener {
            override fun onDroppedVideoFrames(eventTime: AnalyticsListener.EventTime, count: Int, elapsedMs: Long) {
                imagesPerdues += count
            }
        })
        session = MediaSession.Builder(this, player).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    /**
     * L'application balayée hors des tâches récentes : on arrête, on ne veille pas.
     *
     * Un `MediaSessionService` survit par défaut au retrait de la tâche — c'est ce qui permet à une
     * application de musique de continuer. Pour de la vidéo, cela n'a pas de sens : la lecture
     * continuait sans écran, sa conversion restait demandée segment après segment sur le NAS, et son
     * créneau n'était jamais rendu.
     */
    override fun onTaskRemoved(rootIntent: android.content.Intent?) {
        session?.player?.run { stop(); clearMediaItems() }
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        HdrDirectPlayPreference.neutraliserHdr10PlusPourDolbyVision = false
        session?.run { player.release(); release() }
        session = null
        trackSelector = null
        super.onDestroy()
    }

    companion object {
        /**
         * Le sélecteur de pistes du lecteur en cours, ou `null` si le service ne tourne pas.
         *
         * L'activité pilote le lecteur par un `MediaController`, qui ne donne pas accès aux réglages
         * de sélection. Le service et l'activité vivant dans le même processus, cette référence est le
         * chemin le plus court — et le seul qui n'oblige pas à recréer la session pour changer un
         * réglage au moment précis où la lecture vient d'échouer.
         */
        @Volatile
        var trackSelector: DefaultTrackSelector? = null
            private set

        /** Images que le decodeur n'a pas pu afficher a temps depuis le debut de la lecture. */
        @Volatile
        var imagesPerdues: Int = 0
            private set
    }
}
