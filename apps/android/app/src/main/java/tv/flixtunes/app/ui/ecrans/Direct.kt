package tv.flixtunes.app.ui.ecrans

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
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

        items(section.items, key = { it.id }) { chaine -> CarteChaine(chaine, jouer) }

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
private fun CarteChaine(chaine: ChaineDirect, jouer: (ChaineDirect) -> Unit) {
    Column(
        Modifier
            .cliquableAuFocus(RayonCommande.value.toInt()) { jouer(chaine) }
            .clip(RoundedCornerShape(RayonCommande))
            .background(Color.White.copy(alpha = .04f))
            .padding(vertical = 12.dp, horizontal = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(chaine.numero?.toString() ?: "—", color = BleuClair, fontSize = 12.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(6.dp))
        Box(Modifier.size(52.dp), contentAlignment = Alignment.Center) {
            val logo = chaine.logo
            if (logo.isNullOrBlank()) {
                Text(chaine.nom.trim().take(1).uppercase().ifBlank { "?" },
                    color = Color.White.copy(alpha = .5f), fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
            } else ImageOptimiseeTv(logo, FormatImageTv.SAISON, Modifier.fillMaxSize())
        }
        Spacer(Modifier.height(6.dp))
        Text(chaine.nom, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
            maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
        Text(
            if (chaine.adresses > 1) stringResource(R.string.direct_sources, chaine.adresses) else chaine.groupe.orEmpty(),
            color = Muet, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center,
        )
    }
}
