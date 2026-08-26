/**
 * Ce qui est joignable depuis Internet, et rien d'autre.
 *
 * Le serveur écoute désormais à deux endroits : le réseau local, dont la surface ne change pas, et
 * une seconde écoute réservée à l'accès distant. Ce module décrit ce que la seconde accepte.
 *
 * **Liste blanche, jamais liste noire.** Une liste noire paraît plus simple — on nomme ce qu'on
 * refuse — mais elle est fausse dès la première route ajoutée par une étape ultérieure : cette route
 * serait exposée sans que personne ne l'ait décidé. Ici c'est l'inverse : une route inconnue est
 * refusée, et il faut un geste délibéré pour l'ouvrir.
 *
 * **Le filtrage porte sur le motif de route, pas sur l'URL.** Fastify résout la route avant
 * d'exécuter les crochets, donc `request.routeOptions.url` rend `/api/media/:id/stream` et non
 * `/api/media/a1b2.../stream`. Comparer des motifs exacts évite toute expression régulière sur des
 * URL — donc toute la famille de contournements par encodage, double barre oblique ou `..` qui vient
 * avec. Une route ajoutée demain porte un motif absent de cette liste : elle est refusée d'office.
 *
 * **Le refus est un 404, pas un 403.** Un 403 confirmerait l'existence de la route et renseignerait
 * qui cherche. De l'extérieur, une administration interdite doit être indiscernable d'une
 * administration inexistante.
 */

/** Méthode et motif de route, tels que Fastify les enregistre. */
function cle(methode: string, motif: string): string {
  return `${methode.toUpperCase()} ${motif}`;
}

/**
 * Les routes accessibles sans session : strictement de quoi afficher l'écran de choix de profil et
 * se déverrouiller. Rien d'autre — et surtout aucune donnée de la médiathèque.
 */
const SANS_SESSION = new Set([
  cle("GET", "/api/health"),
  cle("GET", "/api/remote/session"),
  cle("POST", "/api/remote/login"),
  // Les clients Web lisent cet état avant même d'afficher les groupes. La réponse WAN est réduite
  // dans `routes.ts` : aucun chemin de bibliothèque ne sort, et la configuration initiale n'est
  // jamais proposée depuis Internet.
  cle("GET", "/api/setup"),
  cle("GET", "/api/profiles"),
  cle("GET", "/api/profile-groups"),
  cle("POST", "/api/profiles/:id/unlock"),
]);

/** Seules ces routes précèdent le compte de connexion de l'appareil. */
const SANS_COMPTE = new Set([
  cle("GET", "/api/health"),
  cle("GET", "/api/remote/session"),
  cle("POST", "/api/remote/login"),
]);

/**
 * Les lectures autorisées une fois la session ouverte.
 *
 * Absents volontairement, bien qu'inoffensifs en apparence :
 *
 * - `/api/system/status`, `/api/system/metrics`, `/api/system/capacity` : version, mémoire,
 *   température et santé de la base ne regardent pas Internet, et une version exacte sert surtout à
 *   cibler un défaut connu ;
 * - `/api/metadata/image/:size/:name` : cette route **sort** vers TMDB avec un chemin fourni par le
 *   client. L'exposer transformerait le NAS en relais d'images pour qui le trouve ;
 * - `/api/filesystem/directories` : elle cartographie les volumes du NAS ;
 * - `/api/system/backups/:name` : elle rend la base entière en un seul GET.
 */
const LECTURES = new Set([
  cle("GET", "/api/home"),
  cle("GET", "/api/system/generiques"),
  cle("GET", "/api/catalog"),
  cle("GET", "/api/catalog/browse"),
  cle("GET", "/api/catalog/:id/details"),
  cle("GET", "/api/search"),
  cle("GET", "/api/recommendations"),
  cle("GET", "/api/people/:id"),
  cle("GET", "/api/artwork/:id"),
  cle("GET", "/api/media/:id"),
  cle("GET", "/api/media/:id/neighbors"),
  cle("GET", "/api/media/:id/inventory"),
  cle("GET", "/api/media/:id/playback-info"),
  cle("GET", "/api/media/:id/stream"),
  cle("GET", "/api/media/:id/timeline-sheet"),
  cle("GET", "/api/media/:id/subtitle-preference"),
  cle("GET", "/api/media/:id/subtitles/:index.vtt"),
  cle("GET", "/api/media/:id/subtitles/external/:index.vtt"),
  cle("GET", "/api/playback/:id"),
  cle("GET", "/api/playback/:id/:file"),
]);

/**
 * Les seules écritures tolérées à distance.
 *
 * La consigne est « en externe, on est en lecture seule ». Elle ne peut pas être prise au pied de la
 * lettre : l'authentification elle-même est un POST, et une session de conversion doit pouvoir
 * s'ouvrir et se fermer, sans quoi seule la lecture directe fonctionnerait.
 *
 * Chacune de ces écritures ne touche que **les lignes du profil authentifié** ou **sa propre session
 * de lecture**. Aucune ne modifie le catalogue, la configuration, les bibliothèques ou un fichier.
 *
 * Absentes volontairement : `/api/playback/codec-failure` et `/api/playback/codec-success`, qui
 * alimentent une quarantaine de codecs **partagée par tous les clients**. Un client distant hostile
 * y dégraderait les décisions de lecture de toute la maison ; un client distant honnête n'y perd que
 * sa contribution.
 */
const ECRITURES = new Set([
  cle("POST", "/api/media/:id/playback"),
  cle("DELETE", "/api/playback/:id"),
  cle("PUT", "/api/media/:id/progress"),
  cle("DELETE", "/api/media/:id/progress"),
  cle("PUT", "/api/media/:id/subtitle-preference"),
  cle("PUT", "/api/catalog/:id/watched"),
  cle("PUT", "/api/catalog/:id/watchlist"),
  cle("DELETE", "/api/catalog/:id/watchlist"),
  cle("PUT", "/api/recommendations/feedback"),
]);

export type VerdictWan =
  | { autorise: true; sessionRequise: boolean }
  | { autorise: false; sessionRequise: false };

const REFUS: VerdictWan = { autorise: false, sessionRequise: false };

/**
 * Décide du sort d'une requête sur l'écoute distante.
 *
 * `motif` est `request.routeOptions.url` : `undefined` quand aucune route ne correspond, auquel cas
 * il n'y a rien à autoriser.
 *
 * Les ressources hors `/api/` — l'interface Web elle-même, ses scripts et ses feuilles de style —
 * passent sans session : la page doit pouvoir se charger avant qu'on puisse s'y authentifier. Elle
 * ne contient aucune donnée de la médiathèque, qu'elle va chercher ensuite par les routes ci-dessus.
 */
export function verdictWan(methode: string, motif: string | undefined): VerdictWan {
  if (!motif) return REFUS;
  if (!motif.startsWith("/api/")) return { autorise: true, sessionRequise: false };

  const demande = cle(methode, motif);
  if (SANS_SESSION.has(demande)) return { autorise: true, sessionRequise: false };
  if (LECTURES.has(demande) || ECRITURES.has(demande)) return { autorise: true, sessionRequise: true };
  return REFUS;
}

/** Vrai pour toute route API WAN autorisée qui doit franchir la première barrière de connexion. */
export function compteDistantRequis(methode: string, motif: string | undefined): boolean {
  if (!motif?.startsWith("/api/")) return false;
  return !SANS_COMPTE.has(cle(methode, motif));
}

/** Pour les tests et le diagnostic : l'inventaire exact de ce qui est ouvert. */
export function inventaireWan(): { sansSession: string[]; lectures: string[]; ecritures: string[] } {
  return {
    sansSession: [...SANS_SESSION].sort(),
    lectures: [...LECTURES].sort(),
    ecritures: [...ECRITURES].sort(),
  };
}
