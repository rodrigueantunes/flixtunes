package tv.flixtunes.app.ui

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Le gabarit de la surface courante, disponible partout sans être passé de main en main.
 *
 * Il était transporté en paramètre `isTv` à travers toute l'arborescence : chaque écran devait le
 * déclarer, chaque appel le transmettre, et l'ajout d'un composant en profondeur obligeait à modifier
 * toute la chaîne au-dessus. Un fournisseur d'ambiance supprime ce transport.
 *
 * `static` parce que la valeur ne change jamais pendant la vie de l'écran — l'appareil ne devient pas
 * un téléviseur en cours de route. Compose peut alors s'épargner le suivi des lectures.
 */
val LocalGabarit = staticCompositionLocalOf { GABARIT_TACTILE }

/**
 * Le budget graphique de l'appareil, fourni par la plateforme au démarrage.
 *
 * Il était calculé sur place par les composables, à partir d'un `Context` — ce qui obligeait chaque
 * fichier d'interface à connaître Android pour choisir une taille de texture. La valeur ne change
 * jamais pendant la vie de l'écran : une ambiance statique la porte, comme pour le gabarit.
 */
val LocalMemoireTv = staticCompositionLocalOf { MemoireTv.STANDARD }
