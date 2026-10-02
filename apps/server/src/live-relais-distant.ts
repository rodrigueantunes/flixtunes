import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import { adresseLiveDistante, lireAccesLiveDistant } from "./live-acces-distant.js";
import { recupererPublic } from "./live-http-public.js";
import { adresseRelayee, estUnManifeste, recupererSansSortirDuPublic, reecrireManifeste } from "./live-relais.js";

const actifs = new Map<string, number>();

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
    if (acces.usage === "image") {
      if (!["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(type)) {
        liberer(); return reply.code(502).send({ message: "Image indisponible" });
      }
      const image = await lireCorpsBorne(amont, 4 * 1024 * 1024);
      liberer();
      return reply.type(type).send(image);
    }
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
