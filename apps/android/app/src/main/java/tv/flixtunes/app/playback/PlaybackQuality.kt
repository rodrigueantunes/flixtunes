package tv.flixtunes.app.playback

/**
 * Choix manuel de la qualité, et lecture des infos techniques.
 *
 * Le lecteur Web offre les deux depuis l'étape 55 : un sélecteur listant les variantes du flux, et un
 * panneau « Infos lecture » qui dit le mode retenu, les codecs, le débit et ce que le serveur a
 * décidé. Le lecteur Android n'avait ni l'un ni l'autre — la barre par défaut de Media3, et rien
 * d'autre. Devant une lecture qui hésite, il n'y avait aucun moyen de savoir pourquoi.
 *
 * Ce module ne dessine rien : il prépare ce qui sera affiché, ce qui le rend vérifiable sans appareil.
 */

/** Une variante du flux, telle que le manifeste la décrit. */
data class Qualite(
    /** Rang de la variante dans le flux, ou -1 pour le choix automatique. */
    val index: Int,
    val hauteur: Int,
    val debitBitsParSeconde: Int,
) {
    /** Le libellé montré à la personne : « 1080p · 8,4 Mb/s ». */
    val libelle: String
        get() = when {
            index < 0 -> "Automatique"
            debitBitsParSeconde > 0 -> "${hauteur}p · ${arrondiMbps(debitBitsParSeconde)} Mb/s"
            hauteur > 0 -> "${hauteur}p"
            else -> "Variante ${index + 1}"
        }
}

/** Un débit en mégabits par seconde, à une décimale, virgule française comprise. */
fun arrondiMbps(bitsParSeconde: Int): String =
    String.format(java.util.Locale.FRANCE, "%.1f", bitsParSeconde / 1_000_000.0)

/**
 * La liste à proposer, choix automatique en tête.
 *
 * Les variantes sont ordonnées de la plus définie à la moins définie : c'est l'ordre dans lequel on
 * les cherche quand on force une qualité, et l'inverse de l'ordre où le lecteur les découvre.
 *
 * Une seule variante ne se choisit pas : proposer un menu à une entrée laisse croire à un réglage qui
 * n'en est pas un. La liste rendue est alors vide, et l'interface n'affiche rien.
 */
fun qualitesProposees(variantes: List<Qualite>): List<Qualite> {
    if (variantes.size < 2) return emptyList()
    val triees = variantes.sortedWith(compareByDescending<Qualite> { it.hauteur }.thenByDescending { it.debitBitsParSeconde })
    return listOf(Qualite(-1, 0, 0)) + triees
}

/** Une ligne du panneau d'infos : un intitulé, une valeur. */
data class LigneInfo(val intitule: String, val valeur: String)

/**
 * Le panneau « Infos lecture », dans le même ordre et avec les mêmes intitulés que sur le Web.
 *
 * Les mêmes mots des deux côtés, faute de quoi comparer un problème entre deux appareils oblige à
 * traduire mentalement. Une valeur absente s'écrit « — » plutôt que de disparaître : une ligne
 * manquante se remarque moins qu'une ligne vide, et c'est justement son absence qui renseigne.
 */
fun infosLecture(
    mode: String?,
    conteneur: String?,
    codecVideo: String?,
    resolutionSource: String?,
    codecAudio: String?,
    debitSourceBps: Long?,
    tamponSecondes: Double?,
    imagesPerdues: Int?,
    sortie: String?,
    plageDynamique: String?,
    raisons: List<String>,
): List<LigneInfo> {
    val absent = "—"
    return buildList {
        add(LigneInfo("Mode", mode?.takeIf { it.isNotBlank() } ?: "négociation"))
        add(LigneInfo("Conteneur", conteneur?.takeIf { it.isNotBlank() } ?: absent))
        add(LigneInfo("Vidéo", listOfNotNull(codecVideo?.uppercase()?.takeIf { it.isNotBlank() },
            resolutionSource?.takeIf { it.isNotBlank() }).joinToString(" · ").ifBlank { absent }))
        add(LigneInfo("Audio", codecAudio?.uppercase()?.takeIf { it.isNotBlank() } ?: absent))
        add(LigneInfo("Débit source", debitSourceBps?.takeIf { it > 0 }?.let { "${arrondiMbps(it.toInt())} Mb/s" } ?: absent))
        add(LigneInfo("Tampon", tamponSecondes?.takeIf { it >= 0 }
            ?.let { String.format(java.util.Locale.FRANCE, "%.1f s", it) } ?: absent))
        add(LigneInfo("Images perdues", imagesPerdues?.toString() ?: absent))
        add(LigneInfo("Sortie", sortie?.takeIf { it.isNotBlank() } ?: absent))
        add(LigneInfo("Plage dynamique", plageDynamique?.takeIf { it.isNotBlank() } ?: absent))
        // Les raisons de la décision ferment le panneau : c'est ce qu'on lit en dernier, quand les
        // chiffres au-dessus n'ont pas suffi à expliquer ce qui se passe.
        for ((rang, raison) in raisons.withIndex()) {
            add(LigneInfo(if (rang == 0) "Décision" else "", raison))
        }
    }
}
