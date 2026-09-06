package tv.flixtunes.app.ui.lecteur

import tv.flixtunes.app.playback.LigneInfo

/**
 * Ce que la barre de commandes affiche, à un instant donné.
 *
 * Rassembler l'état ici plutôt que de le lire depuis le lecteur au moment du dessin a une raison
 * précise : la barre doit montrer le temps du **film**, et le lecteur ne connaît que celui du flux
 * encodé. C'est l'activité qui détient la traduction ; la barre reçoit des nombres déjà justes et
 * n'a plus à savoir qu'une conversion est en cours.
 *
 * Toutes les durées sont en secondes de film.
 */
/**
 * Secondes avant l'enchaînement automatique.
 *
 * Elle vivait dans l'activité, seule à en avoir besoin. La jauge de la carte doit maintenant la
 * connaître pour se vider au bon rythme : deux valeurs séparées se seraient désaccordées au premier
 * réglage.
 */
const val DELAI_AUTOPLAY_SECONDES = 10

data class EtatLecteur(
    val titre: String,
    /** Préparation ou renégociation en cours : l'écran noir ne doit jamais être ambigu. */
    val chargement: Boolean = false,
    /** Erreur persistante, accompagnée d'actions de reprise plutôt que d'un Toast fugitif. */
    val erreur: String? = null,
    /** Compte à rebours avant l'épisode suivant ; null hors enchaînement automatique. */
    val autoplayRestantSecondes: Int? = null,
    val autoplayTitre: String? = null,
    /** « S1 E2 » de l'épisode qui suit, comme sur le Web ; `null` hors série. */
    val autoplaySousTitre: String? = null,
    /**
     * Durée que couvre la jauge de la carte, en secondes.
     *
     * Elle vaut le générique de fin quand le fichier le nomme — la carte s'ouvre alors dès le
     * générique et la jauge se vide jusqu'à la fin — et [DELAI_AUTOPLAY_SECONDES] sinon.
     */
    val autoplayTotalSecondes: Int = DELAI_AUTOPLAY_SECONDES,
    /** Vrai pendant l'introduction d'un épisode, quand le fichier la nomme : de quoi la passer. */
    val passerGeneriqueVisible: Boolean = false,
    /** « S2 E3 · Le Titre » pour un épisode, `null` pour un film. */
    val sousTitre: String? = null,
    /** Retour visuel fugitif d'un saut rapide : −10, +20… */
    val sautSecondes: Int? = null,
    /** `direct`, `remux` ou `transcode` — le badge que le Web affiche en haut à droite. */
    val mode: String? = null,
    val enLecture: Boolean = false,
    val positionSecondes: Double = 0.0,
    val dureeSecondes: Double = 0.0,
    val tamponSecondes: Double = 0.0,
    /** Fin de la portion déjà produite par le serveur ; 0 en lecture directe. */
    val finEncodeeSecondes: Double = 0.0,
    /** Positions des chapitres, pour les repères posés sur la barre. */
    val chapitres: List<Double> = emptyList(),
    val vitesse: Float = 1f,
    val minuteurMinutes: Int = 0,
    /** Vrai quand le fichier dépasse le SDR : le réglage « Image » n'apparaît qu'alors. */
    val plageDisponible: Boolean = false,
    val infosOuvertes: Boolean = false,
    val lignesInfos: List<LigneInfo> = emptyList(),
    val episodePrecedent: Boolean = false,
    val episodeSuivant: Boolean = false,
    /**
     * Ce qui suit est-il une vidéo de plateforme plutôt qu'un épisode ?
     *
     * Change les mots, rien d'autre : « Vidéo suivante » au lieu d'« Épisode suivant ». Dans une
     * chaîne, ce qui suit une vidéo est une vidéo — parler d'épisode y désigne quelque chose qui
     * n'existe pas.
     */
    val suivantEstUneVideo: Boolean = false,
    /** Saute à la fin de l'introduction. Proposé sur les séries seulement. */
    val passerGenerique: () -> Unit = {},
    /** `PiP` n'existe pas partout : le bouton disparaît là où le système ne le propose pas. */
    val imageDansImage: Boolean = false,
    /** Le panneau des pistes est-il déplié ? */
    val pistesOuvertes: Boolean = false,
    val pistesAudio: List<PisteChoix> = emptyList(),
    val pistesSousTitres: List<PisteChoix> = emptyList(),
    /** Vrai quand aucun sous-titre n'est affiché — c'est un choix, pas une absence. */
    val sousTitresDesactives: Boolean = true,
    /** Apparence appliquée à la volée par Media3, commune au mobile, à la tablette et à la TV. */
    val tailleSousTitres: String = "normal",
    val fondSousTitres: Boolean = false,
    val couleurSousTitres: String = "white",
)

/**
 * Une piste proposée au choix, et son état.
 *
 * `active` vient du lecteur lui-même à chaque rafraîchissement, jamais d'un souvenir local : c'est ce
 * qui permet au panneau de rester juste quand le lecteur change de piste tout seul — au démarrage,
 * quand il applique la préférence du profil, ou après une renégociation de session.
 */
data class PisteChoix(
    /** « rangDuGroupe:rangDeLaPiste ». Sert à retrouver la piste au moment de l'appliquer. */
    val cle: String,
    /** « Français », « English » — ce qu'on lit en premier. */
    val libelle: String,
    /** « EAC3 · 5.1 », « Texte · forcé » — le détail, en petit, sous le libellé. */
    val detail: String,
    val active: Boolean,
)

/**
 * Ce que la barre sait déclencher.
 *
 * La qualité, la vitesse, la plage dynamique et le minuteur restent des boîtes de dialogue du
 * système : elles se pilotent à la croix directionnelle sans qu'on ait à réimplémenter la navigation
 * au clavier, et on les ouvre une fois pour toutes.
 *
 * Les pistes, non. On y revient plusieurs fois pendant un film — comparer deux doublages, remettre
 * les sous-titres sur une réplique inaudible — et une liste modale qui se ferme à chaque choix oblige
 * à la rouvrir pour voir ce qu'on vient de faire. Le panneau du client Web reste ouvert, montre par
 * un bouton radio ce qui est actif, et applique le changement à la volée. C'est ce que reproduit
 * `PanneauPistes`.
 */
class ActionsLecteur(
    val basculerLecture: () -> Unit = {},
    /** Position visée, en secondes de film. */
    val naviguer: (Double) -> Unit = {},
    /** Saut rapide par pas de dix secondes ; le signe donne le côté. */
    val sauter: (Int) -> Unit = {},
    val fermer: () -> Unit = {},
    val episodePrecedent: () -> Unit = {},
    val episodeSuivant: () -> Unit = {},
    /** Saute à la fin de l'introduction. Proposé sur les séries seulement. */
    val passerGenerique: () -> Unit = {},
    val ouvrirInfos: () -> Unit = {},
    /** Déplie ou replie le panneau des pistes. */
    val ouvrirPistes: () -> Unit = {},
    /** Applique une piste audio, sans interrompre la lecture. */
    val choisirAudio: (String) -> Unit = {},
    /** Applique un sous-titre, ou les coupe tous lorsque la clé est nulle. */
    val choisirSousTitre: (String?) -> Unit = {},
    val choisirTailleSousTitres: (String) -> Unit = {},
    val choisirFondSousTitres: (Boolean) -> Unit = {},
    val choisirCouleurSousTitres: (String) -> Unit = {},
    val ouvrirQualite: () -> Unit = {},
    val ouvrirPlage: () -> Unit = {},
    val ouvrirVitesse: () -> Unit = {},
    val ouvrirMinuteur: () -> Unit = {},
    val imageDansImage: () -> Unit = {},
    val reessayer: () -> Unit = {},
    val modeCompatible: () -> Unit = {},
    val lireSuivantMaintenant: () -> Unit = {},
    val annulerEpisodeSuivant: () -> Unit = {},
    /** Toute interaction réveille la barre : c'est l'activité qui tient le compte à rebours. */
    val reveiller: () -> Unit = {},
    /** Simple toucher sur l'image : montre ou retire la garniture. */
    val basculerCommandes: () -> Unit = {},
)
