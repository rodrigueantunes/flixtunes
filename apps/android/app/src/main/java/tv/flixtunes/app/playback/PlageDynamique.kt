package tv.flixtunes.app.playback

/** Une sortie radio du sélecteur d'image. */
data class ChoixPlage(val cle: String, val libelle: String)

/** Media3 doit reconnaître la piste comme Dolby Vision, pas seulement comme sa couche HEVC. */
fun pisteDolbyVisionReconnue(mime: String?, codecs: String?): Boolean {
    val type = mime?.lowercase().orEmpty()
    val codec = codecs?.lowercase().orEmpty()
    return type == "video/dolby-vision" || codec.startsWith("dvhe") || codec.startsWith("dvh1")
}

private val libellesPlage = mapOf(
    "dolbyvision" to "Dolby Vision", "hdr10plus" to "HDR10+", "hdr10" to "HDR10",
    "hlg" to "HLG", "sdr" to "SDR (conversion)",
)

fun sourceEstHdr(formatSource: String?): Boolean =
    !formatSource.isNullOrBlank() && formatSource != "sdr"

/** Couche de base réellement annoncée dans un flux Dolby Vision. */
fun coucheBaseDolbyVision(profil: Int?, compatibilite: Int?): String? = when (compatibilite) {
    1, 6 -> "hdr10"
    4 -> "hlg"
    2 -> "sdr"
    else -> if (profil == 7 || profil == 8) "hdr10" else null
}

/** Ne montre que les sorties contenues ou dérivables de cette vidéo et acceptées par l'appareil. */
fun plagesProposees(
    formatSource: String?,
    formatsAppareil: Collection<String>,
    coucheBase: String? = null,
    prioriteGlobale: String = "auto",
    formatsSource: Collection<String> = emptyList(),
): List<ChoixPlage> {
    if (!sourceEstHdr(formatSource)) return emptyList()
    val appareil = formatsAppareil.toSet()
    val possibles = linkedSetOf<String>()
    if (formatSource in appareil) possibles += formatSource!!
    formatsSource.filterTo(possibles) { it in appareil }
    if (formatSource == "hdr10plus" && "hdr10" in appareil) possibles += "hdr10"
    if (formatSource == "dolbyvision" && coucheBase != null && (coucheBase == "sdr" || coucheBase in appareil)) possibles += coucheBase
    possibles += "sdr"
    val automatique = if (prioriteGlobale == "auto") "Automatique · DV → HDR10+ → HDR10 → HLG → SDR"
        else "Automatique · priorité ${libellesPlage[prioriteGlobale] ?: prioriteGlobale.uppercase()}"
    val ordre = listOf("dolbyvision", "hdr10plus", "hdr10", "hlg", "sdr")
    return listOf(ChoixPlage("auto", automatique)) + ordre.filter { it in possibles }
        .map { ChoixPlage(it, libellesPlage.getValue(it)) }
}
