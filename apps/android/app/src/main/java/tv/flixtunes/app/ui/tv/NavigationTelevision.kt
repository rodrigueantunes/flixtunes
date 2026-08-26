package tv.flixtunes.app.ui.tv

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import tv.flixtunes.app.ui.SECTIONS_TELEVISION
import tv.flixtunes.app.ui.Muet
import tv.flixtunes.app.ui.indicationFocus
import tv.flixtunes.app.ui.rememberSourceFocus

/**
 * Navigation de la surface télévision : une rangée de sections dans la barre du haut.
 *
 * Elle y est parce qu'un téléviseur n'a pas de pouce pour atteindre le bas de l'écran : à la
 * télécommande, le haut est le point de départ naturel du parcours, et une barre basse obligerait à
 * traverser tout le catalogue pour l'atteindre.
 *
 * Les sections sont écrites en toutes lettres, sans pictogramme : à trois mètres, un symbole de dix
 * pixels ne se lit pas, et rien n'oblige à économiser la largeur sur un écran de cette taille.
 */
@Composable
fun NavigationTelevision(sectionCourante: String, choisir: (String) -> Unit) {
    /**
     * Le focus se pose de lui-même sur la première section à l'ouverture.
     *
     * Sans cela, rien n'a le focus au démarrage : la première pression sur la croix directionnelle
     * part vers un élément que le système choisit seul, souvent au milieu du catalogue. On commence
     * donc par se demander où l'on est — exactement ce qu'une interface à dix pieds doit éviter.
     */
    val premiere = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { premiere.requestFocus() } }

    Spacer(Modifier.width(34.dp))
    for ((rang, section) in SECTIONS_TELEVISION.withIndex()) {
        val active = section.cle == sectionCourante
        // Une seule source d'interaction pour le liseré et le clic : deux cibles de focus empilées
        // obligeaient à valider deux fois à la télécommande.
        val source = rememberSourceFocus()
        TextButton(
            onClick = { choisir(section.cle) },
            modifier = Modifier
                .then(if (rang == 0) Modifier.focusRequester(premiere) else Modifier)
                .indicationFocus(source, 10),
            colors = ButtonDefaults.textButtonColors(contentColor = if (active) Color.White else Muet),
            interactionSource = source,
        ) {
            Text(section.libelle, fontWeight = if (active) FontWeight.Bold else FontWeight.Normal)
        }
    }
}
