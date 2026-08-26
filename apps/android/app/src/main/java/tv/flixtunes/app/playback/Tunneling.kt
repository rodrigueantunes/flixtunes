package tv.flixtunes.app.playback

import android.content.Context
import android.content.res.Configuration

/**
 * Mode tunnel : les images vont du décodeur à l'écran sans repasser par l'application.
 *
 * Le gain est réel sur un téléviseur. Le matériel synchronise lui-même l'image et le son, ce que
 * l'application ne peut faire qu'approximativement ; la dérive audio des longues lectures disparaît,
 * et le processeur travaille moins — ce qui compte sur les boîtiers TV, souvent modestes et sans
 * ventilateur.
 *
 * Le défaut est tout aussi réel : plusieurs téléviseurs déclarent savoir le faire et le rendent mal,
 * écran noir avec le son qui continue. Comme pour les codecs, la déclaration ment parfois, et la
 * seule réponse honnête est de constater puis de retenir.
 *
 * D'où deux précautions. Le tunnel n'est proposé que sur téléviseur — sur mobile il n'apporte rien
 * qui compense le risque. Et un seul échec suffit à l'abandonner pour de bon sur cet appareil : le
 * perdre ne coûte qu'un peu de synchronisation, tandis que l'écran noir coûte la séance.
 */
object Tunneling {
    private const val PREFERENCES = "flixtunes.device"
    private const val CLE_ABANDON = "tunnel-abandonne"

    /** Vrai si l'on est sur un téléviseur — le tunnel n'a d'intérêt que là. */
    fun estTeleviseur(context: Context): Boolean =
        context.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK ==
            Configuration.UI_MODE_TYPE_TELEVISION

    /** Faut-il activer le mode tunnel pour la prochaine lecture sur cet appareil ? */
    fun actif(context: Context): Boolean = estTeleviseur(context) &&
        !context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getBoolean(CLE_ABANDON, false)

    /**
     * Abandonne le mode tunnel sur cet appareil, définitivement.
     *
     * Pas d'oubli automatique ici, contrairement à la quarantaine des codecs : un décodeur peut être
     * réparé par une mise à jour, mais réessayer coûterait un nouvel écran noir en pleine séance pour
     * un bénéfice que personne ne remarquera. Réinstaller l'application remet le compteur à zéro.
     */
    fun abandonner(context: Context) {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .edit().putBoolean(CLE_ABANDON, true).apply()
    }
}
