package tv.flixtunes.app.playback

import android.content.Context
import android.media.MediaFormat
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.mediacodec.ForwardingMediaCodecAdapter
import androidx.media3.exoplayer.mediacodec.MediaCodecAdapter
import java.nio.ByteBuffer

/** Préférence de la session directe courante, lue sur le thread du codec. */
internal object HdrDirectPlayPreference {
    @Volatile
    var neutraliserHdr10PlusPourDolbyVision: Boolean = false

}

/** Le filtre ne doit jamais transformer un remux, un transcodage ou un choix HDR10+. */
internal fun filtrerHdr10PlusPourDolbyVisionDirect(mode: String?, sortieDynamique: String?): Boolean =
    mode == "direct" && sortieDynamique == "dolbyvision"

internal data class ResultatRetraitHdr10Plus(
    val messagesRetires: Int,
    val nouvelleTaille: Int,
    val octetsRetires: Int,
    val rpuDolbyVision: Int = 0,
)

private data class RemplacementNal(val debut: Int, val fin: Int, val octets: ByteArray, val messages: Int)

/**
 * Retire réellement les messages SEI HDR10+ SMPTE ST 2094-40 du flux HEVC remis à MediaCodec.
 *
 * R53 ne changeait que `application_identifier`. Le téléviseur de référence reconnaissait encore le
 * fournisseur Samsung du message et déclenchait HDR10+ Adaptive. Cette version suit la stratégie de
 * référence de Kodi : si le NAL ne contient que HDR10+, le NAL entier disparaît ; s'il contient aussi
 * d'autres SEI, seul le message HDR10+ est retiré et les autres sont reconstruits. Les NAL Dolby
 * Vision RPU (types 62/63), les images, les horodatages et le conteneur restent strictement intacts.
 */
internal fun retirerHdr10PlusDansHevc(tampon: ByteBuffer, offset: Int, taille: Int): ResultatRetraitHdr10Plus {
    val fin = (offset + taille).coerceAtMost(tampon.limit())
    if (offset < 0 || taille <= 0 || offset >= fin) return ResultatRetraitHdr10Plus(0, taille.coerceAtLeast(0), 0)

    fun longueurCodeDepart(position: Int): Int = when {
        position + 3 <= fin && tampon.get(position).toInt() == 0 && tampon.get(position + 1).toInt() == 0
            && tampon.get(position + 2).toInt() == 1 -> 3
        position + 4 <= fin && tampon.get(position).toInt() == 0 && tampon.get(position + 1).toInt() == 0
            && tampon.get(position + 2).toInt() == 0 && tampon.get(position + 3).toInt() == 1 -> 4
        else -> 0
    }

    fun prochainCodeDepart(depart: Int): Int {
        var position = depart
        while (position + 3 <= fin) {
            if (longueurCodeDepart(position) > 0) return position
            position += 1
        }
        return fin
    }

    fun contientSignatureHdr10Plus(debut: Int, limite: Int): Boolean {
        val signature = intArrayOf(0xB5, 0x00, 0x3C, 0x00, 0x01, 0x04)
        var position = debut
        while (position + signature.size <= limite) {
            if (signature.indices.all { rang -> tampon.get(position + rang).toInt() and 0xFF == signature[rang] }) return true
            position += 1
        }
        return false
    }

    fun rbspSansEmulation(debutNal: Int, finNal: Int): ByteArray {
        val sortie = ArrayList<Byte>(finNal - debutNal)
        var zeros = 0
        var position = debutNal
        while (position < finNal) {
            val valeur = tampon.get(position).toInt() and 0xFF
            if (position >= debutNal + 2 && zeros >= 2 && valeur == 3 && position + 1 < finNal
                && (tampon.get(position + 1).toInt() and 0xFF) <= 3) {
                position += 1
                continue
            }
            sortie.add(valeur.toByte())
            zeros = if (valeur == 0) zeros + 1 else 0
            position += 1
        }
        return sortie.toByteArray()
    }

    fun avecEmulation(rbsp: ByteArray): ByteArray {
        val sortie = ArrayList<Byte>(rbsp.size + 8)
        var zeros = 0
        rbsp.forEachIndexed { index, octet ->
            val valeur = octet.toInt() and 0xFF
            if (index >= 2 && zeros >= 2 && valeur <= 3) {
                sortie.add(3)
                zeros = 0
            }
            sortie.add(octet)
            zeros = if (valeur == 0) zeros + 1 else 0
        }
        return sortie.toByteArray()
    }

    fun nettoyerSei(debutCode: Int, longueurCode: Int, debutNal: Int, finNal: Int): RemplacementNal? {
        if (!contientSignatureHdr10Plus(debutNal + 2, finNal)) return null
        val rbsp = rbspSansEmulation(debutNal, finNal)
        if (rbsp.size <= 3) return null
        val retraits = mutableListOf<IntRange>()
        var messages = 0
        var position = 2
        while (position < rbsp.size) {
            if ((rbsp[position].toInt() and 0xFF) == 0x80) break // rbsp_trailing_bits
            val debutMessage = position
            var type = 0
            var valeur: Int
            do {
                if (position >= rbsp.size) return null
                valeur = rbsp[position++].toInt() and 0xFF
                type += valeur
            } while (valeur == 0xFF)
            var taillePayload = 0
            do {
                if (position >= rbsp.size) return null
                valeur = rbsp[position++].toInt() and 0xFF
                taillePayload += valeur
            } while (valeur == 0xFF)
            val debutPayload = position
            val finPayload = debutPayload + taillePayload
            if (finPayload > rbsp.size) return null
            val hdr10Plus = type == 4 && taillePayload >= 7
                && (rbsp[debutPayload].toInt() and 0xFF) == 0xB5
                && (rbsp[debutPayload + 1].toInt() and 0xFF) == 0x00
                && (rbsp[debutPayload + 2].toInt() and 0xFF) == 0x3C
                && (rbsp[debutPayload + 3].toInt() and 0xFF) == 0x00
                && (rbsp[debutPayload + 4].toInt() and 0xFF) == 0x01
                && (rbsp[debutPayload + 5].toInt() and 0xFF) == 0x04
                && (rbsp[debutPayload + 6].toInt() and 0xFF) <= 1
            if (hdr10Plus) retraits += debutMessage until finPayload
            messages += 1
            position = finPayload
        }
        if (retraits.isEmpty()) return null

        val codeDepart = ByteArray(longueurCode) { tampon.get(debutCode + it) }
        val rbspRestant = if (retraits.size == messages) ByteArray(0) else rbsp.filterIndexed { index, _ ->
            retraits.none { index in it }
        }.toByteArray()
        val remplacement = if (rbspRestant.isEmpty()) ByteArray(0) else codeDepart + avecEmulation(rbspRestant)
        return RemplacementNal(debutCode, finNal, remplacement, retraits.size)
    }

    val remplacements = mutableListOf<RemplacementNal>()
    var rpuDolbyVision = 0
    var recherche = offset
    while (recherche < fin) {
        val debut = prochainCodeDepart(recherche)
        if (debut >= fin) break
        val longueur = longueurCodeDepart(debut)
        val entete = debut + longueur
        val prochain = prochainCodeDepart(entete + 2)
        if (entete + 2 <= fin) {
            val typeNal = (tampon.get(entete).toInt() and 0x7E) ushr 1
            if (typeNal == 62 || typeNal == 63) rpuDolbyVision += 1
            if (typeNal == 39 || typeNal == 40) {
                nettoyerSei(debut, longueur, entete, prochain)?.let(remplacements::add)
            }
        }
        recherche = if (prochain > debut) prochain else debut + longueur.coerceAtLeast(1)
    }
    if (remplacements.isEmpty()) return ResultatRetraitHdr10Plus(0, taille, 0, rpuDolbyVision)

    var lecture = offset
    var ecriture = offset
    remplacements.forEach { remplacement ->
        var position = lecture
        while (position < remplacement.debut) tampon.put(ecriture++, tampon.get(position++))
        remplacement.octets.forEach { tampon.put(ecriture++, it) }
        lecture = remplacement.fin
    }
    while (lecture < fin) tampon.put(ecriture++, tampon.get(lecture++))
    val nouvelleTaille = ecriture - offset
    val messagesRetires = remplacements.sumOf { it.messages }
    return ResultatRetraitHdr10Plus(messagesRetires, nouvelleTaille, taille - nouvelleTaille, rpuDolbyVision)
}

@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
private class Hdr10PlusFilteringAdapter(delegate: MediaCodecAdapter) : ForwardingMediaCodecAdapter(delegate) {
    override fun queueInputBuffer(index: Int, offset: Int, size: Int, presentationTimeUs: Long, flags: Int) {
        val resultat = if (HdrDirectPlayPreference.neutraliserHdr10PlusPourDolbyVision)
            getInputBuffer(index)?.let { retirerHdr10PlusDansHevc(it, offset, size) }
        else null
        super.queueInputBuffer(index, offset, resultat?.nouvelleTaille ?: size, presentationTimeUs, flags)
    }
}

/** Nettoie également les blocs CSD que MediaCodec reçoit pendant sa configuration. */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
private fun neutraliserInitialisationCodec(format: MediaFormat) {
    for (index in 0..3) {
        val cle = "csd-$index"
        val donnees = runCatching { format.getByteBuffer(cle) }.getOrNull() ?: continue
        val debut = donnees.position()
        val resultat = retirerHdr10PlusDansHevc(donnees, debut, donnees.remaining())
        if (resultat.messagesRetires > 0) {
            // Certains constructeurs copient le ByteBuffer au premier set. Le réinscrire rend la
            // mutation explicite au lieu de dépendre de l'implémentation de MediaFormat.
            donnees.limit(debut + resultat.nouvelleTaille)
            donnees.position(debut)
            format.setByteBuffer(cle, donnees)
        }
    }
}

/** Garde les renderers Media3 d'origine et enveloppe seulement le codec vidéo Dolby Vision. */
@androidx.annotation.OptIn(markerClass = [UnstableApi::class])
internal class FlixTunesRenderersFactory(context: Context) : DefaultRenderersFactory(context) {
    private val delegateFactory = super.getCodecAdapterFactory()
    private val filteringFactory = MediaCodecAdapter.Factory { configuration ->
        // Selon le constructeur, Media3 conserve `video/dolby-vision` dans la configuration ou
        // adapte la couche de base en `video/hevc` juste avant MediaCodec. R52 n'enveloppait que le
        // premier libellé : sur le téléviseur de référence, aucun échantillon de Lucky n'était donc
        // nettoyé. Envelopper les deux reste sans effet hors session DV, grâce au drapeau volatile.
        val mimeFormat = configuration.format.sampleMimeType
        val mimeCodec = runCatching { configuration.mediaFormat.getString(MediaFormat.KEY_MIME) }.getOrNull()
        val hevcOuDolby = mimeFormat == MimeTypes.VIDEO_DOLBY_VISION || mimeFormat == MimeTypes.VIDEO_H265
            || mimeCodec == MimeTypes.VIDEO_DOLBY_VISION || mimeCodec == MimeTypes.VIDEO_H265
        if (hevcOuDolby && HdrDirectPlayPreference.neutraliserHdr10PlusPourDolbyVision) {
            neutraliserInitialisationCodec(configuration.mediaFormat)
        }
        val adapter = delegateFactory.createAdapter(configuration)
        if (hevcOuDolby) Hdr10PlusFilteringAdapter(adapter)
        else adapter
    }

    override fun getCodecAdapterFactory(): MediaCodecAdapter.Factory = filteringFactory
}
