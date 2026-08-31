package tv.flixtunes.app

import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.lifecycleScope
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import tv.flixtunes.app.data.ChaineDirect
import tv.flixtunes.app.data.FlixTunesApi
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

    /** Les adresses de la chaîne courante, déjà triées par ce que l'usage a appris. */
    private var adresses: List<String> = emptyList()
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val serveur = intent.getStringExtra(EXTRA_SERVER) ?: return finish()
        profileId = intent.getStringExtra(EXTRA_PROFILE_ID) ?: return finish()
        val chaineId = intent.getStringExtra(EXTRA_CHANNEL_ID) ?: return finish()
        api = FlixTunesApi(serveur, intent.getStringExtra(EXTRA_PROFILE_TOKEN))
        message = getString(R.string.direct_ouverture)

        lecteur = ExoPlayer.Builder(this).build().apply {
            playWhenReady = true
            addListener(object : Player.Listener {
                override fun onPlayerError(error: PlaybackException) {
                    // Une erreur fatale sur un direct ne se répare pas en réessayant la même adresse :
                    // la source est en panne, et la suivante est déjà connue.
                    suivante()
                }

                override fun onIsPlayingChanged(joue: Boolean) {
                    if (!joue) return
                    message = null
                    echeance?.cancel()
                    val jouee = essai ?: return
                    lifecycleScope.launch { runCatching { api.resultatChaineDirect(profileId, chaineId, jouee, true) } }
                }
            })
        }

        setContent { ThemeFlixTunes { Ecran() } }
        ouvrir(chaineId)
    }

    /** Charge une chaîne et lance sa première adresse. C'est aussi le chemin d'un changement de chaîne. */
    private fun ouvrir(chaineId: String) = lifecycleScope.launch {
        echeance?.cancel()
        essai = null
        rang = 0
        echec = false
        message = getString(R.string.direct_ouverture)
        runCatching { api.chaineDirect(profileId, chaineId) }
            .onSuccess { details ->
                chaine = details.chaine
                adresses = details.sources.map { it.url }.take(REPLIS)
                jouerRang()
            }
            .onFailure { echec = true; message = getString(R.string.direct_aucune_source) }
    }

    private fun jouerRang() {
        val source = adresses.getOrNull(rang) ?: run { echec = true; message = getString(R.string.direct_aucune_source); return }
        essai = source
        lecteur?.apply {
            setMediaItem(MediaItem.fromUri(source))
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
        val identifiant = chaine?.id
        if (identifiant != null) {
            lifecycleScope.launch { runCatching { api.resultatChaineDirect(profileId, identifiant, morte, false) } }
        }
        rang += 1
        if (rang >= adresses.size) { echec = true; message = getString(R.string.direct_aucune_source); return }
        message = getString(R.string.direct_source_essai, rang + 1, adresses.size)
        jouerRang()
    }

    /**
     * La télécommande : les chiffres composent un numéro, P+/P− changent de chaîne.
     *
     * C'est le geste qui distingue un téléviseur d'une grille d'icônes, et il ne s'invente pas : on
     * tape un ou plusieurs chiffres, et la chaîne s'ouvre d'elle-même après une seconde et demie —
     * le temps qu'on ait fini de composer.
     */
    override fun onKeyDown(code: Int, evenement: KeyEvent): Boolean {
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
        if (code == KeyEvent.KEYCODE_CHANNEL_UP || code == KeyEvent.KEYCODE_PAGE_UP) { voisine(1); return true }
        if (code == KeyEvent.KEYCODE_CHANNEL_DOWN || code == KeyEvent.KEYCODE_PAGE_DOWN) { voisine(-1); return true }
        return super.onKeyDown(code, evenement)
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

    /** La chaîne voisine, par numéro. P+ et P− d'un téléviseur. */
    private fun voisine(sens: Int) = lifecycleScope.launch {
        val depuis = chaine?.numero ?: return@launch
        val trouvee = runCatching { api.chaineVoisine(profileId, depuis, sens) }.getOrNull() ?: return@launch
        ouvrir(trouvee.id)
    }

    @Composable
    private fun Ecran() {
        val contexte = LocalContext.current
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            AndroidView(
                factory = { PlayerView(contexte).apply { useController = false; player = lecteur } },
                modifier = Modifier.fillMaxSize(),
            )
            Column(Modifier.align(Alignment.TopStart).padding(24.dp)) {
                val courante = chaine
                Text(
                    listOfNotNull(courante?.numero?.toString(), courante?.nom).joinToString(" · "),
                    color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.Bold,
                )
                // Le repli se dit, mais discrètement : savoir qu'on est sur la deuxième source explique
                // une qualité différente sans transformer un rattrapage réussi en incident.
                Text(
                    listOfNotNull(
                        courante?.groupe,
                        if (adresses.size > 1) "source ${rang + 1}/${adresses.size}" else null,
                    ).joinToString(" · "),
                    color = Muet, fontSize = 13.sp,
                )
            }
            message?.let { texte ->
                Text(texte, Modifier.align(Alignment.Center)
                    .clip(RoundedCornerShape(10.dp)).background(Encre.copy(alpha = .82f)).padding(14.dp, 10.dp),
                    color = if (echec) Color(0xFFFFB7C0) else Color.White)
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

    override fun onStop() {
        super.onStop()
        lecteur?.pause()
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
        private const val REPLIS = 4
    }
}
