package tv.flixtunes.app.data

import java.net.URI

object ServerUrl {
    /**
     * Une adresse est-elle celle d'un serveur du réseau local ?
     *
     * Sert à décider si le trafic en clair est acceptable. La liste couvre ce qu'un NAS domestique
     * peut porter : boucle locale, plages privées RFC 1918, lien-local, et les noms `.local` publiés
     * par mDNS. Tout le reste est réputé passer par Internet.
     */
    fun estAdresseLocale(hote: String): Boolean {
        val h = hote.lowercase().trim('[', ']')
        if (h == "localhost" || h == "127.0.0.1" || h == "::1") return true
        if (h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".home")) return true
        if (h.startsWith("10.") || h.startsWith("192.168.")) return true
        if (h.startsWith("169.254.")) return true
        if (Regex("^172\\.(1[6-9]|2\\d|3[01])\\.").containsMatchIn(h)) return true
        // Adresses locales uniques IPv6 (fc00::/7) et lien-local (fe80::/10).
        if (Regex("^(f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)").containsMatchIn(h)) return true
        return false
    }

    /**
     * Normalise l'adresse du serveur, et **impose TLS hors du réseau local**.
     *
     * Android n'exprime pas de plages d'adresses dans `network_security_config` : on ne peut y
     * autoriser le trafic en clair « sur les plages privées » et l'interdire ailleurs. Le contrôle
     * est donc fait ici, où il est exact.
     *
     * Concrètement : une adresse locale garde `http` et le sous-entend quand rien n'est précisé — le
     * comportement historique, inchangé pour tous les usages existants. Une adresse publique, elle,
     * passe en `https` par défaut, et un `http://` explicite est refusé : accepter le clair vers
     * Internet reviendrait à laisser partir le code PIN, le jeton de session et le film lui-même en
     * lecture libre sur le chemin.
     */
    fun normalize(input: String): String {
        var value = input.trim().trimEnd('/')
        val hoteBrut = value.substringAfter("://", value).substringBefore('/').substringBefore(':')
        val local = estAdresseLocale(hoteBrut)
        if (!value.contains("://")) value = if (local) "http://$value" else "https://$value"
        val uri = URI(value)
        require(uri.scheme == "http" || uri.scheme == "https") { "Protocole non pris en charge" }
        require(!uri.host.isNullOrBlank()) { "Adresse du serveur invalide" }
        require(uri.scheme == "https" || estAdresseLocale(uri.host)) {
            "Une adresse distante doit utiliser HTTPS"
        }
        val port = if (uri.port >= 0) ":${uri.port}" else ""
        return "${uri.scheme}://${uri.host}$port"
    }

    fun apiRoot(input: String) = "${normalize(input)}/api"
    fun resolve(server: String, path: String?): String? = path?.let {
        if (it.startsWith("http://") || it.startsWith("https://")) it else "${normalize(server)}/${it.trimStart('/')}"
    }
}
