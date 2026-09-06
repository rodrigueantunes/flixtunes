package tv.flixtunes.app.ui.ecrans

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed as gridItemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.SingletonImageLoader
import coil3.request.ImageRequest
import coil3.size.Size
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import tv.flixtunes.app.*
import tv.flixtunes.app.data.*
import tv.flixtunes.app.data.Media
import tv.flixtunes.app.ui.*
import tv.flixtunes.app.ui.Accroche
import tv.flixtunes.app.ui.ApprocheTitre
import tv.flixtunes.app.ui.Bleu
import tv.flixtunes.app.ui.BleuClair
import tv.flixtunes.app.ui.BoutonTexte
import tv.flixtunes.app.ui.CarteMedia
import tv.flixtunes.app.ui.EncreProfonde
import tv.flixtunes.app.ui.Ligne
import tv.flixtunes.app.ui.LocalGabarit
import tv.flixtunes.app.ui.Muet
import tv.flixtunes.app.ui.PoliceTitre
import tv.flixtunes.app.ui.PuceFiltre
import tv.flixtunes.app.ui.RayonCommande
import tv.flixtunes.app.ui.SectionRepliable
import tv.flixtunes.app.ui.TexteDoux
import tv.flixtunes.app.ui.cliquableAuFocus
import tv.flixtunes.app.ui.LocalMemoireTv
import tv.flixtunes.app.ui.tailleTextureJaquetteTv

/**
 * `.catalog-page` — le catalogue complet, avec l'en-tête et les commandes du Web.
 *
 * Tri, état, recherche interne et genres n'existaient pas ici. Sur une médiathèque de mille cinq cents
 * films, un catalogue sans filtre ne se parcourt pas : il se subit. Les critères partent au serveur,
 * qui les applique sur l'ensemble — les appliquer sur les fiches déjà reçues afficherait un décompte
 * faux dès la deuxième page.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun GrilleCatalogue(
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
    /**
     * Cette grille sert des chaînes web, pas des films ni des séries.
     *
     * Seule la seconde ligne des cartes en dépend, et le défaut laisse Films et Séries exactement
     * dans l'état où ils étaient.
     */
    rayonWeb: Boolean = false,
) {
    val gabarit = LocalGabarit.current
    val edge = gabarit.margeBord.dp
    // Une seule demande reste en attente : pendant un maintien D-pad, la position la plus récente
    // remplace l'ancienne sans interrompre les quelques bitmaps déjà en cours de préparation.
    val demandesPrecharge = remember { Channel<Int>(capacity = Channel.CONFLATED) }
    if (gabarit.televiseur) {
        val contexte = LocalContext.current
        val chargeurImages = remember(contexte) { SingletonImageLoader.get(contexte) }
        val largeurJaquettePx = tailleTextureJaquetteTv(LocalMemoireTv.current)
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
        // Une chaîne n'a pas de saisons : dans le rayon Web, la carte n'écrit rien sous son nom.
        sousTitre = if (rayonWeb) ({ media -> media.texteSecondaireWeb }) else null,
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
@Composable internal fun IndexAlphabetique(
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
@Composable internal fun GrilleMedia(
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
    /**
     * Comment nommer la seconde ligne d'une carte, quand le rayon le sait mieux que le média.
     *
     * Cette grille sert le catalogue, la recherche et l'historique : elle n'a pas à connaître les
     * rayons. Elle accepte seulement qu'on lui dicte cette ligne, et s'en remet au média sinon.
     */
    sousTitre: ((Media) -> String)? = null,
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
                focusPris = { focusPris(rang) },
                sousTitre = sousTitre?.invoke(item))
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
@Composable internal fun ChoixDeroulant(
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
