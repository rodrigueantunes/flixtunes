package tv.flixtunes.app.playback

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.InputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.URL
import kotlin.concurrent.thread

/** Un téléviseur DLNA découvert sur le Wi-Fi où se trouve le téléphone. */
data class TeleviseurDlna(val lieu: String, val description: String, val nom: String, val modele: String?, val udn: String)

/**
 * Le DLNA chez un proche (r11), côté téléphone.
 *
 * Le NAS compose toutes les commandes du téléviseur, comme pour un téléviseur de la maison. Le
 * téléphone, qui est sur le même Wi-Fi que lui, se contente de trois gestes, chacun borné :
 *
 * - **découvrir** les téléviseurs DLNA du réseau (SSDP), et lire leur description ;
 * - **poster** les commandes SOAP du NAS, seulement à l'adresse du téléviseur qu'il a annoncé ;
 * - **relayer la vidéo** en clair sur le Wi-Fi : beaucoup de téléviseurs DLNA ne lisent pas le HTTPS,
 *   ou ne reconnaissent pas un certificat récent. Le relais ne sert que le chemin du flux à clé, et
 *   ne le demande qu'au NAS, en HTTPS.
 */
object RelaisDlna {
    private val cheminFlux = Regex("^/api/diffusion/flux/[a-f0-9]{64}/[A-Za-z0-9_.-]{1,160}$")
    private var serveur: ServerSocket? = null
    private var base: String? = null
    private var nasCourant: String? = null

    /** L'adresse IPv4 privée du téléphone sur son Wi-Fi, ou `null` sans réseau local. */
    fun adresseWifi(): Inet4Address? = runCatching {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback && !it.isVirtual }
            .sortedBy { if (it.name.startsWith("wlan")) 0 else 1 }
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .firstOrNull { it.isSiteLocalAddress }
    }.getOrNull()

    fun privee(hote: String): Boolean {
        val o = hote.split(".").mapNotNull { it.toIntOrNull() }
        if (o.size != 4 || o.any { it !in 0..255 }) return false
        return o[0] == 10 || (o[0] == 192 && o[1] == 168) || (o[0] == 172 && o[1] in 16..31)
    }

    private fun lireBorne(flux: InputStream, limite: Int): String {
        val tampon = ByteArray(limite); var lu = 0
        while (lu < limite) { val n = flux.read(tampon, lu, limite - lu); if (n < 0) break; lu += n }
        return String(tampon, 0, lu, Charsets.UTF_8)
    }

    private fun xmlTexte(xml: String, balise: String): String? =
        Regex("<(?:[A-Za-z0-9]+:)?$balise>([^<]{1,200})</(?:[A-Za-z0-9]+:)?$balise>").find(xml)?.groupValues?.get(1)
            ?.replace("&lt;", "<")?.replace("&gt;", ">")?.replace("&quot;", "\"")?.replace("&apos;", "'")?.replace("&amp;", "&")?.trim()

    /** Les téléviseurs DLNA du Wi-Fi courant : trois secondes d'écoute, seize au plus. */
    suspend fun decouvrir(): List<TeleviseurDlna> = withContext(Dispatchers.IO) {
        val ip = adresseWifi() ?: return@withContext emptyList()
        val lieux = linkedSetOf<String>()
        runCatching {
            DatagramSocket(InetSocketAddress(ip, 0)).use { socket ->
                socket.soTimeout = 400
                val message = ("M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\n" +
                    "ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n").toByteArray()
                val groupe = InetSocketAddress(InetAddress.getByName("239.255.255.250"), 1900)
                repeat(2) { socket.send(DatagramPacket(message, message.size, groupe)) }
                val fin = System.currentTimeMillis() + 3000
                val tampon = ByteArray(2048)
                while (System.currentTimeMillis() < fin && lieux.size < 16) {
                    try {
                        val paquet = DatagramPacket(tampon, tampon.size)
                        socket.receive(paquet)
                        Regex("(?im)^location:\\s*(\\S+)").find(String(paquet.data, 0, paquet.length))?.groupValues?.get(1)?.let { lieux += it }
                    } catch (_: SocketTimeoutException) { /* on écoute jusqu'au bout */ }
                }
            }
        }
        lieux.mapNotNull { lieu -> runCatching { decrire(lieu) }.getOrNull() }.distinctBy { it.udn }
    }

    private fun decrire(lieu: String): TeleviseurDlna? {
        val url = URL(lieu)
        if (url.protocol != "http" || !privee(url.host)) return null
        val connexion = url.openConnection() as HttpURLConnection
        connexion.connectTimeout = 3000; connexion.readTimeout = 3000; connexion.instanceFollowRedirects = false
        val xml = try { connexion.inputStream.use { lireBorne(it, 65_536) } } finally { connexion.disconnect() }
        if (!xml.contains(":MediaRenderer:")) return null
        return TeleviseurDlna(lieu, xml, xmlTexte(xml, "friendlyName") ?: "Téléviseur DLNA", xmlTexte(xml, "modelName"),
            xmlTexte(xml, "UDN") ?: lieu)
    }

    /**
     * Poste au téléviseur une commande SOAP composée par le NAS. Seule l'adresse du téléviseur annoncé
     * est admise : le NAS ne peut pas se servir du téléphone pour joindre autre chose sur ce réseau.
     */
    suspend fun poster(lieu: String, adresse: String, action: String, corps: String): Pair<Int, String> = withContext(Dispatchers.IO) {
        val televiseur = URL(lieu); val cible = URL(adresse)
        val port = { u: URL -> if (u.port == -1) 80 else u.port }
        require(cible.protocol == "http" && cible.host == televiseur.host && port(cible) == port(televiseur) && privee(cible.host)) {
            "Adresse de commande refusée" }
        require(corps.length <= 65_536 && action.length <= 200 && !action.contains('\n')) { "Commande refusée" }
        val connexion = cible.openConnection() as HttpURLConnection
        try {
            connexion.requestMethod = "POST"; connexion.connectTimeout = 4000; connexion.readTimeout = 8000
            connexion.instanceFollowRedirects = false; connexion.doOutput = true
            connexion.setRequestProperty("Content-Type", "text/xml; charset=\"utf-8\"")
            connexion.setRequestProperty("SOAPAction", "\"$action\"")
            connexion.outputStream.use { it.write(corps.toByteArray(Charsets.UTF_8)) }
            val code = connexion.responseCode
            val texte = (if (code < 400) connexion.inputStream else connexion.errorStream)?.use { lireBorne(it, 262_144) }.orEmpty()
            code to texte
        } finally { connexion.disconnect() }
    }

    /**
     * Le relais vidéo du téléphone, démarré au besoin : l'adresse à donner au NAS, ou `null` sans Wi-Fi.
     * Il suit l'adresse du téléphone, qui change avec le réseau.
     */
    @Synchronized
    fun relais(nas: String): String? {
        val ip = adresseWifi() ?: return null
        val actuel = serveur
        if (actuel != null && !actuel.isClosed && nasCourant == nas && base == "http://${ip.hostAddress}:${actuel.localPort}") return base
        fermer()
        val socket = runCatching { ServerSocket(0, 16, ip) }.getOrNull() ?: return null
        serveur = socket; nasCourant = nas
        base = "http://${ip.hostAddress}:${socket.localPort}"
        thread(name = "flixtunes-relais-dlna", isDaemon = true) {
            while (!socket.isClosed) {
                val client = try { socket.accept() } catch (_: Exception) { break }
                thread(name = "flixtunes-relais-dlna-flux", isDaemon = true) { runCatching { servir(client, nas) } }
            }
        }
        return base
    }

    @Synchronized
    fun fermer() { runCatching { serveur?.close() }; serveur = null; base = null; nasCourant = null }

    private fun lireLigne(flux: InputStream): String? {
        val ligne = StringBuilder()
        while (ligne.length < 8192) {
            val c = flux.read(); if (c < 0) return if (ligne.isEmpty()) null else ligne.toString()
            if (c == '\n'.code) return ligne.toString().trimEnd('\r')
            ligne.append(c.toChar())
        }
        return null
    }

    private fun servir(client: Socket, nas: String) = client.use { c ->
        c.soTimeout = 30_000
        val entree = BufferedInputStream(c.getInputStream())
        val sortie = BufferedOutputStream(c.getOutputStream())
        val premiere = lireLigne(entree)?.split(" ") ?: return@use
        val entetes = mutableMapOf<String, String>()
        while (entetes.size < 64) {
            val ligne = lireLigne(entree) ?: return@use
            if (ligne.isEmpty()) break
            val i = ligne.indexOf(':'); if (i > 0) entetes[ligne.substring(0, i).trim().lowercase()] = ligne.substring(i + 1).trim()
        }
        val methode = premiere.getOrNull(0); val chemin = premiere.getOrNull(1).orEmpty()
        if ((methode != "GET" && methode != "HEAD") || !cheminFlux.matches(chemin)) {
            sortie.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()); sortie.flush(); return@use
        }
        val amont = URL(nas.trimEnd('/') + chemin).openConnection() as HttpURLConnection
        try {
            amont.requestMethod = methode; amont.connectTimeout = 10_000; amont.readTimeout = 60_000; amont.instanceFollowRedirects = false
            entetes["range"]?.let { amont.setRequestProperty("Range", it) }
            entetes["getcontentfeatures.dlna.org"]?.let { amont.setRequestProperty("getcontentFeatures.dlna.org", it) }
            val code = amont.responseCode
            val reponse = StringBuilder("HTTP/1.1 $code ${amont.responseMessage ?: ""}\r\n")
            for (nom in listOf("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "contentFeatures.dlna.org", "transferMode.dlna.org")) {
                amont.getHeaderField(nom)?.let { reponse.append("$nom: $it\r\n") }
            }
            // Sans longueur annoncée — un direct en MPEG-TS continu —, le corps court jusqu'à la fermeture.
            reponse.append("Connection: close\r\n\r\n")
            sortie.write(reponse.toString().toByteArray())
            if (methode == "GET") (if (code < 400) amont.inputStream else amont.errorStream)?.use { it.copyTo(sortie, 64 * 1024) }
            sortie.flush()
        } finally { amont.disconnect() }
    }
}
