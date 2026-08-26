package tv.flixtunes.app.ui.ecrans

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.flixtunes.app.*
import tv.flixtunes.app.data.*
import tv.flixtunes.app.data.Media
import tv.flixtunes.app.ui.*
import tv.flixtunes.app.ui.Ligne
import tv.flixtunes.app.ui.LocalGabarit
import tv.flixtunes.app.ui.Muet
import tv.flixtunes.app.ui.Panneau
import tv.flixtunes.app.ui.RayonCommande

/**
 * `.search-panel` — la recherche dans un panneau, comme sur le Web.
 *
 * Elle était un champ posé nu sous la barre du haut. Le panneau la rattache visuellement à la loupe
 * qui l'ouvre, et pose les résultats dans la même grille que le catalogue.
 */
@Composable internal fun PanneauRecherche(
    state: MainState,
    model: MainViewModel,
    image: (String?) -> String?,
    open: (Media) -> Unit,
    ouvrirMenu: (Media) -> Unit,
    focusARestaurer: String?,
    focusRestaure: () -> Unit,
    bottomInset: Dp,
    grid: LazyGridState,
) {
    val gabarit = LocalGabarit.current
    val rechercheFocus = remember { FocusRequester() }
    val clavier = LocalSoftwareKeyboardController.current
    LaunchedEffect(Unit) {
        runCatching { rechercheFocus.requestFocus() }
        clavier?.show()
    }
    LaunchedEffect(state.query) { grid.scrollToItem(0) }
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier
                .padding(horizontal = gabarit.margeBord.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(Panneau.copy(alpha = .96f))
                .border(1.dp, Ligne, RoundedCornerShape(18.dp))
                .padding(horizontal = 16.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("⌕", color = Muet, fontSize = 22.sp)
            OutlinedTextField(
                state.query.trimStart(),
                model::search,
                Modifier.fillMaxWidth().padding(start = 10.dp).focusRequester(rechercheFocus),
                placeholder = { Text(stringResource(R.string.recherche_champ), color = Muet) },
                singleLine = true,
                shape = RoundedCornerShape(RayonCommande),
            )
        }
        GrilleMedia(
            media = state.search,
            image = image,
            open = open,
            ouvrirMenu = ouvrirMenu,
            focusARestaurer = focusARestaurer,
            focusRestaure = focusRestaure,
            bottomInset = bottomInset,
            vide = if (state.query.isBlank()) stringResource(R.string.recherche_vide)
            else stringResource(R.string.recherche_aucun_resultat),
            entete = null,
            grid = grid,
        )
    }
}
