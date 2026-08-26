package tv.flixtunes.app

import android.content.ComponentName
import android.app.AlertDialog
import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.os.SystemClock
import android.util.Rational
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import android.annotation.SuppressLint
import android.view.KeyEvent
import androidx.media3.ui.PlayerView
import androidx.media3.ui.CaptionStyleCompat
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import tv.flixtunes.app.ui.LocalGabarit
import tv.flixtunes.app.ui.gabaritPour
import tv.flixtunes.app.ui.masquerBarresSysteme
import tv.flixtunes.app.ui.lecteur.ActionsLecteur
import tv.flixtunes.app.ui.lecteur.CommandesLecteur
import tv.flixtunes.app.ui.lecteur.DELAI_AUTOPLAY_SECONDES
import tv.flixtunes.app.ui.lecteur.EtatLecteur
import tv.flixtunes.app.ui.lecteur.PisteChoix
import tv.flixtunes.app.playback.dureeAffichee
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.coroutines.coroutineContext
import tv.flixtunes.app.data.FlixTunesApi
import tv.flixtunes.app.playback.DeviceCapabilities
import tv.flixtunes.app.playback.DeviceIdentity
import tv.flixtunes.app.data.PlaybackSession
import tv.flixtunes.app.playback.DisplayModeInfo
import tv.flixtunes.app.playback.FenetreLecture
import tv.flixtunes.app.playback.LecteurFenetre
import tv.flixtunes.app.playback.PisteAudio
import tv.flixtunes.app.playback.Qualite
import tv.flixtunes.app.playback.plagesProposees
import tv.flixtunes.app.playback.pisteDolbyVisionReconnue
import tv.flixtunes.app.playback.coucheBaseDolbyVision
import tv.flixtunes.app.playback.HdrDirectPlayPreference
import tv.flixtunes.app.playback.filtrerHdr10PlusPourDolbyVisionDirect
import tv.flixtunes.app.playback.tempsFilm
import tv.flixtunes.app.playback.arrondiMbps
import tv.flixtunes.app.playback.infosLecture
import tv.flixtunes.app.playback.LigneInfo
import tv.flixtunes.app.playback.qualitesProposees
import tv.flixtunes.app.playback.PisteSousTitre
import tv.flixtunes.app.playback.choisirPisteAudio
import tv.flixtunes.app.playback.choisirSousTitre
import tv.flixtunes.app.playback.EtatReprises
import tv.flixtunes.app.playback.changementUtile
import tv.flixtunes.app.playback.surRetourReseau
import tv.flixtunes.app.playback.ERREURS_ANALYSE
import tv.flixtunes.app.playback.ERREURS_RESEAU
import tv.flixtunes.app.playback.GesteTelecommande
import tv.flixtunes.app.playback.PAS_NAVIGATION_SECONDES
import tv.flixtunes.app.playback.SerieTapes
import tv.flixtunes.app.playback.cumulerTape
import tv.flixtunes.app.playback.PlaybackService
import tv.flixtunes.app.playback.gesteTelecommande
import tv.flixtunes.app.playback.ReactionErreur
import tv.flixtunes.app.playback.RepriseDecision
import tv.flixtunes.app.playback.Tunneling
import tv.flixtunes.app.playback.decisionReprise
import tv.flixtunes.app.playback.intituleLecteur
import tv.flixtunes.app.playback.numeroEpisode
import tv.flixtunes.app.playback.departDemande
import tv.flixtunes.app.playback.cibleReprise
import tv.flixtunes.app.playback.chooseDisplayMode
import tv.flixtunes.app.playback.reactionPour
import tv.flixtunes.app.playback.reinitialisationHdrApresSeek

@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
class PlayerActivity : ComponentActivity() {
    private lateinit var view: PlayerView
    private lateinit var controllerFuture: ListenableFuture<MediaController>
    private var controller: MediaController? = null
    private var playbackSessionId: String? = null
    private lateinit var api: FlixTunesApi
    private lateinit var mediaId: String
    private lateinit var profileId: String
    private var compatibilityRetry = false
    private var initialSeekApplied = false
    /** La préparation en cours. Une seule à la fois — voir [preparePlayback]. */
    private var preparation: Job? = null
    /** Où reprendre, et faut-il le demander. Décidé une fois pour toutes dans [onCreate]. */
    private var reprise = RepriseDecision(0, demander = false)

    /**
     * Codec vidéo servi en lecture directe, et mode retenu par le serveur.
     *
     * Ces deux valeurs sont la seule façon de dire au serveur ce qui s'est passé. En lecture directe il
     * se contente de servir le fichier : l'échec se produit dans le décodeur de l'appareil, et il n'en
     * voit rien. Sans retour, il repropose le même codec à chaque lecture et l'erreur se répète à
     * l'identique — c'est le défaut qui use le plus vite la patience.
     */
    private var directVideoCodec: String? = null
    private var sessionMode: String? = null
    /** Plage dynamique demandée : « auto » tant que personne n'a contredit ce que l'écran annonce. */
    private var plageVoulue: String = "auto"
    private val prioritePlageGlobale by lazy { intent.getStringExtra(EXTRA_DYNAMIC_RANGE_PRIORITY) ?: "auto" }
    private var formatsHdrAppareil: List<String> = emptyList()
    private var coucheBaseHdr: String? = null
    /** Plage dynamique du fichier — c'est elle qui décide si le réglage a lieu d'être proposé. */
    private var formatSourceHdr: String? = null
    /** Tous les formats réellement présents, y compris un master hybride Dolby Vision + HDR10+. */
    private var formatsHdrSource: List<String> = emptyList()
    private var profilDolbyVisionSource: Int? = null
    private var langueOriginale: String? = null

    /**
     * Fenêtre encodée par la session en cours.
     *
     * Le décalage vient du serveur, la durée réelle de FFprobe. Ensemble ils permettent d'afficher le
     * temps du film là où le lecteur ne connaît que celui du flux.
     */
    private var fenetre = FenetreLecture(0.0, 0.0)
    /**
     * Début du générique de fin, en secondes de film, quand le fichier le nomme.
     *
     * Tiré des chapitres par le serveur. C'est le moment d'annoncer l'épisode suivant : la carte
     * n'apparaissait jusqu'ici qu'à la toute fin, l'écran déjà noir.
     */
    private var debutGeneriqueSecondes: Double? = null
    /** Introduction repérée, de quoi proposer de la passer. Le serveur ne l'expose que sur une série. */
    private var introSecondes: ClosedFloatingPointRange<Double>? = null
    /** L'introduction a été passée ou refusée : le bouton ne revient pas. */
    private var introEcartee = false
    /** La carte a été ouverte par le générique : à la fin du média, on enchaîne sans redécompter. */
    private var carteParGenerique = false
    /** « Annuler » vaut pour tout le reste de l'épisode. */
    private var enchainementEcarte = false
    /** L'épisode qui suit, retenu pour l'annoncer dès le générique. */
    private var voisinSuivant: org.json.JSONObject? = null
    private var derniereSession: PlaybackSession? = null
    private var infoVisible = false
    /** Ce que la barre affiche. Recalcule quatre fois par seconde, jamais lu par le lecteur. */
    private var etatLecteur by mutableStateOf(EtatLecteur(titre = ""))
    /** La barre se retire d'elle-meme pendant la lecture ; toute interaction la rappelle. */
    private var commandesVisibles by mutableStateOf(true)
    /** Haut/bas a fait entrer la télécommande dans les options focalisables. */
    private var parcoursCommandes = false
    private var masquage: kotlinx.coroutines.Job? = null
    private var effacementSaut: kotlinx.coroutines.Job? = null
    private var serieNavigation: SerieTapes? = null
    private var minuteur: kotlinx.coroutines.Job? = null
    private var minuteurMinutes = 0
    private var enchainement: kotlinx.coroutines.Job? = null
    private var episodeEnAttente: org.json.JSONObject? = null
    private var compteurEnAttente = 0
    /**
     * Vrai tant que la lecture tient dans la vignette du systeme.
     *
     * Les commandes n'y ont pas leur place : la vignette fait quelques centimetres, le systeme y pose
     * ses propres boutons, et les notres s'y dessinaient par-dessus l'image en la masquant presque
     * entierement. Les gestes n'y ont pas de sens non plus — une tape sur la vignette la ramene au
     * premier plan, c'est le systeme qui la traite.
     */
    private var enImageDansImage by mutableStateOf(false)
    private lateinit var racine: FrameLayout

    /** Le `playback-info` du média en cours, relu par le panneau d'infos. */
    private var infosFlux: org.json.JSONObject? = null
    private var codecSuccessReported = false
    /**
     * Démenti de quarantaine en attente de confirmation.
     *
     * Le démenti partait à la première image. C'est devenu dangereux depuis que le serveur tente la
     * lecture directe malgré un désaccord annoncé : le démenti **efface** la ligne de quarantaine, si
     * bien qu'une erreur de décodage survenue quelques secondes plus tard repart d'un compteur remis à
     * zéro. Deux échecs étant nécessaires pour retenir la leçon, elle ne l'aurait jamais été, et
     * l'appareil retenterait à chaque lecture ce qui ne marche pas chez lui.
     *
     * Une image affichée prouve que le décodeur a accepté le flux ; elle ne prouve pas qu'il le tient.
     * On attend donc [DELAI_DEMENTI_MS] de lecture, et toute erreur d'ici là annule l'attente.
     */
    private var dementiEnAttente: Runnable? = null
    /** Le repli par le remux n'est pris qu'une fois : au-delà, c'est bien le décodeur qui refuse. */
    private var repliRemuxTente = false

    /** Coupures réseau déjà reprises pour cette lecture ; remis à zéro dès qu'une image repart. */
    private var reprisesReseau = 0
    private var repriseEnAttente: Runnable? = null
    private var rappelReseau: ConnectivityManager.NetworkCallback? = null
    private var dernierReseau: String? = null

    /** Les pistes ne sont imposées qu'une fois : ensuite, un changement manuel doit tenir. */
    private var pisteAudioAppliquee = false

    /**
     * Durée réelle du média, mesurée par FFprobe côté serveur.
     * En transcodage HLS, `player.duration` ne couvre que la portion déjà encodée : s'en servir pour la
     * reprise renverrait la lecture au début, et pour la progression enregistrerait un pourcentage faux.
     */
    private var trueDurationMs = 0L
    private fun referenceDurationMs(playerDuration: Long): Long =
        if (trueDurationMs > 0) trueDurationMs else playerDuration
    private val preferredAudioLanguages by lazy { intent.getStringArrayListExtra(EXTRA_AUDIO_LANGUAGES).orEmpty() }
    private val preferredSubtitleLanguages by lazy { intent.getStringArrayListExtra(EXTRA_SUBTITLE_LANGUAGES).orEmpty() }
    // « forcé » par défaut, comme le serveur : c'est le réglage qui convient à la majorité des films.
    private val subtitleMode by lazy { intent.getStringExtra(EXTRA_SUBTITLE_MODE) ?: "forced" }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val server = intent.getStringExtra(EXTRA_SERVER) ?: return finish()
        mediaId = intent.getStringExtra(EXTRA_MEDIA_ID) ?: return finish()
        profileId = intent.getStringExtra(EXTRA_PROFILE_ID) ?: return finish()
        api = FlixTunesApi(server, intent.getStringExtra(EXTRA_PROFILE_TOKEN))
        val preferencesSousTitres = getSharedPreferences("subtitle-style", MODE_PRIVATE)
        etatLecteur = etatLecteur.copy(
            tailleSousTitres = preferencesSousTitres.getString("size:$profileId", "normal") ?: "normal",
            fondSousTitres = preferencesSousTitres.getBoolean("background:$profileId", false),
            couleurSousTitres = preferencesSousTitres.getString("color:$profileId", "white") ?: "white",
        )
        etatLecteur = etatLecteur.copy(
            titre = intent.getStringExtra(EXTRA_TITLE) ?: "FlixTunes",
            chargement = true,
        )
        // Une activité recréée après que le système l'a tuée reçoit l'intention d'origine, vieille de
        // toute la séance. Ce que l'activité a sauvegardé juste avant de disparaître vaut mieux.
        val sauvegarde = savedInstanceState?.getInt(ETAT_PROGRESSION, -1)?.takeIf { it >= 0 }
        val sauvegardeSecondes = savedInstanceState?.takeIf { it.containsKey(ETAT_POSITION_SECONDS) }
            ?.getDouble(ETAT_POSITION_SECONDS)?.takeIf { it.isFinite() && it >= 0.0 }
        reprise = decisionReprise(
            sauvegarde, intent.getIntExtra(EXTRA_PROGRESS, 0),
            intent.getStringExtra(EXTRA_RESUME_MODE) ?: "continue",
            sauvegardeSecondes = sauvegardeSecondes,
            intentSecondes = intent.takeIf { it.hasExtra(EXTRA_PROGRESS_SECONDS) }?.getDoubleExtra(EXTRA_PROGRESS_SECONDS, 0.0),
            intentDureeSecondes = intent.takeIf { it.hasExtra(EXTRA_PROGRESS_DURATION_SECONDS) }
                ?.getDoubleExtra(EXTRA_PROGRESS_DURATION_SECONDS, 0.0),
        )
        // La lecture directe avait déjà échoué avant la destruction : inutile de la retenter.
        compatibilityRetry = savedInstanceState?.getBoolean(ETAT_CONVERSION, false) ?: false
        view = PlayerView(this).apply {
            // Les commandes de Media3 sont retirees : elles tirent leur duree totale de la `Timeline`
            // du lecteur, que rien ne traduit, et affichaient donc la position dans le film sur la
            // duree de la fenetre encodee. Les notres la recoivent deja traduite — voir `CommandesLecteur`.
            useController = false
            keepScreenOn = true
            // Le cadre autour de l'image doit disparaître, donc être noir.
            //
            // Une image 2.39:1 sur un téléviseur 16:9 laisse deux bandes, et un film 4:3 en laisse
            // deux autres sur les côtés. Ces bandes montrent ce qu'il y a derrière la surface vidéo :
            // le fond de la vue, puis celui de la fenêtre. Les deux valaient l'encre de la marque,
            // `#080B12`, qui porte assez de bleu pour se voir sur un grand écran — le film paraissait
            // alors encadré de gris bleuté, et ses propres noirs plus profonds que le cadre.
            //
            // `setBackgroundColor` couvre le pourtour de la surface, `setShutterBackgroundColor` le
            // rectangle affiché avant la première image et pendant un changement de piste.
            setBackgroundColor(android.graphics.Color.BLACK)
            setShutterBackgroundColor(android.graphics.Color.BLACK)
        }
        appliquerStyleSousTitres()
        racine = FrameLayout(this).apply {
            setBackgroundColor(android.graphics.Color.BLACK)
            addView(view, FrameLayout.LayoutParams(-1, -1))
        }
        setContentView(racine)
        installerCommandes()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    infoVisible || etatLecteur.pistesOuvertes -> fermerPanneaux()
                    commandesVisibles -> masquerCommandes()
                    else -> {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            }
        })
        enterFullScreen()
        surveillerReseau()
        controllerFuture = MediaController.Builder(this, SessionToken(this, ComponentName(this, PlaybackService::class.java))).buildAsync()
        controllerFuture.addListener({
            controller = controllerFuture.get().also { player ->
                // La vue parle au lecteur traduit : sa barre affiche alors le temps du film, et toute
                // navigation — curseur, avance de dix secondes — passe par la même traduction.
                view.player = LecteurFenetre(player, { fenetre }, ::relancerA)
                player.addListener(object : Player.Listener {
                override fun onPlayerError(error: PlaybackException) = traiterErreur(error)
                /** Une image est apparue : le décodeur a accepté le flux. Reste à voir s'il le tient. */
                override fun onRenderedFirstFrame() { armerDementiCodec() }
                /**
                 * Les pistes du fichier viennent d'être annoncées : c'est le seul moment où l'on peut
                 * choisir la bonne. Media3 en a déjà retenu une par défaut ; on la remplace.
                 */
                override fun onTracksChanged(tracks: Tracks) {
                    if (!garantirPisteDolbyVision(tracks)) appliquerPisteAudio(tracks)
                }
                override fun onPlaybackStateChanged(playbackState: Int) {
                    // Le flux repart : la coupure est derrière nous, et la prochaine devra bénéficier
                    // du même nombre de reprises que celle-ci. Sans cette remise à zéro, quatre brèves
                    // coupures étalées sur un long film finiraient par fermer le lecteur.
                    if (playbackState == Player.STATE_READY) {
                        reprisesReseau = 0
                        etatLecteur = etatLecteur.copy(chargement = false, erreur = null)
                    }
                    val reference = referenceDurationMs(player.duration)
                    if (playbackState == Player.STATE_READY && !initialSeekApplied && reference > 0
                        && (reprise.pourcentage > 0 || reprise.positionSecondes != null)) {
                        initialSeekApplied = true
                        val targetSeconds = cibleReprise(reprise, reference / 1000.0,
                            intent.getIntExtra(EXTRA_RESUME_REWIND, 5))
                        if (reprise.demander) {
                            player.pause()
                            AlertDialog.Builder(this@PlayerActivity).setTitle(getString(R.string.lecteur_reprendre_titre))
                                .setMessage(getString(R.string.lecteur_reprendre_message, reprise.pourcentage))
                                .setPositiveButton(getString(R.string.lecteur_reprendre)) { _, _ -> naviguerA(targetSeconds); player.play() }
                                .setNegativeButton(getString(R.string.lecteur_depuis_debut)) { _, _ -> player.seekTo(0); player.play() }.show()
                        } else naviguerA(targetSeconds)
                    }
                    if (playbackState == Player.STATE_ENDED) autoplayNext()
                }
            }) }
            preparePlayback(compatibilityRetry)
            lifecycleScope.launch { while (isActive) { delay(10_000); persistProgress() } }
        }, ContextCompat.getMainExecutor(this))
    }

    /**
     * Applique la piste audio voulue par le profil, en lecture directe.
     *
     * En conversion, le serveur a déjà choisi et ne sert qu'une piste : intervenir ici n'aurait pas
     * de sens. En lecture directe il sert le fichier entier, et sans cette sélection Media3 garde la
     * piste par défaut du conteneur — souvent l'anglais sur un fichier multilingue, alors que le
     * profil demande le français.
     *
     * La langue de tournage n'est pas transmise par le serveur : la préférence « original » est donc
     * ignorée plutôt que devinée. La deviner reviendrait à prendre une piste au hasard en la faisant
     * passer pour la bonne.
     */
    private fun appliquerPisteAudio(tracks: Tracks) {
        if (sessionMode != "direct" || pisteAudioAppliquee) return
        val disponibles = mutableListOf<PisteAudio>()
        val origines = mutableListOf<Pair<Tracks.Group, Int>>()
        for (groupe in tracks.groups) {
            if (groupe.type != C.TRACK_TYPE_AUDIO) continue
            for (rang in 0 until groupe.length) {
                val format = groupe.getTrackFormat(rang)
                disponibles += PisteAudio(
                    index = disponibles.size, langue = format.language,
                    canaux = format.channelCount.coerceAtLeast(1),
                    descriptive = format.roleFlags and C.ROLE_FLAG_DESCRIBES_VIDEO != 0,
                )
                origines += groupe to rang
            }
        }
        val choisie = choisirPisteAudio(disponibles, preferredAudioLanguages, langueOriginale) ?: return
        val (groupe, rang) = origines[choisie.index]
        val lecteur = controller ?: return
        var reglages = lecteur.trackSelectionParameters.buildUpon()
            .setOverrideForType(TrackSelectionOverride(groupe.mediaTrackGroup, rang))

        // Les sous-titres se décident dans la même passe : le mode « forcé » a besoin de savoir quelle
        // bande son vient d'être retenue, et c'est ici la seule fois où on la connaît.
        reglages = appliquerSousTitres(reglages, tracks, choisie.langue)
        lecteur.trackSelectionParameters = reglages.build()
        pisteAudioAppliquee = true
    }

    /**
     * Ajoute aux réglages la piste de sous-titres voulue, ou l'absence de sous-titres.
     *
     * Ne rien décider n'est pas neutre : Media3 garderait alors son propre choix, celui qu'on cherche
     * justement à remplacer. Quand [choisirSousTitre] ne retient rien, on le lui dit explicitement.
     */
    private fun appliquerSousTitres(
        reglages: TrackSelectionParameters.Builder,
        tracks: Tracks,
        langueAudio: String?,
    ): TrackSelectionParameters.Builder {
        val disponibles = mutableListOf<PisteSousTitre>()
        val origines = mutableListOf<Pair<Tracks.Group, Int>>()
        for (groupe in tracks.groups) {
            if (groupe.type != C.TRACK_TYPE_TEXT) continue
            for (rang in 0 until groupe.length) {
                val format = groupe.getTrackFormat(rang)
                disponibles += PisteSousTitre(
                    index = disponibles.size, langue = format.language,
                    forcee = format.selectionFlags and C.SELECTION_FLAG_FORCED != 0,
                    sourds = format.roleFlags and C.ROLE_FLAG_DESCRIBES_MUSIC_AND_SOUND != 0,
                )
                origines += groupe to rang
            }
        }
        val choisie = choisirSousTitre(disponibles, preferredSubtitleLanguages, subtitleMode, langueAudio)
            ?: return reglages.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
        val (groupe, rang) = origines[choisie.index]
        return reglages.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            .setOverrideForType(TrackSelectionOverride(groupe.mediaTrackGroup, rang))
    }

    /**
     * Applique au lecteur la conduite décidée par [reactionPour].
     *
     * Le raisonnement est ailleurs, et testé ; il ne reste ici que les gestes. Un point mérite
     * attention : la reprise après coupure réseau conserve la position en cours. Media3 la garde dans
     * le lecteur, et `prepare()` repart d'où l'on était — reprendre au début serait vécu comme une
     * panne plus grave que la coupure elle-même.
     */
    private fun traiterErreur(error: PlaybackException) {
        // Quelle que soit la suite, le démenti n'a plus lieu d'être : une lecture qui échoue ne
        // témoigne pas en faveur du codec. Le laisser partir effacerait l'échec avant qu'il compte.
        annulerDementiCodec()
        when (reactionPour(error.errorCode, compatibilityRetry, reprisesReseau, Tunneling.actif(this))) {
            ReactionErreur.COUPER_TUNNEL -> {
                Tunneling.abandonner(this)
                PlaybackService.trackSelector?.let { selecteur ->
                    selecteur.parameters = selecteur.buildUponParameters().setTunnelingEnabled(false).build()
                }
                // Le codec n'est pas mis en cause : on n'a encore rien prouvé contre lui, et c'est
                // justement l'intérêt de retenter en direct avant de faire convertir le NAS.
                controller?.prepare()
            }
            ReactionErreur.REPRENDRE -> programmerReprise()
            ReactionErreur.SIGNALER_ET_CONVERTIR -> { reportCodecFailure(error); convertir() }
            ReactionErreur.CONVERTIR -> convertir()
            ReactionErreur.ABANDONNER -> {
                controller?.pause()
                commandesVisibles = true
                masquage?.cancel()
                etatLecteur = etatLecteur.copy(chargement = false, erreur = messageAbandon(error))
            }
        }
    }

    /**
     * Programme une reprise après coupure, que le retour du réseau pourra devancer.
     *
     * L'attente reste croissante : réessayer dans la seconde qui suit une bascule de borne échoue
     * autant de fois qu'on insiste, la nouvelle route n'étant pas encore établie. Mais elle n'est plus
     * qu'un filet — quand le système annonce une interface utilisable, [surRetourReseau] la devance.
     */
    private fun programmerReprise() {
        reprisesReseau += 1
        repriseEnAttente?.let { view.removeCallbacks(it) }
        val tache = Runnable { repriseEnAttente = null; controller?.prepare() }
        repriseEnAttente = tache
        view.postDelayed(tache, 1_000L * reprisesReseau)
    }

    /**
     * Écoute les changements d'interface réseau pendant toute la lecture.
     *
     * Le système sait exactement quand une route devient utilisable ; s'en remettre à lui remplace une
     * attente par un fait. On ne réagit qu'aux réseaux **devenus** utilisables, et jamais deux fois au
     * même : la pile réseau d'un téléphone en déplacement produit beaucoup de soubresauts, et relancer
     * à chacun rendrait la lecture plus instable que la bascule elle-même.
     */
    private fun surveillerReseau() {
        // `registerDefaultNetworkCallback` n'existe qu'à partir d'Android 7, et l'application accepte
        // Android 6. L'appel était enveloppé dans un `runCatching` qui rattrapait le `NoSuchMethodError`
        // sans rien en dire : la surveillance ne s'installait pas, et rien ne permettait de le savoir.
        // Le dire ici ne change pas ce qui se passe sur ces appareils — la lecture y reprend par le
        // filet de [programmerReprise] — mais cela cesse de faire passer une limite pour un accident.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        val gestionnaire = getSystemService(ConnectivityManager::class.java) ?: return
        val rappel = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(reseau: Network) {
                val nouveau = reseau.toString()
                if (!changementUtile(estUtilisable = true, memeReseauQuAvant = nouveau == dernierReseau)) return
                dernierReseau = nouveau
                view.post {
                    val (etat, reprendre) = surRetourReseau(EtatReprises(reprisesReseau, repriseEnAttente != null))
                    reprisesReseau = etat.utilisees
                    if (!reprendre) return@post
                    repriseEnAttente?.let { view.removeCallbacks(it) }
                    repriseEnAttente = null
                    controller?.prepare()
                }
            }
        }
        runCatching { gestionnaire.registerDefaultNetworkCallback(rappel) }.onSuccess { rappelReseau = rappel }
    }

    /**
     * Le repli après un échec, en deux marches et non en une.
     *
     * Il n'y en avait qu'une : tout échec partait en conversion complète. C'était juste tant que la
     * lecture directe n'était retenue que sur un accord complet — un échec y désignait forcément le
     * décodeur. Le serveur la tente désormais sur un conteneur que nous n'avons pas déclaré ; un échec
     * y désigne d'abord le conteneur, et remplacer un remux — qui copie l'image au bit près — par un
     * transcodage complet serait le pire des dénouements sur un NAS modeste.
     *
     * La seconde marche n'est atteinte que si le remux échoue à son tour, et là c'est bien le décodeur
     * qui est en cause.
     */
    private fun convertir() {
        if (sessionMode == "direct" && !repliRemuxTente) {
            repliRemuxTente = true
            preparePlayback(remuxSeulement = true)
            return
        }
        compatibilityRetry = true
        preparePlayback(true)
    }

    /**
     * Ajoute au lecteur les commandes que le Web possède et qu'Android n'avait pas.
     *
     * Deux boutons posés par-dessus la vue plutôt qu'insérés dans la barre de Media3 : celle-ci se
     * masque d'elle-même après quelques secondes, et un réglage qu'on ne peut pas atteindre sans
     * réveiller les commandes ne sert à rien. Ils sont focalisables, donc accessibles à la
     * télécommande autant qu'au doigt.
     */
    /**
     * Installe nos commandes par-dessus l'image.
     *
     * Elles sont en Compose, comme le reste de l'application, et lisent le `Gabarit` : le téléviseur
     * obtient des cibles plus grandes et une indication de focus, le tactile non, sans qu'aucune
     * condition ne soit écrite ici.
     */
    private fun installerCommandes() {
        val gabarit = gabaritPour(
            (getSystemService(android.content.Context.UI_MODE_SERVICE) as android.app.UiModeManager)
                .currentModeType == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION,
            resources.configuration.screenWidthDp,
        )
        val couche = ComposeView(this).apply {
            setContent {
                CompositionLocalProvider(LocalGabarit provides gabarit) {
                    // La couche est toujours composee : c'est elle qui capte le double tape, y compris
                    // quand la garniture s'est retiree — moment ou le geste sert le plus.
                    if (!enImageDansImage) {
                        CommandesLecteur(etatLecteur, actionsLecteur, garnitureVisible = commandesVisibles)
                    }
                }
            }
        }
        racine.addView(couche, FrameLayout.LayoutParams(-1, -1))
        // Le focus appartient à la couche des commandes, pas à l'image.
        //
        // `PlayerView` est focusable par défaut et se trouve dessous : c'est elle qui recevait le
        // focus, et la croix directionnelle ne pouvait donc atteindre aucun bouton. Le parcours au
        // focus de Compose ne commence que si la vue qui l'héberge le détient.
        view.isFocusable = false
        view.isFocusableInTouchMode = false
        couche.isFocusable = true
        couche.isFocusableInTouchMode = true
        couche.descendantFocusability = FrameLayout.FOCUS_AFTER_DESCENDANTS
        couche.requestFocus()
        // L'image seule ne réagit à rien : sans cela, une barre masquée ne pourrait plus revenir.
        view.setOnClickListener { reveillerCommandes() }
        // Un rafraîchissement plus rapide que la seconde : la barre suit la lecture sans saccade
        // visible, et le coût reste celui de quelques lectures d'entiers.
        lifecycleScope.launch {
            while (isActive) {
                delay(250)
                rafraichirEtat()
            }
        }
        reveillerCommandes()
    }

    /**
     * Relit l'état du lecteur et le traduit en temps de film.
     *
     * C'est le seul endroit où la traduction a lieu pour l'affichage : la barre reçoit des secondes
     * déjà justes et ignore qu'une conversion est en cours.
     */
    private fun rafraichirEtat() {
        val lecteur = controller ?: return
        val dureeSecondes = dureeAffichee(fenetre, lecteur.duration.coerceAtLeast(0)) / 1000.0
        // Fin de ce que le serveur a produit, exprimée dans le film : le décalage de la session plus
        // la durée du flux. En lecture directe les deux se confondent avec la durée, et la mention
        // disparaît d'elle-même.
        val finEncodee = if (lecteur.duration > 0) fenetre.decalageSecondes + lecteur.duration / 1000.0 else 0.0
        val chapitres = infosFlux?.optJSONArray("chapters")?.let { tableau ->
            (0 until tableau.length()).map { tableau.getJSONObject(it).optDouble("startSeconds", -1.0) }
                .filter { it >= 0 }
        }.orEmpty()
        val position = tempsFilm(lecteur.currentPosition / 1000.0, fenetre)
        annoncerAuGenerique(position, dureeSecondes)
        etatLecteur = etatLecteur.copy(
            titre = intent.getStringExtra(EXTRA_TITLE) ?: etatLecteur.titre,
            mode = sessionMode,
            enLecture = lecteur.isPlaying,
            passerGeneriqueVisible = introSecondes?.let { !introEcartee && position >= it.start && position < it.endInclusive - 1 } == true,
            positionSecondes = position,
            dureeSecondes = dureeSecondes,
            tamponSecondes = tempsFilm(lecteur.bufferedPosition / 1000.0, fenetre),
            finEncodeeSecondes = finEncodee,
            chapitres = chapitres,
            vitesse = lecteur.playbackParameters.speed,
            minuteurMinutes = minuteurMinutes,
            plageDisponible = plagesProposees(formatSourceHdr, formatsHdrAppareil, coucheBaseHdr, prioritePlageGlobale).isNotEmpty(),
            imageDansImage = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK),
            lignesInfos = if (infoVisible) lignesInfos() else emptyList(),
            // Recalculées seulement quand le panneau est déplié : parcourir les groupes de pistes
            // quatre fois par seconde pour un panneau fermé serait du travail pur perte.
            pistesAudio = if (etatLecteur.pistesOuvertes) pistesDisponibles(C.TRACK_TYPE_AUDIO) else emptyList(),
            pistesSousTitres = if (etatLecteur.pistesOuvertes) pistesDisponibles(C.TRACK_TYPE_TEXT) else emptyList(),
            sousTitresDesactives = lecteur.currentTracks.groups.none {
                it.type == C.TRACK_TYPE_TEXT && (0 until it.length).any { rang -> it.isTrackSelected(rang) }
            },
        )
    }

    /**
     * Montre la barre, et programme sa disparition.
     *
     * Une barre permanente masque le bas de l'image, une barre qui ne revient pas rend le lecteur
     * inutilisable : le compte à rebours repart à chaque geste, et ne court pas tant que les infos
     * sont ouvertes — on les lit, on ne les manipule pas.
     */
    private fun reveillerCommandes() {
        if (!commandesVisibles) parcoursCommandes = false
        commandesVisibles = true
        masquage?.cancel()
        masquage = lifecycleScope.launch {
            delay(4_000)
            // Un panneau ouvert se lit, il ne se manipule pas en quatre secondes : ni « Infos
            // lecture » ni la liste des pistes ne doivent disparaître sous les yeux de qui les
            // parcourt. Le compte à rebours reprend dès qu'ils se referment.
            if (infoVisible || etatLecteur.pistesOuvertes) return@launch
            // Le plein ecran est retabli **meme si la lecture n'a pas demarre**.
            //
            // Accroche a `isPlaying`, il ne se declenchait jamais quand la preparation echouait : les
            // commandes restaient affichees, donc les barres systeme aussi, pendant tout le temps ou
            // l'on attendait une image qui ne venait pas. C'est exactement le moment ou l'ecran doit
            // rester propre — on regarde un message d'erreur, pas une horloge et trois boutons.
            enterFullScreen()
            if (controller?.isPlaying == true) masquerCommandes()
        }
    }

    /**
     * Une piste Dolby Vision ouverte comme simple HEVC ne déclenche que sa couche HDR de base.
     *
     * C'est une lecture « réussie » du point de vue du décodeur — aucune erreur ne provoque notre
     * repli — mais le téléviseur affiche HDR10/HDR10+ Adaptive. Quand la chaîne a confirmé Dolby
     * Vision, on tente une seule fois le remux fMP4/HLS : il conserve les octets vidéo tout en
     * exposant explicitement le codec DV à Media3. La vidéo n'est jamais réencodée.
     */
    private fun garantirPisteDolbyVision(tracks: Tracks): Boolean {
        if (formatSourceHdr != "dolbyvision" || "dolbyvision" !in formatsHdrAppareil
            || derniereSession?.outputDynamicRange != "dolbyvision" || sessionMode != "direct" || repliRemuxTente) return false
        val format = tracks.groups.asSequence().filter { it.type == C.TRACK_TYPE_VIDEO }
            .flatMap { groupe -> (0 until groupe.length).asSequence().filter { groupe.isTrackSelected(it) }.map(groupe::getTrackFormat) }
            .firstOrNull() ?: return false
        if (pisteDolbyVisionReconnue(format.sampleMimeType, format.codecs)) return false
        repliRemuxTente = true
        preparePlayback(remuxSeulement = true)
        return true
    }

    /** Retire les commandes sans quitter la lecture, quel que soit le moyen d'entrée. */
    private fun masquerCommandes() {
        masquage?.cancel()
        parcoursCommandes = false
        commandesVisibles = false
        enterFullScreen()
    }

    /**
     * Navigation rapide commune au doigt, aux boutons et à la télécommande.
     *
     * Les appuis rapprochés partent tous de la même position et s'additionnent. Sans cela, une
     * télécommande qui répète sa touche plus vite que le rafraîchissement viserait trois fois la même
     * seconde au lieu d'avancer de trente secondes.
     */
    private fun sauterRapidement(cote: Int) {
        val suite = cumulerTape(
            serieNavigation,
            etatLecteur.positionSecondes,
            cote,
            SystemClock.elapsedRealtime(),
            pasSecondes = PAS_NAVIGATION_SECONDES,
        )
        serieNavigation = suite
        naviguerA(suite.cible)
        etatLecteur = etatLecteur.copy(sautSecondes = suite.cumul.toInt())
        effacementSaut?.cancel()
        effacementSaut = lifecycleScope.launch {
            delay(850)
            serieNavigation = null
            etatLecteur = etatLecteur.copy(sautSecondes = null)
        }
    }

    /** Les commandes du bas, reliées à ce que l'activité sait déjà faire. */
    private val actionsLecteur by lazy {
        ActionsLecteur(
            basculerLecture = {
                controller?.let {
                    if (it.isPlaying) it.pause() else {
                        getSharedPreferences("playback", MODE_PRIVATE).edit {
                            putInt("autoplayCount:$profileId", 0)
                        }
                        it.play()
                    }
                }
            },
            // La navigation passe par le lecteur traduit : c'est lui qui décide entre un déplacement
            // dans la fenêtre encodée et une relance de session à la position visée.
            naviguer = { cible ->
                serieNavigation = null
                naviguerA(cible)
            },
            sauter = ::sauterRapidement,
            fermer = { finish() },
            episodePrecedent = { changerEpisode("previous") },
            episodeSuivant = { changerEpisode("next") },
            passerGenerique = ::passerGenerique,
            ouvrirInfos = { basculerInfos() },
            ouvrirPistes = { basculerPistes() },
            choisirAudio = { cle -> choisirPiste(C.TRACK_TYPE_AUDIO, cle) },
            choisirSousTitre = { cle -> choisirPiste(C.TRACK_TYPE_TEXT, cle) },
            choisirTailleSousTitres = { actualiserStyleSousTitres(taille = it) },
            choisirFondSousTitres = { actualiserStyleSousTitres(fond = it) },
            choisirCouleurSousTitres = { actualiserStyleSousTitres(couleur = it) },
            ouvrirQualite = { ouvrirChoixQualite() },
            ouvrirPlage = { ouvrirChoixPlage() },
            ouvrirVitesse = { ouvrirChoixVitesse() },
            ouvrirMinuteur = { ouvrirChoixMinuteur() },
            imageDansImage = { demanderImageDansImage() },
            reessayer = { preparePlayback(compatibilityRetry) },
            modeCompatible = {
                compatibilityRetry = true
                preparePlayback(true)
            },
            lireSuivantMaintenant = { demarrerEpisodeEnAttente() },
            annulerEpisodeSuivant = { annulerEnchainement(remettreCompteur = true) },
            reveiller = { reveillerCommandes() },
            basculerCommandes = {
                when {
                    infoVisible || etatLecteur.pistesOuvertes -> fermerPanneaux()
                    commandesVisibles -> masquerCommandes()
                    else -> reveillerCommandes()
                }
            },
        )
    }

    /**
     * Les touches de la télécommande, avant tout le reste.
     *
     * Le lecteur ne répondait à aucune : la barre n'est composée que lorsqu'elle est visible, et la
     * seule chose qui la réveillait était un appui tactile. Sur un téléviseur il n'y a pas de doigt,
     * donc jamais de barre, donc rien de focusable — la croix directionnelle appuyait dans le vide.
     *
     * La règle vit dans `gesteTelecommande`, vérifiable sans appareil. Le transport est immédiat :
     * gauche/droite naviguent, OK alterne lecture/pause. Haut/bas entre dans les options focalisables ;
     * la croix et OK sont alors rendus à Compose afin que chaque réglage reste accessible.
     *
     * Toute touche relance en outre le compte à rebours d'effacement : lire un titre en parcourant
     * les commandes ne doit pas voir la barre disparaître sous le curseur.
     *
     * `RestrictedApi` est écarté à dessein. La restriction porte sur `androidx.core.app.ComponentActivity`,
     * qui redéfinit `dispatchKeyEvent` pour sa propre tuyauterie `KeyEventDispatcher` et se réserve
     * l'appel entre bibliothèques du même groupe. Redéfinir cette méthode dans une activité reste le
     * moyen prévu par Android d'intercepter une touche avant l'arbre de vues, et l'appel à `super` est
     * précisément ce qui laisse cette tuyauterie faire son travail sur ce qu'on n'intercepte pas :
     * l'éviter serait le vrai défaut.
     */
    @SuppressLint("RestrictedApi")
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(event)
        val panneauOuvert = infoVisible || etatLecteur.pistesOuvertes
        return when (gesteTelecommande(event.keyCode, commandesVisibles, panneauOuvert, parcoursCommandes)) {
            GesteTelecommande.FERMER_PANNEAU -> { fermerPanneaux(); true }
            GesteTelecommande.MASQUER -> { masquerCommandes(); true }
            GesteTelecommande.REVEILLER -> { reveillerCommandes(); true }
            GesteTelecommande.PARCOURIR_COMMANDES -> {
                parcoursCommandes = true
                reveillerCommandes()
                super.dispatchKeyEvent(event)
            }
            GesteTelecommande.RECULER -> {
                reveillerCommandes()
                actionsLecteur.sauter(-1)
                true
            }
            GesteTelecommande.AVANCER -> {
                reveillerCommandes()
                actionsLecteur.sauter(1)
                true
            }
            GesteTelecommande.BASCULER_LECTURE -> { reveillerCommandes(); actionsLecteur.basculerLecture(); true }
            GesteTelecommande.LIRE -> {
                reveillerCommandes()
                if (controller?.isPlaying != true) actionsLecteur.basculerLecture()
                true
            }
            GesteTelecommande.PAUSE -> { reveillerCommandes(); controller?.pause(); true }
            GesteTelecommande.LAISSER -> {
                // Le retour et le volume ne nous regardent pas ; le reste relance seulement le compte
                // à rebours, puis suit son chemin ordinaire.
                if (event.keyCode != KeyEvent.KEYCODE_BACK && commandesVisibles) reveillerCommandes()
                super.dispatchKeyEvent(event)
            }
        }
    }

    /**
     * Change la vitesse de lecture, aux mêmes crans que le Web.
     *
     * Media3 conserve la hauteur du son sur toute cette plage : au-delà, la voix devient inintelligible
     * et le réglage cesse de servir à quoi que ce soit.
     */
    private fun ouvrirChoixVitesse() {
        val crans = listOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)
        AlertDialog.Builder(this).setTitle(getString(R.string.lecteur_vitesse))
            .setItems(crans.map { if (it == it.toInt().toFloat()) "${it.toInt()}×" else "${it}×" }.toTypedArray()) { _, choix ->
                controller?.playbackParameters = PlaybackParameters(crans[choix])
                reveillerCommandes()
            }
            .setNegativeButton(getString(R.string.action_annuler), null).show()
    }

    /**
     * Arrête la lecture au bout d'un temps donné.
     *
     * Le minuteur met en pause plutôt que de fermer le lecteur : quelqu'un qui s'endort veut retrouver
     * son film où il l'a laissé, pas revenir à l'accueil.
     */
    private fun ouvrirChoixMinuteur() {
        val crans = listOf(0, 15, 30, 45, 60)
        val libelles = crans.map { if (it == 0) getString(R.string.lecteur_minuteur_aucun) else "$it min" }
        AlertDialog.Builder(this).setTitle(getString(R.string.lecteur_minuteur))
            .setItems(libelles.toTypedArray()) { _, choix ->
                minuteur?.cancel()
                minuteurMinutes = crans[choix]
                if (minuteurMinutes > 0) {
                    minuteur = lifecycleScope.launch {
                        delay(minuteurMinutes * 60_000L)
                        controller?.pause()
                        minuteurMinutes = 0
                        Toast.makeText(this@PlayerActivity, getString(R.string.lecteur_minuteur_ecoule), Toast.LENGTH_LONG).show()
                    }
                }
                reveillerCommandes()
            }
            .setNegativeButton(getString(R.string.action_annuler), null).show()
    }

    private fun demanderImageDansImage() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build())
        }
    }

    /** Passe à l'épisode voisin sans repasser par la fiche, comme les flèches du lecteur Web. */
    private fun changerEpisode(sens: String) {
        lifecycleScope.launch {
            val voisin = runCatching { api.playbackNeighbors(mediaId, profileId).optJSONObject(sens) }.getOrNull()
            if (voisin == null) {
                Toast.makeText(this@PlayerActivity, getString(R.string.lecteur_pas_d_episode), Toast.LENGTH_SHORT).show()
                return@launch
            }
            appliquerContexteMedia(voisin)
            mediaId = voisin.getString("id")
            compatibilityRetry = false
            reprise = decisionReprise(null, voisin.optInt("progressPercent"), "continue",
                intentSecondes = voisin.optDouble("progressPositionSeconds").takeIf { voisin.has("progressPositionSeconds") },
                intentDureeSecondes = voisin.optDouble("progressDurationSeconds").takeIf { voisin.has("progressDurationSeconds") })
            preparePlayback()
        }
    }

    /**
     * Applique l'apparence sans recréer la session ni toucher au flux vidéo/audio. Les styles ASS
     * intégrés sont volontairement neutralisés quand l'utilisateur choisit son rendu : sinon la
     * couleur ou la taille du fichier reprendrait la main et le réglage semblerait ne pas fonctionner.
     */
    private fun actualiserStyleSousTitres(
        taille: String = etatLecteur.tailleSousTitres,
        fond: Boolean = etatLecteur.fondSousTitres,
        couleur: String = etatLecteur.couleurSousTitres,
    ) {
        etatLecteur = etatLecteur.copy(tailleSousTitres = taille, fondSousTitres = fond, couleurSousTitres = couleur)
        getSharedPreferences("subtitle-style", MODE_PRIVATE).edit {
            putString("size:$profileId", taille)
            putBoolean("background:$profileId", fond)
            putString("color:$profileId", couleur)
        }
        appliquerStyleSousTitres()
    }

    private fun appliquerStyleSousTitres() {
        if (!::view.isInitialized) return
        val avantPlan = when (etatLecteur.couleurSousTitres) {
            "yellow" -> android.graphics.Color.rgb(255, 228, 92)
            "cyan" -> android.graphics.Color.rgb(103, 232, 249)
            "green" -> android.graphics.Color.rgb(134, 239, 172)
            else -> android.graphics.Color.WHITE
        }
        val arrierePlan = if (etatLecteur.fondSousTitres) 0xC8000000.toInt() else android.graphics.Color.TRANSPARENT
        view.subtitleView?.apply {
            setApplyEmbeddedStyles(false)
            setApplyEmbeddedFontSizes(false)
            setFractionalTextSize(when (etatLecteur.tailleSousTitres) {
                "small" -> .043f
                "large" -> .069f
                else -> .0533f
            })
            setStyle(CaptionStyleCompat(
                avantPlan,
                arrierePlan,
                android.graphics.Color.TRANSPARENT,
                if (etatLecteur.fondSousTitres) CaptionStyleCompat.EDGE_TYPE_NONE else CaptionStyleCompat.EDGE_TYPE_OUTLINE,
                android.graphics.Color.BLACK,
                Typeface.DEFAULT,
            ))
        }
    }

    /** Met à jour le titre visible immédiatement lors d'un changement ou d'un enchaînement d'épisode. */
    /**
     * Ce que le bandeau du lecteur annonce.
     *
     * Il affichait « FlixTunes » pendant tout le film, et pas par accident : cette fonction reçoit la
     * réponse de `playback-info`, qui décrivait les flux sans jamais nommer le média. Le repli faute
     * de titre s'appliquait donc systématiquement, sauf après un enchaînement automatique — le
     * voisinage, lui, livre l'épisode complet. Le serveur nomme désormais le média des deux côtés.
     *
     * La mise en forme est celle du lecteur Web, qui reste la référence : la série en gras, puis le
     * numéro d'épisode et son titre en dessous. Elle vit dans [intituleLecteur].
     */
    private fun appliquerContexteMedia(media: org.json.JSONObject) {
        val intitule = intituleLecteur(
            titre = media.optString("title").takeIf { it.isNotBlank() },
            serie = media.optString("showTitle").takeIf { it.isNotBlank() },
            saison = media.optInt("seasonNumber", 0),
            episode = media.optInt("episodeNumber", 0),
        )
        intent.putExtra(EXTRA_TITLE, intitule.titre)
        etatLecteur = etatLecteur.copy(titre = intitule.titre, sousTitre = intitule.sousTitre)
    }

    /**
     * Choix manuel de la piste audio et des sous-titres.
     *
     * Le profil décide déjà à l'ouverture, et bien : c'est le cas courant. Mais un fichier annonce
     * parfois ses pistes de travers — langue absente, doublage marqué comme original — et sans recours
     * manuel il ne reste qu'à quitter le film. Le lecteur Web offre ce recours depuis l'étape 55.
     *
     * Les deux familles tiennent dans une seule liste, préfixées : deux boîtes successives
     * demanderaient un aller-retour pour un réglage qu'on ajuste souvent à tâtons.
     */
    /**
     * Déplie ou replie le panneau des pistes.
     *
     * Il remplace une liste modale du système, qui se fermait à chaque choix et ne montrait nulle part
     * ce qui était actif. Pendant un film on y revient plusieurs fois — comparer deux doublages,
     * remettre les sous-titres sur une réplique inaudible : rouvrir une liste pour découvrir ce qu'on
     * vient de faire est exactement ce qu'il faut éviter.
     */
    /** Referme ce qui est déplié, sans toucher à la lecture. */
    private fun fermerPanneaux() {
        if (infoVisible) basculerInfos()
        if (etatLecteur.pistesOuvertes) etatLecteur = etatLecteur.copy(pistesOuvertes = false)
        reveillerCommandes()
    }

    private fun basculerPistes() {
        val ouvrir = !etatLecteur.pistesOuvertes
        etatLecteur = etatLecteur.copy(pistesOuvertes = ouvrir)
        if (ouvrir && controller?.currentTracks == null) {
            Toast.makeText(this, getString(R.string.lecteur_pistes_indisponibles), Toast.LENGTH_SHORT).show()
        }
        reveillerCommandes()
    }

    /**
     * Les pistes d'un type, telles que le lecteur les voit **maintenant**.
     *
     * `active` est relu à chaque rafraîchissement plutôt que retenu localement : le lecteur change
     * parfois de piste sans qu'on le lui demande — au démarrage, quand il applique la préférence du
     * profil, ou après une renégociation de session — et un panneau qui garderait son propre souvenir
     * afficherait alors le contraire de ce qui s'entend.
     */
    private fun pistesDisponibles(type: Int): List<PisteChoix> {
        val tracks = controller?.currentTracks ?: return emptyList()
        val liste = mutableListOf<PisteChoix>()
        for ((rangGroupe, groupe) in tracks.groups.withIndex()) {
            if (groupe.type != type) continue
            for (rang in 0 until groupe.length) {
                val format = groupe.getTrackFormat(rang)
                val langue = format.language?.takeIf { it.isNotBlank() }?.let(::langueLisible)
                    ?: getString(R.string.lecteur_langue_inconnue)
                val detail = if (type == C.TRACK_TYPE_AUDIO) {
                    listOfNotNull(
                        format.codecs?.takeIf { it.isNotBlank() }?.uppercase(),
                        canauxLisibles(format.channelCount),
                    ).joinToString(" · ")
                } else {
                    listOfNotNull(
                        if (format.selectionFlags and C.SELECTION_FLAG_FORCED != 0)
                            getString(R.string.lecteur_sous_titre_forcee).trim() else null,
                    ).joinToString(" · ")
                }
                liste += PisteChoix("$rangGroupe:$rang", langue, detail, groupe.isTrackSelected(rang))
            }
        }
        return liste
    }

    /**
     * Applique une piste, sans interrompre la lecture.
     *
     * Une clé nulle coupe la famille entière — c'est ainsi qu'on désactive les sous-titres. Le
     * remplacement porte sur le type demandé seulement : choisir un sous-titre ne doit pas défaire la
     * piste audio en cours.
     *
     * En lecture directe, le serveur sert le fichier entier et toutes les pistes sont là : le
     * changement est immédiat. En conversion il n'en sert qu'une, et la liste ne propose alors qu'elle
     * — ce que le panneau montre honnêtement plutôt que de promettre un choix qui n'existe pas.
     */
    private fun choisirPiste(type: Int, cle: String?) {
        val lecteur = controller ?: return
        val parametres = lecteur.trackSelectionParameters.buildUpon()
        if (cle == null) {
            parametres.setTrackTypeDisabled(type, true)
        } else {
            val rangs = cle.split(":").mapNotNull(String::toIntOrNull)
            val groupe = rangs.getOrNull(0)?.let { lecteur.currentTracks.groups.getOrNull(it) } ?: return
            val piste = rangs.getOrNull(1) ?: return
            parametres.setTrackTypeDisabled(type, false)
                .setOverrideForType(TrackSelectionOverride(groupe.mediaTrackGroup, piste))
        }
        lecteur.trackSelectionParameters = parametres.build()
        reveillerCommandes()
    }

    /** « 5.1 », « 2.0 » — le nombre de canaux tel qu'on l'annonce sur une jaquette. */
    private fun canauxLisibles(canaux: Int): String? = when {
        canaux >= 8 -> "7.1"
        canaux >= 6 -> "5.1"
        canaux == 2 -> "2.0"
        canaux == 1 -> "mono"
        else -> null
    }

    /** « fr » devient « Français » : c'est ce que le client Web affiche, et ce qu'on lit de loin. */
    private fun langueLisible(code: String): String =
        runCatching { java.util.Locale.forLanguageTag(code).getDisplayLanguage(java.util.Locale.getDefault()) }
            .getOrNull()?.takeIf { it.isNotBlank() && it != code }
            ?.replaceFirstChar { it.uppercase() }
            ?: code.uppercase()

    /** Les variantes du flux, telles que le manifeste les annonce, avec leur piste d'origine. */
    private fun variantesDisponibles(): List<Pair<Qualite, Pair<Tracks.Group, Int>>> {
        val tracks = controller?.currentTracks ?: return emptyList()
        val liste = mutableListOf<Pair<Qualite, Pair<Tracks.Group, Int>>>()
        for (groupe in tracks.groups) {
            if (groupe.type != C.TRACK_TYPE_VIDEO) continue
            for (rang in 0 until groupe.length) {
                val format = groupe.getTrackFormat(rang)
                liste += Qualite(liste.size, format.height.coerceAtLeast(0), format.bitrate.coerceAtLeast(0)) to
                    (groupe to rang)
            }
        }
        return liste
    }

    /**
     * Propose de conserver le HDR du fichier ou de le faire convertir en SDR.
     *
     * À la différence de la qualité, que le lecteur bascule seul entre deux variantes du même flux, la
     * plage dynamique se décide à la négociation : seul le serveur peut produire l'autre version. Il
     * faut donc redemander une session — et retenir où on en était, sinon le film repart du début.
     * C'est exactement ce que fait le lecteur Web, par le même chemin.
     */
    private fun ouvrirChoixPlage() {
        val proposees = plagesProposees(formatSourceHdr, formatsHdrAppareil, coucheBaseHdr, prioritePlageGlobale, formatsHdrSource)
        if (proposees.isEmpty()) {
            Toast.makeText(this, getString(R.string.lecteur_image_sdr), Toast.LENGTH_SHORT).show()
            return
        }
        val selection = proposees.indexOfFirst { it.cle == plageVoulue }.coerceAtLeast(0)
        val dialogue = AlertDialog.Builder(this).setTitle(getString(R.string.lecteur_image))
            .setSingleChoiceItems(proposees.map { it.libelle }.toTypedArray(), selection) { boite, choix ->
                val voulue = proposees[choix].cle
                if (voulue == plageVoulue) { boite.dismiss(); return@setSingleChoiceItems }
                plageVoulue = voulue
                val position = controller?.currentPosition?.let { it / 1000.0 } ?: 0.0
                boite.dismiss()
                relancerA(tempsFilm(position, fenetre))
            }
            .setNegativeButton(getString(R.string.action_annuler), null).create()
        dialogue.show()
    }

    private fun ouvrirChoixQualite() {
        val variantes = variantesDisponibles()
        val proposees = qualitesProposees(variantes.map { it.first })
        if (proposees.isEmpty()) {
            Toast.makeText(this, getString(R.string.lecteur_qualite_unique), Toast.LENGTH_SHORT).show()
            return
        }
        AlertDialog.Builder(this).setTitle(getString(R.string.lecteur_qualite))
            .setItems(proposees.map { it.libelle }.toTypedArray()) { _, choix ->
                val lecteur = controller ?: return@setItems
                val voulue = proposees[choix]
                lecteur.trackSelectionParameters = lecteur.trackSelectionParameters.buildUpon().apply {
                    // « Automatique » retire la contrainte : c'est l'absence de choix forcé, pas un
                    // choix de plus. La confondre avec une variante figerait la qualité sur la dernière.
                    if (voulue.index < 0) {
                        clearOverridesOfType(C.TRACK_TYPE_VIDEO)
                    } else {
                        variantes.firstOrNull { it.first.index == voulue.index }?.second?.let { (groupe, rang) ->
                            setOverrideForType(TrackSelectionOverride(groupe.mediaTrackGroup, rang))
                        }
                    }
                }.build()
            }.show()
    }

    private fun basculerInfos() {
        infoVisible = !infoVisible
        etatLecteur = etatLecteur.copy(infosOuvertes = infoVisible)
        reveillerCommandes()
    }

    /** L'état courant du panneau d'infos, dans les mots exacts du lecteur Web. */
    private fun lignesInfos(): List<LigneInfo> {
        val session = derniereSession
        val flux = infosFlux?.optJSONArray("streams")
            ?.let { tableau -> (0 until tableau.length()).map(tableau::getJSONObject) }.orEmpty()
        val video = flux.firstOrNull { it.optString("type") == "video" }
        val tampon = controller?.let { (it.bufferedPosition - it.currentPosition) / 1000.0 }?.coerceAtLeast(0.0)
        val sortie = session?.targetWidth?.let { largeur ->
            val debit = session.targetVideoBitrate?.takeIf { it > 0 }?.let { " · ${arrondiMbps(it)} Mb/s" }.orEmpty()
            "$largeur×${session.targetHeight ?: 0}$debit"
        }
        val libellePlage = { valeur: String? -> when (valeur) {
            "dolbyvision" -> "Dolby Vision"; "hdr10plus" -> "HDR10+"; "hdr10" -> "HDR10"; "hlg" -> "HLG"; "sdr" -> "SDR"
            else -> valeur
        } }
        val chainePlage = session?.let {
            val source = libellePlage(it.sourceDynamicRange); val sortiePlage = libellePlage(it.outputDynamicRange)
            if (source != null && sortiePlage != null && source != sortiePlage) "$source → $sortiePlage" else sortiePlage
        }
        val lignes = infosLecture(
            mode = session?.mode,
            conteneur = infosFlux?.optString("container"),
            codecVideo = video?.optString("codec"),
            resolutionSource = video?.let { "${it.optInt("width")}×${it.optInt("height")}" }?.takeIf { it != "0×0" },
            codecAudio = flux.firstOrNull { it.optString("type") == "audio" }?.optString("codec"),
            debitSourceBps = infosFlux?.optLong("overallBitRate")?.takeIf { it > 0 },
            tamponSecondes = tampon,
            imagesPerdues = PlaybackService.imagesPerdues,
            sortie = sortie,
            plageDynamique = chainePlage?.takeIf { it.isNotBlank() }
                ?: video?.optString("hdrFormat")?.takeIf { it.isNotBlank() && it != "sdr" } ?: "SDR",
            raisons = session?.decisionReasons.orEmpty(),
        )
        if (formatSourceHdr != "dolbyvision") return lignes
        val formatDecodeur = controller?.currentTracks?.groups?.asSequence()
            ?.filter { it.type == C.TRACK_TYPE_VIDEO }
            ?.flatMap { groupe -> (0 until groupe.length).asSequence().filter { groupe.isTrackSelected(it) }.map(groupe::getTrackFormat) }
            ?.firstOrNull()
        val pisteReconnue = formatDecodeur?.let { pisteDolbyVisionReconnue(it.sampleMimeType, it.codecs) } == true
        val profil = profilDolbyVisionSource?.let { "profil $it · " }.orEmpty()
        val signal = when {
            session?.outputDynamicRange != "dolbyvision" -> "$profil${libellePlage(session?.outputDynamicRange) ?: "repli compatible"} (repli explicite)"
            pisteReconnue && "hdr10plus" in formatsHdrSource ->
                "$profil Dolby Vision reconnu · HDR10+ concurrent retiré"
            pisteReconnue -> "$profil Dolby Vision reconnu par Media3"
            formatDecodeur != null -> "$profil${formatDecodeur.sampleMimeType ?: "HEVC"} · couche de base possible"
            else -> "$profil Dolby Vision demandé · piste en préparation"
        }
        return lignes + LigneInfo("Signal lecteur", signal)
    }

    /**
     * Redemande une session au serveur à partir de [secondesFilm].
     *
     * Appelé quand la cible sort de la fenêtre encodée. Le serveur sait démarrer un encodage à un
     * point donné ; c'est ce qui rend la navigation possible au-delà de ce qui est déjà produit —
     * exactement ce que fait le lecteur Web, et ce qu'Android ne demandait jamais.
     *
     * La position visée est retenue : la session repart à zéro de son côté, et sans cela le film
     * reprendrait au début de la nouvelle fenêtre au lieu du point demandé.
     */
    private fun relancerA(secondesFilm: Double) {
        val duree = fenetre.dureeReelleSecondes
        val cible = if (duree > 0) secondesFilm.coerceIn(0.0, duree - 1) else secondesFilm.coerceAtLeast(0.0)
        initialSeekApplied = true
        preparePlayback(compatibilityRetry, startSeconds = cible)
    }

    /**
     * Navigation absolue, avec réarmement du décodeur pour le seul cas qui perd le HDR : le direct.
     *
     * La surface vidéo est détachée pendant une image puis rattachée : Media3 renvoie au codec ses
     * informations de couleur (HDR10/HLG/HDR10+/Dolby Vision), sans arrêter le renderer audio ni
     * renégocier son passthrough Atmos. Sur SDR et sur les fenêtres serveur, le chemin ordinaire reste
     * strictement inchangé.
     */
    private fun naviguerA(secondesFilm: Double) {
        val cibleMs = (secondesFilm.coerceAtLeast(0.0) * 1000).toLong()
        val lecteur = controller ?: return
        if (!reinitialisationHdrApresSeek(sessionMode, formatSourceHdr)) {
            (view.player ?: lecteur).seekTo(cibleMs)
            return
        }
        initialSeekApplied = true
        val surfaceVideo = view.videoSurfaceView
        if (surfaceVideo == null) return lecteur.seekTo(cibleMs)
        // `INVISIBLE` détruit la Surface du `SurfaceView` sans toucher au Player : seul le chemin
        // vidéo se rattache à l'image suivante, tandis que l'audio continue sur la même session.
        surfaceVideo.visibility = View.INVISIBLE
        lecteur.seekTo(cibleMs)
        surfaceVideo.postOnAnimation { surfaceVideo.visibility = View.VISIBLE }
    }

    /** Dire ce qui s'est passé plutôt que « lecture impossible » : la suite à donner n'est pas la même. */
    private fun messageAbandon(error: PlaybackException): String =
        if (error.errorCode in ERREURS_RESEAU until ERREURS_ANALYSE)
            getString(R.string.lecteur_erreur_reseau)
        else getString(R.string.lecteur_erreur_decodage)

    /**
     * Demande à l'écran la fréquence qui tombe juste avec la cadence du film.
     *
     * Sans cela, un film à 23,976 images par seconde affiché sur un panneau à 60 Hz montre une image
     * pendant trois rafraîchissements puis la suivante pendant deux : les mouvements lents avancent par
     * à-coups. C'est le défaut de fluidité le plus visible de toute la chaîne, et le seul qu'aucune
     * augmentation de débit ne corrige.
     *
     * Le choix lui-même est dans [chooseDisplayMode], vérifiable hors appareil. Ici ne reste que la
     * demande au système — et le soin de ne rien demander quand rien ne convient : chaque changement de
     * mode renégocie le HDMI, ce qui noircit l'écran une à deux secondes.
     */
    private fun accorderCadenceEcran(contentFps: Double) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || contentFps <= 0.0) return
        val display = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) display else windowManager.defaultDisplay
        val actif = display?.mode ?: return
        val vers = { m: android.view.Display.Mode ->
            DisplayModeInfo(m.modeId, m.physicalWidth, m.physicalHeight, m.refreshRate.toDouble())
        }
        val choisi = chooseDisplayMode(display.supportedModes.map(vers), vers(actif), contentFps) ?: return
        window.attributes = window.attributes.apply { preferredDisplayModeId = choisi.id }
    }

    /**
     * Signale au serveur que le codec annoncé n'a pas été décodé ici.
     *
     * Silencieux hors lecture directe : en conversion, l'échec vient du flux fabriqué par le serveur,
     * et accuser le codec d'origine priverait l'appareil d'une lecture directe qui, elle, fonctionne.
     */
    private fun reportCodecFailure(error: PlaybackException) {
        val codec = directVideoCodec ?: return
        if (sessionMode != "direct") return
        val raison = "Lecture directe interrompue par le lecteur (${error.errorCodeName})"
        lifecycleScope.launch { api.reportCodecFailure(DeviceIdentity.get(this@PlayerActivity), codec, raison) }
    }

    /**
     * Arme le démenti de quarantaine, qui ne partira que si la lecture tient.
     *
     * Le web fait la même chose en mesurant les images perdues sur plusieurs fenêtres. Ici la mesure
     * n'est pas accessible depuis un `MediaController`, et l'attente en tient lieu : ce qu'il faut
     * empêcher est l'ordre « démenti puis échec », qui remet le compteur à zéro avant qu'il ne compte.
     */
    private fun armerDementiCodec() {
        if (sessionMode != "direct" || codecSuccessReported || dementiEnAttente != null) return
        val tache = Runnable { dementiEnAttente = null; reportCodecSuccess() }
        dementiEnAttente = tache
        view.postDelayed(tache, DELAI_DEMENTI_MS)
    }

    /** Annule un démenti non parti : la lecture n'a pas tenu, il n'y a rien à démentir. */
    private fun annulerDementiCodec() {
        dementiEnAttente?.let { view.removeCallbacks(it) }
        dementiEnAttente = null
    }

    /** Dément une quarantaine une fois la lecture établie : une seule fois, comme sur le web. */
    private fun reportCodecSuccess() {
        val codec = directVideoCodec ?: return
        if (sessionMode != "direct" || codecSuccessReported) return
        codecSuccessReported = true
        lifecycleScope.launch { api.reportCodecSuccess(DeviceIdentity.get(this@PlayerActivity), codec) }
    }

    /**
     * Prépare une session, et **une seule à la fois**.
     *
     * L'annulation de la préparation précédente n'est pas une optimisation, c'est la correction d'une
     * fuite. Rien ne protégeait cette fonction de la ré-entrée : deux avances rapprochées lançaient
     * deux coroutines, la seconde remettait `playbackSessionId` à zéro avant que la première ait
     * assigné le sien, et la session de la première devenait introuvable. Elle gardait alors son
     * créneau de conversion — le serveur répondait « limite de 2 conversions simultanées atteinte »
     * pour un film qu'on venait de quitter — et personne ne pouvait plus l'arrêter, pas même
     * [onDestroy], qui ne connaît que le dernier identifiant.
     */
    private fun preparePlayback(forceCompatible: Boolean = false, startSeconds: Double = 0.0,
        remuxSeulement: Boolean = false): Job {
        annulerEnchainement(remettreCompteur = false)
        preparation?.cancel()
        commandesVisibles = true
        masquage?.cancel()
        etatLecteur = etatLecteur.copy(chargement = true, erreur = null)
        val job = lifecycleScope.launch { preparerSession(forceCompatible, startSeconds, remuxSeulement) }
        preparation = job
        return job
    }

    private suspend fun preparerSession(forceCompatible: Boolean, startSeconds: Double, remuxSeulement: Boolean) {
        runCatching {
            playbackSessionId?.let { runCatching { api.stopPlayback(it) } }; playbackSessionId = null
            val playbackInfo = api.playbackInfo(mediaId, profileId)
            appliquerContexteMedia(playbackInfo)
            val voisins = runCatching { api.playbackNeighbors(mediaId, profileId) }.getOrNull()
            voisinSuivant = voisins?.optJSONObject("next")
            etatLecteur = etatLecteur.copy(
                episodePrecedent = voisins?.optJSONObject("previous") != null,
                episodeSuivant = voisinSuivant != null,
            )
            // Les deux marqueurs de générique, calculés par le serveur à partir des chapitres du
            // fichier : une seule lecture des intitulés pour le Web comme pour Android.
            debutGeneriqueSecondes = playbackInfo.optDouble("creditsStartSeconds", -1.0).takeIf { it >= 0 }
            introSecondes = playbackInfo.optJSONObject("intro")?.let { bloc ->
                val debut = bloc.optDouble("startSeconds", -1.0)
                val fin = bloc.optDouble("endSeconds", -1.0)
                if (debut >= 0 && fin > debut) debut..fin else null
            }
            trueDurationMs = (playbackInfo.optDouble("durationSeconds", 0.0) * 1000).toLong().coerceAtLeast(0)
            infosFlux = playbackInfo
            val fluxVideo = playbackInfo.optJSONArray("streams")?.let { streams ->
                (0 until streams.length()).map(streams::getJSONObject).firstOrNull { it.optString("type") == "video" }
            }
            directVideoCodec = fluxVideo?.optString("codec")?.takeIf { it.isNotBlank() }
            formatSourceHdr = fluxVideo?.optString("hdrFormat")?.takeIf { it.isNotBlank() }
            formatsHdrSource = fluxVideo?.optJSONArray("availableHdrFormats")?.let { formats ->
                (0 until formats.length()).mapNotNull { index -> formats.optString(index).takeIf(String::isNotBlank) }
            }.orEmpty()
            val couleur = fluxVideo?.optJSONObject("color")
            val profilDolby = couleur?.optInt("dolbyVisionProfile", -1)?.takeIf { it > 0 }
                ?: fluxVideo?.optInt("dolbyVisionProfile", -1)?.takeIf { it > 0 }
            profilDolbyVisionSource = profilDolby
            val compatibiliteDolby = couleur?.optInt("dolbyVisionBlCompatibilityId", -1)?.takeIf { it >= 0 }
            coucheBaseHdr = if (formatSourceHdr == "dolbyvision") coucheBaseDolbyVision(profilDolby, compatibiliteDolby) else null
            // Où faire commencer l'encodage. Demander la session au point de reprise évite au serveur
            // d'encoder un début que personne ne regardera, puis de tout relancer au premier saut.
            val depart = departDemande(startSeconds, reprise, trueDurationMs / 1000.0,
                intent.getIntExtra(EXTRA_RESUME_REWIND, 5))
            val capacites = DeviceCapabilities.create(this@PlayerActivity, forceTranscode = forceCompatible,
                preferredAudioLanguages = preferredAudioLanguages, audioOutputMode = intent.getStringExtra(EXTRA_AUDIO_OUTPUT) ?: "auto",
                audioNormalization = intent.getBooleanExtra(EXTRA_AUDIO_NORMALIZATION, false), nightMode = intent.getBooleanExtra(EXTRA_NIGHT_MODE, false),
                startSeconds = depart, plageDynamique = if (plageVoulue == "auto") prioritePlageGlobale else plageVoulue,
                remuxSeulement = remuxSeulement, sourceDolbyVisionProfile = profilDolby,
                sourceWidth = fluxVideo?.optInt("width")?.takeIf { it > 0 }, sourceHeight = fluxVideo?.optInt("height")?.takeIf { it > 0 })
            formatsHdrAppareil = capacites.optJSONArray("hdrFormats")?.let { a ->
                (0 until a.length()).map(a::getString)
            }.orEmpty()
            val session = api.startPlayback(mediaId, capacites, profileId)
            // Une préparation dépassée par une autre ne doit pas laisser sa session derrière elle : le
            // serveur la libère aussi de son côté, mais le dire ici la rend disponible tout de suite.
            if (!coroutineContext.isActive) {
                withContext(NonCancellable) { runCatching { api.stopPlayback(session.id ?: "") } }
                return
            }
            if (session.status == "failed" || session.url == null) error(session.error ?: getString(R.string.lecteur_erreur_impossible))
            playbackSessionId = session.id
            sessionMode = session.mode
            derniereSession = session
            fenetre = FenetreLecture(session.startOffsetSeconds, trueDurationMs / 1000.0)
            // Sert la préférence « langue originale » : sans elle, le lecteur ne peut pas distinguer
            // la piste d'origine d'un doublage dans la même langue.
            langueOriginale = playbackInfo.optString("originalLanguage").takeIf { it.isNotBlank() }
            accorderCadenceEcran(fluxVideo?.optDouble("frameRate", 0.0) ?: 0.0)
            // Toute perte de format est annoncée avant que l'image ne démarre, sur tous les clients.
            session.colorLossNotice?.let { Toast.makeText(this@PlayerActivity, it, Toast.LENGTH_LONG).show() }
            controller?.apply {
                // Un master hybride porte à la fois RPU Dolby Vision et SEI HDR10+. Certains boîtiers
                // privilégient ces derniers malgré le codec DV reconnu par Media3. En Direct Play DV,
                // le codec neutralise uniquement ces SEI concurrents ; l'image HEVC et le RPU restent
                // strictement ceux du fichier. Astérix, dépourvu de HDR10+, traverse sans modification.
                // Scanner le flux DV direct est sûr même quand le serveur ancien n'a pas encore
                // inscrit HDR10+ dans `availableHdrFormats` : Astérix ne contient aucune signature
                // concurrente et traverse donc octet pour octet. Cette condition trop stricte était
                // précisément ce qui laissait Lucky intact sur certaines bibliothèques déjà scannées.
                HdrDirectPlayPreference.neutraliserHdr10PlusPourDolbyVision =
                    filtrerHdr10PlusPourDolbyVisionDirect(session.mode, session.outputDynamicRange)
                stop()
                clearMediaItems()
                // La session part déjà au point voulu : rejouer le saut de reprise ramènerait au
                // point d'origine à chaque relance, et une avance se serait annulée d'elle-même.
                // Le fichier direct commence à zéro, la fenêtre serveur à son offset : dans les deux
                // cas Media3 reçoit dès maintenant la position *dans le flux*. R42 posait toujours
                // zéro tout en marquant le seek comme appliqué, d'où un Play qui restait au début.
                val positionInitialeFluxMs = ((depart - session.startOffsetSeconds).coerceAtLeast(0.0) * 1000).toLong()
                initialSeekApplied = depart > 0.0
                val subtitleConfigurations = buildList {
                    val streams = playbackInfo.optJSONArray("streams")
                    if (streams != null) for (index in 0 until streams.length()) {
                        val stream = streams.getJSONObject(index)
                        if (stream.optString("type") != "subtitle" || !stream.optBoolean("canExtractAsWebVtt")) continue
                        val streamIndex = stream.getInt("index")
                        add(MediaItem.SubtitleConfiguration.Builder(Uri.parse(
                            api.subtitleUrl(mediaId, streamIndex, profileId, offsetSeconds = -session.startOffsetSeconds)))
                            .setMimeType(MimeTypes.TEXT_VTT).setLanguage(stream.optString("language", "und"))
                            .setLabel(stream.optString("title").ifBlank { stream.optString("language", getString(R.string.lecteur_sous_titres)) })
                            .setSelectionFlags(if (stream.optBoolean("isForced")) C.SELECTION_FLAG_FORCED else 0).build())
                    }
                    val external = playbackInfo.optJSONArray("externalSubtitles")
                    if (external != null) for (index in 0 until external.length()) {
                        val subtitle = external.getJSONObject(index)
                        if (!subtitle.optBoolean("canConvertToWebVtt")) continue
                        add(MediaItem.SubtitleConfiguration.Builder(Uri.parse(
                            api.subtitleUrl(mediaId, subtitle.getInt("id"), profileId, external = true,
                                offsetSeconds = -session.startOffsetSeconds)))
                            .setMimeType(MimeTypes.TEXT_VTT).setLanguage(subtitle.optString("language", "und"))
                            .setLabel(subtitle.optString("name", getString(R.string.lecteur_sous_titres_externes)))
                            .setSelectionFlags(if (subtitle.optBoolean("forced")) C.SELECTION_FLAG_FORCED else 0).build())
                    }
                }
                /*
                 * Les sous-titres suivent la fenêtre encodée, et c'est indispensable après un saut.
                 *
                 * Quand la cible sort de la fenêtre, le serveur ouvre une session qui démarre au temps
                 * `startOffsetSeconds` du film : l'instant 0 du flux vaut donc ce temps-là. Les
                 * sous-titres du fichier, eux, sont datés dans le temps du film. Demandés sans décalage
                 * — ce que faisait ce lecteur — ils arrivaient en retard d'exactement la position du
                 * saut, et le décalage grandissait à chaque avance.
                 *
                 * Le signe est celui d'`-itsoffset` côté serveur, qui repousse vers l'avant : ramener le
                 * temps du film au temps du flux demande donc l'opposé du décalage de fenêtre.
                 */
                val item = MediaItem.Builder().setUri(api.absolute(session.url)).setSubtitleConfigurations(subtitleConfigurations)
                if (session.url.endsWith(".m3u8", ignoreCase = true)) item.setMimeType(MimeTypes.APPLICATION_M3U8)
                if (session.url.endsWith(".mpd", ignoreCase = true)) item.setMimeType(MimeTypes.APPLICATION_MPD)
                // Départ au début du flux, et non au bord de la playlist.
                //
                // Tant que FFmpeg écrit, la playlist n'a pas d'`#EXT-X-ENDLIST` : Media3 la tient donc
                // pour un direct et démarre au bord moins trois segments. En conversion le défaut passe
                // inaperçu — deux ou trois segments existent quand le client charge le manifeste, le
                // bord est près de zéro. En remux, FFmpeg copie à plusieurs dizaines de fois le temps
                // réel : entre l'apparition du manifeste et sa lecture, une à deux minutes de playlist
                // sont déjà écrites, et le film démarrait donc loin après son début.
                //
                // La position fournie est celle du *flux* : zéro pour une fenêtre serveur déjà
                // décalée, la seconde exacte pour le fichier direct. La poser avant `prepare()` évite
                // une première image à zéro et initialise immédiatement le renderer dans le bon HDR.
                setMediaItem(item.setMediaMetadata(
                    MediaMetadata.Builder().setTitle(intent.getStringExtra(EXTRA_TITLE) ?: "FlixTunes").build(),
                ).build(), positionInitialeFluxMs)
                prepare()
                playbackParameters = PlaybackParameters(intent.getFloatExtra(EXTRA_PLAYBACK_RATE, 1f).coerceIn(.5f, 2f))
                play()
            }
        }.onFailure { failure ->
            // Une préparation annulée est remplacée par la suivante : ce n'est pas une panne à montrer.
            if (failure is CancellationException) throw failure
            controller?.pause()
            commandesVisibles = true
            masquage?.cancel()
            etatLecteur = etatLecteur.copy(
                chargement = false,
                erreur = failure.message ?: getString(R.string.lecteur_erreur_impossible),
            )
        }
    }

    private fun persistProgress() {
        val player = controller ?: return
        val reference = referenceDurationMs(player.duration)
        if (reference > 0) lifecycleScope.launch {
            val positionFilm = tempsFilm(player.currentPosition / 1000.0, fenetre)
                .coerceAtMost(reference / 1000.0)
            runCatching { api.saveProgress(mediaId, profileId, positionFilm, reference / 1000.0) }
        }
    }

    /**
     * L'épisode suivant s'annonce dès le générique de fin, et non l'écran déjà noir.
     *
     * Le point vient des chapitres du fichier, lus par le serveur : 1 701 fichiers de la médiathèque
     * de référence en portent un, commençant en médiane à 97 % du film. Faute de chapitre nommé, rien
     * ne change — la carte reste posée à la fin, avec son décompte de dix secondes.
     *
     * Le **départ** ne bouge pas pour autant : il reste la fin du média. Enchaîner sur la jauge
     * couperait un générique que l'on regarde peut-être.
     */
    private fun annoncerAuGenerique(position: Double, dureeSecondes: Double) {
        if (enchainementEcarte || carteParGenerique) return
        val debut = debutGeneriqueSecondes ?: return
        val suivant = voisinSuivant ?: return
        if (dureeSecondes <= debut || position < debut) return
        if (!intent.getBooleanExtra(EXTRA_AUTOPLAY_NEXT, true)) return
        val compte = getSharedPreferences("playback", MODE_PRIVATE).getInt("autoplayCount:$profileId", 0)
        if (compte >= intent.getIntExtra(EXTRA_AUTOPLAY_LIMIT, 3)) return
        carteParGenerique = true
        episodeEnAttente = suivant
        compteurEnAttente = compte
        commandesVisibles = true
        masquage?.cancel()
        enchainement?.cancel()
        enchainement = lifecycleScope.launch {
            while (isActive) {
                val courante = tempsFilm((controller?.currentPosition ?: 0L) / 1000.0, fenetre)
                val restant = (dureeSecondes - courante).coerceAtLeast(0.0)
                etatLecteur = etatLecteur.copy(
                    autoplayRestantSecondes = kotlin.math.ceil(restant).toInt(),
                    autoplayTotalSecondes = kotlin.math.ceil(dureeSecondes - debut).toInt().coerceAtLeast(1),
                    autoplayTitre = suivant.optString("title").takeIf { it.isNotBlank() },
                    autoplaySousTitre = numeroEpisode(suivant.optInt("seasonNumber", 0), suivant.optInt("episodeNumber", 0)),
                )
                if (restant <= 0.0) { demarrerEpisodeEnAttente(); return@launch }
                delay(500)
            }
        }
    }

    /** Saute à la fin de l'introduction, et n'y revient plus. */
    private fun passerGenerique() {
        val intro = introSecondes ?: return
        introEcartee = true
        etatLecteur = etatLecteur.copy(passerGeneriqueVisible = false)
        naviguerA(intro.endInclusive)
    }

    private fun autoplayNext() {
        if (!intent.getBooleanExtra(EXTRA_AUTOPLAY_NEXT, true) || enchainementEcarte) return
        // La carte a déjà couru pendant tout le générique : elle finit son travail toute seule.
        if (carteParGenerique) return
        enchainement?.cancel()
        enchainement = lifecycleScope.launch {
            val preferences = getSharedPreferences("playback", MODE_PRIVATE)
            val count = preferences.getInt("autoplayCount:$profileId", 0)
            if (count >= intent.getIntExtra(EXTRA_AUTOPLAY_LIMIT, 3)) {
                Toast.makeText(this@PlayerActivity, getString(R.string.lecteur_autoplay_suspendu), Toast.LENGTH_LONG).show(); return@launch
            }
            runCatching { api.playbackNeighbors(mediaId, profileId).optJSONObject("next") }.getOrNull()?.let { next ->
                episodeEnAttente = next
                compteurEnAttente = count
                commandesVisibles = true
                masquage?.cancel()
                // Le titre de l'épisode en gras, son numéro en dessous : on sait déjà quelle série
                // on regarde, c'est l'épisode qui s'annonce. C'est la forme de la carte du Web.
                val titreSuivant = next.optString("title").takeIf { it.isNotBlank() }
                val numeroSuivant = numeroEpisode(next.optInt("seasonNumber", 0), next.optInt("episodeNumber", 0))
                for (restant in DELAI_AUTOPLAY_SECONDES downTo 1) {
                    etatLecteur = etatLecteur.copy(
                        autoplayRestantSecondes = restant,
                        autoplayTitre = titreSuivant,
                        autoplaySousTitre = numeroSuivant,
                    )
                    delay(1_000)
                }
                demarrerEpisodeEnAttente()
            }
        }
    }

    /** Lance le voisin déjà résolu, immédiatement ou au terme du compte à rebours. */
    private fun demarrerEpisodeEnAttente() {
        val next = episodeEnAttente ?: return
        enchainement?.cancel()
        enchainement = null
        episodeEnAttente = null
        // Le suivant repart sans mémoire du précédent : ni carte écartée, ni introduction passée.
        carteParGenerique = false
        enchainementEcarte = false
        introEcartee = false
        debutGeneriqueSecondes = null
        introSecondes = null
        etatLecteur = etatLecteur.copy(autoplayRestantSecondes = null, autoplayTitre = null,
            autoplaySousTitre = null, passerGeneriqueVisible = false)
        appliquerContexteMedia(next)
        mediaId = next.getString("id")
        compatibilityRetry = false
        // « continue » et non le réglage de la personne : l'enchaînement automatique se fait sans
        // réponse à une boîte de dialogue éventuelle.
        reprise = decisionReprise(null, next.optInt("progressPercent"), "continue",
            intentSecondes = next.optDouble("progressPositionSeconds").takeIf { next.has("progressPositionSeconds") },
            intentDureeSecondes = next.optDouble("progressDurationSeconds").takeIf { next.has("progressDurationSeconds") })
        getSharedPreferences("playback", MODE_PRIVATE).edit {
            putInt("autoplayCount:$profileId", compteurEnAttente + 1)
        }
        preparePlayback()
    }

    private fun annulerEnchainement(remettreCompteur: Boolean) {
        enchainement?.cancel()
        enchainement = null
        episodeEnAttente = null
        carteParGenerique = false
        if (remettreCompteur) enchainementEcarte = true
        etatLecteur = etatLecteur.copy(autoplayRestantSecondes = null, autoplayTitre = null, autoplaySousTitre = null)
        if (remettreCompteur && ::profileId.isInitialized) {
            getSharedPreferences("playback", MODE_PRIVATE).edit {
                putInt("autoplayCount:$profileId", 0)
            }
        }
    }

    /**
     * Plein écran de lecture, sur les trois surfaces.
     *
     * Le contenu passe sous les encoches et les barres système sont masquées. Sur mobile et tablette,
     * un balayage les fait réapparaître temporairement sans interrompre la lecture ; un téléviseur n'a
     * pas de barre persistante, le réglage y est simplement sans effet visible.
     */
    /** Le plein écran est le même partout : voir `masquerBarresSysteme`. */
    private fun enterFullScreen() = masquerBarresSysteme()

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: android.content.res.Configuration,
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        enImageDansImage = isInPictureInPictureMode
        if (isInPictureInPictureMode) {
            // Le panneau d'infos couvrirait toute la vignette : il se referme, et le compte a rebours
            // de masquage s'arrete puisqu'il n'y a plus rien a masquer.
            masquage?.cancel()
            infoVisible = false
            etatLecteur = etatLecteur.copy(infosOuvertes = false)
            commandesVisibles = false
        } else {
            // De retour en plein ecran, les commandes reprennent leur cycle normal.
            reveillerCommandes()
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        // Une boîte de dialogue ou un retour depuis l'arrière-plan fait réapparaître les barres.
        if (hasFocus) enterFullScreen()
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
            && controller?.isPlaying == true) {
            enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9)).build())
        }
    }

    /**
     * Retient la position avant une destruction possible.
     *
     * Le serveur reçoit déjà la progression toutes les dix secondes, mais il ne suffit pas ici : la
     * fiche du film n'est pas relue à la recréation de l'activité, et l'intention qu'Android rend
     * alors est celle du début de séance. C'est cette sauvegarde-là qui rattrape le film.
     */
    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        val player = controller
        val reference = if (player != null) referenceDurationMs(player.duration) else 0
        if (player != null && reference > 0) {
            val positionFilm = tempsFilm(player.currentPosition / 1000.0, fenetre)
                .coerceAtMost(reference / 1000.0)
            outState.putDouble(ETAT_POSITION_SECONDS, positionFilm)
            outState.putInt(ETAT_PROGRESSION, (positionFilm * 100_000 / reference).toInt().coerceIn(0, 99))
        }
        outState.putBoolean(ETAT_CONVERSION, compatibilityRetry)
    }

    override fun onPause() { persistProgress(); super.onPause() }
    override fun onDestroy() {
        annulerEnchainement(remettreCompteur = false)
        rappelReseau?.let { rappel ->
            runCatching { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(rappel) }
        }
        repriseEnAttente?.let { view.removeCallbacks(it) }
        annulerDementiCodec()
        persistProgress()
        /**
         * Arrêter le lecteur, et pas seulement le lâcher.
         *
         * `PlaybackService` est un `MediaSessionService` : son lecteur survit **délibérément** à
         * l'activité, c'est ce qui permet au son de continuer quand on quitte l'écran. Libérer le
         * `MediaController` ne le suspend donc pas — la lecture précédente restait en cours, sa
         * conversion continuait d'être demandée segment après segment, et son créneau n'était jamais
         * rendu. Lancer un second film se heurtait alors à « limite de 2 conversions simultanées »,
         * ce qui décrivait exactement la situation sans en dire la cause.
         *
         * On ne conserve pas d'arrière-plan pour de la vidéo : quitter le lecteur, c'est arrêter de
         * regarder. Le son seul n'aurait de sens que pour un usage que l'application ne propose pas.
         */
        controller?.run { stop(); clearMediaItems() }
        playbackSessionId?.let { id -> lifecycleScope.launch { runCatching { api.stopPlayback(id) } } }
        view.player = null
        controller?.release()
        MediaController.releaseFuture(controllerFuture)
        super.onDestroy()
    }

    companion object {
        /**
         * Combien de temps une lecture directe doit tenir avant de valoir démenti de quarantaine.
         *
         * Assez long pour couvrir les erreurs de décodage, qui surviennent au démarrage ou dans les
         * premières secondes ; assez court pour qu'une quarantaine devenue fausse — un micrologiciel
         * corrigé depuis — soit levée dès la lecture suivante plutôt qu'à l'oubli automatique.
         */
        private const val DELAI_DEMENTI_MS = 8_000L
        const val EXTRA_SERVER = "server"; const val EXTRA_PROFILE_ID = "profile"; const val EXTRA_MEDIA_ID = "media"
        const val EXTRA_TITLE = "title"; const val EXTRA_PROGRESS = "progress"
        const val EXTRA_PROGRESS_SECONDS = "progressSeconds"; const val EXTRA_PROGRESS_DURATION_SECONDS = "progressDurationSeconds"
        /** Clés de l'état sauvegardé : ce que l'activité se transmet à elle-même à travers sa destruction. */
        private const val ETAT_PROGRESSION = "etat.progression"; private const val ETAT_POSITION_SECONDS = "etat.positionSecondes"
        private const val ETAT_CONVERSION = "etat.conversion"
        const val EXTRA_PROFILE_TOKEN = "profileToken"
        const val EXTRA_AUDIO_LANGUAGES = "audioLanguages"; const val EXTRA_AUDIO_OUTPUT = "audioOutput"
        const val EXTRA_SUBTITLE_LANGUAGES = "subtitleLanguages"; const val EXTRA_SUBTITLE_MODE = "subtitleMode"
        const val EXTRA_AUDIO_NORMALIZATION = "audioNormalization"; const val EXTRA_NIGHT_MODE = "nightMode"
        const val EXTRA_DYNAMIC_RANGE_PRIORITY = "dynamicRangePriority"
        const val EXTRA_RESUME_MODE = "resumeMode"; const val EXTRA_RESUME_REWIND = "resumeRewind"
        const val EXTRA_PLAYBACK_RATE = "playbackRate"; const val EXTRA_AUTOPLAY_NEXT = "autoplayNext"; const val EXTRA_AUTOPLAY_LIMIT = "autoplayLimit"
    }
}
