package tv.flixtunes.app.playback

import android.app.Activity
import android.os.Build

/**
 * Demande à l'écran la fréquence qui tombe juste avec la cadence de la vidéo.
 *
 * Sans cela, une image à 50 ou 25 par seconde — toutes les chaînes françaises — affichée sur un
 * panneau à 60 Hz est montrée tantôt une fois, tantôt deux : le mouvement avance par à-coups réguliers,
 * les micro-saccades qu'aucun débit ne corrige. Le lecteur de la médiathèque le faisait déjà pour les
 * films ; le direct s'en passait (r12).
 *
 * Le choix lui-même est dans [chooseDisplayMode], vérifiable hors appareil. Rien n'est demandé quand le
 * mode en cours convient déjà : chaque changement renégocie le HDMI et noircit l'écran une à deux
 * secondes, et un zapping entre chaînes de même cadence ne doit pas le faire.
 *
 * Rend vrai quand un nouveau mode a été demandé.
 */
fun Activity.accorderCadenceEcran(contentFps: Double): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || !contentFps.isFinite() || contentFps <= 0.0) return false
    val display = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) display else @Suppress("DEPRECATION") windowManager.defaultDisplay
    val actif = display?.mode ?: return false
    val vers = { m: android.view.Display.Mode ->
        DisplayModeInfo(m.modeId, m.physicalWidth, m.physicalHeight, m.refreshRate.toDouble())
    }
    val choisi = chooseDisplayMode(display.supportedModes.map(vers), vers(actif), contentFps) ?: return false
    if (window.attributes.preferredDisplayModeId == choisi.id) return false
    window.attributes = window.attributes.apply { preferredDisplayModeId = choisi.id }
    return true
}
