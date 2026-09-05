import { db } from "./database.js";
import { parseProbeOutput } from "./ffprobe.js";
import { marqueursGenerique } from "./generique.js";
import { enveloppeDuFichier } from "./empreinte-extraction.js";
import { repereParEmpreinte, type RepereSonore } from "./marqueurs-empreinte.js";
import { retenirEcoute, retenirIntroduction } from "./marqueurs-memoire.js";
import type { Attente } from "./empreinte-sonore.js";

/**
 * Repérer l'introduction d'une saison par le son, quand les chapitres ne disent rien.
 *
 * Le thème d'ouverture est le même fichier audio d'un épisode à l'autre : deux épisodes partagent
 * donc une portion identique, et c'est elle qu'on cherche. Ce module orchestre — quels épisodes
 * comparer, avec quelle attente, et quand — pendant que `empreinte-sonore` fait le calcul.
 *
 * **Rien de tout cela ne tourne pendant une lecture.** La passe se déclenche après une analyse de
 * bibliothèque. Un repère absent au lancement d'un épisode reste absent : on ne propose rien plutôt
 * que de faire attendre.
 *
 * ## Trois contraintes tirées de la médiathèque
 *
 * **Les témoins se prennent parmi les épisodes voisins par leur numéro.** L'animation japonaise change
 * souvent d'ouverture tous les vingt ou trente épisodes, parfois sans changer de saison — *Dragon
 * Ball Z* en est l'exemple, et ses sept séries totalisent 826 épisodes sans un seul chapitre nommé.
 * Comparer un épisode à des témoins pris au hasard dans la saison mènerait à des paires sans thème
 * commun.
 *
 * **La fenêtre d'analyse couvre un quart d'heure.** *Silo* S1E9 commence son générique à 809 s.
 * Mesuré sur 1 538 introductions nommées : cinq minutes en couvrent 84,7 %, dix minutes 98,9 %,
 * quinze minutes 100 %.
 *
 * **Les chapitres de la série arbitrent la durée, quand il y en a.** Ils ne sont pas toujours fiables
 * — ceux de *Silo* saison 1 désignent deux passages qui ne partagent aucun son, corrélation −0,20 —
 * mais quand ils le sont, ils valent mieux qu'une déduction.
 */

/**
 * Les fenêtres d'analyse, de la plus courte à la plus longue.
 *
 * Le coût de la comparaison croît avec le **carré** de la fenêtre : chercher sur quinze minutes coûte
 * neuf fois plus que sur cinq. Or cinq minutes suffisent dans la grande majorité des cas — mesuré sur
 * 1 538 introductions nommées, elles en couvrent 84,7 %, contre 98,9 % à dix minutes.
 *
 * On commence donc court, et l'on n'élargit que faute d'avoir trouvé. Éprouvé sur cinq séries :
 *
 * | fenêtre | séries retrouvées | coût par épisode |
 * | --- | --- | --- |
 * | 300 s | 4 sur 5 — seul *Silo* manque, son générique s'ouvrant à 347 s | 789 ms |
 * | 600 s | **5 sur 5** | 3 034 ms |
 *
 * Cette escalade a été ajoutée en r72 après une faute coûteuse : r71 analysait d'emblée quinze
 * minutes, et la passe avançait d'un épisode toutes les quatre-vingt-dix secondes sur le NAS — plus
 * de cent heures pour la médiathèque, là où l'annonce était d'une à cinq. L'estimation ne mesurait
 * que l'extraction audio, et transposait à un Celeron un chiffre relevé sur un poste de travail.
 */
export const FENETRES_ANALYSE_SECONDES = [300, 600, 900] as const;

/** La plus large, pour qui n'a besoin que d'une valeur. */
export const FENETRE_ANALYSE_SECONDES = FENETRES_ANALYSE_SECONDES[FENETRES_ANALYSE_SECONDES.length - 1];

/**
 * Nombre de témoins comparés à chaque épisode.
 *
 * Quatre, et le chiffre vient d'une mesure : sur *The Office*, deux paires seulement s'accordent sur
 * quatre essayées — les deux autres ne trouvent rien, les prologues n'ayant pas la même longueur.
 * Avec trois témoins, la série tombait sous le quorum de deux paires et n'était **pas** repérée,
 * alors que l'algorithme la trouve parfaitement. Le défaut ne se voyait que sur les séries dont le
 * générique est court.
 */
export const TEMOINS_PAR_EPISODE = 4;

/**
 * Échecs complets d'affilée après lesquels on cesse d'élargir la fenêtre, dans cette saison.
 *
 * Trois : assez pour qu'un épisode atypique — récapitulatif, pilote, double épisode — ne condamne pas
 * la saison à lui seul, et assez peu pour que le gain soit réel. Une saison de vingt épisodes sans
 * thème commun passe de vingt escalades complètes à trois.
 */
export const ESSAIS_AVANT_RENONCEMENT = 3;

/** Écart toléré autour d'une durée connue par les chapitres. */
const TOLERANCE_DUREE = 8;

interface LigneEpisode {
  id: string;
  episode_number: number | null;
  file_path: string;
  runtime_seconds: number | null;
  embedded_metadata_json: string | null;
  /** Date de la dernière écoute, `null` si l'épisode n'a jamais été entendu. */
  ecoute_le: string | null;
  /** Début d'introduction déjà connu, quelle qu'en soit la source. */
  intro_start_seconds: number | null;
  /** Date de la seconde écoute, `null` tant qu'elle n'a pas eu lieu : elle n'a lieu qu'une fois. */
  reecoute_le: string | null;
  /** D'où vient l'introduction connue : « empreinte » prouve que la saison a un thème. */
  source_intro: string | null;
}

export interface BilanSon {
  /** Épisodes qu'il fallait repérer. */
  aRepérer: number;
  /** Épisodes qui ont reçu un repère. */
  reperes: number;
  /** Fichiers dont l'audio n'a pas pu être lu. */
  illisibles: number;
}

/** L'introduction que les chapitres d'un épisode annoncent, s'ils en annoncent une. */
function introDesChapitres(ligne: LigneEpisode): { debut: number; fin: number } | null {
  if (!ligne.embedded_metadata_json) return null;
  try {
    const metadonnees = parseProbeOutput(JSON.parse(ligne.embedded_metadata_json));
    const marqueurs = marqueursGenerique(metadonnees.chapters, metadonnees.durationSeconds ?? ligne.runtime_seconds);
    return marqueurs.intro ? { debut: marqueurs.intro.startSeconds, fin: marqueurs.intro.endSeconds } : null;
  } catch { return null; }
}

/**
 * La durée que les chapitres de la série attribuent à son introduction.
 *
 * Prise sur toute la série et non sur la seule saison : une saison muette emprunte ainsi à ses
 * voisines. La médiane protège d'un chapitre isolé mal placé.
 */
function dureeAttendue(showTitle: string): number | null {
  const lignes = db.prepare(`SELECT id, episode_number, file_path, runtime_seconds, embedded_metadata_json
    FROM media_items WHERE kind = 'episode' AND available = 1 AND show_title = ? LIMIT 300`)
    .all(showTitle) as unknown as LigneEpisode[];
  const durees = lignes.map(introDesChapitres)
    .filter((intro): intro is { debut: number; fin: number } => intro != null)
    .map((intro) => intro.fin - intro.debut)
    .sort((a, b) => a - b);
  if (durees.length < 2) return null;
  const milieu = Math.floor(durees.length / 2);
  const mediane = durees.length % 2 === 1 ? durees[milieu] ?? 0
    : ((durees[milieu - 1] ?? 0) + (durees[milieu] ?? 0)) / 2;
  return mediane > 0 ? mediane : null;
}

/**
 * Les témoins d'un épisode : ses voisins immédiats par le numéro.
 *
 * L'ordre compte et il est celui de la diffusion. Un épisode pris au milieu d'une saison a des
 * voisins des deux côtés ; le premier et le dernier n'en ont que d'un côté, et c'est très bien.
 */
export function choisirTemoins<T>(episodes: T[], index: number, combien = TEMOINS_PAR_EPISODE): T[] {
  const temoins: T[] = [];
  for (let distance = 1; temoins.length < combien && distance < episodes.length; distance += 1) {
    for (const candidat of [index - distance, index + distance]) {
      if (candidat < 0 || candidat >= episodes.length || temoins.length >= combien) continue;
      const episode = episodes[candidat];
      if (episode !== undefined) temoins.push(episode);
    }
  }
  return temoins;
}

/**
 * Repère par le son les introductions d'une saison, pour les épisodes qui n'en ont pas.
 *
 * `lireEnveloppe` est injectable pour que la logique se vérifie sans médiathèque : le choix des
 * témoins, l'attente de durée et l'écriture en base se testent alors sur des signaux fabriqués.
 */
export async function completerSaisonParLeSon(showTitle: string, season: number | null,
  options: {
    lireEnveloppe?: (chemin: string, dureeSecondes: number) => Promise<Float64Array | null>;
    signal?: AbortSignal;
  } = {}): Promise<BilanSon> {
  const lireEnveloppe = options.lireEnveloppe
    ?? ((chemin: string, secondes: number) => enveloppeDuFichier(chemin, { debutSecondes: 0, dureeSecondes: secondes }));

  const episodes = db.prepare(`SELECT m.id, m.episode_number, m.file_path, m.runtime_seconds,
      m.embedded_metadata_json, g.ecoute_le, g.reecoute_le, g.source_intro, g.intro_start_seconds
    FROM media_items m
    LEFT JOIN marqueurs_generique g ON g.media_id = m.id
    WHERE m.kind = 'episode' AND m.available = 1 AND m.show_title = ?
      AND (m.season_number IS ? OR m.season_number = ?) AND m.file_path IS NOT NULL
    ORDER BY m.episode_number`)
    .all(showTitle, season, season) as unknown as LigneEpisode[];

  const bilan: BilanSon = { aRepérer: 0, reperes: 0, illisibles: 0 };
  if (episodes.length < 2) return bilan;

  /*
   * Ce qu'il reste à faire, et pourquoi c'est plus étroit que la saison.
   *
   * Trois familles d'épisodes n'ont rien à recevoir : ceux que leurs propres chapitres renseignent,
   * ceux qui ont déjà une introduction — d'où qu'elle vienne — et ceux qu'on a **déjà écoutés**,
   * même bredouilles. Aucun n'est retiré de `episodes` pour autant : ce sont d'excellents témoins,
   * et les écarter appauvrirait la comparaison de ceux qui restent.
   *
   * Sans ce filtre, une saison qui revient dans la file pour deux épisodes ajoutés se réécoutait
   * **en entier**. Le coût d'un ajout n'était pas celui de l'ajout mais celui de la saison, ce qui
   * contredit la promesse de tout le dispositif — on n'écoute jamais deux fois. Et la seconde écoute
   * ne travaillant pas sur les mêmes témoins que la première, elle pouvait **remplacer un repère
   * juste par un moins bon** : `remplace` accepte une source de rang égal, donc « empreinte »
   * l'emporte sur « empreinte ». Du gaspillage devenu régression silencieuse.
   *
   * Le prédicat est volontairement le même que celui de `saisonsIncompletes` : ce qui met une saison
   * dans la file et ce qu'on y fait doivent désigner exactement les mêmes épisodes.
   */
  // Le thème de cette saison a-t-il déjà été reconnu ? C'est ce qui autorise une seconde écoute.
  const themeProuve = episodes.some((episode) => episode.source_intro === "empreinte");
  const reecoutes: string[] = [];
  const aTraiter: Array<{ episode: LigneEpisode; index: number }> = [];
  for (const [index, episode] of episodes.entries()) {
    const chapitres = introDesChapitres(episode);
    if (chapitres != null) {
      /*
       * Le repère du fichier se recopie en base, et seulement pour la file.
       *
       * Les chapitres ne s'y rangeaient pas — ils se relisent du fichier, ce qui reste vrai. Mais la
       * file, elle, ne consulte que la base : n'y voyant rien, elle concluait qu'il restait tout à
       * faire, et une saison entièrement chapitrée **ne la quittait jamais**. Elle y revenait à
       * chaque analyse pour n'y rien faire, et surtout elle empêchait le compteur d'avancement
       * d'atteindre son terme — 44 % des épisodes sont chapitrés.
       *
       * La copie ne sert donc qu'à cela. Le lecteur continue de lire les chapitres du fichier, et
       * ignore délibérément cette copie : voir `getPlaybackInfo`, où un repère de provenance
       * « chapitre » n'est jamais servi. C'est ce qui la rend inoffensive si le fichier change.
       */
      if (episode.intro_start_seconds == null) {
        retenirIntroduction(episode.id, chapitres.debut, chapitres.fin, "chapitre");
      }
      continue;
    }
    if (episode.intro_start_seconds != null) continue;
    /*
     * Déjà écouté : on ne recommence qu'une fois, et seulement si le thème de cette saison a été
     * reconnu ailleurs. Les témoins sont alors bien meilleurs qu'au premier passage — plusieurs
     * portent désormais un repère —, ce qui donne à cette reprise une vraie chance d'aboutir là où
     * la première a échoué.
     */
    if (episode.ecoute_le != null) {
      if (!themeProuve || episode.reecoute_le != null) continue;
      reecoutes.push(episode.id);
    }
    aTraiter.push({ episode, index });
  }
  bilan.aRepérer = aTraiter.length;
  if (!aTraiter.length) return bilan;

  const duree = dureeAttendue(showTitle);
  const attente: Attente | null = duree != null ? { dureeSecondes: duree, toleranceSecondes: TOLERANCE_DUREE } : null;

  /*
   * Les enveloppes se gardent le temps de la passe, et pas plus.
   *
   * Un épisode sert de témoin à plusieurs de ses voisins : les redécoder à chaque fois multiplierait
   * le coût par trois. Une saison de vingt-cinq épisodes tient dans moins de deux mégaoctets — mais
   * rien de tout cela ne va en base, où plusieurs centaines de mégaoctets seraient rangés pour une
   * donnée qui se recalcule en trois secondes.
   */
  const cache = new Map<string, Float64Array | null>();
  const enveloppe = async (episode: LigneEpisode, secondes: number): Promise<Float64Array | null> => {
    const cle = `${episode.id}:${secondes}`;
    const connue = cache.get(cle);
    if (connue !== undefined) return connue;
    const calculee = await lireEnveloppe(episode.file_path, secondes);
    cache.set(cle, calculee);
    return calculee;
  };

  /*
   * L'escalade se décide au niveau de la **saison**, non de l'épisode.
   *
   * L'escalade posée en r72 accélère les succès et alourdit les échecs : trouver à cinq minutes coûte
   * une unité, ne rien trouver du tout en coûte quatorze — trois extractions et trois comparaisons
   * dont la dernière est neuf fois plus chère que la première. Or, mesuré en service sur 388 épisodes
   * écoutés, **la moitié ne trouve rien** (188 repérés, 200 bredouilles). La moyenne est donc dominée
   * par le cas cher, et la passe restait à trente heures.
   *
   * Après [ESSAIS_AVANT_RENONCEMENT] échecs complets d'affilée, la saison est tenue pour dépourvue de
   * thème commun et l'on cesse d'élargir. **On continue de l'écouter**, à la fenêtre courte : c'est ce
   * qui rend la mesure sûre. Renoncer à écouter aurait condamné toute une saison sur trois épisodes
   * atypiques — un récapitulatif, un pilote, un double épisode — sans espoir de rattrapage, l'écoute
   * n'étant notée qu'une fois.
   *
   * Et la soupape : **le premier épisode qui trouve quelque chose rouvre l'escalade**. Un thème existe,
   * donc la saison en vaut la peine.
   */
  let echecsConsecutifs = 0;

  for (const { episode, index } of aTraiter) {
    if (options.signal?.aborted) break;
    // On note tout de suite l'écoute — et, s'il s'agit de la seconde, qu'elle a eu lieu : un arrêt
    // en cours de passe ne doit pas donner droit à une troisième.
    retenirEcoute(episode.id, reecoutes.includes(episode.id));
    let repere: RepereSonore | null = null;
    let illisible = false;
    const fenetres = echecsConsecutifs >= ESSAIS_AVANT_RENONCEMENT
      ? FENETRES_ANALYSE_SECONDES.slice(0, 1) : FENETRES_ANALYSE_SECONDES;
    // Court d'abord, large ensuite : la grande majorité des génériques tient dans les cinq premières
    // minutes, et n'analyser que celles-là coûte neuf fois moins.
    for (const secondes of fenetres) {
      if (options.signal?.aborted) break;
      const reference = await enveloppe(episode, secondes);
      if (!reference) { illisible = true; break; }
      const temoins: Float64Array[] = [];
      for (const voisin of choisirTemoins(episodes, index)) {
        const envVoisin = await enveloppe(voisin, secondes);
        if (envVoisin) temoins.push(envVoisin);
      }
      repere = repereParEmpreinte(reference, temoins, attente);
      if (repere) break;
    }
    if (illisible) { bilan.illisibles += 1; continue; }
    // Un succès rouvre l'escalade pour le reste de la saison ; un échec rapproche du renoncement.
    echecsConsecutifs = repere ? 0 : echecsConsecutifs + 1;
    if (!repere) continue;
    // Quand les chapitres de la série donnent une durée, elle fait foi : le son déborde volontiers
    // de quelques secondes sur ce qui entoure le générique.
    const fin = duree != null ? repere.debutSecondes + duree : repere.finSecondes;
    if (retenirIntroduction(episode.id, repere.debutSecondes, fin, "empreinte")) bilan.reperes += 1;
  }
  return bilan;
}
