package tv.flixtunes.app.ui

/**
 * Les sections de l'accueil, communes aux deux surfaces — et alignées sur celles du Web.
 *
 * Elles étaient écrites deux fois — une liste dans la barre du haut pour le téléviseur, une autre dans
 * la barre du bas pour le tactile — et les deux avaient déjà divergé : « Rechercher » figurait dans la
 * barre tactile mais pas dans celle du téléviseur, où elle vivait à part. Une section ajoutée d'un
 * côté ne l'était pas de l'autre, sans que rien ne le signale.
 *
 * Le même défaut existait d'un client à l'autre : le Web propose **Historique**, qui n'existait nulle
 * part sur Android. Un profil pouvait donc consulter son activité depuis un navigateur et pas depuis
 * son téléphone, alors que la donnée arrive dans la même réponse `/api/home`.
 *
 * Ce qui diffère entre les surfaces, c'est la **façon de présenter** ces sections, pas leur liste.
 */
data class Section(
    /** Identifiant employé par l'état de l'écran. */
    val cle: String,
    val libelle: String,
    /** Pictogramme de la barre tactile. Le téléviseur n'affiche que le libellé, lisible de loin. */
    val pictogramme: String,
)

/** Les sections dans leur ordre d'affichage, recherche comprise. Même ordre que le menu du Web. */
val SECTIONS = listOf(
    Section("home", "Accueil", "⌂"),
    Section("movies", "Films", "🎬"),
    Section("shows", "Séries TV", "📺"),
    Section("live", "Live TV", "📡"),
    Section("history", "Historique", "↻"),
    Section("search", "Recherche", "⌕"),
)

/**
 * Les sections que la barre de navigation du téléviseur présente.
 *
 * La recherche en est absente à dessein : saisir du texte à la télécommande est pénible, et elle est
 * atteignable par son propre bouton dans la barre du haut. L'y remettre allongerait le parcours au
 * focus vers les sections dont on se sert vraiment. Le Web fait le même partage — quatre entrées de
 * menu, la loupe à part.
 */
fun sectionsTelevision(directDisponible: Boolean): List<Section> =
    sectionsVisibles(directDisponible).filterNot { it.cle == "search" }

/**
 * Les sections à présenter, selon ce que le serveur offre.
 *
 * « Live TV » n'apparaît **que si une source est réglée et a rendu des chaînes** — c'est ce qui a été
 * demandé, et c'est aussi la règle des fonctions qui coûtent : éteinte, la fonction n'existe nulle
 * part. Un serveur plus ancien, qui ignore la route, se comporte comme une installation éteinte :
 * l'entrée reste absente et rien ne casse.
 *
 * Le filtrage se fait ici et non dans chaque barre : c'est la même liste pour les deux surfaces, et
 * c'est précisément ce que ce fichier existe pour garantir.
 */
fun sectionsVisibles(directDisponible: Boolean): List<Section> =
    if (directDisponible) SECTIONS else SECTIONS.filterNot { it.cle == "live" }
