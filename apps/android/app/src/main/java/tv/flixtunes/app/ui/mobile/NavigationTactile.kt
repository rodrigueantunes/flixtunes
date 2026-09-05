package tv.flixtunes.app.ui.mobile

import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.sp
import tv.flixtunes.app.ui.OffreDuServeur
import tv.flixtunes.app.ui.sectionsVisibles

/**
 * Navigation de la surface tactile : une barre au bas de l'écran.
 *
 * En bas parce que c'est là que le pouce arrive sans changer la prise du téléphone. La recherche y
 * figure comme une section à part entière — au clavier tactile, saisir un titre est le geste le plus
 * rapide pour trouver un film, alors qu'il est le plus lent à la télécommande.
 *
 * Les pictogrammes accompagnent les libellés : la barre est étroite, et quatre mots y tiendraient mal
 * sur un téléphone.
 */
@Composable
fun NavigationTactile(
    sectionCourante: String,
    offre: OffreDuServeur,
    modifier: Modifier = Modifier,
    choisir: (String) -> Unit,
) {
    NavigationBar(modifier) {
        for (section in sectionsVisibles(offre)) {
            NavigationBarItem(
                selected = section.cle == sectionCourante,
                onClick = { choisir(section.cle) },
                icon = { Text(section.pictogramme, fontSize = 18.sp) },
                label = { Text(section.libelle, fontSize = 11.sp) },
            )
        }
    }
}
