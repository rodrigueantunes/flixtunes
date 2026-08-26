package tv.flixtunes.app.playback

/** Ce qu'on affiche faute de tout autre nom. Ne devrait plus servir : le serveur nomme le média. */
const val MARQUE = "FlixTunes"

/** Les deux lignes du bandeau : ce qu'on regarde, et où l'on en est dans la série. */
data class IntituleLecteur(val titre: String, val sousTitre: String?)

/**
 * Ce que le bandeau du lecteur annonce, dans la forme du lecteur Web.
 *
 * Le Web est la référence graphique, et il affiche ceci :
 *
 * ```
 * <b>{showTitle ?? title}</b>{showTitle && <span>S{season} E{episode} · {title}</span>}
 * ```
 *
 * Soit, en gras, la série — ou le titre du film quand il n'y a pas de série — et en dessous, plus
 * discret, le numéro d'épisode suivi de son titre. Android composait déjà exactement cela : le défaut
 * n'était pas dans cette mise en forme mais dans ce qu'il recevait. La réponse qui ouvre une lecture
 * décrit les flux et ne nommait pas le média, si bien que le repli s'appliquait à chaque film et que
 * le bandeau affichait « FlixTunes » du début à la fin. Le serveur nomme désormais le média des deux
 * côtés — à l'ouverture comme au passage à l'épisode suivant.
 */
fun intituleLecteur(titre: String?, serie: String?, saison: Int, episode: Int): IntituleLecteur {
    val nom = titre?.takeIf { it.isNotBlank() }
    if (serie.isNullOrBlank()) return IntituleLecteur(nom ?: MARQUE, null)
    val elements = listOfNotNull(numeroEpisode(saison, episode), nom)
    return IntituleLecteur(serie, elements.joinToString(" · ").takeIf { it.isNotEmpty() })
}

/**
 * « S1 E2 », dans la forme du Web, ou `null` quand la numérotation manque.
 *
 * Exposé à part parce que la carte d'enchaînement l'affiche seule : elle annonce le titre de
 * l'épisode en gras et son numéro en dessous. Le déduire en redécoupant [IntituleLecteur.sousTitre]
 * marchait, mais se serait cassé au premier changement de séparateur.
 */
fun numeroEpisode(saison: Int, episode: Int): String? =
    if (saison > 0 && episode > 0) "S$saison E$episode" else null
