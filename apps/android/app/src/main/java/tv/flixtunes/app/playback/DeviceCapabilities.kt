package tv.flixtunes.app.playback

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import android.view.WindowManager
import androidx.media3.exoplayer.audio.AudioCapabilities
import org.json.JSONArray
import org.json.JSONObject

/**
 * L'enveloppe d'image utilisable, dans le sens où une vidéo se regarde.
 *
 * `Display.Mode` rapporte la définition dans l'orientation **native** du panneau. Sur un téléviseur
 * c'est le paysage, et les deux valeurs partent telles quelles ; sur un téléphone c'est le portrait,
 * et `physicalWidth` vaut alors 1080 quand `physicalHeight` vaut 2400. Envoyées dans cet ordre, elles
 * font conclure au serveur qu'un film 1920×1080 dépasse l'appareil : il le convertit sans nécessité,
 * et le rabote à 1080 de large. Un téléphone parfaitement capable de lecture directe recevait donc
 * une image dégradée, à l'endroit précis où la conversion coûte le plus cher au NAS.
 *
 * Une vidéo occupe le grand côté du panneau. L'enveloppe est donc le plus grand des deux nombres par
 * le plus petit, quelle que soit l'orientation d'origine — et l'appareil tenu debout n'y change rien :
 * il suffit de le tourner.
 */
internal fun enveloppeVideo(largeur: Int, hauteur: Int): Pair<Int, Int> =
    maxOf(largeur, hauteur) to minOf(largeur, hauteur)

/**
 * La définition annoncée vient du **décodeur**, non de la dalle.
 *
 * C'est exactement le défaut que le client Web a connu, transposé ici. `physicalWidth` décrit ce que
 * l'écran affiche ; il ne dit rien de ce que la puce sait décoder. Un téléphone à dalle 2400 × 1080
 * déclarait donc ne pas savoir lire un film 4K — alors que son décodeur matériel le lit sans peine et
 * que le système réduit ensuite l'image pour l'écran, gratuitement.
 *
 * La conséquence était la pire possible : le serveur concluait « définition supérieure », partait en
 * conversion 4K, et un NAS Celeron ne produit pas cela. Relevé sur *Avatar : De feu et de cendres*,
 * qui ne démarrait pas du tout sur téléphone alors qu'il se serait lu tel quel.
 *
 * On retient donc la plus grande des deux surfaces. La dalle reste dans le calcul comme plancher :
 * un appareil dont aucun décodeur ne déclare sa taille maximale — cela arrive sur des puces anciennes
 * — ne doit pas se retrouver à annoncer moins que ce qu'il affiche.
 */
internal fun enveloppeDecodage(decodeur: Pair<Int, Int>?, dalle: Pair<Int, Int>): Pair<Int, Int> {
    val surface = { taille: Pair<Int, Int> -> taille.first.toLong() * taille.second }
    val retenue = if (decodeur != null && surface(decodeur) > surface(dalle)) decodeur else dalle
    return enveloppeVideo(retenue.first, retenue.second)
}

internal fun safeContainers(isTv: Boolean, forceTranscode: Boolean): List<String> =
    if (isTv && !forceTranscode) listOf("mp4", "webm", "matroska") else listOf("mp4")

internal fun safeAudioCodecs(detected: List<String>, isTv: Boolean, forceTranscode: Boolean, passthrough: List<String> = emptyList()): List<String> = when {
    forceTranscode -> listOf("aac")
    isTv -> (detected.filter { it in listOf("aac", "opus", "mp3") } + passthrough).distinct()
    else -> detected.filter { it in listOf("aac", "opus", "mp3") }
}
/**
 * Ce qu'on demande au serveur : négocier librement, copier sans convertir, ou tout convertir.
 *
 * Le mode intermédiaire existe pour une seule raison, et elle est décisive. Le serveur tente
 * désormais la lecture directe sur un conteneur qu'il ne nous a pas vu déclarer ; si notre décodeur
 * la refuse, replier droit en conversion remplacerait un remux — qui **copie** l'image au bit près —
 * par un transcodage complet que le NAS peine à produire. On lui demande donc d'abord de ranger le
 * même flux dans un conteneur qui nous convient, et la conversion n'arrive qu'ensuite.
 */
internal fun playbackMode(forceTranscode: Boolean, remuxSeulement: Boolean = false): String = when {
    forceTranscode -> "compatible"
    remuxSeulement -> "remux"
    else -> "auto"
}

/**
 * Le passthrough Dolby Atmos est-il possible ?
 *
 * Atmos ne voyage pas seul : il est porté par un flux E-AC3 marqué JOC, ou par un TrueHD. Le
 * déclarer revient donc à déclarer que l'un de ces deux encodages sort de l'appareil sans être
 * décodé.
 *
 * Cette règle était écrite en ligne et **fausse par priorité d'opérateurs** :
 * `if (c) A else false || B` se lit `if (c) A else (false || B)`. Sur Android 9 et au-delà — c'est-à-dire
 * sur tous les téléviseurs concernés — le repli TrueHD n'était donc jamais examiné, et sur les
 * versions antérieures le JOC ne l'était pas. Le `||` voulu n'a jamais existé.
 */
internal fun atmosDisponible(jocDisponible: Boolean, trueHdDisponible: Boolean, forceTranscode: Boolean): Boolean =
    !forceTranscode && (jocDisponible || trueHdDisponible)

/**
 * Traduit les drapeaux `MediaCodec` en numéros de profils Dolby Vision portés par FFprobe.
 * Les valeurs Android sont des bits (32, 128…), pas les numéros 5, 7… attendus par le serveur.
 */
internal fun profilsDolbyVision(decodeurDeclare: Boolean, ecranDeclare: Boolean, profilsCodec: Set<Int>): List<Int> {
    if (!decodeurDeclare || !ecranDeclare) return emptyList()
    val correspondance = mapOf(16 to 4, 32 to 5, 64 to 6, 128 to 7, 256 to 8, 512 to 9, 1024 to 10)
    val declares = profilsCodec.mapNotNull(correspondance::get).distinct().sorted()
    return declares
}

internal fun profilAndroidDolbyVision(profil: Int?): Int? = mapOf(
    4 to 16, 5 to 32, 6 to 64, 7 to 128, 8 to 256, 9 to 512, 10 to 1024,
)[profil]

/**
 * Rattrape les pilotes qui déclarent Dolby Vision mais omettent leurs niveaux.
 *
 * On n'annonce jamais tous les profils : seulement celui effectivement lu dans le fichier courant.
 * C'est suffisamment prudent pour ne pas inventer une capacité, tout en suivant le chemin que les
 * lecteurs natifs emploient sur les téléviseurs où Dolby Vision fonctionne malgré cette omission.
 */
internal fun profilsDolbyVisionPourSource(
    decodeurDeclare: Boolean,
    ecranDeclare: Boolean,
    profilsCodec: Set<Int>,
    profilSource: Int?,
): List<Int> {
    val declares = profilsDolbyVision(decodeurDeclare, ecranDeclare, profilsCodec)
    if (declares.isNotEmpty()) return declares
    return if (decodeurDeclare && ecranDeclare && profilSource in 4..10)
        listOf(profilSource!!) else emptyList()
}

@androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
object DeviceCapabilities {
    fun create(context: Context, audioStreamIndex: Int? = null, subtitleStreamIndex: Int? = null, forceTranscode: Boolean = false,
        preferredAudioLanguages: List<String> = emptyList(), audioOutputMode: String = "auto",
        audioNormalization: Boolean = false, nightMode: Boolean = false,
        startSeconds: Double = 0.0, plageDynamique: String = "auto", remuxSeulement: Boolean = false,
        sourceDolbyVisionProfile: Int? = null, sourceWidth: Int? = null, sourceHeight: Int? = null): JSONObject {
        val listeCodecs = MediaCodecList(MediaCodecList.ALL_CODECS)
        val decodeurs = listeCodecs.codecInfos.filterNot { it.isEncoder }
        val types = decodeurs.flatMap { it.supportedTypes.asList() }.map { it.lowercase() }.toSet()
        val decodeursDolbyVision = decodeurs.filter { info ->
            info.supportedTypes.any { it.equals("video/dolby-vision", ignoreCase = true) }
        }
        val profilsCodecDolbyVision = decodeursDolbyVision.flatMap { info ->
            runCatching { info.getCapabilitiesForType("video/dolby-vision").profileLevels.map { it.profile } }
                .getOrDefault(emptyList())
        }.toSet()
        // La plus grande image que l'un des decodeurs video accepte. `getCapabilitiesForType` leve sur
        // certains pilotes constructeur pour des types qu'ils declarent pourtant : on ignore ceux-la
        // plutot que de perdre toute la mesure.
        val tailleDecodable = decodeurs.asSequence()
            .flatMap { info -> info.supportedTypes.asSequence().map { info to it } }
            .filter { (_, type) -> type.lowercase().startsWith("video/") }
            .mapNotNull { (info, type) ->
                runCatching { info.getCapabilitiesForType(type).videoCapabilities }.getOrNull()
            }
            .mapNotNull { caps -> runCatching { caps.supportedWidths.upper to caps.supportedHeights.upper }.getOrNull() }
            .maxByOrNull { it.first.toLong() * it.second }
        val codecs = buildList {
            if ("video/avc" in types) add("h264")
            if ("video/hevc" in types) add("hevc")
            if ("video/av01" in types) add("av1")
            if ("video/x-vnd.on2.vp9" in types) add("vp9")
            if ("video/x-vnd.on2.vp8" in types) add("vp8")
        }
        val detectedAudio = buildList {
            if ("audio/mp4a-latm" in types) add("aac")
            if ("audio/opus" in types) add("opus")
            if ("audio/mpeg" in types) add("mp3")
            if ("audio/ac3" in types) add("ac3")
            if ("audio/eac3" in types || "audio/eac3-joc" in types) add("eac3")
            if ("audio/vnd.dts" in types || "audio/vnd.dts.hd" in types) add("dts")
            if ("audio/true-hd" in types) add("truehd")
        }
        val display = if (Build.VERSION.SDK_INT >= 30) context.display else
            @Suppress("DEPRECATION") (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay
        val modes = display?.supportedModes ?: emptyArray()
        val maxMode = modes.maxByOrNull { it.physicalWidth.toLong() * it.physicalHeight }
        val enveloppe = enveloppeDecodage(tailleDecodable,
            (maxMode?.physicalWidth ?: 1920) to (maxMode?.physicalHeight ?: 1080))
        val hdrTypes = if (Build.VERSION.SDK_INT >= 24) display?.hdrCapabilities?.supportedHdrTypes ?: intArrayOf() else intArrayOf()
        val ecranDolbyVision = Build.VERSION.SDK_INT >= 24 &&
            android.view.Display.HdrCapabilities.HDR_TYPE_DOLBY_VISION in hdrTypes
        val profilsDeclares = profilsDolbyVision(decodeursDolbyVision.isNotEmpty(), ecranDolbyVision, profilsCodecDolbyVision)
        // Certains pilotes omettent tous leurs niveaux Dolby Vision. Dans ce cas on ne promet plus
        // arbitrairement les profils 4 à 10 : on demande au système si le profil du fichier courant,
        // à sa définition réelle, possède bien un décodeur. C'est ce qui évite d'envoyer du DV à un
        // téléviseur qui ne sait finalement sortir que sa couche HDR10.
        val profilExactDisponible = if (ecranDolbyVision && profilsDeclares.isEmpty()) {
            profilAndroidDolbyVision(sourceDolbyVisionProfile)?.let { profilAndroid ->
                runCatching {
                    val format = MediaFormat.createVideoFormat("video/dolby-vision", sourceWidth ?: 1920, sourceHeight ?: 1080)
                    format.setInteger(MediaFormat.KEY_PROFILE, profilAndroid)
                    listeCodecs.findDecoderForFormat(format) != null
                }.getOrDefault(false)
            } == true
        } else false
        val profilsDolbyVisionDetectes = if (profilsDeclares.isNotEmpty()) profilsDeclares else {
            val profilSource = profilsDolbyVisionPourSource(
                decodeursDolbyVision.isNotEmpty(), ecranDolbyVision, profilsCodecDolbyVision,
                sourceDolbyVisionProfile,
            )
            if (profilSource.isNotEmpty()) profilSource
            else if (profilExactDisponible && sourceDolbyVisionProfile != null) listOf(sourceDolbyVisionProfile) else emptyList()
        }
        val hdrFormats = buildList {
            if (Build.VERSION.SDK_INT >= 24 && android.view.Display.HdrCapabilities.HDR_TYPE_HDR10 in hdrTypes) add("hdr10")
            if (Build.VERSION.SDK_INT >= 29 && android.view.Display.HdrCapabilities.HDR_TYPE_HDR10_PLUS in hdrTypes) add("hdr10plus")
            if (Build.VERSION.SDK_INT >= 24 && android.view.Display.HdrCapabilities.HDR_TYPE_HLG in hdrTypes) add("hlg")
            // Il faut les deux bouts de la chaîne : écran *et* décodeur. L'écran seul faisait
            // annoncer Dolby Vision sur des boîtiers qui ne savent en sortir que la couche HDR10.
            if (profilsDolbyVisionDetectes.isNotEmpty()) add("dolbyvision")
        }
        @Suppress("DEPRECATION")
        val displayPeakNits = if (Build.VERSION.SDK_INT >= 24) {
            display?.hdrCapabilities?.desiredMaxLuminance?.takeIf { it > 0f && it.isFinite() }?.toDouble()
        } else null
        val isTv = context.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_TYPE_MASK == android.content.res.Configuration.UI_MODE_TYPE_TELEVISION
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val outputDevices = if (Build.VERSION.SDK_INT >= 23) audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList() else emptyList<AudioDeviceInfo>()
        val outputEncodings = if (Build.VERSION.SDK_INT >= 23) outputDevices.flatMap { it.encodings.toList() }.toSet() else emptySet()
        /*
         * Ce que la sortie audio accepte réellement, par deux sources plutôt qu'une.
         *
         * `AudioDeviceInfo.encodings` est la source évidente et la moins fiable : beaucoup de
         * téléviseurs et de boîtiers la renvoient vide ou amputée, y compris quand l'ampli en aval
         * accepte l'Atmos. L'appareil se déclarait alors incapable, le serveur convertissait en AAC,
         * et l'on perdait l'Atmos sans qu'aucune erreur ne le signale — un lecteur qui « fonctionne »
         * en donnant moins que ce que le matériel sait faire.
         *
         * Media3 est déjà dans l'application, et son `AudioCapabilities` réunit ce que la plateforme
         * expose vraiment : l'intention collante `ACTION_HDMI_AUDIO_PLUG` et ses encodages annoncés
         * par le HDMI, `AudioTrack.isDirectPlaybackSupported` depuis Android 10, les profils directs
         * depuis Android 13, et le réglage « son surround externe ». C'est la source dont ExoPlayer
         * lui-même se sert pour décider d'un passthrough : s'en écarter revenait à conclure autrement
         * que le lecteur qui va effectivement jouer le flux.
         *
         * Les deux sources sont réunies plutôt que substituées : celle qui répond emporte la
         * décision, et aucune ne peut retirer ce que l'autre a constaté.
         */
        val capacitesMedia3 = runCatching { AudioCapabilities.getCapabilities(context) }.getOrNull()
        val sortieAccepte = { encodage: Int ->
            encodage in outputEncodings || capacitesMedia3?.supportsEncoding(encodage) == true
        }
        val passthrough = buildList {
            if (sortieAccepte(AudioFormat.ENCODING_AC3)) add("ac3")
            if (sortieAccepte(AudioFormat.ENCODING_E_AC3)) add("eac3")
            if (sortieAccepte(AudioFormat.ENCODING_DTS) || sortieAccepte(AudioFormat.ENCODING_DTS_HD)) add("dts")
            if (Build.VERSION.SDK_INT >= 26 && sortieAccepte(AudioFormat.ENCODING_DOLBY_TRUEHD)) add("truehd")
        }
        val safeAudio = safeAudioCodecs(detectedAudio, isTv, forceTranscode, passthrough)
        // Le repli impose un réencodage, pas un écran SDR. Garder les formats de la dalle permet au
        // serveur de reconduire HDR10/HLG en HEVC 10 bits lorsque son moteur le sait.
        val safeHdrFormats = hdrFormats
        val passthroughAtmos = atmosDisponible(
            jocDisponible = Build.VERSION.SDK_INT >= 28 && sortieAccepte(AudioFormat.ENCODING_E_AC3_JOC),
            trueHdDisponible = Build.VERSION.SDK_INT >= 26 && sortieAccepte(AudioFormat.ENCODING_DOLBY_TRUEHD),
            forceTranscode = forceTranscode,
        )
        val passthroughDtsX = !forceTranscode && sortieAccepte(AudioFormat.ENCODING_DTS_HD)
        val outputChannels = maxOf(
            outputDevices.flatMap { it.channelCounts.toList() }.maxOrNull() ?: 2,
            capacitesMedia3?.maxChannelCount ?: 2,
        ).coerceAtLeast(2)
        return JSONObject()
            .put("containers", JSONArray(safeContainers(isTv, forceTranscode)))
            // `modePreference=compatible` force déjà le réencodage. Conserver les codecs de sortie
            // réellement décodables évite de condamner tout repli au H.264 SDR.
            .put("videoCodecs", JSONArray(codecs)).put("audioCodecs", JSONArray(safeAudio)).put("hls", true).put("dash", true)
            .put("maxWidth", enveloppe.first).put("maxHeight", enveloppe.second)
            .put("hdr", safeHdrFormats.isNotEmpty()).put("hdrFormats", JSONArray(safeHdrFormats))
            .put("dolbyVisionProfiles", JSONArray(if (!forceTranscode && "dolbyvision" in hdrFormats) profilsDolbyVisionDetectes else emptyList<Int>()))
            .put("dolbyAtmos", passthroughAtmos).put("immersiveAudioFormats", JSONArray(buildList {
                if (passthroughAtmos) add("dolby-atmos"); if (passthroughDtsX) add("dts-x")
            }))
            .put("maxAudioChannels", if (!forceTranscode && isTv) outputChannels else 2)
            .put("losslessAudio", !forceTranscode && isTv && "truehd" in passthrough)
            .put("displayPeakNits", if (!forceTranscode && displayPeakNits != null) displayPeakNits else JSONObject.NULL)
            .put("maxVideoBitrate", JSONObject.NULL).put("audioStreamIndex", audioStreamIndex ?: JSONObject.NULL)
            // Media3 sait sélectionner une piste au sein du fichier direct : ne jamais imposer au
            // lecteur Android le remux de sûreté réservé aux navigateurs Web.
            .put("directAudioStreamSelection", true)
            // Media3 analyse le flux du début à la fin, sans jamais revenir en arrière.
            //
            // Un Matroska peut ranger la définition de ses pistes après les données, tout à la fin du
            // fichier ; le `SeekHead` de tête y renvoie, et FFmpeg comme les navigateurs suivent ce
            // renvoi. Nous, non : on atteint les données sans savoir quoi en faire, et on joue une
            // image noire, sans son et sans avance rapide — sans lever la moindre erreur, donc sans
            // qu'aucun repli ne se déclenche. Le dire au serveur lui suffit à passer en remux, qui
            // réécrit l'en-tête en tête de flux sans toucher à l'image.
            .put("seekableTrackHeaders", false)
            .put("subtitleStreamIndex", subtitleStreamIndex ?: JSONObject.NULL).put("burnSubtitles", false)
            .put("preferredAudioLanguages", JSONArray(preferredAudioLanguages))
            .put("audioOutputMode", audioOutputMode).put("audioNormalization", audioNormalization).put("nightMode", nightMode)
            .put("hlsSegmentContainer", "fmp4").put("adaptiveStreaming", true).put("streamingProtocol", "dash").put("deviceClass", if (isTv) "tv" else "mobile")
            .put("modePreference", playbackMode(forceTranscode, remuxSeulement))
            // Point du film où démarrer l'encodage. Le serveur sait le faire depuis l'étape 55 — le
            // lecteur Web s'en sert pour naviguer hors de la fenêtre encodée, Android ne l'envoyait pas,
            // et sa barre de progression restait donc bornée à ce qui était déjà produit.
            .put("startSeconds", startSeconds)
            // « auto » laisse le serveur décider d'après ce que l'écran annonce. Les deux autres
            // valeurs sont un désaveu de cette annonce : on force la conservation du HDR, ou sa
            // conversion, quand le rendu obtenu ne correspond pas à ce que l'écran prétend savoir faire.
            .put("dynamicRangePreference", if (plageDynamique == "auto" && sourceDolbyVisionProfile != null
                && "dolbyvision" in hdrFormats) "dolbyvision" else plageDynamique)
            // L'identifiant permet au serveur de retenir les codecs que ce décodeur a refusés, et de
            // cesser de les proposer. Sans lui, la même erreur se répète à chaque lecture.
            .put("deviceId", DeviceIdentity.get(context))
    }
}
