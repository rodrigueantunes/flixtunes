package tv.flixtunes.app.playback

/**
 * Où reprendre le film à l'ouverture du lecteur.
 *
 * Deux situations très différentes aboutissent au même code. Dans la première, on ouvre un film :
 * l'application sait où on l'avait laissé, et peut légitimement demander si l'on veut reprendre.
 *
 * Dans la seconde, le système a tué l'application pendant la lecture — pour récupérer de la mémoire,
 * parce qu'on a lancé un jeu, parce que le téléviseur s'est mis en veille — puis la recrée. Android
 * lui rend alors l'intention d'origine, celle qui disait « ce film était vu à 10 % ». Si on la croit,
 * on renvoie au début d'un film regardé aux trois quarts. Et reposer la question de la reprise
 * revient à demander deux fois la même chose, alors que rien n'a été décidé entre-temps.
 *
 * D'où cette règle : ce que l'activité a sauvegardé prime toujours sur ce que l'intention raconte.
 */

/** La position exacte prime ; le pourcentage reste disponible pour l'interface et les anciens serveurs. */
data class RepriseDecision(
    val pourcentage: Int,
    val demander: Boolean,
    val positionSecondes: Double? = null,
)

/**
 * Décide de la reprise.
 *
 * [sauvegarde] est le pourcentage retenu par l'activité juste avant d'être détruite, ou `null` s'il
 * s'agit d'une ouverture ordinaire. [intentPourcentage] vient de la fiche du film. [mode] est le
 * réglage de la personne : « continue », « ask » ou « restart ».
 *
 * Au-delà de 90 %, une ouverture ordinaire repart du début : le film est tenu pour vu, et reprendre
 * dans le générique de fin n'a pas de sens. La règle ne vaut pas pour une reprise après destruction —
 * un film abandonné à 95 % par la mort du processus n'a pas été regardé jusqu'au bout.
 */
fun decisionReprise(
    sauvegarde: Int?,
    intentPourcentage: Int,
    mode: String,
    sauvegardeSecondes: Double? = null,
    intentSecondes: Double? = null,
    intentDureeSecondes: Double? = null,
): RepriseDecision {
    val secondesSauvees = sauvegardeSecondes?.takeIf { it.isFinite() && it >= 0.0 }
    if (sauvegarde != null || secondesSauvees != null) return RepriseDecision(
        (sauvegarde ?: 0).coerceIn(0, 99), demander = false, positionSecondes = secondesSauvees,
    )
    if (mode == "restart") return RepriseDecision(0, demander = false)
    val secondesFiche = intentSecondes?.takeIf { secondes ->
        secondes.isFinite() && secondes > 0.0 && when {
            intentDureeSecondes != null && intentDureeSecondes.isFinite() && intentDureeSecondes > 0.0 ->
                secondes / intentDureeSecondes < 0.9
            else -> intentPourcentage in 1..89
        }
    }
    val depuisFiche = if (secondesFiche != null || intentPourcentage in 1..89) intentPourcentage.coerceIn(0, 89) else 0
    return RepriseDecision(depuisFiche, demander = mode == "ask" && (secondesFiche != null || depuisFiche > 0),
        positionSecondes = secondesFiche)
}

/** Point absolu de reprise, avant application éventuelle de la question « reprendre ? ». */
fun cibleReprise(reprise: RepriseDecision, dureeSecondes: Double, reculSecondes: Int): Double {
    val exacte = reprise.positionSecondes?.takeIf { it.isFinite() && it > 0.0 }
    val brute = exacte ?: if (reprise.pourcentage > 0 && dureeSecondes > 0.0)
        dureeSecondes * reprise.pourcentage / 100 else 0.0
    return (brute - reculSecondes.coerceAtLeast(0)).coerceAtLeast(0.0)
}

/**
 * Le point du film où demander au serveur de commencer à encoder.
 *
 * La reprise se faisait en deux temps : on ouvrait la session au début, puis le lecteur sautait au
 * pourcentage retenu. Pour une lecture directe cela ne coûte rien — le fichier est servi entier. Pour
 * une **conversion**, c'est autre chose : le serveur encode une fenêtre qui part de zéro, et le saut
 * tombe hors de cette fenêtre. Il faut alors relancer une seconde session au bon endroit, ce qui
 * double le travail du NAS et fait attendre deux fois.
 *
 * Le point est donc décidé avant de demander la session. Une demande explicite — un saut hors fenêtre
 * — l'emporte sur tout : elle sait déjà où elle va.
 *
 * Le cas « demander » reste à zéro, et c'est volontaire : tant que la question n'a pas été posée, on
 * ne sait pas si la personne veut reprendre ou repartir du début, et deviner ferait encoder le mauvais
 * bout du film une fois sur deux.
 */
fun departDemande(startSeconds: Double, reprise: RepriseDecision, dureeSecondes: Double, reculSecondes: Int): Double {
    if (startSeconds > 0) return startSeconds
    if (reprise.demander || (reprise.positionSecondes == null && (reprise.pourcentage <= 0 || dureeSecondes <= 0))) return 0.0
    return cibleReprise(reprise, dureeSecondes, reculSecondes)
}
