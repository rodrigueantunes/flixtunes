import { writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { getSetting, setSetting } from "./database.js";

/**
 * Les réglages de l'accès distant, modifiables depuis l'interface.
 *
 * Ils n'existaient que dans `flixtunes.env`, un fichier qu'on n'atteint qu'en SSH ou par un partage
 * réseau. Le réglage était donc théorique : personne ne pouvait ouvrir l'accès distant depuis
 * l'écran d'administration, ni comprendre pourquoi il ne répondait pas. C'est le même défaut que les
 * préférences de conversion avaient avant d'être sorties des variables d'environnement, et il se
 * corrige de la même façon.
 *
 * **La difficulté propre à ces réglages-ci : ils ont deux lecteurs.** Le serveur Node décide s'il
 * ouvre une seconde écoute ; le script de démarrage, écrit en shell, décide s'il lance Caddy et avec
 * quel domaine. Le shell ne sait pas lire la base SQLite.
 *
 * D'où le fichier `wan.env` : le serveur l'écrit à chaque enregistrement, le script le source **après**
 * `flixtunes.env`. Une seule source de vérité, et le réglage manuel du fichier historique reste
 * possible pour qui préfère — il sert alors de valeur par défaut.
 */
export interface ParametresWan {
  /** Nom de domaine public. Vide ou `null` : l'accès distant n'existe pas. */
  domaine: string | null;
  /** Port du NAS vers lequel la box redirige le 80 public. Sert au défi ACME. */
  portHttp: number;
  /** Port du NAS vers lequel la box redirige le 443 public. */
  portHttps: number;
  /** Écoute interne du serveur, sur la boucle locale uniquement. */
  portInterne: number;
  dureeSessionHeures: number;
}

const CLE = "wan.parametres";

/**
 * Un domaine plausible, et rien d'autre.
 *
 * Ce texte finit dans un fichier de configuration Caddy engendré par concaténation. Une valeur
 * contenant une accolade, un saut de ligne ou une espace y ajouterait des directives — c'est une
 * injection de configuration, sur le composant exposé à Internet. La forme est donc vérifiée ici,
 * strictement, plutôt que d'espérer que l'échappement suffise plus loin.
 */
export function domaineValide(valeur: unknown): valeur is string {
  return typeof valeur === "string"
    && valeur.length <= 253
    && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(valeur);
}

function port(valeur: unknown, defaut: number): number {
  const nombre = Number(valeur);
  return Number.isInteger(nombre) && nombre >= 1024 && nombre <= 65535 ? nombre : defaut;
}

function defauts(): ParametresWan {
  return {
    domaine: config.wan.domain,
    portHttp: config.wan.httpPort,
    portHttps: config.wan.httpsPort,
    portInterne: config.wan.port,
    dureeSessionHeures: config.wan.sessionHours,
  };
}

let cache: ParametresWan | null = null;

export function parametresWan(): ParametresWan {
  if (cache) return cache;
  const base = defauts();
  const stored = getSetting(CLE);
  if (!stored) { cache = base; return cache; }
  try {
    const lu = JSON.parse(stored) as Partial<ParametresWan>;
    cache = {
      domaine: domaineValide(lu.domaine) ? lu.domaine.toLowerCase() : null,
      portHttp: port(lu.portHttp, base.portHttp),
      portHttps: port(lu.portHttps, base.portHttps),
      portInterne: port(lu.portInterne, base.portInterne),
      dureeSessionHeures: Math.max(1, Math.min(720, Number(lu.dureeSessionHeures) || base.dureeSessionHeures)),
    };
  } catch {
    // Réglages illisibles : on repart de l'environnement plutôt que d'échouer au démarrage.
    cache = base;
  }
  return cache;
}

export function cheminFichierEnvWan(): string {
  return path.join(config.dataDir, "wan.env");
}

/**
 * Écrit le fichier que le script de démarrage sait lire.
 *
 * Les valeurs sont écrites sans guillemets ni espaces : le script les charge par `set -a` puis
 * sourcing, et une valeur non vérifiée y serait du code shell. `domaineValide` a déjà écarté tout ce
 * qui n'est pas un nom de domaine ; ce commentaire existe pour que personne n'affaiblisse l'un en
 * croyant que l'autre protège.
 */
function ecrireFichierEnv(parametres: ParametresWan): void {
  const lignes = [
    "# Engendré par FlixTunes depuis l'écran d'administration. Ne pas modifier à la main :",
    "# ce fichier est réécrit à chaque enregistrement. Pour un réglage manuel permanent,",
    "# utiliser flixtunes.env, qui sert de valeur par défaut.",
    `FLIXTUNES_WAN_DOMAIN=${parametres.domaine ?? ""}`,
    `FLIXTUNES_WAN_HTTP_PORT=${parametres.portHttp}`,
    `FLIXTUNES_WAN_HTTPS_PORT=${parametres.portHttps}`,
    `FLIXTUNES_WAN_PORT=${parametres.portInterne}`,
    `FLIXTUNES_WAN_SESSION_HOURS=${parametres.dureeSessionHeures}`,
    "",
  ];
  writeFileSync(cheminFichierEnvWan(), lignes.join("\n"), { encoding: "utf8", mode: 0o640 });
}

export function definirParametresWan(demande: Partial<ParametresWan>): ParametresWan {
  const actuel = parametresWan();
  const domaineDemande = demande.domaine === undefined ? actuel.domaine
    : (typeof demande.domaine === "string" && demande.domaine.trim() === "") ? null
      : demande.domaine;
  if (domaineDemande !== null && !domaineValide(domaineDemande)) {
    throw new Error("Nom de domaine invalide");
  }
  const suivant: ParametresWan = {
    domaine: domaineDemande === null ? null : String(domaineDemande).toLowerCase(),
    portHttp: port(demande.portHttp ?? actuel.portHttp, actuel.portHttp),
    portHttps: port(demande.portHttps ?? actuel.portHttps, actuel.portHttps),
    portInterne: port(demande.portInterne ?? actuel.portInterne, actuel.portInterne),
    dureeSessionHeures: Math.max(1, Math.min(720,
      Number(demande.dureeSessionHeures ?? actuel.dureeSessionHeures) || actuel.dureeSessionHeures)),
  };
  if (suivant.portHttp === suivant.portHttps) throw new Error("Les deux ports du proxy doivent différer");
  if (suivant.portInterne === suivant.portHttp || suivant.portInterne === suivant.portHttps) {
    throw new Error("Le port interne doit différer des ports du proxy");
  }
  setSetting(CLE, JSON.stringify(suivant));
  cache = suivant;
  ecrireFichierEnv(suivant);
  return suivant;
}

/** Uniquement pour les tests : oublie ce qui a été lu, sans toucher à ce qui est enregistré. */
export function oublierParametresWan(): void {
  cache = null;
}
