package tv.flixtunes.app

import android.annotation.SuppressLint
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
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlin.math.roundToInt
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import tv.flixtunes.app.data.ChaineDirect
import tv.flixtunes.app.data.FlixTunesApi
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
    private lateinit var api: FlixTunesApi
    private lateinit var profileId: String

    /**
     * Les adresses de la chaîne courante, dans l'ordre du serveur.
     *
     * Ce n'est pas l'ordre de déclaration : le serveur les classe par échecs, puis par définition
     * mesurée dans le manifeste, puis par débit. La première est donc la meilleure qu'on connaisse,
     * et les autres restent accessibles à la touche verte.
     */
    private var adresses: List<String> = emptyList()
    /** Ce que le serveur sait de chaque adresse — définition et débit —, pour le dire dans la liste. */
    private var qualites: List<Pair<Int?, Int?>> = emptyList()
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
        override fun handleOnBackPressed() { montrerLesSources(false) }
    }

    private fun montrerLesSources(ouvert: Boolean) {
        choixOuvert = ouvert
        fermerLeChoix.isEnabled = ouvert
        if (ouvert) commandesVisibles = true
    }
    /**
     * Le retard de sécurité pris après des blocages répétés, en secondes.
     *
     * Zéro tant que tout va bien : on part **au bord du flux**, et l'on ne paie du retard que
     * lorsqu'il est mérité.
     */
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val serveur = intent.getStringExtra(EXTRA_SERVER) ?: return finish()
        profileId = intent.getStringExtra(EXTRA_PROFILE_ID) ?: return finish()
        val chaineId = intent.getStringExtra(EXTRA_CHANNEL_ID) ?: return finish()
        api = FlixTunesApi(serveur, intent.getStringExtra(EXTRA_PROFILE_TOKEN))
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
        lecteur = ExoPlayer.Builder(this)
            .setLoadControl(
                DefaultLoadControl.Builder()
                    .setBufferDurationsMs(15_000, 60_000, 2_500, 5_000)
                    .build(),
            )
            .build().apply {
            playWhenReady = true
            addListener(object : Player.Listener {
                override fun onPlayerError(error: PlaybackException) {
                    /*
                     * Réparer avant d'abandonner.
                     *
                     * Deux pannes sur trois n'en sont pas. **Sortir de la fenêtre** arrive dès qu'on a
                     * mis en pause un peu trop longtemps : la réponse est de rejoindre le direct, pas
                     * de changer de source. Une **erreur de décodage** est un segment abîmé : on
                     * reprépare la même adresse. Le reste — le réseau, le format — est une vraie
                     * panne, et la suivante est déjà connue.
                     */
                    if (error.errorCode == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW) {
                        seekToDefaultPosition()
                        prepare()
                        return
                    }
                    if (error.errorCode == PlaybackException.ERROR_CODE_DECODING_FAILED && reparations < 1) {
                        reparations += 1
                        prepare()
                        return
                    }
                    suivante()
                }

                override fun onPlaybackStateChanged(etat: Int) {
                    /*
                     * Le rechargement du tampon n'est pas une panne, c'est un avertissement.
                     *
                     * Trois fois en deux minutes, il dit que cette source ne tient pas la cadence à
                     * laquelle on la lit — et la réponse n'est pas d'en changer, c'est de **reculer**.
                     * Seize secondes de plus derrière le bord, prises dans les 37 s de marge que la
                     * fenêtre médiane laisse. On le paie une fois, et l'image tient.
                     *
                     * **Mais tout rechargement n'est pas un hoquet.** Ouvrir une chaîne, sauter dans
                     * la fenêtre, reprendre après une pause : chacun de ces gestes remplit le tampon
                     * et passe par le même état. Les compter revenait à se punir soi-même — relevé à
                     * l'écran, l'image sautait alors qu'elle allait très bien, parce que trois
                     * flèches en deux minutes suffisaient à déclencher le recul. On ignore donc ce
                     * qui suit de près une action délibérée.
                     */
                    if (etat != Player.STATE_BUFFERING) { surveillanceBlocage?.cancel(); return }
                    if (message != null) return
                    // Une image figée trop longtemps n'attend pas d'être comptée.
                    surveillerLeBlocage()
                    val maintenant = System.currentTimeMillis()
                    if (maintenant < silenceJusqua) return
                    /*
                     * **Les deux réactions n'ont pas le même prix, elles n'ont donc pas la même
                     * patience.**
                     *
                     * Reculer ne coûte que du retard : c'est invisible, ça répare la plupart des
                     * bégaiements, et ça doit donc arriver **vite** — trois rechargements suffisent,
                     * rafale comprise. Changer de source coupe l'image : cela doit rester un dernier
                     * mot, et se mériter.
                     *
                     * D'où deux comptages. Le premier prend tout ; le second n'accepte que des
                     * incidents **espacés d'au moins dix secondes** — un mauvais passage de vingt
                     * secondes produit six rechargements d'affilée, et les compter séparément
                     * abandonnait une chaîne qui fonctionne pour une minute difficile.
                     */
                    if (securite == 0) {
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
                    /*
                     * **Deuxième série de blocages : la source est en cause, pas la marge.**
                     *
                     * Reculer de seize secondes n'a pas suffi — relevé sur TF1, dont la première
                     * adresse sautait de partout alors qu'elle répondait très bien. Une source qui
                     * hoquette encore après qu'on lui a donné toute la marge disponible ne se
                     * rattrapera pas ; la suivante, elle, est déjà connue et n'a pas été essayée.
                     *
                     * Elle n'est **pas** rapportée comme morte : elle ne l'est pas. Inscrire un échec
                     * pour une source qui répond fausserait le classement avec une opinion.
                     */
                    reagirALInstabilite()
                }

                override fun onIsPlayingChanged(joue: Boolean) {
                    if (!joue) return
                    /*
                     * L'accalmie commence quand l'image arrive, pas à la première touche.
                     *
                     * `reveiller` n'était appelé que depuis la télécommande : au doigt, sur mobile,
                     * rien ne la touche jamais et la barre serait restée à l'écran pour toujours.
                     */
                    reveiller()
                    message = null
                    echeance?.cancel()
                    val jouee = essai ?: return
                    lifecycleScope.launch { runCatching { api.resultatChaineDirect(profileId, chaineId, jouee, true) } }
                }
            })
        }

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
    private fun ouvrir(chaineId: String) = lifecycleScope.launch {
        echeance?.cancel()
        essai = null
        rang = 0
        echec = false
        // Une chaîne neuve repart au bord : le retard de sécurité était celui de la précédente.
        securite = 0
        blocages.clear()
        montrerLesSources(false)
        reparations = 0
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
                qualites = retenues.map { it.hauteur to it.debit }
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
        if (candidates.size <= 1) return candidates
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
        return repondues + candidates.filterNot { it in repondues }
    }

    private fun jouerRang(reprendre: Boolean = true) {
        val source = adresses.getOrNull(rang) ?: run { echec = true; message = getString(R.string.direct_aucune_source); return }
        if (reprendre) essai = source
        // Préparer un flux remplit le tampon : c'est un geste, pas un hoquet.
        silenceJusqua = System.currentTimeMillis() + REPIT_APRES_GESTE_MS
        depuisSource = System.currentTimeMillis()
        lecteur?.apply {
            /*
             * La cible de retard : trois segments derrière le bord, comme le veut HLS, plus la
             * sécurité que les blocages ont fait gagner. C'est le seul levier réel — grossir le
             * tampon ne sert à rien quand il n'y a pas plus de média publié devant soi.
             */
            val cible = (CIBLE_DIRECT_S + securite) * 1_000L
            setMediaItem(
                MediaItem.Builder()
                    .setUri(source)
                    .setLiveConfiguration(
                        MediaItem.LiveConfiguration.Builder()
                            .setTargetOffsetMs(cible)
                            .setMinPlaybackSpeed(0.97f)
                            .setMaxPlaybackSpeed(1.03f)
                            .build(),
                    )
                    .build(),
            )
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
        val identifiant = chaine?.id
        if (identifiant != null) {
            lifecycleScope.launch { runCatching { api.resultatChaineDirect(profileId, identifiant, morte, false) } }
        }
        rang += 1
        if (rang >= minOf(adresses.size, REPLIS)) { echec = true; message = getString(R.string.direct_aucune_source); return }
        message = getString(R.string.direct_source_essai, rang + 1, adresses.size)
        jouerRang()
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
        if (evenement.action != KeyEvent.ACTION_DOWN) return super.dispatchKeyEvent(evenement)
        val code = evenement.keyCode
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
                KeyEvent.KEYCODE_DPAD_DOWN -> { choixIndex = (choixIndex + 1).coerceAtMost(adresses.lastIndex); return true }
                KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> { choisirSource(choixIndex); return true }
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
            if (adresses.size > 1) { choixIndex = rang; montrerLesSources(true) }
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
            choixIndex = rang
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
            if (lecteur?.isPlaying == true && !choixOuvert) commandesVisibles = false
        }
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
        joueur.seekTo(minOf(duree - 1_000, maxOf(2_000, joueur.currentPosition + deltaMs)))
        reveiller()
    }

    /** Revenir au bord du flux — la seule position qui mérite le mot « direct ». */
    private fun rejoindreDirect() {
        silenceJusqua = System.currentTimeMillis() + REPIT_APRES_GESTE_MS
        lecteur?.seekToDefaultPosition()
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
    private fun reagirALInstabilite() {
        blocages.clear()
        if (securite == 0) {
            securite = RECUL_S
            // Le recul reprépare le flux : le juger pendant qu'il se remplit reviendrait à le
            // condamner pour le remède qu'on vient de lui donner.
            silenceJusqua = System.currentTimeMillis() + REPIT_APRES_RECUL_MS
            jouerRang(reprendre = false)
            return
        }
        // L'automatique s'arrête à REPLIS essais ; la main, elle, va où elle veut.
        if (rang + 1 < minOf(adresses.size, REPLIS)) {
            message = getString(R.string.direct_source_instable, rang + 2)
            essai = null
            reparations = 0
            rang += 1
            securite = 0
            jouerRang()
        }
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
        /*
         * La fenêtre publiée, relevée quatre fois par seconde.
         *
         * `duration` porte la fenêtre glissante d'un direct — 61 s de médiane sur le corpus, quatre
         * heures pour Arte —, `currentPosition` l'endroit où l'on s'y trouve. C'est la seule source
         * de vérité : la barre s'en sert telle quelle plutôt que d'inventer une échelle qui
         * promettrait un retour en arrière inexistant.
         */
        LaunchedEffect(Unit) {
            while (true) {
                val joueur = lecteur
                if (joueur != null) {
                    fenetreMs = joueur.duration.coerceAtLeast(0)
                    positionMs = joueur.currentPosition.coerceAtLeast(0)
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
                    /*
                     * Sortir de la fenêtre par l'arrière : on rattrape avant que l'image ne se fige.
                     *
                     * Une pause d'une minute passe sur presque tout le corpus, une pause de cinq n'y
                     * passe pas. Plutôt que d'interdire la pause, on la laisse et on revient au
                     * direct en le disant — ExoPlayer sait aussi le signaler lui-même, par
                     * `ERROR_CODE_BEHIND_LIVE_WINDOW`, mais l'attendre voudrait dire attendre l'erreur.
                     */
                    if (fenetreMs > FENETRE_MINIMALE_MS && positionMs in 1 until FENETRE_MINIMALE_MS) {
                        rejoindreDirect()
                        message = getString(R.string.direct_fin_fenetre)
                        lifecycleScope.launch { delay(4_000); message = null }
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
            AndroidView(
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
                        keepScreenOn = true
                        player = lecteur
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
            /*
             * Le nom s'efface avec les commandes.
             *
             * Il restait posé en haut à gauche pendant qu'on regardait, alors que tout le reste
             * s'était retiré : sur un téléviseur, c'est une incrustation permanente sur l'image.
             * Relevé à l'écran. Le message d'ouverture, lui, reste visible tant qu'il a quelque chose
             * à dire — il ne se retire pas, il disparaît quand la chaîne démarre.
             */
            if (commandesVisibles) Column(Modifier.align(Alignment.TopStart).padding(24.dp)) {
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
                        choixIndex = rang
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
                val auDirect = retardMs <= MARGE_DIRECT_MS
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
                    Text(getString(R.string.direct_sources_titre), color = Muet, fontSize = 12.sp,
                        fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(10.dp))
                    LazyColumn(state = etatListe, modifier = Modifier.heightIn(max = 300.dp)) {
                    itemsIndexed(adresses) { index, _ ->
                        val (hauteur, debit) = qualites.getOrNull(index) ?: (null to null)
                        Column(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(9.dp))
                                .background(
                                    if (index == choixIndex) Color.White.copy(alpha = .12f) else Color.Transparent,
                                )
                                .clickable { choisirSource(index) }
                                .padding(horizontal = 14.dp, vertical = 9.dp),
                        ) {
                            Text(
                                getString(
                                    if (index == 0) R.string.direct_source_recommandee else R.string.direct_source_rang,
                                    index + 1,
                                ),
                                color = if (index == rang) BleuClair else Color.White,
                                fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                            )
                            Text(
                                when {
                                    hauteur != null && debit != null ->
                                        getString(R.string.direct_source_debit, hauteur, "%.1f".format(debit / 1_000_000f))
                                    hauteur != null -> getString(R.string.direct_source_definition, hauteur)
                                    else -> getString(R.string.direct_source_inconnue)
                                },
                                color = Muet, fontSize = 12.sp,
                            )
                        }
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

    override fun onStop() {
        super.onStop()
        jouaitAvantArret = lecteur?.playWhenReady == true
        lecteur?.pause()
    }

    override fun onStart() {
        super.onStart()
        if (jouaitAvantArret) {
            jouaitAvantArret = false
            // Rejoindre le bord : le flux a continué sans nous, reprendre où l'on s'était arrêté
            // ferait démarrer avec le retard de toute l'absence.
            lecteur?.seekToDefaultPosition()
            lecteur?.play()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        echeance?.cancel()
        lecteur?.release()
        lecteur = null
    }

    companion object {
        const val EXTRA_SERVER = "serveur"
        const val EXTRA_PROFILE_ID = "profil"
        const val EXTRA_PROFILE_TOKEN = "jeton"
        const val EXTRA_CHANNEL_ID = "chaine"

        /** Au-delà, on ne s'acharne pas : quatre adresses mortes disent que la chaîne l'est. */
        /**
         * Le nombre d'adresses que le **repli automatique** essaie avant de renoncer.
         *
         * Il ne borne plus la liste : toutes les adresses restent choisissables à la main. Il borne
         * l'acharnement, ce qui n'est pas la même chose — huit essais de douze secondes font déjà une
         * minute et demie devant un écran noir, et la course a de toute façon mis devant celles qui
         * répondent.
         */
        private const val REPLIS = 8

        /** Ce que la course sonde à l'ouverture : les mieux classées, pas les soixante-dix. */
        private const val COURSE_MAX = 12

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
