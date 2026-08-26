package tv.flixtunes.app

import java.text.Normalizer

/**
 * L'index alphabétique du catalogue, et la façon d'y avancer.
 *
 * Ces deux fonctions vivaient dans `MainActivity.kt`, qui porte des composables. Le harnais de tests
 * JVM écarte ces fichiers-là — un composable réclame le greffon Compose, qu'il ne monte pas — si bien
 * que `NavigationCatalogueTest` ne compilait plus et que **toute** la suite Android restait bloquée
 * avec elle. Un raisonnement pur n'a rien à faire dans une activité : sorti ici, il redevient
 * vérifiable sur une machine ordinaire.
 */
internal val INDEX_ALPHABETIQUE = listOf("#") + ('A'..'Z').map(Char::toString)

/** Étape suivante du maintien Bas ; Z reste borné au lieu de reboucler par surprise vers #. */
internal fun prochaineInitialeCatalogue(courante: String): String {
    val index = INDEX_ALPHABETIQUE.indexOf(courante.uppercase()).coerceAtLeast(0)
    return INDEX_ALPHABETIQUE[(index + 1).coerceAtMost(INDEX_ALPHABETIQUE.lastIndex)]
}

/** L'initiale sous laquelle ranger un titre : accents retirés, tout le reste sous « # ». */
internal fun initialeCatalogue(titre: String): String {
    val normalise = Normalizer.normalize(titre, Normalizer.Form.NFD)
        .replace(Regex("\\p{M}+"), "").trim().uppercase()
    return normalise.firstOrNull()?.takeIf { it in 'A'..'Z' }?.toString() ?: "#"
}
