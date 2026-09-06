package tv.flixtunes.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import coil3.compose.AsyncImagePainter
import coil3.request.ImageRequest
import coil3.size.Size
import androidx.compose.ui.layout.ContentScale
import tv.flixtunes.app.R
import tv.flixtunes.app.data.Media

/**
 * Les composants que le Web et Android affichent tous les deux.
 *
 * Ils n'existaient qu'en CSS. Côté Android, chaque écran redessinait sa version de la même chose —
 * la jaquette de l'accueil et celle du catalogue étaient deux blocs distincts, avec deux arrondis et
 * deux façons de poser la pastille « déjà vu ». Rassemblés ici, ils se comparent au fichier de style
 * du Web une bonne fois, et un ajout profite aux deux surfaces.
 *
 * Chaque fonction porte en commentaire la règle CSS dont elle est la traduction : c'est ce qui rend
 * l'écart vérifiable sans lancer les deux clients côte à côte.
 */

/**
 * `.eyebrow` — le surtitre en capitales espacées, au-dessus d'un titre.
 *
 * C'est la signature typographique de FlixTunes : trois mots en petit, très espacés, dans un bleu
 * pâle. Le Web en pose un au-dessus de chaque titre d'écran, de vitrine et de fiche. Android n'en
 * avait qu'un, sur la vitrine, et sans l'espacement — donc sans l'effet.
 */
@Composable
fun Accroche(texte: String, modifier: Modifier = Modifier) {
    Text(
        texte.uppercase(),
        modifier,
        color = BleuAccroche,
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = ApprocheAccroche,
    )
}

/**
 * `.brand` — l'enseigne : le logo, « Flix » en blanc, « Tunes » en bleu.
 *
 * La coupure du nom en deux couleurs est ce qui identifie l'application d'un coup d'œil ; Android
 * écrivait « FlixTunes » d'un seul blanc, et la marque s'y perdait.
 */
@Composable
fun MarqueFlixTunes(modifier: Modifier = Modifier, taillePolice: Int = 21, tailleLogo: Dp = 46.dp) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        // Le mot-symbole juste après porte déjà le nom : décrire aussi l'image le ferait lire deux fois.
        Image(painterResource(R.drawable.flixtunes_mark), null, Modifier.size(tailleLogo))
        Text(
            buildAnnotatedString {
                append("Flix")
                withStyle(SpanStyle(color = BleuMarque)) { append("Tunes") }
            },
            fontSize = taillePolice.sp,
            fontFamily = PoliceTitre,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = ApprocheEnseigne,
            color = Color.White,
        )
    }
}

/**
 * `.primary` — l'action principale : fond bleu, 48 points de haut, texte gras.
 *
 * La hauteur n'est pas décorative : c'est la cible tactile minimale sous laquelle un pouce rate plus
 * souvent qu'il n'atteint.
 */
@Composable
fun BoutonPrimaire(
    libelle: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    actif: Boolean = true,
    pictogramme: String? = null,
) {
    // La même source alimente l'indication et le clic : une seule cible de focus, donc un seul
    // appui sur « OK » pour agir.
    val source = rememberSourceFocus()
    Button(
        onClick,
        modifier.height(48.dp).indicationFocus(source, 12),
        enabled = actif,
        shape = RoundedCornerShape(RayonBouton),
        colors = ButtonDefaults.buttonColors(containerColor = Bleu, contentColor = Color.White),
        interactionSource = source,
    ) {
        if (pictogramme != null) {
            Text(pictogramme, fontSize = 15.sp)
            Spacer(Modifier.width(9.dp))
        }
        Text(libelle, fontWeight = FontWeight.Bold)
    }
}

/** `.secondary` — l'action d'appoint : un voile blanc à 13 %, même géométrie que la principale. */
@Composable
fun BoutonSecondaire(
    libelle: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    actif: Boolean = true,
    pictogramme: String? = null,
) {
    val source = rememberSourceFocus()
    Button(
        onClick,
        modifier.height(48.dp).indicationFocus(source, 12),
        enabled = actif,
        shape = RoundedCornerShape(RayonBouton),
        colors = ButtonDefaults.buttonColors(
            containerColor = BoutonSecondaireFond,
            contentColor = Color.White,
        ),
        interactionSource = source,
    ) {
        if (pictogramme != null) {
            Text(pictogramme, fontSize = 15.sp)
            Spacer(Modifier.width(9.dp))
        }
        Text(libelle, fontWeight = FontWeight.Bold)
    }
}

/**
 * `.quality-badges` — résolution, plage dynamique et codec, en pastilles.
 *
 * Le Web les affiche sur la fiche depuis r36 ; Android ne les affichait pas du tout, alors que le
 * serveur les envoie dans la même réponse.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BadgesQualite(qualites: List<String>, modifier: Modifier = Modifier) {
    if (qualites.isEmpty()) return
    FlowRow(
        modifier,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        for (qualite in qualites.take(6)) {
            Text(
                qualite,
                Modifier
                    .clip(RoundedCornerShape(50))
                    .background(BadgeFond)
                    .border(1.dp, BadgeBordure, RoundedCornerShape(50))
                    .padding(horizontal = 10.dp, vertical = 5.dp),
                color = BadgeTexte,
                fontSize = 11.sp,
                fontWeight = FontWeight.ExtraBold,
            )
        }
    }
}

/**
 * `.skeleton` — le rectangle qui attend une donnée, balayé par un reflet.
 *
 * Il vaut mieux qu'un indicateur circulaire au centre de l'écran : il occupe la place exacte de ce
 * qui va s'afficher, donc la page ne saute pas quand la donnée arrive.
 */
@Composable
fun Squelette(modifier: Modifier = Modifier, arrondi: Dp = RayonCommande) {
    val transition = rememberInfiniteTransition(label = "squelette")
    val avancee by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1350, easing = LinearEasing)),
        label = "balayage",
    )
    Box(
        modifier
            .clip(RoundedCornerShape(arrondi))
            .background(Color(0xFF141A27))
            .drawWithContent {
                drawContent()
                val bande = size.width * 0.6f
                val depart = -bande + avancee * (size.width + 2 * bande)
                drawRect(
                    Brush.linearGradient(
                        0f to Color.Transparent,
                        .5f to Color.White.copy(alpha = .06f),
                        1f to Color.Transparent,
                        start = Offset(depart, 0f),
                        end = Offset(depart + bande, 0f),
                    ),
                )
            },
    )
}

/**
 * `.poster` — la jaquette : rapport deux tiers, arrondi de 13, initiale en réserve.
 *
 * Le dégradé change tous les trois éléments, comme dans le Web (`:nth-child(3n)`). Un rail de fiches
 * sans affiche cesse alors d'être un aplat, et l'on distingue une analyse en cours d'un écran cassé.
 */
@Composable
fun Jaquette(url: String?, titre: String, modifier: Modifier = Modifier, rang: Int = 0) {
    val (haut, bas) = DEGRADES_JAQUETTE[rang.mod(DEGRADES_JAQUETTE.size)]
    val fond = remember(haut, bas) { Brush.linearGradient(listOf(haut, bas)) }
    Box(
        modifier
            .fillMaxWidth()
            .aspectRatio(2f / 3f)
            .clip(RoundedCornerShape(RayonJaquette))
            .background(fond),
        contentAlignment = Alignment.Center,
    ) {
        if (url.isNullOrBlank()) {
            // Le secours n'est plus peint sous chaque bitmap chargé : une passe de texte et son
            // paragraphe disparaissent de toutes les cartes ordinaires, sans changer le rendu final.
            val initiale = remember(titre) { titre.trim().take(1).uppercase().ifBlank { "F" } }
            Text(
                initiale,
                color = Color.White.copy(alpha = .12f),
                fontSize = 54.sp,
                fontFamily = PoliceTitre,
                fontWeight = FontWeight.ExtraBold,
            )
        } else ImageOptimiseeTv(url, FormatImageTv.JAQUETTE, Modifier.fillMaxSize())
    }
}

/** Deux familles de textures suffisent à partager exactement les mêmes clés Coil sur TV. */
enum class FormatImageTv { JAQUETTE, SAISON, BANDEAU, LOGO }

/**
 * Image réseau bornée sur TV, dimensionnée normalement par AsyncImage sur téléphone et tablette.
 * Les bandeaux gardent l'ARGB complet et une définition de 1024 à 1440 px ; seuls les pixels masqués
 * par le recadrage et les deux voiles de lisibilité cessent d'occuper le cache graphique.
 */
@Composable
fun ImageOptimiseeTv(
    url: String,
    format: FormatImageTv,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
    /** Prévenu quand l'image ne se charge pas : à l'appelant de montrer autre chose. */
    onEchec: (() -> Unit)? = null,
) {
    val gabarit = LocalGabarit.current
    val contexte = LocalContext.current
    val memoire = LocalMemoireTv.current
    val modele = remember(url, format, gabarit.televiseur, contexte, memoire) {
        if (!gabarit.televiseur) url
        else {
            val largeur = when (format) {
                FormatImageTv.JAQUETTE -> tailleTextureJaquetteTv(memoire)
                // La carte de saison est volontairement plus large que celle du catalogue : une
                // petite marge supplémentaire conserve ses détails sans revenir au décodage libre.
                FormatImageTv.SAISON -> tailleTextureJaquetteTv(memoire) + 64
                FormatImageTv.BANDEAU -> tailleTextureBandeauTv(memoire)
                // Un logo de chaîne s'affiche dans soixante points : 192 pixels couvrent les écrans
                // les plus denses et tiennent en mémoire, là où une texture de jaquette en gâchait dix
                // fois plus pour une image dix fois plus petite.
                FormatImageTv.LOGO -> 192
            }
            val hauteur = when (format) {
                FormatImageTv.JAQUETTE, FormatImageTv.SAISON -> largeur * 3 / 2
                FormatImageTv.BANDEAU -> largeur * 9 / 16
                // Carré, parce qu'un logo n'a pas de format : il y en a des larges et des hauts, et
                // c'est `ContentScale.Fit` qui décide de la place qu'il prend dedans.
                FormatImageTv.LOGO -> largeur
            }
            ImageRequest.Builder(contexte).data(url).size(Size(largeur, hauteur)).build()
        }
    }
    AsyncImage(
        modele, null, modifier, contentScale = contentScale,
        onState = { etat -> if (etat is AsyncImagePainter.State.Error) onEchec?.invoke() },
    )
}

/**
 * `.media-card` — une fiche du catalogue.
 *
 * Le titre occupe **toujours** deux lignes, même s'il en remplit une seule. Android était en une
 * ligne coupée par des points de suspension : la ligne de méta ne tombait donc pas à la même hauteur
 * d'une carte à l'autre, et une grille de jaquettes identiques paraissait dentelée. Le Web réserve la
 * place par `min-height: calc(2 * 1.35em)` ; `minLines = 2` fait exactement cela.
 */
@Composable
fun CarteMedia(
    media: Media,
    jaquette: String?,
    ouvrir: () -> Unit,
    modifier: Modifier = Modifier,
    rang: Int = 0,
    menu: (() -> Unit)? = null,
    restaurerFocus: Boolean = false,
    focusRestaure: () -> Unit = {},
    focusPris: () -> Unit = {},
    /** La seconde ligne, quand le rayon la nomme autrement. Par défaut, celle du média. */
    sousTitre: String? = null,
) {
    // Une grille TV peut contenir des milliers de fiches, mais une seule reçoit un focus restauré.
    // Ne pas créer de FocusRequester ni de coroutine d'effet pour toutes les autres retire du travail
    // de composition à chaque rangée préchargée, sans changer le moindre pixel ni le parcours D-pad.
    val demandeFocus = if (restaurerFocus) remember { FocusRequester() } else null
    if (demandeFocus != null) LaunchedEffect(media.id) {
        // La fiche peut entrer dans la composition une image avant d'être réellement attachée et
        // mesurée. `requestFocus()` renvoie alors `false`. L'ancien code effaçait malgré tout la
        // demande de restauration : au retour d'une fiche, le focus restant le plus proche était
        // justement la réglette A–Z. On ne consomme désormais la demande qu'après confirmation du
        // système, avec quelques images de marge pour les téléviseurs les plus lents.
        repeat(12) {
            withFrameNanos { }
            val restaure = runCatching { demandeFocus.requestFocus() }.getOrDefault(false)
            if (restaure) {
                focusRestaure()
                return@LaunchedEffect
            }
        }
    }
    Column(
        modifier
            .then(if (demandeFocus != null) Modifier.focusRequester(demandeFocus) else Modifier)
            .cliquableAuFocus(
                arrondi = RayonJaquette.value.toInt(),
                onClickLabel = "Ouvrir ${media.title}",
                onLongClickLabel = if (menu != null) "Actions pour ${media.title}" else null,
                onLongClick = menu,
                onFocused = focusPris,
                onClick = ouvrir,
            )
            .padding(4.dp),
    ) {
        Box {
            Jaquette(jaquette, media.title, rang = rang)
            if (media.completed) {
                Text(
                    "✓ Vu",
                    Modifier
                        .align(Alignment.BottomEnd)
                        .padding(9.dp)
                        .clip(RoundedCornerShape(RayonPastilleCarte))
                        .background(VoileCarte)
                        .padding(horizontal = 7.dp, vertical = 4.dp),
                    color = Vu,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            if (media.progressPercent in 1..99) {
                LinearProgressIndicator(
                    { media.progressPercent / 100f },
                    Modifier
                        .align(Alignment.BottomCenter)
                        .padding(horizontal = 8.dp, vertical = 8.dp)
                        .fillMaxWidth()
                        .height(4.dp)
                        .clip(RoundedCornerShape(3.dp)),
                    color = Bleu,
                    trackColor = Color.White.copy(alpha = .28f),
                    gapSize = 0.dp,
                    drawStopIndicator = {},
                )
            }
        }
        Text(
            media.title,
            Modifier.padding(top = 12.dp),
            minLines = 2,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            lineHeight = 18.sp,
            fontWeight = FontWeight.SemiBold,
        )
        Text(sousTitre ?: media.secondaryText, color = Muet, fontSize = 12.sp, maxLines = 1,
            overflow = TextOverflow.Ellipsis)
    }
}

/**
 * `.rail-section` — un rail et son intitulé, le décompte aligné à droite.
 *
 * Ce décompte manquait sur Android. Il ne décore pas : il dit combien de titres se cachent derrière
 * le bord de l'écran, seule information dont on dispose avant de faire défiler.
 */
@Composable
fun EnTeteRail(titre: String, compte: Int, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            titre,
            fontSize = LocalGabarit.current.tailleAccroche.sp,
            fontFamily = PoliceTitre,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = ApprocheSection,
        )
        Text("$compte", color = Muet, fontSize = LocalGabarit.current.tailleTexte.sp)
    }
}

/**
 * `.profile` de la barre du haut — la vignette colorée et le prénom.
 *
 * Android n'affichait que le prénom, dans un bouton de texte ordinaire. La couleur du profil est
 * pourtant ce qui permet de voir, sans lire, qu'on regarde depuis le bon espace.
 */
@Composable
fun PastilleProfil(
    nom: String,
    couleur: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    afficherNom: Boolean = true,
) {
    val fond = runCatching { Color(android.graphics.Color.parseColor(couleur)) }.getOrDefault(Bleu)
    val description = stringResource(R.string.profil_changer)
    Row(
        modifier
            .heightIn(min = 48.dp)
            .cliquableAuFocus(arrondi = 11, onClickLabel = description, onClick = onClick)
            .padding(horizontal = 6.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Box(
            Modifier.size(36.dp).clip(RoundedCornerShape(11.dp)).background(fond),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                nom.take(1).uppercase(),
                color = Color.White,
                fontFamily = PoliceTitre,
                fontWeight = FontWeight.ExtraBold,
            )
        }
        if (afficherNom) Text(nom, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * Un bloc qu'on déplie, et qui dit ce qu'il contient même replié.
 *
 * Les filtres de genre occupaient une vingtaine de puces déroulées en permanence en tête de
 * catalogue. Au doigt, elles repoussaient la première jaquette hors de l'écran ; à la télécommande,
 * c'était pire — le parcours au focus devait traverser les vingt pour atteindre la grille, alors
 * qu'on ne s'en sert qu'une fois de temps en temps.
 *
 * Replié par défaut, donc. Mais un filtre actif qu'on ne voit plus est un piège : « pourquoi n'y a-t-il
 * que quatre films ? » sans rien à l'écran qui l'explique. L'en-tête porte donc en permanence le
 * nombre de critères retenus et leur énumération : l'état reste lisible, seul l'outil se range.
 */
@Composable
fun SectionRepliable(
    titre: String,
    resume: String,
    modifier: Modifier = Modifier,
    compte: Int = 0,
    contenu: @Composable ColumnScope.() -> Unit,
) {
    // `rememberSaveable` : le repli survit à une rotation et au retour depuis une fiche. Le refermer
    // à chaque aller-retour serait exactement le genre de détail qui use.
    var ouvert by rememberSaveable(titre) { mutableStateOf(false) }
    val rotation by animateFloatAsState(if (ouvert) 90f else 0f, label = "flèche de repli")
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(RayonCommande))
            .border(1.dp, Ligne, RoundedCornerShape(RayonCommande)),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .semantics {
                    stateDescription = if (ouvert) "Déplié" else "Replié"
                }
                .cliquableAuFocus(arrondi = RayonCommande.value.toInt()) { ouvert = !ouvert }
                // Quarante-huit points de haut : sous cette taille, un pouce rate sa cible plus
                // souvent qu'il ne l'atteint.
                .heightIn(min = 48.dp)
                .padding(horizontal = 13.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("▸", Modifier.rotate(rotation), color = Muet, fontSize = 15.sp)
            Spacer(Modifier.width(11.dp))
            Text(titre, fontWeight = FontWeight.Bold)
            if (compte > 0) {
                Spacer(Modifier.width(9.dp))
                Text(
                    "$compte",
                    Modifier
                        .clip(RoundedCornerShape(50))
                        .background(Bleu)
                        .padding(horizontal = 8.dp, vertical = 2.dp),
                    color = Color.White,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            Spacer(Modifier.weight(1f))
            Text(
                resume,
                Modifier.widthIn(max = 240.dp),
                color = Muet,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.End,
            )
        }
        AnimatedVisibility(ouvert) {
            Column(
                Modifier.padding(start = 13.dp, end = 13.dp, bottom = 12.dp),
                content = contenu,
            )
        }
    }
}

/**
 * Un bouton de texte qui se désigne au focus et répond au **premier** appui.
 *
 * `TextButton` est déjà focalisable ; lui superposer un `focusable()` lui donnait une seconde cible et
 * obligeait à valider deux fois à la télécommande. Ici la même source d'interaction alimente le
 * bouton et son liseré : une cible, un appui.
 */
@Composable
fun BoutonTexte(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    arrondi: Int = 10,
    contenu: @Composable RowScope.() -> Unit,
) {
    val source = rememberSourceFocus()
    TextButton(
        onClick,
        modifier.indicationFocus(source, arrondi),
        interactionSource = source,
        content = contenu,
    )
}

/**
 * La version installée, présentée comme une puce de filtre.
 *
 * Même dessin que `PuceFiltre` au repos — contour fin, coins à dix, texte en retrait — mais **sans
 * focus ni clic** : c'est une mention, pas une commande. L'ajouter à la navigation de la télécommande
 * allongerait le parcours vers la grille pour un texte qu'on ne fait que lire.
 *
 * Le texte vient de `BuildConfig.VERSION_NAME`, donc il suit la construction sans qu'on ait à y
 * penser. Voir [intituleVersion].
 */
@Composable
fun PuceVersion(nomDeVersion: String, modifier: Modifier = Modifier, taillePolice: Int = 13) {
    Box(
        modifier
            .border(1.dp, Ligne, RoundedCornerShape(10.dp))
            .padding(horizontal = 10.dp, vertical = 5.dp),
    ) {
        Text(intituleVersion(nomDeVersion), color = Muet, fontSize = taillePolice.sp, maxLines = 1)
    }
}

/** Une puce de filtre, même principe : une seule cible de focus, donc un seul appui. */
@Composable
fun PuceFiltre(
    retenu: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    libelle: @Composable () -> Unit,
) {
    val source = rememberSourceFocus()
    FilterChip(
        retenu,
        onClick,
        libelle,
        modifier.indicationFocus(source, 10),
        interactionSource = source,
    )
}

/**
 * Un bloc cliquable qui réagit au focus, employé partout où l'on vise à la télécommande.
 *
 * Il vivait en privé dans `MainActivity` sous le nom `FocusCard` : les autres écrans ne pouvaient pas
 * s'en servir, et redessinaient leur propre version sans indication de focus.
 */
@Composable
fun BlocFocalisable(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    arrondi: Int = 16,
    contenu: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.cliquableAuFocus(arrondi, onClick = onClick).padding(4.dp), content = contenu)
}
