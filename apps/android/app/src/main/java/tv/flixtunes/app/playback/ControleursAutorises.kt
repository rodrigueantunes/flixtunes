package tv.flixtunes.app.playback

/**
 * Qui a le droit de piloter la session de lecture.
 *
 * Un `MediaSessionService` **doit** être exporté : c'est ainsi que le système le découvre pour
 * afficher la notification de lecture, relayer les touches d'un casque Bluetooth ou brancher Android
 * Auto. Mais exporté sans garde, il est aussi joignable par n'importe quelle application installée,
 * qui peut alors lire, mettre en pause, parcourir la file et lire les titres regardés.
 *
 * Une permission dans le manifeste ne convient pas : elle fermerait la porte aux composants système
 * qui doivent entrer. Le contrôle se fait donc là où Media3 le prévoit — à la connexion, en acceptant
 * ou en refusant chaque contrôleur.
 *
 * La règle est volontairement courte : notre propre application, notre propre processus, et les
 * composants que la session elle-même reconnaît comme siens. Tout le reste est refusé.
 */
object ControleursAutorises {
    /**
     * @param paquetControleur nom de paquet du contrôleur qui se connecte.
     * @param paquetApplication le nôtre.
     * @param memeUid le contrôleur tourne-t-il sous notre identifiant d'utilisateur ?
     * @param composantDeLaSession la session le reconnaît-elle comme sa notification, son compagnon
     *   Android Auto ou son hôte Automotive ?
     */
    fun autorise(
        paquetControleur: String,
        paquetApplication: String,
        memeUid: Boolean,
        composantDeLaSession: Boolean,
    ): Boolean = memeUid || composantDeLaSession || paquetControleur == paquetApplication
}
