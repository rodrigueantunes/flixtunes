/** Politiques communes aux moteurs du direct, indépendantes de React. */
/** Identité de session, distincte de l'authentification, disponible aussi en HTTP sur le LAN. */
export function identifiantLectureDirect(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const octets = globalThis.crypto.getRandomValues(new Uint8Array(16));
    return Array.from(octets, (octet) => octet.toString(16).padStart(2, "0")).join("");
  }
  return `live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function familleLecteur(agent = navigator.userAgent): string {
  if (/Firefox\//.test(agent)) return "web-firefox";
  if (/Chrome\/|Chromium\/|Edg\/|OPR\//.test(agent)) return "web-chromium";
  if (/Safari\//.test(agent)) return "web-safari";
  return "web-autre";
}

export function reserveDeDepart(fenetre: number): number {
  return fenetre > 0 ? Math.min(8, Math.max(2, fenetre / 3)) : 8;
}

/** La cible laisse une marge sous la limite de 60 s ; aucun rattrapage ne vide une petite réserve. */
export function vitesseContinue(retard: number, cible: number, reserve: number, manuel: boolean): number {
  if (manuel || !Number.isFinite(retard) || cible <= 0) return 1;
  if (retard > cible + 2 && reserve >= 12) return retard > 57 ? 1.06 : 1.03;
  if (retard < cible - 3 && reserve >= 3 && reserve < cible - 5) return 0.98;
  return 1;
}

export function budgetCacheDirect(memoire = (navigator as Navigator & { deviceMemory?: number }).deviceMemory): number {
  return (memoire !== undefined && memoire <= 4 ? 16 : 32) * 1024 * 1024;
}

/** Le compteur de trames exclut les images perdues ; l'horloge seule reste un dernier recours. */
export function imagesPresentees(video: HTMLVideoElement): number | null {
  const qualite = video.getVideoPlaybackQuality?.();
  return qualite ? Math.max(0, qualite.totalVideoFrames - qualite.droppedVideoFrames) : null;
}

export interface EvenementDirect {
  seconde: number; source: number; reserve: number; retard: number; evenement: string;
  identifiant?: string; chemin?: string; codecs?: string; imagesPerdues?: number;
}

export class JournalDirect {
  private debut = Date.now();
  private entrees: EvenementDirect[] = [];
  noter(source: number, reserve: number, retard: number, evenement: string,
    details: Pick<EvenementDirect, "identifiant" | "chemin" | "codecs" | "imagesPerdues"> = {}) {
    this.entrees.push({ seconde: Math.round((Date.now() - this.debut) / 1000), source,
      reserve: Math.round(reserve), retard: Math.round(retard), evenement, ...details,
      identifiant: /^[a-f0-9]{64}$/.test(details.identifiant ?? "") ? details.identifiant : undefined });
    this.entrees = this.entrees.slice(-120);
  }
  exporter() { return { version: 1, lecteur: familleLecteur(), evenements: [...this.entrees] }; }
  vider() { this.debut = Date.now(); this.entrees = []; }
}

/** Les identités sont opaques ; ni URL fournisseur ni jeton ne sont stockés. */
const relaisConnus = new Map<string, number>();
export function retenirRelais(identifiant: string | undefined) {
  if (!identifiant || !/^[a-f0-9]{64}$/.test(identifiant)) return;
  if (relaisConnus.size >= 200) relaisConnus.delete(relaisConnus.keys().next().value!);
  relaisConnus.set(identifiant, Date.now() + 24 * 60 * 60_000);
}
export function prefereRelais(source: { identifiant?: string; cheminPrefere?: string }): boolean {
  return source.cheminPrefere === "relais" || (relaisConnus.get(source.identifiant ?? "") ?? 0) > Date.now();
}

export function formatAdresse(adresse: string): "hls" | "dash" | "ts" | "mp4" | "inconnu" {
  try {
    const url = new URL(adresse, "https://flixtunes.invalid");
    const extension = /\.(m3u8|mpd|ts|mp4)$/i.exec(url.pathname)?.[1]?.toLowerCase() ?? url.searchParams.get("f");
    return extension === "m3u8" ? "hls" : extension === "mpd" ? "dash"
      : extension === "ts" ? "ts" : extension === "mp4" ? "mp4" : "inconnu";
  } catch { return "inconnu"; }
}
