package tv.flixtunes.app.playback

import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi

/**
 * Présente le temps du **film** là où Media3 ne connaît que celui du flux.
 *
 * `PlayerView` interroge le lecteur pour dessiner sa barre : durée totale, position, portion mise en
 * mémoire tampon. En conversion, ces trois valeurs portent sur la fenêtre encodée, pas sur le film —
 * d'où une barre dont le total grandit pendant la lecture et un curseur qu'on ne peut pas déplacer
 * au-delà de ce qui est déjà produit.
 *
 * Intercaler ce lecteur entre la vue et le vrai lecteur corrige l'affichage **et** la navigation, sans
 * toucher à la barre elle-même : Media3 continue de faire son travail, on lui donne simplement les
 * bons nombres. En lecture directe la fenêtre commence à zéro et couvre tout le film : la traduction
 * est alors l'identité, et le même chemin sert les deux modes.
 *
 * @param fenetre l'état courant, relu à chaque appel — il change à chaque relance de session.
 * @param relancer appelé quand la cible sort de la fenêtre encodée ; à charge de l'appelant de
 *   redemander une session au serveur à cette position, en secondes de film.
 */
@UnstableApi
class LecteurFenetre(
    lecteur: Player,
    private val fenetre: () -> FenetreLecture,
    private val relancer: (secondesFilm: Double) -> Unit,
) : ForwardingPlayer(lecteur) {

    private fun decalageMs(): Long = (fenetre().decalageSecondes * 1000).toLong()

    override fun getDuration(): Long = dureeAffichee(fenetre(), super.getDuration())

    override fun getContentDuration(): Long = dureeAffichee(fenetre(), super.getContentDuration())

    override fun getCurrentPosition(): Long = decalageMs() + super.getCurrentPosition()

    override fun getContentPosition(): Long = decalageMs() + super.getContentPosition()

    override fun getBufferedPosition(): Long = decalageMs() + super.getBufferedPosition()

    override fun getContentBufferedPosition(): Long = decalageMs() + super.getContentBufferedPosition()

    /**
     * La position visée arrive en temps de film ; elle repart en temps de flux, ou en relance.
     *
     * Toutes les navigations de `PlayerView` — curseur déplacé, avance de dix secondes, retour de
     * cinq — passent par ici, donc aucune n'échappe à la traduction.
     */
    override fun seekTo(positionMs: Long) = naviguer(positionMs) { super.seekTo(it) }

    override fun seekTo(mediaItemIndex: Int, positionMs: Long) =
        naviguer(positionMs) { super.seekTo(mediaItemIndex, it) }

    private inline fun naviguer(positionFilmMs: Long, seek: (Long) -> Unit) {
        val cible = positionFilmMs / 1000.0
        val etat = fenetre()
        // La durée du flux se lit sur le lecteur enveloppé : celle rendue par cette classe est déjà
        // corrigée, et s'en servir ici comparerait la cible à elle-même.
        val dureeFlux = super.getDuration().takeIf { it > 0 }?.let { it / 1000.0 } ?: 0.0
        if (relanceNecessaire(cible, etat, dureeFlux)) relancer(cible)
        else seek((tempsFlux(cible, etat) * 1000).toLong())
    }
}
