package tv.flixtunes.app.playback

import android.view.KeyEvent

/**
 * Ce qu'une touche de télécommande déclenche dans le lecteur.
 *
 * Le lecteur était muet à la télécommande, et la raison n'était pas dans les touches : la barre de
 * commandes n'est composée que lorsqu'elle est visible, et **la seule chose qui la réveillait était un
 * appui tactile** — `onPress` du détecteur de gestes, installé qui plus est sur la seule surface
 * tactile. Sur un téléviseur, il n'y a pas de doigt : la barre restait donc retirée, aucun élément
 * n'était focusable, et la croix directionnelle appuyait dans le vide. L'application n'avait pas
 * perdu la navigation, elle n'en avait jamais eu.
 *
 * La décision est isolée ici, sans Android autour, pour la même raison que `NavigationTape` ou
 * `PlaybackWindow` : elle se vérifie alors sans téléviseur ni appareil.
 */
enum class GesteTelecommande {
    /** Faire revenir la barre, sans rien changer à la lecture. */
    REVEILLER,

    /** Reculer d'un pas de dix secondes. */
    RECULER,

    /** Avancer d'un pas de dix secondes. */
    AVANCER,

    /** Mettre en pause, ou reprendre. */
    BASCULER_LECTURE,

    /** Reprendre sans mettre en pause si la lecture est déjà lancée. */
    LIRE,

    /** Mettre en pause sans reprendre si elle l'est déjà. */
    PAUSE,

    /** Refermer le panneau ouvert, et lui seul : le retour ne doit pas quitter le film du même geste. */
    FERMER_PANNEAU,

    /** Retirer la garniture sans quitter le film. */
    MASQUER,

    /** Entrer dans les options focalisables avec haut ou bas. */
    PARCOURIR_COMMANDES,

    /** Ne rien intercepter : le système, ou le parcours au focus de Compose, s'en charge. */
    LAISSER,
}

/**
 * Le geste que produit [codeTouche], selon que la barre est déjà visible ou non.
 *
 * Deux régimes explicites rendent le lecteur prévisible à la télécommande :
 *
 * - **Transport** : gauche/droite naviguent et le centre bascule lecture/pause, barre visible ou non.
 * - **Options** : haut/bas entre volontairement dans le parcours au focus. La croix et le centre sont
 *   alors rendus à Compose jusqu'au masquage de la garniture. Un panneau ouvert est toujours dans ce
 *   second régime, afin que ses choix restent atteignables.
 *
 * Les touches multimédias, elles, ne dépendent pas de ce que l'écran affiche : une télécommande qui
 * porte un bouton « pause » l'a fait faire, barre visible ou non.
 */
fun gesteTelecommande(
    codeTouche: Int,
    garnitureVisible: Boolean,
    /** Vrai lorsque « Infos lecture » ou la liste des pistes est dépliée. */
    panneauOuvert: Boolean = false,
    /** Vrai après haut/bas : la croix parcourt alors les options jusqu'à leur masquage. */
    parcoursCommandes: Boolean = false,
): GesteTelecommande = when (codeTouche) {
    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_SPACE -> GesteTelecommande.BASCULER_LECTURE
    KeyEvent.KEYCODE_MEDIA_PLAY -> GesteTelecommande.LIRE
    KeyEvent.KEYCODE_MEDIA_PAUSE, KeyEvent.KEYCODE_MEDIA_STOP -> GesteTelecommande.PAUSE

    KeyEvent.KEYCODE_MEDIA_REWIND -> GesteTelecommande.RECULER
    KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> GesteTelecommande.AVANCER

    KeyEvent.KEYCODE_DPAD_LEFT -> if (panneauOuvert || parcoursCommandes) {
        GesteTelecommande.LAISSER
    } else GesteTelecommande.RECULER

    KeyEvent.KEYCODE_DPAD_RIGHT -> if (panneauOuvert || parcoursCommandes) {
        GesteTelecommande.LAISSER
    } else GesteTelecommande.AVANCER

    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER ->
        if (panneauOuvert || parcoursCommandes) GesteTelecommande.LAISSER
        else GesteTelecommande.BASCULER_LECTURE

    KeyEvent.KEYCODE_DPAD_UP, KeyEvent.KEYCODE_DPAD_DOWN -> when {
        panneauOuvert -> GesteTelecommande.LAISSER
        garnitureVisible -> GesteTelecommande.PARCOURIR_COMMANDES
        else -> GesteTelecommande.REVEILLER
    }

    // Le retour descend une pile visible : panneau, garniture, puis seulement l'activité.
    KeyEvent.KEYCODE_BACK -> when {
        panneauOuvert -> GesteTelecommande.FERMER_PANNEAU
        garnitureVisible -> GesteTelecommande.MASQUER
        else -> GesteTelecommande.LAISSER
    }

    // Le volume appartient au système, et tout le reste ne nous regarde pas. Les avaler ferait d'un
    // lecteur une impasse.
    else -> GesteTelecommande.LAISSER
}

/** Le pas de navigation à la télécommande, en secondes. Le même que les boutons « −10 » et « +10 ». */
const val PAS_NAVIGATION_SECONDES = 10.0

/**
 * Comportement local de la timeline lorsqu'elle possède réellement le focus.
 *
 * Le reste de la rangée conserve la navigation directionnelle de Compose. Seule cette cible remplace
 * Gauche/Droite par le transport, ce qui évite qu'un bouton « Pistes » ou « Infos » avance le film.
 */
fun gesteBarreProgression(codeTouche: Int): GesteTelecommande = when (codeTouche) {
    KeyEvent.KEYCODE_DPAD_LEFT -> GesteTelecommande.RECULER
    KeyEvent.KEYCODE_DPAD_RIGHT -> GesteTelecommande.AVANCER
    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER ->
        GesteTelecommande.BASCULER_LECTURE
    else -> GesteTelecommande.LAISSER
}
