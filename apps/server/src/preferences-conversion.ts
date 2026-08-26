import { config } from "./config.js";
import { getSetting, setSetting } from "./database.js";

/**
 * Les réglages de conversion, modifiables sans redémarrer ni ouvrir un terminal.
 *
 * Ils n'existaient que sous forme de variables d'environnement — `FLIXTUNES_HW_ACCEL`,
 * `FLIXTUNES_TONEMAP` — écrites dans un fichier que seul un accès SSH permet d'atteindre. Le réglage
 * était donc théorique : personne ne pouvait forcer un chemin pour comparer, ni revenir en arrière
 * après un essai malheureux.
 *
 * Le principe reste que **l'automatique doit suffire** : il s'appuie sur des mesures faites sur la
 * machine, et le cas courant ne demande aucun réglage. Le mode expert n'ajoute pas un passage obligé,
 * il ouvre ce qui était fermé — voir ce que la mesure a trouvé, et la contredire quand on a une raison.
 *
 * La variable d'environnement reste la valeur par défaut : une installation qui la pose garde son
 * comportement tant que personne n'a choisi autre chose depuis l'interface.
 */
export interface PreferencesConversion {
  /** Ouvre les réglages détaillés dans l'interface. N'a aucun effet sur la conversion elle-même. */
  expert: boolean;
  /** `auto`, ou un accélérateur imposé : `software`, `vaapi`, `qsv`, `nvenc`, `amf`, `v4l2m2m`. */
  accelerateur: string;
  /** `auto`, ou un chemin imposé : `libplacebo`, `vaapi`, `opencl`, `zscale`, `software`. */
  toneMapping: string;
  /** `auto`, `h264` ou `hevc`. */
  codecSortie: string;
  /** `auto`, ou une hauteur imposée : `2160`, `1440`, `1080`, `720`. */
  resolutionMax: string;
  /**
   * Plafond de conversions simultanées : `auto`, ou un entier imposé.
   *
   * `auto` ne vaut pas une constante : il vaut ce que le micro-banc mesure sur **cette** machine. Un
   * NAS plus faible obtient donc un plafond plus bas sans que personne ait à connaître son matériel,
   * et celui-ci obtient les sept conversions qu'il soutient au lieu des deux qu'un défaut écrit en dur
   * lui accordait.
   */
  conversionsSimultanees: number | "auto";
}

const CLE = "conversion.preferences";

const ACCELERATEURS = ["auto", "software", "vaapi", "qsv", "nvenc", "amf", "v4l2m2m"];
const TONE_MAPPINGS = ["auto", "libplacebo", "vaapi", "opencl", "zscale", "software"];
const CODECS = ["auto", "h264", "hevc"];
const RESOLUTIONS = ["auto", "2160", "1440", "1080", "720"];

let cache: PreferencesConversion | null = null;

function defauts(): PreferencesConversion {
  return {
    expert: false,
    accelerateur: config.hardwareAcceleration,
    toneMapping: config.toneMapping,
    codecSortie: config.videoOutputCodec,
    resolutionMax: config.maxOutputHeight,
    conversionsSimultanees: config.transcodeConcurrency ?? "auto",
  };
}

/**
 * Un entier borné, ou `auto`.
 *
 * `valide()` ne sait traiter que des chaînes d'une liste close, et la route qui reçoit ces réglages ne
 * passe par aucun schéma. Sans ce contrôle, `0` fermerait toute lecture sur le serveur et `NaN` — dont
 * chaque comparaison est fausse — **lèverait le plafond entièrement**.
 */
function nombreOuAuto(valeur: unknown, defaut: number | "auto"): number | "auto" {
  if (valeur === "auto") return "auto";
  const nombre = Number(valeur);
  if (!Number.isFinite(nombre) || !Number.isInteger(nombre)) return defaut;
  if (nombre < 1 || nombre > 16) return defaut;
  return nombre;
}

/**
 * Une valeur hors liste est ramenée à `auto` plutôt que transmise.
 *
 * Elle finirait sinon dans une commande FFmpeg, qui la refuserait au démarrage de la session : la
 * lecture échouerait au lieu de simplement ignorer un réglage devenu invalide — cas d'un réglage
 * enregistré puis retiré par une mise à jour.
 */
function valide(valeur: unknown, permises: string[], defaut: string): string {
  return typeof valeur === "string" && permises.includes(valeur) ? valeur : defaut;
}

export function preferencesConversion(): PreferencesConversion {
  if (cache) return cache;
  const base = defauts();
  const stored = getSetting(CLE);
  if (!stored) { cache = base; return cache; }
  try {
    const parsed = JSON.parse(stored) as Partial<PreferencesConversion>;
    cache = {
      expert: parsed.expert === true,
      accelerateur: valide(parsed.accelerateur, ACCELERATEURS, base.accelerateur),
      toneMapping: valide(parsed.toneMapping, TONE_MAPPINGS, base.toneMapping),
      codecSortie: valide(parsed.codecSortie, CODECS, base.codecSortie),
      resolutionMax: valide(parsed.resolutionMax, RESOLUTIONS, base.resolutionMax),
      conversionsSimultanees: nombreOuAuto(parsed.conversionsSimultanees, base.conversionsSimultanees),
    };
  } catch {
    // Réglages illisibles : on repart des valeurs d'environnement plutôt que d'échouer au démarrage.
    cache = base;
  }
  return cache;
}

export function definirPreferencesConversion(demande: Partial<PreferencesConversion>): PreferencesConversion {
  const actuel = preferencesConversion();
  const suivant: PreferencesConversion = {
    expert: demande.expert ?? actuel.expert,
    accelerateur: valide(demande.accelerateur ?? actuel.accelerateur, ACCELERATEURS, actuel.accelerateur),
    toneMapping: valide(demande.toneMapping ?? actuel.toneMapping, TONE_MAPPINGS, actuel.toneMapping),
    codecSortie: valide(demande.codecSortie ?? actuel.codecSortie, CODECS, actuel.codecSortie),
    resolutionMax: valide(demande.resolutionMax ?? actuel.resolutionMax, RESOLUTIONS, actuel.resolutionMax),
    conversionsSimultanees: nombreOuAuto(demande.conversionsSimultanees ?? actuel.conversionsSimultanees, actuel.conversionsSimultanees),
  };
  setSetting(CLE, JSON.stringify(suivant));
  cache = suivant;
  return suivant;
}

/** Uniquement pour les tests : oublie ce qui a été lu, sans toucher à ce qui est enregistré. */
export function oublierPreferencesConversion(): void {
  cache = null;
}
