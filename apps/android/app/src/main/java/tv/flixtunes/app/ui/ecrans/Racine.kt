package tv.flixtunes.app.ui.ecrans

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.layout.LazyLayoutCacheWindow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import tv.flixtunes.app.*
import tv.flixtunes.app.data.*
import tv.flixtunes.app.data.DiscoveredServer
import tv.flixtunes.app.data.Media
import tv.flixtunes.app.ui.*
import tv.flixtunes.app.ui.Encre
import tv.flixtunes.app.ui.LocalGabarit
import tv.flixtunes.app.ui.MemoireTv
import tv.flixtunes.app.ui.memoireTv

@OptIn(ExperimentalFoundationApi::class)
@Composable internal fun FlixTunesApp(model: MainViewModel, discovered: List<DiscoveredServer>, play: (Media) -> Unit) {
    val state = model.state
    val gabarit = LocalGabarit.current
    val contexte = LocalContext.current
    val budgetTv = remember(gabarit.televiseur) {
        if (gabarit.televiseur) memoireTv(contexte) else MemoireTv.STANDARD
    }
    var reglagesOuverts by rememberSaveable { mutableStateOf(false) }
    var menuMedia by remember { mutableStateOf<Media?>(null) }
    var focusARestaurer by rememberSaveable { mutableStateOf<String?>(null) }
    // Ces états restent composés pendant l'ouverture d'une fiche : le retour retrouve donc exactement
    // la carte quittée, au lieu de replacer la personne en tête du catalogue. Une réserve courte suffit
    // à masquer la prochaine composition ; une grande réserve déclenche au contraire mesures et décodages
    // en rafale sur les boîtiers TV les plus modestes.
    val fenetreListes = remember(gabarit.televiseur) {
        LazyLayoutCacheWindow(
            aheadFraction = if (gabarit.televiseur) .12f else .2f,
            behindFraction = 0f,
        )
    }
    val accueilScroll = rememberLazyListState(cacheWindow = fenetreListes)
    val historiqueScroll = rememberLazyListState(cacheWindow = fenetreListes)
    // La grille garde une fraction d'écran d'avance, assez pour amorcer la rangée suivante mais pas un
    // écran entier : sur Android TV, cette ancienne valeur faisait concourir trop de compositions,
    // mesures et décodages avec le déplacement du focus. La définition des bitmaps ne change pas.
    val fenetreGrille = remember(gabarit.televiseur, budgetTv) {
        val (avanceTv, retourTv) = when (budgetTv) {
            MemoireTv.CONTRAINTE -> .26f to .10f
            MemoireTv.STANDARD -> .38f to .18f
            MemoireTv.LARGE -> .52f to .24f
        }
        LazyLayoutCacheWindow(
            // Sur TV, une vraie rangée et demie est composée pendant les temps morts. La valeur R54
            // (.14) était inférieure à une rangée : chaque pression verticale devait encore composer
            // la suivante dans l'image même où le focus se déplaçait.
            aheadFraction = if (gabarit.televiseur) avanceTv else .25f,
            behindFraction = if (gabarit.televiseur) retourTv else 0f,
        )
    }
    val filmsScroll = rememberLazyGridState(cacheWindow = fenetreGrille)
    val seriesScroll = rememberLazyGridState(cacheWindow = fenetreGrille)
    val rechercheScroll = rememberLazyGridState(cacheWindow = fenetreGrille)
    /**
     * La section courante se retient **ici**, au-dessus du choix d'écran.
     *
     * Elle vivait dans l'accueil. Ouvrir une fiche remplace l'accueil dans la composition : son
     * `remember` disparaît avec lui, et le retour reconstruisait un accueil neuf, donc sur « Accueil ».
     * Partir de Films, ouvrir un film, revenir — et se retrouver à l'accueil. Le client Web n'a pas ce
     * défaut parce que sa section vit dans l'adresse, qui survit à l'ouverture de la fiche.
     *
     * `rememberSaveable` plutôt que `remember` : la même section doit aussi survivre à une rotation et
     * à une reprise après que le système a repris la mémoire de l'application.
     */
    var section by rememberSaveable { mutableStateOf("home") }
    BackHandler(enabled = state.profile != null && (state.personDetails != null || state.details != null || section != "home")) {
        // Le retour défait un cran à la fois : d'abord la fiche, ensuite la section. Quitter
        // l'application depuis Films sans repasser par l'accueil serait un cran de trop.
        if (state.personDetails != null) model.closePerson()
        else if (state.details != null) model.closeDetails() else section = "home"
    }
    // Dans le nouveau parcours R49, Retour depuis les profils remonte d'un cran vers les groupes.
    // Il ne déconnecte pas le NAS et ne quitte pas brutalement l'application sur téléviseur.
    BackHandler(enabled = state.server != null && state.group != null && state.profile == null) { model.leaveGroup() }
    // Les barres système étant masquées, l'écran s'étend jusqu'aux bords — encoche comprise. Sans
    // cette marge, le titre d'un rail et les premières jaquettes passaient sous l'encoche, et la barre
    // de navigation tactile sous la zone de gestes. `safeDrawing` vaut zéro sur téléviseur, qui n'a ni
    // l'une ni l'autre : une seule écriture pour les deux surfaces.
    Surface(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing), color = Encre) {
        when {
            // Le démarrage a son propre écran : il évite le clignotement entre connexion, profils et accueil.
            state.startup != null -> EcranDemarrage(state.startup)
            state.server == null -> EcranConnexion(discovered, state.loading, state.error, model::connect)
            state.group == null -> EcranGroupes(state.groups, model::selectGroup, model::createGroup,
                model::updateGroup, model::deleteGroup, model::disconnect, state.error)
            state.profile == null -> EcranProfils(state.group, state.profiles, model::selectProfile, model::unlockProfile,
                model::createProfile, model::updateProfile, model::deleteProfile, model::leaveGroup, state.error)
            state.personDetails != null -> EcranPersonne(state.personDetails, model::image, model::closePerson,
                model::open, { menuMedia = it })
            state.details != null -> EcranFiche(state.details, model::image, model::closeDetails, play,
                { model.toggleWatchlist() }, model::toggleWatched, model::toggleSeasonWatched,
                model::open, model::openPerson, { genre -> model.closeDetails(); model.search(genre); section = "search" },
                { menuMedia = it })
            else -> EcranAccueil(
                state, model, play, section,
                accueilScroll, historiqueScroll, filmsScroll, seriesScroll, rechercheScroll,
                ouvrirMedia = { media -> focusARestaurer = media.catalogId ?: media.id; model.open(media) },
                focusARestaurer = focusARestaurer, focusRestaure = { focusARestaurer = null },
                ouvrirReglages = { reglagesOuverts = true }, ouvrirMenu = { menuMedia = it },
            ) { section = it }
        }
        if (state.loading && state.startup == null) LinearProgressIndicator(Modifier.fillMaxWidth().height(3.dp))
    }
    if (reglagesOuverts) state.profile?.let { profile ->
        DialogueReglagesLecture(
            profile = profile,
            onDismiss = { reglagesOuverts = false },
            onValider = { preferences ->
                reglagesOuverts = false
                model.updatePlaybackPreferences(preferences)
            },
        )
    }
    menuMedia?.let { media ->
        DialogueActionsMedia(
            media = media,
            fermer = { menuMedia = null },
            lire = { menuMedia = null; play(media) },
            ouvrir = { menuMedia = null; model.open(media) },
            basculerVu = { menuMedia = null; model.toggleWatched(media) },
            basculerListe = { menuMedia = null; model.toggleWatchlist(media) },
        )
    }
}
