/**
 * La coque de bureau, vue depuis le client Web.
 *
 * Le client Web est le même partout : un onglet de navigateur, la fenêtre du client de bureau, et
 * demain la télévision par le navigateur. Ce qui change n'est pas le code mais **ce que
 * l'environnement offre**. La coque de bureau offre VLC ; un onglet n'offre rien.
 *
 * D'où la règle, qui vaut pour tout ce qui suivra : **la capacité s'annonce, elle ne se devine pas**.
 * Pas de reniflage d'agent utilisateur — un jour ou l'autre quelqu'un change la chaîne et tout se
 * dérègle —, pas de variable de compilation — il faudrait alors deux versions du client Web à
 * construire et à servir. La page regarde si le pont est là, et agit en conséquence.
 */

/** Ce que la coque sait de la lecture, poussé à chaque quart de seconde. */
export interface EtatLecteurBureau {
  ouvert: boolean;
  /** Position **dans le flux**, en secondes : le décalage de session est ajouté par le lecteur. */
  position: number;
  duree: number;
  enLecture: boolean;
  vitesse: number;
  imagesAffichees: number;
  imagesPerdues: number;
  /** Les numéros des pistes du flux — les mêmes que les index du serveur. */
  pistes: number[];
  termine: boolean;
  erreur: string | null;
}

/** Les pistes voulues, désignées par l'index qu'en donne le serveur. */
export interface PistesVoulues {
  audio?: number | null;
  sousTitre?: number | null;
}

/** Commander VLC. Le vocabulaire est celui d'une balise vidéo, et c'est délibéré. */
export interface PontLecteur {
  /** Les pistes sont désignées à l'ouverture : les changer ensuite se fait pendant que VLC monte
   *  encore son flux, et le film démarre sans son. */
  ouvrir(uri: string, pistes?: PistesVoulues): Promise<{ ok: boolean; message?: string }>;
  lire(): Promise<void>;
  pause(): Promise<void>;
  allerA(secondes: number): Promise<void>;
  vitesse(valeur: number): Promise<void>;
  volume(valeur: number): Promise<void>;
  /** Choisit une piste par son numéro, ou la coupe avec `-1`. */
  pisteAudio(numero: number): Promise<void>;
  pisteSousTitre(numero: number): Promise<void>;
  fermer(): Promise<void>;
  etat(): Promise<EtatLecteurBureau>;
  surEtat(rappel: (etat: EtatLecteurBureau) => void): () => void;
}

export interface PontBureau {
  readonly version: string;
  serveur(): Promise<string | null>;
  definirServeur(adresse: string): Promise<{ ok: boolean; adresse?: string; message?: string }>;
  oublierServeur(): Promise<{ ok: boolean }>;
  /**
   * Le plein écran, qui n'est pas celui du navigateur.
   *
   * Une page ne sait agrandir que sa propre fenêtre, et l'interface de la coque vit dans une fenêtre
   * transparente posée sur la fenêtre vidéo : un plein écran demandé au document étalerait les
   * commandes sur tout l'écran devant une vidéo restée à sa place. C'est la coque qui agrandit, et
   * elle agrandit la bonne fenêtre.
   *
   * Sans argument, bascule. Rend l'état obtenu.
   */
  pleinEcran(actif?: boolean): Promise<boolean>;
  /** S'abonne au plein écran : il peut aussi venir du clavier, hors de la page. */
  surPleinEcran(rappel: (actif: boolean) => void): () => void;
  /** Absent quand VLC est introuvable : le client retombe alors sur le lecteur du navigateur. */
  readonly lecteur?: PontLecteur;
}

/** La coque, ou `null` si l'on tourne dans un navigateur ordinaire. */
export function pontBureau(): PontBureau | null {
  const pont = (globalThis as { flixtunesBureau?: PontBureau }).flixtunesBureau;
  return pont && typeof pont.version === "string" ? pont : null;
}

/**
 * VLC est-il à notre disposition ?
 *
 * Deux conditions, et non une : il faut la coque **et** VLC installé. Une coque sans VLC n'est pas
 * une anomalie — c'est le premier démarrage sur une machine où personne ne l'a encore posé —, et
 * elle doit se comporter exactement comme un navigateur plutôt que d'offrir un lecteur qui ne lira
 * rien.
 */
export function lectureParVlc(): PontLecteur | null {
  return pontBureau()?.lecteur ?? null;
}
