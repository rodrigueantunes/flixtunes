package tv.flixtunes.app.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.InteractionSource
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * Rend un élément visible quand la télécommande le désigne — et cliquable du premier coup.
 *
 * Sans indication, la navigation à la croix directionnelle est aveugle : le focus se déplace, rien ne
 * bouge à l'écran, et l'on ne découvre où l'on était qu'en validant. Deux signaux plutôt qu'un : le
 * liseré désigne, l'agrandissement avance vers le spectateur. À trois mètres, un seul des deux passe
 * souvent inaperçu — une bordure fine se perd sur un fond clair, un agrandissement seul se confond
 * avec le défilement. Au doigt, l'effet s'annule de lui-même : le gabarit tactile porte une échelle de
 * 1 et une bordure de zéro, et le même code sert donc les deux surfaces sans condition à écrire.
 *
 * ## Pourquoi il fallait deux fois « OK »
 *
 * La version précédente ajoutait son propre `focusable()` à la fin de la chaîne. Or tout ce sur quoi
 * elle s'appliquait était **déjà** focalisable : un `clickable` l'est par construction, un `Button` de
 * Material aussi. Chaque bouton portait donc **deux cibles de focus** empilées dans la même chaîne —
 * celle qui dessine le liseré, et celle qui sait répondre à la validation. La croix directionnelle
 * s'arrêtait sur la première, la validation n'y déclenchait rien, et il fallait un second appui pour
 * atteindre la seconde. Un bouton sur téléviseur demandait deux « OK ».
 *
 * La correction tient en un principe : **une cible de focus par élément**. L'indication ne crée plus
 * de cible, elle *lit* celle qui existe déjà, à travers la source d'interaction que le `clickable` ou
 * le `Button` alimente. Le liseré et le clic décrivent alors le même nœud, et le premier appui agit.
 */

/** La source d'interaction d'un élément, à passer à la fois à son indication et à son clic. */
@Composable
fun rememberSourceFocus(): MutableInteractionSource = remember { MutableInteractionSource() }

/**
 * L'indication visuelle seule, branchée sur une cible de focus **existante**.
 *
 * À employer avec un composant qui gère déjà son clic — `Button`, `TextButton`, `FilterChip` — en lui
 * passant la même [source]. Pour un bloc quelconque, `cliquableAuFocus` fait les deux d'un coup.
 */
@Composable
fun Modifier.indicationFocus(source: InteractionSource, arrondi: Int = 16): Modifier {
    val gabarit = LocalGabarit.current
    val vise = source.collectIsFocusedAsState()
    // La télécommande produit plusieurs changements de focus par seconde. Deux animateurs sur chaque
    // carte créaient des images intermédiaires sans bénéfice perceptible à trois mètres. Le même relief
    // (échelle 1,06 et liseré blanc) s'applique immédiatement sur TV ; le tactile garde sa transition.
    return if (gabarit.televiseur) {
        this
            .drawWithContent {
                // `graphicsLayer` créait un RenderNode et une texture distincte pour chaque élément,
                // même lorsque son échelle valait 1. Une grille de six colonnes gardait donc des
                // dizaines de calques à composer sur le GPU du téléviseur. La transformation directe
                // ne coûte quelque chose qu'au seul élément focalisé et ne relance pas la composition.
                val contenu = this
                if (vise.value && gabarit.focusEchelle != 1f) {
                    scale(gabarit.focusEchelle) { contenu.drawContent() }
                } else drawContent()
                if (vise.value && gabarit.focusBordure > 0) {
                    val trait = gabarit.focusBordure.dp.toPx()
                    drawRoundRect(
                        color = Color.White,
                        topLeft = Offset(trait / 2f, trait / 2f),
                        size = Size(size.width - trait, size.height - trait),
                        cornerRadius = CornerRadius(arrondi.dp.toPx()),
                        style = Stroke(trait),
                    )
                }
            }
    } else {
        val cibleBordure = if (vise.value && gabarit.focusBordure > 0) Color.White else Color.Transparent
        val cibleEchelle = if (vise.value) gabarit.focusEchelle else 1f
        val bordure = animateColorAsState(
            cibleBordure,
            animationSpec = tween(durationMillis = 160),
            label = "bordure de focus",
        ).value
        val echelle = animateFloatAsState(
            cibleEchelle,
            animationSpec = tween(durationMillis = 160),
            label = "échelle de focus",
        ).value
        this
            .graphicsLayer { scaleX = echelle; scaleY = echelle }
            .border(gabarit.focusBordure.dp, bordure, RoundedCornerShape(arrondi.dp))
    }
}

/**
 * Rend un bloc cliquable **et** visible au focus, en une seule cible.
 *
 * Remplace le couple `clickable(...).indicationFocus()`, qui en créait deux. L'ordre compte : le
 * liseré et l'agrandissement s'appliquent au-dessus, le `clickable` en dessous — c'est lui la cible,
 * et le dessin l'entoure.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun Modifier.cliquableAuFocus(
    arrondi: Int = 16,
    actif: Boolean = true,
    role: Role? = Role.Button,
    onClickLabel: String? = null,
    selectionne: Boolean? = null,
    onLongClickLabel: String? = null,
    onLongClick: (() -> Unit)? = null,
    onFocused: (() -> Unit)? = null,
    onClick: () -> Unit,
): Modifier {
    val source = rememberSourceFocus()
    val gabarit = LocalGabarit.current
    val indication = if (gabarit.televiseur) null else LocalIndication.current
    // `collectIsFocusedAsState` ouvre un collecteur de Flow pour chaque jaquette. Sur une grille TV,
    // cela faisait vivre des dizaines de coroutines uniquement pour lire un booléen de focus, puis
    // en créait d'autres à chaque rangée composée. Le nœud `onFocusChanged` reçoit le même événement
    // directement, sans animation ni collecteur ; le tactile conserve son indication animée.
    val viseTv = remember { mutableStateOf(false) }
    val avecIndication = if (gabarit.televiseur) {
        this
            .onFocusChanged {
                viseTv.value = it.hasFocus
                if (it.hasFocus) onFocused?.invoke()
            }
            .drawWithContent {
                // Pas de calque permanent par jaquette : l'état est lu au dessin et seule la carte
                // visée reçoit la transformation. Titre, image et métadonnées restent composés une fois.
                val contenu = this
                if (viseTv.value && gabarit.focusEchelle != 1f) {
                    scale(gabarit.focusEchelle) { contenu.drawContent() }
                } else drawContent()
                if (viseTv.value && gabarit.focusBordure > 0) {
                    val trait = gabarit.focusBordure.dp.toPx()
                    drawRoundRect(
                        color = Color.White,
                        topLeft = Offset(trait / 2f, trait / 2f),
                        size = Size(size.width - trait, size.height - trait),
                        cornerRadius = CornerRadius(arrondi.dp.toPx()),
                        style = Stroke(trait),
                    )
                }
            }
    } else this.indicationFocus(source, arrondi)
    return avecIndication
        .then(if (selectionne != null) Modifier.semantics { selected = selectionne } else Modifier)
        .then(if (onLongClick == null) Modifier.clickable(
            interactionSource = source, indication = indication, enabled = actif,
            role = role, onClickLabel = onClickLabel, onClick = onClick,
        ) else Modifier.combinedClickable(
            interactionSource = source, indication = indication, enabled = actif,
            role = role, onClickLabel = onClickLabel, onLongClickLabel = onLongClickLabel,
            onLongClick = onLongClick, onClick = onClick,
        ))
}
