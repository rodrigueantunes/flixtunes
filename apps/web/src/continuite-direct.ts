/** Hystérésis : une réserve qui oscille ne doit pas changer la qualité quatre fois par seconde. */
export class QualiteContinue {
  private changement = -Infinity;
  private sainDepuis: number | null = null;
  ajuster(tampon: number, niveaux: number, plafond: number, actuel: number, maintenant: number): number {
    if (niveaux < 2) return plafond;
    if (tampon < 25) this.sainDepuis = null;
    else this.sainDepuis ??= maintenant;
    if (tampon < 6 && plafond !== 0) { this.changement = maintenant; return 0; }
    if (tampon < 15 && maintenant - this.changement >= 5_000) {
      this.changement = maintenant;
      return Math.max(0, Math.min(plafond < 0 ? niveaux - 1 : plafond, Math.max(0, actuel)) - 1);
    }
    if (plafond >= 0 && this.sainDepuis !== null && maintenant - this.sainDepuis >= 20_000
      && maintenant - this.changement >= 20_000) {
      this.changement = maintenant;
      return plafond + 1 >= niveaux - 1 ? -1 : plafond + 1;
    }
    return plafond;
  }
}

export function doitPreparerSecours(tampon: number, depuisSegmentMs: number, segmentS: number): boolean {
  return tampon < 30 && depuisSegmentMs > Math.max(6_000, segmentS * 1_500);
}

/** Deux fournisseurs n'ont pas les mêmes numéros de segment : seul le temps programme les relie. */
export function raccordAutorise(memeSource: boolean, pdtA: number | null, pdtB: number | null): boolean {
  return memeSource || (pdtA !== null && pdtB !== null);
}

/** Seul un 404 du relais de notre serveur justifie de renouveler un lien opaque. */
export function lienDirectARenouveler(code: number | undefined, adresse: string, origine: string): boolean {
  if (code === 401 || code === 403) return true;
  try {
    const url = new URL(adresse, origine);
    return code === 404 && url.origin === new URL(origine).origin && url.pathname === "/api/live/relais";
  } catch { return false; }
}
