package tv.flixtunes.app.ui.ecrans

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.flixtunes.app.*
import tv.flixtunes.app.data.*
import tv.flixtunes.app.data.Media
import tv.flixtunes.app.data.PersonCredit
import tv.flixtunes.app.data.PersonDetails
import tv.flixtunes.app.ui.*
import tv.flixtunes.app.ui.Accroche
import tv.flixtunes.app.ui.ApprocheTitre
import tv.flixtunes.app.ui.BoutonTexte
import tv.flixtunes.app.ui.Encre
import tv.flixtunes.app.ui.FormatImageTv
import tv.flixtunes.app.ui.ImageOptimiseeTv
import tv.flixtunes.app.ui.LocalGabarit
import tv.flixtunes.app.ui.Muet
import tv.flixtunes.app.ui.Panneau
import tv.flixtunes.app.ui.PoliceTitre
import tv.flixtunes.app.ui.cliquableAuFocus

/**
 * `.details-modal` — la fiche.
 *
 * Elle reprend, dans l'ordre du Web : le bandeau et son titre, les badges de qualité, la rangée
 * d'actions, le résumé, le fichier d'origine et ses versions, les saisons présentées par leur
 * jaquette, puis les épisodes avec durée, résumé, avancement et marquage.
 */
@Composable internal fun libelleRole(role: String): String = when (role) {
    "director" -> stringResource(R.string.personne_realisation)
    "creator" -> stringResource(R.string.personne_creation)
    "writer" -> stringResource(R.string.personne_scenario)
    "composer" -> stringResource(R.string.personne_musique)
    else -> stringResource(R.string.personne_interprete)
}

@Composable internal fun CartePersonne(person: PersonCredit, portrait: String?, ouvrir: () -> Unit) {
    Column(
        Modifier.width(112.dp).cliquableAuFocus(arrondi = 13, onClickLabel = "Ouvrir ${person.name}", onClick = ouvrir)
            .padding(3.dp),
    ) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(13.dp))
                .background(Brush.linearGradient(listOf(Color(0xFF24477C), Color(0xFF121A2A)))),
            contentAlignment = Alignment.Center,
        ) {
            Text(person.name.take(1), color = Color.White.copy(.18f), fontSize = 42.sp, fontWeight = FontWeight.ExtraBold)
            if (!portrait.isNullOrBlank()) {
                ImageOptimiseeTv(portrait, FormatImageTv.JAQUETTE, Modifier.fillMaxSize(), ContentScale.Crop)
            }
        }
        Text(person.name, Modifier.padding(top = 8.dp), maxLines = 1, overflow = TextOverflow.Ellipsis,
            fontSize = 13.sp, fontWeight = FontWeight.Bold)
        Text(person.character ?: libelleRole(person.role), color = Muet, fontSize = 11.sp,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable internal fun EcranPersonne(
    details: PersonDetails,
    image: (String?) -> String?,
    back: () -> Unit,
    open: (Media) -> Unit,
    ouvrirMenu: (Media) -> Unit,
) {
    val gabarit = LocalGabarit.current
    val roles = details.roles.map { libelleRole(it.role) }.distinct().joinToString(" · ")
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = gabarit.margeBasse.dp)) {
        item {
            Row(
                Modifier.fillMaxWidth().background(Brush.horizontalGradient(listOf(Color(0xFF173D7E), Encre)))
                    .padding(gabarit.margeSurImage.dp),
                horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.Bottom,
            ) {
                Box(
                    Modifier.width(if (gabarit.televiseur) 150.dp else 105.dp).aspectRatio(2f / 3f)
                        .clip(RoundedCornerShape(14.dp)).background(Panneau), contentAlignment = Alignment.Center,
                ) {
                    Text(details.person.name.take(1), color = Color.White.copy(.18f), fontSize = 50.sp)
                    image(details.person.profileUrl)?.let {
                        ImageOptimiseeTv(it, FormatImageTv.JAQUETTE, Modifier.fillMaxSize(), ContentScale.Crop)
                    }
                }
                Column(Modifier.weight(1f)) {
                    BoutonTexte(back) { Text(stringResource(R.string.fiche_retour), color = Muet) }
                    Accroche(stringResource(R.string.personne_dans_bibliotheque))
                    Text(details.person.name, fontSize = gabarit.tailleTitreFiche.sp, fontFamily = PoliceTitre,
                        fontWeight = FontWeight.ExtraBold, letterSpacing = ApprocheTitre)
                    Text(roles, color = Muet)
                }
            }
        }
        item {
            Rail(
                resourcesQuantityString(R.plurals.personne_titres, details.items.size, details.items.size),
                details.items, image, open, ouvrirMenu,
            )
        }
    }
}

@Composable internal fun resourcesQuantityString(id: Int, quantity: Int, vararg args: Any): String =
    pluralStringResource(id, quantity, *args)
