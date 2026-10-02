import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { recupererPublic } from "./live-http-public.js";
import { recupererSansSortirDuPublic, reecrireManifeste } from "./live-relais.js";
import { lireCorpsBorne } from "./live-relais-distant.js";

export type FormatLive = "hls" | "dash" | "ts" | "mp4" | "inconnu";
export function reconnaitreFormat(octets: Uint8Array, type = ""): FormatLive {
  const texte = Buffer.from(octets).toString("utf8").trimStart();
  if (texte.startsWith("#EXTM3U") || /mpegurl/i.test(type)) return "hls";
  if (/<(?:[\w-]+:)?MPD\b/.test(texte) || /dash\+xml/i.test(type)) return "dash";
  if (octets[0] === 0x47 && octets[188] === 0x47) return "ts";
  if (Buffer.from(octets).subarray(4, 8).toString() === "ftyp") return "mp4";
  if (/video\/mp2t/i.test(type)) return "ts";
  if (/video\/mp4/i.test(type)) return "mp4";
  return "inconnu";
}

export async function formatLive(url: string): Promise<FormatLive> {
  const arret = new AbortController();
  const timer = setTimeout(() => arret.abort(), 5_000);
  try {
    const suivie = await recupererSansSortirDuPublic(url, { signal: arret.signal }, recupererPublic);
    if (!suivie?.reponse.ok || !suivie.reponse.body) return "inconnu";
    const lecteur = suivie.reponse.body.getReader();
    const morceaux: Uint8Array[] = []; let taille = 0;
    try {
      while (taille < 1024) {
        const lu = await lecteur.read(); if (lu.done) break;
        morceaux.push(lu.value.subarray(0, 1024 - taille)); taille += morceaux.at(-1)!.length;
      }
      return reconnaitreFormat(Buffer.concat(morceaux), suivie.reponse.headers.get("content-type") ?? "");
    } finally { await lecteur.cancel().catch(() => undefined); }
  } catch { return "inconnu"; }
  finally { clearTimeout(timer); arret.abort(); }
}

/** Réécrit les URL DASH sans casser les substitutions $Number$/$Time$. */
export function reecrireDash(texte: string, base: string, proxy: (url: string) => string): string {
  if (/<!DOCTYPE|<!ENTITY|xlink:|<[^>]*(?:ContentProtection|ContentSteering)\b/i.test(texte)) throw new Error("Manifeste non pris en charge");
  const options = { preserveOrder: true, ignoreAttributes: false, parseTagValue: false, trimValues: false };
  const arbre = new XMLParser(options).parse(texte) as any[];
  if (!arbre.some((n) => n.MPD)) throw new Error("Manifeste DASH invalide");
  const visiter = (noeuds: any[], parent: string, profondeur = 0) => {
    if (profondeur > 30) throw new Error("Manifeste trop profond");
    for (const noeud of noeuds) {
      const nom = Object.keys(noeud).find((n) => n !== ":@" && !n.startsWith("#") && !n.startsWith("?"));
      if (!nom || !Array.isArray(noeud[nom])) continue;
      const enfants = noeud[nom] as any[];
      const bases = enfants.filter((n) => n.BaseURL);
      const effective = bases.length ? new URL(String(bases[0].BaseURL.find((n: any) => n["#text"] !== undefined)?.["#text"] ?? "").trim(), parent).href : parent;
      if (bases.length > 1) throw new Error("Plusieurs bases DASH non prises en charge");
      for (const b of bases) b.BaseURL = [{ "#text": proxy(effective) }];
      if (nom === "MPD" && !bases.length) enfants.unshift({ BaseURL: [{ "#text": proxy(parent) }] });
      const attributs = noeud[":@"] ?? {};
      for (const [cle, valeur] of Object.entries(attributs)) {
        if (["@_media", "@_initialization", "@_sourceURL", "@_index"].includes(cle)) {
          attributs[cle] = proxy(new URL(String(valeur), effective).href);
        }
        if (cle === "@_xml:base") throw new Error("Base XML non prise en charge");
      }
      // Les mises à l'heure et redirections facultatives ne sont pas utilisées par la conversion.
      for (let i = enfants.length - 1; i >= 0; i--) if (enfants[i].UTCTiming || enfants[i].Location) enfants.splice(i, 1);
      visiter(enfants.filter((n) => !n.BaseURL), effective, profondeur + 1);
    }
  };
  visiter(arbre, base);
  return new XMLBuilder(options).build(arbre);
}

/** FFmpeg ne reçoit que des URL de cette passerelle locale ; chaque requête amont est contrôlée. */
export async function ouvrirEntreeLive(source: string) {
  const secret = randomBytes(24).toString("hex");
  const origines = new Map<string, string>();
  const controles = new Set<AbortController>();
  let origineLocale = "";
  const proxy = (url: string) => {
    const cible = new URL(url);
    if (!["http:", "https:"].includes(cible.protocol)) throw new Error("Protocole refusé");
    let id = [...origines].find(([, origine]) => origine === cible.origin)?.[0];
    if (!id) {
      if (origines.size >= 64) throw new Error("Trop d'origines");
      id = randomBytes(12).toString("hex"); origines.set(id, cible.origin);
    }
    return `${origineLocale}/${secret}/${id}${cible.pathname}${cible.search}`;
  };
  const serveur = createServer(async (req, res) => {
    const chemin = /^\/([a-f0-9]+)\/([a-f0-9]+)(\/.*)$/.exec(req.url ?? "");
    const origine = chemin && chemin[1] === secret ? origines.get(chemin[2]!) : null;
    if (!origine || !chemin || controles.size >= 16) { res.writeHead(404).end(); return; }
    // La concaténation garde le domaine validé même pour un chemin commençant par //.
    const cible = new URL(origine + chemin[3]);
    if (cible.origin !== origine) { res.writeHead(404).end(); return; }
    const arret = new AbortController(); controles.add(arret);
    const echeance = setTimeout(() => arret.abort(), 20_000);
    res.once("close", () => { clearTimeout(echeance); arret.abort(); controles.delete(arret); });
    try {
      const suivie = await recupererSansSortirDuPublic(cible.href, {
        signal: arret.signal, headers: { "User-Agent": "FlixTunes", ...(req.headers.range ? { Range: req.headers.range } : {}) },
      }, recupererPublic);
      if (!suivie?.reponse.ok || !suivie.reponse.body) { await suivie?.reponse.body?.cancel(); res.writeHead(502).end(); return; }
      const amont = suivie.reponse;
      const lecteur = amont.body!.getReader();
      const morceaux: Uint8Array[] = []; let taille = 0, termine = false;
      while (taille < 1024) {
        const lu = await lecteur.read(); if (lu.done) { termine = true; break; }
        morceaux.push(lu.value); taille += lu.value.length;
      }
      const debut = Buffer.concat(morceaux);
      let format = reconnaitreFormat(debut.subarray(0, 4096), amont.headers.get("content-type") ?? "");
      if (format === "inconnu" && (debut.toString("utf8").trimStart().startsWith("<?xml") || /\.mpd(?:\?|$)/i.test(suivie.url))) format = "dash";
      const corps = new ReadableStream<Uint8Array>({
        start(c) { if (debut.length) c.enqueue(debut); if (termine) c.close(); },
        async pull(c) { const lu = await lecteur.read(); if (lu.done) c.close(); else c.enqueue(lu.value); },
        cancel(r) { return lecteur.cancel(r); },
      });
      if (format === "hls" || format === "dash") {
        const texte = (await lireCorpsBorne(new Response(corps), 2 * 1024 * 1024)).toString("utf8");
        if (format === "hls" && (!texte.trimStart().startsWith("#EXTM3U") || /URI\s*=\s*[^"\s]/i.test(texte))) throw new Error("Manifeste HLS invalide");
        if (format === "hls" && /#EXT-X-(?:KEY|SESSION-KEY):[^\n]*METHOD=(?!NONE|AES-128)[^,\r\n]+/i.test(texte)) throw new Error("Chiffrement non pris en charge");
        const reecrit = format === "hls" ? reecrireManifeste(texte, suivie.url, proxy) : reecrireDash(texte, suivie.url, proxy);
        res.setHeader("Content-Type", format === "hls" ? "application/vnd.apple.mpegurl" : "application/dash+xml");
        res.end(reecrit); return;
      }
      res.statusCode = amont.status;
      for (const nom of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const valeur = amont.headers.get(nom); if (valeur) res.setHeader(nom, valeur);
      }
      const flux = Readable.fromWeb(corps as never);
      // Un flux binaire est continu ; seul le manifeste doit finir dans les 20 secondes.
      clearTimeout(echeance);
      flux.once("error", () => res.destroy());
      flux.pipe(res);
    } catch { if (!res.headersSent) res.writeHead(502); res.end(); }
  });
  await new Promise<void>((resolve, reject) => { serveur.once("error", reject); serveur.listen(0, "127.0.0.1", resolve); });
  const adresse = serveur.address();
  if (!adresse || typeof adresse === "string") throw new Error("Passerelle indisponible");
  origineLocale = `http://127.0.0.1:${adresse.port}`;
  return { url: proxy(source), fermer: async () => {
    for (const c of controles) c.abort();
    serveur.closeAllConnections();
    await new Promise<void>((resolve) => serveur.close(() => resolve()));
  } };
}
