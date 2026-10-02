import { BoutonDiffusion, useSurfaceDiffusion } from "./Diffusion";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { pontBureau } from "./bureau";
import type { PropsDirect } from "./LecteurDirectBureau";
const DirectBureau = lazy(() => import("./LecteurDirectBureau").then((m) => ({ default: m.LecteurDirectBureau })));
import { identifiantLectureDirect } from "./pilotage-direct";
import { budgetCacheDirect, formatAdresse, imagesPresentees, JournalDirect, prefereRelais, reserveDeDepart, retenirRelais, vitesseContinue } from "./pilotage-direct";
import type Hls from "hls.js";
import type { ErrorData, LevelDetails } from "hls.js";
import type { ChaineDirect } from "@flixtunes/contracts";
import { api } from "./api";
import { CacheSegmentsDirect, chargeurAvecCache } from "./cache-segments-direct";
import { QualiteContinue, doitPreparerSecours, raccordAutorise, lienDirectARenouveler } from "./continuite-direct";
import { courirLesAdresses } from "./course-adresses";
import { COURSE_MAX, debutDeVague, premiereAdresse, prochaineAdresse, regrouperLesSources } from "./sources-direct";
import { AVANCE_FRAGILE_S, avanceVisee as calculerAvance } from "./avance-direct";
import { ecartEntre, repereDansLaPlaylist, tempsPourRepere, type SegmentRepere } from "./releve-direct";

/**
 * Le lecteur d'une chaîne en direct.
 *
 * Il est séparé de `Player.tsx`, et ce n'est pas un doublon : les deux ne partagent presque rien.
 * Le lecteur de la médiathèque négocie une session avec le serveur, choisit un mode de conversion,
 * gère les pistes, la reprise, les sous-titres et l'enchaînement d'épisodes. Une chaîne, elle, est
 * **une adresse HLS qu'on ouvre** : pas de session, pas de position, pas de fin. Faire entrer ce cas
 * dans l'autre aurait ajouté des conditions à chaque étape d'un fichier de mille lignes, pour un
 * comportement qui n'a rien à voir.
 *
 * Ce qu'il apporte en propre, et qui est tout l'intérêt du modèle de l'étape 1 : **le repli**. Une
 * chaîne porte en moyenne une adresse et demie, et 57 % des entrées du corpus sont des doublons.
 * Quand la première refuse, on prend la suivante — sans message d'erreur, parce que la personne
 * devant l'écran n'a rien demandé d'autre que de regarder la chaîne.
 */

/** Une adresse, son doublon relayé et ce que le serveur sait d'elle. */
interface SourceLisible {
  url: string; relais: string | null; hauteur: number | null; debit: number | null;
  identifiant?: string;
  cheminPrefere?: "relais";
  /** Les échecs que le serveur connaît pour cette adresse : une source qui en traîne est fragile d'emblée. */
  echecs: number;
  /** Ce qui distingue deux adresses pour l'œil : l'hôte et le chemin, sans la requête. */
  empreinte: string;
}

/**
 * Ce qu'on dit d'une source dans le menu.
 *
 * La définition d'abord, parce que c'est ce qu'on voit ; le débit ensuite, parce qu'il explique
 * pourquoi la même définition ne se vaut pas partout. Une source jamais sondée dit son hébergeur
 * plutôt que d'inventer une qualité : le serveur la mesurera à la prochaine ouverture.
 */
function decrireSource(source: SourceLisible): string {
  const morceaux: string[] = [];
  if (source.hauteur != null) morceaux.push(`${source.hauteur}p`);
  if (source.debit != null) morceaux.push(`${(source.debit / 1_000_000).toFixed(1)} Mb/s`);
  if (!morceaux.length) {
    try { return new URL(source.url).hostname; } catch { return "source"; }
  }
  return morceaux.join(" · ");
}

/**
 * Ce qu'un direct laisse derrière lui, mesuré sur le corpus.
 *
 * Soixante chaînes françaises sondées, treize manifestes lisibles : **fenêtre médiane de 61 s**,
 * 92 % entre 30 s et 2 min, et une exception à quatre heures — Arte et ses 1 875 segments. Les
 * segments durent 8 s de médiane. Ces deux chiffres commandent tout ce qui suit : de combien on peut
 * reculer, et ce qu'une barre de progression a le droit de promettre.
 */
const SEGMENT_TYPE_S = 8;

/** Le saut d'une flèche. Dix secondes, comme partout ailleurs : ce n'est pas le moment d'innover. */
const SAUT_S = 10;

/** La barre s'efface d'elle-même : on regarde la télévision, pas une interface. */
const REPOS_BARRE_MS = 3_500;

/** Trois blocages dans cette fenêtre, et le lecteur recule. */
const MEMOIRE_BLOCAGES_MS = 120_000;
const BLOCAGES_AVANT_RECUL = 3;

/**
 * Ce qui empêche d'abandonner trop vite une chaîne qui fonctionne.
 *
 * Un mauvais passage de vingt secondes produit six rechargements d'affilée : les compter séparément
 * faisait franchir les deux seuils en une fois. Deux blocages rapprochés sont donc le même incident ;
 * le recul a trente secondes pour faire ses preuves avant d'être jugé ; et l'on ne change jamais de
 * source dans la première minute. Il faut désormais **six incidents étalés sur au moins une minute et
 * vingt secondes** — un problème installé, plus une mauvaise passe.
 */
const INTERVALLE_MIN_BLOCAGE_MS = 10_000;
const REPIT_APRES_RECUL_MS = 30_000;
const TEMPS_MIN_SUR_SOURCE_MS = 60_000;

/**
 * Au-delà, l'image n'est plus une image : on n'attend pas d'avoir compté.
 *
 * Bégayer et s'être arrêté ne sont pas la même chose. Une image qui hoquette se regarde encore, et
 * abandonner la chaîne pour cela serait perdre ce qui marche ; une image figée depuis huit secondes
 * n'est plus une image, et attendre le troisième incident espacé reviendrait à rester une minute
 * devant un écran noir. Huit secondes couvrent le rechargement d'un segment, qui dure 8 s de médiane
 * sur le corpus.
 */
const IMAGE_FIGEE_MS = 8_000;

/** Au-delà de deux segments, une fenêtre mérite une barre. En deçà, elle ne promettrait rien. */
const FENETRE_MINIMALE_S = 2 * SEGMENT_TYPE_S;

/**
 * Le direct, c'est l'avance visée à quelques secondes près : au-delà, on est en différé et on le dit.
 *
 * Le seuil se comptait depuis le bord, à douze secondes, alors que le lecteur se tient à quarante :
 * l'écran annonçait donc un différé permanent, et le bouton « Revenir au direct » envoyait au bord —
 * c'est-à-dire là où le moindre hoquet du réseau fige l'image, la marge perdue jusqu'à la chaîne
 * suivante.
 */
const MARGE_DIRECT_S = 12;

/**
 * La vitesse de rattrapage, et pourquoi elle vaut mieux qu'un saut.
 *
 * hls.js sait revenir vers le direct **en accélérant imperceptiblement** plutôt qu'en sautant. Le
 * réglage existait et valait 1 — c'est-à-dire désactivé : une fois la dérive prise, elle restait.
 * À 1,06, une minute de lecture rattrape 3,4 s de retard ; personne ne l'entend ni ne le voit, et la
 * marge arrière se reconstitue toute seule au lieu de s'éroder jusqu'à la coupure.
 */
const RATTRAPAGE_MAX = 1.06;

/**
 * Combien de fois on redémarre **la même adresse** avant de la mettre en cause.
 *
 * Le code disait : « une erreur fatale de réseau sur un direct ne se répare pas en réessayant la même
 * adresse ». C'est faux, et l'observation l'établit : relancer la même chaîne, sur la même adresse,
 * la fait repartir **immédiatement**. Une erreur réseau au milieu d'un direct n'accuse donc pas
 * l'adresse, elle accuse une seconde de réseau.
 *
 * Trois reprises espacées de 2, 5 puis 10 s — croissantes, parce qu'une coupure qui dure ne se répare
 * pas en insistant vite, et qu'insister vite épuise le compteur avant que le réseau ne soit revenu.
 */
const REPRISES_MAX = 3;
const ATTENTES_REPRISE_MS = [2_000, 5_000, 10_000];

/**
 * La relève silencieuse, bornée — voir `releve-direct.ts`.
 *
 * Trois par source au plus ; huit secondes pour obtenir le manifeste puis la playlist, douze pour
 * remplir trois secondes de tampon. Au-delà, la reprise en place d'avant prend le relais. La relève
 * démarre trois secondes en avant du point de lecture, le temps qu'elle charge, puis se cale exactement.
 */
const ATTENTE_RELEVE_MS = 4_000;
const ATTENTE_TAMPON_RELEVE_MS = 8_000;
const TAMPON_DE_RELEVE_S = 6;

/**
 * **La déclaration de flux stable**, et pourquoi tout en dépend.
 *
 * La patience est un remède quand l'image est établie, et un poison quand on cherche encore une
 * source. Une tolérance de quinze secondes appliquée partout ferait payer quinze secondes à *chaque*
 * adresse morte de la course d'ouverture — c'est-à-dire allonger l'attente précisément au moment où
 * l'on n'a encore rien à perdre et où l'on veut trouver vite.
 *
 * Un flux est donc déclaré stable après `SEUIL_STABILITE_MS` d'image continue. Avant, on garde le
 * comportement rapide : on passe à la suivante. Après, on devient patient. Quinze secondes : deux
 * segments de la médiane du corpus, plus une marge — assez pour prouver que l'hébergeur envoie
 * vraiment, trop peu pour retarder la course, qu'une source morte n'atteint jamais.
 *
 * Le même chiffre sert de tolérance une fois la déclaration acquise : quinze secondes d'image acquise
 * achètent quinze secondes d'obstination. La symétrie rend le réglage explicable, donc corrigeable.
 *
 * La déclaration porte sur **l'adresse** et repart à zéro quand on en change : c'est cette source-ci
 * qui a fait ses preuves, pas la chaîne.
 */
const SEUIL_STABILITE_MS = 15_000;

/**
 * **La marge ne s'achète plus après coup : elle est là dès l'ouverture, et recalculée en permanence.**
 *
 * Un direct ne permet pas de faire des réserves : on ne met en tampon que ce qui est **déjà publié
 * devant** le point de lecture. Le tampon maximal possible est donc exactement la distance au bord du
 * direct — et elle valait 24 s, fixes, pour toutes les chaînes. Toute interruption réseau de plus de
 * 24 s coupait, sans recours. Pire, cette marge n'était agrandie qu'**après trois bégaiements** :
 * on rechargeait la sécurité au moment où l'on arrivait au bout.
 *
 * La fenêtre médiane du corpus fait 61 s. En gardant les 20 s de marge arrière, on peut se tenir à
 * 40 s du bord : **la marge grandit de 65 %** sans rien coûter, et s'adapte à chaque chaîne au lieu
 * d'un chiffre unique.
 *
 * La marge arrière avait sa raison : sur les 8 % de chaînes dont la fenêtre est plus courte que 40 s,
 * reculer jetait le lecteur **hors de la fenêtre sur-le-champ** ; l'image tenait un moment, puis
 * coupait, et relancer réparait parce que relancer repart au bord. Vingt secondes, deux segments et
 * demi, absorbent un rechargement sans réclamer un segment que l'hébergeur vient de retirer.
 *
 * **Depuis la r17, le plafond suit la fiabilité** : 40 s pour une source qui n'a jamais calé, 60 s pour
 * une source fragile. La règle vit dans `avance-direct.ts`, partagée avec Android.
 */

/**
 * Les deux seuils du tampon, et pourquoi on regarde la **descente** plutôt que le fond.
 *
 * Personne ne surveillait `buffered.end − currentTime`. On ne découvrait donc le problème qu'à zéro,
 * c'est-à-dire une fois l'image figée — trop tard pour faire autre chose que réparer. Un tampon qui
 * fond se voit dix secondes à l'avance, et dix secondes suffisent à changer de variante.
 *
 * En dessous de `TAMPON_BAS_S`, on plafonne la qualité d'un cran : moins d'octets à télécharger, le
 * tampon se reconstitue. En dessous de `TAMPON_CRITIQUE_S`, on descend à la variante la plus basse
 * disponible — à ce stade, une image moins fine vaut infiniment mieux qu'une image arrêtée. Et dès
 * que le tampon est refait, le plafond est retiré : la qualité maximale revient d'elle-même.
 */

/**
 * L'insistance quand plus rien ne répond : six relances, dix secondes d'écart.
 *
 * Une minute en tout. Assez pour traverser une coupure de réseau domestique — le cas qu'on veut
 * absolument survivre —, trop peu pour maquiller une chaîne réellement éteinte : au bout du compte on
 * le dit, avec le chiffre. La source doit faire ses preuves, l'insistance n'en tient pas lieu.
 */
const RELANCES_LENTES = 6;
const INTERVALLE_RELANCE_MS = 10_000;

/** L'obstination finale quand rien n'a jamais démarré : deux essais, et l'on conclut. */
const RELANCES_SANS_PREUVE = 2;

/** Ce que la vidéo a déjà devant elle, en secondes. */
function tamponDevant(video: HTMLVideoElement): number {
  for (let index = 0; index < video.buffered.length; index += 1) {
    if (video.buffered.start(index) <= video.currentTime + 0.5 && video.buffered.end(index) > video.currentTime) {
      return video.buffered.end(index) - video.currentTime;
    }
  }
  return 0;
}

/** Les segments d'une playlist hls.js, réduits à ce que le raccord de la relève utilise. */
function segmentsDe(details: LevelDetails | null | undefined): SegmentRepere[] {
  return (details?.fragments ?? []).map((segment) => ({
    sn: Number(segment.sn), start: segment.start, duration: segment.duration, programDateTime: segment.programDateTime,
  }));
}

function horodatage(secondes: number): string {
  const entier = Math.max(0, Math.round(secondes));
  const minutes = Math.floor(entier / 60);
  return `${minutes}:${String(entier % 60).padStart(2, "0")}`;
}

/** Ce que la barre montre : la fenêtre publiée par la chaîne, et où l'on s'y trouve. */
interface Fenetre {
  debut: number; fin: number; position: number; enPause: boolean;
  /** L'avance visée derrière le bord, en secondes : « en direct » veut dire « à cette avance ». */
  avance: number;
}

export function LecteurDirect(props: PropsDirect) {
  return <ChoisirLecteurDirect key={props.chaine.id} {...props} />;
}
function ChoisirLecteurDirect(props: PropsDirect) {
  const [repli, setRepli] = useState(false);
  const auRepli = useCallback(() => setRepli(true), []);
  const pont = pontBureau();
  return !repli && pont?.direct && pont.lecteur
    ? <Suspense fallback={<div className="lecteur-direct" role="status">Ouverture de la chaîne…</div>}>
        <DirectBureau {...props} onRepli={auRepli} />
      </Suspense>
    : <LecteurDirectWeb {...props} />;
}
function LecteurDirectWeb({ chaine, precedente, onChaine, onClose }: {
  chaine: ChaineDirect;
  /** La chaîne quittée, ou `null` la première fois. */
  precedente: ChaineDirect | null;
  onChaine: (chaine: ChaineDirect) => void;
  onClose: () => void;
}) {
  /** La vidéo à l'écran. */
  const videoRef = useRef<HTMLVideoElement | null>(null);
  /**
   * Les deux vidéos du lecteur, et celle qui est à l'écran.
   *
   * La seconde ne sert qu'à la relève silencieuse. Les échanger relance le relevé de la fenêtre sur la
   * bonne ; la lecture en cours, elle, continue sans rien remarquer.
   */
  const videos = useRef<[HTMLVideoElement | null, HTMLVideoElement | null]>([null, null]);
  const ecranRef = useRef(0);
  const [ecran, setEcran] = useState(0);
  const cheminRef = useRef<"direct" | "relais">("direct");
  const journal = useRef(new JournalDirect());
  const reculManuel = useRef(false);
  const trame = useRef({ element: null as HTMLVideoElement | null, instant: 0 });
  const conversions = useRef(new Map<string, { id: string; url: string }>());
  const renouvellementsCompat = useRef(new Map<string, number>());
  const demandesCompat = useRef(new Set<string>());
  const essaisCompat = useRef(new Set<string>());
  const lectureCompat = useRef("");
  if (!lectureCompat.current) lectureCompat.current = identifiantLectureDirect();
  const conversionActive = useRef(false);
  const rapporter = (id: string, url: string, ok: boolean, secondes?: number) =>
    conversionActive.current ? Promise.resolve() : api.resultatChaineLive(id, url, ok, secondes, cheminRef.current);
  const brancherVideo0 = useCallback((noeud: HTMLVideoElement | null) => {
    videos.current[0] = noeud;
    if (ecranRef.current === 0) videoRef.current = noeud;
  }, []);
  const brancherVideo1 = useCallback((noeud: HTMLVideoElement | null) => {
    videos.current[1] = noeud;
    if (ecranRef.current === 1) videoRef.current = noeud;
  }, []);
  const hlsRef = useRef<Hls | null>(null);
  const [adresses, setAdresses] = useState<SourceLisible[]>([]);
  /**
   * Passe-t-on par le relais du serveur pour l'adresse en cours ?
   *
   * Deux refus du navigateur ne se réparent pas côté navigateur : l'absence d'en-tête CORS — vu à
   * l'écran en `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` sur une chaîne pourtant vivante — et le
   * contenu `http` nu dans une page HTTPS. Dans ces deux cas seulement, le NAS recopie les octets.
   * Une adresse n'est donc jamais relayée d'emblée : elle l'est **après** un échec direct.
   */
  const [parRelais, setParRelais] = useState(false);
  const [rang, setRang] = useState(0);
  const [rangAffiche, setRangAffiche] = useState(0);
  const [diagnosticOuvert, setDiagnosticOuvert] = useState(false);
  const [diagnostic, setDiagnostic] = useState({ tampon: 0, retard: 0, source: 1, mode: "", incident: "Aucun", qualite: "Automatique" });
  const actualisees = useRef(new Map<string, SourceLisible>());
  const reposSources = useRef(new Map<string, number>());
  const renouvelerLecture = useRef<() => Promise<void>>(async () => {});
  const qualiteContinue = useRef(new QualiteContinue());
  const stableDepuis = useRef(0);
  const [ouverture, setOuverture] = useState(0);
  const relanceDifferee = useRef<number | undefined>(undefined);
  const cacheSegments = useRef(new CacheSegmentsDirect(budgetCacheDirect()));
  const lectureAvance = useRef(() => {});
  const dernierSegment = useRef(0);
  const rangRef = useRef(0);
  const [message, setMessage] = useState<string | null>("Ouverture de la chaîne…");
  const [echec, setEchec] = useState(false);
  /** L'instant où l'image a été vue pour la dernière fois : ce qui distingue un incident d'une panne. */
  const depuisLecture = useRef(0);
  /** Cette adresse-ci a-t-elle fait ses preuves ? Et une adresse de cette chaîne l'a-t-elle jamais ? */
  const fluxDeclareStable = useRef(false);
  const dejaVuStable = useRef(false);
  const declaration = useRef<number | undefined>(undefined);
  const reprises = useRef(0);
  const relancesLentes = useRef(0);
  /** Ce qui a coupé, dit à l'écran plutôt que deviné. */
  const dernierIncident = useRef<string | null>(null);
  /** L'adresse en cours d'essai, pour ne rapporter au serveur que ce qu'on a réellement tenté. */
  const essai = useRef<string | null>(null);
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  /** La même, lisible depuis les rappels de hls.js, qui ne revoient pas le rendu. */
  const fenetreRef = useRef<Fenetre | null>(null);
  const [barreVisible, setBarreVisible] = useState(true);
  const dernierGeste = useRef(Date.now());
  const reveillerCommandes = useCallback(() => {
    dernierGeste.current = Date.now();
    setBarreVisible(true);
  }, []);
  const [choixOuvert, setChoixOuvert] = useState(false);
  /**
   * Les adresses que le serveur n'a pas pu joindre, sondées une fois qu'une autre joue.
   *
   * Elles sortent du repli automatique, pas du menu : le NAS ne passe pas forcément par le même chemin
   * que ce navigateur, et c'est la lecture qui garde le dernier mot.
   */
  const [muettes, setMuettes] = useState<ReadonlySet<string>>(() => new Set());
  const muettesRef = useRef<ReadonlySet<string>>(new Set());
  /** Ce que les rappels asynchrones doivent lire à jour : les adresses, la chaîne, ce qui est déjà couru ou sondé. */
  const adressesRef = useRef<SourceLisible[]>([]);
  const chaineRef = useRef(chaine.id);
  chaineRef.current = chaine.id;
  const vaguesCourues = useRef(new Set<number>([0]));
  const sondee = useRef(false);
  /**
   * Le retard de sécurité pris après des blocages répétés, en secondes.
   *
   * Zéro tant que tout va bien : on part **au bord du flux**, parce que c'est ce que « en direct »
   * veut dire, et on ne paie du retard que lorsqu'il est mérité.
   */
  const [securite, setSecurite] = useState(0);
  const blocages = useRef<number[]>([]);
  /**
   * Les incidents de l'adresse en cours depuis qu'on la regarde — un blocage, une image figée, une
   * reprise. Un seul suffit à la dire fragile, et à lui donner plus d'avance.
   */
  const incidents = useRef(0);
  const adresseDesIncidents = useRef<string | null>(null);
  /** L'avance visée en ce moment, en secondes, telle que le relevé l'a calculée pour cette chaîne. */
  const avanceVisee = useRef(0);
  /**
   * Quand on a demandé quelque chose au lecteur pour la dernière fois.
   *
   * Ouvrir, sauter, reprendre : chacun de ces gestes remplit le tampon et ressemble à un hoquet.
   * Les compter revenait à se punir soi-même — trois flèches en deux minutes suffisaient à faire
   * reculer le lecteur alors que tout allait bien.
   */
  const silenceJusqua = useRef(0);
  /** Depuis quand on est sur cette source : on ne zappe pas une chaîne qui vient de démarrer. */
  const depuisSource = useRef(0);

  /**
   * Une chaîne neuve n'a rien prouvé : ni l'adresse en cours, ni aucune des autres.
   *
   * Le composant n'est pas remonté quand on change de chaîne, si bien que ces références
   * survivraient au zapping — la patience héritée de la chaîne précédente s'appliquerait à celle-ci,
   * qui n'a encore rien montré, et ralentirait sa course d'ouverture.
   */
  useEffect(() => {
    fluxDeclareStable.current = false;
    dejaVuStable.current = false;
    depuisLecture.current = 0;
    reprises.current = 0;
    relancesLentes.current = 0;
    dernierIncident.current = null;
    journal.current.vider();
    reculManuel.current = false;
    demandesCompat.current.clear(); essaisCompat.current.clear();
    window.clearTimeout(declaration.current);
    declaration.current = undefined;
    cacheSegments.current.vider();
    actualisees.current.clear();
    reposSources.current.clear();
    stableDepuis.current = 0;
    qualiteContinue.current = new QualiteContinue();
    return () => {
      window.clearTimeout(declaration.current);
      window.clearTimeout(relanceDifferee.current);
      cacheSegments.current.vider();
      for (const c of conversions.current.values()) void api.arreterConversionLive(c.id).catch(() => undefined);
      conversions.current.clear();
    };
  }, [chaine.id]);

  useEffect(() => {
    let annule = false;
    void (async () => {
      try {
        const details = await api.chaineLive(chaine.id);
        if (annule) return;
        /*
         * L'ordre vient du serveur, et il est déjà le bon : échecs, puis définition, puis débit. La
         * course qui suit ne fait qu'écarter les injoignables — elle ne reclasse pas ce qu'il a mesuré.
         */
        const declarees = details.sources.map((source) => ({
          url: source.url, relais: source.relais ?? null,
          hauteur: source.hauteur ?? null, debit: source.debit ?? null, echecs: source.echecs,
          empreinte: source.empreinte ?? source.url,
          identifiant: source.identifiant, cheminPrefere: source.cheminPrefere,
        }));
        /*
         * La course, avant d'ouvrir quoi que ce soit.
         *
         * Les adresses partent ensemble et l'ordre des réponses devient l'ordre d'essai : une chaîne
         * dont la première adresse est morte démarrait en treize secondes, elle démarre en une. Elle
         * ne coûte rien au NAS — ces requêtes partent d'ici — et ne jette aucune adresse : une
         * silencieuse reste jouable, elle passe simplement derrière.
         *
         * Une seule adresse ne se court pas contre elle-même : la fonction rend la liste telle quelle.
         */
        const ordonnees = [
          ...await courirLesAdresses(declarees.slice(0, COURSE_MAX).map((s) => ({ ...s,
            url: prefereRelais(s) && s.relais ? s.relais : s.url, origine: s.url })))
            .then((sources) => sources.map(({ origine, ...s }) => ({ ...s, url: origine }))),
          ...declarees.slice(COURSE_MAX),
        ].sort((a, b) => Number(["ts", "dash", "mp4"].includes(formatAdresse(a.url)))
          - Number(["ts", "dash", "mp4"].includes(formatAdresse(b.url))));
        if (annule) return;
        rangRef.current = 0;
        setRang(0);
        setRangAffiche(0);
        setParRelais(prefereRelais(ordonnees[0] ?? {}));
        adressesRef.current = ordonnees;
        setAdresses(ordonnees);
      } catch {
        if (!annule) { setMessage("Chaîne indisponible"); setEchec(true); }
      }
    })();
    return () => { annule = true; };
  }, [chaine.id]);

  /**
   * Ce qu'on fait quand la source ne tient pas : reculer, puis changer.
   *
   * Un seul endroit décide, appelé par les deux chemins — les bégaiements comptés, et l'image figée
   * qui n'attend pas d'être comptée.
   */
  const reagirALInstabilite = useRef<() => void>(() => undefined);

  /** Une chaîne neuve repart au bord : le retard de sécurité était celui de la précédente. */
  useEffect(() => {
    setSecurite(0);
    blocages.current = [];
    setFenetre(null);
    setChoixOuvert(false);
    muettesRef.current = new Set();
    setMuettes(muettesRef.current);
    vaguesCourues.current = new Set([0]);
    sondee.current = false;
  }, [chaine.id]);

  /**
   * Ouvrir le rang choisi par le repli, en faisant d'abord courir sa vague si personne ne l'a sondée.
   *
   * La course d'ouverture ne sonde que les douze premières adresses. Quand elles ont toutes échoué, la
   * suivante n'est pas essayée à l'aveugle douze secondes durant : ses voisines courent d'abord, et
   * celles qui répondent passent devant. Une chaîne à quatre-vingts sources dont les vingt premières
   * sont mortes démarre ainsi en quelques secondes, et non en quatre minutes.
   */
  const ouvrirLeRang = useCallback((prochain: number) => {
    const annoncer = (index: number) => {
      rangRef.current = index;
      setParRelais(false);
      setMessage(`Source ${index + 1} sur ${adressesRef.current.length}…`);
      setRang(index);
      setRangAffiche(index);
    };
    const vague = debutDeVague(prochain);
    if (vaguesCourues.current.has(vague)) { annoncer(prochain); return; }
    vaguesCourues.current.add(vague);
    const total = adressesRef.current.length;
    setMessage(`Recherche d'une source qui répond, ${vague + 1} à ${Math.min(total, vague + COURSE_MAX)} sur ${total}…`);
    const chaineCourue = chaine.id;
    void courirLesAdresses(adressesRef.current.slice(vague, vague + COURSE_MAX)).then((ordonnee) => {
      if (chaineRef.current !== chaineCourue) return;
      const suite = [...adressesRef.current];
      suite.splice(vague, ordonnee.length, ...ordonnee);
      adressesRef.current = suite;
      setAdresses(suite);
      annoncer(prochaineAdresse(suite.map((adresse) => adresse.url), vague - 1, muettesRef.current) ?? prochain);
    });
  }, [chaine.id]);

  /**
   * Passe à l'adresse suivante.
   *
   * L'échec est rapporté au serveur avant de changer : c'est ainsi que l'ordre d'essai s'améliore
   * tout seul, et que l'état d'une chaîne se mesure à l'usage plutôt qu'en sondant cent mille
   * adresses — ce qui était la décision n° 5 du chantier.
   *
   * **Le rang vit dans une référence, et le calcul est fait ici plutôt que dans `setRang`.** La
   * première écriture posait les messages et le rapport d'échec *à l'intérieur* de la fonction de
   * mise à jour de l'état : React l'appelle deux fois en mode strict, et le journal du navigateur
   * l'a montré — **quatre** `POST /resultat` pour un seul échec, donc un compteur faussé et un
   * classement des adresses corrompu par l'affichage. `essai` remis à zéro dès l'entrée sert de
   * verrou : une seconde erreur signalée avant que la source suivante ne s'ouvre ne fait rien.
   */
  const suivante = useCallback(() => {
    const morte = essai.current;
    if (!morte) return;
    essai.current = null;
    /*
     * Une seconde chance par le relais **avant** de changer d'adresse.
     *
     * L'adresse n'est pas forcément mauvaise : c'est peut-être le navigateur qui a refusé de la lire.
     * Passer à la suivante sans avoir essayé le relais condamnerait une chaîne qui marche, et
     * inscrirait un échec qui n'en est pas un dans le classement des adresses.
     */
    const courante = adresses[rangRef.current];
    if (cheminRef.current === "direct" && courante?.relais) {
      setParRelais(true);
      // `parRelais` figure dans les dépendances de l'effet de lecture : le changer relance la même
      // adresse, cette fois relayée. `essai` reste vide jusque-là, ce qui empêche une seconde erreur
      // arrivée entre-temps de faire sauter une adresse pour rien.
      setMessage("Nouvel essai par le serveur…");
      return;
    }
    /*
     * **Une adresse qui a joué n'est pas une adresse morte.**
     *
     * L'échec était inscrit quoi qu'il arrive — y compris pour une adresse qui venait de diffuser une
     * heure sans faute et qu'une seconde de réseau avait interrompue. On fabriquait ainsi de fausses
     * mauvaises notes sur les sources les plus regardées, c'est-à-dire les meilleures. Ne compte
     * désormais que l'adresse qui n'a **jamais** tenu l'image trente secondes : celle-là n'a rien
     * prouvé, et son échec veut dire quelque chose.
     */
    void rapporter(chaine.id, morte, false).catch(() => undefined);
    // La déclaration porte sur l'adresse : celle qu'on prend n'a encore rien prouvé.
    window.clearTimeout(declaration.current);
    declaration.current = undefined;
    fluxDeclareStable.current = false;
    depuisLecture.current = 0;
    reprises.current = 0;
    // Toutes les adresses entrent dans le repli, sauf celles que le serveur a trouvées muettes.
    const prochain = prochaineAdresse(adresses.map((adresse) => adresse.url), rangRef.current, muettesRef.current);
    if (prochain === null) {
      /*
       * Toutes les adresses ont échoué : on insiste, lentement, puis on le dit.
       *
       * Un téléviseur ne renonce pas parce qu'un émetteur a hoqueté. Mais insister sans fin devant une
       * chaîne réellement morte n'est pas de la ténacité, c'est un écran noir qui ment : la source
       * doit **faire ses preuves**. Six relances de dix secondes, soit une minute — assez pour
       * traverser une coupure domestique, trop peu pour maquiller une panne.
       *
       * On reprend la **première** adresse, celle que la course a désignée comme la meilleure : l'ordre
       * dans lequel on vient de les abandonner n'a rien changé à ce classement.
       */
      /*
       * On s'obstine pour ce qui a marché, pas pour ce qui n'a jamais rien montré. Six relances — une
       * minute — quand une adresse de cette chaîne a déjà tenu l'image : c'est le cas d'une coupure de
       * réseau domestique, et il mérite qu'on l'attende. Deux quand rien n'a jamais démarré, où
       * insister revient à faire patienter devant une chaîne qui n'existe plus.
       */
      const plafond = dejaVuStable.current ? RELANCES_LENTES : RELANCES_SANS_PREUVE;
      if (relancesLentes.current < plafond) {
        relancesLentes.current += 1;
        setMessage(`Plus aucune source ne répond, nouvelle tentative (${relancesLentes.current}/${plafond})…`);
        relanceDifferee.current = window.setTimeout(() => {
          const premiere = premiereAdresse(adressesRef.current.map((adresse) => adresse.url), muettesRef.current);
          rangRef.current = premiere;
          setParRelais(false);
          setRang(premiere);
          setRangAffiche(premiere);
          setOuverture((valeur) => valeur + 1);
        }, INTERVALLE_RELANCE_MS);
        return;
      }
      // Le message dit ce qui a été mesuré, au lieu d'un constat qui ne permet ni de comprendre ni de
      // corriger.
      const incident = dernierIncident.current;
      setMessage(incident
        ? `Aucune des ${adresses.length} source(s) ne répond après ${relancesLentes.current} relances. Dernier incident : ${incident}.`
        : "Aucune source ne répond pour cette chaîne.");
      setEchec(true);
      return;
    }
    ouvrirLeRang(prochain);
  }, [adresses, chaine.id, ouvrirLeRang, parRelais]);

  /**
   * Choisir une source à la main.
   *
   * Le repli automatique décide bien quand une adresse ne répond pas ; il ne sait rien de celle qui
   * répond **mal** — l'image qui se fige toutes les dix secondes, la définition qui s'effondre. Cela,
   * seule la personne devant l'écran le voit, et c'est le seul moyen qu'elle a de le dire.
   *
   * L'adresse quittée n'est **pas** rapportée comme morte : elle ne l'est pas, on lui préfère juste
   * une autre. Inscrire un échec ici fausserait le classement avec une opinion.
   */
  const choisirSource = useCallback((index: number) => {
    setChoixOuvert(false);
    window.clearTimeout(relanceDifferee.current);
    setOuverture((valeur) => valeur + 1);
    essai.current = null;
    rangRef.current = index;
    setParRelais(false);
    setEchec(false);
    setMessage(`Source ${index + 1}…`);
    setRang(index);
    setRangAffiche(index);
  }, [parRelais]);

  useEffect(() => {
    const element = videoRef.current;
    const choisie = adresses[rang];
    if (!element || !choisie || echec) return;
    let entree: SourceLisible = actualisees.current.get(choisie.identifiant ?? choisie.url) ?? choisie;
    /*
     * Le contenu mixte se voit d'avance, lui : une page HTTPS ne demandera même pas une adresse en
     * `http` nu. Inutile d'attendre un échec que le navigateur annonce déjà — on part relayé.
     */
    const mixte = window.location.protocol === "https:" && entree.url.startsWith("http:");
    const relayer = (parRelais || mixte || prefereRelais(entree)) && entree.relais;
    let source = conversions.current.get(entree.identifiant ?? entree.url)?.url ?? (relayer ? entree.relais! : entree.url);
    conversionActive.current = conversions.current.has(entree.identifiant ?? entree.url);
    const cleSource = (s: SourceLisible) => s.identifiant ?? s.url;
    const recente = (s: SourceLisible) => actualisees.current.get(cleSource(s)) ?? s;
    const adresseLecture = (s: SourceLisible) => conversions.current.get(cleSource(s))?.url ?? (
      (parRelais || prefereRelais(s) || (window.location.protocol === "https:" && s.url.startsWith("http:"))) && s.relais ? s.relais : s.url);
    essai.current = entree.url;
    cheminRef.current = relayer || source.includes("/api/live/relais?") ? "relais" : "direct";
    // Les incidents sont ceux de l'adresse : la même, relancée ou relayée, garde les siens.
    if (adresseDesIncidents.current !== entree.url) {
      adresseDesIncidents.current = entree.url;
      incidents.current = 0;
    }
    // Ouvrir un flux remplit le tampon : c'est un geste, pas un hoquet.
    silenceJusqua.current = Date.now() + 4_000;
    depuisSource.current = Date.now();
    let annule = false;
    let minuteur = 0;
    let demarrage = 0;
    let reparations = 0;
    let repriseEnPreparation = false;
    let derniereReprise = 0;
    let renouvellementEnCours = false;
    let compatEnCours = false;
    let dernierRenouvellement = 0;
    stableDepuis.current = 0;
    dernierSegment.current = Date.now();
    /** Les relèves en préparation : elles partent avec la lecture qu'elles devaient remplacer. */
    const relevesEnCours = new Set<Hls>();
    const nettoyerNatif: Array<() => void> = [];

    const reussi = () => {
      if (annule) return;
      setMessage(null);
      window.clearTimeout(minuteur);
      /*
       * L'image avance : la série d'échecs est finie.
       *
       * Remettre les compteurs à zéro ici plutôt qu'à l'ouverture distingue « trois incidents
       * d'affilée » de « trois incidents dans la soirée ». Le second ne dit rien contre la source.
       */
      if (!depuisLecture.current) depuisLecture.current = Date.now();
      /*
       * La déclaration se prononce après quinze secondes d'image, et c'est **elle** qui remet les
       * compteurs à neuf — pas le simple retour de l'image. Un flux qui revient deux secondes puis
       * retombe n'a rien prouvé ; l'absoudre lui offrirait une série d'échecs sans fin.
       */
      if ((!fluxDeclareStable.current || reprises.current > 0 || relancesLentes.current > 0) && !repriseEnPreparation && declaration.current === undefined) {
        declaration.current = window.setTimeout(() => {
          declaration.current = undefined;
          fluxDeclareStable.current = true;
          if (cheminRef.current === "relais") retenirRelais(entree.identifiant);
          void rapporter(chaine.id, entree.url, true).catch(() => undefined);
          dejaVuStable.current = true;
          reprises.current = 0;
          relancesLentes.current = 0;
          /*
           * Une source joue : c'est le moment de regarder les autres. Le serveur les sonde toutes, une
           * fois par chaîne, et celles qui se taisent sortent du repli — pas du menu.
           */
          if (!sondee.current && adressesRef.current.length > 1) {
            sondee.current = true;
            const chaineSondee = chaine.id;
            void api.sondesChaineLive(chaine.id, entree.url).then(({ muettes: trouvees }) => {
              if (chaineRef.current !== chaineSondee) return;
              muettesRef.current = new Set(trouvees);
              setMuettes(muettesRef.current);
            }).catch(() => undefined);
          }
          /*
           * La tolérance interne se relève **à la déclaration**. hls.js relit sa configuration à
           * chaque chargement, si bien qu'il suffit de l'écrire ici : les reprises silencieuses
           * passent de quelques secondes à une quinzaine, sans avoir ralenti la course d'ouverture.
           */
          const courant = hlsRef.current;
          if (courant) {
            // Les anciens champs *LoadingMaxRetry ne sont lus qu'à la construction de hls.js.
            for (const politique of [courant.config.playlistLoadPolicy, courant.config.fragLoadPolicy,
              courant.config.manifestLoadPolicy]) {
              if (politique?.default.errorRetry) politique.default.errorRetry.maxNumRetry = 6;
              if (politique?.default.timeoutRetry) politique.default.timeoutRetry.maxNumRetry = 6;
            }
          }
        }, SEUIL_STABILITE_MS);
      }
      // C'est l'adresse d'origine qu'on note, jamais celle du relais : le classement porte sur la
      // source, et le relais n'est qu'un chemin pour y aller.
      };
    lectureAvance.current = reussi;

    void (async () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      const format = formatAdresse(entree.url);
      if (!conversionActive.current && (demandesCompat.current.has(cleSource(entree)) || ["dash", "ts", "mp4"].includes(format))) {
        if (essaisCompat.current.has(cleSource(entree))) { suivante(); return; }
        essaisCompat.current.add(cleSource(entree));
        setMessage("Préparation d’une lecture compatible…");
        try {
          for (const c of conversions.current.values()) await api.arreterConversionLive(c.id).catch(() => undefined);
          conversions.current.clear();
          const c = await api.convertirSourceLive(chaine.id, entree.url, lectureCompat.current);
          if (annule) { void api.arreterConversionLive(c.id).catch(() => undefined); return; }
          conversions.current.set(cleSource(entree), c);
          source = c.url; conversionActive.current = true;
        } catch {
          if (!annule) { dernierIncident.current = "Format non lisible sur ce navigateur"; suivante(); }
          return;
        }
      }
      /*
       * Un direct qui ne démarre pas ne le dit pas toujours : un hébergeur peut accepter la connexion
       * puis ne rien envoyer. Sans cette échéance, la chaîne resterait noire indéfiniment au lieu de
       * basculer sur son secours.
       */
      minuteur = window.setTimeout(() => { if (!annule) suivante(); }, 18_000);

      const natif = element.canPlayType("application/vnd.apple.mpegurl");
      const HlsClass = "MediaSource" in window ? (await import("hls.js")).default : null;
      if (annule) return;

      if (HlsClass?.isSupported()) {
        /*
         * Les réglages diffèrent de ceux du lecteur de la médiathèque, et pour une raison de fond :
         * un direct n'a pas de début. On démarre au bord du flux — c'est ce que « en direct » veut
         * dire.
         *
         * **`lowLatencyMode` est éteint, et c'est une correction.** Il vise le LL-HLS et ses segments
         * partiels ; sur les treize manifestes mesurés, aucun n'en publie — 8 s de segment, huit
         * segments à la fois. Allumé, il ne faisait donc que serrer la marge devant un flux qui n'a
         * rien de faible latence, et transformait chaque hoquet du réseau en gel de l'image.
         *
         * `backBufferLength` garde une minute derrière le point de lecture : c'est ce qui rend le
         * retour en arrière de la barre instantané sur la fenêtre médiane, au lieu de rappeler les
         * segments à l'hébergeur.
         */
        const hls = new HlsClass({
          enableWorker: true, lowLatencyMode: false, backBufferLength: 20,
          capLevelOnFPSDrop: true, useMediaCapabilities: true,
          /*
           * `maxBufferLength` doit **dépasser** la latence visée, sans quoi il la borne.
           *
           * Il valait 30 s pour une latence de 24 : on demandait donc 30 s de tampon là où la latence
           * n'en autorisait que 24, et le réglage ne servait à rien. Il vaut maintenant plus que le
           * plafond de 60 s d'une source fragile, pour que ce soit la latence — ce qu'on maîtrise —
           * qui décide de la marge, et non un plafond oublié.
           */
          maxBufferLength: AVANCE_FRAGILE_S, maxMaxBufferLength: AVANCE_FRAGILE_S + 10,
          maxBufferSize: budgetCacheDirect(),
          fLoader: chargeurAvecCache(HlsClass, cacheSegments.current),
          liveSyncDuration: incidents.current > 0 || entree.echecs > 0 ? 55 : 40,
          liveMaxLatencyDuration: AVANCE_FRAGILE_S, liveSyncOnStallIncrease: 0, capLevelToPlayerSize: false,
          maxLiveSyncPlaybackRate: 1,
          /*
           * **L'adaptation de débit, réglée pour tenir plutôt que pour briller.**
           *
           * Aucun des deux lecteurs n'avait la moindre configuration d'adaptation : les défauts
           * s'appliquaient, et ils privilégient la qualité. Or si le réseau est **durablement** plus
           * lent que le flux, aucune marge ne sauve — on vide à vitesse constante, et 24 s ou 40 s ne
           * font que retarder l'échéance. La seule réponse permanente est de consommer moins.
           *
           * `abrBandWidthFactor` à 0,7 au lieu de 0,95 : on ne s'autorise une variante que si la
           * bande passante mesurée la couvre avec 30 % de marge. `abrBandWidthUpFactor` à 0,5 rend la
           * remontée prudente — remonter trop vite reproduit la panne qu'on vient de fuir.
           * `maxStarvationDelay` raccourci fait descendre dès que le tampon souffre, sans attendre.
           */
          abrBandWidthFactor: 0.7,
          abrBandWidthUpFactor: 0.5,
          maxStarvationDelay: 4,
          maxLoadingDelay: 4,
          /*
           * **La tolérance interne, élargie, et pour une raison arithmétique.**
           *
           * Un direct redemande la playlist toutes les huit secondes, et un segment aussi souvent —
           * environ **900 requêtes par heure**. Les valeurs par défaut abandonnent après quelques
           * secondes ; sur neuf cents tirages, en rater un devient une certitude. C'est là toute
           * l'explication du « ça coupe au bout d'un moment » : plus on regarde longtemps, plus c'est
           * sûr d'arriver. Ces reprises-ci se font **sous** l'image, sans que rien ne se voie.
           */
          manifestLoadingMaxRetry: 1,
          levelLoadingMaxRetry: 3,
          fragLoadingMaxRetry: 3,
          levelLoadingRetryDelay: 1_000,
          fragLoadingRetryDelay: 1_000,
        });
        hlsRef.current = hls;
        /*
         * La réaction à l'instabilité, en un seul endroit.
         *
         * Deux chemins y mènent : les bégaiements comptés patiemment, et l'image figée que le relevé
         * détecte sans rien compter. Reculer d'abord — c'est invisible et ça répare la plupart des
         * cas —, changer de source ensuite, et jamais l'inverse.
         */
        reagirALInstabilite.current = () => {
          if (annule || videoRef.current?.paused || repriseEnPreparation) return;
          blocages.current = [];
          const courant = hlsRef.current;
          if (courant && courant.levels.length > 1) courant.autoLevelCapping = 0;
          void recuperer();
        };
        hls.loadSource(source);
        hls.attachMedia(element);
        hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
          const limite = Date.now() + 8_000;
          const demarrer = () => {
            if (annule || hlsRef.current !== hls) return;
            const largeur = element.seekable.length ? element.seekable.end(element.seekable.length - 1) - element.seekable.start(0) : 0;
            const reserve = tamponDevant(element);
            if (reserve >= reserveDeDepart(largeur) || (Date.now() >= limite && reserve >= 1 && element.readyState >= 2)) {
              void element.play().catch(() => { if (!annule) setMessage("Cliquez sur l’image pour lancer la lecture."); });
            } else if (Date.now() < limite) demarrage = window.setTimeout(demarrer, 100);
          };
          demarrer();
        });
        hls.on(HlsClass.Events.FRAG_BUFFERED, () => { dernierSegment.current = Date.now(); });

        /*
         * **La relève silencieuse** : une seconde lecture cachée de la même adresse, calée sur le segment
         * que l'écran montre, qui prend la place de la première avant que son tampon ne s'épuise.
         *
         * Elle répare ce que la reprise en place ne répare pas — la session qui expire —, parce qu'elle
         * recharge le manifeste maître, ce que hls.js ne sait pas faire sans vider le tampon.
         */
        const detailsDe = new WeakMap<Hls, LevelDetails>();
        const suivreLesDetails = (instance: Hls) => {
          instance.on(HlsClass.Events.LEVEL_LOADED, (_evenement, donnees) => {
            detailsDe.set(instance, donnees.details);
            if (donnees.details.live) {
              instance.config.liveSyncDuration = Math.min(55, calculerAvance(donnees.details.totalduration,
                donnees.details.targetduration, incidents.current > 0 || entree.echecs > 0));
            }
          });
        };
        suivreLesDetails(hls);
        const relever = async (cible = recente(entree), index = rangRef.current): Promise<boolean> => {
          const principale = hlsRef.current;
          const aLEcran = videoRef.current;
          const autre = videos.current[ecranRef.current === 0 ? 1 : 0];
          if (annule || !principale || !aLEcran || !autre) return false;
          const memeSource = cleSource(cible) === cleSource(entree);
          if (!memeSource && ["dash", "ts", "mp4"].includes(formatAdresse(cible.url))) return false;
          const releve = new HlsClass({ ...principale.userConfig, autoStartLoad: false });
          // Les politiques de reprise font partie de userConfig, recopiée ci-dessus.
          relevesEnCours.add(releve);
          suivreLesDetails(releve);
          const abandonner = (): false => {
            relevesEnCours.delete(releve);
            releve.destroy();
            if (!annule) { autre.removeAttribute("src"); autre.load(); }
            return false;
          };
          autre.muted = true;
          const manifestePret = new Promise<boolean>((resoudre) => {
            const minuterie = window.setTimeout(() => resoudre(false), Math.min(ATTENTE_RELEVE_MS, Math.max(1_500, tamponDevant(aLEcran) * 300)));
            releve.once(HlsClass.Events.MANIFEST_PARSED, () => { window.clearTimeout(minuterie); resoudre(true); });
          });
          releve.loadSource(adresseLecture(cible));
          releve.attachMedia(autre);
          const manifeste = await manifestePret;
          if (annule || !manifeste) return abandonner();
          // Sans chargement automatique, hls.js lit le manifeste maître puis attend : on demande la playlist.
          const niveauPret = new Promise<LevelDetails | null>((resoudre) => {
            const minuterie = window.setTimeout(() => resoudre(null), ATTENTE_RELEVE_MS);
            releve.once(HlsClass.Events.LEVEL_LOADED, (_evenement, donnees) => { window.clearTimeout(minuterie); resoudre(donnees.details); });
          });
          releve.startLoad(-1);
          const niveau = await niveauPret;
          if (annule || !niveau || hlsRef.current !== principale) return abandonner();
          const repere = repereDansLaPlaylist(segmentsDe(detailsDe.get(principale)), aLEcran.currentTime);
          const depart = repere && (memeSource || repere.pdt !== null)
            ? tempsPourRepere(segmentsDe(niveau), repere, memeSource) : null;
          releve.stopLoad();
          releve.startLoad(depart ?? -1);
          if (depart != null) autre.currentTime = Math.max(0, depart);
          const limite = Date.now() + ATTENTE_TAMPON_RELEVE_MS;
          while (!annule && tamponDevant(autre) < TAMPON_DE_RELEVE_S && Date.now() < limite) {
            await new Promise((resoudre) => window.setTimeout(resoudre, 100));
          }
          if (annule || tamponDevant(autre) < TAMPON_DE_RELEVE_S || hlsRef.current !== principale) return abandonner();
          // Rattraper exactement l'écran avant de montrer : même segment, même instant.
          const repereA = repereDansLaPlaylist(segmentsDe(detailsDe.get(principale)), aLEcran.currentTime);
          const repereB = repereDansLaPlaylist(segmentsDe(detailsDe.get(releve)), autre.currentTime);
          const raccord = raccordAutorise(memeSource, repereA?.pdt ?? null, repereB?.pdt ?? null);
          const ecart = raccord ? ecartEntre(repereA, repereB, niveau.targetduration) : null;
          // Sans horloge commune, conserver l'image courante jusqu'à presque épuisement.
          if (!raccord && tamponDevant(aLEcran) > 3) {
            const attenteLimite = Date.now() + 30_000;
            const receptionAvant = dernierSegment.current;
            while (!annule && !aLEcran.paused && tamponDevant(aLEcran) > 3 && Date.now() < attenteLimite) {
              if (dernierSegment.current > receptionAvant && tamponDevant(aLEcran) > 15) return abandonner();
              await new Promise((resoudre) => window.setTimeout(resoudre, 100));
            }
            if (tamponDevant(aLEcran) > 3) return abandonner();
          }
          if (ecart != null && Math.abs(ecart) < niveau.targetduration * 4) {
            const cible = autre.currentTime - ecart;
            const disponible = Array.from({ length: autre.buffered.length }, (_, i) => i)
              .some((i) => cible >= autre.buffered.start(i) && cible + 0.5 < autre.buffered.end(i));
            if (disponible) autre.currentTime = cible;
          }
          // Une pause décidée pendant le chargement doit rester une pause.
          if (aLEcran.paused) return abandonner();
          const imagesAvant = imagesPresentees(autre);
          try { await autre.play(); } catch { return abandonner(); }
          const decodageLimite = Date.now() + 2_000;
          const imageAbsente = () => imagesAvant !== null && (imagesPresentees(autre) ?? 0) <= imagesAvant;
          while (!annule && (autre.seeking || autre.readyState < 2 || imageAbsente()) && Date.now() < decodageLimite) {
            await new Promise((resoudre) => window.setTimeout(resoudre, 50));
          }
          if (autre.seeking || autre.readyState < 2 || imageAbsente() || tamponDevant(autre) < 3 || aLEcran.paused) return abandonner();
          if (autre.seekable.length && autre.seekable.end(autre.seekable.length - 1) - autre.currentTime > AVANCE_FRAGILE_S) return abandonner();
          if (annule || hlsRef.current !== principale) return abandonner();
          const repereFinal = repereDansLaPlaylist(segmentsDe(detailsDe.get(principale)), aLEcran.currentTime);
          const positionFinale = repereFinal ? tempsPourRepere(segmentsDe(detailsDe.get(releve)), repereFinal, memeSource) : null;
          if (positionFinale !== null && Math.abs(positionFinale - autre.currentTime) > 0.25) {
            if (!Array.from({ length: autre.buffered.length }, (_, i) => i).some((i) =>
              positionFinale >= autre.buffered.start(i) && positionFinale + 3 < autre.buffered.end(i))) return abandonner();
            autre.currentTime = positionFinale;
            const finSeek = Date.now() + 1_000;
            while (!annule && autre.seeking && Date.now() < finSeek) await new Promise((r) => window.setTimeout(r, 25));
            if (annule || autre.seeking || aLEcran.paused || hlsRef.current !== principale) return abandonner();
          }
          if (!memeSource && tamponDevant(aLEcran) > 15 && Date.now() - dernierSegment.current < 2_000) return abandonner();
          // Le son et l'image passent ensemble à la relève prête.
          autre.volume = aLEcran.volume;
          autre.muted = aLEcran.muted;
          aLEcran.muted = true;
          aLEcran.pause();
          if (!memeSource) {
            reposSources.current.set(cleSource(entree), Date.now() + 120_000);
            void rapporter(chaine.id, recente(entree).url, false).catch(() => undefined);
            fluxDeclareStable.current = false;
            window.clearTimeout(declaration.current);
            declaration.current = undefined;
            depuisSource.current = Date.now();
            qualiteContinue.current = new QualiteContinue();
            reprises.current = 0;
            stableDepuis.current = 0;
          }
          entree = cible;
          conversionActive.current = conversions.current.has(cleSource(cible));
          source = adresseLecture(cible);
          cheminRef.current = source === cible.relais || source.includes("/api/live/relais?") ? "relais" : "direct";
          essai.current = cible.url;
          rangRef.current = index;
          setRangAffiche(index);
          relevesEnCours.delete(releve);
          hlsRef.current = releve;
          releve.on(HlsClass.Events.FRAG_BUFFERED, () => { dernierSegment.current = Date.now(); });
          releve.on(HlsClass.Events.ERROR, surErreurDe(releve));
          ecranRef.current = ecranRef.current === 0 ? 1 : 0;
          videoRef.current = autre;
          setEcran(ecranRef.current);
          silenceJusqua.current = Date.now() + 4_000;
          dernierSegment.current = Date.now();
          depuisLecture.current = 0;
          principale.destroy();
          aLEcran.removeAttribute("src");
          aLEcran.load();
          return true;
        };

        const recuperer = async () => {
          if (annule || repriseEnPreparation || videoRef.current?.paused) return;
          if (Date.now() - derniereReprise < 5_000) return;
          derniereReprise = Date.now();
          if (reprises.current >= REPRISES_MAX) {
            // Une panne réseau ne justifie pas de jeter les secondes encore lisibles.
            if (tamponDevant(videoRef.current!) > 3) return;
            suivante();
            return;
          }
          repriseEnPreparation = true;
          reprises.current += 1;
          incidents.current += 1;
          depuisLecture.current = 0;
          window.clearTimeout(declaration.current);
          declaration.current = undefined;
          const segmentAvant = dernierSegment.current;
          const positionAvant = videoRef.current!.currentTime;
          // Relancer les téléchargements en place conserve les segments déjà décodables.
          hlsRef.current?.startLoad(positionAvant, true);
          let faite = false;
          try {
            faite = await relever();
            if (!faite && !annule) {
              const candidats = adressesRef.current.map((s, index) => ({ s: recente(s), index }))
                .filter(({ s }) => cleSource(s) !== cleSource(entree)
                  && !muettesRef.current.has(s.url))
                // Une source en retrait reste un dernier secours si les autres ont disparu.
                .sort((a, b) => Number((reposSources.current.get(cleSource(a.s)) ?? 0) > Date.now())
                  - Number((reposSources.current.get(cleSource(b.s)) ?? 0) > Date.now())).slice(0, 2);
              for (const { s, index } of candidats) {
                if (annule || videoRef.current?.paused) break;
                if (dernierSegment.current > segmentAvant && tamponDevant(videoRef.current!) > 15) break;
                faite = await relever(s, index);
                if (faite) break;
                reposSources.current.set(cleSource(s), Date.now() + 30_000);
              }
            }
          } catch {
            for (const releve of relevesEnCours) releve.destroy();
            relevesEnCours.clear();
          }
          if (!annule && !faite) {
            // Si le téléchargement a repris entre-temps, garder le tampon à l'écran.
            if (dernierSegment.current <= segmentAvant || tamponDevant(videoRef.current!) < 1) {
              setMessage(`Reprise de la source (${reprises.current}/${REPRISES_MAX})…`);
              await new Promise((resoudre) => window.setTimeout(resoudre, ATTENTES_REPRISE_MS[Math.max(0, reprises.current - 1)]));
              if (!annule && !videoRef.current?.paused
                && (tamponDevant(videoRef.current!) <= 3 || videoRef.current!.currentTime === positionAvant)) {
                if (rangRef.current !== rang) setRang(rangRef.current);
                else setOuverture((valeur) => valeur + 1);
              }
            }
          }
          repriseEnPreparation = false;
        };

        renouvelerLecture.current = async () => {
          if (renouvellementEnCours || Date.now() - dernierRenouvellement < 30_000) return;
          renouvellementEnCours = true;
          dernierRenouvellement = Date.now();
          try {
            const details = await api.chaineLive(chaine.id);
            if (annule) return;
            for (const s of details.sources) actualisees.current.set(s.identifiant ?? s.url, {
              ...s, relais: s.relais ?? null, hauteur: s.hauteur ?? null, debit: s.debit ?? null,
              empreinte: s.empreinte ?? s.url,
            });
            if (conversionActive.current || adresseLecture(recente(entree)) === source || repriseEnPreparation || videoRef.current?.paused) return;
            repriseEnPreparation = true;
            try { await relever(); } finally { repriseEnPreparation = false; }
          } finally { renouvellementEnCours = false; }
        };

        // Seule la lecture à l'écran décide : une relève qui échoue en préparation ne touche à rien.
        const surErreurDe = (instance: Hls) => (_evenement: unknown, donnees: ErrorData) => {
          if (annule || hlsRef.current !== instance || compatEnCours) return;
          if (conversionActive.current && donnees.fatal && donnees.response?.code === 404) {
            const cle = cleSource(entree);
            const conversion = conversions.current.get(cle);
            conversions.current.delete(cle);
            if (conversion) void api.arreterConversionLive(conversion.id).catch(() => undefined);
            if (Date.now() - (renouvellementsCompat.current.get(cle) ?? 0) < 30_000) { suivante(); return; }
            renouvellementsCompat.current.set(cle, Date.now());
            essaisCompat.current.delete(cle);
            demandesCompat.current.add(cle);
            setOuverture((v) => v + 1);
            return;
          }
          const problemeFormat = /manifestParsingError|manifestIncompatibleCodecsError|bufferAddCodecError/.test(donnees.details);
          if ((problemeFormat || (donnees.fatal && donnees.type === HlsClass.ErrorTypes.MEDIA_ERROR && reparations >= 2))
            && !conversionActive.current && !essaisCompat.current.has(cleSource(entree))) {
            compatEnCours = true;
            void (async () => {
              try {
                const analyse = await api.analyserSourceLive(chaine.id, entree.url, lectureCompat.current);
                if (annule) return;
                if (analyse.format === "inconnu") { suivante(); return; }
                demandesCompat.current.add(cleSource(entree));
                setOuverture((v) => v + 1);
              } catch { if (!annule) suivante(); }
              finally { compatEnCours = false; }
            })();
            return;
          }
          if (lienDirectARenouveler(donnees.response?.code, source, window.location.origin)) {
            if (renouvellementEnCours) return;
            if (Date.now() - dernierRenouvellement >= 30_000) {
              void renouvelerLecture.current().catch(() => undefined).finally(() => {
                if (!annule && donnees.fatal && hlsRef.current === instance && !repriseEnPreparation) void recuperer();
              });
              return;
            }
          }
          /*
           * Le blocage du tampon n'est pas une panne, c'est un avertissement.
           *
           * Il arrive et se répare seul. Mais trois fois en deux minutes, il dit que cette source ne
           * tient pas la cadence à laquelle on la lit — et la réponse n'est pas d'en changer, c'est
           * de **reculer**. Deux segments de plus derrière le bord, soit une quinzaine de secondes,
           * pris dans les 37 s de marge que la fenêtre médiane laisse. On le paie une fois, et
           * l'image tient.
           */
          if (donnees.details === HlsClass.ErrorDetails.BUFFER_STALLED_ERROR) {
            const maintenant = Date.now();
            // Ce qui recharge pendant le répit vient de nous : une ouverture, un saut, un recul.
            if (maintenant < silenceJusqua.current) return;
            incidents.current += 1;
            /*
             * **Les deux réactions n'ont pas le même prix, elles n'ont donc pas la même patience.**
             *
             * Alléger le débit ne coûte que de la finesse d'image, et seulement le temps du mauvais
             * passage : c'est presque invisible, ça répare la plupart des bégaiements, et ça doit donc
             * arriver **vite** — trois rechargements suffisent, rafale comprise. Changer de source
             * coupe l'image : cela reste un dernier mot, et se mérite.
             *
             * Le seuil qui séparait les deux était `liveSyncDurationCount < 5`, c'est-à-dire « ai-je
             * encore du retard à acheter ». La marge étant désormais maximale d'emblée, la question
             * n'a plus de sens ; celle qui la remplace est « ai-je encore de la qualité à céder », et
             * `autoLevelCapping` y répond : −1 tant qu'on n'a rien cédé, 0 quand on est au plus bas.
             */
            const compter = () => {
              blocages.current = [...blocages.current, maintenant]
                .filter((instant) => maintenant - instant < MEMOIRE_BLOCAGES_MS);
              return blocages.current.length >= BLOCAGES_AVANT_RECUL;
            };

            if ((instance.levels?.length ?? 0) > 1 && instance.autoLevelCapping !== 0) {
              if (!compter()) return;
              reagirALInstabilite.current();
              return;
            }

            /*
             * Le second comptage n'accepte que des incidents **espacés d'au moins dix secondes** : un
             * mauvais passage de vingt secondes produit six rechargements d'affilée, et les compter
             * séparément abandonnait une chaîne qui fonctionne pour une minute difficile.
             *
             * Reculer n'a pas suffi — relevé sur TF1, dont la première adresse sautait de partout
             * alors qu'elle répondait très bien —, mais une source qui bégaie se regarde encore : le
             * repli reste un dernier mot, jamais avant une minute passée dessus.
             */
            const dernier = blocages.current[blocages.current.length - 1] ?? 0;
            if (maintenant - dernier < INTERVALLE_MIN_BLOCAGE_MS) return;
            if (!compter()) return;
            if (maintenant - depuisSource.current < TEMPS_MIN_SUR_SOURCE_MS) return;
            reagirALInstabilite.current();
            return;
          }
          if (!donnees.fatal) {
            if (fluxDeclareStable.current && donnees.type === HlsClass.ErrorTypes.NETWORK_ERROR
              && tamponDevant(videoRef.current!) < 20) void recuperer();
            return;
          }
          /*
           * Réparer avant d'abandonner.
           *
           * Une erreur fatale de **média** est un segment que le décodeur refuse : elle se répare sur
           * place, et hls.js a la manœuvre pour cela. Changer de source à la première occurrence
           * coupait l'image pendant plusieurs secondes pour un incident qui en dure une — et
           * inscrivait au passage un échec dans le classement d'une adresse qui marche.
           *
           * Deux tentatives, pas plus : la seconde échange les codecs audio, et si cela ne suffit
           * pas, la source est bien en cause.
           */
          if (donnees.type === HlsClass.ErrorTypes.NETWORK_ERROR && !fluxDeclareStable.current
            && cheminRef.current === "direct" && entree.relais && !donnees.response?.code) { suivante(); return; }
          if (donnees.type === HlsClass.ErrorTypes.MEDIA_ERROR && fluxDeclareStable.current && tamponDevant(videoRef.current!) > 3) {
            dernierIncident.current = "Décodage interrompu";
            void recuperer(); return;
          }
          if (donnees.type === HlsClass.ErrorTypes.MEDIA_ERROR && reparations < 2) {
            reparations += 1;
            if (reparations > 1) instance.swapAudioCodec();
            instance.recoverMediaError();
            return;
          }
          dernierIncident.current = `${donnees.type} (${donnees.details})`;
          if (fluxDeclareStable.current || tamponDevant(videoRef.current!) > 0) { void recuperer(); return; }
          instance.destroy();
          hlsRef.current = null;
          suivante();
        };
        hls.on(HlsClass.Events.ERROR, surErreurDe(hls));
      } else if (natif) {
        // Le lecteur natif conserve sa réserve pendant la préparation silencieuse d'une relève.
        const places = new Set<HTMLVideoElement>();
        const debutProgramme = (video: HTMLVideoElement): number | null => {
          const date = (video as HTMLVideoElement & { getStartDate?: () => Date }).getStartDate?.();
          return date && Number.isFinite(date.getTime()) ? date.getTime() / 1000 : null;
        };
        const attendre = () => new Promise((resolve) => window.setTimeout(resolve, 100));
        const preparer = async (renouvellement = false) => {
          if (annule || repriseEnPreparation || Date.now() - derniereReprise < 10_000) return;
          const principal = videoRef.current;
          if (!principal || (principal.paused && !principal.error)) return;
          repriseEnPreparation = true; derniereReprise = Date.now();
          const autre = videos.current[ecranRef.current === 0 ? 1 : 0];
          if (!autre) { repriseEnPreparation = false; return; }
          try {
            const candidats = [{ s: recente(entree), index: rangRef.current },
              ...adressesRef.current.map((s, index) => ({ s: recente(s), index }))
                .filter(({ index }) => index !== rangRef.current).slice(0, 2)];
            for (const { s: cible, index } of candidats) {
              if (annule || (principal.paused && !principal.error)) return;
              places.delete(autre);
              autre.muted = true; autre.src = adresseLecture(cible); autre.load();
              void autre.play().catch(() => undefined);
              const limite = Date.now() + 8_000;
              while (!annule && !autre.error && (autre.readyState < 2 || tamponDevant(autre) < 6) && Date.now() < limite) await attendre();
              if (annule) return;
              if (autre.error || autre.readyState < 2 || tamponDevant(autre) < 6) continue;
              const a = debutProgramme(principal), b = debutProgramme(autre);
              if (a !== null && b !== null) {
                const cibleTemps = a + principal.currentTime - b;
                if (!Array.from({ length: autre.buffered.length }, (_, i) => i)
                  .some((i) => cibleTemps >= autre.buffered.start(i) && cibleTemps + 3 < autre.buffered.end(i))) continue;
                autre.currentTime = cibleTemps;
              } else {
                const limiteReserve = Date.now() + 30_000;
                while (!annule && tamponDevant(principal) > 3 && Date.now() < limiteReserve) {
                  if (!renouvellement && tamponDevant(principal) >= 25) return;
                  await attendre();
                }
                if (tamponDevant(principal) > 3) continue;
              }
              const limiteSeek = Date.now() + 2_000;
              while (!annule && autre.seeking && Date.now() < limiteSeek) await attendre();
              if (annule || autre.seeking || autre.readyState < 2 || tamponDevant(autre) < 3 || (principal.paused && !principal.error)) return;
              if (autre.seekable.length && autre.seekable.end(autre.seekable.length - 1) - autre.currentTime > 60) continue;
              autre.volume = principal.volume; autre.muted = principal.muted;
              principal.muted = true; principal.pause();
              if (cleSource(cible) !== cleSource(entree)) {
                void rapporter(chaine.id, recente(entree).url, false).catch(() => undefined);
                fluxDeclareStable.current = false;
                window.clearTimeout(declaration.current); declaration.current = undefined;
                depuisSource.current = Date.now();
              }
              entree = cible; source = adresseLecture(cible); essai.current = cible.url;
              conversionActive.current = conversions.current.has(cleSource(cible));
              cheminRef.current = source === cible.relais || source.includes("/api/live/relais?") ? "relais" : "direct";
              rangRef.current = index; setRangAffiche(index);
              ecranRef.current = ecranRef.current === 0 ? 1 : 0;
              videoRef.current = autre; setEcran(ecranRef.current);
              principal.removeAttribute("src"); principal.load();
              dernierIncident.current = renouvellement ? "Lien renouvelé" : "Source native reprise";
              silenceJusqua.current = Date.now() + 4_000;
              depuisLecture.current = 0; stableDepuis.current = 0; dernierSegment.current = Date.now();
              reussi();
              return;
            }
            if (!annule && tamponDevant(principal) < 1) suivante();
          } finally {
            repriseEnPreparation = false;
            if (!annule && videoRef.current !== autre) { autre.pause(); autre.removeAttribute("src"); autre.load(); }
          }
        };
        renouvelerLecture.current = async () => {
          if (annule || renouvellementEnCours || Date.now() - dernierRenouvellement < 30_000) return;
          renouvellementEnCours = true; dernierRenouvellement = Date.now();
          try {
            const details = await api.chaineLive(chaine.id);
            if (annule) return;
            for (const s of details.sources) actualisees.current.set(s.identifiant ?? s.url, {
              ...s, relais: s.relais ?? null, hauteur: s.hauteur ?? null, debit: s.debit ?? null, empreinte: s.empreinte ?? s.url });
            if (adresseLecture(recente(entree)) !== source) await preparer(true);
          } finally { renouvellementEnCours = false; }
        };
        reagirALInstabilite.current = () => {
          void renouvelerLecture.current().catch(() => undefined).finally(() => { void preparer(); });
        };
        for (const video of videos.current) {
          if (!video) continue;
          // Les refs React peuvent déjà être nulles au démontage : conserver le nœud à libérer.
          nettoyerNatif.push(() => { video.pause(); video.removeAttribute("src"); video.load(); });
          const placer = () => {
            if (!places.has(video) && video.seekable.length) {
              places.add(video);
              const debut = video.seekable.start(0), fin = video.seekable.end(video.seekable.length - 1);
              const cible = Math.min(55, calculerAvance(fin - debut, SEGMENT_TYPE_S, entree.echecs > 0));
              avanceVisee.current = cible;
              video.currentTime = Math.max(debut, fin - cible);
            }
          };
          const progres = () => { placer(); if (video === videoRef.current) dernierSegment.current = Date.now(); };
          const joue = () => { if (video === videoRef.current) reussi(); };
          const erreur = () => { if (video === videoRef.current) reagirALInstabilite.current(); };
          for (const [event, callback] of [["progress", progres], ["playing", joue], ["error", erreur], ["loadedmetadata", placer]] as const) {
            video.addEventListener(event, callback);
            nettoyerNatif.push(() => video.removeEventListener(event, callback));
          }
        }
        element.src = source;
        void element.play().catch(() => undefined);
      } else {
        setMessage("Ce navigateur ne sait pas lire un flux en direct.");
        setEchec(true);
      }
    })();

    return () => {
      annule = true;
      for (const nettoyer of nettoyerNatif) nettoyer();
      lectureAvance.current = () => {};
      reagirALInstabilite.current = () => {};
      renouvelerLecture.current = async () => {};
      window.clearTimeout(declaration.current);
      declaration.current = undefined;
      depuisLecture.current = 0;
      window.clearTimeout(minuteur);
      window.clearTimeout(demarrage);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      for (const releve of relevesEnCours) releve.destroy();
      relevesEnCours.clear();
      const cachee = videos.current[ecranRef.current === 0 ? 1 : 0];
      if (cachee?.getAttribute("src")) { cachee.removeAttribute("src"); cachee.load(); }
    };
  }, [adresses, chaine.id, echec, ouverture, parRelais, rang, suivante]);

  useEffect(() => {
    const renouveler = () => { void renouvelerLecture.current().catch(() => undefined); };
    const timer = window.setInterval(renouveler, 15 * 60_000);
    window.addEventListener("online", renouveler);
    return () => { window.clearInterval(timer); window.removeEventListener("online", renouveler); };
  }, [chaine.id]);

  /**
   * Ce que la fenêtre publiée laisse voir, relevé quatre fois par seconde.
   *
   * `seekable` est la seule source de vérité : c'est ce que l'hébergeur publie encore, et cela varie
   * d'une chaîne à l'autre du simple au deux-cent-quarantième — 61 s de médiane, quatre heures pour
   * Arte. La barre s'en sert telle quelle plutôt que d'inventer une échelle qui promettrait un retour
   * en arrière inexistant.
   */
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    let derniereImage = { temps: element.currentTime, instant: Date.now() };
    let dernierCompteur = imagesPresentees(element);
    let dernierJournal = 0;
    const relever = () => {
      /*
       * L'image avance-t-elle encore ? C'est la seule question qui distingue un bégaiement d'un arrêt.
       *
       * `paused` ne suffit pas : un flux qui recharge sans fin n'est pas en pause, il est bloqué. On
       * regarde donc le temps de lecture lui-même, qui ne ment pas.
       */
      const maintenant = Date.now();
      const images = imagesPresentees(element);
      const progression = element.currentTime !== derniereImage.temps &&
        (images === null || images !== dernierCompteur || (trame.current.element === element && maintenant - trame.current.instant < 1_000));
      if (images !== null) dernierCompteur = images;
      if (!element.paused && progression) lectureAvance.current();
      if (element.paused || maintenant - derniereImage.instant > 1_000) {
        depuisLecture.current = 0;
        window.clearTimeout(declaration.current);
        declaration.current = undefined;
      }
      if (element.paused || progression || document.hidden) {
        derniereImage = { temps: element.currentTime, instant: maintenant };
      } else if (maintenant > silenceJusqua.current && maintenant - derniereImage.instant > IMAGE_FIGEE_MS) {
        derniereImage = { temps: element.currentTime, instant: maintenant };
        dernierIncident.current = "Image figée";
        reagirALInstabilite.current();
      }
      /*
       * **Le tampon, surveillé en permanence — c'est ici que se joue « ne jamais arriver au bout ».**
       *
       * Tout le reste du lecteur est réactif : on attend le bégaiement, l'image figée, l'erreur. Ce
       * relevé-ci regarde ce qui **descend**, et agit pendant qu'il reste du temps. Un tampon qui fond
       * se voit dix secondes à l'avance ; dix secondes suffisent à changer de variante, alors qu'à
       * zéro il ne reste plus qu'à réparer.
       */
      const courant = hlsRef.current;
      if (courant && !element.paused) {
        let devant = 0;
        for (let index = 0; index < element.buffered.length; index += 1) {
          if (element.buffered.start(index) <= element.currentTime + 0.5
            && element.buffered.end(index) > element.currentTime) {
            devant = element.buffered.end(index) - element.currentTime;
            break;
          }
        }
        const segmentS = courant.levels?.[courant.currentLevel]?.details?.targetduration ?? SEGMENT_TYPE_S;
        if (fluxDeclareStable.current && doitPreparerSecours(devant, maintenant - dernierSegment.current, segmentS)) {
          reagirALInstabilite.current();
        }
        const niveaux = courant.levels?.length ?? 0;
        if (niveaux > 1) {
          const plafond = courant.autoLevelCapping;
          const vise = qualiteContinue.current.ajuster(devant, niveaux, plafond, courant.currentLevel, maintenant);
          if (vise !== plafond) { courant.autoLevelCapping = vise; if (vise >= 0) courant.nextAutoLevel = vise; }
        }
      }
      if (element.paused || maintenant - derniereImage.instant > 1_000) stableDepuis.current = 0;
      else {
        if (!stableDepuis.current) stableDepuis.current = maintenant;
        if (maintenant - stableDepuis.current >= 120_000 && essai.current) {
          stableDepuis.current = maintenant;
          void rapporter(chaine.id, essai.current, true, 120).catch(() => undefined);
        }
      }

      if (!element.seekable.length) { setFenetre(null); return; }
      const debut = element.seekable.start(0);
      const fin = element.seekable.end(element.seekable.length - 1);

      /*
       * **La latence visée est recalculée sur la fenêtre réelle, en permanence.**
       *
       * Elle valait 3 segments — 24 s — pour toutes les chaînes, et n'était agrandie qu'après trois
       * bégaiements. On rechargeait donc la sécurité au moment où l'on arrivait au bout. Elle est
       * maintenant prise **dès que la fenêtre est connue**, c'est-à-dire dans les premières secondes,
       * et vaut tout ce que la chaîne peut offrir : sa fenêtre moins la marge arrière, plafonnée au
       * décalage qu'on s'autorise. Sur la fenêtre médiane, 40 s au lieu de 24.
       *
       * On n'écrit que si la valeur change : hls.js relit sa configuration à chaque segment, et la
       * réécrire quatre fois par seconde le ferait dériver sans cesse vers une cible qui bouge.
       */
      {
        const segment = Math.round(
          courant?.levels?.[courant.currentLevel]?.details?.targetduration ?? SEGMENT_TYPE_S,
        );
        /*
         * **La fenêtre a toujours le dernier mot.**
         *
         * La première version posait un plancher de trois segments — 24 s — *par-dessus* ce que la
         * fenêtre permet. Sur une chaîne à fenêtre courte, le plancher gagnait et plaçait le point de
         * lecture derrière le bord arrière : mesuré, une fenêtre de 20 s donnait **−4 s de marge**,
         * c'est-à-dire hors de la fenêtre dès la première seconde. C'est précisément la panne que la
         * r13 avait supprimée, réintroduite par un `Math.max` mal placé. Android y échappait, sa
         * cible étant bornée par `minOffsetMs`/`maxOffsetMs` — d'où « ça marche sur la télé, pas sur
         * le web ».
         *
         * L'ordre est donc : ce que la fenêtre permet, relevé à un plancher qui évite de se coller au
         * direct, puis **rabattu dans la fenêtre** avec un segment de garde. Le plancher ne peut plus
         * pousser dehors, il ne peut que remonter vers le bord.
         */
        /*
         * **Et la fiabilité fixe le plafond.** Une source qui a déjà calé depuis qu'on la regarde, ou
         * que le serveur connaît pour ses échecs, vise jusqu'à 60 s au lieu de 40 : c'est le temps
         * que la reprise se donne pour agir avant que le tampon ne s'épuise.
         */
        const fragile = incidents.current > 0 || (adressesRef.current[rangRef.current]?.echecs ?? 0) > 0;
        const cible = Math.min(55, calculerAvance(fin - debut, segment, fragile));
        avanceVisee.current = cible;
        if (courant) courant.config.liveSyncDuration = cible;
      }

      element.playbackRate = vitesseContinue(fin - element.currentTime, avanceVisee.current,
        tamponDevant(element), reculManuel.current || element.paused || document.hidden);
      if (maintenant - dernierJournal >= 5_000) {
        dernierJournal = maintenant;
        journal.current.noter(rangRef.current + 1, tamponDevant(element), fin - element.currentTime,
          dernierIncident.current ?? "Lecture", {
            identifiant: adressesRef.current[rangRef.current]?.identifiant,
            chemin: conversionActive.current ? "compatibilite" : cheminRef.current,
            codecs: courant ? [courant.levels[courant.currentLevel]?.videoCodec, courant.levels[courant.currentLevel]?.audioCodec].filter(Boolean).join(" / ") : "natif",
            imagesPerdues: element.getVideoPlaybackQuality?.().droppedVideoFrames,
          });
      }
      const releve = { debut, fin, position: element.currentTime, enPause: element.paused, avance: avanceVisee.current };
      fenetreRef.current = releve;
      setFenetre(releve);

      /*
       * **Le bord arrière approche : on rattrape sans le dire.**
       *
       * Le saut au direct existe déjà, mais il se voit — l'image bondit. Ici on agit **avant**, quand
       * il reste encore de la marge, et de la seule manière qui ne se remarque pas : en laissant le
       * rattrapage de hls.js faire son travail, et en ne le contrariant plus. Un saut ne subsiste que
       * si la marge tombe sous un segment, c'est-à-dire quand il n'y a plus rien à négocier.
       */
      if (!element.paused && fin - debut > FENETRE_MINIMALE_S) {
        const marge = releve.position - debut;
        if (!reculManuel.current && ((marge > 0 && marge < Math.min(SEGMENT_TYPE_S, (fin - debut) / 4)) || fin - releve.position > AVANCE_FRAGILE_S)) {
          silenceJusqua.current = Date.now() + 4_000;
          // Revenir à l'avance visée, pas au bord : c'est la marge qui empêche la prochaine coupure.
          element.currentTime = Math.max(debut, fin - avanceVisee.current);
        }
      }
    };
    const minuteur = window.setInterval(relever, 250);
    return () => window.clearInterval(minuteur);
  }, [adresses, ecran, rang]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let rappel = 0;
    const image = () => {
      trame.current = { element: video, instant: Date.now() };
      rappel = video.requestVideoFrameCallback(image);
    };
    if (typeof video.requestVideoFrameCallback === "function") rappel = video.requestVideoFrameCallback(image);
    const retour = () => {
      if (document.hidden) return;
      trame.current = { element: video, instant: Date.now() };
      silenceJusqua.current = Date.now() + 4_000;
      void renouvelerLecture.current().catch(() => undefined);
      if (!video.paused && tamponDevant(video) < 1) reagirALInstabilite.current();
    };
    document.addEventListener("visibilitychange", retour);
    window.addEventListener("pageshow", retour);
    return () => {
      if (rappel) video.cancelVideoFrameCallback?.(rappel);
      document.removeEventListener("visibilitychange", retour);
      window.removeEventListener("pageshow", retour);
    };
  }, [ecran, chaine.id]);

  const auDirect = !fenetre || fenetre.fin - fenetre.position <= fenetre.avance + MARGE_DIRECT_S;
  const largeurFenetre = fenetre ? fenetre.fin - fenetre.debut : 0;
  const barreUtile = largeurFenetre >= FENETRE_MINIMALE_S;

  /**
   * Revenir au direct — c'est-à-dire à l'avance visée, et non au bord.
   *
   * Le bord exact ne laisse devant soi que le segment en cours de publication : une seconde de réseau
   * suffit à figer l'image. Revenir à l'avance visée garde la marge qui l'en protège.
   */
  const rejoindreDirect = useCallback(() => {
    const element = videoRef.current;
    if (!element?.seekable.length) return;
    silenceJusqua.current = Date.now() + 4_000;
    const debut = element.seekable.start(0);
    const fin = element.seekable.end(element.seekable.length - 1);
    reculManuel.current = false;
    element.currentTime = Math.max(debut + 2, fin - Math.max(1, avanceVisee.current));
    void element.play().catch(() => undefined);
  }, []);

  /**
   * Reculer ou avancer dans la fenêtre.
   *
   * Le début est écarté de deux secondes : c'est le bord que l'hébergeur va retirer d'une seconde à
   * l'autre, et s'y coller garantit d'en tomber. La fin l'est d'une seconde, pour la même raison
   * dans l'autre sens.
   */
  const sauter = useCallback((secondes: number) => {
    const element = videoRef.current;
    if (!element?.seekable.length) return;
    silenceJusqua.current = Date.now() + 4_000;
    const debut = element.seekable.start(0) + 2;
    const fin = element.seekable.end(element.seekable.length - 1) - 1;
    reculManuel.current = true;
    element.playbackRate = 1;
    element.currentTime = Math.min(fin, Math.max(debut, element.currentTime + secondes));
    reveillerCommandes();
  }, [reveillerCommandes]);

  /**
   * Mettre en pause un direct, c'est reculer dans la fenêtre.
   *
   * Rien ne s'arrête à la source : le flux continue d'avancer pendant qu'on regarde une image fixe,
   * et l'on dérive vers l'arrière de la fenêtre. Sur 92 % des chaînes mesurées, elle fait entre 30 s
   * et 2 min : une pause d'une minute passe, une pause de cinq ne passe pas. Plutôt que d'interdire,
   * on laisse faire et **on rattrape** — l'effet ci-dessous rejoint le direct avant que le
   * navigateur ne tombe sur du vide, ce qui aurait figé l'image sans rien dire.
   */
  const basculerPause = useCallback(() => {
    const element = videoRef.current;
    if (!element) return;
    silenceJusqua.current = Date.now() + 4_000;
    if (element.paused) void element.play().catch(() => undefined);
    else element.pause();
    reveillerCommandes();
  }, [reveillerCommandes]);

  useEffect(() => {
    if (!fenetre || !barreUtile) return;
    /*
     * Pas pendant l'ouverture : tant que hls.js n'a pas posé le point de lecture, la vidéo est à zéro
     * alors que la fenêtre est déjà connue, et l'on croirait être tombé au fond de la fenêtre.
     */
    if (Date.now() - depuisSource.current < 5_000 || fenetre.position <= 0) return;
    // Deux segments de marge : au-delà, l'hébergeur retire le segment qu'on est en train de lire.
    if (fenetre.position >= fenetre.debut + FENETRE_MINIMALE_S) return;
    rejoindreDirect();
    setMessage("Fin de la fenêtre : retour au direct.");
    const oubli = window.setTimeout(() => setMessage(null), 4_000);
    return () => window.clearTimeout(oubli);
  }, [barreUtile, fenetre, rejoindreDirect]);

  /**
   * La barre s'efface après une accalmie, et revient au moindre geste. En pause, elle reste.
   *
   * **La position ne figure pas dans les dépendances**, et c'est tout le correctif : elle est relevée
   * quatre fois par seconde, l'effet repartait donc toutes les 250 ms et remettait sa minuterie à
   * zéro. La barre ne s'effaçait jamais — vérifié à l'écran, cinq secondes après le dernier geste
   * elle était toujours là. Ce qui doit la rappeler, ce sont les gestes, et ils passent tous par
   * `setBarreVisible`.
   */
  const enPause = fenetre?.enPause ?? false;
  useEffect(() => {
    if (!barreVisible || choixOuvert || enPause) return;
    const oubli = window.setInterval(() => {
      if (Date.now() - dernierGeste.current < REPOS_BARRE_MS) return;
      setDiagnosticOuvert(false);
      setBarreVisible(false);
    }, 250);
    return () => window.clearInterval(oubli);
  }, [barreVisible, choixOuvert, enPause]);

  useEffect(() => {
    const auClavier = (evenement: KeyboardEvent) => {
      reveillerCommandes();
      if (evenement.key === "Escape") { onClose(); return; }
      /*
       * Le clavier reprend, touche pour touche, ce que la télécommande fait sur Android TV : les
       * flèches horizontales reculent et avancent dans la fenêtre, l'espace met en pause, `D` rejoint
       * le direct. Une seule chose lui est propre — `P` pour la chaîne précédente, qui n'a pas
       * d'équivalent naturel au clavier.
       */
      if (evenement.key === "ArrowLeft") { evenement.preventDefault(); sauter(-SAUT_S); return; }
      if (evenement.key === "ArrowRight") { evenement.preventDefault(); sauter(SAUT_S); return; }
      if (evenement.key === " " || evenement.key === "k") { evenement.preventDefault(); basculerPause(); return; }
      if (evenement.key.toLowerCase() === "d") { rejoindreDirect(); return; }
      if (evenement.key.toLowerCase() === "p" && precedente) onChaine(precedente);
    };
    window.addEventListener("keydown", auClavier);
    return () => window.removeEventListener("keydown", auClavier);
  }, [basculerPause, onChaine, onClose, precedente, rejoindreDirect, sauter, reveillerCommandes]);

  const sources = adresses.length;
  useEffect(() => {
    if (!diagnosticOuvert) return;
    const relever = () => {
      const video = videoRef.current;
      if (!video) return;
      const hauteur = video.videoHeight;
      setDiagnostic({ tampon: Math.round(tamponDevant(video)),
        retard: video.seekable.length ? Math.max(0, Math.round(video.seekable.end(video.seekable.length - 1) - video.currentTime)) : 0,
        source: rangRef.current + 1, mode: hlsRef.current ? "HLS" : "HLS natif",
        incident: dernierIncident.current || "Aucun", qualite: hauteur ? `${hauteur}p` : "Automatique" });
    };
    relever(); const timer = window.setInterval(relever, 1_000);
    return () => window.clearInterval(timer);
  }, [diagnosticOuvert]);
  const groupesDeSources = regrouperLesSources(adresses, muettes);
  const avance = fenetre && largeurFenetre > 0
    ? Math.min(100, Math.max(0, (fenetre.position - fenetre.debut) / largeurFenetre * 100))
    : 100;

  useSurfaceDiffusion({
    etat: () => { const v = videoRef.current; return { contenu: { genre: "direct", id: chaine.id, titre: chaine.nom },
      lecture: !v || v.readyState < 2 ? "chargement" : v.paused ? "pause" : "lecture",
      position: 0, duree: 0, volume: v?.volume ?? 1, navigation: false, erreur: null }; },
    commander: async (c) => { const v = videoRef.current; if (!v) throw new Error("Lecteur en préparation");
      if (c.type === "pause") v.pause(); else if (c.type === "reprendre") await v.play();
      else if (c.type === "volume") v.volume = c.valeur; else if (c.type === "arreter") onClose();
      else throw new Error("Déplacement distant indisponible pour le direct");
    },
  });
  return <div className={`lecteur-direct${barreVisible ? " commandes" : ""}`}
    role="dialog" aria-modal="true" aria-label={`Chaîne ${chaine.nom}`}
    onPointerMove={reveillerCommandes} onPointerDownCapture={reveillerCommandes} onFocusCapture={reveillerCommandes}>
    {/*
      * Deux vidéos, une seule à l'écran : l'autre ne sert qu'à la relève silencieuse, qui prépare une
      * seconde lecture cachée de la même chaîne et prend la place de la première sans que l'image bouge.
      */}
    <video ref={brancherVideo0} autoPlay={false} playsInline muted={ecran !== 0} className={ecran === 0 ? undefined : "lecteur-direct-releve"}
      onClick={basculerPause} onPause={() => { if (ecranRef.current === 0) setBarreVisible(true); }} />
    <video ref={brancherVideo1} autoPlay={false} playsInline muted={ecran !== 1} className={ecran === 1 ? undefined : "lecteur-direct-releve"}
      onClick={basculerPause} onPause={() => { if (ecranRef.current === 1) setBarreVisible(true); }} />
    <div className="lecteur-direct-barre" inert={!barreVisible} aria-hidden={!barreVisible}>
      <BoutonDiffusion />
      <button type="button" className="player-icon-button" onClick={onClose} aria-label="Fermer">←</button>
      {precedente && <button type="button" className="player-icon-button"
        aria-label={`Revenir à ${precedente.nom}`} title={`Revenir à ${precedente.nom}`}
        onClick={() => onChaine(precedente)}>⇄</button>}
      <div className="lecteur-direct-titre">
        <b>{chaine.numero != null ? `${chaine.numero} · ` : ""}{chaine.nom}</b>
        <small>
          {chaine.groupe ?? "En direct"}
          {/*
            * Le repli se dit, mais discrètement : savoir qu'on est sur la deuxième source explique une
            * qualité différente sans transformer un rattrapage réussi en incident. Cliquable, il
            * devient le moyen d'en changer soi-même.
            */}
          {sources > 1 && <>
            {" · "}
            <button type="button" className="lecteur-direct-sources" aria-expanded={choixOuvert}
              onClick={() => setChoixOuvert((ouvert) => !ouvert)}>
              source {rangAffiche + 1}/{sources} ▾
            </button>
          </>}
          {parRelais ? " · relayée par le serveur" : ""}
          {securite > 0 ? ` · +${securite} s de sécurité` : ""}
        </small>
      </div>
    </div>

    {/*
      * Toutes les sources, sans « voir les autres » : une chaîne regroupée en porte jusqu'à quatre-vingts,
      * la liste défile, et celles que le serveur n'a pas pu joindre ferment la marche.
      */}
    {choixOuvert && <ul className="lecteur-direct-choix" role="listbox" aria-label="Sources de la chaîne">
      {groupesDeSources.map(({ index, source, doublons, muette }, rangAffiche) => (
        <li key={source.empreinte || source.url}>
          <button type="button" role="option" aria-selected={index === rangAffiche}
            className={[index === rangAffiche ? "actif" : "", muette ? "muette" : ""].filter(Boolean).join(" ") || undefined}
            onClick={() => choisirSource(index)}>
            <b>
              Source {rangAffiche + 1}{rangAffiche === 0 && !muette ? " · recommandée" : ""}
              {/* Le compte se dit : savoir qu'une source a trois adresses explique qu'elle tienne mieux. */}
              {doublons > 1 ? ` · ${doublons} adresses` : ""}
            </b>
            <small>
              {index === rangAffiche && parRelais ? "relayée par le serveur" : decrireSource(source)}
              {/* Muette pour le serveur, pas forcément pour ce navigateur : elle reste choisissable. */}
              {muette ? " · ne répond pas" : ""}
            </small>
          </button>
        </li>
      ))}
    </ul>}

    {/*
      * La pause s'affiche **toujours**, la piste seulement quand il y a une fenêtre.
      *
      * Les deux étaient liées, et le bouton disparaissait donc sur les chaînes dont l'hébergeur ne
      * publie presque rien derrière le direct — c'est-à-dire là où l'on veut encore pouvoir mettre en
      * pause. Ce qui n'a pas de sens sans fenêtre, c'est la piste : elle promettrait un retour en
      * arrière qui n'existe pas. Le bouton, lui, en a toujours un.
      */}
    {barreVisible && fenetre && <div className="lecteur-direct-progression">
      <button type="button" className="player-icon-button" onClick={basculerPause}
        aria-label={fenetre.enPause ? "Reprendre" : "Mettre en pause"}>{fenetre.enPause ? "⏵" : "⏸"}</button>
      {barreUtile ? <div className="lecteur-direct-piste" role="slider" aria-label="Position dans la fenêtre du direct"
        aria-valuemin={0} aria-valuemax={Math.round(largeurFenetre)}
        aria-valuenow={Math.round(fenetre.position - fenetre.debut)} tabIndex={0}
        onClick={(evenement) => {
          const cadre = evenement.currentTarget.getBoundingClientRect();
          const part = (evenement.clientX - cadre.left) / cadre.width;
          sauter(fenetre.debut + part * largeurFenetre - fenetre.position);
        }}>
        <i style={{ width: `${avance}%` }} />
      </div> : <span className="lecteur-direct-piste-absente" />}
      <span className="lecteur-direct-retard">
        {auDirect ? "EN DIRECT" : `− ${horodatage(fenetre.fin - fenetre.position)}`}
      </span>
      {!auDirect && barreUtile && <button type="button" className="player-icon-button" onClick={rejoindreDirect}
        aria-label="Revenir au direct" title="Revenir au direct">⏭</button>}
    </div>}

    <details className="lecteur-direct-diagnostic" hidden={!barreVisible} open={diagnosticOuvert}
      onToggle={(event) => setDiagnosticOuvert(event.currentTarget.open)}>
      <summary>Diagnostic de lecture</summary>
      {diagnosticOuvert && <button type="button" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(journal.current.exporter(), null, 2)], { type: "application/json" }));
        const lien = document.createElement("a"); lien.href = url; lien.download = "flixtunes-diagnostic-live.json"; lien.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }}>Exporter le diagnostic</button>}
      {diagnosticOuvert && <dl>
        <dt>Réserve disponible</dt><dd>{diagnostic.tampon} s</dd>
        <dt>Retard sur le direct</dt><dd>{diagnostic.retard} s</dd>
        <dt>Source</dt><dd>{diagnostic.source}/{sources}</dd>
        <dt>Qualité</dt><dd>{diagnostic.qualite} · {diagnostic.mode}{conversionActive.current ? " · compatibilité NAS" : ""}</dd>
        <dt>Dernier événement</dt><dd>{diagnostic.incident}</dd>
      </dl>}
    </details>
    {message && <p className={`lecteur-direct-message${echec ? " echec" : ""}`} role="status">{message}</p>}
  </div>;
}
