package tv.flixtunes.app.playback

import android.content.Context
import java.util.UUID

/**
 * Identifiant stable de cet appareil.
 *
 * Il ne sert qu'à une chose : permettre au serveur de retenir ce qui a échoué **ici**. Un appareil
 * Android annonce les codecs que `MediaCodecList` déclare, et le serveur le croit — c'est ce qui rend
 * la lecture directe possible, sans conversion sur le NAS.
 *
 * Mais la déclaration ment parfois. Un téléviseur annonce HEVC que son décodeur refuse au-delà d'un
 * certain profil ; une box annonce AV1 sans matériel derrière. La lecture démarre, puis s'arrête. Sans
 * mémoire attachée à l'appareil, la même erreur se reproduit à **chaque** lecture : le serveur
 * repropose le codec, l'appareil échoue, et rien n'apprend.
 *
 * **Ce n'est pas une identification de personne.** La valeur est tirée au hasard, ne quitte pas cet
 * appareil, et n'est reliée à aucun profil : c'est le décodeur qu'on décrit, pas l'utilisateur.
 */
object DeviceIdentity {
    private const val PREFERENCES = "flixtunes.device"
    private const val CLE = "device-id"

    /** L'identifiant de cet appareil, créé au premier appel puis conservé. */
    fun get(context: Context): String {
        val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        preferences.getString(CLE, null)?.takeIf { it.length >= 6 }?.let { return it }
        val nouveau = "android-" + UUID.randomUUID().toString()
        preferences.edit().putString(CLE, nouveau).apply()
        return nouveau
    }
}
