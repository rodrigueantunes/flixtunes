package tv.flixtunes.app.data

/**
 * Ce que l'application retient d'une session à l'autre.
 *
 * Trois valeurs, et c'est tout : le serveur choisi, le profil actif, et le jeton d'accès distant.
 * Le contrat est volontairement minuscule — il n'expose ni fichier, ni clé, ni format — parce que
 * chaque système les range à sa façon : préférences partagées sur Android, fichier de configuration
 * sur un bureau, base de registre ailleurs.
 *
 * C'est cette petitesse qui permet au reste du code de ne jamais savoir où il vit.
 */
interface Reglages {
    var serverUrl: String?
    var profileId: String?
    var remoteToken: String?
}

/**
 * Un stockage en mémoire, pour les cas de test et pour un démarrage sans persistance.
 *
 * Il évite d'avoir à simuler la plateforme pour vérifier une logique qui n'en dépend pas.
 */
class ReglagesEnMemoire(
    override var serverUrl: String? = null,
    override var profileId: String? = null,
    override var remoteToken: String? = null,
) : Reglages
