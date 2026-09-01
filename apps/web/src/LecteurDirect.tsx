import { useCallback, useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import type { ChaineDirect } from "@flixtunes/contracts";
import { api } from "./api";
import { courirLesAdresses } from "./course-adresses";

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

/**
 * Le nombre d'adresses que le **repli automatique** essaie avant de renoncer.
 *
 * Il ne borne pas la liste : toutes les adresses restent choisissables à la main. Il borne
 * l'acharnement, ce qui n'est pas la même chose — la coupure à quatre rendait les autres
 * inatteignables **même volontairement**, et sur une chaîne qui en porte douze, huit disparaissaient
 * sans que rien ne le dise. Huit essais de douze secondes font déjà une minute et demie devant un
 * écran noir, et la course a de toute façon mis devant celles qui répondent.
 */
const REPLIS = 8;

/**
 * Combien d'adresses la course sonde à l'ouverture.
 *
 * Toutes, c'était une mauvaise idée : mesuré sur le corpus, 356 chaînes en portent plus de vingt et
 * la pire en a **78**. Autant de requêtes lancées d'un coup pour choisir laquelle ouvrir est un coût
 * que personne n'a demandé. Le serveur les a déjà classées — échecs, définition, débit — : sonder les
 * douze premières suffit à écarter les mortes, et les suivantes gardent leur rang derrière.
 */
const COURSE_MAX = 12;

/**
 * Combien de sources le menu montre avant de proposer le reste.
 *
 * Le regroupement ramenait la pire chaîne du corpus de 78 lignes à 42 — mesuré, et toujours
 * illisible. Or le serveur les a classées par échecs, définition et débit : les huit premières sont
 * les meilleures qu'on connaisse, et celui qui cherche la neuvième sait ce qu'il fait. Le reste est
 * à un geste, pas caché.
 */
const SOURCES_VISIBLES = 8;

/** Une adresse, son doublon relayé et ce que le serveur sait d'elle. */
interface SourceLisible {
  url: string; relais: string | null; hauteur: number | null; debit: number | null;
  /** Ce qui distingue deux adresses pour l'œil : l'hôte et le chemin, sans la requête. */
  empreinte: string;
}

/**
 * Le menu regroupe ce qui se ressemble, la liste garde tout.
 *
 * Mesuré sur le corpus : 7 559 adresses de 1 976 chaînes ne diffèrent de leur voisine que par un
 * jeton dans la requête. Le menu en listait quatre visiblement identiques, et l'on choisissait à
 * l'aveugle. Chaque groupe garde **l'index de son meilleur membre** — celui que le serveur a classé
 * en tête — et le repli automatique, lui, continue de parcourir chaque adresse : deux jetons ne se
 * valent pas, l'un peut être périmé quand l'autre fonctionne.
 */
function regrouperLesSources(adresses: SourceLisible[]): Array<{ index: number; source: SourceLisible; doublons: number }> {
  const groupes = new Map<string, { index: number; source: SourceLisible; doublons: number }>();
  adresses.forEach((source, index) => {
    const cle = source.empreinte || source.url;
    const connu = groupes.get(cle);
    if (connu) { connu.doublons += 1; return; }
    groupes.set(cle, { index, source, doublons: 1 });
  });
  return [...groupes.values()];
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

/** Le direct, c'est le bord à quelques secondes près : au-delà, on est en différé et on le dit. */
const MARGE_DIRECT_S = 12;

/**
 * Ce qu'on refuse de laisser entre le point de lecture et le bord **arrière** de la fenêtre.
 *
 * C'est la marge qui manquait. Reculer coûte du retard, et le retard se prend quelque part : dans la
 * fenêtre, qui n'est pas infinie. Trois bégaiements faisaient reculer de 3 à 5 segments — **40 s
 * derrière le direct** — alors que la fenêtre médiane mesurée fait 61 s. Il restait 21 s ; et sur les
 * 8 % de chaînes dont la fenêtre est plus courte que 40 s, reculer jetait le lecteur **hors de la
 * fenêtre sur-le-champ**. L'image tenait un moment, puis coupait, et relancer réparait — parce que
 * relancer repart au bord.
 *
 * Vingt secondes, soit deux segments et demi : de quoi absorber un rechargement sans se retrouver à
 * demander un segment que l'hébergeur vient de retirer.
 */
const MARGE_ARRIERE_S = 20;

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

function horodatage(secondes: number): string {
  const entier = Math.max(0, Math.round(secondes));
  const minutes = Math.floor(entier / 60);
  return `${minutes}:${String(entier % 60).padStart(2, "0")}`;
}

/** Ce que la barre montre : la fenêtre publiée par la chaîne, et où l'on s'y trouve. */
interface Fenetre { debut: number; fin: number; position: number; enPause: boolean }

export function LecteurDirect({ chaine, precedente, onChaine, onClose }: {
  chaine: ChaineDirect;
  /** La chaîne quittée, ou `null` la première fois. */
  precedente: ChaineDirect | null;
  onChaine: (chaine: ChaineDirect) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
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
  const [choixOuvert, setChoixOuvert] = useState(false);
  /** Le menu s'ouvre court : la suite se demande, et se referme avec lui. */
  const [toutesLesSources, setToutesLesSources] = useState(false);
  /**
   * Le retard de sécurité pris après des blocages répétés, en secondes.
   *
   * Zéro tant que tout va bien : on part **au bord du flux**, parce que c'est ce que « en direct »
   * veut dire, et on ne paie du retard que lorsqu'il est mérité.
   */
  const [securite, setSecurite] = useState(0);
  const blocages = useRef<number[]>([]);
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
    window.clearTimeout(declaration.current);
    declaration.current = undefined;
    return () => window.clearTimeout(declaration.current);
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
          hauteur: source.hauteur ?? null, debit: source.debit ?? null,
          empreinte: source.empreinte ?? source.url,
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
          ...await courirLesAdresses(declarees.slice(0, COURSE_MAX)),
          ...declarees.slice(COURSE_MAX),
        ];
        if (annule) return;
        rangRef.current = 0;
        setRang(0);
        setParRelais(false);
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
    setToutesLesSources(false);
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
    if (!parRelais && courante?.relais) {
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
    if (!fluxDeclareStable.current) void api.resultatChaineLive(chaine.id, morte, false).catch(() => undefined);
    // La déclaration porte sur l'adresse : celle qu'on prend n'a encore rien prouvé.
    window.clearTimeout(declaration.current);
    declaration.current = undefined;
    fluxDeclareStable.current = false;
    depuisLecture.current = 0;
    reprises.current = 0;
    const disponibles = Math.min(adresses.length, REPLIS);
    const prochain = rangRef.current + 1;
    if (prochain >= disponibles) {
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
        window.setTimeout(() => {
          rangRef.current = 0;
          setParRelais(false);
          setRang(0);
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
    rangRef.current = prochain;
    setParRelais(false);
    setMessage(`Source ${prochain + 1} sur ${disponibles}…`);
    setRang(prochain);
  }, [adresses, chaine.id, parRelais]);

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
    setToutesLesSources(false);
    if (index === rangRef.current && !parRelais) return;
    essai.current = null;
    rangRef.current = index;
    setParRelais(false);
    setEchec(false);
    setMessage(`Source ${index + 1}…`);
    setRang(index);
  }, [parRelais]);

  useEffect(() => {
    const element = videoRef.current;
    const entree = adresses[rang];
    if (!element || !entree || echec) return;
    /*
     * Le contenu mixte se voit d'avance, lui : une page HTTPS ne demandera même pas une adresse en
     * `http` nu. Inutile d'attendre un échec que le navigateur annonce déjà — on part relayé.
     */
    const mixte = window.location.protocol === "https:" && entree.url.startsWith("http:");
    const relayer = (parRelais || mixte) && entree.relais;
    const source = relayer ? entree.relais! : entree.url;
    essai.current = entree.url;
    // Ouvrir un flux remplit le tampon : c'est un geste, pas un hoquet.
    silenceJusqua.current = Date.now() + 4_000;
    depuisSource.current = Date.now();
    let annule = false;
    let minuteur = 0;
    let reparations = 0;

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
      if (!fluxDeclareStable.current && declaration.current === undefined) {
        declaration.current = window.setTimeout(() => {
          fluxDeclareStable.current = true;
          dejaVuStable.current = true;
          reprises.current = 0;
          relancesLentes.current = 0;
          /*
           * La tolérance interne se relève **à la déclaration**. hls.js relit sa configuration à
           * chaque chargement, si bien qu'il suffit de l'écrire ici : les reprises silencieuses
           * passent de quelques secondes à une quinzaine, sans avoir ralenti la course d'ouverture.
           */
          const courant = hlsRef.current;
          if (courant) {
            courant.config.levelLoadingMaxRetry = 6;
            courant.config.fragLoadingMaxRetry = 6;
            courant.config.manifestLoadingMaxRetry = 4;
          }
        }, SEUIL_STABILITE_MS);
      }
      // C'est l'adresse d'origine qu'on note, jamais celle du relais : le classement porte sur la
      // source, et le relais n'est qu'un chemin pour y aller.
      void api.resultatChaineLive(chaine.id, entree.url, true).catch(() => undefined);
    };

    void (async () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      /*
       * Un direct qui ne démarre pas ne le dit pas toujours : un hébergeur peut accepter la connexion
       * puis ne rien envoyer. Sans cette échéance, la chaîne resterait noire indéfiniment au lieu de
       * basculer sur son secours.
       */
      minuteur = window.setTimeout(() => { if (!annule) suivante(); }, 12_000);

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
          enableWorker: true, lowLatencyMode: false, backBufferLength: 60,
          maxBufferLength: 30, liveSyncDurationCount: 3, capLevelToPlayerSize: false,
          maxLiveSyncPlaybackRate: RATTRAPAGE_MAX,
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
          blocages.current = [];
          /*
           * **Reculer, mais jamais plus loin que la fenêtre ne le permet.**
           *
           * Le recul était fixe : cinq segments, quelle que soit la chaîne. Sur la fenêtre médiane il
           * laissait 21 s de marge ; sur une fenêtre de 30 s il plaçait le point de lecture derrière
           * le bord arrière, c'est-à-dire dans le vide. On calcule donc le recul que cette chaîne-ci
           * peut payer, et l'on ne recule pas si elle ne peut rien payer du tout — mieux vaut une
           * source un peu instable qu'une source qu'on vient de faire sortir de sa propre fenêtre.
           */
          const segment = Math.round(hls.levels[hls.currentLevel]?.details?.targetduration ?? SEGMENT_TYPE_S);
          const largeur = fenetreRef.current ? fenetreRef.current.fin - fenetreRef.current.debut : 0;
          const segmentsPayables = largeur > 0
            ? Math.floor((largeur - MARGE_ARRIERE_S) / segment)
            : 5;
          const vise = Math.min(5, segmentsPayables);
          if (vise > hls.config.liveSyncDurationCount) {
            const gagnes = vise - hls.config.liveSyncDurationCount;
            hls.config.liveSyncDurationCount = vise;
            silenceJusqua.current = Date.now() + REPIT_APRES_RECUL_MS;
            setSecurite(gagnes * segment);
            return;
          }
          if (rangRef.current + 1 >= Math.min(adresses.length, REPLIS)) return;
          /*
           * Elle n'est **pas** rapportée comme morte : elle ne l'est pas. Inscrire un échec pour une
           * source qui répond fausserait le classement avec une opinion.
           */
          const prochain = rangRef.current + 1;
          essai.current = null;
          rangRef.current = prochain;
          setSecurite(0);
          setParRelais(false);
          setMessage(`Source instable, passage à la ${prochain + 1}…`);
          setRang(prochain);
        };
        hls.loadSource(source);
        hls.attachMedia(element);
        hls.on(HlsClass.Events.MANIFEST_PARSED, () => { void element.play().catch(() => undefined); });
        hls.on(HlsClass.Events.FRAG_BUFFERED, reussi);
        hls.on(HlsClass.Events.ERROR, (_evenement, donnees) => {
          if (annule) return;
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
            /*
             * **Les deux réactions n'ont pas le même prix, elles n'ont donc pas la même patience.**
             *
             * Reculer ne coûte que du retard : c'est invisible, ça répare la plupart des bégaiements,
             * et ça doit donc arriver **vite** — trois rechargements suffisent, rafale comprise.
             * Changer de source coupe l'image : cela reste un dernier mot, et se mérite.
             */
            const compter = () => {
              blocages.current = [...blocages.current, maintenant]
                .filter((instant) => maintenant - instant < MEMOIRE_BLOCAGES_MS);
              return blocages.current.length >= BLOCAGES_AVANT_RECUL;
            };

            if (hls.config.liveSyncDurationCount < 5) {
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
          if (!donnees.fatal) return;
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
          if (donnees.type === HlsClass.ErrorTypes.MEDIA_ERROR && reparations < 2) {
            reparations += 1;
            if (reparations > 1) hls.swapAudioCodec();
            hls.recoverMediaError();
            return;
          }
          /*
           * **Réessayer la même adresse avant de l'abandonner.**
           *
           * Ce qui se trouvait ici affirmait le contraire — « la source est en panne, et la suivante
           * est déjà connue ». L'observation la dément : relancer la même adresse répare
           * instantanément. Ce qui meurt, c'est la session en cours, pas la source.
           *
           * `startLoad` reprend le chargement sur le lecteur existant, sans le détruire : le décodeur
           * reste en place, et la reprise coûte le remplissage du tampon au lieu d'une reconstruction
           * complète.
           */
          if (fluxDeclareStable.current && reprises.current < REPRISES_MAX) {
            reprises.current += 1;
            dernierIncident.current = `réseau (${donnees.details})`;
            if (reprises.current > 1) {
              setMessage(`Reprise de la source (${reprises.current}/${REPRISES_MAX})…`);
            }
            window.setTimeout(() => {
              if (annule) return;
              hlsRef.current?.startLoad();
            }, ATTENTES_REPRISE_MS[reprises.current - 1]);
            return;
          }
          hls.destroy();
          hlsRef.current = null;
          suivante();
        });
      } else if (natif) {
        // Safari lit HLS nativement, et n'a alors besoin ni de MediaSource ni de CORS.
        element.src = source;
        element.addEventListener("playing", reussi, { once: true });
        element.addEventListener("error", () => { if (!annule) suivante(); }, { once: true });
        void element.play().catch(() => undefined);
      } else {
        setMessage("Ce navigateur ne sait pas lire un flux en direct.");
        setEchec(true);
      }
    })();

    return () => {
      annule = true;
      window.clearTimeout(minuteur);
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [adresses, chaine.id, echec, parRelais, rang, suivante]);

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
    const relever = () => {
      /*
       * L'image avance-t-elle encore ? C'est la seule question qui distingue un bégaiement d'un arrêt.
       *
       * `paused` ne suffit pas : un flux qui recharge sans fin n'est pas en pause, il est bloqué. On
       * regarde donc le temps de lecture lui-même, qui ne ment pas.
       */
      const maintenant = Date.now();
      if (element.paused || element.currentTime !== derniereImage.temps) {
        derniereImage = { temps: element.currentTime, instant: maintenant };
      } else if (maintenant - derniereImage.instant > IMAGE_FIGEE_MS) {
        derniereImage = { temps: element.currentTime, instant: maintenant };
        reagirALInstabilite.current();
      }
      if (!element.seekable.length) { setFenetre(null); return; }
      const debut = element.seekable.start(0);
      const fin = element.seekable.end(element.seekable.length - 1);
      const releve = { debut, fin, position: element.currentTime, enPause: element.paused };
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
        if (marge > 0 && marge < SEGMENT_TYPE_S) {
          silenceJusqua.current = Date.now() + 4_000;
          element.currentTime = fin - MARGE_DIRECT_S;
        }
      }
    };
    const minuteur = window.setInterval(relever, 250);
    return () => window.clearInterval(minuteur);
  }, [adresses, rang]);

  const auDirect = !fenetre || fenetre.fin - fenetre.position <= MARGE_DIRECT_S;
  const largeurFenetre = fenetre ? fenetre.fin - fenetre.debut : 0;
  const barreUtile = largeurFenetre >= FENETRE_MINIMALE_S;

  /** Revenir au bord du flux — la seule position qui mérite le mot « direct ». */
  const rejoindreDirect = useCallback(() => {
    const element = videoRef.current;
    if (!element?.seekable.length) return;
    silenceJusqua.current = Date.now() + 4_000;
    element.currentTime = element.seekable.end(element.seekable.length - 1) - 1;
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
    element.currentTime = Math.min(fin, Math.max(debut, element.currentTime + secondes));
    setBarreVisible(true);
  }, []);

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
    setBarreVisible(true);
  }, []);

  useEffect(() => {
    if (!fenetre || !barreUtile) return;
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
    const oubli = window.setTimeout(() => setBarreVisible(false), REPOS_BARRE_MS);
    return () => window.clearTimeout(oubli);
  }, [barreVisible, choixOuvert, enPause]);

  useEffect(() => {
    const auClavier = (evenement: KeyboardEvent) => {
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
  }, [basculerPause, onChaine, onClose, precedente, rejoindreDirect, sauter]);

  const sources = adresses.length;
  const groupesDeSources = regrouperLesSources(adresses);
  const avance = fenetre && largeurFenetre > 0
    ? Math.min(100, Math.max(0, (fenetre.position - fenetre.debut) / largeurFenetre * 100))
    : 100;

  return <div className={`lecteur-direct${barreVisible ? " commandes" : ""}`}
    role="dialog" aria-modal="true" aria-label={`Chaîne ${chaine.nom}`}
    onMouseMove={() => setBarreVisible(true)}>
    <video ref={videoRef} autoPlay playsInline muted={false}
      onClick={basculerPause} onPause={() => setBarreVisible(true)} />
    <div className="lecteur-direct-barre">
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
              source {rang + 1}/{sources} ▾
            </button>
          </>}
          {parRelais ? " · relayée par le serveur" : ""}
          {securite > 0 ? ` · +${securite} s de sécurité` : ""}
        </small>
      </div>
    </div>

    {choixOuvert && <ul className="lecteur-direct-choix" role="listbox" aria-label="Sources de la chaîne">
      {(toutesLesSources ? groupesDeSources : groupesDeSources.slice(0, SOURCES_VISIBLES))
        .map(({ index, source, doublons }, rangAffiche) => (
        <li key={source.empreinte || source.url}>
          <button type="button" role="option" aria-selected={index === rang}
            className={index === rang ? "actif" : undefined} onClick={() => choisirSource(index)}>
            <b>
              Source {rangAffiche + 1}{rangAffiche === 0 ? " · recommandée" : ""}
              {/* Le compte se dit : savoir qu'une source a trois adresses explique qu'elle tienne mieux. */}
              {doublons > 1 ? ` · ${doublons} adresses` : ""}
            </b>
            <small>{index === rang && parRelais ? "relayée par le serveur" : decrireSource(source)}</small>
          </button>
        </li>
      ))}
      {!toutesLesSources && groupesDeSources.length > SOURCES_VISIBLES && <li>
        <button type="button" onClick={() => setToutesLesSources(true)}>
          <b>Voir les {groupesDeSources.length - SOURCES_VISIBLES} autres</b>
          <small>classées après les huit meilleures</small>
        </button>
      </li>}
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

    {message && <p className={`lecteur-direct-message${echec ? " echec" : ""}`} role="status">{message}</p>}
  </div>;
}
