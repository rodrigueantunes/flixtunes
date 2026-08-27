import { lectureParVlc, type EtatLecteurBureau, type PontLecteur } from "./bureau";

/**
 * La surface où la lecture a lieu — une balise vidéo, ou VLC.
 *
 * Le lecteur du client Web, `Player.tsx`, ne parle qu'à cette interface. Dans un navigateur, elle est
 * satisfaite **telle quelle** par `HTMLVideoElement` : aucun adaptateur, aucune indirection, pas une
 * ligne de comportement changée. Dans la coque de bureau, elle est satisfaite par `SurfaceVlc`, qui
 * traduit les mêmes mots vers le processus VLC.
 *
 * C'est le pivot du client de bureau, et le choix mérite d'être expliqué. On aurait pu écrire un
 * second lecteur pour le bureau : deux barres de progression, deux cartes d'enchaînement, deux
 * gestions de sous-titres, deux jeux de défauts. Ou faire porter à `Player.tsx` un « si bureau »
 * dans chacune de ses quarante interactions avec la vidéo. On a préféré nommer ce que le lecteur
 * demande vraiment à une surface de lecture — c'est court, treize membres — et fournir deux
 * réponses à cette question.
 *
 * Le vocabulaire est celui du DOM, en anglais, contrairement au reste du projet. C'est voulu : ces
 * noms *sont* ceux de `HTMLVideoElement`, et les traduire aurait obligé à écrire un adaptateur pour
 * le cas du navigateur — c'est-à-dire à mettre du code sur le chemin qui fonctionne déjà, pour le
 * seul confort d'un vocabulaire. Le prix d'un client de bureau ne doit pas être payé par le Web.
 */
export interface SurfaceLecture {
  /** Position dans le flux, en secondes. Le décalage de session est ajouté par le lecteur. */
  currentTime: number;
  /** Durée du flux — pas celle du film, quand la session ne commence pas au début. */
  readonly duration: number;
  readonly paused: boolean;
  playbackRate: number;
  /** Ce qui est déjà chargé. Vide quand la surface n'en sait rien : mieux vaut rien qu'un chiffre faux. */
  readonly buffered: TimeRanges;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, ecouteur: EventListener, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, ecouteur: EventListener): void;
  /** Absent sur les surfaces qui ne comptent pas leurs images : on ne conclut alors rien du décodage. */
  getVideoPlaybackQuality?(): VideoPlaybackQuality;
}

/**
 * Aucun tampon connu.
 *
 * VLC ne dit pas jusqu'où il a lu d'avance. Annoncer « tout est chargé » remplirait la barre de
 * progression d'un gris mensonger ; annoncer la position courante ferait croire à un tampon nul et
 * inquiéterait pour rien. On n'annonce donc rien, et la barre ne montre que ce qu'elle sait.
 */
const AUCUN_TAMPON: TimeRanges = {
  length: 0,
  start: () => { throw new DOMException("aucune plage", "IndexSizeError"); },
  end: () => { throw new DOMException("aucune plage", "IndexSizeError"); },
} as TimeRanges;

/**
 * La lecture confiée à VLC, présentée au lecteur Web comme une balise vidéo.
 *
 * Deux flux d'information la traversent, en sens inverse : les commandes descendent — lis, mets en
 * pause, va à telle seconde —, et l'état remonte quatre fois par seconde, poussé par la coque.
 * Chaque état reçu est comparé au précédent pour en tirer les événements que le lecteur attend :
 * `play` quand la lecture démarre, `loadedmetadata` quand la durée devient connue, `ended` quand le
 * flux s'achève.
 *
 * Cette traduction est le cœur du procédé, et elle tient en une méthode — `recevoir`.
 */
export class SurfaceVlc implements SurfaceLecture {
  private readonly cible = new EventTarget();
  private readonly pont: PontLecteur;
  private position = 0;
  private duree = 0;
  private enLecture = false;
  private vitesse = 1;
  private imagesAffichees = 0;
  private imagesPerdues = 0;
  /** Les événements qui ne se produisent qu'une fois par média ouvert. */
  private metadonneesDites = false;
  private premiereImageDite = false;
  private finDite = false;
  private erreurDite = false;

  constructor(pont: PontLecteur) {
    this.pont = pont;
    // L'abonnement dure autant que la surface, et la surface dure autant que la page. Le défaire au
    // démontage du lecteur avait l'air propre et ne l'était pas : voir `surfacePartagee`.
    pont.surEtat((etat) => this.recevoir(etat));
  }

  get currentTime(): number { return this.position; }

  set currentTime(secondes: number) {
    if (!Number.isFinite(secondes)) return;
    // La position est avancée sur-le-champ, avant que VLC ne confirme : sans cela le curseur de la
    // barre reviendrait à son ancienne place pendant le quart de seconde qui sépare deux états, et
    // ce retour en arrière se voit à chaque déplacement.
    this.position = Math.max(0, secondes);
    void this.pont.allerA(this.position);
  }

  get duration(): number { return this.duree; }
  get paused(): boolean { return !this.enLecture; }
  get buffered(): TimeRanges { return AUCUN_TAMPON; }

  get playbackRate(): number { return this.vitesse; }

  set playbackRate(valeur: number) {
    if (!Number.isFinite(valeur) || valeur <= 0) return;
    this.vitesse = valeur;
    void this.pont.vitesse(valeur);
  }

  async play(): Promise<void> { await this.pont.lire(); }

  pause(): void { void this.pont.pause(); }

  addEventListener(type: string, ecouteur: EventListener, options?: AddEventListenerOptions): void {
    this.cible.addEventListener(type, ecouteur, options);
  }

  removeEventListener(type: string, ecouteur: EventListener): void {
    this.cible.removeEventListener(type, ecouteur);
  }

  /**
   * Ce que VLC a affiché et ce qu'il a jeté, dit dans la langue du navigateur.
   *
   * Le lecteur s'en sert pour deux conclusions opposées — un décodage qui décroche fait basculer en
   * conversion, un décodage qui tient lève la quarantaine d'un codec. Les deux valent pour VLC comme
   * pour un navigateur : c'est le même genre de mesure et le même genre de décision.
   */
  getVideoPlaybackQuality(): VideoPlaybackQuality {
    return {
      creationTime: performance.now(),
      droppedVideoFrames: this.imagesPerdues,
      totalVideoFrames: this.imagesAffichees + this.imagesPerdues,
      corruptedVideoFrames: 0,
    } as VideoPlaybackQuality;
  }

  /**
   * Ouvre un flux. L'adresse est rendue absolue : VLC ne connaît pas l'origine de la page.
   *
   * Le volume est remis à plein à chaque ouverture. VLC retient le sien d'une séance à l'autre, et
   * une application qui démarre muette parce qu'on avait baissé le son la veille dans un tout autre
   * programme serait un défaut impossible à comprendre.
   */
  async ouvrir(source: string): Promise<{ ok: boolean; message?: string }> {
    this.position = 0;
    this.duree = 0;
    this.enLecture = false;
    this.imagesAffichees = 0;
    this.imagesPerdues = 0;
    this.metadonneesDites = false;
    this.premiereImageDite = false;
    this.finDite = false;
    this.erreurDite = false;
    const absolue = new URL(source, window.location.href).toString();
    const reponse = await this.pont.ouvrir(absolue);
    if (!reponse.ok) this.emettre("error");
    else void this.pont.volume(1);
    return reponse;
  }

  /** On quitte le lecteur : VLC s'arrête, la fenêtre du dessous redevient noire. */
  fermer(): void {
    this.position = 0;
    this.duree = 0;
    this.enLecture = false;
    void this.pont.fermer();
  }

  private recevoir(etat: EtatLecteurBureau): void {
    if (!etat.ouvert) return;
    const jouaitAvant = this.enLecture;
    const vitesseAvant = this.vitesse;
    this.position = etat.position;
    this.duree = etat.duree;
    this.enLecture = etat.enLecture;
    this.vitesse = etat.vitesse;
    this.imagesAffichees = etat.imagesAffichees;
    this.imagesPerdues = etat.imagesPerdues;

    // La durée connue vaut « métadonnées lues » : c'est à cet instant que le lecteur place la reprise,
    // pose la question « reprendre ou recommencer », et applique la vitesse du profil.
    if (!this.metadonneesDites && etat.duree > 0) {
      this.metadonneesDites = true;
      this.emettre("loadedmetadata");
    }
    if (!this.premiereImageDite && etat.imagesAffichees > 0) {
      this.premiereImageDite = true;
      this.emettre("playing");
    }
    if (etat.enLecture !== jouaitAvant) this.emettre(etat.enLecture ? "play" : "pause");
    if (etat.vitesse !== vitesseAvant) this.emettre("ratechange");
    this.emettre("timeupdate");
    if (etat.termine && !this.finDite) {
      this.finDite = true;
      this.emettre("ended");
    }
    if (etat.erreur && !this.erreurDite) {
      this.erreurDite = true;
      this.emettre("error");
    }
  }

  private emettre(nom: string): void {
    this.cible.dispatchEvent(new Event(nom));
  }
}

/**
 * Une seule surface pour toute la séance, et il a fallu un défaut visible pour l'admettre.
 *
 * La version précédente créait une surface par ouverture du lecteur et défaisait son abonnement au
 * démontage. C'est le réflexe habituel de React, et il était faux ici. En mode strict — celui du
 * développement — React monte le composant, le démonte aussitôt, puis le remonte, précisément pour
 * débusquer les nettoyages mal appariés. Le nôtre l'était : le démontage simulé coupait
 * l'abonnement, la surface remontée ne recevait plus rien, et **le film jouait derrière une
 * interface figée à 0:00**. Constaté à l'écran, VLC annonçant sa quarante-troisième seconde pendant
 * que la barre restait à zéro.
 *
 * La bonne réponse n'est pas de rendre le nettoyage plus malin : il n'y a **qu'un seul VLC** et
 * **qu'un seul lecteur à la fois**. Une surface partagée, abonnée une fois pour toutes, dit
 * exactement cela. Ouvrir un flux remet à zéro tout ce qui appartenait au précédent, et fermer ne
 * fait qu'arrêter la lecture.
 *
 * Rend `null` dans un navigateur ordinaire, et c'est ce qui fait qu'il n'y a rien à changer là-bas.
 */
let partagee: SurfaceVlc | null = null;

export function surfacePartagee(): SurfaceVlc | null {
  if (partagee) return partagee;
  const pont = lectureParVlc();
  if (!pont) return null;
  partagee = new SurfaceVlc(pont);
  return partagee;
}

/** Pour les épreuves : rend la surface partagée à son état d'avant la première ouverture. */
export function oublierLaSurfacePartagee(): void {
  partagee = null;
}
