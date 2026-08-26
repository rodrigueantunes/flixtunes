package tv.flixtunes.app

import android.app.Activity
import android.os.Build
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Masque les barres système, sur toutes les surfaces.
 *
 * Le lecteur le faisait, l'accueil non : il se contentait de dessiner **sous** les barres, qui
 * restaient affichées par-dessus les jaquettes. L'horloge et les trois boutons du système
 * accompagnaient donc toute la navigation, et le passage au lecteur faisait sauter l'écran d'un mode à
 * l'autre. Deux comportements pour un même geste, sans raison.
 *
 * Le réglage est le même partout, et il vit ici plutôt que recopié dans chaque activité : c'est
 * exactement le genre de règle qui se met à diverger dès qu'elle existe en deux exemplaires.
 *
 * Il a quitté le dossier `ui/` : c'est une extension d'`Activity`, appelée par les activités et
 * jamais par un composable. Elle n'avait rien à faire dans du code destiné à devenir partagé, où elle
 * apportait à elle seule les trois derniers imports Android.
 *
 * `SHOW_TRANSIENT_BARS_BY_SWIPE` plutôt qu'un masquage définitif : un balayage depuis le bord les
 * ramène le temps qu'il faut, puis elles repartent. Les cacher sans recours enfermerait la personne
 * dans l'application, ce qu'aucun lecteur multimédia ne se permet.
 */
fun Activity.masquerBarresSysteme() {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    // `decorView` et non une vue de contenu : cette fonction est aussi appelée depuis
    // `onWindowFocusChanged`, qui peut survenir avant que l'arbre de vues existe.
    WindowInsetsControllerCompat(window, window.decorView).apply {
        hide(WindowInsetsCompat.Type.systemBars())
        systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        // Le contenu passe sous l'encoche plutôt que de laisser une bande noire à côté d'elle. Les
        // marges d'inset sont consommées par les écrans, qui savent ce qui doit rester atteignable.
        window.attributes = window.attributes.apply {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
    }
}
