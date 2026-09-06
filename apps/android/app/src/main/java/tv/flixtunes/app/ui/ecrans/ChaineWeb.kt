package tv.flixtunes.app.ui.ecrans

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import tv.flixtunes.app.data.Details
import tv.flixtunes.app.data.Media
import tv.flixtunes.app.data.Season
import tv.flixtunes.app.ui.EpisodeBas
import tv.flixtunes.app.ui.EpisodeHaut
import tv.flixtunes.app.ui.FormatImageTv
import tv.flixtunes.app.ui.ImageOptimiseeTv
import tv.flixtunes.app.ui.Ligne
import tv.flixtunes.app.ui.LocalGabarit
import tv.flixtunes.app.ui.Muet
import tv.flixtunes.app.ui.PoliceTitre
import tv.flixtunes.app.ui.RayonJaquette
import tv.flixtunes.app.ui.RayonPanneau
import tv.flixtunes.app.ui.Texte
import tv.flixtunes.app.ui.cliquableAuFocus

/**
 * La fiche d'une chaîne web : ses dossiers, puis ses vidéos.
 *
 * Transcrite du client Web, qui reste la référence graphique. Trois écarts avec la fiche d'une série,
 * et chacun répond à ce qui a été demandé :
 *
 * - **on voit les dossiers et on y entre.** Ce sont ceux du disque, pas une classification déduite —
 *   une série déroule ses saisons, une chaîne se parcourt ;
 * - **les cartes de vidéo sont en paysage**, parce que les plateformes produisent des vignettes 16/9
 *   et que c'est à cette forme que l'œil s'attend. Elles sont aussi plus larges que celles du direct ;
 * - **la date de publication se lit sous le titre**, puisque c'est elle qui ordonne la liste.
 *
 * Le catalogue ne connaît que trois niveaux, alors qu'une arborescence peut en compter plus. Le
 * serveur range donc le chemin relatif entier dans le libellé d'un palier — `Documentaires / 2024 /
 * Asie` —, et c'est ici qu'il est redécoupé pour redevenir un arbre parcourable.
 */

/** Le libellé que le serveur donne aux vidéos posées à la racine d'une chaîne. */
private const val HORS_DOSSIER = "Hors dossier"

private const val SEPARATEUR = " / "

/** Les segments d'un palier, vides pour les vidéos qui ne sont dans aucun dossier. */
internal fun segmentsDuPalier(saison: Season): List<String> =
    if (saison.title == HORS_DOSSIER) emptyList()
    else saison.title.split(SEPARATEUR).map { it.trim() }.filter { it.isNotEmpty() }

/** Cette chaîne est-elle une chaîne web ? Ses paliers ne contiennent que des vidéos. */
internal val Details.estChaineWeb: Boolean
    get() = seasons.isNotEmpty() && seasons.all { it.estDossier }

/**
 * L'ordre d'affichage des vidéos.
 *
 * Le plus récent d'abord par défaut, comme les plateformes le font et comme on l'attend en ouvrant une
 * chaîne. Une vidéo sans date connue ne s'intercale pas au hasard : elle passe en fin de liste dans
 * les deux sens, parce qu'on ne saurait pas où la mettre.
 */
internal enum class TriWeb(val libelle: String) {
    RECENTES("Plus récentes d'abord"),
    ANCIENNES("Plus anciennes d'abord"),
    TITRE("Ordre alphabétique"),
}

internal fun trierVideos(videos: List<Media>, tri: TriWeb): List<Media> = when (tri) {
    TriWeb.TITRE -> videos.sortedBy { it.title.lowercase() }
    else -> {
        val datees = videos.filter { !it.airDate.isNullOrBlank() }
        val sansDate = videos.filter { it.airDate.isNullOrBlank() }
        val ordre = if (tri == TriWeb.RECENTES) {
            datees.sortedByDescending { it.airDate }
        } else {
            datees.sortedBy { it.airDate }
        }
        ordre + sansDate
    }
}

/** Ce qui se trouve à ce niveau de l'arborescence : des dossiers à ouvrir, des vidéos à lire. */
internal data class NiveauWeb(
    val dossiers: List<String>,
    val videos: List<Media>,
    val comptes: Map<String, Int>,
)

internal fun niveauDe(saisons: List<Season>, chemin: List<String>, tri: TriWeb): NiveauWeb {
    val sousArbre = saisons
        .map { it to segmentsDuPalier(it) }
        .filter { (_, segments) -> chemin.indices.all { segments.getOrNull(it) == chemin[it] } }

    val dossiers = sousArbre
        .filter { (_, segments) -> segments.size > chemin.size }
        .mapNotNull { (_, segments) -> segments.getOrNull(chemin.size) }
        .distinct()
        .sortedBy { it.lowercase() }

    val comptes = dossiers.associateWith { segment ->
        sousArbre.filter { (_, segments) -> segments.getOrNull(chemin.size) == segment }
            .sumOf { (saison, _) -> saison.episodes.size }
    }

    val videos = sousArbre
        .filter { (_, segments) -> segments.size == chemin.size }
        .flatMap { (saison, _) -> saison.episodes }

    return NiveauWeb(dossiers, trierVideos(videos, tri), comptes)
}

@Composable
internal fun EcranChaineWeb(
    details: Details,
    image: (String?) -> String?,
    back: () -> Unit,
    play: (Media) -> Unit,
    ouvrirMenu: (Media) -> Unit,
) {
    val gabarit = LocalGabarit.current
    val edge = gabarit.margeBord.dp
    var chemin by remember(details.item.id) { mutableStateOf(emptyList<String>()) }
    var tri by remember(details.item.id) { mutableStateOf(TriWeb.RECENTES) }
    val niveau = remember(details, chemin, tri) { niveauDe(details.seasons, chemin, tri) }
    val grille = rememberLazyGridState()

    Column(Modifier.fillMaxSize().padding(horizontal = edge)) {
        Text(
            details.item.displayTitle,
            Modifier.padding(top = gabarit.margeEcran.dp),
            color = Texte,
            fontFamily = PoliceTitre,
            fontSize = gabarit.tailleTitreFiche.sp,
            fontWeight = FontWeight.ExtraBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        /*
         * Le fil d'Ariane porte la navigation, il n'est pas décoratif : sans lui, on entre dans une
         * arborescence sans pouvoir remonter autrement qu'en quittant la chaîne. Chaque segment
         * ramène à son niveau, et le premier ressort du rayon.
         */
        Row(
            Modifier.padding(top = 4.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MietteDeChemin("Web", back)
            for ((rang, segment) in chemin.withIndex()) {
                Text("/", color = Muet, fontSize = 13.sp)
                MietteDeChemin(segment) { chemin = chemin.take(rang + 1) }
            }
            if (niveau.videos.isNotEmpty()) {
                Text("·", color = Muet, fontSize = 13.sp)
                MietteDeChemin(tri.libelle) {
                    tri = TriWeb.entries[(tri.ordinal + 1) % TriWeb.entries.size]
                }
            }
        }

        LazyVerticalGrid(
            columns = GridCells.Adaptive(
                if (niveau.videos.isNotEmpty()) gabarit.largeurVideoWeb.dp else gabarit.largeurDossierWeb.dp,
            ),
            state = grille,
            contentPadding = PaddingValues(bottom = gabarit.margeBasse.dp),
            horizontalArrangement = Arrangement.spacedBy(gabarit.ecartCartes.dp),
            verticalArrangement = Arrangement.spacedBy(gabarit.ecartCartes.dp),
        ) {
            /*
             * Remonter d'un niveau, en tete de grille et non seulement dans le fil d'Ariane.
             *
             * Le fil est en haut de page ; au bas d'une longue liste de videos, y revenir demande de
             * remonter tout l'ecran — et a la telecommande, de traverser toutes les cartes.
             */
            if (chemin.isNotEmpty()) {
                item(key = "remonter") {
                    CarteDossierWeb(
                        nom = "Dossier parent",
                        videos = null,
                        sousTitre = chemin.getOrNull(chemin.size - 2) ?: details.item.displayTitle,
                        onClick = { chemin = chemin.dropLast(1) },
                    )
                }
            }
            items(niveau.dossiers, key = { "dossier-$it" }) { dossier ->
                CarteDossierWeb(dossier, niveau.comptes[dossier] ?: 0) { chemin = chemin + dossier }
            }
            items(niveau.videos, key = { it.id }) { video ->
                CarteVideoWeb(video, image(video.posterUrl ?: video.backdropUrl), { play(video) }) { ouvrirMenu(video) }
            }
        }
    }
}

/** Un maillon du fil d'Ariane : un mot cliquable, focalisable à la télécommande. */
@Composable
private fun MietteDeChemin(libelle: String, onClick: () -> Unit) {
    Text(
        libelle,
        Modifier
            .clip(RoundedCornerShape(8.dp))
            .cliquableAuFocus(arrondi = 8, onClickLabel = libelle, onClick = onClick)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        color = Muet,
        fontSize = 13.sp,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
    )
}

@Composable
private fun CarteDossierWeb(nom: String, videos: Int?, sousTitre: String? = null, onClick: () -> Unit) {
    val gabarit = LocalGabarit.current
    Column(
        Modifier
            .fillMaxWidth()
            .background(Color.White.copy(alpha = .031f), RoundedCornerShape(RayonPanneau))
            .border(1.dp, Ligne, RoundedCornerShape(RayonPanneau))
            .cliquableAuFocus(
                arrondi = RayonPanneau.value.toInt(),
                onClickLabel = if (videos == null) "Remonter au dossier parent" else "Ouvrir le dossier $nom",
                onClick = onClick,
            )
            .padding(gabarit.margeInterne.dp / 2),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .background(
                    Brush.linearGradient(listOf(EpisodeHaut, EpisodeBas)),
                    RoundedCornerShape(RayonJaquette),
                ),
            contentAlignment = Alignment.Center,
        ) {
            // Un dossier n'a rien à montrer : ses initiales tiennent lieu de vignette, comme le fait
            // déjà la grille du direct pour une chaîne sans logo.
            Text(
                // La remontee porte une fleche, pas des initiales : son geste est l'inverse de celui
                // d'un dossier, et la confondre ferait descendre la ou l'on voulait remonter.
                if (videos == null) "↰" else nom.take(2).uppercase(),
                color = Color.White.copy(alpha = .22f),
                fontSize = 34.sp,
                fontFamily = PoliceTitre,
                fontWeight = FontWeight.ExtraBold,
            )
        }
        Text(
            nom,
            Modifier.padding(top = 8.dp),
            color = Texte,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            if (videos == null) sousTitre.orEmpty() else "$videos vidéo${if (videos > 1) "s" else ""}",
            color = Muet,
            fontSize = 12.sp,
            maxLines = 1,
        )
    }
}

@Composable
private fun CarteVideoWeb(video: Media, vignette: String?, onClick: () -> Unit, onLongClick: () -> Unit) {
    val gabarit = LocalGabarit.current
    Column(
        Modifier
            .fillMaxWidth()
            .background(Color.White.copy(alpha = .031f), RoundedCornerShape(RayonPanneau))
            .border(1.dp, Ligne, RoundedCornerShape(RayonPanneau))
            .cliquableAuFocus(
                arrondi = RayonPanneau.value.toInt(),
                onClickLabel = "Lire ${video.title}",
                onClick = onClick,
                onLongClick = onLongClick,
            )
            .padding(gabarit.margeInterne.dp / 2),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .background(
                    Brush.linearGradient(listOf(EpisodeHaut, EpisodeBas)),
                    RoundedCornerShape(RayonJaquette),
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (vignette.isNullOrBlank()) {
                Text(
                    video.title.take(1).uppercase(),
                    color = Color.White.copy(alpha = .22f),
                    fontSize = 34.sp,
                    fontFamily = PoliceTitre,
                    fontWeight = FontWeight.ExtraBold,
                )
            } else {
                ImageOptimiseeTv(vignette, FormatImageTv.BANDEAU, Modifier.fillMaxSize())
            }
        }
        Text(
            video.title,
            Modifier.padding(top = 8.dp),
            color = Texte,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        // La date porte le tri : elle doit se lire sans ouvrir quoi que ce soit. `secondaryText` la
        // met déjà en forme, et rend « Vidéo » quand elle est inconnue — jamais une date inventée.
        Text(
            video.secondaryText,
            color = Muet,
            fontSize = 12.sp,
            maxLines = 1,
        )
    }
}
