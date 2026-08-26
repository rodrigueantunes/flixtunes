package tv.flixtunes.app.ui

/**
 * Dimensionnement du cache de jaquettes sur disque.
 *
 * Coil garde par défaut les images en mémoire seulement : quitter l'accueil et y revenir les
 * retélécharge toutes. Sur un téléviseur relié en Wi-Fi à un NAS domestique, cela se voit — la grille
 * se remplit par à-coups à chaque retour, alors que rien n'a changé.
 *
 * La taille ne se fixe pas au hasard. Trop petite, le cache évince les jaquettes avant qu'on y
 * revienne et ne sert à rien ; trop grande, il occupe la place d'un appareil qui en manque souvent —
 * un boîtier TV a rarement plus de huit gigaoctets, partagés avec tout le reste.
 *
 * Le calcul est isolé ici pour être vérifiable sans appareil : c'est une règle de proportion, pas une
 * affaire d'Android.
 */

/** Part de l'espace disponible que le cache s'autorise. */
const val PART_DISQUE = 0.02

/** Plancher : en dessous, le cache évincerait avant qu'on revienne, donc ne servirait à rien. */
const val CACHE_MINIMUM_OCTETS = 32L * 1024 * 1024

/** Plafond : au-delà, on prend la place d'un appareil qui en manque plus qu'il ne manque de réseau. */
const val CACHE_MAXIMUM_OCTETS = 512L * 1024 * 1024

/**
 * La taille à donner au cache, en octets, pour [octetsDisponibles] d'espace libre.
 *
 * Une part de l'espace libre, bornée des deux côtés. Sur un appareil presque plein, le plancher n'est
 * pas appliqué : mieux vaut un cache absent qu'un disque saturé — l'application continue de
 * fonctionner sans cache, elle ne fonctionne pas sans espace.
 */
fun tailleCacheImages(octetsDisponibles: Long): Long {
    if (octetsDisponibles <= 0) return 0
    val part = (octetsDisponibles * PART_DISQUE).toLong()
    if (part < CACHE_MINIMUM_OCTETS) {
        // L'appareil est trop juste pour un cache utile : on renonce plutôt que d'insister.
        return if (octetsDisponibles > CACHE_MINIMUM_OCTETS * 4) CACHE_MINIMUM_OCTETS else 0
    }
    return part.coerceAtMost(CACHE_MAXIMUM_OCTETS)
}
