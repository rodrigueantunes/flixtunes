package tv.flixtunes.app

import android.content.Context
import android.content.Intent
import android.media.MediaPlayer
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.layout.LazyLayoutCacheWindow
import androidx.compose.foundation.lazy.grid.itemsIndexed as gridItemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import coil3.size.Size
import tv.flixtunes.app.data.DiscoveredServer
import tv.flixtunes.app.data.Details
import tv.flixtunes.app.data.Media
import tv.flixtunes.app.data.PersonCredit
import tv.flixtunes.app.data.PersonDetails
import tv.flixtunes.app.data.Profile
import tv.flixtunes.app.data.ProfileGroup
import tv.flixtunes.app.data.Season
import tv.flixtunes.app.data.ServerDiscovery
import tv.flixtunes.app.ui.Accroche
import tv.flixtunes.app.ui.ApprocheEnseigne
import tv.flixtunes.app.ui.ApprocheTitre
import tv.flixtunes.app.ui.BadgesQualite
import tv.flixtunes.app.ui.BlocFocalisable
import tv.flixtunes.app.ui.BlocSource
import tv.flixtunes.app.ui.Bleu
import tv.flixtunes.app.ui.BleuClair
import tv.flixtunes.app.ui.BleuMarque
import tv.flixtunes.app.ui.BoutonPrimaire
import tv.flixtunes.app.ui.BoutonSecondaire
import tv.flixtunes.app.ui.CarteMedia
import tv.flixtunes.app.ui.CarteSaison
import tv.flixtunes.app.ui.FormatImageTv
import tv.flixtunes.app.ui.ImageOptimiseeTv
import tv.flixtunes.app.ui.EnTeteRail
import tv.flixtunes.app.ui.Encre
import tv.flixtunes.app.ui.EncreProfonde
import tv.flixtunes.app.ui.Erreur
import tv.flixtunes.app.ui.LigneEpisode
import tv.flixtunes.app.ui.Ligne
import tv.flixtunes.app.ui.LocalGabarit
import tv.flixtunes.app.ui.MarqueFlixTunes
import tv.flixtunes.app.ui.Muet
import tv.flixtunes.app.ui.Panneau
import tv.flixtunes.app.ui.PanneauHaut
import tv.flixtunes.app.ui.PastilleProfil
import tv.flixtunes.app.ui.PoliceTitre
import tv.flixtunes.app.ui.RayonAvatar
import tv.flixtunes.app.ui.RayonBoite
import tv.flixtunes.app.ui.RayonCommande
import tv.flixtunes.app.ui.RayonPanneau
import tv.flixtunes.app.ui.SectionRepliable
import tv.flixtunes.app.ui.Squelette
import tv.flixtunes.app.ui.TexteDoux
import tv.flixtunes.app.ui.ThemeFlixTunes
import tv.flixtunes.app.ui.VitrineHalo
import tv.flixtunes.app.ui.VitrineMilieu
import tv.flixtunes.app.ui.gabaritPour
import tv.flixtunes.app.ui.estAppareilTv
import tv.flixtunes.app.ui.memoireTv
import tv.flixtunes.app.ui.MemoireTv
import tv.flixtunes.app.ui.tailleTextureJaquetteTv
import tv.flixtunes.app.ui.BoutonTexte
import tv.flixtunes.app.ui.PuceFiltre
import tv.flixtunes.app.ui.PuceVersion
import tv.flixtunes.app.ui.cliquableAuFocus
import tv.flixtunes.app.ui.indicationFocus
import tv.flixtunes.app.ui.rememberSourceFocus
import tv.flixtunes.app.ui.mobile.NavigationTactile
import tv.flixtunes.app.ui.tv.NavigationTelevision
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlin.math.roundToInt

class MainActivity : ComponentActivity() {
    private val model by viewModels<MainViewModel>()
    private lateinit var discovery: ServerDiscovery
    private var discovered by mutableStateOf<List<DiscoveredServer>>(emptyList())

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) MediaPlayer.create(this, R.raw.flixtunes_startup)?.apply {
            setOnCompletionListener { completed -> completed.release() }
            setOnErrorListener { failed, _, _ -> failed.release(); true }
            start()
        }
        enableEdgeToEdge()
        discovery = ServerDiscovery(this) { server -> runOnUiThread { if (discovered.none { it.url == server.url }) discovered = discovered + server } }
        // Une seule décision, prise ici et fournie en ambiance : les écrans ne transportent plus le
        // drapeau de bout en bout, et la surface se lit d'un seul tenant dans `Gabarit`.
        val televiseur = estAppareilTv(this)
        setContent {
            // La largeur est relue par Compose : rotation et dépliage changent de gabarit sans
            // recréer artificiellement l'activité. Le mode TV reste décidé par le système.
            val gabarit = gabaritPour(televiseur, LocalConfiguration.current.screenWidthDp)
            CompositionLocalProvider(LocalGabarit provides gabarit) {
                ThemeFlixTunes { FlixTunesApp(model, discovered, ::play) }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        discovery.start()
        if (model.state.profile != null) {
            model.loadHome()
            model.refreshDetails()
        }
    }
    override fun onPause() { discovery.stop(); super.onPause() }

    private fun play(media: Media) {
        val playable = media.playableMediaId ?: if (media.kind != "show") media.id else return
        val state = model.state
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra(PlayerActivity.EXTRA_SERVER, state.server); putExtra(PlayerActivity.EXTRA_PROFILE_ID, state.profile?.id)
            putExtra(PlayerActivity.EXTRA_MEDIA_ID, playable); putExtra(PlayerActivity.EXTRA_TITLE, media.displayTitle)
            putExtra(PlayerActivity.EXTRA_PROGRESS, media.progressPercent)
            media.progressPositionSeconds?.let { putExtra(PlayerActivity.EXTRA_PROGRESS_SECONDS, it) }
            media.progressDurationSeconds?.let { putExtra(PlayerActivity.EXTRA_PROGRESS_DURATION_SECONDS, it) }
            putExtra(PlayerActivity.EXTRA_PROFILE_TOKEN, model.profileAccessToken())
            putStringArrayListExtra(PlayerActivity.EXTRA_AUDIO_LANGUAGES, ArrayList(state.profile?.preferredAudioLanguages.orEmpty()))
            putStringArrayListExtra(PlayerActivity.EXTRA_SUBTITLE_LANGUAGES, ArrayList(state.profile?.preferredSubtitleLanguages.orEmpty()))
            putExtra(PlayerActivity.EXTRA_SUBTITLE_MODE, state.profile?.subtitleMode ?: "forced")
            putExtra(PlayerActivity.EXTRA_AUDIO_OUTPUT, state.profile?.audioOutputMode ?: "auto")
            putExtra(PlayerActivity.EXTRA_AUDIO_NORMALIZATION, state.profile?.audioNormalization ?: false)
            putExtra(PlayerActivity.EXTRA_NIGHT_MODE, state.profile?.nightMode ?: false)
            putExtra(PlayerActivity.EXTRA_DYNAMIC_RANGE_PRIORITY, state.profile?.dynamicRangePriority ?: "auto")
            putExtra(PlayerActivity.EXTRA_RESUME_MODE, state.profile?.resumeMode ?: "continue")
            putExtra(PlayerActivity.EXTRA_RESUME_REWIND, state.profile?.resumeRewindSeconds ?: 5)
            putExtra(PlayerActivity.EXTRA_PLAYBACK_RATE, state.profile?.defaultPlaybackRate ?: 1f)
            putExtra(PlayerActivity.EXTRA_AUTOPLAY_NEXT, state.profile?.autoplayNext ?: true)
            putExtra(PlayerActivity.EXTRA_AUTOPLAY_LIMIT, state.profile?.autoplayLimit ?: 3)
        })
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable private fun FlixTunesApp(model: MainViewModel, discovered: List<DiscoveredServer>, play: (Media) -> Unit) {
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

/**
 * `.brand-intro` — l'ouverture : le logo, l'enseigne en deux couleurs, une accroche.
 *
 * Le Web y ajoute une orbite tournante et un dégradé radial ; Android garde en plus sa barre de
 * progression, qui n'existe pas côté Web et qu'il serait dommage de perdre. Elle suit des étapes
 * réellement franchies — connexion, profils, médiathèque — et s'arrête donc si le serveur ne répond
 * pas, ce qui est une information utile plutôt qu'une animation rassurante et fausse.
 */
@Composable private fun EcranDemarrage(step: StartupStep) {
    val gabarit = LocalGabarit.current
    val progress by animateFloatAsState(step.progress, animationSpec = tween(700), label = "progression")
    val apparition = remember { Animatable(0f) }
    LaunchedEffect(Unit) { apparition.animateTo(1f, tween(850)) }
    Box(
        Modifier
            .fillMaxSize()
            .background(Brush.radialGradient(listOf(Color(0xFF123A79), Encre, EncreProfonde))),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.padding(gabarit.margeEcran.dp).alpha(apparition.value),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            AsyncImageMarque(gabarit.tailleLogo.dp)
            Text(
                buildAnnotatedString {
                    append("Flix")
                    withStyle(SpanStyle(color = Color(0xFF72B9FF))) { append("Tunes") }
                },
                Modifier.padding(top = 14.dp),
                fontSize = gabarit.tailleEnseigne.sp,
                fontFamily = PoliceTitre,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = ApprocheEnseigne,
            )
            Text(
                stringResource(R.string.intro_accroche),
                Modifier.padding(top = 4.dp),
                color = Muet,
                fontSize = gabarit.tailleTexte.sp,
            )
            Spacer(Modifier.height(28.dp))
            LinearProgressIndicator(
                { progress },
                Modifier.widthIn(max = 360.dp).fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                color = Bleu,
                trackColor = Color.White.copy(alpha = .1f),
                gapSize = 0.dp,
                drawStopIndicator = {},
            )
            Text(
                "${(progress * 100).roundToInt()} %", Modifier.padding(top = 12.dp),
                fontSize = gabarit.tailleSection.sp, fontWeight = FontWeight.Bold,
            )
            Text(stringResource(step.libelle), Modifier.padding(top = 4.dp), color = Muet, fontSize = gabarit.tailleTexte.sp)
        }
    }
}

/** Le seul logo de l'application, à la taille demandée. */
@Composable private fun AsyncImageMarque(taille: Dp) {
    androidx.compose.foundation.Image(
        androidx.compose.ui.res.painterResource(R.drawable.flixtunes_mark),
        null,
        Modifier.size(taille),
    )
}

@Composable private fun EcranConnexion(
    servers: List<DiscoveredServer>, loading: Boolean, error: String?,
    connect: (String, String, String) -> Unit,
) {
    val gabarit = LocalGabarit.current
    var address by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(gabarit.margeEcran.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        MarqueFlixTunes(taillePolice = gabarit.tailleEnseigne, tailleLogo = 52.dp)
        Spacer(Modifier.height(30.dp))
        Accroche(stringResource(R.string.connexion_detectes))
        Text(
            stringResource(R.string.connexion_titre),
            Modifier.padding(top = 8.dp),
            fontSize = gabarit.tailleTitre.sp,
            fontFamily = PoliceTitre,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = ApprocheTitre,
        )
        Text(stringResource(R.string.connexion_aide), color = Muet)
        Spacer(Modifier.height(22.dp))
        OutlinedTextField(
            address, { address = it }, Modifier.widthIn(max = 520.dp).fillMaxWidth(),
            label = { Text(stringResource(R.string.connexion_exemple)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { if (address.isNotBlank() && !loading) connect(address, username, password) }),
            singleLine = true,
            shape = RoundedCornerShape(RayonCommande),
        )
        Spacer(Modifier.height(12.dp))
        Text(stringResource(R.string.connexion_compte_distant_aide), color = Muet, fontSize = 12.sp,
            modifier = Modifier.widthIn(max = 520.dp).fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            username, { username = it.take(64) }, Modifier.widthIn(max = 520.dp).fillMaxWidth(),
            label = { Text(stringResource(R.string.connexion_identifiant)) },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next), singleLine = true,
            shape = RoundedCornerShape(RayonCommande),
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            password, { password = it }, Modifier.widthIn(max = 520.dp).fillMaxWidth(),
            label = { Text(stringResource(R.string.connexion_mot_de_passe)) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { if (address.isNotBlank() && !loading) connect(address, username, password) }),
            visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
            singleLine = true, shape = RoundedCornerShape(RayonCommande),
        )
        Spacer(Modifier.height(12.dp))
        BoutonPrimaire(stringResource(R.string.connexion_valider), { connect(address, username, password) }, actif = address.isNotBlank() && !loading)
        if (error != null) Text(error, color = Erreur, modifier = Modifier.padding(12.dp))
        if (servers.isNotEmpty()) {
            Text(stringResource(R.string.connexion_detectes), Modifier.padding(top = 20.dp, bottom = 8.dp), color = Muet)
            servers.forEach { server ->
                val source = rememberSourceFocus()
                OutlinedButton(
                    { connect(server.url, "", "") },
                    Modifier.indicationFocus(source, 12),
                    interactionSource = source,
                ) {
                    Text("${server.name} · ${server.url}")
                }
            }
        }
    }
}

private val profileColors = listOf("#2968ff", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#06b6d4")

@Composable private fun EcranGroupes(
    groups: List<ProfileGroup>,
    select: (ProfileGroup) -> Unit,
    create: (String) -> Unit,
    update: (ProfileGroup, String) -> Unit,
    delete: (ProfileGroup) -> Unit,
    disconnect: () -> Unit,
    error: String?,
) {
    val gabarit = LocalGabarit.current
    var creating by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<ProfileGroup?>(null) }
    var deleting by remember { mutableStateOf<ProfileGroup?>(null) }
    var name by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(gabarit.margeEcran.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
    ) {
        MarqueFlixTunes(taillePolice = gabarit.tailleEnseigne, tailleLogo = 52.dp)
        Accroche(stringResource(R.string.groupes_titre), Modifier.padding(top = 26.dp))
        Text(stringResource(R.string.groupes_sous_titre), Modifier.padding(top = 6.dp, bottom = 26.dp),
            fontSize = gabarit.tailleTitre.sp, fontFamily = PoliceTitre, fontWeight = FontWeight.ExtraBold)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(18.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            groups.forEach { group ->
                Column(Modifier.width(gabarit.largeurCarte.dp)) {
                    BlocFocalisable({ select(group) }, Modifier.fillMaxWidth(), RayonAvatar.value.toInt()) {
                        Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(RayonAvatar))
                            .background(Panneau), contentAlignment = Alignment.Center) {
                            Text(group.name.take(1).uppercase(), fontSize = 44.sp, fontFamily = PoliceTitre,
                                fontWeight = FontWeight.ExtraBold, color = BleuClair)
                        }
                        Text(group.name, Modifier.padding(top = 10.dp), maxLines = 1,
                            overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold)
                    }
                    Row {
                        BoutonTexte({ editing = group; name = group.name }) {
                            Text(stringResource(R.string.profil_modifier), fontSize = 12.sp, color = BleuClair)
                        }
                        if (groups.size > 1) BoutonTexte({ deleting = group }) {
                            Text(stringResource(R.string.action_supprimer), fontSize = 12.sp, color = Erreur)
                        }
                    }
                }
            }
            BlocFocalisable({ creating = true; name = "" }, Modifier.width(gabarit.largeurCarte.dp), RayonAvatar.value.toInt()) {
                Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(RayonAvatar)).background(Panneau),
                    contentAlignment = Alignment.Center) {
                    Text("+", fontSize = 44.sp, fontFamily = PoliceTitre, fontWeight = FontWeight.ExtraBold, color = Muet)
                }
                Text(stringResource(R.string.groupe_ajouter), Modifier.padding(top = 10.dp), fontWeight = FontWeight.Bold)
            }
        }
        if (error != null) Text(error, color = Erreur, modifier = Modifier.padding(top = 16.dp))
        BoutonTexte(disconnect, Modifier.padding(top = 28.dp)) { Text(stringResource(R.string.connexion_changer), color = Muet) }
    }
    if (creating || editing != null) AlertDialog(
        onDismissRequest = { creating = false; editing = null }, containerColor = PanneauHaut,
        title = { Text(if (editing == null) stringResource(R.string.groupe_nouveau) else stringResource(R.string.groupe_modifier)) },
        text = { OutlinedTextField(name, { name = it.take(32) }, label = { Text(stringResource(R.string.groupe_nom)) }, singleLine = true) },
        confirmButton = { Button({ editing?.let { update(it, name) } ?: create(name); creating = false; editing = null },
            enabled = name.isNotBlank()) { Text(stringResource(R.string.profil_enregistrer)) } },
        dismissButton = { TextButton({ creating = false; editing = null }) { Text(stringResource(R.string.action_annuler)) } },
    )
    deleting?.let { group -> AlertDialog(
        onDismissRequest = { deleting = null }, containerColor = PanneauHaut,
        title = { Text(stringResource(R.string.groupe_supprimer_titre, group.name)) },
        text = { Text(stringResource(R.string.groupe_supprimer_aide)) },
        confirmButton = { Button({ delete(group); deleting = null }) { Text(stringResource(R.string.action_supprimer)) } },
        dismissButton = { TextButton({ deleting = null }) { Text(stringResource(R.string.action_annuler)) } },
    ) }
}

/**
 * `.profile-panel` — le choix du profil, et sa modification.
 *
 * La modification n'existait que dans le client Web : sur Android, changer une couleur ou poser un
 * code PIN demandait de supprimer le profil et de le recréer, ce qui emporte tout l'historique.
 */
@Composable private fun EcranProfils(
    group: ProfileGroup,
    profiles: List<Profile>,
    select: (Profile) -> Unit,
    unlock: (Profile, String) -> Unit,
    create: (String, String, String, String?, Boolean, Int?) -> Unit,
    update: (Profile, String, String, String, String?, String?, Boolean, Int?) -> Unit,
    delete: (Profile) -> Unit,
    backToGroups: () -> Unit,
    error: String?,
) {
    val gabarit = LocalGabarit.current
    var lockedProfile by remember { mutableStateOf<Profile?>(null) }
    var profileToDelete by remember { mutableStateOf<Profile?>(null) }
    var profileToEdit by remember { mutableStateOf<Profile?>(null) }
    var creating by remember { mutableStateOf(false) }
    var pin by remember { mutableStateOf("") }
    val cardWidth = gabarit.largeurCarte.dp
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(gabarit.margeEcran.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        MarqueFlixTunes(taillePolice = gabarit.tailleEnseigne, tailleLogo = 52.dp)
        Accroche(stringResource(R.string.profils_titre), Modifier.padding(top = 26.dp))
        Text(
            group.name,
            Modifier.padding(top = 6.dp, bottom = 26.dp),
            fontSize = gabarit.tailleTitre.sp,
            fontFamily = PoliceTitre,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = ApprocheTitre,
        )
        LazyRow(horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            items(profiles, key = { it.id }) { profile ->
                Column(Modifier.width(cardWidth)) {
                    BlocFocalisable(
                        onClick = { if (profile.protected) { lockedProfile = profile; pin = "" } else select(profile) },
                        modifier = Modifier.fillMaxWidth(),
                        arrondi = RayonAvatar.value.toInt(),
                    ) {
                    Box(
                        Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(RayonAvatar))
                            .background(runCatching { Color(android.graphics.Color.parseColor(profile.avatarColor)) }.getOrDefault(Bleu)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            profile.name.take(1).uppercase(), fontSize = 44.sp,
                            fontFamily = PoliceTitre, fontWeight = FontWeight.ExtraBold, color = Color.White,
                        )
                    }
                    Text(
                        (if (profile.protected) "🔒 " else "") + profile.name, Modifier.padding(top = 10.dp),
                        maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold,
                    )
                    Text(
                        if (profile.language == "fr-FR") "Français" else "English",
                        color = Muet, fontSize = 12.sp,
                    )
                    if (profile.isChild) Text(stringResource(R.string.profil_enfant_age, profile.age ?: 0), color = BleuClair, fontSize = 12.sp)
                    }
                    // Les commandes d'administration ne sont pas imbriquées dans la cible qui ouvre
                    // le profil : TalkBack et la télécommande rencontrent trois actions distinctes.
                    Row {
                        BoutonTexte({ profileToEdit = profile }) {
                            Text(stringResource(R.string.profil_modifier), fontSize = 12.sp, color = BleuClair)
                        }
                        // La suppression du dernier profil est refusée par le serveur : le bouton disparaît.
                        if (profiles.size > 1) BoutonTexte({ profileToDelete = profile }) {
                            Text(stringResource(R.string.action_supprimer), fontSize = 12.sp, color = Erreur)
                        }
                    }
                }
            }
            item {
                BlocFocalisable(
                    onClick = { creating = true },
                    modifier = Modifier.width(cardWidth),
                    arrondi = RayonAvatar.value.toInt(),
                ) {
                    Box(
                        Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(RayonAvatar)).background(Panneau),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("+", fontSize = 44.sp, fontFamily = PoliceTitre, fontWeight = FontWeight.ExtraBold, color = Muet)
                    }
                    Text(
                        stringResource(R.string.profil_ajouter), Modifier.padding(top = 10.dp),
                        maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
        if (error != null) Text(error, color = Erreur, modifier = Modifier.padding(top = 16.dp))
        BoutonTexte(backToGroups, Modifier.padding(top = 28.dp)) {
            Text(stringResource(R.string.groupes_changer), color = Muet)
        }
    }
    lockedProfile?.let { profile ->
        AlertDialog(
            onDismissRequest = { lockedProfile = null },
            title = { Text(stringResource(R.string.profil_pin_de, profile.name)) },
            text = {
                OutlinedTextField(
                    pin, { value -> pin = value.filter(Char::isDigit).take(8) }, label = { Text("PIN") }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                )
            },
            confirmButton = {
                Button({ unlock(profile, pin); lockedProfile = null }, enabled = pin.length in 4..8) {
                    Text(stringResource(R.string.profil_deverrouiller))
                }
            },
            dismissButton = { TextButton({ lockedProfile = null }) { Text(stringResource(R.string.action_annuler)) } },
            containerColor = PanneauHaut,
            shape = RoundedCornerShape(RayonBoite),
        )
    }
    profileToDelete?.let { profile ->
        AlertDialog(
            onDismissRequest = { profileToDelete = null },
            title = { Text(stringResource(R.string.profil_supprimer_titre, profile.name)) },
            text = { Text(stringResource(R.string.profil_supprimer_avertissement)) },
            confirmButton = { Button({ delete(profile); profileToDelete = null }) { Text(stringResource(R.string.action_supprimer)) } },
            dismissButton = { TextButton({ profileToDelete = null }) { Text(stringResource(R.string.action_annuler)) } },
            containerColor = PanneauHaut,
            shape = RoundedCornerShape(RayonBoite),
        )
    }
    if (creating) DialogueProfil(
        existant = null,
        onDismiss = { creating = false },
        onValider = { name, color, language, newPin, _, isChild, age ->
            creating = false; create(name, color, language, newPin, isChild, age)
        },
    )
    profileToEdit?.let { profile ->
        DialogueProfil(
            existant = profile,
            onDismiss = { profileToEdit = null },
            onValider = { name, color, language, newPin, ancienPin, isChild, age ->
                profileToEdit = null
                update(profile, name, color, language, newPin, ancienPin, isChild, age)
            },
        )
    }
}

/**
 * Création et modification d'un profil, dans la même boîte.
 *
 * Les deux gestes remplissent exactement les mêmes champs : les écrire deux fois garantissait qu'un
 * ajout à l'un manquerait à l'autre — ce qui s'était déjà produit côté Web avant que le panneau ne
 * réunisse les deux.
 */
@Composable private fun DialogueProfil(
    existant: Profile?,
    onDismiss: () -> Unit,
    onValider: (String, String, String, String?, String?, Boolean, Int?) -> Unit,
) {
    var name by remember { mutableStateOf(existant?.name ?: "") }
    var color by remember { mutableStateOf(existant?.avatarColor ?: profileColors.first()) }
    var language by remember { mutableStateOf(existant?.language ?: "fr-FR") }
    var pin by remember { mutableStateOf("") }
    var ancienPin by remember { mutableStateOf("") }
    var retirerPin by remember { mutableStateOf(false) }
    var isChild by remember { mutableStateOf(existant?.isChild ?: false) }
    var ageText by remember { mutableStateOf(existant?.age?.toString() ?: "") }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = PanneauHaut,
        shape = RoundedCornerShape(RayonBoite),
        title = {
            Text(if (existant == null) stringResource(R.string.profil_nouveau) else stringResource(R.string.profil_modifier))
        },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()).imePadding()) {
                OutlinedTextField(
                    name, { name = it.take(32) }, label = { Text(stringResource(R.string.profil_nom)) },
                    singleLine = true, shape = RoundedCornerShape(RayonCommande),
                )
                Spacer(Modifier.height(12.dp))
                Text(stringResource(R.string.profil_couleur), fontSize = 12.sp, color = Muet)
                FlowRow(Modifier.padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    profileColors.forEachIndexed { index, value ->
                        val descriptionCouleur = stringResource(R.string.profil_couleur_numero, index + 1)
                        Box(
                            Modifier.size(48.dp)
                                .semantics {
                                    contentDescription = descriptionCouleur
                                    selected = value == color
                                }
                                .cliquableAuFocus(
                                    arrondi = 11,
                                    role = Role.RadioButton,
                                    selectionne = value == color,
                                ) { color = value },
                            contentAlignment = Alignment.Center,
                        ) {
                            Box(
                                Modifier.size(34.dp).clip(RoundedCornerShape(11.dp))
                                    .background(runCatching { Color(android.graphics.Color.parseColor(value)) }.getOrDefault(Bleu))
                                    .border(if (value == color) 3.dp else 0.dp, Color.White, RoundedCornerShape(11.dp)),
                            )
                        }
                    }
                }
                Spacer(Modifier.height(14.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(R.string.profil_langue), fontSize = 12.sp, color = Muet, modifier = Modifier.padding(end = 10.dp))
                    PuceFiltre(language == "fr-FR", { language = "fr-FR" }) { Text("Français") }
                    Spacer(Modifier.width(8.dp))
                    PuceFiltre(language == "en-US", { language = "en-US" }) { Text("English") }
                }
                Spacer(Modifier.height(14.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(checked = isChild, onCheckedChange = { isChild = it; if (!it) ageText = "" })
                    Text(stringResource(R.string.profil_enfant))
                }
                if (isChild) {
                    OutlinedTextField(
                        ageText, { ageText = it.filter(Char::isDigit).take(2) },
                        label = { Text(stringResource(R.string.profil_age)) }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        supportingText = { Text(stringResource(R.string.profil_age_aide)) },
                    )
                    Spacer(Modifier.height(14.dp))
                }
                if (existant?.protected == true) {
                    OutlinedTextField(
                        ancienPin, { ancienPin = it.filter(Char::isDigit).take(8) },
                        label = { Text(stringResource(R.string.profil_pin_actuel)) },
                        singleLine = true, shape = RoundedCornerShape(RayonCommande),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    )
                    Spacer(Modifier.height(10.dp))
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                  OutlinedTextField(
                    pin, { pin = it.filter(Char::isDigit).take(8); retirerPin = false },
                    modifier = Modifier.weight(1f),
                    label = {
                        Text(
                            if (existant == null) stringResource(R.string.profil_pin_facultatif)
                            else stringResource(R.string.profil_pin_inchange),
                        )
                    },
                    singleLine = true, shape = RoundedCornerShape(RayonCommande),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                  )
                  if (existant?.protected == true) {
                    TextButton({ retirerPin = true; pin = "" }) {
                        Text(stringResource(R.string.profil_pin_retirer), color = Erreur, fontSize = 12.sp, maxLines = 1)
                    }
                  }
                }
                if (retirerPin) Text(stringResource(R.string.profil_pin_retrait_confirmer), color = Erreur, fontSize = 12.sp)
            }
        },
        confirmButton = {
            Button(
                {
                    // Une chaîne vide n'est pas « pas de changement » : elle retirerait le code. Un
                    // champ laissé vide ne transmet donc rien du tout, et le code en place survit.
                    val nouveauPin = if (retirerPin) "" else pin.takeIf { it.length in 4..8 }
                    onValider(name, color, language, nouveauPin,
                        ancienPin.takeIf { existant?.protected == true && nouveauPin != null }, isChild, ageText.toIntOrNull())
                },
                enabled = name.isNotBlank() && (pin.isEmpty() || pin.length in 4..8) &&
                    (!isChild || ageText.toIntOrNull() in 0..17) &&
                    (existant?.protected != true || (!retirerPin && pin.isEmpty()) || ancienPin.length in 4..8),
            ) {
                Text(if (existant == null) "Créer" else stringResource(R.string.profil_enregistrer))
            }
        },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.action_annuler)) } },
    )
}

/**
 * Réglages de lecture du profil actif.
 *
 * Le serveur et le lecteur Android appliquaient déjà toutes ces préférences, mais seul le client Web
 * pouvait les modifier. Cette boîte ne crée aucun réglage local divergent : elle enregistre le profil
 * puis le prochain lecteur reçoit les mêmes valeurs que le Web et la TV.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable private fun DialogueReglagesLecture(
    profile: Profile,
    onDismiss: () -> Unit,
    onValider: (Profile) -> Unit,
) {
    val premierAudio = profile.preferredAudioLanguages.firstOrNull()?.lowercase()
    var ordreAudio by remember(profile.id) {
        mutableStateOf(
            when (premierAudio) {
                "original" -> "original-fr-en"
                "en", "eng" -> "en-original-fr"
                else -> "fr-en-original"
            },
        )
    }
    var sortieAudio by remember(profile.id) { mutableStateOf(profile.audioOutputMode) }
    var sousTitres by remember(profile.id) { mutableStateOf(profile.subtitleMode) }
    var normalisation by remember(profile.id) { mutableStateOf(profile.audioNormalization) }
    var modeNuit by remember(profile.id) { mutableStateOf(profile.nightMode) }
    var plageDynamique by remember(profile.id) { mutableStateOf(profile.dynamicRangePriority) }
    var reprise by remember(profile.id) { mutableStateOf(profile.resumeMode) }
    var retourReprise by remember(profile.id) { mutableStateOf(profile.resumeRewindSeconds.toString()) }
    var vitesse by remember(profile.id) { mutableStateOf(profile.defaultPlaybackRate.toString()) }
    var episodeSuivant by remember(profile.id) { mutableStateOf(profile.autoplayNext) }
    var limite by remember(profile.id) { mutableStateOf(profile.autoplayLimit.toString()) }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = PanneauHaut,
        shape = RoundedCornerShape(RayonBoite),
        title = { Text(stringResource(R.string.reglages_lecture_pour, profile.name)) },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()).imePadding(),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                ChoixDeroulant(
                    stringResource(R.string.reglages_audio_langues),
                    listOf(
                        "fr-en-original" to stringResource(R.string.reglages_audio_fr),
                        "original-fr-en" to stringResource(R.string.reglages_audio_original),
                        "en-original-fr" to stringResource(R.string.reglages_audio_en),
                    ),
                    ordreAudio,
                ) { ordreAudio = it }
                ChoixDeroulant(
                    stringResource(R.string.reglages_sortie_audio),
                    listOf(
                        "auto" to stringResource(R.string.reglages_sortie_auto),
                        "copy" to stringResource(R.string.reglages_sortie_copy),
                        "aac" to "AAC universel",
                        "ac3" to "Dolby Digital / AC-3",
                        "opus" to "Opus",
                    ),
                    sortieAudio,
                ) { sortieAudio = it }
                ChoixDeroulant(
                    stringResource(R.string.reglages_sous_titres_auto),
                    listOf(
                        "forced" to stringResource(R.string.reglages_sous_titres_forces),
                        "always" to stringResource(R.string.reglages_sous_titres_toujours),
                        "off" to stringResource(R.string.reglages_sous_titres_off),
                    ),
                    sousTitres,
                ) { sousTitres = it }
                ChoixDeroulant(
                    stringResource(R.string.reglages_plage_dynamique),
                    listOf(
                        "auto" to stringResource(R.string.reglages_plage_auto),
                        "dolbyvision" to "Dolby Vision",
                        "hdr10plus" to "HDR10+",
                        "hdr10" to "HDR10",
                        "hlg" to "HLG",
                        "sdr" to "SDR",
                    ),
                    plageDynamique,
                ) { plageDynamique = it }
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    PuceFiltre(normalisation, { normalisation = !normalisation }) {
                        Text(stringResource(R.string.reglages_normalisation))
                    }
                    PuceFiltre(modeNuit, { modeNuit = !modeNuit }) {
                        Text(stringResource(R.string.reglages_mode_nuit))
                    }
                    PuceFiltre(episodeSuivant, { episodeSuivant = !episodeSuivant }) {
                        Text(stringResource(R.string.reglages_episode_suivant))
                    }
                }
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    ChoixDeroulant(
                        stringResource(R.string.reglages_reprise),
                        listOf(
                            "continue" to stringResource(R.string.reglages_reprise_auto),
                            "ask" to stringResource(R.string.reglages_reprise_demander),
                            "restart" to stringResource(R.string.reglages_reprise_debut),
                        ),
                        reprise,
                    ) { reprise = it }
                    ChoixDeroulant(
                        stringResource(R.string.reglages_retour_reprise),
                        listOf("0", "5", "10", "20").map { secondes ->
                            secondes to if (secondes == "0") stringResource(R.string.reglages_aucun)
                            else pluralStringResource(R.plurals.reglages_secondes, secondes.toInt(), secondes.toInt())
                        },
                        retourReprise,
                    ) { retourReprise = it }
                    ChoixDeroulant(
                        stringResource(R.string.reglages_vitesse),
                        listOf("0.75", "1.0", "1.25", "1.5", "2.0").map { valeur ->
                            valeur to "${valeur.replace(".0", "").replace('.', ',')}×"
                        },
                        vitesse,
                    ) { vitesse = it }
                    if (episodeSuivant) ChoixDeroulant(
                        stringResource(R.string.reglages_limite),
                        listOf("1", "2", "3", "5", "10").map { valeur ->
                            valeur to pluralStringResource(R.plurals.reglages_episodes, valeur.toInt(), valeur.toInt())
                        },
                        limite,
                    ) { limite = it }
                }
            }
        },
        confirmButton = {
            Button({
                val languesAudio = when (ordreAudio) {
                    "original-fr-en" -> listOf("original", "fr", "en")
                    "en-original-fr" -> listOf("en", "original", "fr")
                    else -> listOf("fr", "en", "original")
                }
                onValider(
                    profile.copy(
                        preferredAudioLanguages = languesAudio,
                        preferredSubtitleLanguages = if (profile.language == "fr-FR") listOf("fr", "en") else listOf("en", "fr"),
                        subtitleMode = sousTitres,
                        audioOutputMode = sortieAudio,
                        audioNormalization = normalisation,
                        nightMode = modeNuit,
                        dynamicRangePriority = plageDynamique,
                        resumeMode = reprise,
                        resumeRewindSeconds = retourReprise.toInt(),
                        defaultPlaybackRate = vitesse.toFloat(),
                        autoplayNext = episodeSuivant,
                        autoplayLimit = limite.toInt(),
                    ),
                )
            }) { Text(stringResource(R.string.profil_enregistrer)) }
        },
        dismissButton = { TextButton(onDismiss) { Text(stringResource(R.string.action_annuler)) } },
    )
}

@Composable private fun EcranAccueil(
    state: MainState,
    model: MainViewModel,
    play: (Media) -> Unit,
    section: String,
    accueilScroll: LazyListState,
    historiqueScroll: LazyListState,
    filmsScroll: LazyGridState,
    seriesScroll: LazyGridState,
    rechercheScroll: LazyGridState,
    ouvrirMedia: (Media) -> Unit,
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
                if (gabarit.televiseur) NavigationTelevision(section) { cle ->
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
            NavigationTactile(section, Modifier.align(Alignment.BottomCenter)) { cle ->
                changerSection(cle)
                model.search("")
            }
        }
    }
}

/** `HomeSkeleton` du Web — trois rails en attente, à la place exacte de ceux qui arrivent. */
@Composable private fun AccueilEnAttente() {
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
@Composable private fun Vitrine(media: Media, backdrop: String?, play: () -> Unit, info: () -> Unit) {
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
@Composable private fun ligneMeta(media: Media): AnnotatedString {
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
@Composable private fun Rail(
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

/** L'écran Historique du Web : une accroche, un titre, deux rails. */
@Composable private fun EcranHistorique(
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

/**
 * `.search-panel` — la recherche dans un panneau, comme sur le Web.
 *
 * Elle était un champ posé nu sous la barre du haut. Le panneau la rattache visuellement à la loupe
 * qui l'ouvre, et pose les résultats dans la même grille que le catalogue.
 */
@Composable private fun PanneauRecherche(
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

/**
 * `.catalog-page` — le catalogue complet, avec l'en-tête et les commandes du Web.
 *
 * Tri, état, recherche interne et genres n'existaient pas ici. Sur une médiathèque de mille cinq cents
 * films, un catalogue sans filtre ne se parcourt pas : il se subit. Les critères partent au serveur,
 * qui les applique sur l'ensemble — les appliquer sur les fiches déjà reçues afficherait un décompte
 * faux dès la deuxième page.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable private fun GrilleCatalogue(
    titre: String,
    section: CatalogSection,
    image: (String?) -> String?,
    open: (Media) -> Unit,
    ouvrirMenu: (Media) -> Unit,
    focusARestaurer: String?,
    focusRestaure: () -> Unit,
    bottomInset: Dp,
    total: Int,
    critere: (String?, String?, String?, List<String>?) -> Unit,
    loadPrevious: () -> Unit,
    loadMore: () -> Unit,
    grid: LazyGridState,
    sauterLettre: (String?) -> Unit,
    ancrePositionnee: () -> Unit,
) {
    val gabarit = LocalGabarit.current
    val edge = gabarit.margeBord.dp
    // Une seule demande reste en attente : pendant un maintien D-pad, la position la plus récente
    // remplace l'ancienne sans interrompre les quelques bitmaps déjà en cours de préparation.
    val demandesPrecharge = remember { Channel<Int>(capacity = Channel.CONFLATED) }
    if (gabarit.televiseur) {
        val contexte = LocalContext.current
        val chargeurImages = remember(contexte) { SingletonImageLoader.get(contexte) }
        val largeurJaquettePx = remember(contexte) { tailleTextureJaquetteTv(contexte) }
        // Un seul bitmap se prépare à la fois. Entre deux images, `tryReceive` prend immédiatement la
        // position de focus la plus récente : aucune file périmée ne subsiste après un maintien D-pad,
        // mais le décodage déjà presque fini n'est pas annulé puis recommencé en boucle.
        LaunchedEffect(section.items, largeurJaquettePx, demandesPrecharge) {
            if (section.items.isEmpty()) return@LaunchedEffect
            var precedent = -1
            demandesPrecharge.trySend(0)
            var rangFocalise = demandesPrecharge.receive()
            while (true) {
                val versBas = precedent < 0 || rangFocalise >= precedent
                precedent = rangFocalise
                val indices = if (versBas) {
                    (rangFocalise + 1)..(rangFocalise + 8)
                } else {
                    (rangFocalise - 1) downTo (rangFocalise - 8)
                }
                val urls = indices.mapNotNull { rang ->
                    section.items.getOrNull(rang)?.posterUrl?.let(image)
                }.distinct()
                var nouvelleCible: Int? = null
                for (url in urls) {
                    val cibleRecente = demandesPrecharge.tryReceive().getOrNull()
                    if (cibleRecente != null) {
                        nouvelleCible = cibleRecente
                        break
                    }
                    try {
                        chargeurImages.execute(
                            ImageRequest.Builder(contexte)
                                .data(url)
                                .size(Size(largeurJaquettePx, largeurJaquettePx * 3 / 2))
                                .build()
                        )
                    } catch (annulation: CancellationException) {
                        throw annulation
                    } catch (_: Throwable) {
                        // Une prélecture est opportuniste ; la carte visible garde sa requête.
                    }
                }
                rangFocalise = nouvelleCible ?: demandesPrecharge.receive()
            }
        }
    }
    var alphabetOuvert by rememberSaveable { mutableStateOf(false) }
    var rendreFocusGrille by remember { mutableStateOf(false) }
    var cibleFocusAlphabet by remember { mutableStateOf<String?>(null) }
    val initialeVisible by remember(section.items, grid) {
        derivedStateOf {
            val index = (grid.layoutInfo.visibleItemsInfo.firstOrNull { it.index > 0 }?.index ?: 1) - 1
            section.items.getOrNull(index)?.title?.let(::initialeCatalogue)
                ?: section.letter?.uppercase()
                ?: "A"
        }
    }
    // L'en-tête occupe l'index 0. Le serveur renvoie maintenant une fenêtre *autour* de la lettre :
    // l'ancre désigne sa jaquette exacte, tandis que les éléments précédents restent accessibles.
    // Une fois consommée, cette commande ne se rejoue pas au retour d'une fiche.
    LaunchedEffect(section.anchor, section.offset, section.items) {
        val anchor = section.anchor ?: return@LaunchedEffect
        if (section.items.isEmpty()) return@LaunchedEffect
        val localIndex = (anchor - section.offset).coerceIn(0, section.items.lastIndex)
        cibleFocusAlphabet = section.items[localIndex].catalogId ?: section.items[localIndex].id
        grid.scrollToItem(localIndex + 1)
        ancrePositionnee()
    }
    BackHandler(alphabetOuvert) { alphabetOuvert = false; rendreFocusGrille = true }
    Box(Modifier.fillMaxSize()) {
    GrilleMedia(
        media = section.items,
        image = image,
        open = open,
        ouvrirMenu = ouvrirMenu,
        focusARestaurer = if (rendreFocusGrille) cibleFocusAlphabet else focusARestaurer,
        focusRestaure = {
            if (rendreFocusGrille) rendreFocusGrille = false else focusRestaure()
        },
        bottomInset = bottomInset,
        vide = if (section.query.isNotBlank() || section.filter != "all" || section.genres.isNotEmpty())
            stringResource(R.string.catalogue_aucun_resultat_filtre)
        else stringResource(R.string.catalogue_aucun_resultat_analyse),
        total = total,
        initialOffset = section.offset,
        chargement = section.loading,
        // Attendre que l'ancre ait placé la grille : sinon l'index initial 0 déclencherait à tort le
        // chargement arrière avant même le saut demandé.
        chargerAvant = if (section.anchor == null) loadPrevious else null,
        chargerSuite = loadMore,
        focusPris = { demandesPrecharge.trySend(it) },
        grid = grid,
        modifier = Modifier.onPreviewKeyEvent { evenement ->
            if (!gabarit.televiseur) return@onPreviewKeyEvent false
            if (evenement.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
            // Le maintien Droite reste le raccourci volontaire vers la réglette cliquable.
            val ouvrirParDroite = evenement.key == Key.DirectionRight && evenement.nativeKeyEvent.repeatCount >= 2
            if (ouvrirParDroite) {
                alphabetOuvert = true
                true
            } else false
        },
        entete = {
            Column(Modifier.padding(horizontal = edge, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Accroche(stringResource(R.string.catalogue_accroche))
                Text(
                    titre,
                    fontSize = gabarit.tailleTitre.sp,
                    fontFamily = PoliceTitre,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = ApprocheTitre,
                )
                // Les textes affichés viennent des ressources, jamais du code : ils doivent pouvoir
                // se traduire. Le décompte s'assemble donc à partir de trois chaînes déclarées.
                val libelleTitres =
                    if (total > 1) stringResource(R.string.catalogue_titres) else stringResource(R.string.catalogue_titre)
                val affiches = if (section.items.size < total) {
                    " · " + stringResource(R.string.catalogue_affiches, section.items.size)
                } else ""
                Text("$total $libelleTitres$affiches", color = Muet)
                // Disponible sans occuper l'écran en permanence. La recherche globale reste dans la
                // navigation principale ; celle-ci ne filtre que le catalogue courant et se range
                // comme les genres, avec la requête active toujours visible dans son résumé.
                SectionRepliable(
                    titre = stringResource(R.string.catalogue_recherche),
                    resume = section.query.ifBlank { stringResource(R.string.catalogue_recherche_aucune) },
                    compte = if (section.query.isBlank()) 0 else 1,
                ) {
                    OutlinedTextField(
                        section.query,
                        { grid.requestScrollToItem(0); critere(null, null, it, null) },
                        Modifier.fillMaxWidth().widthIn(max = 420.dp),
                        placeholder = { Text(stringResource(R.string.catalogue_rechercher_dans, titre.lowercase()), color = Muet) },
                        singleLine = true,
                        shape = RoundedCornerShape(RayonCommande),
                    )
                    if (section.query.isNotBlank()) {
                        BoutonTexte({ grid.requestScrollToItem(0); critere(null, null, "", null) }) {
                            Text(stringResource(R.string.catalogue_recherche_effacer), color = Muet, fontSize = 13.sp)
                        }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    ChoixDeroulant(
                        stringResource(R.string.catalogue_etat),
                        listOf(
                            "all" to stringResource(R.string.catalogue_etat_tous),
                            "progress" to stringResource(R.string.catalogue_etat_en_cours),
                            "watched" to stringResource(R.string.catalogue_etat_vus),
                            "unwatched" to stringResource(R.string.catalogue_etat_non_vus),
                        ),
                        section.filter,
                    ) { grid.requestScrollToItem(0); critere(null, it, null, null) }
                    ChoixDeroulant(
                        stringResource(R.string.catalogue_trier),
                        listOf(
                            "title" to stringResource(R.string.catalogue_tri_titre),
                            "release" to stringResource(R.string.catalogue_tri_sortie),
                            "added" to stringResource(R.string.catalogue_tri_ajout),
                        ),
                        section.sort,
                    ) { grid.requestScrollToItem(0); critere(it, null, null, null) }
                }
                if (section.availableGenres.isNotEmpty()) {
                    // Replié par défaut : vingt puces déroulées en permanence repoussaient la première
                    // jaquette hors de l'écran, et obligeaient la télécommande à les traverser toutes
                    // pour atteindre la grille. L'en-tête garde ce qui compte — le nombre de genres
                    // retenus et leur énumération —, seul l'outil se range.
                    SectionRepliable(
                        titre = stringResource(R.string.catalogue_genres),
                        resume = section.genres.joinToString(", ")
                            .ifBlank { stringResource(R.string.catalogue_genres_tous) },
                        compte = section.genres.size,
                    ) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (genre in section.availableGenres) {
                                val retenu = genre in section.genres
                                PuceFiltre(
                                    retenu,
                                    {
                                        grid.requestScrollToItem(0)
                                        critere(null, null, null,
                                            if (retenu) section.genres - genre else section.genres + genre)
                                    },
                                ) { Text(genre, fontSize = 13.sp) }
                            }
                            if (section.genres.isNotEmpty()) {
                                BoutonTexte({ grid.requestScrollToItem(0); critere(null, null, null, emptyList()) }) {
                                    Text(stringResource(R.string.catalogue_genres_effacer), color = Muet, fontSize = 13.sp)
                                }
                            }
                        }
                    }
                }
            }
        },
    )
    if (gabarit.televiseur) {
        if (alphabetOuvert) {
            IndexAlphabetique(
                lettreActive = section.letter?.uppercase(),
                lettreInitiale = initialeVisible,
                choisir = { sauterLettre(it.lowercase()) },
                fermer = { alphabetOuvert = false; rendreFocusGrille = true },
                modifier = Modifier.align(Alignment.CenterEnd),
            )
        } else {
            Box(
                Modifier
                    .align(Alignment.CenterEnd)
                    .width(38.dp)
                    .height(108.dp)
                    // Pendant le retour d'une fiche, seule sa jaquette peut reprendre le focus. La
                    // poignée redevient accessible aussitôt la restauration confirmée.
                    .focusProperties { canFocus = focusARestaurer == null && !rendreFocusGrille }
                    .semantics { contentDescription = "Index alphabétique" }
                    .onFocusChanged { if (it.isFocused) alphabetOuvert = true }
                    .cliquableAuFocus(arrondi = 14) { alphabetOuvert = true },
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("A", color = Muet, fontWeight = FontWeight.Bold)
                    Text("⋮", color = Muet)
                    Text("Z", color = Muet, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
    }
}

/** Index TV façon vidéothèque : droite pour l'ouvrir, haut/bas pour choisir, OK pour sauter. */
@Composable private fun IndexAlphabetique(
    lettreActive: String?,
    lettreInitiale: String,
    choisir: (String) -> Unit,
    fermer: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val focus = remember { FocusRequester() }
    val cible = lettreActive ?: lettreInitiale
    LaunchedEffect(Unit) { focus.requestFocus() }
    Surface(
        modifier
            .fillMaxHeight(.94f)
            .width(58.dp)
            .onPreviewKeyEvent { evenement ->
                if (evenement.type == KeyEventType.KeyDown && evenement.key == Key.DirectionLeft) {
                    fermer(); true
                } else false
            },
        color = EncreProfonde.copy(alpha = .96f),
        shape = RoundedCornerShape(topStart = 18.dp, bottomStart = 18.dp),
        tonalElevation = 10.dp,
    ) {
        LazyColumn(
            horizontalAlignment = Alignment.CenterHorizontally,
            contentPadding = PaddingValues(vertical = 10.dp),
        ) {
            items(INDEX_ALPHABETIQUE, key = { it }) { lettre ->
                val active = lettre == lettreActive
                var focalisee by remember { mutableStateOf(false) }
                LaunchedEffect(focalisee) {
                    if (focalisee && !active) {
                        // Un petit délai absorbe les répétitions très rapides, tout en laissant la
                        // médiathèque suivre dès que le pouce marque une courte pause sur une lettre.
                        delay(110)
                        if (focalisee) choisir(lettre)
                    }
                }
                Box(
                    Modifier
                        .padding(vertical = 1.dp, horizontal = 7.dp)
                        .fillMaxWidth()
                        .height(30.dp)
                        .then(if (lettre == cible) Modifier.focusRequester(focus) else Modifier)
                        .onFocusChanged { focalisee = it.isFocused }
                        .semantics { selected = active }
                        .cliquableAuFocus(arrondi = 10) { choisir(lettre) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        lettre,
                        color = if (active) BleuClair else TexteDoux,
                        fontWeight = if (active) FontWeight.ExtraBold else FontWeight.Bold,
                        fontSize = 14.sp,
                    )
                }
            }
        }
    }
}

/**
 * La grille de jaquettes, employée par le catalogue, la recherche et l'historique.
 *
 * Le nombre de colonnes suit la largeur réelle de l'écran, du téléphone en portrait au téléviseur 4K.
 */
@Composable private fun GrilleMedia(
    media: List<Media>,
    image: (String?) -> String?,
    open: (Media) -> Unit,
    ouvrirMenu: (Media) -> Unit,
    focusARestaurer: String?,
    focusRestaure: () -> Unit,
    bottomInset: Dp,
    vide: String,
    entete: (@Composable () -> Unit)?,
    grid: LazyGridState,
    modifier: Modifier = Modifier,
    initialOffset: Int = 0,
    total: Int = media.size,
    chargement: Boolean = false,
    chargerAvant: (() -> Unit)? = null,
    chargerSuite: (() -> Unit)? = null,
    focusPremier: Boolean = false,
    premierFocusRestaure: () -> Unit = {},
    focusPris: (Int) -> Unit = {},
) {
    val gabarit = LocalGabarit.current
    val edge = gabarit.margeBord.dp
    // Le chargement se déclenche à l'approche du bas plutôt qu'une fois arrivé : la page suivante a
    // ainsi le temps d'arriver avant que le défilement ne bute sur le vide.
    val approcheDuBas by remember(media.size, total, initialOffset, gabarit.televiseur) {
        derivedStateOf {
            val dernier = grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            // Quatre rangées de marge sur TV : la page et ses images arrivent avant le focus. Le
            // seuil tactile reste inchangé.
            val seuil = 24
            initialOffset + media.size < total && dernier >= media.size - seuil
        }
    }
    val approcheDuHaut by remember(media.size, initialOffset, gabarit.televiseur) {
        derivedStateOf {
            val premier = grid.layoutInfo.visibleItemsInfo.firstOrNull { it.index > 0 }?.index ?: 0
            initialOffset > 0 && premier in 1..(if (gabarit.televiseur) 8 else 16)
        }
    }
    LaunchedEffect(approcheDuHaut) { if (approcheDuHaut) chargerAvant?.invoke() }
    LaunchedEffect(approcheDuBas) { if (approcheDuBas) chargerSuite?.invoke() }
    LazyVerticalGrid(
        columns = GridCells.Adaptive(minSize = gabarit.largeurMiniGrille.dp),
        state = grid,
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = edge, end = edge, top = 4.dp, bottom = bottomInset),
        horizontalArrangement = Arrangement.spacedBy(gabarit.ecartCartes.dp),
        verticalArrangement = Arrangement.spacedBy(gabarit.margeInterne.dp),
    ) {
        if (entete != null) item(span = { GridItemSpan(maxLineSpan) }) { entete() }
        if (media.isEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                if (chargement) {
                    Column(Modifier.fillMaxWidth().padding(top = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(color = Bleu)
                    }
                } else {
                    Column(
                        Modifier.fillMaxWidth().padding(top = 40.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            stringResource(R.string.catalogue_aucun_resultat),
                            fontSize = gabarit.tailleTitreCatalogue.sp,
                            fontFamily = PoliceTitre,
                            fontWeight = FontWeight.ExtraBold,
                        )
                        Text(vide, color = Muet, modifier = Modifier.padding(top = 8.dp))
                    }
                }
            }
            return@LazyVerticalGrid
        }
        gridItemsIndexed(media, key = { _, item -> item.id }, contentType = { _, _ -> "media" }) { rang, item ->
            CarteMedia(item, image(item.posterUrl), { open(item) }, Modifier.fillMaxWidth(), rang,
                menu = { ouvrirMenu(item) },
                restaurerFocus = focusARestaurer == (item.catalogId ?: item.id) || (focusPremier && rang == 0),
                focusRestaure = if (focusPremier && rang == 0) premierFocusRestaure else focusRestaure,
                focusPris = { focusPris(rang) })
        }
        if (initialOffset + media.size < total) item(span = { GridItemSpan(maxLineSpan) }) {
            Box(Modifier.fillMaxWidth().padding(vertical = 22.dp), contentAlignment = Alignment.Center) {
                if (chargement) CircularProgressIndicator(color = Bleu)
                else BoutonTexte({ chargerSuite?.invoke() }, arrondi = 999) {
                    Text(stringResource(R.string.catalogue_suite, total - initialOffset - media.size), color = BleuClair)
                }
            }
        }
    }
}

/**
 * `.catalog-controls label + select` — un intitulé discret au-dessus d'un choix encadré.
 *
 * Un menu déroulant plutôt qu'une rangée de puces : les quatre états et les trois tris tiennent alors
 * dans la largeur d'un téléphone, et le parcours au focus d'un téléviseur ne traverse pas sept
 * boutons pour atteindre la grille.
 */
@Composable private fun ChoixDeroulant(
    intitule: String,
    choix: List<Pair<String, String>>,
    valeur: String,
    choisir: (String) -> Unit,
) {
    var ouvert by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(intitule, color = Muet, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        Box {
            Row(
                Modifier
                    .clip(RoundedCornerShape(RayonCommande))
                    .background(Color(0xFF111824))
                    .border(1.dp, Ligne, RoundedCornerShape(RayonCommande))
                    .heightIn(min = 48.dp)
                    .cliquableAuFocus(arrondi = RayonCommande.value.toInt()) { ouvert = true }
                    .padding(horizontal = 14.dp, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(choix.firstOrNull { it.first == valeur }?.second ?: valeur)
                Spacer(Modifier.width(10.dp))
                Text("▾", color = Muet)
            }
            DropdownMenu(ouvert, { ouvert = false }) {
                for ((cle, libelle) in choix) {
                    DropdownMenuItem(
                        text = { Text(libelle, color = if (cle == valeur) BleuClair else Color.White) },
                        onClick = { ouvert = false; choisir(cle) },
                    )
                }
            }
        }
    }
}

/**
 * `.details-modal` — la fiche.
 *
 * Elle reprend, dans l'ordre du Web : le bandeau et son titre, les badges de qualité, la rangée
 * d'actions, le résumé, le fichier d'origine et ses versions, les saisons présentées par leur
 * jaquette, puis les épisodes avec durée, résumé, avancement et marquage.
 */
@Composable private fun libelleRole(role: String): String = when (role) {
    "director" -> stringResource(R.string.personne_realisation)
    "creator" -> stringResource(R.string.personne_creation)
    "writer" -> stringResource(R.string.personne_scenario)
    "composer" -> stringResource(R.string.personne_musique)
    else -> stringResource(R.string.personne_interprete)
}

@Composable private fun CartePersonne(person: PersonCredit, portrait: String?, ouvrir: () -> Unit) {
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

@Composable private fun EcranPersonne(
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

@Composable private fun resourcesQuantityString(id: Int, quantity: Int, vararg args: Any): String =
    pluralStringResource(id, quantity, *args)

@Composable private fun DialogueActionsMedia(
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

@Composable private fun EcranFiche(
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
    var saison by remember(details.item.id) { mutableIntStateOf(details.seasons.firstOrNull()?.number ?: 1) }
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
                                val cible = if (item.kind == "show") episodes.firstOrNull() ?: item else item
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
