package tv.flixtunes.app.playback

/**
 * Choix de la piste audio en lecture directe.
 *
 * En lecture directe, le serveur sert le fichier tel quel : toutes ses pistes arrivent au lecteur, et
 * c'est au lecteur de choisir. Sans consigne, Media3 prend celle que le conteneur déclare par défaut
 * — souvent l'anglais sur un fichier multilingue —, ce qui donne un film qui démarre dans la mauvaise
 * langue alors que le profil a dit ce qu'il voulait. En conversion le serveur tranchait déjà ; en
 * lecture directe personne ne le faisait.
 *
 * Le raisonnement est isolé ici, sans dépendance à Android : il se vérifie sur une machine ordinaire,
 * et c'est lui qui porte toute la difficulté.
 */

/** Une piste telle que le conteneur la décrit. */
data class PisteAudio(
    val index: Int,
    val langue: String?,
    val canaux: Int = 2,
    /** Piste d'audiodescription : utile à qui en a besoin, déroutante pour qui ne l'a pas demandée. */
    val descriptive: Boolean = false,
)

/**
 * Équivalences de codes de langue.
 *
 * Un même fichier peut annoncer « fr », « fra », « fre » ou « fr-FR » selon l'outil qui l'a produit.
 * Comparer les chaînes telles quelles ferait manquer la piste française d'un fichier sur deux.
 * « fre » et « ger » sont les codes bibliographiques, encore très répandus dans les conteneurs.
 */
private val EQUIVALENCES = mapOf(
    "fra" to "fr", "fre" to "fr", "eng" to "en", "deu" to "de", "ger" to "de",
    "spa" to "es", "ita" to "it", "por" to "pt", "nld" to "nl", "dut" to "nl",
    "jpn" to "ja", "kor" to "ko", "zho" to "zh", "chi" to "zh", "rus" to "ru",
)

/** Ramène un code de langue à sa forme courte comparable, ou `null` s'il n'y en a pas. */
fun langueNormalisee(code: String?): String? {
    val base = code?.trim()?.lowercase()?.substringBefore('-')?.takeIf { it.isNotEmpty() && it != "und" } ?: return null
    return EQUIVALENCES[base] ?: base
}

/**
 * La piste à jouer, ou `null` si le fichier n'en contient aucune.
 *
 * [preferences] est la liste ordonnée du profil : « fr », « en », et le mot-clé « original » qui
 * désigne la langue de tournage. L'ordre est respecté strictement — c'est ce que la personne a
 * demandé, et le deuxième choix ne doit jamais l'emporter sur le premier au prétexte qu'il sonne
 * mieux.
 *
 * À langue égale, la piste au plus grand nombre de canaux gagne : entre un 5.1 et un stéréo de la
 * même langue, personne ne choisit le stéréo.
 *
 * Les pistes d'audiodescription ne sont retenues qu'à défaut de toute autre : elles portent la même
 * langue que la piste ordinaire, et les préférer donnerait un film commenté à qui ne l'a pas demandé.
 */
fun choisirPisteAudio(
    pistes: List<PisteAudio>,
    preferences: List<String>,
    langueOriginale: String? = null,
): PisteAudio? {
    if (pistes.isEmpty()) return null
    val ordinaires = pistes.filterNot { it.descriptive }
    val candidates = ordinaires.ifEmpty { pistes }

    for (preference in preferences) {
        val voulue = if (preference.equals("original", ignoreCase = true)) langueNormalisee(langueOriginale)
        else langueNormalisee(preference)
        if (voulue == null) continue
        val correspondantes = candidates.filter { langueNormalisee(it.langue) == voulue }
        if (correspondantes.isNotEmpty()) return correspondantes.maxByOrNull { it.canaux }
    }

    // Aucune préférence ne correspond : la première piste ordinaire vaut mieux que rien, et mieux
    // qu'une audiodescription. Se taire ici laisserait Media3 reprendre son choix par défaut.
    return candidates.firstOrNull()
}
