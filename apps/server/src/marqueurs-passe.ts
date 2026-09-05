import { db } from "./database.js";
import { completerToutesLesSaisons } from "./marqueurs-saison.js";
import { completerSaisonParLeSon } from "./marqueurs-son.js";

/**
 * L'ordre dans lequel les génériques se cherchent, et ce que chaque étape coûte.
 *
 * Trois sources, de la plus sûre à la plus laborieuse, et chacune ne travaille que sur ce que la
 * précédente n'a pas su donner :
 *
 * | | source | coût | ce qu'elle couvre |
 * | --- | --- | --- | --- |
 * | 1 | les chapitres du fichier | nul, relu à chaque ouverture | 44 % des épisodes |
 * | 2 | les voisins de saison | nul, aucun fichier lu | +8 points, soit 52 % |
 * | 3 | l'empreinte sonore | 2 à 3 s par épisode, une fois | le reste, quand un thème existe |
 *
 * **Aucune n'a lieu pendant une lecture.** Un repère absent au lancement d'un épisode reste absent :
 * on ne propose rien plutôt que de faire attendre.
 *
 * La troisième est la seule qui décode quoi que ce soit, et elle s'efface devant une lecture en
 * cours : le NAS de référence est un Celeron à quatre cœurs, où une conversion HDR occupe déjà la
 * machine entière.
 */

/**
 * Où en est le repérage, pour qui regarde l'écran.
 *
 * Une passe qui ne dit rien pendant des heures se confond avec un blocage. Mais un compteur qui
 * repart de zéro à chaque démarrage du service s'y confond tout autant — et c'est ce que r72
 * affichait : après une nuit de travail et quarante-trois saisons acquises, l'écran annonçait
 * « 0 saison sur 434 ». Le travail était intact, la présentation mentait.
 *
 * **L'avancement affiché est donc lu en base, pas compté en mémoire.** Il survit aux redémarrages,
 * parce que le travail y survit. Seul ce qui n'a de sens que pendant une passe — la saison en cours
 * d'écoute, l'heure de démarrage — reste en mémoire.
 */
export interface EtatPasse {
  /** Le repérage automatique est-il autorisé ? Éteint tant qu'on ne l'a pas demandé. */
  actif: boolean;
  enCours: boolean;
  /** Saisons déjà traitées, depuis toujours. */
  saisonsFaites: number;
  /** Saisons concernées au total, traitées ou non. */
  saisonsTotal: number;
  /** Épisodes écoutés, depuis toujours. */
  episodesEcoutes: number;
  /** Introductions trouvées par le son, depuis toujours. */
  trouves: number;
  /** Série et saison en cours d'écoute, pour que l'attente ait un nom. `null` hors passe. */
  saisonCourante: string | null;
  debuteLe: string | null;
  /**
   * Ce que la passe en cours a fait depuis son démarrage.
   *
   * Les deux chiffres répondent à deux questions différentes, et l'une ne remplace pas l'autre :
   * l'avancement global dit **où en est le travail**, celui de la passe dit **si ça avance en ce
   * moment**. Une passe à zéro saison depuis dix minutes signale un blocage que le total, lui, ne
   * montrerait pas.
   */
  passe: { saisonsFaites: number; trouves: number } | null;
}

/**
 * L'interrupteur du repérage, et pourquoi il est éteint au départ.
 *
 * La passe sonore décode. Sur le Celeron à quatre cœurs du NAS de référence, elle occupe des heures
 * de machine pour un confort — sauter un générique — dont tout le monde ne veut pas. Une fonction qui
 * coûte cela ne s'impose pas : **elle s'active**.
 *
 * Le réglage vit en base, donc il survit aux redémarrages, comme le travail qu'il commande. Et
 * la désactiver arrête la passe en cours au lieu d'attendre qu'elle finisse : c'est le seul
 * comportement cohérent avec la raison qu'on a de la désactiver, qui est de vouloir sa machine.
 */
const CLE_ACTIVATION = "generiques_actifs";

export function generiquesActifs(): boolean {
  const ligne = db.prepare("SELECT value FROM server_settings WHERE key = ?")
    .get(CLE_ACTIVATION) as unknown as { value: string } | undefined;
  return ligne?.value === "1";
}

export function activerLesGeneriques(actif: boolean): EtatPasse {
  db.prepare(`INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
    .run(CLE_ACTIVATION, actif ? "1" : "0");
  // Arrêt net : la passe en cours ne va pas au bout de ses quatre cents saisons parce qu'elle avait
  // commencé. Elle s'interrompt à la fin de l'épisode qu'elle écoute, soit deux à trois secondes.
  if (!actif) arreterLaPasse();
  return etatDesGeneriques();
}

/**
 * Arrêter la passe en cours **sans** désactiver le repérage.
 *
 * Deux gestes différents, et c'est voulu : désactiver dit « je ne veux pas de cette fonction », arrêter
 * dit « pas maintenant ». Le second laisse le réglage intact, donc la prochaine analyse reprendra le
 * travail là où il en est — rien n'est perdu, puisque l'avancement vit en base.
 */
export function arreterLaPasse(): EtatPasse {
  interruption?.abort();
  return etatDesGeneriques();
}

/** Ce qui n'a de sens que pendant une passe : le reste se lit en base. */
let interruption: AbortController | null = null;
let enCours = false;
let saisonCourante: string | null = null;
let debuteLe: string | null = null;
let saisonsDeLaPasse = 0;
let trouvesDeLaPasse = 0;

/** Saisons éligibles au repérage sonore, qu'elles soient traitées ou non. */
function saisonsEligibles(): number {
  const ligne = db.prepare(`
    SELECT COUNT(*) AS total FROM (
      SELECT m.show_title, m.season_number
      FROM media_items m
      WHERE m.kind = 'episode' AND m.available = 1 AND m.show_title IS NOT NULL AND m.file_path IS NOT NULL
      GROUP BY m.show_title, m.season_number
      HAVING COUNT(*) >= 2)`)
    .get() as unknown as { total: number } | undefined;
  return ligne?.total ?? 0;
}

export function etatDesGeneriques(): EtatPasse {
  const restantes = saisonsIncompletes().length;
  const total = saisonsEligibles();
  const compte = (condition: string): number => {
    const ligne = db.prepare(`SELECT COUNT(*) AS total FROM marqueurs_generique WHERE ${condition}`)
      .get() as unknown as { total: number } | undefined;
    return ligne?.total ?? 0;
  };
  return {
    actif: generiquesActifs(),
    enCours,
    saisonsFaites: Math.max(0, total - restantes),
    saisonsTotal: total,
    episodesEcoutes: compte("ecoute_le IS NOT NULL"),
    trouves: compte("source_intro = 'empreinte'"),
    saisonCourante,
    debuteLe,
    passe: enCours ? { saisonsFaites: saisonsDeLaPasse, trouves: trouvesDeLaPasse } : null,
  };
}

export interface BilanPasse {
  /** Épisodes complétés par leurs voisins de saison. */
  parVoisins: number;
  /** Épisodes dont l'introduction a été trouvée par le son. */
  parEmpreinte: number;
  /** Saisons visitées par la passe sonore. */
  saisonsEcoutees: number;
  /** Fichiers dont l'audio n'a pas pu être lu. */
  illisibles: number;
}

/**
 * Les saisons où il reste des introductions à trouver.
 *
 * Une saison dont tous les épisodes ont déjà leur repère — par chapitre ou par déduction — n'a rien à
 * faire dans une passe sonore. Ceux qu'on a déjà écoutés en sont exclus aussi, **même bredouilles** :
 * une série sans thème commun n'en aura pas davantage au prochain scan, et la réécouter serait du
 * décodage pur perdu, répété à chaque analyse.
 *
 * C'est ce double filtre qui rend la passe supportable : elle ne réécoute pas une médiathèque
 * entière, seulement ce qui est nouveau.
 *
 * ## Le dernier épisode restait dehors
 *
 * Deux conditions se ressemblent et ne disent pas la même chose, et la requête confondait les deux :
 *
 * - **« la saison a au moins deux épisodes »** — la vraie contrainte, parce qu'une empreinte sonore se
 *   reconnaît en comparant des épisodes entre eux ; seul, il n'y a rien à comparer ;
 * - **« au moins deux épisodes n'ont pas encore leur repère »** — ce que le `HAVING` appliquait, le
 *   filtre s'exerçant avant le regroupement.
 *
 * Elles coïncident tant qu'une saison est largement incomplète, et divergent exactement à la fin :
 * quand il ne reste **qu'un** épisode sans repère, la saison sortait de la liste et cet épisode
 * n'était plus jamais repris. Constaté sur *Silo* S03E09 — le dernier de la saison, et le seul
 * sans générique.
 *
 * La condition de taille porte donc maintenant sur la saison entière, et celle de travail restant est
 * comptée à part.
 */
function saisonsIncompletes(): Array<{ show_title: string; season_number: number | null }> {
  return db.prepare(`
    SELECT m.show_title, m.season_number
    FROM media_items m
    LEFT JOIN marqueurs_generique g ON g.media_id = m.id
    WHERE m.kind = 'episode' AND m.available = 1 AND m.show_title IS NOT NULL AND m.file_path IS NOT NULL
    GROUP BY m.show_title, m.season_number
    HAVING COUNT(*) >= 2
       AND (
         SUM(CASE WHEN g.intro_start_seconds IS NULL AND g.ecoute_le IS NULL THEN 1 ELSE 0 END) >= 1
         OR (
           /*
            * **La seconde chance d'une saison dont le thème est prouvé.**
            *
            * Un épisode écouté bredouille sortait de la file pour toujours. C'est juste quand la
            * série n'a pas de thème commun ; ça ne l'est pas quand six de ses dix épisodes ont vu
            * le leur reconnu — cas relevé sur *Silo* saison 3. La saison revient donc une fois, et
            * une seule, et seulement si l'empreinte y a déjà réussi au moins une fois.
            */
           SUM(CASE WHEN g.source_intro = 'empreinte' THEN 1 ELSE 0 END) >= 1
           AND SUM(CASE WHEN g.intro_start_seconds IS NULL AND g.reecoute_le IS NULL THEN 1 ELSE 0 END) >= 1
         )
       )`)
    .all() as unknown as Array<{ show_title: string; season_number: number | null }>;
}

/**
 * Complète les repères de génériques, après une analyse de bibliothèque.
 *
 * `ecouter` dit si la passe sonore doit avoir lieu ; `attendreCreneau` laisse la place aux lectures en
 * cours entre deux saisons. Les deux sont injectés pour que l'enchaînement se vérifie sans médiathèque.
 */
export async function completerLesGeneriques(options: {
  ecouter?: boolean;
  signal?: AbortSignal;
  attendreCreneau?: (signal?: AbortSignal) => Promise<void>;
} = {}): Promise<BilanPasse> {
  const bilan: BilanPasse = { parVoisins: 0, parEmpreinte: 0, saisonsEcoutees: 0, illisibles: 0 };

  // 1 et 2 : gratuites, systématiques.
  bilan.parVoisins = completerToutesLesSaisons().deduits;

  // Sans consigne explicite — le cas du service —, c'est l'interrupteur qui décide.
  if (!(options.ecouter ?? generiquesActifs())) return bilan;

  /*
   * Une passe à la fois.
   *
   * Elle pouvait déjà être déclenchée par deux analyses qui finissent ensemble ; elle l'est
   * maintenant aussi par l'interrupteur. Deux passes simultanées se disputeraient les mêmes saisons
   * et le même processeur, et la seconde écraserait l'avancement affiché par la première.
   */
  if (enCours) return bilan;

  // 3 : coûteuse, donc réservée à ce qui manque encore, et effacée devant une lecture.
  const restantes = saisonsIncompletes();
  enCours = true;
  debuteLe = new Date().toISOString();
  saisonsDeLaPasse = 0;
  trouvesDeLaPasse = 0;
  /*
   * Deux façons d'arrêter cette passe, réunies en un seul signal : l'analyse qui l'a lancée peut être
   * annulée, et l'interrupteur peut être éteint. Ce qui décode en dessous n'a pas à connaître les
   * deux — il lui suffit d'un signal qui dit non.
   */
  const arret = new AbortController();
  interruption = arret;
  const relayer = () => arret.abort();
  if (options.signal?.aborted) arret.abort();
  else options.signal?.addEventListener("abort", relayer, { once: true });
  try {
    for (const saison of restantes) {
      if (arret.signal.aborted) break;
      await options.attendreCreneau?.(arret.signal);
      saisonCourante = `${saison.show_title}${saison.season_number != null ? ` — saison ${saison.season_number}` : ""}`;
      const resultat = await completerSaisonParLeSon(saison.show_title, saison.season_number, { signal: arret.signal });
      bilan.saisonsEcoutees += 1;
      bilan.parEmpreinte += resultat.reperes;
      bilan.illisibles += resultat.illisibles;
      saisonsDeLaPasse = bilan.saisonsEcoutees;
      trouvesDeLaPasse = bilan.parEmpreinte;
    }
  } finally {
    options.signal?.removeEventListener("abort", relayer);
    interruption = null;
    enCours = false;
    saisonCourante = null;
  }
  return bilan;
}
