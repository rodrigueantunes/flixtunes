package tv.flixtunes.app.ui.ecrans

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.key
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.flixtunes.app.*
import tv.flixtunes.app.data.*
import tv.flixtunes.app.data.Details
import tv.flixtunes.app.data.Media
import tv.flixtunes.app.data.PersonCredit
import tv.flixtunes.app.data.Season
import tv.flixtunes.app.ui.*
import tv.flixtunes.app.ui.Accroche
import tv.flixtunes.app.ui.ApprocheTitre
import tv.flixtunes.app.ui.BadgesQualite
import tv.flixtunes.app.ui.BlocSource
import tv.flixtunes.app.ui.BoutonPrimaire
import tv.flixtunes.app.ui.BoutonSecondaire
import tv.flixtunes.app.ui.BoutonTexte
import tv.flixtunes.app.ui.CarteSaison
import tv.flixtunes.app.ui.EnTeteRail
import tv.flixtunes.app.ui.Encre
import tv.flixtunes.app.ui.FormatImageTv
import tv.flixtunes.app.ui.ImageOptimiseeTv
import tv.flixtunes.app.ui.Ligne
import tv.flixtunes.app.ui.LigneEpisode
import tv.flixtunes.app.ui.LocalGabarit
import tv.flixtunes.app.ui.Muet
import tv.flixtunes.app.ui.PanneauHaut
import tv.flixtunes.app.ui.PoliceTitre
import tv.flixtunes.app.ui.PuceFiltre
import tv.flixtunes.app.ui.TexteDoux

@Composable internal fun DialogueActionsMedia(
    media: Media,
    fermer: () -> Unit,
    lire: () -> Unit,
    ouvrir: () -> Unit,
    basculerVu: () -> Unit,
    basculerListe: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = fermer,
        title = { Text(media.title, maxLines = 2, overflow = TextOverflow.Ellipsis) },
        text = {
            Column {
                TextButton(lire, enabled = media.playableMediaId != null || media.kind != "show") {
                    Text(if (media.progressPercent > 0) stringResource(R.string.fiche_reprendre) else stringResource(R.string.fiche_lecture))
                }
                TextButton(ouvrir) { Text(stringResource(R.string.fiche_plus_infos)) }
                TextButton(basculerVu) { Text(if (media.completed) stringResource(R.string.fiche_marquer_non_vu)
                    else stringResource(R.string.fiche_marquer_vu)) }
                if (media.kind != "episode") TextButton(basculerListe) {
                    Text(if (media.inWatchlist) stringResource(R.string.menu_retirer_liste) else stringResource(R.string.menu_ajouter_liste))
                }
            }
        },
        confirmButton = { TextButton(fermer) { Text(stringResource(R.string.action_annuler)) } },
    )
}

@Composable internal fun EcranFiche(
    details: Details,
    image: (String?) -> String?,
    back: () -> Unit,
    play: (Media) -> Unit,
    basculerListe: () -> Unit,
    basculerVu: (Media) -> Unit,
    basculerSaisonVue: (Season) -> Unit,
    ouvrirMedia: (Media) -> Unit,
    ouvrirPersonne: (PersonCredit) -> Unit,
    explorer: (String) -> Unit,
    ouvrirMenu: (Media) -> Unit,
) {
    val gabarit = LocalGabarit.current
    val edge = gabarit.margeBord.dp
    /**
     * **La fiche s'ouvre sur la saison qui nous concerne, et non sur la première.**
     *
     * Elle s'ouvrait toujours sur la saison 1. Ouvrir une série depuis « Continuer à regarder »
     * amenait donc son début, et le bouton « Reprendre » — qui joue le premier épisode de la saison
     * affichée — ramenait à S01E01. Deux symptômes, une seule cause.
     *
     * Le serveur désigne l'épisode de reprise dans `playableMediaId` ; on ouvre sa saison. À défaut,
     * la première, qui est la bonne réponse pour une série jamais commencée.
     */
    val saisonDeReprise = remember(details.item.id, details.item.playableMediaId) {
        val vise = details.item.playableMediaId
        details.seasons.firstOrNull { saison ->
            vise != null && saison.episodes.any { it.id == vise || it.playableMediaId == vise }
        }?.number ?: details.seasons.firstOrNull()?.number ?: 1
    }
    var saison by remember(details.item.id) { mutableIntStateOf(saisonDeReprise) }
    var sourceVisible by remember(details.item.id) { mutableStateOf(false) }
    var version by remember(details.item.id) { mutableStateOf(details.versions.firstOrNull()?.mediaId ?: details.item.id) }
    val episodes = details.seasons.firstOrNull { it.number == saison }?.episodes.orEmpty()
    val item = details.item
    val focusLecture = remember(item.id) { FocusRequester() }
    LaunchedEffect(item.id, gabarit.televiseur) {
        if (gabarit.televiseur) runCatching { focusLecture.requestFocus() }
    }
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Box(Modifier.height(gabarit.hauteurBandeau.dp).fillMaxWidth()) {
                val fond = image(item.backdropUrl)
                if (fond.isNullOrBlank()) {
                    Box(Modifier.fillMaxSize().background(Brush.radialGradient(listOf(Color(0xFF173D7E), PanneauHaut))))
                } else {
                    ImageOptimiseeTv(fond, FormatImageTv.BANDEAU, Modifier.fillMaxSize(), ContentScale.Crop)
                }
                Box(
                    Modifier.fillMaxSize()
                        .background(Brush.verticalGradient(listOf(Color.Transparent, Encre)))
                        .background(Brush.horizontalGradient(listOf(Encre.copy(.9f), Color.Transparent))),
                )
                Column(
                    Modifier.align(Alignment.BottomStart).padding(gabarit.margeSurImage.dp).widthIn(max = 760.dp),
                    verticalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    BoutonTexte(back) {
                        Text(stringResource(R.string.fiche_retour), color = Muet)
                    }
                    Accroche(
                        when (item.kind) {
                            "show" -> stringResource(R.string.fiche_type_serie)
                            "episode" -> stringResource(R.string.fiche_type_episode)
                            // Le repli annonçait « Film » devant une vidéo de plateforme.
                            "video" -> stringResource(R.string.fiche_type_video)
                            else -> stringResource(R.string.fiche_type_film)
                        },
                    )
                    Text(
                        item.displayTitle,
                        fontSize = gabarit.tailleTitreFiche.sp,
                        lineHeight = (gabarit.tailleTitreFiche * 1.02f).sp,
                        fontFamily = PoliceTitre,
                        fontWeight = FontWeight.ExtraBold,
                        letterSpacing = ApprocheTitre,
                    )
                    BadgesQualite(details.qualities)
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        BoutonPrimaire(
                            if (item.progressPercent > 0) stringResource(R.string.fiche_reprendre)
                            else stringResource(R.string.fiche_lecture),
                            {
                                /*
                                 * Pour une série, on prenait le premier épisode de la saison
                                 * **affichée**. Le serveur désigne pourtant l'épisode de reprise ;
                                 * on le suit, et l'on ne retombe sur le premier que s'il ne dit rien.
                                 */
                                val reprise = item.playableMediaId?.let { vise ->
                                    details.seasons.flatMap { it.episodes }
                                        .firstOrNull { it.id == vise || it.playableMediaId == vise }
                                }
                                val cible = if (item.kind == "show") reprise ?: episodes.firstOrNull() ?: item else item
                                val identifiant = if (item.kind == "movie") version else cible.playableMediaId ?: cible.id
                                play(cible.copy(id = identifiant))
                            },
                            modifier = Modifier.focusRequester(focusLecture),
                            actif = item.playableMediaId != null || episodes.isNotEmpty(),
                            pictogramme = "▶",
                        )
                        BoutonSecondaire(
                            if (item.inWatchlist) stringResource(R.string.fiche_ma_liste_presente)
                            else stringResource(R.string.fiche_ma_liste_ajouter),
                            basculerListe,
                        )
                        details.source?.let { source ->
                            BoutonSecondaire(
                                if (source.kind == "folder") stringResource(R.string.fiche_details_dossier)
                                else stringResource(R.string.fiche_details_fichier),
                                { sourceVisible = !sourceVisible },
                            )
                        }
                        BoutonSecondaire(
                            if (item.completed) stringResource(R.string.fiche_marquer_non_vu)
                            else stringResource(R.string.fiche_marquer_vu),
                            { basculerVu(item) },
                        )
                    }
                }
            }
        }
        if (sourceVisible) details.source?.let { source ->
            item {
                Box(Modifier.padding(horizontal = edge, vertical = 12.dp)) {
                    BlocSource(
                        if (source.kind == "folder") stringResource(R.string.fiche_dossier_origine)
                        else stringResource(R.string.fiche_fichier_origine),
                        source.name,
                        details.versions,
                        version,
                        choisir = { version = it },
                    )
                }
            }
        }
        item {
            Text(
                item.overview ?: stringResource(R.string.fiche_sans_resume),
                Modifier.padding(horizontal = edge, vertical = 14.dp).widthIn(max = 760.dp),
                color = TexteDoux,
                lineHeight = (gabarit.tailleTexte * 1.7f).sp,
            )
        }
        if (details.genres.isNotEmpty()) item {
            FlowRow(
                Modifier.padding(horizontal = edge, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for (genre in details.genres) PuceFiltre(false, { explorer(genre) }) { Text(genre) }
            }
        }
        if (details.people.isNotEmpty()) {
            item {
                Column(Modifier.padding(horizontal = edge, vertical = 18.dp)) {
                    Accroche(stringResource(R.string.fiche_distribution_equipe))
                    Text(stringResource(R.string.fiche_talents), Modifier.padding(top = 5.dp),
                        fontSize = gabarit.tailleAccroche.sp, fontFamily = PoliceTitre, fontWeight = FontWeight.ExtraBold)
                }
            }
            item {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = edge),
                    horizontalArrangement = Arrangement.spacedBy(gabarit.ecartCartes.dp),
                ) {
                    items(details.people, key = { "${it.role}:${it.id}:${it.character.orEmpty()}" }, contentType = { "person" }) { person ->
                        CartePersonne(person, image(person.profileUrl)) { ouvrirPersonne(person) }
                    }
                }
            }
        }
        if (details.seasons.isNotEmpty()) {
            item {
                Column(Modifier.padding(horizontal = edge, vertical = 14.dp)) {
                    Accroche(stringResource(R.string.fiche_toutes_saisons))
                    EnTeteRail(stringResource(R.string.fiche_saisons), details.seasons.size, Modifier.padding(top = 6.dp))
                }
            }
            item {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = edge),
                    horizontalArrangement = Arrangement.spacedBy(gabarit.ecartCartes.dp),
                ) {
                    items(details.seasons, key = { it.id }) { entree ->
                        CarteSaison(
                            entree,
                            image(entree.posterUrl ?: item.posterUrl),
                            entree.number == saison,
                            { saison = entree.number },
                        )
                    }
                }
            }
            item {
                Column(Modifier.padding(start = edge, end = edge, top = 26.dp)) {
                    Accroche(stringResource(R.string.fiche_saison, saison))
                    Row(
                        Modifier.fillMaxWidth().padding(top = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        EnTeteRail(stringResource(R.string.fiche_episodes), episodes.size, Modifier.weight(1f))
                        details.seasons.firstOrNull { it.number == saison }?.let { saisonActive ->
                            BoutonSecondaire(
                                if (saisonActive.completed) stringResource(R.string.fiche_marquer_saison_non_vue)
                                else stringResource(R.string.fiche_marquer_saison_vue),
                                { basculerSaisonVue(saisonActive) },
                            )
                        }
                    }
                }
            }
            items(episodes, key = { it.id }) { episode ->
                Column(Modifier.padding(horizontal = edge)) {
                    Box(Modifier.fillMaxWidth().height(1.dp).background(Ligne))
                    LigneEpisode(episode, episode.completed, { play(episode) }, { basculerVu(episode) })
                }
            }
        }
        if (details.collection != null) item {
            Rail(details.collection.name, details.collection.items, image, ouvrirMedia, ouvrirMenu)
        }
        if (details.related.isNotEmpty()) item {
            Rail(stringResource(R.string.fiche_aimer_aussi), details.related, image, ouvrirMedia, ouvrirMenu)
        }
        item { Spacer(Modifier.height(gabarit.margeBasse.dp)) }
    }
}
