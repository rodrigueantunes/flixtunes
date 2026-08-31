package tv.flixtunes.app.ui.ecrans

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.layout.LazyLayoutCacheWindow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt
import tv.flixtunes.app.*
import tv.flixtunes.app.data.*
import tv.flixtunes.app.data.Media
import tv.flixtunes.app.ui.*
import tv.flixtunes.app.ui.Accroche
import tv.flixtunes.app.ui.ApprocheTitre
import tv.flixtunes.app.ui.BleuClair
import tv.flixtunes.app.ui.BoutonPrimaire
import tv.flixtunes.app.ui.BoutonSecondaire
import tv.flixtunes.app.ui.BoutonTexte
import tv.flixtunes.app.ui.CarteMedia
import tv.flixtunes.app.ui.Encre
import tv.flixtunes.app.ui.Erreur
import tv.flixtunes.app.ui.FormatImageTv
import tv.flixtunes.app.ui.ImageOptimiseeTv
import tv.flixtunes.app.ui.LocalGabarit
import tv.flixtunes.app.ui.MarqueFlixTunes
import tv.flixtunes.app.ui.Muet
import tv.flixtunes.app.ui.Panneau
import tv.flixtunes.app.ui.PastilleProfil
import tv.flixtunes.app.ui.PoliceTitre
import tv.flixtunes.app.ui.PuceVersion
import tv.flixtunes.app.ui.RayonPanneau
import tv.flixtunes.app.ui.Squelette
import tv.flixtunes.app.ui.TexteDoux
import tv.flixtunes.app.ui.VitrineHalo
import tv.flixtunes.app.ui.VitrineMilieu
import tv.flixtunes.app.data.ChaineDirect
import tv.flixtunes.app.ui.mobile.NavigationTactile
import tv.flixtunes.app.ui.tv.NavigationTelevision

@Composable internal fun EcranAccueil(
    state: MainState,
    model: MainViewModel,
    play: (Media) -> Unit,
    section: String,
    accueilScroll: LazyListState,
    historiqueScroll: LazyListState,
    filmsScroll: LazyGridState,
    seriesScroll: LazyGridState,
    rechercheScroll: LazyGridState,
    directScroll: LazyGridState,
    ouvrirMedia: (Media) -> Unit,
    /** Ouvrir une chaîne en direct. Distinct de `play` : une chaîne n'est pas un média du catalogue. */
    jouerChaine: (ChaineDirect) -> Unit,
    focusARestaurer: String?,
    focusRestaure: () -> Unit,
    ouvrirReglages: () -> Unit,
    ouvrirMenu: (Media) -> Unit,
    changerSection: (String) -> Unit,
) {
    val gabarit = LocalGabarit.current
    val home = state.home
    val edge = gabarit.margeBord.dp
    val bottomInset = gabarit.margeBasse.dp
    val image = model::image
    // Le type est écrit : `model::open` rend un `Job`, et Kotlin n'adapte une référence vers un type
    // qui rend `Unit` qu'au moment où elle est passée en argument — pas une fois rangée dans une
    // variable, dont le type est alors figé sur `KFunction1<Media, Job>`.
    val open: (Media) -> Unit = ouvrirMedia
    // La première page d'une section se demande à son ouverture, une seule fois : `loaded` empêche de
    // la redemander à chaque recomposition, et de repartir de zéro en revenant sur l'onglet.
    LaunchedEffect(section, state.profile?.id) {
        if (section == "movies" && !state.movies.loaded) model.loadCatalog("movies")
        if (section == "shows" && !state.shows.loaded) model.loadCatalog("shows")
    }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            // La barre reste fixe : la navigation ne doit pas disparaître en défilant le catalogue.
            BoxWithConstraints(Modifier.fillMaxWidth().background(Encre)) {
                val compact = maxWidth < 600.dp
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = edge, vertical = if (compact) 10.dp else 18.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                MarqueFlixTunes(
                    taillePolice = if (compact) 18 else 21,
                    tailleLogo = if (compact) 36.dp else 46.dp,
                )
                /*
                 * La version, contre l'enseigne, et sur l'accueil seulement.
                 *
                 * C'est là qu'on la cherche quand on veut savoir ce que porte l'appareil qu'on a en
                 * main. La garder sur les pages de catalogue la ferait cohabiter avec le titre de la
                 * section et les filtres, où elle n'a rien à dire : une mention utile une fois par
                 * ouverture n'a pas à occuper la barre en permanence.
                 */
                if (section == "home") PuceVersion(
                    BuildConfig.VERSION_NAME,
                    Modifier.padding(start = if (compact) 8.dp else 12.dp),
                    taillePolice = if (compact) 11 else 13,
                )
                if (gabarit.televiseur) NavigationTelevision(section, state.direct?.disponible == true) { cle ->
                    changerSection(cle)
                    model.search("")
                }
                Spacer(Modifier.weight(1f))
                /*
                 * Actualiser, et seulement dans un catalogue.
                 *
                 * Une analyse lancée sur le NAS pendant que l'application est ouverte ne se voit
                 * nulle part : l'accueil et les pages de catalogue gardent ce qu'ils ont reçu à leur
                 * ouverture, et il fallait fermer l'application pour voir les nouveaux films. Un
                 * rafraîchissement automatique se paierait par des sauts de grille pendant qu'on la
                 * parcourt ; un bouton laisse la décision à la personne, au moment où elle la prend.
                 *
                 * Il repart de la première page plutôt que de demander la suite : c'est en tête de
                 * catalogue que les ajouts apparaissent, quel que soit le tri.
                 */
                if (section == "movies" || section == "shows") {
                    BoutonTexte(
                        {
                            model.loadCatalog(section, reset = true)
                            model.loadHome(silent = true)
                        },
                    ) {
                        Text("↻", fontSize = 20.sp)
                        if (!compact) {
                            Spacer(Modifier.width(6.dp))
                            Text(stringResource(R.string.action_actualiser))
                        }
                    }
                }
                // Sur mobile la recherche est déjà une destination de la barre basse : la répéter ici
                // volait la place du profil et faisait déborder l'en-tête à 320–360 dp.
                if (!compact) {
                    BoutonTexte(
                        {
                            val versRecherche = section != "search"
                            changerSection(if (versRecherche) "search" else "home")
                            if (!versRecherche) model.search("")
                        },
                    ) {
                        Text("⌕", fontSize = 20.sp)
                        Spacer(Modifier.width(6.dp))
                        Text(stringResource(R.string.recherche))
                    }
                }
                BoutonTexte(ouvrirReglages) {
                    Text("⚙", fontSize = 18.sp)
                    if (!compact) {
                        Spacer(Modifier.width(6.dp))
                        Text(stringResource(R.string.reglages))
                    }
                }
                state.profile?.let { profile ->
                    PastilleProfil(profile.name, profile.avatarColor, model::leaveProfile, afficherNom = !compact)
                }
                }
            }
            state.error?.let { message ->
                Row(
                    Modifier.fillMaxWidth().background(Panneau).padding(horizontal = edge, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(message, color = Erreur, fontWeight = FontWeight.Bold)
                        Text(stringResource(R.string.erreur_hors_ligne_aide), color = Muet, fontSize = 12.sp)
                    }
                    BoutonTexte({ model.retry(section) }) {
                        Text(stringResource(R.string.action_reessayer), color = BleuClair)
                    }
                }
            }
            when (section) {
                "movies" -> GrilleCatalogue(
                    titre = "Films", section = state.movies, image = image, open = open, ouvrirMenu = ouvrirMenu,
                    focusARestaurer = focusARestaurer, focusRestaure = focusRestaure, bottomInset = bottomInset,
                    total = if (state.movies.query.isNotBlank() || state.movies.filter != "all" ||
                        state.movies.genres.isNotEmpty()) state.movies.total
                    else maxOf(state.movies.total, home?.movieTotal ?: 0),
                    critere = { sort, filter, query, genres -> model.setCatalogCriteria("movies", sort, filter, query, genres) },
                    loadPrevious = { model.loadPreviousCatalog("movies") },
                    loadMore = { model.loadCatalog("movies") },
                    grid = filmsScroll,
                    sauterLettre = { model.setCatalogLetter("movies", it) },
                    ancrePositionnee = { model.consumeCatalogAnchor("movies") },
                )
                "shows" -> GrilleCatalogue(
                    titre = "Séries TV", section = state.shows, image = image, open = open, ouvrirMenu = ouvrirMenu,
                    focusARestaurer = focusARestaurer, focusRestaure = focusRestaure, bottomInset = bottomInset,
                    total = if (state.shows.query.isNotBlank() || state.shows.filter != "all" ||
                        state.shows.genres.isNotEmpty()) state.shows.total
                    else maxOf(state.shows.total, home?.showTotal ?: 0),
                    critere = { sort, filter, query, genres -> model.setCatalogCriteria("shows", sort, filter, query, genres) },
                    loadPrevious = { model.loadPreviousCatalog("shows") },
                    loadMore = { model.loadCatalog("shows") },
                    grid = seriesScroll,
                    sauterLettre = { model.setCatalogLetter("shows", it) },
                    ancrePositionnee = { model.consumeCatalogAnchor("shows") },
                )
                /*
                 * La télévision en direct, entre les séries et l'historique — l'ordre du menu du Web.
                 *
                 * La section n'est atteignable que si l'entrée existe, donc que si une source a rendu
                 * des chaînes ; le `?:` n'est qu'un garde-fou pour l'instant où l'état revient de
                 * `null` après un changement de profil.
                 */
                "live" -> state.direct?.let { direct ->
                    EcranDirect(direct, model, jouerChaine, bottomInset, directScroll)
                }
                "history" -> EcranHistorique(state, image, open, ouvrirMenu, focusARestaurer, focusRestaure, bottomInset, historiqueScroll)
                "search" -> PanneauRecherche(state, model, image, open, ouvrirMenu, focusARestaurer, focusRestaure, bottomInset, rechercheScroll)
                else -> LazyColumn(Modifier.fillMaxSize(), state = accueilScroll, contentPadding = PaddingValues(bottom = bottomInset)) {
                    home?.featured?.let { featured ->
                        item { Vitrine(featured, image(featured.backdropUrl), { play(featured) }, { open(featured) }) }
                    }
                    home?.let { accueil ->
                        // Le même ordre que le client Web, et les mêmes intitulés. Trois de ces rails
                        // n'existaient pas ici alors que le serveur les envoyait déjà.
                        item { Rail(stringResource(R.string.rail_continuer), accueil.continueWatching, image, open, ouvrirMenu, focusARestaurer, focusRestaure) }
                        if (accueil.recommendations.isNotEmpty()) item {
                            Rail(
                                stringResource(R.string.rail_selection_pour, state.profile?.name.orEmpty()),
                                accueil.recommendations.map { it.item }, image, open, ouvrirMenu, focusARestaurer, focusRestaure,
                                mention = stringResource(R.string.rail_selection_origine),
                            )
                        }
                        item { Rail(stringResource(R.string.rail_ma_liste), accueil.watchlist, image, open, ouvrirMenu, focusARestaurer, focusRestaure) }
                        item { Rail(stringResource(R.string.rail_recents), accueil.recentlyAdded, image, open, ouvrirMenu, focusARestaurer, focusRestaure) }
                        item { Rail(stringResource(R.string.rail_films), accueil.movies, image, open, ouvrirMenu, focusARestaurer, focusRestaure) }
                        item { Rail(stringResource(R.string.rail_series), accueil.shows, image, open, ouvrirMenu, focusARestaurer, focusRestaure) }
                        item { Rail(stringResource(R.string.rail_deja_vus), accueil.completed, image, open, ouvrirMenu, focusARestaurer, focusRestaure) }
                        item { Rail(stringResource(R.string.rail_historique_recent), accueil.watchedRecently, image, open, ouvrirMenu, focusARestaurer, focusRestaure) }
                    }
                    if (home == null) item { AccueilEnAttente() }
                }
            }
        }
        // Navigation tactile : une barre en bas, là où le pouce arrive. Sa composition vit dans
        // `ui/mobile`, celle du téléviseur dans `ui/tv` — deux surfaces, une seule liste de sections.
        if (!gabarit.televiseur) {
            NavigationTactile(section, state.direct?.disponible == true, Modifier.align(Alignment.BottomCenter)) { cle ->
                changerSection(cle)
                model.search("")
            }
        }
    }
}

/** `HomeSkeleton` du Web — trois rails en attente, à la place exacte de ceux qui arrivent. */
@Composable internal fun AccueilEnAttente() {
    val gabarit = LocalGabarit.current
    Column(Modifier.padding(horizontal = gabarit.margeBord.dp)) {
        repeat(3) {
            Squelette(Modifier.padding(top = 26.dp).width(180.dp).height(20.dp))
            Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(gabarit.ecartCartes.dp)) {
                repeat(6) {
                    Column(Modifier.width(gabarit.largeurCarte.dp)) {
                        Squelette(Modifier.fillMaxWidth().aspectRatio(2f / 3f), arrondi = RayonPanneau)
                        Squelette(Modifier.padding(top = 10.dp).fillMaxWidth().height(12.dp))
                        Squelette(Modifier.padding(top = 6.dp).fillMaxWidth(.45f).height(12.dp))
                    }
                }
            }
        }
    }
}

/**
 * `.hero` — la vitrine d'accueil.
 *
 * La ligne de méta suit exactement celle du Web : l'année ou le numéro d'épisode, un point médian
 * bleu clair, puis la durée. Android affichait le seul texte secondaire de la fiche.
 */
@Composable internal fun Vitrine(media: Media, backdrop: String?, play: () -> Unit, info: () -> Unit) {
    val gabarit = LocalGabarit.current
    Box(Modifier.fillMaxWidth().height(gabarit.hauteurVitrine.dp)) {
        if (backdrop.isNullOrBlank()) {
            Box(Modifier.fillMaxSize().background(Brush.radialGradient(listOf(VitrineHalo, VitrineMilieu, Encre))))
        } else {
            ImageOptimiseeTv(backdrop, FormatImageTv.BANDEAU, Modifier.fillMaxSize(), ContentScale.Crop)
        }
        Box(
            Modifier.fillMaxSize()
                .background(Brush.horizontalGradient(listOf(Encre, Encre.copy(.6f), Color.Transparent)))
                .background(Brush.verticalGradient(listOf(Color.Transparent, Encre))),
        )
        Column(
            Modifier.align(Alignment.BottomStart).padding(gabarit.margeSurImage.dp).widthIn(max = 650.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Accroche(
                if (media.progressPercent > 0) stringResource(R.string.accueil_a_reprendre)
                else stringResource(R.string.accueil_a_decouvrir),
            )
            Text(
                media.displayTitle,
                fontSize = gabarit.tailleTitreVitrine.sp,
                lineHeight = (gabarit.tailleTitreVitrine * 0.98f).sp,
                fontFamily = PoliceTitre,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = ApprocheTitre,
            )
            Text(ligneMeta(media), color = Color(0xFFD7DEEB), fontWeight = FontWeight.SemiBold)
            Text(
                media.overview ?: stringResource(R.string.catalogue_mediatheque),
                color = TexteDoux, maxLines = 3, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(vertical = 8.dp),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                BoutonPrimaire(stringResource(R.string.fiche_lecture), play, actif = media.playableMediaId != null, pictogramme = "▶")
                BoutonSecondaire(stringResource(R.string.fiche_plus_infos), info, pictogramme = "ⓘ")
            }
        }
    }
}

/**
 * La ligne « année • durée » du Web, point médian compris.
 *
 * Les textes sont résolus avant la construction : `buildAnnotatedString` reçoit une lambda ordinaire,
 * où un `stringResource` — qui est un composable — n'a pas sa place.
 */
@Composable internal fun ligneMeta(media: Media): AnnotatedString {
    val principal = when (media.kind) {
        "episode" -> "Saison ${media.seasonNumber ?: 0} · Épisode ${media.episodeNumber ?: 0}"
        "show" -> media.year?.toString() ?: stringResource(R.string.fiche_type_serie)
        else -> media.year?.toString() ?: stringResource(R.string.fiche_type_film)
    }
    val duree = media.runtimeSeconds?.let { "${(it / 60.0).roundToInt()} min" }
        ?: stringResource(R.string.catalogue_mediatheque)
    return buildAnnotatedString {
        append(principal)
        withStyle(SpanStyle(color = BleuClair)) { append("  •  ") }
        append(duree)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable internal fun Rail(
    titre: String,
    media: List<Media>,
    image: (String?) -> String?,
    open: (Media) -> Unit,
    ouvrirMenu: (Media) -> Unit,
    focusARestaurer: String? = null,
    focusRestaure: () -> Unit = {},
    mention: String? = null,
) {
    if (media.isEmpty()) return
    val gabarit = LocalGabarit.current
    // Une courte avance amorce les prochaines affiches sans composer une demi-rangée supplémentaire
    // à chaque rail de l'accueil. Avec huit rails, l'ancienne réserve multipliait le travail hors champ.
    val fenetreRail = remember(gabarit.televiseur) {
        LazyLayoutCacheWindow(
            aheadFraction = if (gabarit.televiseur) .12f else .2f,
            behindFraction = 0f,
        )
    }
    val railScroll = rememberLazyListState(cacheWindow = fenetreRail)
    Column(Modifier.padding(top = 24.dp)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = gabarit.margeBord.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                titre,
                fontSize = gabarit.tailleAccroche.sp,
                fontFamily = PoliceTitre,
                fontWeight = FontWeight.ExtraBold,
            )
            Text(mention ?: "${media.size}", color = Muet, fontSize = gabarit.tailleTexte.sp)
        }
        LazyRow(
            state = railScroll,
            contentPadding = PaddingValues(horizontal = gabarit.margeBord.dp),
            horizontalArrangement = Arrangement.spacedBy(gabarit.ecartCartes.dp),
        ) {
            itemsIndexed(media, key = { _, item -> item.id }, contentType = { _, _ -> "media" }) { rang, item ->
                CarteMedia(item, image(item.posterUrl), { open(item) }, Modifier.width(gabarit.largeurCarte.dp), rang,
                    menu = { ouvrirMenu(item) }, restaurerFocus = focusARestaurer == (item.catalogId ?: item.id),
                    focusRestaure = focusRestaure)
            }
        }
    }
}
