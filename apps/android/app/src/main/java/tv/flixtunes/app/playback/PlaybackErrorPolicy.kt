package tv.flixtunes.app.playback

/**
 * Que faire quand la lecture s'arrête.
 *
 * Toutes les pannes se ressemblent vues du lecteur : l'image se fige et une exception remonte. Elles
 * ne se soignent pourtant pas de la même façon, et se tromper de remède coûte cher.
 *
 * Une coupure de Wi-Fi traitée comme un défaut de décodeur, c'est le NAS lancé dans une conversion
 * inutile — le processeur monte, les autres lectures ralentissent — et un codec parfaitement sain
 * marqué comme fautif : la prochaine lecture du même film sera convertie elle aussi. À l'inverse, un
 * décodeur qui refuse un profil et qu'on réessaie à l'identique échoue autant de fois qu'on insiste.
 *
 * Media3 numérote ses erreurs par familles de mille. Ce module traduit ce numéro en conduite à tenir,
 * sans rien connaître d'Android : c'est un raisonnement, et il se vérifie sur une machine ordinaire.
 */

/** Premier code de chaque famille d'erreurs Media3, tel que `PlaybackException` les publie. */
const val ERREURS_RESEAU = 2000       // lecture de la source : réseau, HTTP, fichier
const val ERREURS_ANALYSE = 3000      // conteneur ou manifeste illisible
const val ERREURS_DECODAGE = 4000     // le décodeur refuse le flux
const val ERREURS_AUDIO = 5000        // la sortie audio refuse le format
const val ERREURS_DRM = 6000

/** Nombre de reprises accordées à une panne de réseau avant de renoncer. */
const val REPRISES_RESEAU = 4

/** La conduite à tenir face à une erreur de lecture. */
enum class ReactionErreur {
    /** Reprendre la même source : la panne est passagère et le flux n'est pas en cause. */
    REPRENDRE,

    /** Demander au serveur un flux converti, sans accuser le codec. */
    CONVERTIR,

    /** Le décodeur a refusé : le signaler pour qu'on cesse de le proposer, puis convertir. */
    SIGNALER_ET_CONVERTIR,

    /**
     * Couper le mode tunnel et reprendre en lecture directe.
     *
     * Le mode tunnel confie les images au matériel sans que l'application les voie passer : la
     * synchronisation avec le son y gagne, la consommation aussi. Mais plusieurs téléviseurs
     * l'annoncent et le rendent mal — image noire, son seul. Devant un refus de décodage alors que le
     * tunnel est actif, c'est lui le suspect le plus probable, pas le codec.
     */
    COUPER_TUNNEL,

    /** Plus rien à tenter : prévenir la personne plutôt que de boucler en silence. */
    ABANDONNER,
}

/**
 * La réaction appelée par [errorCode], selon ce qui a déjà été tenté.
 *
 * [dejaConverti] dit qu'on lit déjà un flux fabriqué par le serveur : l'échec ne vient alors plus du
 * fichier d'origine, et repartir en conversion serait tourner en rond. [reprisesReseau] compte les
 * reprises déjà accordées, pour qu'une coupure durable finisse par se dire au lieu de boucler.
 * [tunnelActif] dit que les images passent en mode tunnel — auquel cas il faut l'écarter avant
 * d'accuser le codec.
 */
fun reactionPour(errorCode: Int, dejaConverti: Boolean, reprisesReseau: Int, tunnelActif: Boolean = false): ReactionErreur = when {
    // Le réseau d'abord, et sans jamais mettre en cause le décodeur : sur un NAS domestique, la
    // coupure de quelques secondes est la panne la plus courante de toutes, et la seule qui se
    // répare toute seule.
    errorCode in ERREURS_RESEAU until ERREURS_ANALYSE ->
        if (reprisesReseau < REPRISES_RESEAU) ReactionErreur.REPRENDRE else ReactionErreur.ABANDONNER

    // Au-delà, une conversion déjà en cours signifie que le remède a échoué : insister n'apporte rien.
    dejaConverti -> ReactionErreur.ABANDONNER

    // Le décodeur a refusé le flux. Si le mode tunnel est actif, il est plus probablement en cause que
    // le codec : le couper coûte un peu de synchronisation, tandis qu'accuser le codec priverait
    // l'appareil de lecture directe sur tous les films qui l'emploient.
    errorCode in ERREURS_DECODAGE until ERREURS_AUDIO ->
        if (tunnelActif) ReactionErreur.COUPER_TUNNEL else ReactionErreur.SIGNALER_ET_CONVERTIR

    // Conteneur illisible, sortie audio qui refuse le format, verrou numérique : la conversion peut
    // aider, mais accuser le codec vidéo serait une erreur de diagnostic.
    else -> ReactionErreur.CONVERTIR
}
