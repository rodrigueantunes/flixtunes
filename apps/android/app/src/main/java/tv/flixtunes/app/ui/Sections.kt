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
    Section("web", "Web", "🌐"),
    Section("live", "Live TV", "📡"),
    Section("history", "Historique", "↻"),
    Section("search", "Recherche", "⌕"),
)

/**
 * Ce que ce serveur offre, nommé plutôt que positionné.
 *
 * Deux booléens côte à côte dans une signature s'inversent tôt ou tard, et l'inversion ne se voit
 * qu'à l'écran — une entrée « Web » qui apparaît parce qu'une source de direct est réglée. Les nommer
 * coûte une ligne et supprime la question.
 */
data class OffreDuServeur(
    /** Une source de direct est réglée **et** a rendu des chaînes. */
    val direct: Boolean = false,
    /** Au moins un dossier web est déclaré. */
    val web: Boolean = false,
)

/**
 * Les sections que la barre de navigation du téléviseur présente.
 *
 * La recherche en est absente à dessein : saisir du texte à la télécommande est pénible, et elle est
 * atteignable par son propre bouton dans la barre du haut. L'y remettre allongerait le parcours au
 * focus vers les sections dont on se sert vraiment. Le Web fait le même partage — quatre entrées de
 * menu, la loupe à part.
 */
fun sectionsTelevision(offre: OffreDuServeur): List<Section> =
    sectionsVisibles(offre).filterNot { it.cle == "search" }

/**
 * Les sections à présenter, selon ce que le serveur offre.
 *
 * « Live TV » n'apparaît **que si une source est réglée et a rendu des chaînes**, et « Web » **que si
 * un dossier web est déclaré** — c'est ce qui a été demandé, et c'est aussi la règle des fonctions qui
 * coûtent : éteinte, la fonction n'existe nulle part. Un serveur plus ancien, qui ignore ces routes,
 * se comporte comme une installation éteinte : l'entrée reste absente et rien ne casse.
 *
 * Les deux règles diffèrent sur un point, et c'est voulu : le direct attend d'avoir des chaînes, le
 * rayon Web se contente d'un dossier déclaré. Il peut donc être vide le temps de la première analyse,
 * ce qui se voit et s'explique — là où une entrée qui apparaît sans prévenir ne s'expliquerait pas.
 *
 * Le filtrage se fait ici et non dans chaque barre : c'est la même liste pour les deux surfaces, et
 * c'est précisément ce que ce fichier existe pour garantir.
 */
fun sectionsVisibles(offre: OffreDuServeur): List<Section> = SECTIONS.filterNot {
    (it.cle == "live" && !offre.direct) || (it.cle == "web" && !offre.web)
}
