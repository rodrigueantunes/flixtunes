package tv.flixtunes.app.ui.lecteur

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.offset
import tv.flixtunes.app.ui.CarteBas
import tv.flixtunes.app.ui.CarteHaut
import tv.flixtunes.app.ui.Ligne
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.focusable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.flixtunes.app.playback.formatTempsLecture
import tv.flixtunes.app.playback.GesteTelecommande
import tv.flixtunes.app.playback.gesteBarreProgression
import tv.flixtunes.app.playback.mentionEncodee
import tv.flixtunes.app.playback.partDe
import tv.flixtunes.app.ui.LocalGabarit
import androidx.compose.ui.res.stringResource
import tv.flixtunes.app.R
import tv.flixtunes.app.ui.ApprocheAccroche
import tv.flixtunes.app.ui.Bleu
import tv.flixtunes.app.ui.BadgeBordure
import tv.flixtunes.app.ui.BleuAccroche
import tv.flixtunes.app.ui.BleuClair
import tv.flixtunes.app.ui.RayonPanneau
import tv.flixtunes.app.ui.Encre
import tv.flixtunes.app.ui.Muet
import tv.flixtunes.app.ui.cliquableAuFocus
import tv.flixtunes.app.ui.indicationFocus
import tv.flixtunes.app.ui.rememberSourceFocus

private val Fumee = Color(0xB3FFFFFF)

/**
 * La barre de commandes du lecteur Android, calquée sur celle du Web.
 *
 * Media3 en fournit une, et c'est elle qui servait jusqu'ici. Elle ne pouvait pas convenir : son temps
 * total ne vient pas de `getDuration()` mais de la `Timeline` du lecteur, que rien ne traduit. En
 * conversion, la barre affichait donc la position dans le film sur la durée de la fenêtre encodée —
 * « 1:23:45 / 0:03:20 » —, avec un curseur borné à ce qui était déjà produit. Envelopper le lecteur ne
 * suffisait pas : il aurait fallu lui fabriquer une fausse `Timeline`, c'est-à-dire mentir à Media3
 * pour qu'il dise vrai.
 *
 * Cette barre-ci reçoit des secondes de film déjà traduites et n'affiche rien d'autre. Elle porte les
 * mêmes éléments que le lecteur Web, dans le même ordre et avec les mêmes mots, parce que comparer une
 * lecture entre deux appareils ne doit pas demander de traduire mentalement.
 */
@Composable
fun CommandesLecteur(etat: EtatLecteur, actions: ActionsLecteur, modifier: Modifier = Modifier,
    garnitureVisible: Boolean = true) {
    val gabarit = LocalGabarit.current
    val autoplayFocus = remember { FocusRequester() }
    val generiqueFocus = remember { FocusRequester() }
    LaunchedEffect(etat.autoplayRestantSecondes != null) {
        if (etat.autoplayRestantSecondes != null && gabarit.naviguerAuFocus) {
            runCatching { autoplayFocus.requestFocus() }
        }
    }
    /**
     * La couche de gestes reste en place quand la garniture se retire.
     *
     * Sans cela, le double tape ne fonctionnerait qu'une fois les commandes affichées — c'est-à-dire
     * au moment où l'on n'en a plus besoin, puisque les boutons sont là. C'est justement pendant le
     * film, écran nu, que le geste sert.
     *
     * La clé de `pointerInput` est `Unit`, et ce détail décidait de tout. Elle portait auparavant la
     * position de lecture, qui change quatre fois par seconde : Compose recréait donc le détecteur à
     * chaque changement, et un double tape — trois cents millisecondes — était détruit avant d'avoir
     * pu se former. La simple tape se perdait de la même façon, ce qui rendait la barre de progression
     * difficile à faire apparaître. La position est désormais lue **au moment du geste**, à travers
     * une référence que la recomposition met à jour sans toucher au détecteur.
     */
    Box(modifier.fillMaxSize()) {
    // Surface gestuelle placée derrière les vraies commandes : une tape sur un bouton reste un clic
    // sur ce bouton, une tape sur l'image montre ou retire la garniture. Le double geste ne dépend
    // jamais de l'état de la barre et reste donc disponible en plein écran nu.
    if (gabarit.tapeDoubleNavigation) {
        Box(
            Modifier.fillMaxSize().pointerInput(Unit) {
                detectTapGestures(
                    onTap = { actions.basculerCommandes() },
                    onDoubleTap = { point -> actions.sauter(if (point.x < size.width / 2f) -1 else 1) },
                )
            },
        )
    }
    /*
     * Passer l'introduction : proposé, jamais imposé.
     *
     * Le segment vient des chapitres du fichier, que le serveur ne livre que pour les épisodes — un
     * film n'a qu'une introduction, c'est l'épisode qu'on enchaîne vingt fois de suite. Le bouton
     * occupe le coin de la carte d'enchaînement, dont il ne croise jamais la route : l'un vit au
     * début du fichier, l'autre à la fin.
     */
    if (etat.passerGeneriqueVisible && etat.autoplayRestantSecondes == null && !etat.chargement && etat.erreur == null) {
        val libelle = stringResource(R.string.lecteur_passer_generique)
        // Sur un téléviseur, un bouton qu'on ne peut pas atteindre n'existe pas : la télécommande n'a
        // pas de curseur, et rien d'autre n'est focalisable pendant la lecture. Il prend donc le focus
        // le temps qu'il est proposé — comme le fait déjà la carte d'enchaînement.
        LaunchedEffect(Unit) { if (gabarit.naviguerAuFocus) runCatching { generiqueFocus.requestFocus() } }
        Box(
            Modifier.align(Alignment.BottomEnd)
                .padding(end = gabarit.margeBord.dp, bottom = (gabarit.margeBord * 5).dp),
        ) {
            BoutonLecteur(libelle, actions.passerGenerique, actions.reveiller,
                ancrageFocus = generiqueFocus, description = libelle)
        }
    }
    if (etat.autoplayRestantSecondes != null) {
        /*
         * L'enchaînement s'annonce sans se mettre devant le film.
         *
         * La carte occupait le centre de l'écran : elle masquait la fin de l'épisode au moment précis
         * où le générique se joue. Le lecteur Web la pose en bas à droite (`.player-next`), au-dessus
         * de la barre de progression et hors du champ de l'image ; Android s'y aligne, jetons compris.
         *
         * Le temps qui reste se **voit** plutôt qu'il ne se lit : la jauge se vide sur les dix
         * secondes du décompte, et l'on sait d'un coup d'œil s'il reste le temps d'attraper
         * « Annuler ». L'animation d'entrée est la même que celle du Web — un panneau qui surgit d'un
         * coup sur un générique se remarque mal.
         */
        val part by animateFloatAsState(
            targetValue = etat.autoplayRestantSecondes.coerceAtLeast(0).toFloat() / etat.autoplayTotalSecondes.coerceAtLeast(1),
            animationSpec = tween(durationMillis = 1_000, easing = LinearEasing),
            label = "jauge d'enchaînement",
        )
        var entree by remember { mutableStateOf(false) }
        LaunchedEffect(Unit) { entree = true }
        val glissement by animateDpAsState(
            targetValue = if (entree) 0.dp else 22.dp,
            animationSpec = tween(durationMillis = 320, easing = FastOutSlowInEasing),
            label = "entrée de la carte",
        )
        Column(
            Modifier.align(Alignment.BottomEnd)
                .padding(end = gabarit.margeBord.dp, bottom = (gabarit.margeBord * 5).dp)
                .offset(y = glissement)
                .widthIn(max = 340.dp)
                .clip(RoundedCornerShape(RayonPanneau))
                .background(Brush.verticalGradient(listOf(CarteHaut, CarteBas)))
                .border(1.dp, BadgeBordure, RoundedCornerShape(RayonPanneau))
                .padding(start = 18.dp, end = 18.dp, top = 16.dp, bottom = 18.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                stringResource(R.string.lecteur_autoplay_titre).uppercase(),
                color = BleuClair,
                fontSize = (gabarit.tailleTexte - 3).sp,
                letterSpacing = 1.4.sp,
            )
            etat.autoplayTitre?.let {
                Text(it, color = Color.White, fontWeight = FontWeight.Bold,
                    fontSize = gabarit.tailleSection.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            etat.autoplaySousTitre?.let {
                Text(it, color = Fumee, fontSize = (gabarit.tailleTexte - 1).sp, maxLines = 1,
                    overflow = TextOverflow.Ellipsis)
            }
            Box(
                Modifier.fillMaxWidth().padding(top = 11.dp, bottom = 3.dp).height(3.dp)
                    .clip(RoundedCornerShape(3.dp)).background(Ligne)
                    .semantics {
                        contentDescription = "Lecture dans ${etat.autoplayRestantSecondes} secondes"
                    },
            ) {
                Box(
                    Modifier.fillMaxHeight().fillMaxWidth(part.coerceIn(0f, 1f))
                        .clip(RoundedCornerShape(3.dp))
                        .background(Brush.horizontalGradient(listOf(Bleu, BleuClair))),
                )
            }
            Row(
                Modifier.padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                val maintenant = stringResource(R.string.lecteur_autoplay_maintenant)
                BoutonLecteur(maintenant, actions.lireSuivantMaintenant, actions.reveiller,
                    ancrageFocus = autoplayFocus, description = maintenant)
                val annuler = stringResource(R.string.action_annuler)
                BoutonLecteur(annuler, actions.annulerEpisodeSuivant, actions.reveiller,
                    description = annuler)
            }
        }
    } else if (etat.chargement || etat.erreur != null) {
        Column(
            Modifier.align(Alignment.Center).widthIn(max = 420.dp).padding(24.dp)
                .clip(RoundedCornerShape(16.dp)).background(Encre.copy(alpha = .94f)).padding(20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            if (etat.erreur == null) {
                CircularProgressIndicator(color = Bleu)
                Text(stringResource(R.string.lecteur_preparation), color = Color.White)
            } else {
                Text(etat.erreur, color = Color.White, fontWeight = FontWeight.Bold)
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    val reessayer = stringResource(R.string.lecteur_reessayer)
                    BoutonLecteur(reessayer, actions.reessayer, actions.reveiller, description = reessayer)
                    val compatible = stringResource(R.string.lecteur_mode_compatible)
                    BoutonLecteur(compatible, actions.modeCompatible, actions.reveiller, description = compatible)
                }
            }
        }
    }
    if (garnitureVisible && !gabarit.televiseur && !etat.chargement && etat.erreur == null
        && !etat.infosOuvertes && !etat.pistesOuvertes && etat.autoplayRestantSecondes == null) {
        BoutonLectureCentral(etat, actions, Modifier.align(Alignment.Center))
    }
    if (garnitureVisible && etat.autoplayRestantSecondes == null) {
    // Les commandes se tiennent à l'écart des barres système et des encoches.
    //
    // L'activité passe en plein écran, mais les barres reviennent au balayage et un téléphone porte
    // souvent une encoche ou une barre de gestes. Sans cette marge, le bouton de retour se retrouvait
    // sous l'horloge et la ligne du bas sous la barre de navigation — inatteignables l'un comme
    // l'autre. `safeDrawing` couvre les deux cas, et vaut zéro sur un téléviseur, qui n'en a aucun.
    Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
        BandeauHaut(etat, actions)
        Spacer(Modifier.weight(1f))
        if (etat.infosOuvertes) PanneauInfos(etat, actions)
        if (etat.pistesOuvertes) PanneauPistes(etat, actions)
        Column(
            Modifier.fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Transparent, Encre.copy(alpha = .92f))))
                .padding(horizontal = gabarit.margeBord.dp, vertical = gabarit.margeInterne.dp),
        ) {
            if (gabarit.televiseur) {
                Text(
                    stringResource(R.string.lecteur_aide_tv),
                    Modifier.padding(bottom = 4.dp),
                    color = Fumee,
                    fontSize = (gabarit.tailleTexte - 2).sp,
                )
            }
            BarreProgression(etat, actions)
            LigneCommandes(etat, actions)
        }
    }
    }
    etat.sautSecondes?.let { saut ->
        RetourSaut(
            saut,
            Modifier
                .align(if (saut < 0) Alignment.CenterStart else Alignment.CenterEnd)
                .padding(horizontal = 42.dp),
        )
    }
    }
}

/** Commande principale sous le pouce, séparée des réglages secondaires. */
@Composable
private fun BoutonLectureCentral(etat: EtatLecteur, actions: ActionsLecteur, modifier: Modifier = Modifier) {
    val description = stringResource(if (etat.enLecture) R.string.lecteur_pause else R.string.lecteur_lire)
    Box(
        modifier
            .size(72.dp)
            .semantics { contentDescription = description; role = Role.Button }
            .clip(RoundedCornerShape(50))
            .background(Encre.copy(alpha = .82f))
            .clickable(role = Role.Button, onClickLabel = description) {
                actions.reveiller()
                actions.basculerLecture()
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(if (etat.enLecture) "Ⅱ" else "▶", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.Bold)
    }
}

/** Confirmation lisible du saut, cumulée lorsque l'utilisateur insiste. */
@Composable
private fun RetourSaut(secondes: Int, modifier: Modifier = Modifier) {
    val texte = if (secondes > 0) "+$secondes s" else "$secondes s"
    Text(
        texte,
        modifier
            .clip(RoundedCornerShape(50))
            .background(Encre.copy(alpha = .86f))
            .padding(horizontal = 18.dp, vertical = 12.dp),
        color = Color.White,
        fontSize = 18.sp,
        fontWeight = FontWeight.Bold,
    )
}

@Composable
private fun BandeauHaut(etat: EtatLecteur, actions: ActionsLecteur) {
    val gabarit = LocalGabarit.current
    BoxWithConstraints(
        Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Encre.copy(alpha = .92f), Color.Transparent))),
    ) {
        val compact = maxWidth < 600.dp
        Row(
            Modifier.fillMaxWidth().padding(
                horizontal = gabarit.margeBord.dp,
                vertical = if (compact) 8.dp else gabarit.margeInterne.dp,
            ),
            verticalAlignment = Alignment.CenterVertically,
        ) {
        BoutonLecteur("←", actions.fermer, actions.reveiller,
            description = stringResource(R.string.lecteur_retour))
        Column(Modifier.padding(start = 14.dp).weight(1f)) {
            Text(etat.titre, fontSize = gabarit.tailleSection.sp, fontWeight = FontWeight.Bold,
                maxLines = 1, overflow = TextOverflow.Ellipsis, color = Color.White)
            etat.sousTitre?.let {
                Text(it, fontSize = gabarit.tailleTexte.sp, color = Fumee, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (!compact && etat.episodePrecedent) BoutonLecteur(
            "|◀", actions.episodePrecedent, actions.reveiller,
            description = stringResource(R.string.lecteur_episode_precedent),
        )
        if (!compact && etat.episodeSuivant) BoutonLecteur(
            "▶|", actions.episodeSuivant, actions.reveiller,
            description = stringResource(R.string.lecteur_episode_suivant),
        )
        BoutonLecteur(stringResource(R.string.lecteur_infos), actions.ouvrirInfos, actions.reveiller,
            description = "Informations de lecture")
        BoutonLecteur(stringResource(R.string.lecteur_pistes), actions.ouvrirPistes, actions.reveiller,
            description = "Pistes audio et sous-titres")
        if (!compact) etat.mode?.let {
            Text(libelleMode(it), Modifier.padding(start = 12.dp), fontSize = gabarit.tailleTexte.sp, color = Bleu)
        }
        }
    }
}

/** Les mêmes mots que le badge du lecteur Web — « Direct Play » et non « direct ». */
private fun libelleMode(mode: String): String = when (mode) {
    "direct" -> "Direct Play"
    "remux" -> "Remux HLS"
    else -> "Transcodage HLS"
}

/**
 * Les trois épaisseurs superposées, et le curseur.
 *
 * De la plus discrète à la plus vive : ce que le serveur a encodé, ce que le lecteur a chargé, ce qui
 * a été lu. La première n'apparaît qu'en conversion, et c'est justement son intérêt — elle montre d'un
 * coup d'œil pourquoi viser plus loin marquera un temps d'arrêt.
 */
@Composable
private fun BarreProgression(etat: EtatLecteur, actions: ActionsLecteur) {
    val gabarit = LocalGabarit.current
    val epaisseur = gabarit.epaisseurBarre.dp
    var largeur by remember { mutableFloatStateOf(0f) }
    val focusBarre = remember { FocusRequester() }
    var barreFocalisee by remember { mutableStateOf(false) }
    LaunchedEffect(etat.sautSecondes) {
        if (etat.sautSecondes != null && gabarit.televiseur) repeat(6) {
            withFrameNanos { }
            if (runCatching { focusBarre.requestFocus() }.getOrDefault(false)) return@LaunchedEffect
        }
    }
    // Position visée pendant la saisie, et rien le reste du temps.
    //
    // Un doigt masque ce qu'il touche : sur un film de trois heures, viser une scène précise revient
    // à deviner. Le temps visé s'affiche donc au-dessus du doigt tant qu'il glisse, et la barre suit
    // l'aperçu plutôt que la lecture — sans quoi l'image sauterait à chaque pixel parcouru.
    var apercu by remember { mutableStateOf<Double?>(null) }
    val duree = etat.dureeSecondes
    val descriptionPosition = stringResource(R.string.lecteur_position)
    val positionDe: (Float) -> Double = { x ->
        if (largeur > 0f && duree > 0) (x / largeur).coerceIn(0f, 1f) * duree else etat.positionSecondes
    }
    val viser: (Float) -> Unit = { x ->
        if (largeur > 0f && duree > 0) {
            actions.reveiller()
            actions.naviguer(positionDe(x))
        }
    }
    Column {
        // L'aperçu occupe sa place en permanence : le faire apparaître déplacerait la barre sous le
        // doigt au moment précis où l'on vise.
        Text(
            apercu?.let { formatTempsLecture(it) } ?: " ",
            Modifier.padding(start = 4.dp),
            fontSize = gabarit.tailleTexte.sp, color = Color.White, fontWeight = FontWeight.Medium,
        )
        Box(
            Modifier.fillMaxWidth().height(gabarit.hauteurZoneBarre.dp)
                .focusRequester(focusBarre)
                .onFocusChanged { barreFocalisee = it.isFocused }
                .onPreviewKeyEvent { evenement ->
                    if (!gabarit.televiseur || evenement.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                    when (gesteBarreProgression(evenement.nativeKeyEvent.keyCode)) {
                        GesteTelecommande.RECULER -> { actions.sauter(-1); true }
                        GesteTelecommande.AVANCER -> { actions.sauter(1); true }
                        GesteTelecommande.BASCULER_LECTURE -> { actions.basculerLecture(); true }
                        else -> false
                    }
                }
                // Le gestionnaire doit précéder la cible dans la chaîne de modificateurs : il devient
                // son ancêtre et ne reçoit les flèches que lorsque cette barre possède le focus.
                .focusable(gabarit.televiseur)
                .then(if (barreFocalisee) Modifier.border(2.dp, Bleu, RoundedCornerShape(8.dp)) else Modifier)
                .semantics {
                    contentDescription = descriptionPosition
                    stateDescription = formatTempsLecture(etat.positionSecondes) + " sur " + formatTempsLecture(duree)
                    progressBarRangeInfo = ProgressBarRangeInfo(
                        etat.positionSecondes.coerceIn(0.0, duree.coerceAtLeast(1.0)).toFloat(),
                        0f..duree.coerceAtLeast(1.0).toFloat(),
                        0,
                    )
                    setProgress { cible -> actions.naviguer(cible.toDouble()); true }
                }
                .onSizeChanged { largeur = it.width.toFloat() }
                .pointerInput(duree) { detectTapGestures { viser(it.x) } }
                .pointerInput(duree) {
                    detectHorizontalDragGestures(
                        onDragStart = { depart -> apercu = positionDe(depart.x) },
                        onDragEnd = { apercu?.let { actions.naviguer(it) }; apercu = null },
                        onDragCancel = { apercu = null },
                    ) { changement, _ ->
                        actions.reveiller()
                        apercu = positionDe(changement.position.x)
                    }
                },
            contentAlignment = Alignment.CenterStart,
        ) {
            val part = partDe(apercu ?: etat.positionSecondes, duree)
            Box(Modifier.fillMaxWidth().height(epaisseur).clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = .18f)))
            Remplissage(partDe(etat.finEncodeeSecondes, duree), epaisseur, Color.White.copy(alpha = .22f))
            Remplissage(partDe(etat.tamponSecondes, duree), epaisseur, Color.White.copy(alpha = .38f))
            Remplissage(part, epaisseur, Bleu)
            // Les chapitres se posent par-dessus : ce sont des repères, pas une couche de progression.
            for (depart in etat.chapitres) {
                val marque = partDe(depart, duree)
                if (marque > 0f && marque < 1f) {
                    Box(Modifier.fillMaxWidth(marque).height(epaisseur), contentAlignment = Alignment.CenterEnd) {
                        Box(Modifier.size(2.dp, epaisseur).background(Encre.copy(alpha = .8f)))
                    }
                }
            }
            Box(Modifier.fillMaxWidth(part).fillMaxHeight(), contentAlignment = Alignment.CenterEnd) {
                Box(Modifier.size(gabarit.tailleCurseur.dp).clip(RoundedCornerShape(50)).background(Color.White))
            }
        }
    }
}

@Composable
private fun Remplissage(part: Float, epaisseur: Dp, couleur: Color) {
    if (part > 0f) {
        Box(Modifier.fillMaxWidth(part).height(epaisseur).clip(RoundedCornerShape(50)).background(couleur))
    }
}

/**
 * Les commandes du bas, sur une ou deux rangées selon la surface.
 *
 * Un téléviseur est large et regardé de loin : les huit commandes y tiennent de front. Un téléphone
 * tenu debout ne fait pas la moitié de cette largeur, et elles s'y écrasaient jusqu'à sortir de
 * l'écran — le minuteur et l'image dans l'image devenaient inatteignables.
 *
 * La séparation suit l'usage plutôt que la place disponible : ce qu'on touche pendant la lecture —
 * pause, reculer, avancer, et l'heure qu'on lit en même temps — reste sous le pouce ; ce qu'on règle
 * une fois passe au-dessous.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LigneCommandes(etat: EtatLecteur, actions: ActionsLecteur) {
    val gabarit = LocalGabarit.current
    val ecart = if (gabarit.televiseur) 14.dp else 8.dp
    /**
     * Le focus se pose sur pause/lecture dès que la barre revient.
     *
     * Sans point d'atterrissage, la barre réapparaissait sans que rien ne soit visé : la première
     * pression sur la croix directionnelle partait vers un élément que le système choisissait seul, et
     * l'on commençait par chercher où l'on était. La barre entière étant recomposée à chaque
     * apparition, `LaunchedEffect(Unit)` s'exécute bien à chacune, pas seulement à la première.
     */
    val premier = remember { FocusRequester() }
    LaunchedEffect(Unit) { if (gabarit.naviguerAuFocus) runCatching { premier.requestFocus() } }
    val descriptionLecture = stringResource(
        if (etat.enLecture) R.string.lecteur_pause else R.string.lecteur_lire,
    )
    val descriptionRecul = stringResource(R.string.lecteur_reculer_10)
    val descriptionAvance = stringResource(R.string.lecteur_avancer_10)
    val transport: @Composable () -> Unit = {
        if (gabarit.televiseur) BoutonLecteur(
            if (etat.enLecture) "Ⅱ" else "▶", actions.basculerLecture, actions.reveiller, premier,
            description = descriptionLecture,
        )
        BoutonLecteur("−10", { actions.sauter(-1) }, actions.reveiller,
            description = descriptionRecul)
        BoutonLecteur("+10", { actions.sauter(1) }, actions.reveiller,
            description = descriptionAvance)
        Column(Modifier.padding(horizontal = 6.dp)) {
            Text(
                formatTempsLecture(etat.positionSecondes) + " / " + formatTempsLecture(etat.dureeSecondes),
                fontSize = gabarit.tailleTexte.sp, color = Color.White, fontWeight = FontWeight.Medium,
            )
            // « encodé 1:12:30 » : la portion déjà produite, en conversion seulement. C'est ce qui
            // explique qu'une navigation plus loin marque un temps d'arrêt.
            mentionEncodee(etat.finEncodeeSecondes, etat.dureeSecondes)?.let {
                Text(it.removePrefix(" · "), fontSize = (gabarit.tailleTexte - 2).sp, color = Fumee)
            }
        }
    }
    val reglages: @Composable () -> Unit = {
        // En portrait, le bandeau haut manque de largeur et range les épisodes adjacents ici. Ils ne
        // disparaissent donc plus précisément sur la surface où l'on enchaîne le plus souvent.
        if (gabarit.commandesEmpilees && etat.episodePrecedent) BoutonLecteur(
            "|◀", actions.episodePrecedent, actions.reveiller,
            description = stringResource(R.string.lecteur_episode_precedent),
        )
        if (gabarit.commandesEmpilees && etat.episodeSuivant) BoutonLecteur(
            "▶|", actions.episodeSuivant, actions.reveiller,
            description = stringResource(R.string.lecteur_episode_suivant),
        )
        BoutonLecteur(vitesseLisible(etat.vitesse), actions.ouvrirVitesse, actions.reveiller)
        BoutonLecteur("Qualité", actions.ouvrirQualite, actions.reveiller)
        if (etat.plageDisponible) BoutonLecteur("Image", actions.ouvrirPlage, actions.reveiller)
        BoutonLecteur(minuteurLisible(etat.minuteurMinutes), actions.ouvrirMinuteur, actions.reveiller)
        if (etat.imageDansImage) BoutonLecteur("PiP", actions.imageDansImage, actions.reveiller,
            description = "Image dans l'image")
    }
    if (gabarit.commandesEmpilees) {
        Column(Modifier.fillMaxWidth().padding(top = 6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(ecart)) { transport() }
            FlowRow(
                Modifier.fillMaxWidth().padding(top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(ecart),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) { reglages() }
        }
    } else {
        Row(
            Modifier.fillMaxWidth().padding(top = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(ecart),
        ) {
            transport()
            Spacer(Modifier.weight(1f))
            reglages()
        }
    }
}

/** « 1× » plutôt que « 1.0 » : c'est la notation du sélecteur Web. */
private fun vitesseLisible(vitesse: Float): String =
    if (vitesse == vitesse.toInt().toFloat()) "${vitesse.toInt()}×" else "$vitesse×"

private fun minuteurLisible(minutes: Int): String = if (minutes > 0) "$minutes min" else "Minuteur"

/**
 * Un bouton du lecteur, dimensionné pour ce qui va le toucher.
 *
 * Le libellé donnait sa taille au bouton : quatorze points de marge horizontale et huit de verticale
 * autour du texte, soit environ trente-six points de haut. C'est assez pour un curseur de télécommande,
 * qui vise au pixel près et ne masque rien. Un doigt, lui, couvre une dizaine de millimètres et cache
 * sa propre cible : sous quarante-huit points, il rate plus souvent qu'il n'atteint.
 *
 * La zone tactile est donc portée au minimum du gabarit **sans grossir le dessin** : le fond garde sa
 * hauteur, la surface sensible s'étend autour. Le lecteur ne s'alourdit pas, il devient atteignable.
 */
@Composable
private fun BoutonLecteur(
    texte: String,
    action: () -> Unit,
    reveiller: () -> Unit,
    /** Posé sur le premier bouton, pour que le focus ait où atterrir quand la barre revient. */
    ancrageFocus: FocusRequester? = null,
    description: String = texte,
) {
    val gabarit = LocalGabarit.current
    // Une seule source pour le liseré et le clic. Avec deux cibles de focus empilées, la première
    // validation n'atteignait pas le bouton : il fallait appuyer deux fois sur « OK ».
    val source = rememberSourceFocus()
    // Le dessin est le même sur les deux surfaces ; seule la zone sensible change.
    val pastille = @Composable {
        Text(
            texte,
            Modifier
                .then(if (ancrageFocus != null) Modifier.focusRequester(ancrageFocus) else Modifier)
                .defaultMinSize(
                    minWidth = gabarit.cibleTactile.dp,
                    minHeight = gabarit.cibleTactile.dp,
                )
                .semantics {
                    contentDescription = description
                    role = Role.Button
                }
                .indicationFocus(source, 12)
                .clip(RoundedCornerShape(12.dp))
                .background(Color.White.copy(alpha = .12f))
                .clickable(
                    interactionSource = source,
                    indication = LocalIndication.current,
                    role = Role.Button,
                    onClickLabel = description,
                ) { reveiller(); action() }
                .padding(horizontal = 14.dp, vertical = 8.dp),
            fontSize = gabarit.tailleTexte.sp,
            color = Color.White,
            maxLines = 1,
        )
    }
    pastille()
}

/**
 * `.player-tracks` — le panneau des pistes audio et sous-titres.
 *
 * Il remplace une liste modale du système. La différence n'est pas cosmétique : la liste se fermait à
 * chaque choix, ne montrait nulle part ce qui était actif, et mélangeait audio et sous-titres dans une
 * seule énumération — on y lisait « Audio — fr · 5.1 · EAC3 » puis « Sous-titres — fr » sans jamais
 * savoir lequel des deux on écoutait. Pendant un film on y revient plusieurs fois : comparer deux
 * doublages, remettre les sous-titres sur une réplique inaudible. Rouvrir la liste pour découvrir ce
 * qu'on vient de faire est exactement ce qu'il faut éviter.
 *
 * Le panneau du Web reste donc ouvert, sépare les deux familles par un intitulé, marque l'active d'un
 * bouton radio, et applique le changement sans interrompre la lecture.
 */
@Composable
// Receveur `ColumnScope` : `align` est une extension de cette portée, et le panneau se range à
// droite de la colonne des commandes comme `.player-tracks` se range à droite de l'écran.
private fun ColumnScope.PanneauPistes(etat: EtatLecteur, actions: ActionsLecteur) {
    val gabarit = LocalGabarit.current
    Column(
        Modifier
            .align(Alignment.End)
            .padding(horizontal = gabarit.margeBord.dp)
            .widthIn(max = 380.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Encre.copy(alpha = .95f))
            .verticalScroll(rememberScrollState())
            .padding(14.dp),
    ) {
        IntitulePistes(stringResource(R.string.lecteur_pistes_audio))
        if (etat.pistesAudio.isEmpty()) {
            Text(
                stringResource(R.string.lecteur_pistes_indisponibles),
                color = Muet,
                fontSize = gabarit.tailleTexte.sp,
            )
        }
        for (piste in etat.pistesAudio) {
            LigneRadio(piste.libelle, piste.detail, piste.active) { actions.reveiller(); actions.choisirAudio(piste.cle) }
        }
        IntitulePistes(stringResource(R.string.lecteur_sous_titres))
        LigneRadio(
            stringResource(R.string.lecteur_sous_titres_desactives),
            "",
            etat.sousTitresDesactives,
        ) { actions.reveiller(); actions.choisirSousTitre(null) }
        for (piste in etat.pistesSousTitres) {
            LigneRadio(piste.libelle, piste.detail, piste.active) { actions.reveiller(); actions.choisirSousTitre(piste.cle) }
        }
        IntitulePistes(stringResource(R.string.lecteur_sous_titres_apparence))
        Text(stringResource(R.string.lecteur_sous_titres_taille), color = Muet, fontSize = gabarit.tailleTexte.sp)
        LigneRadio(stringResource(R.string.lecteur_sous_titres_petit), "", etat.tailleSousTitres == "small") {
            actions.reveiller(); actions.choisirTailleSousTitres("small")
        }
        LigneRadio(stringResource(R.string.lecteur_sous_titres_normal), "", etat.tailleSousTitres == "normal") {
            actions.reveiller(); actions.choisirTailleSousTitres("normal")
        }
        LigneRadio(stringResource(R.string.lecteur_sous_titres_grand), "", etat.tailleSousTitres == "large") {
            actions.reveiller(); actions.choisirTailleSousTitres("large")
        }
        Text(stringResource(R.string.lecteur_sous_titres_fond), color = Muet, fontSize = gabarit.tailleTexte.sp)
        LigneRadio(stringResource(R.string.lecteur_sous_titres_transparent), "", !etat.fondSousTitres) {
            actions.reveiller(); actions.choisirFondSousTitres(false)
        }
        LigneRadio(stringResource(R.string.lecteur_sous_titres_sombre), "", etat.fondSousTitres) {
            actions.reveiller(); actions.choisirFondSousTitres(true)
        }
        Text(stringResource(R.string.lecteur_sous_titres_couleur), color = Muet, fontSize = gabarit.tailleTexte.sp)
        listOf(
            "white" to R.string.lecteur_couleur_blanche,
            "yellow" to R.string.lecteur_couleur_jaune,
            "cyan" to R.string.lecteur_couleur_cyan,
            "green" to R.string.lecteur_couleur_verte,
        ).forEach { (valeur, libelle) ->
            LigneRadio(stringResource(libelle), "", etat.couleurSousTitres == valeur) {
                actions.reveiller(); actions.choisirCouleurSousTitres(valeur)
            }
        }
    }
}

/** `.player-tracks h3` — un intitulé de famille, en capitales espacées. */
@Composable
private fun IntitulePistes(texte: String) {
    Text(
        texte.uppercase(),
        Modifier.padding(top = 10.dp, bottom = 6.dp),
        color = BleuAccroche,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = ApprocheAccroche,
    )
}

/**
 * `.player-tracks label` — une piste, son détail, et le point qui dit si elle est active.
 *
 * Un vrai `RadioButton` de Material plutôt qu'une coche dessinée à la main : il porte déjà la
 * sémantique d'accessibilité et l'état visuel attendu, et se vise à la télécommande comme le reste.
 */
@Composable
private fun LigneRadio(libelle: String, detail: String, actif: Boolean, choisir: () -> Unit) {
    val gabarit = LocalGabarit.current
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .cliquableAuFocus(
                arrondi = 8,
                role = Role.RadioButton,
                selectionne = actif,
                onClick = choisir,
            )
            // Quarante-huit points : c'est la cible sous laquelle un pouce rate plus souvent qu'il
            // n'atteint. Sur téléviseur, le gabarit la ramène à zéro et la rangée garde sa hauteur.
            .heightIn(min = maxOf(gabarit.cibleTactile, 40).dp)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(
            selected = actif,
            onClick = null,
            colors = RadioButtonDefaults.colors(selectedColor = Bleu, unselectedColor = Muet),
        )
        Column(Modifier.padding(start = 6.dp)) {
            Text(libelle, color = Color.White, fontSize = gabarit.tailleTexte.sp)
            if (detail.isNotBlank()) {
                Text(detail, color = Muet, fontSize = (gabarit.tailleTexte - 3).sp)
            }
        }
    }
}

/**
 * Le panneau « Infos lecture », aux mêmes intitulés que celui du Web.
 *
 * Il se lit pendant la lecture, sans l'interrompre : c'est là qu'on va quand une image hésite et qu'on
 * cherche à savoir si le débit, le décodeur ou le réseau est en cause.
 */
@Composable
private fun PanneauInfos(etat: EtatLecteur, actions: ActionsLecteur) {
    val gabarit = LocalGabarit.current
    Column(
        Modifier.padding(horizontal = gabarit.margeBord.dp)
            .widthIn(max = 520.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(Encre.copy(alpha = .93f))
            .padding(gabarit.margeInterne.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Infos lecture", fontSize = gabarit.tailleSection.sp, fontWeight = FontWeight.Bold, color = Color.White)
            Spacer(Modifier.weight(1f))
            BoutonLecteur("×", actions.ouvrirInfos, actions.reveiller,
                description = stringResource(R.string.lecteur_fermer_panneau))
        }
        for (ligne in etat.lignesInfos) {
            Row(Modifier.fillMaxWidth().padding(top = 4.dp)) {
                // Une ligne sans intitulé prolonge la précédente : c'est le cas des raisons de la
                // décision, qui s'égrènent sous « Décision ».
                // Les deux colonnes se partagent la largeur au lieu d'imposer 130 points a l'intitule.
                // Sur un telephone etroit, cette largeur fixe ne laissait pas la place aux valeurs
                // longues — une chaine colorimetrique ou une raison de decision se coupait en plein mot.
                Text(ligne.intitule, Modifier.weight(0.42f), fontSize = gabarit.tailleTexte.sp, color = Fumee)
                Text(ligne.valeur, Modifier.weight(0.58f), fontSize = gabarit.tailleTexte.sp, color = Color.White)
            }
        }
    }
}
