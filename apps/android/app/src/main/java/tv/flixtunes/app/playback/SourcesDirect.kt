package tv.flixtunes.app.playback

/**
 * Les règles des sources d'une chaîne : dans quel ordre le repli les essaie, et comment le menu les
 * montre. Transcrites de `sources-direct.ts`, le client Web étant la référence.
 *
 * **Décidé le 13 septembre 2026.** Une chaîne regroupée porte jusqu'à quatre-vingts sources. Le repli
 * s'arrêtait à la huitième et le menu cachait le reste derrière « voir les autres » : les deux bornes
 * tombent. Toutes les sources entrent dans le repli et toutes se choisissent. Ce qui en sort, ce sont
 * celles que le serveur n'a pas pu joindre une fois qu'une autre jouait — du repli seulement, jamais
 * du menu.
 */

/**
 * Combien d'adresses une course sonde à la fois, à l'ouverture comme à chaque vague suivante.
 *
 * Douze suffisent à écarter les mortes ; quand elles ont toutes échoué, la vague suivante court à son
 * tour, plutôt qu'un essai de douze secondes après l'autre.
 */
const val COURSE_MAX = 12

/** Le premier rang de la vague de course qui contient ce rang. */
fun debutDeVague(index: Int): Int = index - index % COURSE_MAX

/**
 * Le rang que le repli automatique essaie après `depuis`, ou `null` s'il n'y en a plus.
 *
 * Toutes les adresses y passent, sauf celles que le serveur a trouvées muettes : les essayer ferait
 * attendre douze secondes chacune devant un écran noir.
 */
fun prochaineAdresse(urls: List<String>, depuis: Int, muettes: Set<String>): Int? =
    ((depuis + 1) until urls.size).firstOrNull { urls[it] !in muettes }

/** Le rang où reprendre quand tout a échoué : la mieux classée de celles qui répondent, sinon la première. */
fun premiereAdresse(urls: List<String>, muettes: Set<String>): Int =
    urls.indexOfFirst { it !in muettes }.takeIf { it >= 0 } ?: 0

/**
 * Un groupe du menu : le rang qu'on ouvre en le choisissant, le nombre d'adresses qu'il réunit, et
 * s'il n'en a aucune qui ait répondu à la sonde du serveur.
 */
data class GroupeDeSources(val index: Int, val doublons: Int, val muette: Boolean)

/**
 * Le menu regroupe ce qui se ressemble — même hôte, même chemin —, ouvre le meilleur membre qui
 * répond, et range à la fin les groupes dont aucun membre n'a répondu, choisissables comme les autres.
 */
fun regrouperLesSources(empreintes: List<String>, urls: List<String>, muettes: Set<String>): List<GroupeDeSources> {
    val membres = LinkedHashMap<String, MutableList<Int>>()
    urls.forEachIndexed { index, url ->
        membres.getOrPut(empreintes.getOrNull(index)?.ifBlank { null } ?: url) { mutableListOf() }.add(index)
    }
    val groupes = membres.values.map { indices ->
        val vivant = indices.firstOrNull { urls[it] !in muettes }
        GroupeDeSources(vivant ?: indices.first(), indices.size, vivant == null)
    }
    return groupes.filterNot { it.muette } + groupes.filter { it.muette }
}
