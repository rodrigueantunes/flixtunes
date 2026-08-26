package tv.flixtunes.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import tv.flixtunes.app.R

/**
 * Les jetons de style de FlixTunes, transcrits du client Web.
 *
 * Le Web et Android affichaient la même application avec deux identités. Ce n'était pas un choix :
 * `Gabarit` centralisait bien les **dimensions** de chaque surface, mais aucune couleur, aucun
 * arrondi, aucune graisse n'y figurait. Ils étaient donc écrits sur place — trois `val` privés en
 * tête de `MainActivity`, un quatrième dupliqué dans `CommandesLecteur`, des arrondis en 7, 10, 11,
 * 13, 14 et 24 dp semés dans les écrans, et `Color.Gray` là où le Web emploie `#9ba5b9`. Deux gris
 * différents pour le même rôle, et rien pour le signaler.
 *
 * Ce fichier est la traduction, valeur par valeur, de `apps/web/src/styles.css`. La règle est simple :
 * **une valeur qui existe des deux côtés s'écrit ici et nulle part ailleurs.** Quand le Web change
 * son bleu, un seul endroit change de ce côté-ci.
 *
 * Ce qui reste dans `Gabarit` : tout ce qui dépend de la surface — marges, tailles de corps, échelle
 * de focus. Une couleur ne dépend pas de la distance de lecture ; une taille, si.
 *
 * Les polices sont celles du Web, embarquées plutôt que téléchargées : l'application sert un NAS sur
 * un réseau local, et un boîtier de téléviseur n'a ni services Google ni accès à Internet garanti.
 * DM Sans et Manrope sont publiées sous licence SIL OFL 1.1, qui autorise cette redistribution.
 */

// --- Couleurs -------------------------------------------------------------------------------
// Correspondance directe avec `:root` de styles.css.

/** `#080b12` — le fond de l'application. Toujours cette couleur derrière un écran. */
val Encre = Color(0xFF080B12)

/** `#03050a` — le bas du dégradé d'ouverture, plus sombre que l'encre. */
val EncreProfonde = Color(0xFF03050A)

/** `--panel: #121722` — les surfaces posées sur l'encre. */
val Panneau = Color(0xFF121722)

/** `#10141d` — le fond des fiches et des grandes boîtes, entre l'encre et le panneau. */
val PanneauHaut = Color(0xFF10141D)

/** `--blue: #2e6bff` — l'accent, celui des boutons d'action et des barres de progression. */
val Bleu = Color(0xFF2E6BFF)

/** `--blue-light: #78a5ff` — l'accent clair : liserés de focus, compléments de titre. */
val BleuClair = Color(0xFF78A5FF)

/** `#79a8ff` — le « Tunes » de l'enseigne, seule partie colorée du nom. */
val BleuMarque = Color(0xFF79A8FF)

/** `.eyebrow { color: #8eb3ff }` — le surtitre en capitales espacées. */
val BleuAccroche = Color(0xFF8EB3FF)

/** `#f7f9ff` — la couleur du texte courant. Blanc cassé, jamais blanc pur. */
val Texte = Color(0xFFF7F9FF)

/** `#c5cddd` — les résumés et paragraphes longs, un cran sous le texte courant. */
val TexteDoux = Color(0xFFC5CDDD)

/**
 * `--muted: #9ba5b9` — les mentions secondaires.
 *
 * `Color.Gray` valait `#888888` : un gris neutre là où celui du Web tire sur le bleu. L'écart est
 * faible sur une capture et net à l'œil, parce qu'il s'agit de la couleur la plus répandue de
 * l'interface après le texte lui-même.
 */
val Muet = Color(0xFF9BA5B9)

/** `--line: rgba(255,255,255,.1)` — la séparation entre deux blocs. */
val Ligne = Color(0x1AFFFFFF)

/** `.inline-error { color: #ff9ba8 }` — les messages d'échec. */
val Erreur = Color(0xFFFF9BA8)

/** `.watched { color: #a9ffd1 }` — la pastille « déjà vu ». */
val Vu = Color(0xFFA9FFD1)

/** `rgba(7,10,17,.76)` — le voile sombre d'une pastille posée sur une jaquette. */
val VoileCarte = Color(0xC2070A11)

/** `.quality-badges span` — bordure, fond et texte du badge de qualité. */
val BadgeBordure = Color(0x6183A9FF)
val BadgeFond = Color(0x481E4DA5)
val BadgeTexte = Color(0xFFE7EFFF)

/** `.secondary { background: rgba(255,255,255,.13) }` — le bouton d'appoint. */
val BoutonSecondaireFond = Color(0x21FFFFFF)

/** `.season-card.active`, `.source-versions button.active` — la teinte d'un élément retenu. */
val SelectionFond = Color(0x242968FF)

/** `.season-card:hover { border-color: #6e9dff }` — le liseré d'un élément retenu. */
val SelectionBordure = Color(0xFF6E9DFF)

/**
 * Les trois dégradés de jaquette du Web.
 *
 * `styles.css` en change tous les trois cartes (`:nth-child(3n+2)`, `:nth-child(3n)`). Un rail dont
 * les affiches manquent n'est alors pas un bloc uni : c'est ce qui distingue une médiathèque en cours
 * d'analyse d'un écran cassé.
 */
val DEGRADES_JAQUETTE: List<Pair<Color, Color>> = listOf(
    Color(0xFF17294C) to Color(0xFF0E1420),
    Color(0xFF2B1850) to Color(0xFF11121D),
    Color(0xFF0B424B) to Color(0xFF10161B),
)

/** `.season-poster` — le dégradé d'une jaquette de saison, plus clair que celui d'un film. */
val SaisonJaquetteHaut = Color(0xFF17366D)
val SaisonJaquetteBas = Color(0xFF0D1421)

/** `.episode-play` — la vignette de lecture d'un épisode. */
val EpisodeHaut = Color(0xFF1F4489)
val EpisodeBas = Color(0xFF121A2A)

/** `.watched-toggle { color: #cbd4e5 }` — le bouton « marquer vu » d'une ligne d'épisode. */
val TexteCommande = Color(0xFFCBD4E5)

/** `.source-details` — le bloc qui montre le fichier d'origine. */
val SourceFond = Color(0xB8090D15)
val SourceBordure = Color(0x24FFFFFF)

/** `.hero` — le halo bleu qui monte derrière la vitrine d'accueil. */
val VitrineHalo = Color(0xFF1B3C7C)
val VitrineMilieu = Color(0xFF0C172B)

/** `.player-next` — le dégradé de la carte d'enchaînement, du haut clair vers le bas profond. */
val CarteHaut = Color(0xF716223A)
val CarteBas = Color(0xF70B1220)

// --- Rayons ---------------------------------------------------------------------------------
// L'échelle est courte à dessein : le Web en avait laissé filer quinze avant de les regrouper.

/** `--rayon-commande: 10px` — champs de saisie, petites commandes. */
val RayonCommande = 10.dp

/** `.primary, .secondary { border-radius: 12px }` — les boutons d'action. */
val RayonBouton = 12.dp

/** `.poster { border-radius: 13px }` — les jaquettes. */
val RayonJaquette = 13.dp

/** `--rayon-panneau: 14px` — les panneaux et les cartes. */
val RayonPanneau = 14.dp

/** `.details-modal, .library-modal` — les grandes boîtes. */
val RayonBoite = 22.dp

/** `.profile-choice > span { border-radius: 24px }` — la vignette carrée d'un profil. */
val RayonAvatar = 24.dp

/** `.watched { border-radius: 7px }` — les pastilles posées sur une jaquette. */
val RayonPastilleCarte = 7.dp

// --- Durées ---------------------------------------------------------------------------------

/** `--duree-reponse: .18s` — ce qui répond au doigt ou à la télécommande. */
const val DUREE_REPONSE = 180

/** `--duree-transition: .32s` — ce qui se déplie ou se dévoile. */
const val DUREE_TRANSITION = 320

// --- Approche typographique -----------------------------------------------------------------
// Manrope est resserrée dans le Web ; sans cette approche négative, le même titre paraît plus large
// et plus mou. C'est ce qui se remarque en premier quand on met les deux écrans côte à côte.

/** `.hero h1 { letter-spacing: -.065em }` — les très grands titres. */
val ApprocheTitre = (-0.065).em

/** `.brand { letter-spacing: -.06em }` — l'enseigne et les titres de boîte. */
val ApprocheEnseigne = (-0.06).em

/** `.rail-heading h2 { letter-spacing: -.03em }` — les intitulés de section. */
val ApprocheSection = (-0.03).em

/** `.eyebrow { letter-spacing: .18em }` — le surtitre, seul texte espacé de l'interface. */
val ApprocheAccroche = 0.18.em

// --- Polices --------------------------------------------------------------------------------

/** DM Sans — le texte courant, dans les quatre graisses employées par le Web. */
val PoliceTexte = FontFamily(
    Font(R.font.dm_sans_regular, FontWeight.Normal),
    Font(R.font.dm_sans_medium, FontWeight.Medium),
    Font(R.font.dm_sans_semibold, FontWeight.SemiBold),
    Font(R.font.dm_sans_bold, FontWeight.Bold),
)

/**
 * Manrope — les titres.
 *
 * Le Web ne monte jamais plus haut que 800. `FontWeight.Black`, employé jusqu'ici dans les écrans
 * Android, n'a pas de fichier correspondant : Compose l'obtenait en épaississant artificiellement le
 * dessin, ce qui empâte les lettres. `ExtraBold` désigne le vrai fichier.
 */
val PoliceTitre = FontFamily(
    Font(R.font.manrope_semibold, FontWeight.SemiBold),
    Font(R.font.manrope_bold, FontWeight.Bold),
    Font(R.font.manrope_extrabold, FontWeight.ExtraBold),
)

private fun TextStyle.enTexte() = copy(fontFamily = PoliceTexte)
private fun TextStyle.enTitre() = copy(fontFamily = PoliceTitre, letterSpacing = ApprocheSection)

/**
 * La typographie de l'application.
 *
 * Tout `Text` sans style explicite hérite d'ici : c'est ce qui garantit qu'une ligne ajoutée demain
 * dans un écran ne repartira pas sur la police du système.
 */
val TypographieFlixTunes: Typography = Typography().let { base ->
    base.copy(
        displayLarge = base.displayLarge.enTitre(), displayMedium = base.displayMedium.enTitre(),
        displaySmall = base.displaySmall.enTitre(),
        headlineLarge = base.headlineLarge.enTitre(), headlineMedium = base.headlineMedium.enTitre(),
        headlineSmall = base.headlineSmall.enTitre(),
        titleLarge = base.titleLarge.enTitre(), titleMedium = base.titleMedium.enTexte(),
        titleSmall = base.titleSmall.enTexte(),
        bodyLarge = base.bodyLarge.enTexte(), bodyMedium = base.bodyMedium.enTexte(),
        bodySmall = base.bodySmall.enTexte(),
        labelLarge = base.labelLarge.enTexte(), labelMedium = base.labelMedium.enTexte(),
        labelSmall = base.labelSmall.enTexte(),
    )
}

/**
 * Le thème, unique pour les deux surfaces et pour le lecteur.
 *
 * Il vivait dans `MainActivity` et ne couvrait donc que l'accueil : le lecteur, activité distincte,
 * s'en passait et repartait sur les couleurs et la police du système.
 */
@Composable
fun ThemeFlixTunes(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Bleu,
            onPrimary = Color.White,
            secondary = BleuClair,
            background = Encre,
            onBackground = Texte,
            surface = Panneau,
            onSurface = Texte,
            surfaceVariant = PanneauHaut,
            onSurfaceVariant = Muet,
            outline = Ligne,
            error = Erreur,
            onError = Encre,
        ),
        typography = TypographieFlixTunes,
        content = content,
    )
}
