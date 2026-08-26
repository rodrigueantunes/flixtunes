package tv.flixtunes.app

import android.app.ActivityManager
import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import tv.flixtunes.app.ui.MemoireTv

/**
 * Ce que la plateforme sait de l'appareil, et que l'interface n'a pas à savoir chercher.
 *
 * Ces deux fonctions vivaient dans `ui/Gabarit.kt`, au milieu des tailles et des marges. Elles y
 * apportaient cinq imports Android dans un fichier qui, sans elles, n'en a aucun — et c'était le seul
 * obstacle à ce que tout le dossier `ui/` devienne du code partagé.
 *
 * La frontière est désormais nette : `Gabarit.kt` dit **ce qu'on fait** d'une classe de mémoire ou
 * d'un type d'écran, ce fichier dit **comment on les découvre** sur Android. Un autre système
 * répondra à sa façon ; l'interface, elle, ne changera pas.
 */

/** Une seule détection TV pour l'interface, le ViewModel et le cache d'images. */
fun estAppareilTv(context: Context): Boolean {
    // Certains firmwares exposent Leanback sans recopier correctement le type TV dans la
    // Configuration. R54 pouvait alors afficher l'interface TV avec les réglages de cache mobile.
    val mode = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
    return mode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
}

/** Budget graphique approché par la classe de tas publiée par le boîtier. */
fun memoireTv(context: Context): MemoireTv {
    val classeMo = (context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)?.memoryClass ?: 192
    return when {
        classeMo <= 128 -> MemoireTv.CONTRAINTE
        classeMo <= 256 -> MemoireTv.STANDARD
        else -> MemoireTv.LARGE
    }
}
