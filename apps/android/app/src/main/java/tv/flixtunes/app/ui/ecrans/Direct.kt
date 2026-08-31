package tv.flixtunes.app.ui.ecrans

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.flixtunes.app.MainViewModel
import tv.flixtunes.app.R
import tv.flixtunes.app.SectionDirect
import tv.flixtunes.app.data.ChaineDirect
import tv.flixtunes.app.ui.ApprocheTitre
import tv.flixtunes.app.ui.BleuClair
import tv.flixtunes.app.ui.BoutonTexte
import tv.flixtunes.app.ui.FormatImageTv
import tv.flixtunes.app.ui.ImageOptimiseeTv
import tv.flixtunes.app.ui.LocalGabarit
import tv.flixtunes.app.ui.Muet
import tv.flixtunes.app.ui.PoliceTitre
import tv.flixtunes.app.ui.PuceFiltre
import tv.flixtunes.app.ui.RayonCommande
import tv.flixtunes.app.ui.SectionRepliable
import tv.flixtunes.app.ui.cliquableAuFocus

/**
 * La grille des chaînes en direct, sur Android.
 *
 * Elle suit le Web, qui est la référence graphique du projet : mêmes filtres, même recherche, même
 * ordre. Trois choses lui sont propres, et chacune vient d'un chiffre ou d'une surface :
 *
 * - **le numéro passe avant le nom**, parce que c'est par lui qu'on choisit à la télécommande — et
 *   parce qu'on peut le composer, ce que la surface tactile ne permet pas ;
 * - **rien n'est chargé d'avance** : le corpus mesuré compte 76 823 chaînes, demandées par soixante ;
 * - **les filtres sont des sections repliables**, exactement comme les genres du catalogue. C'est le
 *   composant qui existe déjà ici, et refermer le volet évite qu'un pays parmi soixante ne repousse
 *   la première chaîne hors de l'écran.
 */

/** Ce que mesure chaque pastille de fiabilité : la part des flux d'une liste qui répondent. */
private val FIABILITES = listOf(
    "bonne" to "✅ 75 % et plus",
    "moyenne" to "〰️ 50 à 74 %",
    "faible" to "❌ 25 à 49 %",
    "douteuse" to "⚠️ non mesurée",
)

@OptIn(ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
internal fun EcranDirect(
    section: SectionDirect,
    model: MainViewModel,
    jouer: (ChaineDirect) -> Unit,
    bottomInset: Dp,
    grille: LazyGridState,
) {
    val gabarit = LocalGabarit.current
    val marge = gabarit.margeBord.dp

    // La première page se demande à l'ouverture, une seule fois — comme le catalogue.
    LaunchedEffect(section.disponible) { if (section.disponible && !section.loaded) model.chargerChaines(reset = true) }

    /*
     * La page suivante se demande à l'approche du bas, pas à son atteinte.
     *
     * Douze cartes d'avance laissent le temps de la requête pendant qu'on fait défiler. Arriver au
     * bord avant de demander produit une grille qui s'arrête, puis repart — et sur un téléviseur,
     * c'est le focus qui se cogne au vide.
     */
    val bientotEnBas by remember {
        derivedStateOf {
            val dernier = grille.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            dernier >= grille.layoutInfo.totalItemsCount - 12
        }
    }
    LaunchedEffect(bientotEnBas, section.items.size) { if (bientotEnBas && section.hasMore) model.chargerChaines() }

    LazyVerticalGrid(
        columns = GridCells.Adaptive(if (gabarit.televiseur) 180.dp else 120.dp),
        state = grille,
        contentPadding = PaddingValues(start = marge, end = marge, bottom = bottomInset + 24.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        item(span = { GridItemSpanPleineLargeur() }) {
            Column(Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
                Text(
                    stringResource(R.string.direct_titre),
                    fontSize = gabarit.tailleTitre.sp,
                    fontFamily = PoliceTitre,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = ApprocheTitre,
                )
                Text("${section.total} chaînes", color = Muet)

                SectionRepliable(
                    titre = stringResource(R.string.direct_recherche),
                    resume = section.query.ifBlank { stringResource(R.string.catalogue_recherche_aucune) },
                    compte = if (section.query.isBlank()) 0 else 1,
                ) {
                    OutlinedTextField(
                        section.query,
                        { grille.requestScrollToItem(0); model.filtrerDirect(query = it) },
                        Modifier.fillMaxWidth().widthIn(max = 420.dp),
                        placeholder = { Text(stringResource(R.string.direct_recherche), color = Muet) },
                        singleLine = true,
                        shape = RoundedCornerShape(RayonCommande),
                    )
                }

                /*
                 * Deux interrupteurs plutôt que deux volets : ils n'ont qu'un état, et ce sont les
                 * deux qu'on actionne le plus. Un volet à déplier coûterait deux gestes pour un — et
                 * à la télécommande, deux pressions de plus avant le premier choix.
                 */
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                    PuceFiltre(section.favorisSeuls, {
                        grille.requestScrollToItem(0); model.filtrerDirect(favorisSeuls = !section.favorisSeuls)
                    }) { Text(stringResource(R.string.direct_mes_chaines), fontSize = 13.sp) }
                    PuceFiltre(section.masquerMortes, {
                        grille.requestScrollToItem(0); model.filtrerDirect(masquerMortes = !section.masquerMortes)
                    }) { Text(stringResource(R.string.direct_masquer_mortes), fontSize = 13.sp) }
                }

                /*
                 * Reprendre là où l'on s'était arrêté — ce que fait un téléviseur qu'on rallume.
                 *
                 * La chaîne vient du serveur : on la retrouve depuis le salon comme depuis le
                 * téléphone. Elle disparaît dès qu'on cherche : au milieu d'une recherche, elle
                 * serait un résultat qui n'en est pas un.
                 */
                val derniere = section.derniere
                if (derniere != null && section.query.isBlank() && !section.favorisSeuls) {
                    Row(
                        Modifier
                            .padding(top = 8.dp)
                            .cliquableAuFocus(RayonCommande.value.toInt()) { jouer(derniere) }
                            .clip(RoundedCornerShape(RayonCommande))
                            .background(Color.White.copy(alpha = .04f))
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(stringResource(R.string.direct_reprendre), color = Muet, fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold)
                        Text(
                            listOfNotNull(derniere.numero?.toString(), derniere.nom).joinToString(" · "),
                            color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold,
                        )
                    }
                }

                /*
                 * Le pays d'abord : c'est le filtre qui sert le plus.
                 *
                 * Chercher « canal » sur un corpus mondial rend 1 141 chaînes — le mot est espagnol
                 * et portugais — et s'en tenir à la France ramène ce nombre à dix-sept. Aucun
                 * classement ne pouvait réparer cela : tous ces résultats sont justes.
                 */
                if (section.pays.isNotEmpty()) VoletFiltre(
                    titre = "Pays",
                    resume = section.paysChoisis.mapNotNull { code -> section.pays.find { it.code == code }?.nom }
                        .joinToString(", ").ifBlank { "tous" },
                    compte = section.paysChoisis.size,
                    choix = section.pays.map { it.code to "${it.nom} (${it.chaines})" },
                    retenus = section.paysChoisis,
                    effacer = { grille.requestScrollToItem(0); model.filtrerDirect(pays = emptyList()) },
                ) { grille.requestScrollToItem(0); model.filtrerDirect(pays = bascule(section.paysChoisis, it)) }

                if (section.listes.size > 1) VoletFiltre(
                    titre = "Listes",
                    resume = if (section.listesChoisies.isEmpty()) "toutes (${section.listes.size})"
                        else "${section.listesChoisies.size} choisie(s)",
                    compte = section.listesChoisies.size,
                    choix = section.listes.map { it.id to "${it.nom} (${it.chaines})" },
                    retenus = section.listesChoisies,
                    effacer = { grille.requestScrollToItem(0); model.filtrerDirect(listes = emptyList()) },
                ) { grille.requestScrollToItem(0); model.filtrerDirect(listes = bascule(section.listesChoisies, it)) }

                if (section.fiabilites.size > 1) VoletFiltre(
                    titre = "Fiabilité",
                    resume = if (section.fiabilitesChoisies.isEmpty()) "toutes" else "${section.fiabilitesChoisies.size} retenue(s)",
                    compte = section.fiabilitesChoisies.size,
                    choix = FIABILITES.filter { bande -> section.fiabilites.any { it.classement == bande.first } }
                        .map { bande ->
                            bande.first to "${bande.second} (${section.fiabilites.first { it.classement == bande.first }.listes})"
                        },
                    retenus = section.fiabilitesChoisies,
                    effacer = { grille.requestScrollToItem(0); model.filtrerDirect(fiabilites = emptyList()) },
                ) { grille.requestScrollToItem(0); model.filtrerDirect(fiabilites = bascule(section.fiabilitesChoisies, it)) }
            }
        }

        items(section.items, key = { it.id }) { chaine ->
            CarteChaine(chaine, gabarit.televiseur, jouer) { model.basculerFavoriDirect(chaine) }
        }

        if (section.items.isEmpty() && !section.loading) {
            item(span = { GridItemSpanPleineLargeur() }) {
                Box(Modifier.fillMaxWidth().height(160.dp), contentAlignment = Alignment.Center) {
                    Text(stringResource(R.string.direct_vide), color = Muet)
                }
            }
        }
    }
}

/** Un élément qui occupe toute la largeur de la grille, quelle que soit la colonne courante. */
private fun androidx.compose.foundation.lazy.grid.LazyGridItemSpanScope.GridItemSpanPleineLargeur() =
    androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan)

private fun bascule(choisis: List<String>, valeur: String): List<String> =
    if (valeur in choisis) choisis - valeur else choisis + valeur

/**
 * Un filtre repliable, à puces — le composant des genres du catalogue, sans rien de neuf.
 *
 * Replié par défaut : soixante pays ou cinq cents listes déroulés en permanence repousseraient la
 * première chaîne hors de l'écran, et obligeraient la télécommande à tout traverser pour l'atteindre.
 * Le résumé garde ce qui compte — ce qui est coché —, seul l'outil se range.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun VoletFiltre(
    titre: String,
    resume: String,
    compte: Int,
    choix: List<Pair<String, String>>,
    retenus: List<String>,
    effacer: () -> Unit,
    basculer: (String) -> Unit,
) {
    SectionRepliable(titre = titre, resume = resume, compte = compte) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((valeur, libelle) in choix) {
                PuceFiltre(valeur in retenus, { basculer(valeur) }) { Text(libelle, fontSize = 13.sp) }
            }
            if (retenus.isNotEmpty()) {
                BoutonTexte(effacer) { Text(stringResource(R.string.catalogue_genres_effacer), color = Muet, fontSize = 13.sp) }
            }
        }
    }
}

/**
 * Une chaîne dans la grille : le numéro, le logo, le nom.
 *
 * Le logo vient d'un hébergeur quelconque et manque une fois sur trois — l'initiale prend sa place
 * plutôt qu'un cadre vide. Et « 3 sources » n'est pas un détail de plomberie : c'est la profondeur du
 * repli, donc la probabilité que la chaîne réponde.
 */
@Composable
private fun CarteChaine(
    chaine: ChaineDirect,
    televiseur: Boolean,
    jouer: (ChaineDirect) -> Unit,
    basculerFavori: () -> Unit,
) {
    // Le libellé se résout ici : `semantics` n'est pas un composable et ne peut pas lire les ressources.
    val libelleEtoile = stringResource(
        if (chaine.favori) R.string.direct_retirer else R.string.direct_garder, chaine.nom,
    )
    Box(Modifier.fillMaxWidth()) {
        /*
         * Toutes les cartes ont la même taille, quel que soit leur contenu.
         *
         * Une grille CSS étire ses cellules à la hauteur de la plus grande : c'est pourquoi le Web
         * était déjà régulier, et pourquoi personne n'y avait rien écrit. `LazyVerticalGrid` ne le
         * fait pas — il laisse chaque carte à la hauteur de son contenu, si bien qu'un logo absent ou
         * un groupe non renseigné rétrécissait la sienne et faisait un damier. Le carré règle les deux
         * à la fois : la hauteur suit la largeur de la colonne, donc toutes les cartes d'une ligne
         * sont identiques, et le contenu se centre dedans plutôt que de la remplir.
         *
         * Le rapport de un pour un est celui du Web, où le squelette de chargement est déjà carré.
         */
        Column(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .cliquableAuFocus(RayonCommande.value.toInt()) { jouer(chaine) }
                .clip(RoundedCornerShape(RayonCommande))
                .background(Color.White.copy(alpha = .04f))
                .padding(vertical = 10.dp, horizontal = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
        Text(chaine.numero?.toString() ?: "—", color = BleuClair, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        // 44 dp sur mobile, comme le `clamp(44px, 4vw, 64px)` du Web : au-delà, le carré déborde.
        /*
         * Le logo entier, jamais recadré — et l'initiale quand il manque.
         *
         * Il était affiché comme une jaquette : `ContentScale.Crop` sur une texture demandée au format
         * 2:3. Un logo n'a pas de format, il y en a des larges et des hauts, et les rogner au carré
         * coupait « BFM TV » et « RMC Découverte » de leurs côtés. Le Web les montre entiers depuis le
         * début — `object-fit: contain` —, c'est lui la référence.
         *
         * Et le logo vient d'un hébergeur quelconque : il disparaît sans prévenir. Une case vide au
         * milieu d'une grille se remarque plus qu'une lettre, d'où le repli sur l'initiale, qui est
         * déjà ce qu'on affiche quand la liste n'en donne aucun.
         */
        Box(Modifier.size(if (televiseur) 60.dp else 44.dp), contentAlignment = Alignment.Center) {
            val logo = chaine.logo
            var echec by remember(logo) { mutableStateOf(false) }
            if (logo.isNullOrBlank() || echec) {
                Text(chaine.nom.trim().take(1).uppercase().ifBlank { "?" },
                    color = Color.White.copy(alpha = .5f), fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
            } else {
                ImageOptimiseeTv(logo, FormatImageTv.LOGO, Modifier.fillMaxSize(), ContentScale.Fit) { echec = true }
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(chaine.nom, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
            maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        Text(
            if (chaine.adresses > 1) stringResource(R.string.direct_sources, chaine.adresses) else chaine.groupe.orEmpty(),
            color = Muet, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
        )
        }
        /*
         * L'étoile, posée sur la carte sans en faire partie.
         *
         * Valider une carte ouvre la chaîne : c'est le geste principal, et rien ne doit le rendre
         * hésitant. L'étoile est donc une cible distincte, atteignable au focus comme au doigt, et
         * son libellé dit ce qu'elle fera — pas ce qu'elle montre.
         */
        Text(
            if (chaine.favori) "★" else "☆",
            Modifier
                .align(Alignment.TopEnd)
                .cliquableAuFocus(999) { basculerFavori() }
                .padding(6.dp)
                .semantics { contentDescription = libelleEtoile },
            color = if (chaine.favori) EtoileRetenue else Muet,
            fontSize = 15.sp,
        )
    }
}

/** L'or de l'étoile retenue. Il ne sert qu'ici, et ne mérite pas d'entrer dans les jetons communs. */
private val EtoileRetenue = Color(0xFFFFCF5C)
