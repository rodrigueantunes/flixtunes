package tv.flixtunes.app.ui

/**
 * L'intitulé de version affiché dans l'application.
 *
 * Le nom de version que Gradle inscrit dans l'APK colle la révision au numéro — `0.5.6.r75` — parce
 * qu'Android exige un nom d'un seul tenant. À l'écran on veut la forme lue partout ailleurs, dans le
 * journal des versions comme dans le paquet du NAS : `v0.5.6 r75`.
 *
 * Le nom de l'application n'y figure pas : la puce se tient contre l'enseigne, qui l'écrit déjà.
 *
 * Rien n'est écrit en dur : la chaîne vient de `BuildConfig.VERSION_NAME`, donc elle suit la
 * construction. Une révision livrée sans changer ce texte est impossible — c'est le même numéro qui
 * nomme le fichier APK, celui qu'on lit sur le téléphone quand on cherche ce qui y est installé.
 */
fun intituleVersion(nomDeVersion: String): String {
    val revision = Regex("""\.(r\d+)$""").find(nomDeVersion)
    return if (revision != null) {
        "v${nomDeVersion.removeSuffix(revision.value)} ${revision.groupValues[1]}"
    } else {
        "v$nomDeVersion"
    }
}
