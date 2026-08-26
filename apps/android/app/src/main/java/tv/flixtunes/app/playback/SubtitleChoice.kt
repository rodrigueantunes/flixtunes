package tv.flixtunes.app.playback

/**
 * Choix de la piste de sous-titres en lecture directe.
 *
 * Même angle mort que pour l'audio : le serveur ne tranche qu'en conversion. En lecture directe il
 * sert le fichier entier, toutes pistes comprises, et personne ne choisissait — le profil avait beau
 * demander des sous-titres, rien n'apparaissait.
 *
 * Le mode « forcé » est le plus délicat, et c'est le réglage par défaut. Les sous-titres forcés ne
 * traduisent pas le film : ils traduisent ce qui reste étranger *dans* le film — la phrase en elfique,
 * le panneau, la conversation en russe. Ils n'ont donc de sens qu'accompagnés d'une bande son qu'on
 * comprend. Les afficher en même temps qu'un doublage dans une autre langue produit un mélange que
 * personne n'a demandé.
 */

/** Une piste de sous-titres telle que le conteneur la décrit. */
data class PisteSousTitre(
    val index: Int,
    val langue: String?,
    /** Piste « forcée » : quelques répliques, pas le film entier. */
    val forcee: Boolean = false,
    /** Sous-titres pour sourds et malentendants : bruitages et indications de locuteur inclus. */
    val sourds: Boolean = false,
)

/**
 * La piste à afficher, ou `null` pour n'en afficher aucune.
 *
 * [mode] vaut « off », « forced » ou « always ». [langueAudio] est la langue de la piste sonore
 * effectivement retenue — c'est elle, et non les préférences, qui décide si des sous-titres forcés
 * ont un sens.
 *
 * En mode « toujours », une piste complète est cherchée dans l'ordre des préférences ; à défaut, une
 * piste forcée vaut mieux que rien. Les pistes pour sourds et malentendants ne sont jamais préférées
 * à une piste ordinaire de la même langue : elles décrivent des bruits que la personne entend.
 */
fun choisirSousTitre(
    pistes: List<PisteSousTitre>,
    preferences: List<String>,
    mode: String,
    langueAudio: String? = null,
): PisteSousTitre? {
    if (pistes.isEmpty() || mode == "off") return null

    /** Les pistes d'une langue donnée, la plus ordinaire d'abord. */
    fun dansLaLangue(langue: String?, forcees: Boolean) = pistes
        .filter { langueNormalisee(it.langue) == langue && it.forcee == forcees }
        .sortedBy { if (it.sourds) 1 else 0 }

    if (mode == "forced") {
        // Uniquement dans la langue qu'on écoute : des sous-titres forcés en français par-dessus une
        // bande son japonaise ne traduiraient pas les passages étrangers, ils doubleraient le film.
        val langue = langueNormalisee(langueAudio) ?: return null
        return dansLaLangue(langue, forcees = true).firstOrNull()
    }

    for (preference in preferences) {
        val voulue = langueNormalisee(preference) ?: continue
        // Une piste complète d'abord : c'est ce que « toujours » veut dire.
        dansLaLangue(voulue, forcees = false).firstOrNull()?.let { return it }
    }
    for (preference in preferences) {
        val voulue = langueNormalisee(preference) ?: continue
        dansLaLangue(voulue, forcees = true).firstOrNull()?.let { return it }
    }
    // Aucune préférence disponible : ne rien afficher plutôt qu'une langue au hasard. Des sous-titres
    // hongrois sur un film français seraient plus gênants que leur absence.
    return null
}
