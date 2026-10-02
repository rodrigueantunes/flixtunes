package tv.flixtunes.app.playback

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.BaseDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

class ErreurRelaisDirect(val statut: Int) : IOException("Relais indisponible ($statut)")

/** Le jeton ne peut partir que vers le relais du serveur sélectionné. */
fun estOrigineFlixTunes(adresse: String, serveur: String): Boolean = runCatching {
    val cible = URI(adresse)
    val base = URI(serveur)
    fun port(uri: URI) = if (uri.port >= 0) uri.port else if (uri.scheme.equals("https", true)) 443 else 80
    cible.scheme?.lowercase() in setOf("http", "https") && cible.userInfo == null &&
        cible.scheme.equals(base.scheme, true) && cible.host.equals(base.host, true) &&
        port(cible) == port(base)
}.getOrDefault(false)

fun estRelaisFlixTunes(adresse: String, serveur: String): Boolean = estOrigineFlixTunes(adresse, serveur) &&
    runCatching { URI(adresse).path == "/api/live/relais" }.getOrDefault(false)

@UnstableApi
class SourceDirectAuthentifie(private val serveur: String, private val publique: DataSource.Factory) : DataSource {
    private var source: DataSource? = null
    private val auditeurs = mutableListOf<TransferListener>()
    override fun addTransferListener(listener: TransferListener) { auditeurs.add(listener); source?.addTransferListener(listener) }
    override fun open(dataSpec: DataSpec): Long {
        val choisie = if (estRelaisFlixTunes(dataSpec.uri.toString(), serveur)) Relais() else publique.createDataSource()
        source = choisie
        auditeurs.forEach(choisie::addTransferListener)
        return choisie.open(dataSpec)
    }
    override fun read(buffer: ByteArray, offset: Int, length: Int) = source!!.read(buffer, offset, length)
    override fun getUri(): Uri? = source?.uri
    override fun getResponseHeaders(): Map<String, List<String>> = source?.responseHeaders ?: emptyMap()
    override fun close() { try { source?.close() } finally { source = null } }

    /** Le relais ne redirige pas : refuser tout 3xx évite de transmettre les jetons ailleurs. */
    private class Relais : BaseDataSource(true) {
        private var connexion: HttpURLConnection? = null
        private var flux: InputStream? = null
        private var adresse: Uri? = null
        private var restant = C.LENGTH_UNSET.toLong()
        private var ouvert = false
        override fun open(dataSpec: DataSpec): Long {
            transferInitializing(dataSpec)
            adresse = dataSpec.uri
            val http = URL(dataSpec.uri.toString()).openConnection() as HttpURLConnection
            connexion = http
            http.instanceFollowRedirects = false
            http.connectTimeout = 4_000
            http.readTimeout = 8_000
            http.setRequestProperty("Accept-Encoding", "identity")
            http.setRequestProperty("User-Agent", "FlixTunes")
            JetonSession.profil?.let { http.setRequestProperty("X-FlixTunes-Profile-Token", it) }
            JetonSession.compteDistant?.let { http.setRequestProperty("X-FlixTunes-Remote-Token", it) }
            if (dataSpec.position > 0 || dataSpec.length != C.LENGTH_UNSET.toLong()) {
                val fin = if (dataSpec.length == C.LENGTH_UNSET.toLong()) "" else (dataSpec.position + dataSpec.length - 1).toString()
                http.setRequestProperty("Range", "bytes=${dataSpec.position}-$fin")
            }
            if (http.responseCode !in 200..299) throw ErreurRelaisDirect(http.responseCode)
            val entree = http.inputStream
            flux = entree
            var sauter = if (http.responseCode == 200) dataSpec.position else 0L
            while (sauter > 0) {
                val saute = entree.skip(sauter)
                if (saute > 0) sauter -= saute else if (entree.read() < 0) throw IOException("Position indisponible") else sauter--
            }
            restant = if (dataSpec.length != C.LENGTH_UNSET.toLong()) dataSpec.length else
                (http.getHeaderField("Content-Length")?.toLongOrNull() ?: -1L).let { taille ->
                    if (taille >= 0 && http.responseCode == 200) maxOf(0L, taille - dataSpec.position) else taille
                }
            ouvert = true
            transferStarted(dataSpec)
            return restant
        }
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (length == 0) return 0
            if (restant == 0L) return C.RESULT_END_OF_INPUT
            val taille = if (restant < 0) length else minOf(length.toLong(), restant).toInt()
            val lus = flux!!.read(buffer, offset, taille)
            if (lus > 0) { if (restant > 0) restant -= lus; bytesTransferred(lus) }
            return lus
        }
        override fun getUri(): Uri? = adresse
        override fun close() {
            try { flux?.close() } finally {
                connexion?.disconnect(); connexion = null; flux = null; adresse = null
                if (ouvert) { ouvert = false; transferEnded() }
            }
        }
    }
}
