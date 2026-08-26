package tv.flixtunes.app.playback

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Diagnostic des pannes de lecture.
 *
 * L'enjeu tient en une phrase : une coupure réseau et un décodeur défaillant se présentent de la même
 * façon au lecteur, et appellent des réponses opposées. Confondre les deux fait convertir le NAS pour
 * rien et salit durablement la mémoire des codecs.
 */
class PlaybackErrorPolicyTest {
    private val reseau = 2001            // ERROR_CODE_IO_NETWORK_CONNECTION_FAILED
    private val delaiDepasse = 2002      // ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT
    private val analyse = 3001           // ERROR_CODE_PARSING_CONTAINER_MALFORMED
    private val decodage = 4001          // ERROR_CODE_DECODING_FAILED
    private val auDelaDesCapacites = 4002 // ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES
    private val sortieAudio = 5001       // ERROR_CODE_AUDIO_TRACK_INIT_FAILED

    @Test
    fun `une coupure réseau se reprend, sans accuser le décodeur`() {
        // C'est la panne la plus courante sur un NAS domestique : le Wi-Fi qui bascule d'une borne à
        // l'autre. La convertir en défaut de codec ferait transcoder le NAS pour rien et priverait
        // l'appareil de lecture directe sur ce film pendant un mois.
        assertEquals(ReactionErreur.REPRENDRE, reactionPour(reseau, dejaConverti = false, reprisesReseau = 0))
        assertEquals(ReactionErreur.REPRENDRE, reactionPour(delaiDepasse, dejaConverti = false, reprisesReseau = 0))
    }

    @Test
    fun `une coupure réseau se reprend même en cours de conversion`() {
        // Le flux converti passe par le même réseau que le flux direct : la panne n'a rien à voir avec
        // le mode de lecture, et abandonner ici serait renoncer à la première seconde d'interruption.
        assertEquals(ReactionErreur.REPRENDRE, reactionPour(reseau, dejaConverti = true, reprisesReseau = 0))
    }

    @Test
    fun `une coupure qui dure finit par se dire`() {
        // Reprendre indéfiniment donnerait une application qui semble tourner en rond sans rien
        // expliquer. Après quelques tentatives, mieux vaut l'avouer.
        assertEquals(ReactionErreur.REPRENDRE, reactionPour(reseau, dejaConverti = false, reprisesReseau = REPRISES_RESEAU - 1))
        assertEquals(ReactionErreur.ABANDONNER, reactionPour(reseau, dejaConverti = false, reprisesReseau = REPRISES_RESEAU))
    }

    @Test
    fun `le mode tunnel est écarté avant que le codec ne soit mis en cause`() {
        // Un téléviseur qui rend mal le mode tunnel produit exactement la même erreur qu'un décodeur
        // incapable. Accuser le codec ici le priverait de lecture directe sur tous les films qui
        // l'emploient — pour un défaut qui appartient au tunnel.
        assertEquals(ReactionErreur.COUPER_TUNNEL,
            reactionPour(decodage, dejaConverti = false, reprisesReseau = 0, tunnelActif = true))
        assertEquals(ReactionErreur.COUPER_TUNNEL,
            reactionPour(auDelaDesCapacites, dejaConverti = false, reprisesReseau = 0, tunnelActif = true))
    }

    @Test
    fun `le tunnel écarté, le codec redevient le suspect`() {
        // Deuxième échec, tunnel désormais coupé : cette fois c'est bien le décodeur qui refuse.
        assertEquals(ReactionErreur.SIGNALER_ET_CONVERTIR,
            reactionPour(decodage, dejaConverti = false, reprisesReseau = 0, tunnelActif = false))
    }

    @Test
    fun `le mode tunnel n'explique ni le réseau ni le conteneur`() {
        // Couper le tunnel devant une coupure de Wi-Fi perdrait la synchronisation matérielle pour
        // rien, et sans rien réparer.
        assertEquals(ReactionErreur.REPRENDRE,
            reactionPour(reseau, dejaConverti = false, reprisesReseau = 0, tunnelActif = true))
        assertEquals(ReactionErreur.CONVERTIR,
            reactionPour(analyse, dejaConverti = false, reprisesReseau = 0, tunnelActif = true))
    }

    @Test
    fun `un refus du décodeur se signale avant de convertir`() {
        // Le serveur n'a fait que servir le fichier : c'est le seul cas où il ne peut pas apprendre
        // l'échec autrement, et le seul où le codec est réellement en cause.
        assertEquals(ReactionErreur.SIGNALER_ET_CONVERTIR, reactionPour(decodage, dejaConverti = false, reprisesReseau = 0))
        assertEquals(ReactionErreur.SIGNALER_ET_CONVERTIR, reactionPour(auDelaDesCapacites, dejaConverti = false, reprisesReseau = 0))
    }

    @Test
    fun `un conteneur illisible fait convertir sans salir la mémoire des codecs`() {
        // Le décodeur n'a jamais été sollicité : l'extracteur a calé avant. Accuser le codec ici
        // priverait l'appareil de lecture directe pour un défaut qui appartient au fichier.
        assertEquals(ReactionErreur.CONVERTIR, reactionPour(analyse, dejaConverti = false, reprisesReseau = 0))
    }

    @Test
    fun `un refus de la sortie audio fait convertir sans accuser le codec vidéo`() {
        // Cas typique du passthrough : l'ampli déclare accepter le DTS puis le refuse. La conversion
        // règle le problème ; marquer le codec vidéo n'aurait aucun sens.
        assertEquals(ReactionErreur.CONVERTIR, reactionPour(sortieAudio, dejaConverti = false, reprisesReseau = 0))
    }

    @Test
    fun `un échec en conversion ne relance pas une conversion`() {
        // Le flux vient déjà du serveur, fabriqué pour cet appareil. S'il échoue encore, insister
        // reproduirait la même panne indéfiniment.
        for (code in listOf(analyse, decodage, sortieAudio, 6001)) {
            assertEquals("code $code", ReactionErreur.ABANDONNER, reactionPour(code, dejaConverti = true, reprisesReseau = 0))
        }
    }

    @Test
    fun `un code inconnu fait tenter la conversion plutôt que renoncer`() {
        // Media3 ajoute des codes au fil des versions. Devant un numéro qu'on ne connaît pas, essayer
        // le remède le plus général vaut mieux que fermer le lecteur.
        assertEquals(ReactionErreur.CONVERTIR, reactionPour(9999, dejaConverti = false, reprisesReseau = 0))
        assertEquals(ReactionErreur.CONVERTIR, reactionPour(1000, dejaConverti = false, reprisesReseau = 0))
    }
}
