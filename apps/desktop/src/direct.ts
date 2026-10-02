import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";

export type FetchDirect = (url: string, init: RequestInit) => Promise<Response>;
const MAX_CACHE = 64 * 1024 * 1024;
const MAX_SEGMENT = 12 * 1024 * 1024;

/** Le processus natif ne reçoit ni cookie NAS, ni adresse de fournisseur. */
export function adresseDirectAutorisee(url: string, origine: string): boolean {
  try {
    const u = new URL(url, origine);
    return ["http:", "https:"].includes(u.protocol) && u.origin === new URL(origine).origin &&
      !u.username && !u.password && (u.pathname === "/api/live/relais" ||
        /^\/api\/live\/compat\/[a-zA-Z0-9-]+\/(?:live\.m3u8|segment\d+\.ts)$/.test(u.pathname));
  } catch { return false; }
}

export function reecrireDirect(texte: string, base: string, proxy: (url: string) => string): string {
  if (!texte.trimStart().startsWith("#EXTM3U") || /#EXTVLC|#EXT-X-(?:DEFINE|CONTENT-STEERING)|URI\s*=\s*[^"\s]/i.test(texte)) {
    throw new Error("Manifeste non pris en charge");
  }
  return texte.split(/\r?\n/).map((ligne) => {
    if (!ligne.trim()) return ligne;
    if (ligne.startsWith("#")) return ligne.replace(/\bURI\s*=\s*"([^"]+)"/gi,
      (_tout, uri: string) => `URI="${proxy(new URL(uri, base).href)}"`);
    return proxy(new URL(ligne.trim(), base).href);
  }).join("\n");
}

/** Retarde la fenêtre présentée, sans dépendre de EXT-X-START (ignoré par certains VLC). */
export function margeDirect(texte: string, ageSecondes = 0): string {
  if (!/#EXTINF:/.test(texte) || /#EXT-X-ENDLIST|#EXT-X-PLAYLIST-TYPE:VOD|#EXT-X-PART:|#EXT-X-SKIP:/.test(texte)) return texte;
  const lignes = texte.split(/\r?\n/);
  const segments: Array<{ fin: number; duree: number }> = [];
  let duree = 0;
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i]!;
    if (l.startsWith("#EXTINF:")) duree = Number.parseFloat(l.slice(8));
    else if (l.trim() && !l.startsWith("#") && duree > 0) { segments.push({ fin: i, duree }); duree = 0; }
  }
  const total = segments.reduce((s, e) => s + e.duree, 0);
  const cible = Number(/#EXT-X-TARGETDURATION:(\d+)/.exec(texte)?.[1] ?? 8);
  // Au moins trois segments visibles. Réserve + recul usuel de VLC <= 60 s sur ce chemin.
  const delai = Math.max(0, Math.min(30, 55 - cible * 3, total - cible * 3) - Math.max(0, ageSecondes));
  let retire = 0, compte = segments.length;
  while (compte > 3 && retire + segments[compte - 1]!.duree <= delai) {
    retire += segments[--compte]!.duree;
  }
  if (!compte) return texte;
  return lignes.slice(0, segments[compte - 1]!.fin + 1).filter((l) => !l.startsWith("#EXT-X-START:")).join("\n") + "\n";
}

async function lireBorne(reponse: Response, maximum: number): Promise<Buffer> {
  const lecteur = reponse.body!.getReader(); const parties: Uint8Array[] = []; let taille = 0;
  try {
    for (;;) {
      const { value, done } = await lecteur.read(); if (done) break;
      taille += value.length; if (taille > maximum) throw new Error("Réponse trop volumineuse");
      parties.push(value);
    }
    return Buffer.concat(parties);
  } finally { await lecteur.cancel().catch(() => undefined); }
}

/** Cache borné des segments ; les manifestes et les clés restent soumis à l'authentification. */
export class CacheDirectBureau {
  private entrees = new Map<string, { corps: Buffer; date: number }>();
  octets = 0;
  private maximum: number;
  constructor(maximum = MAX_CACHE) { this.maximum = maximum; }
  lire(url: string, maintenant = Date.now()): Buffer | null {
    const e = this.entrees.get(url);
    if (!e) return null;
    if (maintenant - e.date > 90_000) { this.retirer(url); return null; }
    return e.corps;
  }
  poser(url: string, corps: Buffer, maintenant = Date.now()): void {
    if (corps.length > Math.min(this.maximum, MAX_SEGMENT)) return;
    this.retirer(url);
    for (const [cle, e] of this.entrees) if (maintenant - e.date > 90_000) this.retirer(cle);
    while (this.octets + corps.length > this.maximum && this.entrees.size) this.retirer(this.entrees.keys().next().value!);
    this.entrees.set(url, { corps, date: maintenant }); this.octets += corps.length;
  }
  private retirer(url: string): void { const e = this.entrees.get(url); if (e) this.octets -= e.corps.length; this.entrees.delete(url); }
  vider(): void { this.entrees.clear(); this.octets = 0; }
}

export async function ouvrirDirectBureau(source: string, origine: string, charger: FetchDirect) {
  if (!adresseDirectAutorisee(source, origine)) throw new Error("Adresse de direct refusée");
  const secret = randomBytes(24).toString("hex");
  const urls = new Map<string, string>(); const ids = new Map<string, string>();
  const utilisees = new Map<string, number>(); let compteur = 0;
  const cache = new CacheDirectBureau();
  const arrets = new Set<AbortController>();
  const manifestes = new Map<string, { texte: string; date: number; demande: number; segments: Array<{ url: string; duree: number }> }>();
  const nonCacheables = new Set<string>();
  const enCours = new Map<string, Promise<Buffer>>();
  let local = "", ferme = false, actif = Date.now(), incident = "", remplissage = false;
  let dernierSegmentServi = "";
  let manifesteRacine = "";
  const proxy = (url: string): string => {
    if (!adresseDirectAutorisee(url, origine)) throw new Error("Adresse hors du relais");
    let id = ids.get(url);
    if (!id) {
      if (urls.size >= 8192) throw new Error("Trop de ressources");
      id = String(compteur++); urls.set(id, url); ids.set(url, id);
    }
    utilisees.set(id, Date.now());
    return `${local}/${secret}/${id}`;
  };
  async function requete(url: string, range?: string) {
    if (ferme || arrets.size >= 16) throw new Error("Relais indisponible");
    const arret = new AbortController(); arrets.add(arret);
    const timer = setTimeout(() => arret.abort(), 15_000);
    const finir = () => { clearTimeout(timer); arrets.delete(arret); arret.abort(); };
    try {
      const r = await charger(url, { signal: arret.signal, redirect: "manual",
        headers: range ? { Range: range } : {} });
      if (!r.ok || !r.body) { await r.body?.cancel(); throw new Error(`Relais HTTP ${r.status}`); }
      return { r, arret, timer, finir };
    } catch (e) { finir(); throw e; }
  }
  async function segment(url: string): Promise<Buffer> {
    const present = cache.lire(url); if (present) return present;
    const attendue = enCours.get(url); if (attendue) return attendue;
    const promesse = (async () => {
      const q = await requete(url);
      try {
        if (Number(q.r.headers.get("content-length")) > MAX_SEGMENT) {
          nonCacheables.add(url); throw new Error("Segment trop volumineux pour le cache");
        }
        let b: Buffer;
        try { b = await lireBorne(q.r, MAX_SEGMENT); }
        catch (e) { if (e instanceof Error && e.message === "Réponse trop volumineuse") nonCacheables.add(url); throw e; }
        if (!ferme) cache.poser(url, b); return b;
      }
      finally { q.finir(); }
    })();
    enCours.set(url, promesse);
    try { return await promesse; } finally { enCours.delete(url); }
  }
  function retenirManifeste(url: string, texte: string) {
    incident = "";
    if (manifestes.size >= 8 && !manifestes.has(url)) return;
    const lignes = texte.split(/\r?\n/); const segments: Array<{ url: string; duree: number }> = [];
    let duree = 0;
    // Les plages partielles ne sont jamais confondues avec des segments complets.
    if (!/#EXT-X-BYTERANGE|#EXT-X-PART:/.test(texte)) for (const ligne of lignes) {
      if (ligne.startsWith("#EXTINF:")) duree = Number.parseFloat(ligne.slice(8));
      else if (ligne && !ligne.startsWith("#") && duree > 0) {
        const cible = new URL(ligne, url).href;
        if (adresseDirectAutorisee(cible, origine)) segments.push({ url: cible, duree });
        duree = 0;
      }
    }
    if (segments.length) manifestes.set(url, { texte, date: Date.now(), demande: manifestes.get(url)?.demande ?? Date.now(), segments });
  }
  const serveur = createServer(async (req, res) => {
    const m = /^\/([a-f0-9]+)\/(\d+)$/.exec(req.url ?? "");
    const cible = m?.[1] === secret ? urls.get(m[2]!) : undefined;
    if (!cible || !["GET", "HEAD"].includes(req.method ?? "") || arrets.size >= 16) { res.writeHead(404).end(); return; }
    actif = Date.now(); utilisees.set(m![2]!, actif); res.setHeader("Cache-Control", "no-store");
    const manifesteDemande = manifestes.get(cible); if (manifesteDemande) manifesteDemande.demande = actif;
    try {
      if (!req.headers.range && !nonCacheables.has(cible) && (cache.lire(cible) || [...manifestes.values()].some((p) => p.segments.some((s) => s.url === cible)))) {
        try {
          const b = await segment(cible); dernierSegmentServi = cible;
          res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": b.length });
          res.end(req.method === "HEAD" ? undefined : b); return;
        } catch (e) { if (!nonCacheables.has(cible)) throw e; }
      }
      const q = await requete(cible, req.headers.range);
      res.once("close", q.finir);
      const type = q.r.headers.get("content-type") ?? "";
      if (/dash\+xml/i.test(type)) { q.finir(); throw new Error("DASH : repli compatible requis"); }
      const lecteur = q.r.body!.getReader();
      const morceaux: Uint8Array[] = []; let taille = 0, termine = false;
      while (taille < 1024) {
        const lu = await lecteur.read(); if (lu.done) { termine = true; break; }
        morceaux.push(lu.value); taille += lu.value.length;
      }
      const debut = Buffer.concat(morceaux);
      const corps = new ReadableStream<Uint8Array>({
        start(c) { if (debut.length) c.enqueue(debut); if (termine) c.close(); },
        async pull(c) { const lu = await lecteur.read(); if (lu.done) c.close(); else c.enqueue(lu.value); },
        cancel() { return lecteur.cancel(); },
      });
      if (/mpegurl/i.test(type) || debut.toString("utf8").trimStart().startsWith("#EXTM3U")) {
        const texte = (await lireBorne(new Response(corps), 2 * 1024 * 1024)).toString("utf8");
        if (m![2] === "0") manifesteRacine = texte;
        const reecrit = reecrireDirect(margeDirect(texte), cible, proxy);
        retenirManifeste(cible, texte);
        q.finir(); res.setHeader("Content-Type", "application/vnd.apple.mpegurl"); res.end(reecrit); return;
      }
      // VLC ne reçoit jamais un autre format de playlist pouvant référencer des URL non réécrites.
      const texteDebut = debut.subarray(0, 4096).toString("utf8").trimStart();
      if (texteDebut.startsWith("<") || /^#|^https?:|^\[playlist\]/i.test(texteDebut)) {
        q.finir(); throw new Error("Format de manifeste non pris en charge");
      }
      const transport = debut[0] === 0x47 && debut[188] === 0x47;
      const mp4 = ["ftyp", "styp", "moof"].includes(debut.subarray(4, 8).toString("ascii"));
      if (m![2] === "0" && !transport && !mp4) { q.finir(); throw new Error("Transport non pris en charge"); }
      clearTimeout(q.timer);
      res.statusCode = q.r.status;
      for (const nom of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const v = q.r.headers.get(nom); if (v) res.setHeader(nom, v);
      }
      const flux = Readable.fromWeb(corps as never);
      const inactif = setInterval(() => { if (Date.now() - derniereDonnee > 20_000) q.finir(); }, 2_000);
      let derniereDonnee = Date.now();
      flux.on("data", () => { derniereDonnee = Date.now(); });
      res.once("close", () => { clearInterval(inactif); flux.destroy(); });
      flux.once("error", () => res.destroy());
      if (req.method === "HEAD") { q.finir(); res.end(); } else flux.pipe(res);
    } catch (e) {
      incident = e instanceof Error && /^Relais HTTP \d+$/.test(e.message) ? e.message : "Relais temporairement indisponible";
      const ancien = manifestes.get(cible);
      if (ancien && !/^Relais HTTP (?:401|403|404)$/.test(incident) && Date.now() - ancien.date <= 60_000 && !res.headersSent) {
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.end(reecrireDirect(margeDirect(ancien.texte, (Date.now() - ancien.date) / 1000), cible, proxy));
      } else { if (!res.headersSent) res.writeHead(502); res.end(); }
    }
  });
  await new Promise<void>((resolve, reject) => { serveur.once("error", reject); serveur.listen(0, "127.0.0.1", resolve); });
  const adresse = serveur.address(); if (!adresse || typeof adresse === "string") throw new Error("Relais indisponible");
  local = `http://127.0.0.1:${adresse.port}`;
  const url = proxy(new URL(source, origine).href);
  // Précharge la fenêtre sélectionnée, indépendamment du rythme des demandes de VLC.
  const intervalle = setInterval(() => {
    if (ferme || remplissage || Date.now() - actif > 30_000) return;
    for (const [id, date] of utilisees) {
      const u = urls.get(id)!;
      if (id !== "0" && !manifestes.has(u) && Date.now() - date > 120_000) {
        urls.delete(id); ids.delete(u); utilisees.delete(id); nonCacheables.delete(u);
      }
    }
    remplissage = true;
    void (async () => {
      for (const [adresse, ancien] of manifestes) {
        if (Date.now() - ancien.demande > 60_000) { manifestes.delete(adresse); continue; }
        if (Date.now() - ancien.demande > 20_000) continue;
        try {
          const q = await requete(adresse);
          try {
            const texte = (await lireBorne(q.r, 2 * 1024 * 1024)).toString("utf8");
            reecrireDirect(texte, adresse, proxy); retenirManifeste(adresse, texte);
          } finally { q.finir(); }
          const courant = manifestes.get(adresse) ?? ancien;
          let secondes = 0;
          const selection = [...courant.segments].reverse().filter((s) => { secondes += s.duree; return secondes <= 60; }).reverse();
          for (let i = 0; i < selection.length && !ferme; i += 2) {
            await Promise.allSettled(selection.slice(i, i + 2).filter((s) => !nonCacheables.has(s.url)).map((s) => segment(s.url)));
          }
        } catch { /* Le cache déjà chargé reste utilisable pendant la coupure. */ }
      }
    })().finally(() => { remplissage = false; });
  }, 3_000);
  return { url,
    renouveler: async (nouvelle: string) => {
      if (ferme || !adresseDirectAutorisee(nouvelle, origine)) return false;
      const ancienne = urls.get("0")!;
      nouvelle = new URL(nouvelle, origine).href;
      if (ancienne === nouvelle) return true;
      const remplacer = (avant: string, apres: string) => {
        const id = ids.get(avant); if (!id) return;
        ids.delete(avant); ids.set(apres, id); urls.set(id, apres); utilisees.set(id, Date.now());
        const manifeste = manifestes.get(avant);
        if (manifeste) { manifestes.delete(avant); manifestes.set(apres, manifeste); }
      };
      // Une playlist maître ne se recharge pas toujours dans VLC. Conserver ses URL locales
      // tout en remplaçant leurs accès NAS, seulement si la disposition des variantes est identique.
      if (manifesteRacine.includes("#EXT-X-STREAM-INF:")) {
        const q = await requete(nouvelle);
        try {
          const texte = (await lireBorne(q.r, 2 * 1024 * 1024)).toString("utf8");
          const avant: string[] = [], apres: string[] = [];
          const structureAvant = reecrireDirect(manifesteRacine, ancienne, (u) => { avant.push(u); return "URI"; });
          const structureApres = reecrireDirect(texte, nouvelle, (u) => {
            if (!adresseDirectAutorisee(u, origine)) throw new Error("Adresse refusée"); apres.push(u); return "URI";
          });
          if (structureAvant !== structureApres || avant.length !== apres.length) return false;
          avant.forEach((u, i) => remplacer(u, apres[i]!));
          manifesteRacine = texte;
        } finally { q.finir(); }
      }
      remplacer(ancienne, nouvelle); return true;
    },
    diagnostic: () => {
      let reserve = 0;
      for (const p of manifestes.values()) {
        const index = p.segments.findIndex((s) => s.url === dernierSegmentServi);
        if (index < 0) continue;
        let total = 0;
        for (const s of p.segments.slice(index + 1)) { if (!cache.lire(s.url)) break; total += s.duree; }
        reserve = Math.max(reserve, total);
      }
      return { cacheOctets: cache.octets, reserveCacheSecondes: reserve, incident };
    },
    fermer: async () => {
      ferme = true; clearInterval(intervalle); for (const a of arrets) a.abort();
      cache.vider(); manifestes.clear(); urls.clear(); ids.clear(); utilisees.clear(); nonCacheables.clear(); serveur.closeAllConnections();
      await new Promise<void>((resolve) => serveur.close(() => resolve()));
    },
  };
}
