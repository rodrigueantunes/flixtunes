import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import { adresseLiveDistante, lireAccesLiveDistant } from "./live-acces-distant.js";
import { recupererPublic } from "./live-http-public.js";
import { adresseRelayee, estUnManifeste, recupererSansSortirDuPublic, reecrireManifeste } from "./live-relais.js";

const actifs = new Map<string, number>();

/**
 * Les logos du direct, à part des flux (r11).
 *
 * Ils passaient par le même plafond que la vidéo — 24 requêtes simultanées par profil. Une grille de
 * chaînes en demande des dizaines d'un coup : du 4 au 13 octobre, l'application de bureau a reçu 306
 * refus 429 sur ce relais pour 200 réponses servies, autant de logos remplacés par une initiale. Ils
 * attendent désormais leur tour dans une file courte, et un logo déjà servi l'est depuis la mémoire.
 */
const IMAGES_SIMULTANEES = 6;
const ATTENTE_IMAGE_MS = 10_000;
const CACHE_IMAGES_OCTETS = 24 * 1024 * 1024;
const VIE_IMAGE_MS = 12 * 3600_000;
const VIE_ECHEC_MS = 10 * 60_000;
type ImageRetenue = { type: string; image: Buffer; expire: number } | { echec: true; expire: number };
const imagesRetenues = new Map<string, ImageRetenue>();
let octetsRetenus = 0;
let imagesEnCours = 0;
const fileImages: Array<() => void> = [];

function retenirImage(url: string, valeur: ImageRetenue) {
  const ancienne = imagesRetenues.get(url);
  if (ancienne && "image" in ancienne) octetsRetenus -= ancienne.image.byteLength;
  imagesRetenues.delete(url);
  imagesRetenues.set(url, valeur);
  if ("image" in valeur) octetsRetenus += valeur.image.byteLength;
  // Les plus anciennes partent d'abord : une Map garde l'ordre d'insertion.
  for (const [cle, v] of imagesRetenues) {
    if (octetsRetenus <= CACHE_IMAGES_OCTETS && imagesRetenues.size <= 2000) break;
    imagesRetenues.delete(cle);
    if ("image" in v) octetsRetenus -= v.image.byteLength;
  }
}

/** Une place pour télécharger un logo, ou `false` après dix secondes d'attente. */
async function placeImage(): Promise<boolean> {
  if (imagesEnCours < IMAGES_SIMULTANEES) { imagesEnCours++; return true; }
  return await new Promise<boolean>((resolve) => {
    const tour = () => { clearTimeout(delai); imagesEnCours++; resolve(true); };
    const delai = setTimeout(() => { const i = fileImages.indexOf(tour); if (i >= 0) fileImages.splice(i, 1); resolve(false); }, ATTENTE_IMAGE_MS);
    fileImages.push(tour);
  });
}
function rendrePlaceImage() { imagesEnCours--; fileImages.shift()?.(); }

/** Pour les tests : repartir d'une mémoire vide. */
export function oublierImagesRelayees() { imagesRetenues.clear(); octetsRetenus = 0; }

async function relayerImage(url: string, reply: FastifyReply) {
  const retenue = imagesRetenues.get(url);
  if (retenue && retenue.expire > Date.now()) {
    if ("echec" in retenue) return reply.code(502).send({ message: "Image indisponible" });
    return reply.header("Cache-Control", "private, max-age=3600").header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox").type(retenue.type).send(retenue.image);
  }
  if (!await placeImage()) return reply.code(429).header("Retry-After", "2").send({ message: "Trop d’images demandées" });
  try {
    const suivie = await recupererSansSortirDuPublic(url, { signal: AbortSignal.timeout(15_000), headers: { "User-Agent": "FlixTunes" } }, recupererPublic);
    if (!suivie) return reply.code(403).send({ message: "Adresse interne refusée" });
    const amont = suivie.reponse;
    const type = (amont.headers.get("content-type") ?? "").split(";")[0]!.toLowerCase();
    if (!amont.ok || !amont.body || !["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(type)) {
      await amont.body?.cancel().catch(() => undefined);
      retenirImage(url, { echec: true, expire: Date.now() + VIE_ECHEC_MS });
      return reply.code(502).send({ message: "Image indisponible" });
    }
    const image = await lireCorpsBorne(amont, 4 * 1024 * 1024);
    retenirImage(url, { type, image, expire: Date.now() + VIE_IMAGE_MS });
    return reply.header("Cache-Control", "private, max-age=3600").header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox").type(type).send(image);
  } catch {
    retenirImage(url, { echec: true, expire: Date.now() + VIE_ECHEC_MS });
    return reply.code(502).send({ message: "Image indisponible" });
  } finally { rendrePlaceImage(); }
}

/** Certains fournisseurs servent HLS sans extension et avec un type générique. */
async function detecterManifeste(reponse: Response): Promise<{ reponse: Response; manifeste: boolean }> {
  const lecteur = reponse.body!.getReader();
  const debut: Uint8Array[] = [];
  let taille = 0, termine = false;
  while (taille < 512) {
    const lu = await lecteur.read();
    if (lu.done) { termine = true; break; }
    debut.push(lu.value); taille += lu.value.byteLength;
  }
  const extrait = Buffer.concat(debut);
  const corps = new ReadableStream<Uint8Array>({
    start(controleur) { controleur.enqueue(extrait); if (termine) controleur.close(); },
    async pull(controleur) {
      const lu = await lecteur.read();
      if (lu.done) controleur.close(); else controleur.enqueue(lu.value);
    },
    cancel(raison) { return lecteur.cancel(raison); },
  });
  return { reponse: new Response(corps, { status: reponse.status, headers: reponse.headers }),
    manifeste: extrait.subarray(0, 512).toString("utf8").trimStart().startsWith("#EXTM3U") };
}

/** Le LAN bénéficie des mêmes limites de corps et d'inactivité que le WAN. */
export async function relayerLiveLocal(request: FastifyRequest, reply: FastifyReply, cible: string) {
  const arret = new AbortController();
  const liberer = () => arret.abort();
  reply.raw.once("close", liberer);
  reply.raw.once("finish", liberer);
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  try {
    const suivie = await recupererSansSortirDuPublic(cible, {
      signal: arret.signal,
      headers: { "User-Agent": "FlixTunes", ...(request.headers.range ? { Range: request.headers.range } : {}) },
    }, recupererPublic);
    if (!suivie) return reply.code(403).send({ message: "Adresse interne refusée" });
    if (!suivie.reponse.ok || !suivie.reponse.body) {
      await suivie.reponse.body?.cancel();
      return reply.code(502).send({ message: "Source indisponible" });
    }
    minuterie = setTimeout(liberer, 20_000);
    const detection = await detecterManifeste(suivie.reponse);
    const amont = detection.reponse;
    reply.header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff");
    if (detection.manifeste) {
      const corps = (await lireCorpsBorne(amont, 2 * 1024 * 1024)).toString("utf8");
      return reply.type("application/vnd.apple.mpegurl").send(reecrireManifeste(corps, suivie.url, adresseRelayee));
    }
    // Les médias continus sont bornés par l'inactivité réseau, pas par leur durée totale.
    clearTimeout(minuterie); minuterie = undefined;
    reply.code(amont.status === 206 ? 206 : 200).type(amont.headers.get("content-type") ?? "application/octet-stream");
    for (const nom of ["content-length", "content-range", "accept-ranges"]) {
      const valeur = amont.headers.get(nom);
      if (valeur) reply.header(nom, valeur);
    }
    return reply.send(Readable.fromWeb(amont.body as never));
  } catch {
    liberer();
    return reply.code(502).send({ message: "Relais temporairement indisponible" });
  } finally { clearTimeout(minuterie); }
}
export async function lireCorpsBorne(reponse: Response, limite: number): Promise<Buffer> {
  const lecteur = reponse.body!.getReader();
  const morceaux: Uint8Array[] = [];
  let taille = 0;
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      taille += value.byteLength;
      if (taille > limite) throw new Error("Réponse trop volumineuse");
      morceaux.push(value);
    }
    return Buffer.concat(morceaux);
  } finally { await lecteur.cancel().catch(() => undefined); }
}

/** Chaque accès reste lié à la session ; aucune adresse libre ne peut être demandée. */
export async function relayerLiveDistant(request: FastifyRequest, reply: FastifyReply, profil: string) {
  const { t } = request.query as { t?: string };
  const acces = lireAccesLiveDistant(t, profil);
  if (!acces) return reply.code(404).send({ message: "Adresse inconnue" });
  if (acces.usage === "image") return relayerImage(acces.url, reply);
  if ((actifs.get(profil) ?? 0) >= 24) return reply.code(429).header("Retry-After", "2").send({ message: "Trop de lectures simultanées" });
  actifs.set(profil, (actifs.get(profil) ?? 0) + 1);
  const arret = new AbortController();
  let libere = false;
  const liberer = () => {
    if (libere) return;
    libere = true;
    arret.abort();
    const reste = (actifs.get(profil) ?? 1) - 1;
    if (reste) actifs.set(profil, reste); else actifs.delete(profil);
  };
  reply.raw.once("close", liberer);
  reply.raw.once("finish", liberer);
  try {
    const suivie = await recupererSansSortirDuPublic(acces.url, {
      signal: arret.signal,
      headers: { "User-Agent": "FlixTunes", ...(request.headers.range ? { Range: request.headers.range } : {}) },
    }, recupererPublic);
    if (!suivie) { liberer(); return reply.code(403).send({ message: "Adresse interne refusée" }); }
    let amont = suivie.reponse;
    if (!amont.ok || !amont.body) { liberer(); return reply.code(502).send({ message: "Source indisponible" }); }
    const type = (amont.headers.get("content-type") ?? "").split(";")[0]!.toLowerCase();
    reply.header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox");
    let manifeste = type.includes("mpegurl") || /\.m3u8(?:\?|$)/i.test(suivie.url);
    if (!manifeste) {
      const detection = await detecterManifeste(amont);
      amont = detection.reponse; manifeste = detection.manifeste;
    }
    if (manifeste) {
      const corps = (await lireCorpsBorne(amont, 2 * 1024 * 1024)).toString("utf8");
      if (!estUnManifeste(type, corps)) throw new Error("Manifeste invalide");
      const manifeste = reecrireManifeste(corps, suivie.url,
        (url) => adresseLiveDistante(url, profil, acces.chaine));
      liberer();
      return reply.type("application/vnd.apple.mpegurl").send(manifeste);
    }
    reply.code(amont.status === 206 ? 206 : 200).type("application/octet-stream");
    for (const nom of ["content-length", "content-range", "accept-ranges"]) {
      const valeur = amont.headers.get(nom);
      if (valeur) reply.header(nom, valeur);
    }
    return reply.send(Readable.fromWeb(amont.body as never));
  } catch {
    liberer();
    return reply.code(502).send({ message: "Relais temporairement indisponible" });
  }
}
