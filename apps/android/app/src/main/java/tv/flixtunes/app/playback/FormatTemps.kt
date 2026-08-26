package tv.flixtunes.app.playback

/**
 * L'horloge du lecteur, écrite comme sur le Web.
 *
 * Les deux lecteurs affichent la même position au même instant : un écart de format suffit à faire
 * douter qu'ils lisent la même chose. La règle du Web est reprise telle quelle — l'heure n'apparaît
 * que si le film la dépasse, ce qui évite un « 0:04:12 » inutile sur un épisode de vingt minutes.
 */
fun formatTempsLecture(secondes: Double): String {
    // Une durée inconnue vaut « 0:00 » plutôt que rien : une horloge vide se lit comme une panne.
    if (secondes.isNaN() || secondes.isInfinite() || secondes < 0) return "0:00"
    val total = secondes.toLong()
    val heures = total / 3600
    val minutes = (total % 3600) / 60
    val reste = total % 60
    return if (heures > 0) "%d:%02d:%02d".format(heures, minutes, reste) else "%d:%02d".format(minutes, reste)
}

/**
 * La part d'une durée occupée par un instant, entre 0 et 1.
 *
 * Sert les trois épaisseurs de la barre — encodé, chargé, lu — qui se superposent. Une durée nulle
 * rend 0 : au démarrage, la barre est vide plutôt que pleine.
 */
fun partDe(instantSecondes: Double, dureeSecondes: Double): Float {
    if (dureeSecondes <= 0 || instantSecondes <= 0) return 0f
    return (instantSecondes / dureeSecondes).coerceIn(0.0, 1.0).toFloat()
}

/**
 * Le complément « · encodé 1:12:30 », ou rien.
 *
 * Il n'a de sens qu'en conversion, et seulement tant que le serveur n'a pas rattrapé la fin du film.
 * La seconde de tolérance évite de l'afficher au dernier instant, quand les deux valeurs se rejoignent
 * à un arrondi près.
 */
fun mentionEncodee(finEncodeeSecondes: Double, dureeSecondes: Double): String? {
    if (finEncodeeSecondes <= 0 || dureeSecondes - finEncodeeSecondes <= 1) return null
    return " · encodé " + formatTempsLecture(finEncodeeSecondes)
}
