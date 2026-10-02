package tv.flixtunes.app.playback

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import java.io.ByteArrayOutputStream

/** Ne conserve ni manifeste, ni clé, ni réponse partielle/interrompue, ni flux continu. */
@UnstableApi
class SourceDirectAvecCache(private val reseau: DataSource, private val cache: CacheSegmentsDirect) : DataSource {
    private var cle = ""
    private var adresse: Uri? = null
    private var copie: ByteArray? = null
    private var position = 0
    private var reserve: ByteArrayOutputStream? = null
    private var attendu = C.LENGTH_UNSET.toLong()
    private var total = 0L
    private var complet = false
    private var ouvert = false

    override fun addTransferListener(listener: TransferListener) = reseau.addTransferListener(listener)
    override fun getUri(): Uri? = if (copie != null) adresse else reseau.uri
    override fun getResponseHeaders(): Map<String, List<String>> = if (copie != null) emptyMap() else reseau.responseHeaders

    override fun open(dataSpec: DataSpec): Long {
        adresse = dataSpec.uri
        cle = listOf(dataSpec.uri, dataSpec.position, dataSpec.length, dataSpec.httpRequestHeaders.toSortedMap()).toString()
        val chemin = dataSpec.uri.path.orEmpty().lowercase()
        val segment = (listOf(".ts", ".m4s", ".mp4", ".aac", ".m4a").any(chemin::endsWith)
            || (chemin == "/api/live/relais" && dataSpec.uri.getQueryParameter("f") in listOf("ts", "m4s", "mp4", "aac", "m4a")))
            && dataSpec.httpMethod == DataSpec.HTTP_METHOD_GET && dataSpec.httpBody == null
        position = 0
        total = 0
        complet = false
        reserve = null
        copie = if (segment) cache.lire(cle) else null
        copie?.let { return it.size.toLong() }
        ouvert = true
        attendu = reseau.open(dataSpec)
        // Une taille inconnue pourrait être un MPEG-TS continu : on le lit sans le retenir.
        if (segment && attendu in 1..cache.maximumSegment.toLong()) reserve = ByteArrayOutputStream(attendu.toInt())
        return attendu
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        copie?.let {
            if (position == it.size) return C.RESULT_END_OF_INPUT
            val lu = minOf(length, it.size - position)
            it.copyInto(buffer, offset, position, position + lu)
            position += lu
            return lu
        }
        val lu = reseau.read(buffer, offset, length)
        if (lu > 0) {
            total += lu
            if (total <= cache.maximumSegment) reserve?.write(buffer, offset, lu) else reserve = null
            complet = total == attendu
        } else if (lu == C.RESULT_END_OF_INPUT) complet = total == attendu
        return lu
    }

    override fun close() {
        try { if (ouvert) reseau.close() } finally {
            if (complet) reserve?.let { cache.garder(cle, it.toByteArray()) }
            ouvert = false
            reserve = null
            copie = null
        }
    }
}
