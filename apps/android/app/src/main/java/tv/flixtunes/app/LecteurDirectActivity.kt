package tv.flixtunes.app

import tv.flixtunes.app.ui.BoutonCast
import tv.flixtunes.app.playback.TelecommandeAndroid
import tv.flixtunes.app.playback.etatDiffusionAndroid
import tv.flixtunes.app.ui.ouvrirDialogueDiffusion
import tv.flixtunes.app.ui.TelecommandeLecteur
import tv.flixtunes.app.playback.toucheVolumeDiffusion
import tv.flixtunes.app.playback.SuiviDiffusion

import android.annotation.SuppressLint
import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.ComponentCallbacks2
import android.content.res.Configuration
import android.media.MediaCodecList
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.key
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.Format
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import tv.flixtunes.app.playback.DebitContinu
import tv.flixtunes.app.playback.ErreurRelaisDirect
import tv.flixtunes.app.playback.SurveillanceReseauDirect
import tv.flixtunes.app.playback.doitPreparerSecours
import tv.flixtunes.app.playback.positionDeRaccord
import tv.flixtunes.app.playback.rearmerCouleursDirect
import tv.flixtunes.app.playback.RenduDirectTv
import androidx.media3.common.C
import androidx.media3.exoplayer.DefaultLivePlaybackSpeedControl
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.hls.HlsManifest
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.LoadEventInfo
import androidx.media3.exoplayer.source.MediaLoadData
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import tv.flixtunes.app.data.ChaineDirect
import tv.flixtunes.app.data.FlixTunesApi
import tv.flixtunes.app.playback.AVANCE_FRAGILE_MS
import tv.flixtunes.app.playback.COURSE_MAX
import tv.flixtunes.app.playback.CacheSegmentsDirect
import tv.flixtunes.app.playback.budgetMemoireDirect
import tv.flixtunes.app.playback.SourceDirectAvecCache
import tv.flixtunes.app.playback.SourceDirectAuthentifie
import tv.flixtunes.app.playback.estRelaisFlixTunes
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DefaultDataSource
import tv.flixtunes.app.playback.avanceViseeMs
import tv.flixtunes.app.playback.GroupeDeSources
import tv.flixtunes.app.playback.debutDeVague
import tv.flixtunes.app.playback.premiereAdresse
import tv.flixtunes.app.playback.prochaineAdresse
import tv.flixtunes.app.playback.regrouperLesSources
import tv.flixtunes.app.ui.BleuClair
import tv.flixtunes.app.ui.Encre
import tv.flixtunes.app.ui.Muet
import tv.flixtunes.app.ui.ThemeFlixTunes

/**
 * Le lecteur d'une chaîne en direct.
 *
 * Il est séparé de [PlayerActivity], et ce n'est pas un doublon : les deux ne partagent presque rien.
 * Le lecteur de la médiathèque négocie une session avec le serveur, choisit un mode de conversion,
 * gère les pistes, la reprise, les sous-titres, la plage dynamique et l'enchaînement d'épisodes. Une
 * chaîne, elle, est **une adresse HLS qu'on ouvre** : pas de session, pas de position, pas de fin.
 * Faire entrer ce cas dans l'autre aurait ajouté une condition à chacune de ces étapes.
 *
 * Deux choses lui sont propres, et ce sont les deux demandes de l'étape :
 *
 * - **le repli.** Une chaîne porte plusieurs adresses — 57 % des entrées du corpus sont des doublons
 *   réunis. Quand la première refuse, on prend la suivante, sans message ni geste ;
 * - **le numéro à la télécommande.** Composer « 1 » puis « 3 » ouvre la 13, comme sur un téléviseur.
 */
/*
 * `@OptIn` et non `@UnstableApi`, comme le lecteur de la médiathèque le fait déjà.
 *
 * Les deux se ressemblent et disent le contraire. `@UnstableApi` déclare que **cette classe** fait
 * partie d'une surface instable, ce qui oblige chacun de ses appelants à le déclarer à son tour :
 * lint remontait neuf erreurs dans `MainActivity`, une par constante lue. `@OptIn` dit ce qui est
 * vrai — cette classe **consomme** une API instable de media3 —, et s'arrête à elle.
 */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class LecteurDirectActivity : ComponentActivity() {
    private var lecteur: ExoPlayer? = null
    private var vueLecteur: PlayerView? = null
    private var generationSurface by mutableIntStateOf(0)
    private var candidatAffiche by mutableStateOf<ExoPlayer?>(null)
    private val premieresImages = mutableSetOf<ExoPlayer>()
    private val renduTvProtege by lazy {
        resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK == Configuration.UI_MODE_TYPE_TELEVISION
    }
    private var renduAvantReprise = ""
    private var renduCourant by mutableStateOf("")
    private var secours: ExoPlayer? = null
    private val decodeurs = mutableMapOf<ExoPlayer, String>()
    private val instancesDecodeurs = mutableMapOf<String, Int>()
    private var generationLecture = 0
    private var debitContinu = DebitContinu()
    private var stableDepuis = 0L
    private var dernierChargement = 0L
    private var renouvellementEnCours = false
    private var dernierRenouvellement = 0L
    private var surveillanceReseau: SurveillanceReseauDirect? = null
    private var diagnosticOuvert by mutableStateOf(false)
    private val dernierArretSysteme: String? by lazy {
        if (Build.VERSION.SDK_INT < 30) null else runCatching {
            val arret = (getSystemService(ACTIVITY_SERVICE) as ActivityManager)
                .getHistoricalProcessExitReasons(packageName, 0, 1).firstOrNull()
            val motif = when (arret?.reason) {
                ApplicationExitInfo.REASON_LOW_MEMORY -> "mémoire insuffisante"
                ApplicationExitInfo.REASON_CRASH -> "exception de l’application"
                ApplicationExitInfo.REASON_CRASH_NATIVE -> "arrêt du moteur natif"
                ApplicationExitInfo.REASON_ANR -> "application bloquée"
                else -> null
            }
            motif?.takeIf { arret != null && System.currentTimeMillis() - arret.timestamp < 24 * 60 * 60_000L }
                ?.let { "Dernier arrêt signalé par Android : $it" }
        }.getOrNull()
    }
    private var reserveMs by mutableLongStateOf(0L)
    private var derniereReprise = 0L
    private var identites: Map<String, String> = emptyMap()
    private val reposSources = mutableMapOf<String, Long>()
    private lateinit var api: FlixTunesApi
    private lateinit var profileId: String

    /**
     * Les adresses de la chaîne courante, dans l'ordre où le repli les essaie.
     *
     * C'est l'ordre du serveur — échecs, puis définition mesurée dans le manifeste, puis débit —,
     * retouché par la course : dans chaque vague de douze, celles qui répondent passent devant. Toutes
     * se choisissent à la touche verte.
     */
    private var adresses: List<String> = emptyList()
    /** Ce que le serveur sait de chaque adresse, retrouvé par l'adresse elle-même : définition et débit, empreinte d'affichage. */
    private var qualites: Map<String, Pair<Int?, Int?>> = emptyMap()
    private var empreintes: Map<String, String> = emptyMap()
    /**
     * Les adresses que le serveur n'a pas pu joindre, sondées une fois qu'une autre joue.
     *
     * Elles sortent du repli automatique, pas du menu : le NAS ne passe pas forcément par le même
     * chemin que le téléviseur, et c'est la lecture qui garde le dernier mot.
     */
    private var muettes by mutableStateOf<Set<String>>(emptySet())
    /** Les vagues de course déjà lancées, et si les autres sources ont déjà été sondées pour cette chaîne. */
    private val vaguesCourues = mutableSetOf(0)
    private var sondee = false
    /** La chaîne quittée, pour y revenir d'une touche — le second geste d'un téléviseur. */
    private var precedente: String? = null
    private var rang = 0
    /** L'adresse en cours d'essai. Vidée dès qu'on bascule, elle sert de verrou contre les rafales. */
    private var essai: String? = null
    private var echeance: Job? = null

    private var chaine by mutableStateOf<ChaineDirect?>(null)
    private var message by mutableStateOf<String?>(null)
    private var echec by mutableStateOf(false)
    /** Numéro en cours de composition à la télécommande, ou `null` quand personne ne compose. */
    private var saisie by mutableStateOf<String?>(null)
    private var effacementSaisie: Job? = null

    /** La fenêtre publiée par la chaîne et l'endroit où l'on s'y trouve, relevés quatre fois par seconde. */
    private var fenetreMs by mutableLongStateOf(0L)
    private var positionMs by mutableLongStateOf(0L)
    private var retardMs by mutableLongStateOf(0L)
    private var enPause by mutableStateOf(false)
    /** Les commandes se montrent au geste et s'effacent : on regarde la télévision, pas une interface. */
    private var commandesVisibles by mutableStateOf(true)
    private var effacementCommandes: Job? = null
    /** La liste des sources, ouverte à la touche verte. */
    private var choixOuvert by mutableStateOf(false)
    private var choixIndex by mutableIntStateOf(0)

    /**
     * Le retour ferme la liste des sources avant de quitter la chaîne.
     *
     * Ce n'est pas la touche `BACK` qu'on écoute : sur un téléphone récent, le geste de retour ne
     * l'envoie plus du tout — il passe par ce répartiteur, et lint le signale comme une erreur.
     * Le rappel n'est actif que lorsque la liste est ouverte ; sinon le retour fait ce qu'il a
     * toujours fait, fermer le lecteur.
     */
    private val fermerLeChoix = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            if (choixOuvert) montrerLesSources(false) else montrerDiagnostic(false)
        }
    }

    /**
     * Les groupes du menu, tous, dans l'ordre où le repli essaie les adresses.
     *
     * Ils étaient calculés une fois, dans l'ordre du serveur, alors que le repli suit l'ordre de la
     * course : choisir une ligne pouvait ouvrir une autre adresse que celle qu'elle décrivait. Ils se
     * calculent maintenant sur les adresses telles qu'on les joue, et les muettes ferment la marche.
     */
    private fun groupesDuMenu(): List<GroupeDeSources> =
        regrouperLesSources(adresses.map { empreintes[it].orEmpty() }, adresses, muettes)

    /** La ligne du menu qui porte l'adresse en cours, pour y poser le curseur à l'ouverture. */
    private fun ligneDuRang(): Int = groupesDuMenu().indexOfFirst { it.index == rang }.coerceAtLeast(0)

    private fun montrerLesSources(ouvert: Boolean) {
        choixOuvert = ouvert
        fermerLeChoix.isEnabled = ouvert || diagnosticOuvert
        if (ouvert) commandesVisibles = true
    }

    private fun montrerDiagnostic(ouvert: Boolean) {
        diagnosticOuvert = ouvert
        fermerLeChoix.isEnabled = ouvert || choixOuvert
        reveiller()
    }
    /**
     * Le retard de sécurité pris après des blocages répétés, en secondes.
     *
     * Zéro tant que tout va bien : on part **au bord du flux**, et l'on ne paie du retard que
     * lorsqu'il est mérité.
     */
    /**
     * Ce qu'on sait de la lecture en cours, pour ne pas condamner une source vivante.
     *
     * `depuisLecture` est l'instant où l'image est apparue pour la dernière fois. Une adresse qui a
     * joué dix minutes puis s'est interrompue n'est pas morte — elle a rencontré un incident. Sans
     * cette date, les deux cas étaient indiscernables et traités pareil : abandon, et échec inscrit
     * au classement.
     *
     * `reprises` compte les redémarrages tentés **sur la même adresse**, `relancesLentes` ceux tentés
     * après que toutes les adresses ont été épuisées. Les deux se remettent à zéro dès que l'image
     * revient : ce qui est compté, c'est une série d'échecs, pas une vie entière.
     */
    private var depuisLecture = 0L
    /**
     * **La déclaration de flux stable**, et pourquoi tout en dépend.
     *
     * La patience est un remède quand l'image est établie, et un poison quand on cherche encore une
     * source. Une tolérance de quinze secondes appliquée partout ferait payer quinze secondes à
     * *chaque* adresse morte de la course d'ouverture — c'est-à-dire allonger l'attente précisément
     * au moment où l'on n'a encore rien à perdre, et où l'on veut trouver vite.
     *
     * Un flux est donc déclaré stable quand il a tenu l'image `SEUIL_STABILITE_MS` d'affilée. Avant
     * cette déclaration, on garde le comportement rapide : trois tentatives, et l'on passe à la
     * suivante. Après, on devient patient — quinze secondes d'image acquise achètent quinze secondes
     * d'obstination.
     *
     * La déclaration vaut pour l'adresse en cours et repart à zéro quand on en change : c'est cette
     * source-ci qui a fait ses preuves, pas la chaîne.
     */
    private var fluxDeclareStable = false
    /** Une adresse de cette chaîne a-t-elle déjà fait ses preuves ? Décide de l'obstination finale. */
    private var dejaVuStable = false
    private var reprises = 0
    private var relancesLentes = 0
    private var repriseEnCours: Job? = null
    private val budgetMemoire by lazy {
        val gestionnaire = getSystemService(ACTIVITY_SERVICE) as ActivityManager
        budgetMemoireDirect(minOf(Runtime.getRuntime().maxMemory(), gestionnaire.memoryClass.toLong() * 1024 * 1024), gestionnaire.isLowRamDevice)
    }
    private val cacheSegments by lazy { CacheSegmentsDirect(maximum = budgetMemoire.cacheOctets) }
    private var adresseRapportee: String? = null
    /** Ce qui a coupé, et au bout de combien de temps — dit à l'écran plutôt que deviné. */
    private var dernierIncident: String? = null

    /** Le plafond de débit imposé, `Int.MAX_VALUE` tant qu'on n'a rien cédé. */
    private var plafondDebit = Int.MAX_VALUE

    private var securite by mutableIntStateOf(0)
    private var blocages = mutableListOf<Long>()
    /** Réparations tentées sur l'adresse en cours : une seule, après quoi la source est bien en cause. */
    private var reparations = 0
    /**
     * Jusqu'à quand on ne compte aucun blocage.
     *
     * Ouvrir, sauter, reprendre rechargent le tampon, et les compter comme des hoquets faisait
     * reculer le lecteur alors que tout allait bien. Le recul lui-même reprépare le flux : le juger
     * pendant qu'il se remplit reviendrait à le condamner pour le remède qu'on vient de lui donner.
     */
    private var silenceJusqua = 0L
    /** Depuis quand on est sur cette source : on ne zappe pas une chaîne qui vient de démarrer. */
    private var depuisSource = 0L
    private var surveillanceBlocage: Job? = null

    /**
     * La commande de vitesse du direct, gardée pour changer la cible en cours de lecture.
     *
     * Une source fragile prend jusqu'à 60 s d'avance au lieu de 40 : ExoPlayer ralentit alors
     * imperceptiblement — 0,97× au plus — jusqu'à l'atteindre, sans jamais couper l'image.
     */
    private val vitesses = mutableMapOf<ExoPlayer, DefaultLivePlaybackSpeedControl>()
    /**
     * Les incidents de l'adresse en cours depuis qu'on la regarde — un blocage, une reprise. Un seul
     * suffit à la dire fragile.
     */
    private var incidents = 0
    private var adresseDesIncidents: String? = null
    /** Les échecs que le serveur connaît pour chaque adresse : une source qui en traîne est fragile d'emblée. */
    private var echecs: Map<String, Int> = emptyMap()
    /** L'avance demandée en dernier à ExoPlayer, pour ne l'écrire qu'au changement. */
    private var avanceDemandeeMs = C.TIME_UNSET

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val serveur = intent.getStringExtra(EXTRA_SERVER) ?: return finish()
        profileId = intent.getStringExtra(EXTRA_PROFILE_ID) ?: return finish()
        val chaineId = intent.getStringExtra(EXTRA_CHANNEL_ID) ?: return finish()
        api = FlixTunesApi(serveur, intent.getStringExtra(EXTRA_PROFILE_TOKEN))
        if (!estAppareilTv(this)) SuiviDiffusion.attacher(this, api)
        TelecommandeAndroid.attacher(this, api, profileId, ::etatPourDiffusion) { c ->
            val player = lecteur ?: error("Lecteur en préparation")
            when (c.getString("type")) {
                "pause" -> player.pause()
                "reprendre" -> player.play()
                "volume" -> player.volume = c.getDouble("valeur").toFloat()
                "arreter" -> finish()
                else -> error("Déplacement distant indisponible pour le direct")
            }
        }
        message = getString(R.string.direct_ouverture)

        /*
         * Le lecteur était construit nu — `ExoPlayer.Builder(this).build()` — et c'est ce qui manquait
         * le plus à la stabilité. Deux réglages y répondent, et ils ne coûtent rien au NAS puisque
         * tout se passe ici.
         *
         * **Le tampon.** Quinze secondes avant de démarrer et jusqu'à soixante en réserve : la fenêtre
         * médiane du corpus fait 61 s, il n'y a pas plus de média publié à prendre. C'est la marge que
         * l'on peut acheter, et pas une de plus.
         *
         * **La vitesse.** `LiveConfiguration` autorise ExoPlayer à jouer entre 0,97× et 1,03× pour
         * revenir à sa cible : il **glisse** vers elle au lieu de se figer puis de sauter. C'est le
         * mécanisme prévu pour exactement ce cas, et on ne le lui demandait pas.
         */
        // Les jaquettes sont sur disque ; leur cache RAM ne doit pas concurrencer deux décodeurs.
        coil3.SingletonImageLoader.get(this).memoryCache?.clear()
        lecteur = creerLecteur()

        /*
         * Les barres du système n'ont rien à faire par-dessus une chaîne.
         *
         * Le lecteur de la médiathèque les masque depuis toujours ; celui du direct ne le faisait pas,
         * et sur téléphone l'heure, la batterie et les trois boutons restaient posés sur l'image.
         * `masquerBarresSysteme` est l'endroit unique où ce réglage vit — le recopier ici l'aurait
         * fait diverger à la première retouche.
         */
        masquerBarresSysteme()
        /*
         * Le drapeau de fenêtre **en plus** de celui de la vue, et ce n'est pas une ceinture de trop.
         *
         * La r5 posait `keepScreenOn` sur la vue du lecteur, comme le fait la médiathèque. Sur un vrai
         * téléviseur, la mise en veille est quand même survenue au bout de quelques minutes : le
         * verrou porté par une vue dépend de son attachement et de sa visibilité, et une vue posée
         * dans un `AndroidView` de Compose n'offre pas les mêmes garanties qu'un arbre de vues
         * ordinaire. Le drapeau de fenêtre, lui, tient tant que l'activité est au premier plan, et
         * c'est le chemin que la documentation d'Android recommande.
         */
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onBackPressedDispatcher.addCallback(this, fermerLeChoix)
        setContent { ThemeFlixTunes { Ecran() } }
        ouvrir(chaineId)
    }

    /** Charge une chaîne et lance sa première adresse. C'est aussi le chemin d'un changement de chaîne. */
    private fun creerLecteur(): ExoPlayer {
        val controleVitesse = DefaultLivePlaybackSpeedControl.Builder().build()
        var dernierFormat: Format? = null
        return ExoPlayer.Builder(this).apply {
            if (renduTvProtege) setRenderersFactory(RenduDirectTv(this@LecteurDirectActivity))
        }
            .setLivePlaybackSpeedControl(controleVitesse)

            .setMediaSourceFactory(
                DefaultMediaSourceFactory(this)
                    .setDataSourceFactory(DataSource.Factory {
                        SourceDirectAvecCache(SourceDirectAuthentifie(api.serverUrl, DefaultDataSource.Factory(this)), cacheSegments)
                    })
                    .setLoadErrorHandlingPolicy(object : DefaultLoadErrorHandlingPolicy() {

                        override fun getMinimumLoadableRetryCount(dataType: Int): Int =
                            if (fluxDeclareStable) REPRISES_INTERNES_STABLE else super.getMinimumLoadableRetryCount(dataType)
                    }),
            )
            .setLoadControl(
                DefaultLoadControl.Builder()

                    .setBufferDurationsMs(40_000, 70_000, 8_000, 8_000)
                    .setTargetBufferBytes(budgetMemoire.tamponOctets)
                    .setPrioritizeTimeOverSizeThresholds(false)
                    .build(),
            )
            .build().apply {
            val joueurObserve = this
            vitesses[this] = controleVitesse
            playWhenReady = true
            addAnalyticsListener(object : AnalyticsListener {
                override fun onRenderedFirstFrame(eventTime: AnalyticsListener.EventTime, output: Any, renderTimeMs: Long) {
                    if (vitesses.containsKey(joueurObserve)) premieresImages.add(joueurObserve)
                }
                override fun onVideoDecoderInitialized(eventTime: AnalyticsListener.EventTime, decoderName: String,
                    initializedTimestampMs: Long, initializationDurationMs: Long) {
                    if (vitesses.containsKey(joueurObserve)) decodeurs[joueurObserve] = decoderName
                }
                override fun onVideoInputFormatChanged(eventTime: AnalyticsListener.EventTime, format: Format,
                    decoderReuseEvaluation: androidx.media3.exoplayer.DecoderReuseEvaluation?) {
                    val avant = dernierFormat
                    dernierFormat = format
                    if (lecteur === joueurObserve) {
                        renduCourant = decrireRendu(format)
                        if (avant != null && (avant.colorInfo != format.colorInfo || avant.sampleMimeType != format.sampleMimeType)
                            && rearmerCouleursDirect(avant, format) && !renduTvProtege) {
                            renduAvantReprise = decrireRendu(avant)
                            renouvelerSurface()
                        }
                    }
                }
                override fun onLoadCompleted(eventTime: AnalyticsListener.EventTime, loadEventInfo: LoadEventInfo, mediaLoadData: MediaLoadData) {
                    if (lecteur === joueurObserve && mediaLoadData.dataType == C.DATA_TYPE_MEDIA) dernierChargement = System.currentTimeMillis()
                }
            })
            addListener(object : Player.Listener {
                override fun onPlayerError(error: PlaybackException) {
                    if (lecteur !== joueurObserve) return
                    val erreurRelais = generateSequence<Throwable>(error) { it.cause }
                        .filterIsInstance<ErreurRelaisDirect>().firstOrNull()
                    if (erreurRelais?.statut in setOf(401, 403, 404) &&
                        adresses.getOrNull(rang)?.let { estRelaisFlixTunes(it, api.serverUrl) } == true &&
                        !renouvellementEnCours && System.currentTimeMillis() - dernierRenouvellement >= 30_000) {
                        val generation = generationLecture
                        lifecycleScope.launch {
                            val avant = adresses.getOrNull(rang)
                            renouvelerAdresses()
                            if (generation == generationLecture && lecteur === joueurObserve && adresses.getOrNull(rang) == avant) {
                                if (!relancerLaSource()) suivante()
                            }
                        }
                        return
                    }

                    if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                        deplacerLecture(joueurObserve)
                        prepare()
                        return
                    }
                    if (error.errorCode == PlaybackException.ERROR_CODE_DECODING_FAILED && reparations < 1) {
                        reparations += 1
                        jouerRang()
                        return
                    }

                    dernierIncident = "réseau (${error.errorCodeName})"
                    if (fluxDeclareStable && relancerLaSource()) return
                    suivante()
                }

                override fun onPlaybackStateChanged(etat: Int) {
                    if (lecteur !== joueurObserve) return

                    if (etat != Player.STATE_BUFFERING) { surveillanceBlocage?.cancel(); return }
                    // Une image figée trop longtemps n'attend pas d'être comptée.
                    surveillerLeBlocage()
                    val maintenant = System.currentTimeMillis()
                    if (maintenant < silenceJusqua) return
                    incidents += 1


                    if (plafondDebit == Int.MAX_VALUE) {
                        blocages = blocages.filter { maintenant - it < MEMOIRE_BLOCAGES_MS }.toMutableList()
                        blocages.add(maintenant)
                        if (blocages.size < BLOCAGES_AVANT_RECUL) return
                        reagirALInstabilite()
                        return
                    }

                    if (maintenant - (blocages.lastOrNull() ?: 0L) < INTERVALLE_MIN_BLOCAGE_MS) return
                    blocages = blocages.filter { maintenant - it < MEMOIRE_BLOCAGES_MS }.toMutableList()
                    blocages.add(maintenant)
                    if (blocages.size < BLOCAGES_AVANT_RECUL) return
                    // Jamais avant une minute sur la source : le repli doit rester un dernier mot.
                    if (maintenant - depuisSource < TEMPS_MIN_SUR_SOURCE_MS) return

                    reagirALInstabilite()
                }

                override fun onIsPlayingChanged(joue: Boolean) {
                    if (lecteur !== joueurObserve) return
                    if (!joue) { depuisLecture = 0L; return }

                    // Une reprise automatique ne doit pas remettre les incrustations sur l'image.
                    if (commandesVisibles) reveiller()
                    message = null
                    echeance?.cancel()

                }
            })
        }
    }

    private fun ouvrir(chaineId: String) = lifecycleScope.launch {
        generationLecture += 1
        repriseEnCours?.cancel()
        lecteur?.stop()
        cacheSegments.vider()
        reposSources.clear()
        echeance?.cancel()
        essai = null
        rang = 0
        echec = false
        // Une chaîne neuve repart au bord : le retard de sécurité était celui de la précédente.
        securite = 0
        blocages.clear()
        montrerLesSources(false)
        reparations = 0
        // Une chaîne neuve n'a rien prouvé : ni l'adresse en cours, ni aucune des autres.
        fluxDeclareStable = false
        dejaVuStable = false
        plafondDebit = Int.MAX_VALUE
        lecteur?.let { it.trackSelectionParameters = it.trackSelectionParameters.buildUpon().setMaxVideoBitrate(Int.MAX_VALUE).build() }
        depuisLecture = 0L
        reprises = 0
        relancesLentes = 0
        repriseEnCours?.cancel()
        dernierIncident = null
        muettes = emptySet()
        vaguesCourues.clear()
        vaguesCourues.add(0)
        sondee = false
        // Ce qu'on quitte devient ce vers quoi on revient. Enregistré avant de charger : si la
        // nouvelle chaîne ne répond pas, le retour reste possible.
        chaine?.id?.takeIf { it != chaineId }?.let { precedente = it }
        message = getString(R.string.direct_ouverture)
        runCatching { api.chaineDirect(profileId, chaineId) }
            .onSuccess { details ->
                chaine = details.chaine
                /*
                 * **Toutes les adresses sont gardées**, et non les quatre premières.
                 *
                 * Le repli automatique s'arrête au bout de quelques essais, et c'est très bien : il ne
                 * doit pas s'acharner. Mais couper la liste à la source rendait les autres
                 * inatteignables **même à la main** — sur une chaîne qui en porte douze, huit
                 * disparaissaient sans que rien ne le dise. Ce qui est borné, c'est la patience de
                 * l'automatique ; le choix, lui, ne l'est pas.
                 */
                val retenues = details.sources
                qualites = retenues.associate { it.url to (it.hauteur to it.debit) }
                empreintes = retenues.associate { it.url to it.empreinte }
                echecs = retenues.associate { it.url to it.echecs }
                identites = retenues.associate { it.url to it.identifiant.ifEmpty { it.url } }
                /*
                 * La course ne sonde que les douze premières, pas les soixante-dix.
                 *
                 * Mesuré sur le corpus : 356 chaînes portent plus de vingt adresses et la pire en a
                 * 78. Autant de requêtes lancées d'un coup pour choisir laquelle ouvrir est un coût
                 * que personne n'a demandé. Le serveur les a déjà classées ; les suivantes gardent
                 * leur rang derrière, et restent choisissables à la main.
                 */
                val urls = retenues.map { it.url }
                adresses = courirLesAdresses(urls.take(COURSE_MAX)) + urls.drop(COURSE_MAX)
                jouerRang()
            }
            .onFailure { echec = true; message = getString(R.string.direct_aucune_source) }
    }

    /**
     * La course : sonder les adresses **en même temps**, et garder l'ordre des réponses.
     *
     * Le lecteur essayait la première, attendait douze secondes, passait à la deuxième : une chaîne à
     * trois adresses dont les deux premières sont mortes mettait jusqu'à trente-six secondes à
     * démarrer, c'est-à-dire qu'on avait changé de chaîne avant. Ici tout part ensemble.
     *
     * Aucune adresse n'est perdue : une silencieuse passe derrière, jamais à la poubelle. Un
     * hébergeur lent reste jouable, et si tout se tait il faut bien essayer quelque chose.
     *
     * Android n'a pas le mur du navigateur — pas de CORS, pas de contenu mixte —, donc la sonde est
     * exacte : c'est le code HTTP réel qui décide, et non une réponse opaque.
     */
    private suspend fun courirLesAdresses(candidates: List<String>): List<String> {
        if (candidates.size <= 1 || candidates.any { estRelaisFlixTunes(it, api.serverUrl) }) return candidates
        val arrivees = java.util.concurrent.ConcurrentLinkedQueue<String>()
        withContext(Dispatchers.IO) {
            withTimeoutOrNull(DELAI_COURSE_MS) {
                candidates.map { url ->
                    async {
                        runCatching {
                            val connexion = (java.net.URL(url).openConnection() as java.net.HttpURLConnection).apply {
                                requestMethod = "GET"
                                connectTimeout = DELAI_COURSE_MS.toInt()
                                readTimeout = DELAI_COURSE_MS.toInt()
                                instanceFollowRedirects = true
                                setRequestProperty("User-Agent", "FlixTunes")
                            }
                            try {
                                if (connexion.responseCode in 200..399) arrivees.add(url)
                            } finally { connexion.disconnect() }
                        }
                    }
                }.awaitAll()
            }
        }
        val repondues = arrivees.toList()
        return candidates.filter { it in repondues } + candidates.filterNot { it in repondues }
    }

    private fun jouerRang(reprendre: Boolean = true) {
        generationLecture += 1
        repriseEnCours?.cancel()
        stableDepuis = 0L
        debitContinu = DebitContinu()
        dernierChargement = System.currentTimeMillis()
        val source = adresses.getOrNull(rang) ?: run { echec = true; message = getString(R.string.direct_aucune_source); return }
        if (reprendre) essai = source
        // Les incidents sont ceux de l'adresse : la même, relancée, garde les siens.
        if (adresseDesIncidents != source) {
            adresseDesIncidents = source
            plafondDebit = Int.MAX_VALUE
            incidents = 0
            reprises = 0
            fluxDeclareStable = false
            adresseRapportee = null
            cacheSegments.vider()
        }
        depuisLecture = 0L
        // Un nouveau média ramène ExoPlayer à la cible de sa configuration : la surveillance la réécrira.
        avanceDemandeeMs = C.TIME_UNSET
        // Préparer un flux remplit le tampon : c'est un geste, pas un hoquet.
        silenceJusqua = System.currentTimeMillis() + REPIT_APRES_GESTE_MS
        depuisSource = System.currentTimeMillis()
        // Une relance complète repart avec un décodeur et une Surface ne portant pas les couleurs
        // du flux précédent. Une simple mise en tampon ne passe jamais par ce chemin.
        lecteur?.takeIf { it.mediaItemCount > 0 }?.let { ancien ->
            renduAvantReprise = decrireRendu(ancien.videoFormat)
            val volume = ancien.volume
            val lire = ancien.playWhenReady
            renouvelerSurface()
            lecteur = null
            vitesses.remove(ancien)
            decodeurs.remove(ancien)
            premieresImages.remove(ancien)
            ancien.release()
            lecteur = creerLecteur().also { it.volume = volume; it.playWhenReady = lire }
        }
        lecteur?.apply {
            trackSelectionParameters = trackSelectionParameters.buildUpon().setMaxVideoBitrate(plafondDebit).build()
            /*
             * La cible de retard : trois segments derrière le bord, comme le veut HLS, plus la
             * sécurité que les blocages ont fait gagner. C'est le seul levier réel — grossir le
             * tampon ne sert à rien quand il n'y a pas plus de média publié devant soi.
             */
            /*
             * **La marge est prise d'emblée, et non achetée après trois bégaiements.**
             *
             * Un direct ne permet pas de faire des réserves : on ne met en tampon que ce qui est déjà
             * publié devant le point de lecture, si bien que le tampon maximal possible **est** la
             * distance au bord du direct. Elle valait 24 s pour toutes les chaînes : toute
             * interruption de plus de 24 s coupait, sans recours. Et on ne l'agrandissait qu'après
             * coup — on rechargeait la sécurité au moment d'arriver au bout.
             *
             * On vise donc `CIBLE_MAX_S` dès l'ouverture. Les bornes disent à ExoPlayer ce qu'il a le
             * droit de faire quand la fenêtre ne suit pas : `minOffsetMs` est le plancher sous lequel
             * il ne doit pas se rapprocher du bord, `maxOffsetMs` le plafond de décalage qu'on
             * accepte. Sur une chaîne à fenêtre courte, il se rabattra de lui-même sur ce que la
             * fenêtre permet — c'est le mécanisme prévu pour cela, et il évite d'avoir à repréparer
             * le flux pour corriger une cible.
             */
            setMediaItem(mediaDirect(source))
            prepare()
        }
        /*
         * Un direct qui ne démarre pas ne le dit pas toujours : un hébergeur peut accepter la
         * connexion puis ne rien envoyer. Sans cette échéance, la chaîne resterait noire au lieu de
         * basculer sur son secours.
         */
        echeance?.cancel()
        echeance = lifecycleScope.launch { delay(12_000); if (lecteur?.isPlaying != true) suivante() }
    }

    /**
     * L'adresse suivante, après avoir dit au serveur que celle-ci n'a pas répondu.
     *
     * `essai` est vidé **avant** tout le reste : ExoPlayer peut signaler deux erreurs pour un même
     * flux, et sans ce verrou la seconde ferait sauter une adresse qui n'a jamais été essayée.
     */
    private fun suivante() {
        val morte = essai ?: return
        essai = null
        reparations = 0
        reprises = 0
        /*
         * **Une adresse qui a joué n'est pas une adresse morte.**
         *
         * L'échec était inscrit au classement quoi qu'il arrive — y compris pour une adresse qui
         * venait de diffuser une heure sans faute et qu'une seconde de réseau avait interrompue. On
         * fabriquait ainsi de fausses mauvaises notes sur les sources les plus regardées, c'est-à-dire
         * sur les meilleures. Ne compte désormais que l'adresse qui n'a **jamais** été déclarée
         * stable : celle-là n'a rien prouvé, et son échec veut dire quelque chose.
         */
        val identifiant = chaine?.id
        if (identifiant != null) {
            lifecycleScope.launch { runCatching { api.resultatChaineDirect(profileId, identifiant, morte, false) } }
        }
        // La déclaration porte sur l'adresse : celle qu'on prend n'a encore rien prouvé.
        fluxDeclareStable = false
        depuisLecture = 0L
        // Toutes les adresses entrent dans le repli, sauf celles que le serveur a trouvées muettes.
        val prochain = prochaineAdresse(adresses, rang, muettes) ?: run { plusAucuneSource(); return }
        ouvrirLeRang(prochain)
    }

    /**
     * Ouvrir le rang choisi par le repli, en faisant d'abord courir sa vague si personne ne l'a sondée.
     *
     * La course d'ouverture ne sonde que les douze premières adresses. Quand elles ont toutes échoué,
     * la suivante n'est pas essayée à l'aveugle douze secondes durant : ses voisines courent d'abord,
     * et celles qui répondent passent devant. Une chaîne à quatre-vingts sources dont les vingt
     * premières sont mortes démarre ainsi en quelques secondes, et non en quatre minutes.
     */
    private fun ouvrirLeRang(prochain: Int) {
        val vague = debutDeVague(prochain)
        if (!vaguesCourues.add(vague)) {
            rang = prochain
            message = getString(R.string.direct_source_essai, rang + 1, adresses.size)
            jouerRang()
            return
        }
        val identifiant = chaine?.id
        val fin = minOf(adresses.size, vague + COURSE_MAX)
        message = getString(R.string.direct_source_recherche, vague + 1, fin, adresses.size)
        lifecycleScope.launch {
            val ordonnee = courirLesAdresses(adresses.subList(vague, fin).toList())
            if (chaine?.id != identifiant) return@launch
            adresses = adresses.take(vague) + ordonnee + adresses.drop(fin)
            rang = prochaineAdresse(adresses, vague - 1, muettes) ?: prochain
            message = getString(R.string.direct_source_essai, rang + 1, adresses.size)
            jouerRang()
        }
    }

    /**
     * Une source joue : c'est le moment de regarder les autres.
     *
     * Le serveur les sonde toutes, une fois par chaîne, et celles qui se taisent sortent du repli —
     * pas du menu. La sonde part du NAS, pour que le téléviseur n'y dépense ni bande passante ni
     * processeur.
     */
    private fun sonderLesAutres() {
        val identifiant = chaine?.id ?: return
        val enCours = adresses.getOrNull(rang) ?: return
        if (sondee || adresses.size <= 1) return
        sondee = true
        lifecycleScope.launch {
            runCatching { api.sondesChaineDirect(profileId, identifiant, enCours) }
                .onSuccess { trouvees -> if (chaine?.id == identifiant) muettes = trouvees }
        }
    }

    /**
     * Toutes les adresses ont échoué : on insiste, lentement, puis on le dit.
     *
     * Un téléviseur ne renonce pas parce qu'un émetteur a hoqueté. Mais insister sans fin devant une
     * chaîne réellement morte n'est pas de la ténacité, c'est un écran noir qui ment — il faut donc
     * que la source **fasse ses preuves**. Six relances espacées de dix secondes, soit une minute :
     * assez pour traverser une coupure de réseau domestique, trop peu pour maquiller une panne.
     *
     * Ce qui est repris, c'est la **première** adresse et non la dernière essayée : c'est celle que
     * la course a désignée comme la meilleure, et l'ordre d'abandon n'a rien changé à ce classement.
     *
     * Et le message final **dit ce qui a été mesuré** — le nombre de tentatives et la nature du
     * dernier incident — au lieu d'un « aucune source ne répond » qui ne permettait ni de comprendre
     * ni de corriger.
     */
    private fun plusAucuneSource() {
        /*
         * On s'obstine pour ce qui a marché, pas pour ce qui n'a jamais rien montré.
         *
         * Six relances — une minute — quand une adresse de cette chaîne a déjà tenu l'image : c'est le
         * cas d'une coupure de réseau domestique, et il mérite qu'on l'attende. Deux seulement quand
         * rien n'a jamais démarré : là, insister revient à faire patienter devant une chaîne qui
         * n'existe plus.
         */
        val plafond = if (dejaVuStable) RELANCES_LENTES else RELANCES_SANS_PREUVE
        if (relancesLentes < plafond) {
            relancesLentes += 1
            message = getString(R.string.direct_relance_lente, relancesLentes, plafond)
            rang = premiereAdresse(adresses, muettes)
            repriseEnCours?.cancel()
            repriseEnCours = lifecycleScope.launch {
                delay(INTERVALLE_RELANCE_MS)
                jouerRang()
            }
            return
        }
        echec = true
        val incident = dernierIncident
        message = if (incident != null) {
            getString(R.string.direct_aucune_source_mesuree, adresses.size, relancesLentes, incident)
        } else {
            getString(R.string.direct_aucune_source)
        }
    }

    /**
     * La télécommande : les chiffres composent un numéro, P+/P− changent de chaîne.
     *
     * C'est le geste qui distingue un téléviseur d'une grille d'icônes, et il ne s'invente pas : on
     * tape un ou plusieurs chiffres, et la chaîne s'ouvre d'elle-même après une seconde et demie —
     * le temps qu'on ait fini de composer.
     *
     * **`dispatchKeyEvent` et non `onKeyDown`**, comme le lecteur de la médiathèque le fait déjà et
     * pour la raison qu'il donne : `onKeyDown` n'est appelé qu'**après** que l'arbre de vues a
     * décliné la touche. Or il y a ici un `PlayerView` dans un `AndroidView`, et le système de focus
     * de Compose par-dessus : l'un comme l'autre peuvent consommer un chiffre ou un P+ avant que
     * l'activité n'en voie la couleur. Intercepter avant l'arbre est le moyen prévu par Android, et
     * l'appel à `super` laisse passer tout ce qu'on ne prend pas — le retour compris.
     *
     * `RestrictedApi` est écarté pour la même raison qu'en face : la restriction porte sur la
     * tuyauterie interne d'AndroidX, que l'appel à `super` fait justement fonctionner.
     */
    @SuppressLint("RestrictedApi")
    override fun dispatchKeyEvent(evenement: KeyEvent): Boolean {
        if (toucheVolumeDiffusion(evenement, lifecycleScope)) return true
        if (evenement.action != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(evenement)
        val code = evenement.keyCode
        if (code == KeyEvent.KEYCODE_INFO || code == KeyEvent.KEYCODE_MENU) {
            if (evenement.repeatCount == 0) montrerDiagnostic(!diagnosticOuvert)
            return true
        }
        val chiffre = when (code) {
            in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> code - KeyEvent.KEYCODE_0
            in KeyEvent.KEYCODE_NUMPAD_0..KeyEvent.KEYCODE_NUMPAD_9 -> code - KeyEvent.KEYCODE_NUMPAD_0
            else -> null
        }
        if (chiffre != null) {
            val compose = ((saisie ?: "") + chiffre).takeLast(4)
            saisie = compose
            effacementSaisie?.cancel()
            effacementSaisie = lifecycleScope.launch {
                delay(1_500)
                saisie = null
                allerAuNumero(compose.toIntOrNull() ?: return@launch)
            }
            return true
        }
        /*
         * Deux paires de touches pour un seul geste.
         *
         * Toutes les télécommandes n'envoient pas `CHANNEL_UP` : beaucoup de boîtiers Android TV
         * n'ont pas de touche de chaîne du tout et rendent la croix directionnelle. Haut et bas y
         * répondent donc aussi — c'est le geste qu'on fait naturellement devant une image plein
         * écran, et rien d'autre ne s'en sert ici.
         */
        /*
         * La chaîne précédente : le second geste d'un téléviseur, après le numéro.
         *
         * `LAST_CHANNEL` est la touche prévue par Android, que peu de télécommandes portent ; la
         * flèche gauche fait donc la même chose, et rien d'autre ne s'en sert devant une image plein
         * écran.
         */
        /*
         * La liste des sources prend la main tant qu'elle est ouverte.
         *
         * Sans cela, la croix ferait défiler les chaînes derrière une liste affichée : deux gestes
         * pour une même touche, et l'on ne saurait jamais lequel on vient de faire.
         */
        if (choixOuvert) {
            when (code) {
                KeyEvent.KEYCODE_DPAD_UP -> { choixIndex = (choixIndex - 1).coerceAtLeast(0); return true }
                KeyEvent.KEYCODE_DPAD_DOWN -> {
                    choixIndex = (choixIndex + 1).coerceAtMost(groupesDuMenu().size)
                    return true
                }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> {
                    // Le curseur parcourt les lignes ; ce qu'on ouvre est le meilleur membre du groupe qui répond.
                    if (choixIndex == groupesDuMenu().size) {
                        montrerLesSources(false)
                        montrerDiagnostic(true)
                    } else groupesDuMenu().getOrNull(choixIndex)?.let { choisirSource(it.index) }
                    return true
                }
                // Le retour n'est pas écouté ici : il passe par `OnBackPressedDispatcher`, seul chemin
                // que le geste des téléphones récents emprunte encore.
                KeyEvent.KEYCODE_ESCAPE -> { montrerLesSources(false); return true }
                else -> Unit
            }
        }
        reveiller()
        /*
         * La chaîne précédente : le second geste d'un téléviseur, après le numéro.
         *
         * Elle était sur la flèche gauche, qui recule maintenant dans la fenêtre — une barre de
         * progression sans flèches pour la parcourir n'aurait servi à rien. Restent les deux touches
         * que les télécommandes portent pour cela.
         */
        if (code == KeyEvent.KEYCODE_LAST_CHANNEL || code == KeyEvent.KEYCODE_MEDIA_PREVIOUS) {
            precedente?.let { ouvrir(it) }
            return true
        }
        /*
         * **La croix haut/bas navigue, elle ne change plus de chaîne.**
         *
         * Elle faisait P+/P− depuis la r2, faute de touche de chaîne sur beaucoup de boîtiers. Mais
         * la liste des sources, elle, n'était atteignable que par la touche **verte** — que les
         * télécommandes Android TV n'ont pas. Le choix de source était donc inaccessible sur le seul
         * appareil où il compte vraiment, pendant que deux autres touches faisaient déjà le travail
         * du changement de chaîne. La croix ouvre et parcourt la liste ; P+/P− et les chiffres
         * changent de chaîne.
         */
        if (code == KeyEvent.KEYCODE_CHANNEL_UP || code == KeyEvent.KEYCODE_PAGE_UP) { voisine(1); return true }
        if (code == KeyEvent.KEYCODE_CHANNEL_DOWN || code == KeyEvent.KEYCODE_PAGE_DOWN) { voisine(-1); return true }
        if (code == KeyEvent.KEYCODE_DPAD_UP || code == KeyEvent.KEYCODE_DPAD_DOWN) {
            choixIndex = if (code == KeyEvent.KEYCODE_DPAD_UP) groupesDuMenu().size else ligneDuRang()
            montrerLesSources(true)
            return true
        }
        // Reculer et avancer : la croix horizontale et les touches de transport disent la même chose.
        if (code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_MEDIA_REWIND) { sauter(-SAUT_MS); return true }
        if (code == KeyEvent.KEYCODE_DPAD_RIGHT || code == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD) { sauter(SAUT_MS); return true }
        if (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER ||
            code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) { basculerPause(); return true }
        if (code == KeyEvent.KEYCODE_MEDIA_PLAY) { lecteur?.play(); return true }
        if (code == KeyEvent.KEYCODE_MEDIA_PAUSE) { lecteur?.pause(); return true }
        // La touche verte ouvre les sources : c'est la convention des boîtiers, et elle ne sert à rien d'autre ici.
        if (code == KeyEvent.KEYCODE_PROG_GREEN && adresses.size > 1) {
            choixIndex = ligneDuRang()
            montrerLesSources(true)
            return true
        }
        return super.dispatchKeyEvent(evenement)
    }

    /**
     * Ouvre la chaîne portant ce numéro.
     *
     * Le serveur est seul à savoir qui le porte : la grille du client n'en tient que soixante à la
     * fois, et composer « 1 340 » ne doit pas dépendre de ce qui a déjà été fait défiler.
     */
    private fun allerAuNumero(numero: Int) = lifecycleScope.launch {
        val trouvee = api.chaineParNumero(profileId, numero)
        if (trouvee == null) { message = getString(R.string.direct_numero_saisi, numero.toString()); return@launch }
        ouvrir(trouvee.id)
    }

    /**
     * Montrer les commandes, et les laisser s'effacer.
     *
     * Devant une image plein écran, tout geste les rappelle et l'accalmie les renvoie. C'est ce que
     * fait n'importe quel téléviseur, et ce qu'on attend sans y penser.
     */
    private fun reveiller() {
        commandesVisibles = true
        effacementCommandes?.cancel()
        effacementCommandes = lifecycleScope.launch {
            delay(REPOS_BARRE_MS)
            // Une mise en tampon à l'échéance ne doit pas laisser les incrustations affichées.
            while (commandesVisibles) {
                if (lecteur?.isPlaying == true && !choixOuvert && !diagnosticOuvert) {
                    commandesVisibles = false
                    diagnosticOuvert = false
                    break
                }
                delay(250)
            }
        }
    }

    /** Une nouvelle vue détruit réellement la Surface, y compris sur Android 14 et suivants. */
    private fun renouvelerSurface(candidat: ExoPlayer? = null) {
        vueLecteur?.player = null
        vueLecteur = null
        candidatAffiche = candidat
        generationSurface += 1
    }

    private fun decrireRendu(format: Format?): String {
        val couleur = format?.colorInfo
        return listOfNotNull(format?.height?.takeIf { it > 0 }?.let { "${it}p" },
            format?.bitrate?.takeIf { it > 0 }?.let { "${it / 1000} kb/s" },
            couleur?.let { "couleurs ${it.colorSpace}/${it.colorRange}/${it.colorTransfer}" }).joinToString(" · ")
    }

    private fun avecSurfaceDirect(avant: Format?, apres: Format?, action: () -> Unit) {
        if (rearmerCouleursDirect(avant, apres)) renouvelerSurface()
        action()
    }

    private fun deplacerLecture(joueur: ExoPlayer, positionMs: Long? = null, manuel: Boolean = false) {
        val deplacer = {
            if (positionMs == null) joueur.seekToDefaultPosition() else joueur.seekTo(positionMs)
        }
        // Les reprises automatiques conservent la surface ; sa destruction peut perturber le codec TV.
        if (manuel) avecSurfaceDirect(joueur.videoFormat, joueur.videoFormat, deplacer) else deplacer()
    }

    /**
     * Reculer ou avancer dans la fenêtre publiée.
     *
     * Bornée des deux côtés : le début est le segment que l'hébergeur va retirer d'une seconde à
     * l'autre, s'y coller garantit d'en tomber.
     */
    private fun sauter(deltaMs: Long) {
        val joueur = lecteur ?: return
        silenceJusqua = System.currentTimeMillis() + REPIT_APRES_GESTE_MS
        val duree = joueur.duration
        if (duree <= 0) return
        deplacerLecture(joueur, minOf(duree - 1_000, maxOf(2_000, joueur.currentPosition + deltaMs)), manuel = true)
        reveiller()
    }

    /** Revenir au bord du flux — la seule position qui mérite le mot « direct ». */
    private fun rejoindreDirect() {
        silenceJusqua = System.currentTimeMillis() + REPIT_APRES_GESTE_MS
        lecteur?.let { deplacerLecture(it, manuel = true) }
        // La position par défaut est l'avance de la configuration : celle d'une source fragile se réécrit.
        avanceDemandeeMs = C.TIME_UNSET
        lecteur?.play()
        reveiller()
    }

    /**
     * Mettre en pause un direct, c'est reculer dans la fenêtre.
     *
     * Rien ne s'arrête à la source : le flux avance pendant qu'on regarde une image fixe, et l'on
     * dérive vers l'arrière. Sur 92 % des chaînes mesurées la fenêtre fait entre 30 s et 2 min : une
     * pause d'une minute passe, une pause de cinq ne passe pas. On laisse faire et **on rattrape** —
     * `ERROR_CODE_BEHIND_LIVE_WINDOW` rejoint le direct au lieu de figer l'image sans rien dire.
     */
    private fun basculerPause() {
        val joueur = lecteur ?: return
        silenceJusqua = System.currentTimeMillis() + REPIT_APRES_GESTE_MS
        if (joueur.isPlaying) joueur.pause() else joueur.play()
        reveiller()
    }

    /**
     * Choisir une source à la main.
     *
     * Le repli sait quand une adresse ne répond pas ; il ne sait rien de celle qui répond **mal** —
     * l'image qui se fige, la définition qui s'effondre. Cela, seule la personne devant l'écran le
     * voit. L'adresse quittée n'est pas rapportée comme morte : elle ne l'est pas, on lui préfère
     * simplement une autre.
     */
    private fun choisirSource(index: Int) {
        montrerLesSources(false)
        if (index !in adresses.indices || index == rang) return
        essai = null
        reparations = 0
        rang = index
        echec = false
        message = getString(R.string.direct_source_essai, index + 1, adresses.size)
        jouerRang()
    }

    /**
     * Ce qu'on fait quand la source ne tient pas : reculer, puis changer.
     *
     * Un seul endroit décide, appelé par les deux chemins — les bégaiements comptés, et le blocage
     * prolongé qui n'attend pas d'être compté.
     */
    private fun relancerLaSource(renouvellement: Boolean = false): Boolean {
        if (repriseEnCours?.isActive == true) return true
        val memoire = ActivityManager.MemoryInfo()
        (getSystemService(ACTIVITY_SERVICE) as ActivityManager).getMemoryInfo(memoire)
        val runtime = Runtime.getRuntime()
        val disponible = runtime.maxMemory() - (runtime.totalMemory() - runtime.freeMemory())
        val nomDecodeur = decodeurs[lecteur]
        val mime = lecteur?.videoFormat?.sampleMimeType
        val instances = if (nomDecodeur == null || mime == null) 1 else
            instancesDecodeurs.getOrPut("$nomDecodeur/$mime") {
                runCatching { MediaCodecList(MediaCodecList.ALL_CODECS).codecInfos
                    .firstOrNull { it.name == nomDecodeur }?.getCapabilitiesForType(mime)?.maxSupportedInstances ?: 1
                }.getOrDefault(1)
            }
        if (!budgetMemoire.peutPreparer(disponible, memoire.lowMemory, instances)) {
            cacheSegments.vider()
            return false
        }
        if (reprises >= REPRISES_MAX) return false
        if (System.currentTimeMillis() - derniereReprise < 5_000) return true
        derniereReprise = System.currentTimeMillis()
        val source = essai ?: return false
        val identifiant = chaine?.id
        val generation = generationLecture
        reprises += 1
        if (!renouvellement) incidents += 1
        depuisLecture = 0L
        echeance?.cancel()
        repriseEnCours = lifecycleScope.launch {
            try {
                val principale = lecteur ?: return@launch
                val candidats = listOf(rang) + adresses.indices.filter {
                    it != rang && adresses[it] !in muettes
                }.sortedBy { (reposSources[adresses[it]] ?: 0) > System.currentTimeMillis() }.take(2)
                for (index in candidats) {
                    if (generation != generationLecture || !principale.playWhenReady) return@launch
                    val cible = adresses.getOrNull(index) ?: continue
                    val memeSource = (identites[cible] ?: cible) == (identites[source] ?: source)
                    val plafondCandidat = if (memeSource) plafondDebit else Int.MAX_VALUE
                    val candidat = creerLecteur().also { secours = it; it.playWhenReady = false; it.volume = 0f }
                    candidat.trackSelectionParameters = candidat.trackSelectionParameters.buildUpon()
                        .setMaxVideoBitrate(plafondCandidat).build()
                    var adopte = false
                    try {
                        candidat.setMediaItem(mediaDirect(cible))
                        candidat.prepare()
                        val pret = withTimeoutOrNull(12_000) {
                            while (candidat.playerError == null && (candidat.playbackState != Player.STATE_READY || candidat.totalBufferedDuration < 6_000)) delay(100)
                            candidat.playerError == null
                        } == true
                        if (!pret) { reposSources[cible] = System.currentTimeMillis() + 30_000; continue }
                        val raccord = positionDeRaccord(debutProgramme(principale), principale.currentPosition,
                            debutProgramme(candidat), candidat.duration)
                        if (raccord != null) candidat.seekTo(raccord)
                        else if (memeSource && principale.currentLiveOffset != C.TIME_UNSET && candidat.duration > 0)
                            candidat.seekTo((candidat.duration - principale.currentLiveOffset).coerceAtLeast(0))
                        else {
                            // Aucune horloge commune : attendre la fin de la réserve avant la bascule.
                            val necessaire = withTimeoutOrNull(30_000) {
                                while (principale.totalBufferedDuration > 3_000 && principale.playWhenReady) delay(100)
                                principale.playWhenReady
                            } == true
                            if (!necessaire) return@launch
                        }
                        // La relève avance en silence pendant le raccord, comme la lecture affichée.
                        // La laisser en pause pendant le chargement répéterait ensuite ces secondes.
                        candidat.play()
                        val aligne = withTimeoutOrNull(4_000) {
                            while (candidat.playerError == null && (candidat.playbackState != Player.STATE_READY || candidat.totalBufferedDuration < 3_000)) delay(50)
                            candidat.playerError == null
                        } == true
                        if (!aligne || generation != generationLecture || !principale.playWhenReady) continue
                        val raccordFinal = positionDeRaccord(debutProgramme(principale), principale.currentPosition,
                            debutProgramme(candidat), candidat.duration)
                        if (raccordFinal != null && kotlin.math.abs(raccordFinal - candidat.currentPosition) > 250) {
                            if (raccordFinal + 1_000 >= candidat.bufferedPosition) continue
                            candidat.seekTo(raccordFinal)
                        } else if (candidat.currentLiveOffset != C.TIME_UNSET && candidat.currentLiveOffset > AVANCE_FRAGILE_MS) {
                            candidat.seekToDefaultPosition()
                        }
                        val pretAFilmer = withTimeoutOrNull(1_000) {
                            while (candidat.playbackState != Player.STATE_READY && candidat.playerError == null) delay(25)
                            candidat.playerError == null
                        } == true
                        if (!pretAFilmer || generation != generationLecture || !principale.playWhenReady) continue
                        if (!memeSource && principale.totalBufferedDuration > 15_000 && System.currentTimeMillis() - dernierChargement < 2_000) return@launch
                        if (!memeSource && identifiant != null) {
                            reposSources[source] = System.currentTimeMillis() + 120_000
                            lifecycleScope.launch { runCatching { api.resultatChaineDirect(profileId, identifiant, source, false) } }
                        }
                        renduAvantReprise = decrireRendu(principale.videoFormat)
                        premieresImages.remove(candidat)
                        renouvelerSurface(candidat)
                        candidat.play()
                        // READY hors écran n'atteste pas du rendu. L'ancien lecteur reste disponible
                        // tant que le nouveau n'a pas produit une image sur la vraie SurfaceView.
                        val attendImage = candidat.currentTracks.isTypeSelected(C.TRACK_TYPE_VIDEO)
                        val imageAffichee = withTimeoutOrNull(5_000) {
                            while (attendImage && candidat !in premieresImages && candidat.playerError == null && generation == generationLecture) delay(25)
                            (!attendImage || candidat in premieresImages) && candidat.playerError == null && generation == generationLecture
                        } == true
                        if (!imageAffichee || !principale.playWhenReady) continue
                        candidat.volume = principale.volume
                        principale.volume = 0f
                        lecteur = candidat
                        candidatAffiche = null
                        plafondDebit = plafondCandidat
                        renduCourant = decrireRendu(candidat.videoFormat)
                        debitContinu = DebitContinu()
                        adopte = true
                        message = null
                        rang = index
                        essai = cible
                        adresseDesIncidents = cible
                        adresseRapportee = null
                        fluxDeclareStable = false
                        stableDepuis = 0L
                        depuisLecture = 0L
                        avanceDemandeeMs = C.TIME_UNSET
                        silenceJusqua = System.currentTimeMillis() + REPIT_APRES_GESTE_MS
                        dernierChargement = System.currentTimeMillis()
                        vitesses.remove(principale)
                        decodeurs.remove(principale)
                        premieresImages.remove(principale)
                        principale.release()
                        return@launch
                    } finally {
                        if (secours === candidat) secours = null
                        if (!adopte) {
                            if (candidatAffiche === candidat) renouvelerSurface()
                            vitesses.remove(candidat); decodeurs.remove(candidat); premieresImages.remove(candidat)
                            candidat.release()
                        }
                    }
                }
                if (generation == generationLecture && principale.playWhenReady && principale.totalBufferedDuration <= 3_000) {
                    repriseEnCours = null
                    if (reprises >= REPRISES_MAX) suivante() else jouerRang()
                }
            } catch (annulation: CancellationException) {
                throw annulation
            } catch (erreur: Exception) {
                // Un échec de préparation ne doit pas quitter l'activité et perdre le profil.
                dernierIncident = "Reprise interrompue (${erreur.javaClass.simpleName})"
                if (generation == generationLecture && lecteur?.totalBufferedDuration?.let { it <= 3_000 } == true) {
                    repriseEnCours = null
                    suivante()
                }
            } finally { if (generation == generationLecture) repriseEnCours = null }
        }
        return true
    }

    private fun debutProgramme(joueur: ExoPlayer): Long? {
        if (joueur.currentTimeline.isEmpty) return null
        return joueur.currentTimeline.getWindow(joueur.currentMediaItemIndex, Timeline.Window())
            .windowStartTimeMs.takeIf { it != C.TIME_UNSET }
    }

    private fun mediaDirect(source: String): MediaItem = MediaItem.Builder()
        .setUri(source)
        .setMimeType(if (estRelaisFlixTunes(source, api.serverUrl)) when (android.net.Uri.parse(source).getQueryParameter("f")) {
            "ts" -> "video/mp2t"
            "mp4" -> "video/mp4"
            "mpd" -> "application/dash+xml"
            else -> "application/x-mpegURL"
        } else null)
        .setLiveConfiguration(MediaItem.LiveConfiguration.Builder()
            .setTargetOffsetMs(if (incidents > 0 || (echecs[source] ?: 0) > 0) 55_000 else 40_000)
            .setMinOffsetMs(2_000).setMaxOffsetMs(AVANCE_FRAGILE_MS)
            .setMinPlaybackSpeed(0.97f).setMaxPlaybackSpeed(1.06f).build())
        .build()

    private suspend fun renouvelerAdresses() {
        val id = chaine?.id ?: return
        if (adresses.none { estRelaisFlixTunes(it, api.serverUrl) }) return
        if (renouvellementEnCours || System.currentTimeMillis() - dernierRenouvellement < 30_000) return
        renouvellementEnCours = true
        dernierRenouvellement = System.currentTimeMillis()
        try {
        val nouvelles = runCatching { api.chaineDirect(profileId, id) }.getOrNull() ?: return
        if (chaine?.id != id) return
        val index = nouvelles.sources.filter { it.identifiant.isNotEmpty() }.associateBy { it.identifiant }
        val avant = adresses.getOrNull(rang)
        adresses = adresses.map { index[identites[it]]?.url ?: it }
        identites = identites + nouvelles.sources.associate { it.url to it.identifiant.ifEmpty { it.url } }
        if (adresses.getOrNull(rang) != avant && lecteur?.playWhenReady == true) relancerLaSource(renouvellement = true)
        } finally { renouvellementEnCours = false }
    }

    private fun reagirALInstabilite() {
        val joueur = lecteur ?: return
        if (!joueur.playWhenReady || echec) return
        blocages.clear()
        allegerLeDebit()
        if (!relancerLaSource() && joueur.totalBufferedDuration <= 3_000) suivante()
    }

    /**
     * Écrire la cible d'avance d'ExoPlayer quand la fiabilité de la source la change.
     *
     * Une source sans incident garde la cible de sa configuration — 40 s, bornée par ExoPlayer comme
     * avant. Une source fragile vise ce que `avanceViseeMs` permet dans sa fenêtre, jamais moins que la
     * cible de départ. L'écriture passe par le fil de lecture d'ExoPlayer, le seul qui lise cette
     * commande.
     */
    private fun ajusterLAvance(joueur: ExoPlayer) {
        val fragile = incidents > 0 || (adresses.getOrNull(rang)?.let { echecs[it] } ?: 0) > 0
        val fenetreMs = joueur.duration
        val visee = if (!fragile || fenetreMs == C.TIME_UNSET || fenetreMs <= 0) C.TIME_UNSET else {
            // La durée de segment déclarée par la playlist, sinon la médiane du corpus.
            val segmentMs = (joueur.currentManifest as? HlsManifest)?.mediaPlaylist?.targetDurationUs
                ?.div(1_000)?.takeIf { it > 0 } ?: 8_000L
            avanceViseeMs(fenetreMs, segmentMs, fragile = true)
        }
        if (visee == avanceDemandeeMs) return
        if (visee != C.TIME_UNSET && avanceDemandeeMs != C.TIME_UNSET && kotlin.math.abs(visee - avanceDemandeeMs) < 1_000) return
        avanceDemandeeMs = visee
        val cibleUs = if (visee == C.TIME_UNSET) C.TIME_UNSET else visee * 1_000
        val controle = vitesses[joueur] ?: return
        joueur.createMessage { _, _ -> controle.setTargetLiveOffsetOverrideUs(cibleUs) }
            .setLooper(joueur.playbackLooper)
            .send()
    }

    /**
     * Alléger d'un cran ce qu'il y a à télécharger, et dire si c'était encore possible.
     *
     * On plafonne le débit vidéo à 70 % de ce que la variante en cours consomme : ExoPlayer choisit
     * alors la meilleure variante sous ce plafond. Rendre `false` quand il n'y a plus rien à céder est
     * ce qui autorise l'appelant à passer au dernier recours — changer de source.
     */
    private fun allegerLeDebit(): Boolean {
        val joueur = lecteur ?: return false
        val actuel = joueur.videoFormat?.bitrate ?: return false
        if (actuel <= 0) return false
        val vise = (actuel * 0.7).toInt()
        if (vise < DEBIT_PLANCHER || vise >= plafondDebit) return false
        plafondDebit = vise
        joueur.trackSelectionParameters = joueur.trackSelectionParameters.buildUpon()
            .setMaxVideoBitrate(vise)
            .build()
        return true
    }

    /**
     * Rendre la qualité quand le tampon est refait.
     *
     * L'allègement ne vaut que le temps du mauvais passage. Sans cette restitution, une minute
     * difficile condamnerait la soirée entière à une image dégradée — et le spectateur n'aurait aucun
     * moyen de savoir pourquoi.
     */
    private fun rendreLeDebit() {
        val joueur = lecteur ?: return
        if (plafondDebit == Int.MAX_VALUE) return
        plafondDebit = Int.MAX_VALUE
        joueur.trackSelectionParameters = joueur.trackSelectionParameters.buildUpon()
            .setMaxVideoBitrate(Int.MAX_VALUE)
            .build()
    }

    /**
     * Le blocage **prolongé** : celui qui n'a pas à être compté.
     *
     * Bégayer et s'être arrêté ne sont pas la même chose. Une image qui hoquette se regarde encore, et
     * abandonner la chaîne pour cela serait perdre ce qui marche ; une image figée depuis huit
     * secondes n'est plus une image, et attendre le troisième incident espacé reviendrait à rester
     * une minute devant un écran noir. Le compte patient garde les bégaiements ; ceci prend les arrêts.
     */
    private fun surveillerLeBlocage() {
        surveillanceBlocage?.cancel()
        surveillanceBlocage = lifecycleScope.launch {
            delay(BLOCAGE_PROLONGE_MS)
            val joueur = lecteur ?: return@launch
            if (joueur.playbackState == Player.STATE_BUFFERING && joueur.playWhenReady) reagirALInstabilite()
        }
    }

    /** La chaîne voisine, par numéro. P+ et P− d'un téléviseur. */
    private fun voisine(sens: Int) = lifecycleScope.launch {
        val depuis = chaine?.numero ?: return@launch
        val trouvee = runCatching { api.chaineVoisine(profileId, depuis, sens) }.getOrNull() ?: return@launch
        ouvrir(trouvee.id)
    }

    @Composable
    private fun Ecran() {
        val contexte = LocalContext.current
        LaunchedEffect(Unit) {
            while (true) { delay(15 * 60_000L); renouvelerAdresses() }
        }
        /*
         * La fenêtre publiée, relevée quatre fois par seconde.
         *
         * `duration` porte la fenêtre glissante d'un direct — 61 s de médiane sur le corpus, quatre
         * heures pour Arte —, `currentPosition` l'endroit où l'on s'y trouve. C'est la seule source
         * de vérité : la barre s'en sert telle quelle plutôt que d'inventer une échelle qui
         * promettrait un retour en arrière inexistant.
         */
        LaunchedEffect(Unit) {
            var dernierePosition = 0L
            var dernierProgres = System.currentTimeMillis()
            while (true) {
                val joueur = lecteur
                if (joueur != null) {
                    fenetreMs = joueur.duration.coerceAtLeast(0)
                    positionMs = joueur.currentPosition.coerceAtLeast(0)
                    reserveMs = joueur.totalBufferedDuration.coerceAtLeast(0)
                    val decalage = joueur.currentLiveOffset
                    retardMs = if (decalage == androidx.media3.common.C.TIME_UNSET) {
                        (fenetreMs - positionMs).coerceAtLeast(0)
                    } else decalage
                    /*
                     * L'icône suit **l'intention**, pas l'état instantané.
                     *
                     * `isPlaying` tombe à faux à chaque rechargement du tampon : le bouton basculait
                     * donc sur « lecture » plusieurs fois par minute alors que personne n'avait mis
                     * en pause, et il fallait appuyer deux fois pour repartir. `playWhenReady` dit ce
                     * qu'on a demandé au lecteur, et ne bouge que lorsqu'on le lui demande.
                     */
                    enPause = !joueur.playWhenReady
                    val maintenant = System.currentTimeMillis()
                    if (enPause || positionMs != dernierePosition) {
                        dernierePosition = positionMs
                        dernierProgres = maintenant
                    } else if (!echec && maintenant > silenceJusqua && maintenant - dernierProgres > BLOCAGE_PROLONGE_MS) {
                        dernierProgres = maintenant
                        reagirALInstabilite()
                    }
                    /*
                     * **L'avance suit la fiabilité.** Une source qui a déjà calé, ou que le serveur
                     * connaît pour ses échecs, vise jusqu'à 60 s derrière le bord au lieu de 40, dans la
                     * limite de sa fenêtre. ExoPlayer y glisse en ralentissant, sans couper l'image.
                     */
                    ajusterLAvance(joueur)
                    /*
                     * L'image avance : la série d'échecs est finie.
                     *
                     * Remettre les compteurs à zéro ici plutôt qu'à l'ouverture est ce qui distingue
                     * « trois incidents d'affilée » de « trois incidents dans la soirée ». Le second
                     * ne dit rien contre la source.
                     */
                    /*
                     * **Le tampon, surveillé en permanence — c'est ici que se joue « ne jamais arriver
                     * au bout ».**
                     *
                     * Tout le reste du lecteur est réactif : on attend le bégaiement, l'image figée,
                     * l'erreur. Ce relevé-ci regarde ce qui **descend**, et agit pendant qu'il reste du
                     * temps. Un tampon qui fond se voit dix secondes à l'avance ; dix secondes
                     * suffisent à changer de variante, alors qu'à zéro il ne reste plus qu'à réparer.
                     */
                    if (joueur.isPlaying) {
                        val tamponMs = (joueur.bufferedPosition - joueur.currentPosition)
                            .coerceAtLeast(0)
                        val segmentMs = (joueur.currentManifest as? HlsManifest)?.mediaPlaylist?.targetDurationUs?.div(1_000) ?: 8_000L
                        val debit = joueur.videoFormat?.bitrate ?: 0
                        val capaciteMemoire = if (debit > 0) budgetMemoire.tamponOctets.toLong() * 8_000 / (debit + 256_000L) else 40_000L
                        val capacite = minOf(retardMs.takeIf { it > 0 } ?: 40_000L, capaciteMemoire)
                        val vise = debitContinu.ajuster(tamponMs, debit, plafondDebit, maintenant,
                            capacite, segmentMs, maintenant - dernierChargement < maxOf(12_000, segmentMs * 2),
                            depuisLecture > 0 && maintenant - depuisLecture >= 8_000)
                        if (vise != plafondDebit) {
                            plafondDebit = vise
                            joueur.trackSelectionParameters = joueur.trackSelectionParameters.buildUpon().setMaxVideoBitrate(vise).build()
                        }
                        if (fluxDeclareStable && doitPreparerSecours(tamponMs, maintenant - dernierChargement, segmentMs)) {
                            relancerLaSource()
                        }
                    }
                    if (!joueur.isPlaying) stableDepuis = 0L
                    if (joueur.isPlaying) {
                        if (stableDepuis == 0L) stableDepuis = maintenant
                        if (maintenant - stableDepuis >= 120_000) {
                            stableDepuis = maintenant
                            val id = chaine?.id
                            val url = essai
                            if (id != null && url != null) lifecycleScope.launch {
                                runCatching { api.resultatChaineDirect(profileId, id, url, true, 120) }
                            }
                        }
                        if (depuisLecture == 0L) depuisLecture = System.currentTimeMillis()
                        if (System.currentTimeMillis() - depuisLecture >= SEUIL_STABILITE_MS
                        ) {
                            fluxDeclareStable = true
                            dejaVuStable = true
                            val id = chaine?.id
                            val url = essai
                            if (id != null && url != null && adresseRapportee != url) {
                                adresseRapportee = url
                                lifecycleScope.launch { runCatching { api.resultatChaineDirect(profileId, id, url, true) } }
                            }
                            sonderLesAutres()
                            /*
                             * Les compteurs repartent **à la déclaration**, et non au retour de
                             * l'image. Un flux qui revient deux secondes puis retombe n'a rien
                             * prouvé ; le remettre à neuf lui offrirait une série d'échecs sans fin.
                             */
                            if (reprises > 0 || relancesLentes > 0) {
                                reprises = 0
                                relancesLentes = 0
                                message = null
                            }
                        }
                    }
                    /*
                     * Sortir de la fenêtre par l'arrière : on rattrape avant que l'image ne se fige.
                     *
                     * Une pause d'une minute passe sur presque tout le corpus, une pause de cinq n'y
                     * passe pas. Plutôt que d'interdire la pause, on la laisse et on revient au
                     * direct en le disant — ExoPlayer sait aussi le signaler lui-même, par
                     * `ERROR_CODE_BEHIND_LIVE_WINDOW`, mais l'attendre voudrait dire attendre l'erreur.
                     */
                    if (!enPause && fenetreMs > FENETRE_MINIMALE_MS &&
                        (positionMs in 1 until FENETRE_MINIMALE_MS || retardMs > AVANCE_FRAGILE_MS)) {
                        /*
                         * **En silence.**
                         *
                         * Un bandeau annonçait « fin de la fenêtre » à chaque rattrapage. Il disait au
                         * spectateur qu'il venait de se passer quelque chose d'anormal, alors que le
                         * but est précisément qu'il ne s'en aperçoive pas. Ce qui doit se voir, c'est
                         * une source qu'on abandonne ; pas une seconde de retard qu'on reprend.
                         *
                         * Et l'on ne rejoint pas le bord : on revient à la **position par défaut**,
                         * c'est-à-dire à l'avance visée. Se placer à douze secondes du bord, comme
                         * avant, faisait de ces douze secondes la nouvelle cible d'ExoPlayer — un saut
                         * vaut consigne —, et la marge était perdue pour le reste de la soirée.
                         */
                        deplacerLecture(joueur)
                        // Le saut efface la cible écrite : la surveillance la réécrira si la source est fragile.
                        avanceDemandeeMs = C.TIME_UNSET
                        silenceJusqua = System.currentTimeMillis() + REPIT_APRES_GESTE_MS
                    }
                }
                delay(250)
            }
        }
        /*
         * **L'image entière répond au doigt.**
         *
         * Rien n'était tactile en dehors des commandes elles-mêmes : une fois qu'elles s'étaient
         * effacées au bout de trois secondes et demie, plus rien sur un téléphone ne pouvait les
         * rappeler — il n'y a pas de télécommande pour appeler `reveiller`. Les commandes devenaient
         * donc définitivement inatteignables, ce qui se voyait comme « le tactile ne fonctionne pas ».
         *
         * Sans ondulation ni surbrillance : c'est une image de télévision qu'on touche, pas un bouton.
         */
        val toucher = remember { MutableInteractionSource() }
        Box(
            Modifier.fillMaxSize().background(Color.Black)
                .clickable(interactionSource = toucher, indication = null) {
                    if (commandesVisibles && lecteur?.isPlaying == true) commandesVisibles = false else reveiller()
                },
        ) {
            key(generationSurface) { AndroidView(
                /*
                 * `keepScreenOn` : le téléviseur s'endormait pendant qu'on regardait.
                 *
                 * Android ne déduit pas d'une vidéo qui joue qu'il faut garder l'écran allumé — il
                 * faut le lui dire, et le lecteur de la médiathèque le fait depuis toujours. Celui
                 * du direct ne le faisait pas : rien ne touchait la télécommande pendant qu'une
                 * chaîne passait, la minuterie d'inactivité arrivait au bout, et l'écran s'éteignait
                 * au milieu d'une émission. C'est le cas d'usage le plus normal qui soit, et
                 * précisément celui qu'un essai de dix minutes au bureau ne rencontre jamais.
                 */
                factory = {
                    PlayerView(contexte).apply {
                        useController = false
                        setEnableComposeSurfaceSyncWorkaround(true)
                        keepScreenOn = true
                        setBackgroundColor(android.graphics.Color.BLACK)
                        setShutterBackgroundColor(android.graphics.Color.BLACK)
                        setKeepContentOnPlayerReset(false)
                        vueLecteur = this
                        player = candidatAffiche ?: lecteur
                    }
                },
                update = { vue ->
                    val affiche = candidatAffiche ?: lecteur
                    if (vue.player !== affiche) vue.player = affiche
                },
                onRelease = { vue -> vue.player = null; if (vueLecteur === vue) vueLecteur = null },
                modifier = Modifier.fillMaxSize(),
            ) }
            /*
             * Le nom s'efface avec les commandes.
             *
             * Il restait posé en haut à gauche pendant qu'on regardait, alors que tout le reste
             * s'était retiré : sur un téléviseur, c'est une incrustation permanente sur l'image.
             * Relevé à l'écran. Le message d'ouverture, lui, reste visible tant qu'il a quelque chose
             * à dire — il ne se retire pas, il disparaît quand la chaîne démarre.
             */
            if (commandesVisibles) Column(Modifier.align(Alignment.TopStart).padding(24.dp)) {
                BoutonCast {
                    reveiller()
                    ouvrirDialogueDiffusion(this@LecteurDirectActivity, api, ::etatPourDiffusion) { lecteur?.pause() }
                }
                Text("Diagnostic de lecture · ↑ puis OK", Modifier.clickable {
                    montrerDiagnostic(!diagnosticOuvert)
                }, color = Muet, fontSize = 12.sp)
                if (diagnosticOuvert) Text(
                    "Réserve : ${reserveMs / 1000} s · Retard : ${retardMs / 1000} s\n" +
                        "${Build.MANUFACTURER} ${Build.MODEL} · Android ${Build.VERSION.RELEASE}\n" +
                        "Sortie : ${if (renduTvProtege) "surface TV protégée" else "standard"}\n" +
                        "Source ${rang + 1}/${adresses.size} · ${lecteur?.videoFormat?.height?.takeIf { it > 0 }?.let { "${it}p" } ?: "Qualité automatique"}\n" +
                        "Rendu : $renduCourant\n" +
                        (if (renduAvantReprise.isNotEmpty()) "Avant reprise : $renduAvantReprise\n" else "") +
                        "Plafond : ${if (plafondDebit == Int.MAX_VALUE) "automatique" else "${plafondDebit / 1000} kb/s"}\n" +
                        listOfNotNull(dernierIncident ?: "Aucun incident", dernierArretSysteme).joinToString("\n") +
                        "\nRetour pour fermer · ↑ puis OK pour rouvrir",
                    Modifier.background(Color.Black.copy(alpha = 0.85f)).padding(10.dp),
                    color = Color.White, fontSize = 15.sp,
                )
                val courante = chaine
                Text(
                    listOfNotNull(courante?.numero?.toString(), courante?.nom).joinToString(" · "),
                    color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold,
                )
                // Le repli se dit, mais discrètement : savoir qu'on est sur la deuxième source explique
                // une qualité différente sans transformer un rattrapage réussi en incident.
                /*
                 * Le repli se dit, mais discrètement : savoir qu'on est sur la deuxième source
                 * explique une qualité différente sans transformer un rattrapage réussi en incident.
                 * Au doigt comme à la touche verte, il ouvre la liste — c'est le seul moyen de dire
                 * qu'une source qui *répond* répond mal.
                 */
                Text(
                    listOfNotNull(
                        courante?.groupe,
                        if (adresses.size > 1) "source ${rang + 1}/${adresses.size} ▾" else null,
                        if (securite > 0) getString(R.string.direct_securite, securite) else null,
                    ).joinToString(" · "),
                    Modifier.clickable(enabled = adresses.size > 1) {
                        choixIndex = ligneDuRang()
                        montrerLesSources(true)
                    },
                    color = Muet, fontSize = 13.sp,
                )
            }
            message?.let { texte ->
                Text(texte, Modifier.align(Alignment.Center)
                    .clip(RoundedCornerShape(10.dp)).background(Encre.copy(alpha = .82f)).padding(14.dp, 10.dp),
                    color = if (echec) Color(0xFFFFB7C0) else Color.White)
            }
            /*
             * La barre ne s'affiche que si la fenêtre vaut la peine.
             *
             * Sous deux segments, il n'y a rien derrière quoi revenir : une barre y serait un décor
             * qui ne répond pas, et c'est pire que pas de barre du tout.
             */
            /*
             * La pause s'affiche **toujours**, la piste seulement quand il y a une fenêtre.
             *
             * Les deux étaient liés, et le bouton disparaissait donc sur les chaînes dont l'hébergeur
             * ne publie presque rien derrière le direct — c'est-à-dire là où l'on veut encore pouvoir
             * mettre en pause. Ce qui n'a pas de sens sans fenêtre, c'est la barre : elle promettrait
             * un retour en arrière qui n'existe pas. Le bouton, lui, en a toujours.
             */
            if (commandesVisibles) {
                val fenetreUtile = fenetreMs > FENETRE_MINIMALE_MS
                /*
                 * L'avancement se calcule depuis le **retard sur le direct**, et non depuis la
                 * position dans la fenêtre.
                 *
                 * `currentPosition` se compte à partir du début de la période, qui n'est pas le début
                 * de la fenêtre glissante : sur les flux à longue fenêtre, la barre restait collée à
                 * gauche en permanence alors que l'image était bien au bord du direct. Le décalage,
                 * lui, dit exactement ce qu'on veut montrer — de combien on est derrière —, et c'est
                 * déjà lui qu'affiche le « − 0:31 » à côté.
                 */
                val avance = if (fenetreUtile) {
                    ((fenetreMs - retardMs).toFloat() / fenetreMs.toFloat()).coerceIn(0f, 1f)
                } else 0f
                /*
                 * « En direct », c'est à l'avance visée, à quelques secondes près. Le seuil valait douze
                 * secondes du bord alors que le lecteur se tient à quarante : l'écran annonçait un
                 * différé permanent pour une lecture qui était exactement où elle devait être.
                 */
                val avanceCibleMs = if (avanceDemandeeMs != C.TIME_UNSET) avanceDemandeeMs else CIBLE_MAX_S * 1_000L
                val auDirect = retardMs <= avanceCibleMs + MARGE_DIRECT_MS
                Row(
                    Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                        .background(Encre.copy(alpha = .82f)).padding(24.dp, 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier.clickable { basculerPause() }
                            .padding(horizontal = 10.dp, vertical = 6.dp)
                            .semantics {
                                contentDescription = getString(
                                    if (enPause) R.string.direct_reprendre_lecture else R.string.direct_pause,
                                )
                            },
                    ) { IconeLecture(enPause) }
                    Spacer(Modifier.width(14.dp))
                    if (fenetreUtile) {
                        Box(
                            Modifier.weight(1f).height(6.dp).clip(CircleShape)
                                .background(Color.White.copy(alpha = .18f)),
                        ) {
                            Box(
                                Modifier.fillMaxWidth(avance).height(6.dp).clip(CircleShape)
                                    .background(BleuClair),
                            )
                        }
                        Spacer(Modifier.width(14.dp))
                    } else {
                        Spacer(Modifier.weight(1f))
                    }
                    Text(
                        if (auDirect) getString(R.string.direct_en_direct)
                        else getString(R.string.direct_retard, horodatage(retardMs)),
                        color = if (auDirect) Color.White else BleuClair,
                        fontSize = 12.sp, fontWeight = FontWeight.Bold,
                    )
                    if (!auDirect && fenetreUtile) {
                        Spacer(Modifier.width(10.dp))
                        Box(
                            Modifier.clickable { rejoindreDirect() }
                                .padding(horizontal = 8.dp, vertical = 6.dp)
                                .semantics { contentDescription = getString(R.string.direct_revenir_direct) },
                        ) { IconeDirect() }
                    }
                }
            }

            /*
             * La liste des sources : ce que le serveur a mesuré, et le moyen d'en préférer une autre.
             *
             * La définition vient du manifeste, lue par le serveur — un client ne peut pas la
             * connaître seul, faute d'en-tête CORS côté navigateur, et Android n'a aucune raison de
             * refaire ce travail dans son coin. Une source non mesurée le dit plutôt que d'inventer.
             */
            if (choixOuvert) {
                /*
                 * La liste défile, et suit le curseur.
                 *
                 * Une chaîne peut porter soixante-dix adresses : une colonne fixe les dessinerait
                 * hors de l'écran, et la croix déplacerait une sélection qu'on ne verrait plus. Le
                 * défilement va chercher la ligne retenue à chaque déplacement.
                 */
                val etatListe = rememberLazyListState()
                LaunchedEffect(choixIndex) { etatListe.animateScrollToItem(choixIndex) }
                Column(
                    Modifier.align(Alignment.Center).clip(RoundedCornerShape(14.dp))
                        .background(Encre.copy(alpha = .95f)).padding(18.dp),
                ) {
                    Text("Sources et diagnostic · ↑ ↓ puis OK", color = Muet, fontSize = 12.sp,
                        fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(10.dp))
                    LazyColumn(state = etatListe, modifier = Modifier.heightIn(max = 300.dp)) {
                    itemsIndexed(groupesDuMenu()) { rangAffiche, groupe ->
                        val (index, doublons, muette) = groupe
                        val (hauteur, debit) = adresses.getOrNull(index)?.let { qualites[it] } ?: (null to null)
                        Column(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp))
                                .background(
                                    if (rangAffiche == choixIndex) Color.White.copy(alpha = .12f) else Color.Transparent,
                                )
                                .clickable { choisirSource(index) }
                                .padding(horizontal = 14.dp, vertical = 9.dp),
                        ) {
                            Text(
                                getString(
                                    if (rangAffiche == 0 && !muette) R.string.direct_source_recommandee else R.string.direct_source_rang,
                                    rangAffiche + 1,
                                ) + if (doublons > 1) getString(R.string.direct_source_adresses, doublons) else "",
                                color = if (index == rang) BleuClair else if (muette) Muet else Color.White,
                                fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                when {
                                    hauteur != null && debit != null ->
                                        getString(R.string.direct_source_debit, hauteur, "%.1f".format(debit / 1_000_000f))
                                    hauteur != null -> getString(R.string.direct_source_definition, hauteur)
                                    else -> getString(R.string.direct_source_inconnue)
                                // Muette pour le serveur, pas forcément pour ce téléviseur : elle reste choisissable.
                                } + if (muette) getString(R.string.direct_source_muette) else "",
                                color = Muet, fontSize = 12.sp,
                            )
                        }
                    }
                    item {
                        Text("Diagnostic de lecture", color = Color.White, fontSize = 15.sp,
                            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp))
                                .background(if (choixIndex == groupesDuMenu().size) Color.White.copy(alpha = .12f) else Color.Transparent)
                                .clickable { montrerLesSources(false); montrerDiagnostic(true) }
                                .padding(horizontal = 14.dp, vertical = 12.dp))
                    }
                    }
                }
            }

            // Le numéro composé, en gros et au centre : c'est le retour qu'un téléviseur donne, et
            // sans lui on ne sait pas si la télécommande a répondu.
            saisie?.let { compose ->
                Text(compose, Modifier.align(Alignment.TopEnd).padding(32.dp)
                    .clip(RoundedCornerShape(12.dp)).background(Encre.copy(alpha = .9f)).padding(24.dp, 12.dp),
                    color = Color.White, fontSize = 44.sp, fontWeight = FontWeight.ExtraBold)
            }
            // La chaîne passe sur un téléviseur : le lecteur devient sa télécommande.
            chaine?.let { courante -> TelecommandeLecteur(courante.id) { lecteur?.play() } }
        }
    }

    /**
     * Le plein écran se redemande à chaque retour de focus.
     *
     * Une notification, un changement d'application, un balayage depuis le bord : chacun ramène les
     * barres, et rien ne les renvoie de lui-même. Le lecteur de la médiathèque fait exactement cela.
     */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) masquerBarresSysteme()
    }

    /**
     * Les icônes du lecteur sont **dessinées**, pas écrites.
     *
     * Elles étaient des caractères Unicode — `⏵`, `⏸`, `⏭`, du bloc « Miscellaneous Technical ». Un
     * navigateur de bureau a de quoi les afficher ; la police d'un téléviseur Android, non : le
     * bouton n'apparaissait tout simplement pas, relevé au salon. Un triangle et deux barres ne
     * dépendent d'aucune police et se rendent partout de la même façon.
     */
    @Composable
    private fun IconeLecture(enPause: Boolean, taille: Dp = 20.dp) {
        if (enPause) {
            Canvas(Modifier.size(taille)) {
                drawPath(
                    Path().apply {
                        moveTo(size.width * .18f, 0f)
                        lineTo(size.width * .92f, size.height / 2f)
                        lineTo(size.width * .18f, size.height)
                        close()
                    },
                    Color.White,
                )
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(taille * .22f)) {
                repeat(2) {
                    Box(
                        Modifier.width(taille * .28f).height(taille)
                            .clip(RoundedCornerShape(2.dp)).background(Color.White),
                    )
                }
            }
        }
    }

    /** Rejoindre le direct : le même triangle, buté contre une barre. */
    @Composable
    private fun IconeDirect(taille: Dp = 18.dp) {
        Row(horizontalArrangement = Arrangement.spacedBy(taille * .12f), verticalAlignment = Alignment.CenterVertically) {
            Canvas(Modifier.size(taille * .8f)) {
                drawPath(
                    Path().apply {
                        moveTo(0f, 0f)
                        lineTo(size.width, size.height / 2f)
                        lineTo(0f, size.height)
                        close()
                    },
                    Color.White,
                )
            }
            Box(Modifier.width(taille * .18f).height(taille * .8f).clip(RoundedCornerShape(1.dp)).background(Color.White))
        }
    }

    /** Un retard se lit en minutes et secondes, jamais en millisecondes. */
    private fun horodatage(ms: Long): String {
        val total = (ms / 1000.0).roundToInt().coerceAtLeast(0)
        return "%d:%02d".format(total / 60, total % 60)
    }

    /**
     * Mise en pause quand l'écran passe à l'arrière-plan, **reprise quand il revient**.
     *
     * Il n'y avait que la pause : une veille du téléviseur, une notification plein écran, un dialogue
     * du système suffisaient à arrêter la chaîne, et rien ne la relançait — l'image se coupait au bout
     * d'un moment et l'application restait en pause derrière, exactement ce qui a été relevé au salon.
     * On note donc si l'on jouait, et on repart de là.
     */
    private var jouaitAvantArret = false

    @Suppress("DEPRECATION")
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) {
            cacheSegments.vider()
            repriseEnCours?.cancel()
        }
    }

    override fun onStop() {
        super.onStop()
        surveillanceReseau?.arreter()
        jouaitAvantArret = lecteur?.playWhenReady == true
        generationLecture += 1
        repriseEnCours?.cancel()
        repriseEnCours = null
        lecteur?.pause()
    }

    override fun onStart() {
        super.onStart()
        if (surveillanceReseau == null) surveillanceReseau = SurveillanceReseauDirect(this) {
            lifecycleScope.launch { if (::api.isInitialized) renouvelerAdresses() }
        }
        surveillanceReseau?.demarrer()
        if (::api.isInitialized) lifecycleScope.launch { renouvelerAdresses() }
        if (jouaitAvantArret) {
            jouaitAvantArret = false
            // Rejoindre le bord : le flux a continué sans nous, reprendre où l'on s'était arrêté
            // ferait démarrer avec le retard de toute l'absence.
            lecteur?.let { deplacerLecture(it) }
            lecteur?.play()
        }
    }

    private fun etatPourDiffusion() = etatDiffusionAndroid(
        if (chaine == null) null else "direct", chaine?.id ?: "", chaine?.nom ?: "FlixTunes",
        if (lecteur?.isPlaying == true) "lecture" else if (lecteur?.playWhenReady == false) "pause" else "chargement",
        volume = lecteur?.volume ?: 1f)

    override fun onDestroy() {
        super.onDestroy()
        echeance?.cancel()
        repriseEnCours?.cancel()
        vueLecteur?.player = null
        vueLecteur = null
        candidatAffiche = null
        lecteur?.release()
        lecteur = null
        vitesses.clear()
        decodeurs.clear()
        premieresImages.clear()
        cacheSegments.vider()
    }

    companion object {
        const val EXTRA_SERVER = "serveur"
        const val EXTRA_PROFILE_ID = "profil"
        const val EXTRA_PROFILE_TOKEN = "jeton"
        const val EXTRA_CHANNEL_ID = "chaine"

        /** Au-delà, on n'attend plus : une adresse muette trois secondes fera perdre du temps. */
        private const val DELAI_COURSE_MS = 3_000L

        /**
         * Le retard visé derrière le bord du flux, en secondes.
         *
         * Trois segments, comme le veut HLS — 8 s de médiane sur le corpus mesuré, donc 24 s. C'est
         * ce que « en direct » veut dire en pratique, et le point de départ tant que rien ne hoquette.
         */
        private const val CIBLE_DIRECT_S = 24

        /** Ce qu'on recule après des blocages répétés, pris dans les 37 s de marge de la fenêtre médiane. */
        private const val RECUL_S = 16

        /** Trois blocages dans cette fenêtre, et le lecteur recule. */
        private const val MEMOIRE_BLOCAGES_MS = 120_000L
        private const val BLOCAGES_AVANT_RECUL = 3

        /** Le saut d'une flèche, en millisecondes. Dix secondes, comme partout ailleurs. */
        private const val SAUT_MS = 10_000L

        /** Le direct, c'est le bord à quelques secondes près : au-delà, on est en différé et on le dit. */
        private const val MARGE_DIRECT_MS = 12_000L

        /** Sous deux segments, une fenêtre ne mérite pas de barre : elle ne promettrait rien. */
        private const val FENETRE_MINIMALE_MS = 16_000L

        /**
         * Ce qu'on refuse de laisser entre le point de lecture et le bord **arrière** de la fenêtre.
         *
         * C'est la marge qui manquait, et l'origine des coupures au bout d'un moment. Reculer coûte du
         * retard, et ce retard se prend dans la fenêtre — qui n'est pas infinie. Le recul était fixe :
         * `CIBLE_DIRECT_S` + `RECUL_S`, soit **40 s derrière le direct**, quelle que soit la chaîne.
         * Sur la fenêtre médiane mesurée — 61 s — il restait 21 s ; sur les 8 % de chaînes dont la
         * fenêtre est plus courte que 40 s, reculer plaçait le point de lecture **hors de la fenêtre
         * sur-le-champ**. L'image tenait un moment, puis coupait, et relancer réparait, parce que
         * relancer repart au bord.
         *
         * Vingt secondes, soit deux segments et demi : de quoi absorber un rechargement sans réclamer
         * un segment que l'hébergeur vient de retirer.
         */
        private const val MARGE_ARRIERE_MS = 20_000L

        /**
         * Combien de fois on redémarre **la même adresse** avant de la mettre en cause.
         *
         * Trois, espacées de 2, 5 puis 10 secondes : croissantes, parce qu'une coupure qui dure ne se
         * répare pas en insistant vite, et qu'insister vite ne fait qu'épuiser le compteur avant que
         * le réseau ne soit revenu.
         */
        private const val REPRISES_MAX = 3
        private val ATTENTES_REPRISE_MS = longArrayOf(2_000L, 5_000L, 10_000L)

        /**
         * La durée de lecture qui disculpe une adresse.
         *
         * Trente secondes d'image sans faute prouvent que l'adresse est bonne et que l'hébergeur
         * répond. Ce qui l'interrompt ensuite est un incident, pas un verdict, et l'inscrire au
         * classement reviendrait à noter le réseau sous le nom de la source.
         */
        /**
         * Ce qu'il faut d'image continue pour qu'un flux soit déclaré stable.
         *
         * Quinze secondes : deux segments de la médiane du corpus, plus une marge. Assez pour prouver
         * que l'hébergeur envoie vraiment, trop peu pour retarder la course d'ouverture — une source
         * qui ne démarre pas ne l'atteint jamais et reste traitée à l'ancienne, c'est-à-dire vite.
         *
         * Le même chiffre sert de tolérance une fois la déclaration acquise : quinze secondes d'image
         * acquise achètent quinze secondes d'obstination. La symétrie n'est pas une coquetterie, elle
         * rend le réglage explicable — et donc corrigeable.
         */
        /**
         * Le décalage visé par rapport au bord du direct, et donc le tampon maximal possible.
         *
         * La fenêtre médiane du corpus fait 61 s. En gardant les 20 s de marge arrière, on peut se
         * tenir à 40 s du bord : **la marge grandit de 65 %** par rapport aux 24 s d'origine. Le
         * plafond est un choix explicite — c'est le décalage maximal qu'on accepte entre l'image et
         * le temps réel, et au-delà le « direct » cesserait d'en être un.
         */
        private const val CIBLE_MAX_S = 40

        /**
         * Les trois seuils du tampon, et pourquoi on regarde la **descente** plutôt que le fond.
         *
         * Personne ne surveillait l'avance du tampon. On ne découvrait donc le problème qu'à zéro,
         * c'est-à-dire une fois l'image figée — trop tard pour faire autre chose que réparer. En
         * dessous de dix secondes on allège d'un cran, en dessous de cinq on allège deux fois, et à
         * dix-huit on rend tout : la qualité maximale revient d'elle-même, sans que personne n'ait à
         * la redemander.
         */
        private const val TAMPON_BAS_MS = 10_000L
        private const val TAMPON_CRITIQUE_MS = 5_000L
        private const val TAMPON_RETABLI_MS = 18_000L

        /** En dessous, alléger n'a plus de sens : c'est déjà la variante la plus basse du flux. */
        private const val DEBIT_PLANCHER = 150_000

        private const val SEUIL_STABILITE_MS = 15_000L

        /** Six tentatives internes ≈ quinze secondes, réservées au flux déclaré stable. */
        private const val REPRISES_INTERNES_STABLE = 6

        /** L'obstination finale quand rien n'a jamais démarré : deux essais, et l'on conclut. */
        private const val RELANCES_SANS_PREUVE = 2

        /**
         * L'insistance quand plus rien ne répond : six relances, dix secondes d'écart.
         *
         * Une minute en tout. Assez pour traverser une coupure de réseau domestique — le cas que l'on
         * veut absolument survivre —, trop peu pour maquiller une chaîne réellement éteinte : au bout
         * du compte on le dit, avec le chiffre.
         */
        private const val RELANCES_LENTES = 6
        private const val INTERVALLE_RELANCE_MS = 10_000L

        /** La barre s'efface après cette accalmie. */
        private const val REPOS_BARRE_MS = 3_500L

        /**
         * Le répit accordé après une action : ce qui recharge dans ce délai vient de nous.
         *
         * Quatre secondes couvrent l'ouverture d'un segment de 8 s et le remplissage qui suit un saut.
         * Au-delà, un rechargement est bien un hoquet de la source.
         */
        private const val REPIT_APRES_GESTE_MS = 4_000L

        /**
         * Le répit accordé au recul de sécurité avant de le juger.
         *
         * Reculer reprépare le flux, qui se remplit pendant plusieurs secondes. Compter ces
         * rechargements-là revenait à condamner la source pour le remède qu'on venait de lui donner.
         */
        private const val REPIT_APRES_RECUL_MS = 30_000L

        /** Deux blocages plus rapprochés que cela sont le même incident, pas deux. */
        private const val INTERVALLE_MIN_BLOCAGE_MS = 10_000L

        /**
         * Le temps minimal passé sur une source avant d'envisager la suivante.
         *
         * Sans lui, une minute difficile au démarrage suffisait à abandonner une chaîne qui marche.
         * Avec l'espacement des incidents, il faut désormais **six blocages étalés sur au moins une
         * minute et vingt secondes** pour changer de source : c'est un problème installé, plus une
         * mauvaise passe.
         */
        private const val TEMPS_MIN_SUR_SOURCE_MS = 60_000L

        /**
         * Au-delà, l'image n'est plus une image : on n'attend pas d'avoir compté.
         *
         * Huit secondes couvrent le rechargement d'un segment de 8 s, qui est la médiane du corpus.
         * En deçà on serait trop nerveux ; au-delà on regarderait un écran figé en se demandant si
         * l'application est morte.
         */
        private const val BLOCAGE_PROLONGE_MS = 8_000L
    }
}
