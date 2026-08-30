/**
 * Ce qu'on fait quand un service distant ne répond pas — et la distinction qui manquait.
 *
 * ## « Trop vite » n'est pas « en panne »
 *
 * Un fournisseur qui répond `429` ne va pas mal : il demande d'attendre. Le compter comme une panne
 * fait ouvrir le coupe-circuit sur un service parfaitement vivant, et c'est exactement ce qui se
 * passait — quatre `429` de suite pendant une session de correspondance, et TMDB disparaissait
 * quarante-cinq secondes. Vu de l'écran, il « n'était plus là » alors qu'il n'avait jamais été
 * absent.
 *
 * D'où `LimiteDeDebit`, que le coupe-circuit laisse passer sans rien compter. Un service qui nous
 * freine reste un service qui marche.
 */

/**
 * « Ralentissez », et non « je suis tombé ».
 *
 * Porte le délai que le fournisseur a demandé lui-même quand il l'a dit — `Retry-After` —, pour que
 * l'appelant attende ce qu'on lui demande plutôt qu'un chiffre inventé de notre côté.
 */
export class LimiteDeDebit extends Error {
  constructor(readonly service: string, readonly attendreMs: number) {
    super(`${service} limite le débit ; attente de ${Math.round(attendreMs / 1000)} s`);
    this.name = "LimiteDeDebit";
  }
}

export class CircuitBreaker {
  private failures = 0; private openedAt = 0;
  constructor(private readonly threshold = 4, private readonly resetMs = 30_000) {}
  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.openedAt && Date.now() - this.openedAt < this.resetMs) throw new Error("Service temporairement isolé après plusieurs échecs");
    if (this.openedAt) { this.openedAt = 0; this.failures = 0; }
    try { const result = await operation(); this.failures = 0; return result; }
    catch (error) {
      // Une limitation de débit ne compte pas : le service répond, il demande simplement d'attendre.
      // L'isoler pour cela reviendrait à le punir d'avoir été poli.
      if (error instanceof LimiteDeDebit) throw error;
      this.failures += 1; if (this.failures >= this.threshold) this.openedAt = Date.now(); throw error;
    }
  }
  get state(): "closed" | "open" { return this.openedAt && Date.now() - this.openedAt < this.resetMs ? "open" : "closed"; }

  /**
   * Dans combien de temps ce service redevient interrogeable, en millisecondes. `0` s'il l'est déjà.
   *
   * Sert à **attendre son retour** au lieu de se rabattre sur un autre : pendant une analyse
   * automatique, mieux vaut quarante-cinq secondes de patience qu'une fiche pauvre qu'il faudra
   * reprendre. Voir `fetchMetadataWithProviders`.
   */
  msAvantReouverture(): number {
    if (!this.openedAt) return 0;
    return Math.max(0, this.resetMs - (Date.now() - this.openedAt));
  }
}

/**
 * Une cadence : au plus tant d'appels par seconde, les autres attendent leur tour.
 *
 * Elle existe pour ne pas provoquer le `429` qu'on vient d'apprendre à traiter. Une analyse
 * complète part en rafale — chaque fiche interroge le fournisseur — et rien ne bornait le débit ;
 * on découvrait la limite en la heurtant.
 *
 * L'implémentation est volontairement simple : on retient la date du dernier départ et on espace.
 * Pas de jetons, pas de file explicite — les appels s'attendent les uns les autres, ce qui suffit
 * pour un serveur qui interroge un fournisseur, et se lit en dix lignes.
 */
export class Cadence {
  private prochain = 0;
  /** @param parSeconde Nombre maximal de départs par seconde. */
  constructor(private readonly parSeconde: number) {}

  async attendreSonTour(): Promise<void> {
    const espacement = 1000 / this.parSeconde;
    const maintenant = Date.now();
    const depart = Math.max(maintenant, this.prochain);
    this.prochain = depart + espacement;
    if (depart > maintenant) await new Promise((resolve) => setTimeout(resolve, depart - maintenant));
  }
}

/**
 * Le délai qu'un service demande, lu dans `Retry-After`.
 *
 * L'en-tête porte soit un nombre de secondes, soit une date — les deux formes sont normalisées, et
 * une valeur absente ou illisible rend `null` plutôt qu'un chiffre inventé. Le plafond évite qu'un
 * en-tête aberrant fasse dormir une analyse pendant une heure.
 */
export function delaiDemande(entetes: Headers, plafondMs = 60_000): number | null {
  const brut = entetes.get("retry-after");
  if (!brut) return null;
  const secondes = Number(brut.trim());
  if (Number.isFinite(secondes)) return Math.min(Math.max(0, secondes * 1000), plafondMs);
  const date = Date.parse(brut);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(0, date - Date.now()), plafondMs);
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); }
}
