package tv.flixtunes.app.ui

import android.content.res.Configuration
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.size
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import tv.flixtunes.app.playback.SuiviDiffusion

/** Les téléviseurs restent des récepteurs ; seuls les mobiles et tablettes proposent l'envoi. */
@Composable
fun BoutonCast(onClick: () -> Unit) {
    if (LocalConfiguration.current.uiMode and Configuration.UI_MODE_TYPE_MASK == Configuration.UI_MODE_TYPE_TELEVISION) return
    // Pendant une diffusion, le bouton le montre — plein, et avec le nom de l'appareil pour le lecteur d'écran.
    val active by SuiviDiffusion.active.collectAsState()
    val nom = active?.optString("nom")
    val couleur = if (active != null) Texte else BleuClair
    IconButton(onClick = onClick, modifier = Modifier.size(48.dp)
        .then(if (active != null) Modifier.background(Bleu, RoundedCornerShape(12.dp)) else Modifier)
        .semantics { contentDescription = if (nom != null) "Diffusion en cours sur $nom — piloter" else "Caster ou piloter un appareil" }) {
        Canvas(Modifier.size(24.dp)) {
            if (active != null) drawRect(Texte, topLeft = Offset(7 * size.width / 24f, 9 * size.width / 24f), size = Size(10 * size.width / 24f, 6 * size.width / 24f))
            val unite = size.width / 24f
            val cadre = Path().apply {
                moveTo(3 * unite, 8 * unite); lineTo(3 * unite, 5 * unite)
                lineTo(21 * unite, 5 * unite); lineTo(21 * unite, 19 * unite)
                lineTo(14 * unite, 19 * unite)
            }
            drawPath(cadre, couleur, style = Stroke(1.8f * unite))
            for (rayon in listOf(5f, 9f)) drawArc(couleur, -90f, 90f, false,
                topLeft = Offset((3 - rayon) * unite, (21 - rayon) * unite),
                size = Size(2 * rayon * unite, 2 * rayon * unite), style = Stroke(1.8f * unite))
            drawCircle(couleur, unite, Offset(3 * unite, 21 * unite))
        }
    }
}
