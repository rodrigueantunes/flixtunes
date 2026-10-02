package tv.flixtunes.app.ui

import android.content.res.Configuration
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** Les téléviseurs restent des récepteurs ; seuls les mobiles et tablettes proposent l'envoi. */
@Composable
fun BoutonCast(onClick: () -> Unit) {
    if (LocalConfiguration.current.uiMode and Configuration.UI_MODE_TYPE_MASK == Configuration.UI_MODE_TYPE_TELEVISION) return
    IconButton(onClick = onClick, modifier = Modifier.size(48.dp).semantics {
        contentDescription = "Caster ou piloter un appareil"
    }) {
        Canvas(Modifier.size(24.dp)) {
            val unite = size.width / 24f
            val cadre = Path().apply {
                moveTo(3 * unite, 8 * unite); lineTo(3 * unite, 5 * unite)
                lineTo(21 * unite, 5 * unite); lineTo(21 * unite, 19 * unite)
                lineTo(14 * unite, 19 * unite)
            }
            drawPath(cadre, BleuClair, style = Stroke(1.8f * unite))
            for (rayon in listOf(5f, 9f)) drawArc(BleuClair, -90f, 90f, false,
                topLeft = Offset((3 - rayon) * unite, (21 - rayon) * unite),
                size = Size(2 * rayon * unite, 2 * rayon * unite), style = Stroke(1.8f * unite))
            drawCircle(BleuClair, unite, Offset(3 * unite, 21 * unite))
        }
    }
}
