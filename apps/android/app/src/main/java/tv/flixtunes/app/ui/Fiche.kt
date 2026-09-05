package tv.flixtunes.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import tv.flixtunes.app.data.Media
import tv.flixtunes.app.data.Season
import tv.flixtunes.app.data.SourceVersion
import kotlin.math.roundToInt

/**
 * Les blocs de la fiche détaillée, transcrits du client Web.
 *
 * C'est l'écran où les deux clients divergeaient le plus. Le Web présente une saison comme une œuvre :
 * sa jaquette, son nombre d'épisodes, son titre, son résumé. Android la présentait comme un réglage —
 * une puce « Saison 1 », « Saison 2 » dans une rangée de filtres, sans image, sans résumé, sans le
 * moindre indice de ce qu'elle contient. Le geste était le même ; ce qu'on voit avant de le faire ne
 * l'était pas du tout.
 *
 * Même écart sur les épisodes : le Web donne durée, résumé, avancement et un bouton « marquer vu » ;
 * Android donnait un numéro et un titre.
 */

/**
 * `.season-card` — une saison, présentée par sa jaquette.
 *
 * Quand la saison n'a pas d'affiche propre, le Web reprend celle de la série ; à défaut seulement, il
 * affiche le numéro en très grand caractère en réserve. C'est le même ordre ici : une image, même
 * empruntée à la série, en dit plus long qu'un chiffre.
 */
@Composable
fun CarteSaison(
    saison: Season,
    jaquette: String?,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val gabarit = LocalGabarit.current
    Column(
        modifier
            .width(gabarit.largeurSaison.dp)
            .clip(RoundedCornerShape(RayonPanneau))
            .background(if (active) SelectionFond else Color.White.copy(alpha = .016f))
            .border(
                1.dp,
                if (active) SelectionBordure else Color.Transparent,
                RoundedCornerShape(RayonPanneau),
            )
            .cliquableAuFocus(
                arrondi = RayonPanneau.value.toInt(),
                selectionne = active,
                onClickLabel = if (saison.estDossier) "Ouvrir le dossier ${saison.title}"
                else "Afficher la saison ${saison.number}",
                onClick = onClick,
            ),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(topStart = RayonJaquette, topEnd = RayonJaquette))
                .background(Brush.linearGradient(listOf(SaisonJaquetteHaut, SaisonJaquetteBas))),
            contentAlignment = Alignment.Center,
        ) {
            if (jaquette.isNullOrBlank()) {
                Text(
                    // Un dossier n'a pas de numéro : il porte son nom, et c'est lui qu'on cherche.
                    if (saison.estDossier) saison.title.take(2).uppercase() else "${saison.number}",
                    color = Color.White.copy(alpha = .15f),
                    fontSize = 58.sp,
                    fontFamily = PoliceTitre,
                    fontWeight = FontWeight.ExtraBold,
                )
            } else {
                ImageOptimiseeTv(jaquette, FormatImageTv.SAISON, Modifier.fillMaxSize(), ContentScale.Crop)
            }
            // Le dégradé du bas, `.season-poster::after` : il détache la pastille du nombre
            // d'épisodes d'une affiche claire, où elle deviendrait illisible.
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Brush.verticalGradient(0.55f to Color.Transparent, 1f to Encre.copy(alpha = .85f))),
            )
            Text(
                if (saison.estDossier) "${saison.episodes.size} vidéo${if (saison.episodes.size > 1) "s" else ""}"
                else "${saison.episodes.size} épisode${if (saison.episodes.size > 1) "s" else ""}",
                Modifier
                    .align(Alignment.BottomEnd)
                    .padding(9.dp)
                    .clip(RoundedCornerShape(RayonPastilleCarte))
                    .background(Encre.copy(alpha = .79f))
                    .padding(horizontal = 7.dp, vertical = 4.dp),
                color = Color(0xFFD9E5FF),
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
            )
        }
        Text(
            saison.title.ifBlank { "Saison ${saison.number}" },
            Modifier.padding(start = 12.dp, end = 12.dp, top = 9.dp),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            fontWeight = FontWeight.Bold,
        )
        Text(
            saison.overview
                ?: if (saison.estDossier) "Voir les vidéos de ce dossier"
                else "Voir les épisodes de la saison ${saison.number}",
            Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp).heightIn(min = 28.dp),
            color = Muet,
            fontSize = 11.sp,
            lineHeight = 14.sp,
            minLines = 2,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * `.episodes > div > article` — une ligne d'épisode.
 *
 * Trois colonnes, comme dans le Web : la vignette de lecture portant le numéro, le bloc de texte, et
 * l'action « marquer vu ». La barre d'avancement passe sous le texte : c'est elle qui distingue un
 * épisode commencé d'un épisode intact, information qu'Android n'affichait nulle part.
 */
@Composable
fun LigneEpisode(
    episode: Media,
    vu: Boolean,
    lire: () -> Unit,
    basculerVu: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val gabarit = LocalGabarit.current
    val vignette: @Composable () -> Unit = {
        Box(
            Modifier
                .size(110.dp, 74.dp)
                .clip(RoundedCornerShape(RayonCommande))
                .background(Brush.linearGradient(listOf(EpisodeHaut, EpisodeBas)))
                .cliquableAuFocus(
                    arrondi = RayonCommande.value.toInt(),
                    onClickLabel = "Lire ${episode.title}",
                    onClick = lire,
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "${episode.episodeNumber ?: 0}",
                fontSize = 22.sp,
                fontFamily = PoliceTitre,
                fontWeight = FontWeight.ExtraBold,
                color = Color.White,
            )
            Text("▶", Modifier.align(Alignment.BottomEnd).padding(9.dp), fontSize = 12.sp, color = Color.White)
        }
    }
    val informations: @Composable (Modifier) -> Unit = { emplacement ->
        Column(emplacement.padding(horizontal = 18.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(episode.title, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                episode.runtimeSeconds?.let { "${(it / 60.0).roundToInt()} min" } ?: "Durée inconnue",
                color = Muet,
                fontSize = 12.sp,
            )
            Text(
                episode.overview ?: "Description non disponible.",
                color = Muet,
                fontSize = gabarit.tailleTexte.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            // Toujours présente, même à zéro : la ligne de base reste la même d'un épisode à l'autre,
            // sinon la liste tressaute dès qu'un épisode a été commencé.
            LinearProgressIndicator(
                { episode.progressPercent / 100f },
                Modifier.fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)),
                color = Bleu,
                trackColor = Color.White.copy(alpha = .09f),
                gapSize = 0.dp,
                drawStopIndicator = {},
            )
        }
    }
    val actionVu: @Composable () -> Unit = {
        Text(
            if (vu) "Vu ✓" else "Marquer vu",
            Modifier
                .clip(RoundedCornerShape(9.dp))
                .border(1.dp, Ligne, RoundedCornerShape(9.dp))
                .heightIn(min = 48.dp)
                .cliquableAuFocus(arrondi = 9, onClick = basculerVu)
                .padding(horizontal = 11.dp, vertical = 9.dp),
            color = if (vu) Vu else TexteCommande,
            fontSize = 12.sp,
        )
    }
    BoxWithConstraints(modifier.fillMaxWidth()) {
        val compact = maxWidth < 420.dp
        if (compact) {
            Column(Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    vignette()
                    informations(Modifier.weight(1f))
                }
                Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.CenterEnd) { actionVu() }
            }
        } else {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 105.dp).padding(vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                vignette()
                informations(Modifier.weight(1f))
                actionVu()
            }
        }
    }
}

/**
 * `.source-details` — le fichier d'origine et, s'il y en a plusieurs, la version à lire.
 *
 * Le chemin absolu reste côté serveur : l'afficher divulguerait l'organisation du NAS sans aider à
 * comprendre une erreur d'identification. Seul le nom du fichier — ou du dossier racine pour une
 * série — sert à cela.
 */
@Composable
fun BlocSource(
    intitule: String,
    nom: String,
    versions: List<SourceVersion>,
    versionChoisie: String?,
    choisir: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(RayonPanneau))
            .background(SourceFond)
            .border(1.dp, SourceBordure, RoundedCornerShape(RayonPanneau))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Text(
            intitule.uppercase(),
            color = Muet,
            fontSize = 11.sp,
            fontWeight = FontWeight.ExtraBold,
            letterSpacing = 0.08.em,
        )
        Text(nom, fontWeight = FontWeight.SemiBold)
        if (versions.size > 1) {
            Spacer(Modifier.height(4.dp))
            for (version in versions) {
                val active = version.mediaId == versionChoisie
                Column(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(RayonCommande))
                        .background(if (active) SelectionFond else Color.White.copy(alpha = .03f))
                        .border(
                            1.dp,
                            if (active) BleuClair else Color.White.copy(alpha = .09f),
                            RoundedCornerShape(RayonCommande),
                        )
                        .cliquableAuFocus(
                            arrondi = RayonCommande.value.toInt(),
                            role = Role.RadioButton,
                            selectionne = active,
                        ) { choisir(version.mediaId) }
                        .padding(horizontal = 13.dp, vertical = 11.dp),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Text(version.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        listOfNotNull(version.quality, version.fileSizeBytes?.let(::tailleLisible))
                            .joinToString(" · ")
                            .ifBlank { "Version" },
                        color = Color(0xFF9FB8E8),
                        fontSize = 11.sp,
                    )
                }
            }
        }
    }
}

/** Une taille de fichier en unité lisible, comme le fait le client Web sur la même ligne. */
fun tailleLisible(octets: Long): String {
    if (octets <= 0) return "taille inconnue"
    val giga = octets / 1_073_741_824.0
    if (giga >= 1) return "${((giga * 10).roundToInt() / 10.0)} Go"
    return "${(octets / 1_048_576.0).roundToInt()} Mo"
}
