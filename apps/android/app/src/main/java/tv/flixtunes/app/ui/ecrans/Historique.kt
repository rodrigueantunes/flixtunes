package tv.flixtunes.app.ui.ecrans

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.flixtunes.app.*
import tv.flixtunes.app.data.*
import tv.flixtunes.app.data.Media
import tv.flixtunes.app.ui.*
import tv.flixtunes.app.ui.Accroche
import tv.flixtunes.app.ui.ApprocheTitre
import tv.flixtunes.app.ui.LocalGabarit
import tv.flixtunes.app.ui.Muet
import tv.flixtunes.app.ui.PoliceTitre

/** L'écran Historique du Web : une accroche, un titre, deux rails. */
@Composable internal fun EcranHistorique(
    state: MainState,
    image: (String?) -> String?,
    open: (Media) -> Unit,
    ouvrirMenu: (Media) -> Unit,
    focusARestaurer: String?,
    focusRestaure: () -> Unit,
    bottomInset: Dp,
    scroll: LazyListState,
) {
    val gabarit = LocalGabarit.current
    val home = state.home
    LazyColumn(Modifier.fillMaxSize(), state = scroll, contentPadding = PaddingValues(bottom = bottomInset)) {
        item {
            Column(Modifier.padding(horizontal = gabarit.margeBord.dp, vertical = 12.dp)) {
                Accroche(stringResource(R.string.historique_accroche))
                Text(
                    stringResource(R.string.historique_titre),
                    Modifier.padding(top = 6.dp),
                    fontSize = gabarit.tailleTitre.sp,
                    fontFamily = PoliceTitre,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = ApprocheTitre,
                )
            }
        }
        if (home != null) {
            item { Rail(stringResource(R.string.rail_deja_vus), home.completed, image, open, ouvrirMenu, focusARestaurer, focusRestaure) }
            item { Rail(stringResource(R.string.rail_historique_recent), home.watchedRecently, image, open, ouvrirMenu, focusARestaurer, focusRestaure) }
            if (home.completed.isEmpty() && home.watchedRecently.isEmpty()) item {
                Text(
                    stringResource(R.string.catalogue_vide),
                    Modifier.padding(gabarit.margeBord.dp),
                    color = Muet,
                )
            }
        }
    }
}
