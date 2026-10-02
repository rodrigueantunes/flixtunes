import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { commandeDiffusionSchema, contenuDiffuseSchema, etatDiffusionSchema, etatDiffusionVide, type EtatDiffusion } from "@flixtunes/contracts";
import { jetonDeLaRequete, sessionDuJeton } from "./sessions-profil.js";
import { RegistreDiffusion } from "./diffusion-registre.js";
import { DecouverteDiffusion } from "./diffusion-reseau.js";
import { contenuAutorise, MediasDiffusion, origineDiffusion, type MediaDiffuse } from "./diffusion-medias.js";
import { ErreurCast, TransportCast } from "./diffusion-cast.js";
import { TransportDlna } from "./diffusion-dlna.js";
import { ErreurPreparationDiffusion } from "./diffusion-preparation.js";
import { db } from "./database.js";

const battementSchema = z.object({ cle: z.string().regex(/^[a-f0-9]{64}$/), etat: etatDiffusionSchema,
  accuses: z.array(z.object({ id: z.string().uuid(), ok: z.boolean(), erreur: z.string().max(300).optional() })).max(16).default([]) });
type Lecture = { profil: string; media: MediaDiffuse; transport: TransportCast | TransportDlna; etat: EtatDiffusion; dernierControle: number; progression?: number };

/** Routes volontairement absentes de la liste blanche WAN. Les téléviseurs reçoivent un jeton
 * de média révocable, jamais la session du profil ni un accès générique au NAS. */
export async function routesDiffusion(app: FastifyInstance) {
  const registre = new RegistreDiffusion(), decouverte = new DecouverteDiffusion(), medias = new MediasDiffusion();
  const lectures = new Map<string, Lecture>(), operations = new Set<string>();
  const retirer = async (id: string) => { const l = lectures.get(id); lectures.delete(id); if (l) { l.transport.fermer(); await medias.retirer(l.media.cle); } };
  const timer = setInterval(() => {
    for (const [id, l] of lectures) if (l.media.expire < Date.now() || (["erreur", "repos"].includes(l.etat.lecture) && Date.now() - l.dernierControle > 60_000)) void retirer(id);
  }, 30_000); timer.unref();
  app.addHook("onClose", async () => { clearInterval(timer); decouverte.fermer(); registre.fermer(); await Promise.all([...lectures.keys()].map(retirer)); await medias.fermer(); });
  app.addHook("preHandler", async (req, reply) => {
    if (!req.routeOptions.url?.startsWith("/api/diffusion/")) return;
    if (req.expositionWan) return reply.code(404).send({ message: "Disponible sur le réseau local uniquement" });
    if (req.routeOptions.url === "/api/diffusion/flux/:cle/:nom") return;
    const session = sessionDuJeton(jetonDeLaRequete(req));
    if (!session) return reply.code(401).send({ message: "Reconnectez le profil pour utiliser le cast" });
    req.profilImpose = session.profileId;
  });
  app.get("/api/diffusion/cibles", async (req) => ({ cibles: [
    ...registre.lister(req.profilImpose!),
    ...decouverte.lister().map((c) => { const l = lectures.get(c.id); return { id: c.id, nom: c.nom, protocole: c.protocole,
      etat: l && l.profil === req.profilImpose ? l.etat : null, occupe: !!l && l.profil !== req.profilImpose }; }),
  ] }));
  app.post("/api/diffusion/lecteurs", async (req, reply) => {
    const data = z.object({ nom: z.string().trim().min(1).max(120) }).safeParse(req.body);
    if (!data.success) return reply.code(400).send({ message: "Nom d’appareil invalide" });
    try { return registre.inscrire(req.profilImpose!, data.data.nom); }
    catch { return reply.code(429).send({ message: "Trop d’appareils connectés" }); }
  });
  app.post<{ Params: { id: string } }>("/api/diffusion/lecteurs/:id", async (req, reply) => {
    const data = battementSchema.safeParse(req.body);
    if (!data.success) return reply.code(400).send({ message: "État du lecteur invalide" });
    const ordres = registre.battre(req.params.id, req.profilImpose!, data.data.cle, data.data.etat, data.data.accuses);
    return ordres ? { ordres } : reply.code(404).send({ message: "Lecteur déconnecté" });
  });
  app.get<{ Params: { id: string; ordre: string } }>("/api/diffusion/cibles/:id/ordres/:ordre", async (req) => ({ resultat: registre.resultat(req.params.id, req.profilImpose!, req.params.ordre) }));
  app.post<{ Params: { id: string } }>("/api/diffusion/cibles/:id/commande", async (req, reply) => {
    const data = commandeDiffusionSchema.safeParse(req.body);
    if (!data.success) return reply.code(400).send({ message: "Commande invalide" });
    const c = data.data, profil = req.profilImpose!, id = req.params.id;
    if (c.type === "charger") {
      const contenu = contenuAutorise(profil, c.contenu); if (!contenu) return reply.code(404).send({ message: "Contenu inaccessible" }); c.contenu = contenu;
    }
    if (id.startsWith("ft-")) {
      try { const ordre = registre.commander(id, profil, c); return ordre ? reply.code(202).send({ ordre }) : reply.code(404).send({ message: "Lecteur hors ligne" }); }
      catch { return reply.code(429).send({ message: "Le lecteur ne répond pas encore" }); }
    }
    const cible = decouverte.trouver(id); if (!cible) return reply.code(404).send({ message: "Récepteur hors ligne" });
    const courante = lectures.get(id);
    if (courante && courante.profil !== profil) return reply.code(409).send({ message: "Ce récepteur est utilisé par un autre profil" });
    if (operations.has(id)) return reply.code(409).send({ message: "Une commande est déjà en cours" });
    operations.add(id);
    try {
      const chargement = c.type === "charger" ? c : c.type === "position" && courante?.media.session && !courante.media.direct
        ? { contenu: courante.media.contenu, position: c.valeur } : null;
      if (chargement) {
        const maximumEssais = chargement.contenu.genre === "direct" ? 2 : 3;
        for (let tentative = 0; tentative < maximumEssais; tentative++) {
        let media: MediaDiffuse;
        const etat: EtatDiffusion = { ...etatDiffusionVide(), contenu: chargement.contenu, lecture: "chargement" as const };
        const actualiser = (e: Partial<EtatDiffusion>) => {
          // GET_STATUS peut envoyer le volume avant toute préparation média. Sans garde,
          // undefined === undefined entrait dans la branche et levait sur l.etat.
          if (!media) { if (e.volume != null) etat.volume = e.volume; return; }
          const l = lectures.get(id); if (l && l.media === media) {
          l.etat = { ...l.etat, ...e, position: (e.position ?? Math.max(0, l.etat.position - media.decalage)) + media.decalage,
            duree: media.duree || e.duree || l.etat.duree, navigation: !media.direct };
          media.vu = Date.now();
          if (!media.direct && l.etat.duree > 0 && l.etat.position > 0 && Date.now() - (l.progression ?? 0) > 10_000
            && contenuAutorise(profil, media.contenu)) {
            l.progression = Date.now();
            db.prepare(`INSERT INTO playback_progress (profile_id, media_id, position_seconds, duration_seconds, completed, updated_at)
              VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(profile_id, media_id) DO UPDATE SET
              position_seconds=excluded.position_seconds, duration_seconds=excluded.duration_seconds,
              completed=excluded.completed, updated_at=CURRENT_TIMESTAMP`).run(profil, media.contenu.id,
                l.etat.position, l.etat.duree, l.etat.position / l.etat.duree >= .9 ? 1 : 0);
          }
        } };
        const transport = cible.protocole === "googlecast" ? new TransportCast(cible, actualiser) : new TransportDlna(cible, actualiser);
        try {
          // La connexion est vérifiée avant de réserver une conversion sur le NAS.
          if (transport instanceof TransportCast) {
            try { await transport.verifier(); }
            catch (e) {
              app.log.warn({ protocole: "googlecast", phase: "connexion",
                code: e instanceof ErreurCast ? e.code : "CAST_CONNEXION" }, "Échec de vérification Cast avant préparation média");
              throw e;
            }
          }
          if (courante?.media.direct && chargement.contenu.genre === "direct") await retirer(id);
          media = await medias.preparer(profil, chargement.contenu,
            origineDiffusion(req.headers.host ?? "", req.protocol, req.raw.socket.localAddress, req.raw.socket.localPort), chargement.position, { qualiteSource: tentative === 0, compatible: tentative === maximumEssais - 1 });
        } catch (e) {
          transport.fermer();
          const repli = tentative < maximumEssais - 1 && e instanceof ErreurPreparationDiffusion && e.repliPossible;
          if (!(e instanceof ErreurCast)) app.log.warn({ protocole: cible.protocole, phase: "preparation",
            code: e instanceof ErreurPreparationDiffusion || e instanceof ErreurCast ? e.code : "CAST_PREPARATION", repli },
            "Échec de préparation de diffusion");
          if (repli) continue;
          throw e;
        }
        await retirer(id);
        etat.contenu = media.contenu; etat.qualite = media.qualite;
        lectures.set(id, { profil, media, etat, transport, dernierControle: Date.now() });
        try {
          if (transport instanceof TransportCast) await transport.charger(media.url, media.mime, media.contenu.titre, media.direct, media.position, media.segmentsFmp4);
          else await transport.charger(media.url, media.mime, media.contenu.titre, media.direct, media.position);
          if (c.type === "position" && courante?.etat.lecture === "pause") await transport.commander({ type: "pause" }); }
        catch (e) {
          await retirer(id);
          const repli = tentative < maximumEssais - 1 && (e instanceof ErreurCast
            ? /^CAST_(LOAD_FAILED|MEDIA|DEMARRAGE|DELAI_LOAD)/.test(e.code)
            : cible.protocole === "dlna" && /SetAVTransportURI|Play|démarrage/.test(e instanceof Error ? e.message : ""));
          app.log.warn({ protocole: cible.protocole, phase: "chargement", requetesMedia: media.requetes ?? 0,
            code: e instanceof ErreurCast ? e.code : "RECEPTEUR", repli }, "Échec de diffusion");
          if (repli) continue;
          if (e instanceof ErreurCast && /^CAST_(LOAD_FAILED|MEDIA|DEMARRAGE|DELAI_LOAD)/.test(e.code) && !media.requetes) {
            throw new Error(`${e.message} Le récepteur n’a demandé aucun média au NAS : vérifiez son accès à l’adresse locale et au port FlixTunes.`);
          }
          throw e;
        }
        app.log.info({ protocole: cible.protocole, qualite: media.qualite, position: lectures.get(id)?.etat.position }, "Lecture distante confirmée");
        return { ok: true };
        }
      }
      if (!courante || c.type === "charger") return reply.code(409).send({ message: "Lancez un contenu sur ce récepteur avant de le piloter" });
      if (c.type === "position" && (!courante.etat.navigation || courante.media.direct)) return reply.code(409).send({ message: "Déplacement indisponible pour ce flux" });
      await courante.transport.commander(c); courante.dernierControle = Date.now();
      if (c.type === "arreter") await retirer(id);
      return { ok: true };
    } catch (e) { return reply.code(502).send({ message: e instanceof Error ? e.message : "Diffusion impossible" }); }
    finally { operations.delete(id); }
  });
  app.post("/api/diffusion/airplay", async (req, reply) => {
    const data = z.object({ contenu: contenuDiffuseSchema, position: z.number().min(0).max(604800).default(0), compatible: z.boolean().default(false) }).safeParse(req.body);
    if (!data.success) return reply.code(400).send({ message: "Contenu invalide" });
    try { const m = await medias.preparer(req.profilImpose!, data.data.contenu,
      origineDiffusion(req.headers.host ?? "", req.protocol, req.raw.socket.localAddress, req.raw.socket.localPort), data.data.position, { compatible: data.data.compatible, qualiteSource: !data.data.compatible });
      return { url: m.url, cle: m.cle, position: m.position, expire: m.expire, decalage: m.decalage }; }
    catch (e) { return reply.code(502).send({ message: e instanceof Error ? e.message : "AirPlay indisponible" }); }
  });
  app.post<{ Params: { cle: string } }>("/api/diffusion/airplay/:cle/arreter", async (req, reply) => {
    return await medias.retirerPourProfil(req.params.cle, req.profilImpose!) ? { ok: true } : reply.code(404).send({ message: "Diffusion expirée" });
  });
  app.get<{ Params: { cle: string; nom: string } }>("/api/diffusion/flux/:cle/:nom", (req, reply) => medias.servir(req.params.cle, req.params.nom, req, reply));
}
