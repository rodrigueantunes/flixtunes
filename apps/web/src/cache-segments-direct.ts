import type Hls from "hls.js";
import type { FragmentLoaderContext, HlsConfig, Loader, LoaderCallbacks, LoaderConfiguration } from "hls.js";

/** Réserve de segments complets, partagée par les deux lecteurs d'une seule chaîne. */
export class CacheSegmentsDirect {
  private entrees = new Map<string, { octets: ArrayBuffer; date: number; duree: number }>();
  private taille = 0;
  constructor(private maximum = 64 * 1024 * 1024, private retentionMs = 90_000, private horloge = Date.now) {}

  lire(cle: string) {
    this.purger();
    const entree = this.entrees.get(cle);
    // Le worker HLS peut transférer et détacher le tableau : chacun reçoit sa copie.
    return entree ? { ...entree, octets: entree.octets.slice(0) } : null;
  }

  garder(cle: string, octets: ArrayBuffer, duree: number) {
    this.purger();
    if (!octets.byteLength || octets.byteLength > Math.min(this.maximum, 16 * 1024 * 1024)) return;
    this.retirer(cle);
    while (this.taille + octets.byteLength > this.maximum) this.retirer(this.entrees.keys().next().value!);
    this.entrees.set(cle, { octets: octets.slice(0), date: this.horloge(), duree });
    this.taille += octets.byteLength;
  }

  vider() { this.entrees.clear(); this.taille = 0; }
  private retirer(cle: string) { this.taille -= this.entrees.get(cle)?.octets.byteLength ?? 0; this.entrees.delete(cle); }
  private purger() {
    for (const [cle, entree] of this.entrees) if (this.horloge() - entree.date >= this.retentionMs) this.retirer(cle);
  }
}

export function cleSegment(contexte: FragmentLoaderContext): string {
  const f = contexte.frag;
  return JSON.stringify([contexte.url, contexte.rangeStart, contexte.rangeEnd, f.sn, f.cc,
    f.programDateTime, contexte.part?.index, contexte.headers]);
}

/** fLoader ne reçoit ni les manifestes périssables, ni les clés de chiffrement. */
export function chargeurAvecCache(HlsClass: typeof Hls, cache: CacheSegmentsDirect) {
  return class implements Loader<FragmentLoaderContext> {
    private reseau: Loader<FragmentLoaderContext>;
    private annule = false;
    context: FragmentLoaderContext | null = null;
    constructor(config: HlsConfig) { this.reseau = new HlsClass.DefaultConfig.loader(config) as Loader<FragmentLoaderContext>; }
    get stats() { return this.reseau.stats; }
    abort() { this.annule = true; this.reseau.abort(); }
    destroy() { this.annule = true; this.reseau.destroy(); }
    load(context: FragmentLoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<FragmentLoaderContext>) {
      this.context = context;
      const cle = cleSegment(context);
      const entree = cache.lire(cle);
      if (entree) {
        queueMicrotask(() => {
          if (this.annule) return;
          const fin = performance.now();
          Object.assign(this.stats, { loaded: entree.octets.byteLength, total: entree.octets.byteLength,
            loading: { start: fin - Math.max(1, entree.duree), first: fin, end: fin } });
          callbacks.onSuccess({ url: context.url, data: entree.octets, code: 200 }, this.stats, context, null);
        });
        return;
      }
      this.reseau.load(context, config, { ...callbacks, onSuccess: (response, stats, ctx, details) => {
        if (this.annule) return;
        if (response.data instanceof ArrayBuffer) cache.garder(cle, response.data, stats.loading.end - stats.loading.start);
        callbacks.onSuccess(response, stats, ctx, details);
      } });
    }
  };
}
