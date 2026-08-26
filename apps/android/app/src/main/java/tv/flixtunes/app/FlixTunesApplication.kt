package tv.flixtunes.app

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.memory.MemoryCache
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.disk.directory
import coil3.size.Precision
import coil3.request.crossfade
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import okhttp3.OkHttpClient
import tv.flixtunes.app.playback.JetonSession
import tv.flixtunes.app.ui.tailleCacheImages

/**
 * Fournit le chargeur d'images de l'application, avec son cache sur disque.
 *
 * Coil ne garde par défaut les jaquettes qu'en mémoire : quitter l'accueil et y revenir les
 * retélécharge toutes. Sur un téléviseur relié en Wi-Fi à un NAS domestique, cela se voit — la grille
 * se remplit par à-coups à chaque retour, alors que rien n'a changé et que les images sont déjà venues
 * une fois.
 *
 * La taille du cache se calcule sur l'espace réellement libre ([tailleCacheImages]) plutôt que d'être
 * fixée d'avance : un boîtier TV n'a pas les réserves d'une tablette, et une valeur unique
 * conviendrait mal à l'un des deux. Quand l'appareil est trop juste, aucun cache disque n'est
 * installé — l'application fonctionne sans cache, elle ne fonctionne pas sans espace.
 */
class FlixTunesApplication : Application(), SingletonImageLoader.Factory {

    override fun newImageLoader(context: PlatformContext): ImageLoader {
        val dossier = cacheDir.resolve("jaquettes")
        val taille = tailleCacheImages(cacheDir.usableSpace)
        val television = estAppareilTv(this)
        return ImageLoader.Builder(context)
            /*
             * Les jaquettes portent les mêmes titres d'accès que le reste.
             *
             * Coil possède sa propre pile HTTP : elle ne sait rien des jetons que l'API transporte.
             * Sur le réseau local cela ne se voyait pas — aucune session n'y est réclamée. Depuis
             * Internet, chaque `/api/artwork/…` repartait en 401 et la grille n'affichait que des
             * aplats de couleur, pendant que titres et années s'affichaient normalement puisqu'ils
             * passent, eux, par l'API.
             *
             * Les en-têtes sont relus à **chaque** requête et non posés une fois : le jeton change au
             * fil des déverrouillages, et un chargeur construit au démarrage vivrait sinon avec celui
             * du premier profil ouvert.
             */
            .components {
                add(OkHttpNetworkFetcherFactory(callFactory = {
                    OkHttpClient.Builder().addInterceptor { chaine ->
                        val requete = chaine.request().newBuilder().apply {
                            JetonSession.profil?.takeIf { it.isNotBlank() }
                                ?.let { header("X-FlixTunes-Profile-Token", it) }
                            JetonSession.compteDistant?.takeIf { it.isNotBlank() }
                                ?.let { header("X-FlixTunes-Remote-Token", it) }
                        }.build()
                        chaine.proceed(requete)
                    }.build()
                }))
            }
            // Sur TV, animer simultanément une rangée de grandes textures provoque précisément les
            // à-coups ressentis pendant un défilement rapide. L'image finale reste identique.
            .crossfade(!television)
            // Une même affiche peut apparaître dans plusieurs rails à quelques pixels près. Le
            // décodage approché permet de réutiliser le bitmap déjà en mémoire au lieu d'en créer un
            // nouveau pour chaque contexte, sans réduire sa définition visible.
            .precision(Precision.INEXACT)
            .memoryCache {
                MemoryCache.Builder().maxSizePercent(context, if (television) 0.28 else 0.22).build()
            }
            .apply {
                if (taille > 0) {
                    diskCache { DiskCache.Builder().directory(dossier).maxSizeBytes(taille).build() }
                }
            }
            .build()
    }
}
