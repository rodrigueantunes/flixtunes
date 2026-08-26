package tv.flixtunes.app.playback

import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultHttpDataSource

/**
 * Le jeton de session, porté aussi par le lecteur.
 *
 * `FlixTunesApi` posait déjà `X-FlixTunes-Profile-Token` sur ses propres appels, mais le lecteur
 * n'est pas un appel d'API : ExoPlayer va chercher lui-même le manifeste, les segments et les pistes
 * de sous-titres, avec sa propre pile HTTP. Sur le réseau local cela ne se voyait pas — rien n'était
 * demandé. Depuis l'accès distant, où chaque requête réclame une session, la vidéo reviendrait en 401
 * alors que le catalogue s'afficherait normalement : la panne la plus déroutante possible.
 *
 * Le jeton vit ici plutôt que d'être passé au service : `PlaybackService` est construit par le
 * système, sans accès à l'instance d'API, et le jeton change au fil des déverrouillages.
 */
object JetonSession {
    @Volatile
    var profil: String? = null
    @Volatile
    var compteDistant: String? = null
}

/**
 * Fabrique HTTP qui relit le jeton **à chaque source créée**.
 *
 * `setDefaultRequestProperties` fige les en-têtes au moment de l'appel ; les poser une fois à la
 * construction du lecteur enverrait indéfiniment le jeton du premier profil déverrouillé. Ici la
 * lecture se fait à la création de chaque source, donc un changement de profil ou une session
 * renouvelée est pris en compte sans reconstruire le lecteur.
 */
@UnstableApi
class FabriqueHttpFlixTunes : DataSource.Factory {
    private val delegue = DefaultHttpDataSource.Factory()
        .setAllowCrossProtocolRedirects(false)
        .setConnectTimeoutMs(8_000)
        .setReadTimeoutMs(45_000)

    override fun createDataSource(): DataSource {
        val jetonProfil = JetonSession.profil
        val jetonDistant = JetonSession.compteDistant
        val entetes = buildMap {
            if (!jetonProfil.isNullOrBlank()) put("X-FlixTunes-Profile-Token", jetonProfil)
            if (!jetonDistant.isNullOrBlank()) put("X-FlixTunes-Remote-Token", jetonDistant)
        }
        delegue.setDefaultRequestProperties(
            entetes,
        )
        return delegue.createDataSource()
    }
}
