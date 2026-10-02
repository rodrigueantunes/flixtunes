import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { commandeDiffusionSchema, contenuDiffuseSchema, etatDiffusionSchema, etatDiffusionVide, type ContenuDiffuse, type EtatDiffusion } from "@flixtunes/contracts";
import { jetonDeLaRequete, sessionDuJeton } from "./sessions-profil.js";
import { RegistreDiffusion } from "./diffusion-registre.js";
import { DecouverteDiffusion, type Recepteur } from "./diffusion-reseau.js";
import { contenuAutorise, MediasDiffusion, mimeDuFichier, origineDiffusion, type MediaDiffuse } from "./diffusion-medias.js";
import { ErreurCast, TransportCast } from "./diffusion-cast.js";
import { dlnaLitLeConteneur, dlnaLitLeHls, TransportDlna } from "./diffusion-dlna.js";
import { ErreurPreparationDiffusion } from "./diffusion-preparation.js";
import { capacitesConnues, enseignement, planDeQualite, retenirCapacites, segmentDemande, servirSonde, SONDES,
  type CapacitesRecepteur, type NiveauDiffusion, type NomSonde, type SourceVideo } from "./diffusion-sonde.js";
import { getPlaybackInfo } from "./playback.js";
import { db, getProfile } from "./database.js";

const battementSchema = z.object({ cle: z.string().regex(/^[a-f0-9]{64}$/), etat: etatDiffusionSchema,
  accuses: z.array(z.object({ id: z.string().uuid(), ok: z.boolean(), erreur: z.string().max(300).optional() })).max(16).default([]) });
type Lecture = { profil: string; media: MediaDiffuse; transport: TransportCast | TransportDlna; etat: EtatDiffusion;
  dernierControle: number; progression?: number; repos?: number };
/** Une diffusion en cours de préparation : son étape est visible de tous les clients du profil. */
type Operation = { id: string; profil: string; controle: AbortController; etat: EtatDiffusion; fin: Promise<void> };
type Chargement = { contenu: ContenuDiffuse; position: number };

const REFUS_CAST = /^CAST_(LOAD_FAILED|MEDIA|DEMARRAGE|DELAI_LOAD)/;

class Annulation extends Error { constructor() { super("Diffusion annulée"); this.name = "Annulation"; } }

/** Ce que la source impose au plan : codec, définition, HDR, et si le fichier est servi tel quel. */
async function sourceVideo(id: string): Promise<SourceVideo | null> {
  const info = await getPlaybackInfo(id).catch(() => null);
  const video = info?.streams.find((flux) => flux.type === "video");
  if (!info || !video) return null;
  return { codec: video.codec, hauteur: Math.min(video.height ?? 0, video.width ?? 0) || video.height || 0,
    hdr: video.hdrFormat !== "sdr", mp4Direct: /mp4|mov/i.test(info.container) && video.codec === "h264" };
}

function libelleNiveau(niveau: NiveauDiffusion): string {
  if (niveau.qualiteSource) return "Vidéo source conservée";
  return niveau.compatible ? "Conversion compatible · 720p maximum" : `Conversion · ${niveau.hauteurMax}p maximum`;
}

/** Routes volontairement absentes de la liste blanche WAN. Les téléviseurs reçoivent un jeton
 * de média révocable, jamais la session du profil ni un accès générique au NAS. */
export async function routesDiffusion(app: FastifyInstance) {
  const registre = new RegistreDiffusion(), decouverte = new DecouverteDiffusion(), medias = new MediasDiffusion();
  const lectures = new Map<string, Lecture>(), operations = new Map<string, Operation>();
  /** Le dernier échec d'une préparation, montré une minute aux clients qui suivent la cible. */
  const echecs = new Map<string, { profil: string; etat: EtatDiffusion; jusqua: number }>();
  /**
   * Retire une lecture. `liberer` rend d'abord le téléviseur libre — arrêt du média et fermeture de son
   * application Cast — avant que le flux ne soit révoqué : sans cela, un lecteur restait en boucle sur
   * une adresse morte jusqu'au redémarrage du téléviseur.
   */
  const retirer = async (id: string, liberer = false) => {
    const l = lectures.get(id); lectures.delete(id);
    if (!l) return;
    if (liberer) await l.transport.liberer(); else l.transport.fermer();
    await medias.retirer(l.media.cle);
  };
  const nomDuProfil = (profil: string) => getProfile(profil)?.name ?? undefined;
  const timer = setInterval(() => {
    const maintenant = Date.now();
    for (const [id, l] of lectures) {
      // Au repos parce que le média est fini, arrêté ou repris par une autre application : la
      // conversion est libérée vite. Une erreur reste visible une minute.
      // Une lecture en erreur ou expirée libère aussi le téléviseur ; au repos, il l'est déjà.
      const enErreur = l.etat.lecture === "erreur" && maintenant - l.dernierControle > 60_000;
      if (l.media.expire < maintenant || enErreur) void retirer(id, true);
      else if ((l.repos && maintenant - l.repos > 20_000) || (l.etat.lecture === "repos" && maintenant - l.dernierControle > 60_000)) void retirer(id);
    }
    for (const [id, e] of echecs) if (e.jusqua < maintenant) echecs.delete(id);
  }, 10_000); timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer); for (const op of operations.values()) op.controle.abort();
    decouverte.fermer(); registre.fermer(); await Promise.all([...lectures.keys()].map((id) => retirer(id))); await medias.fermer();
  });
  // Découverte dès le démarrage : la liste est prête à la première ouverture du panneau.
  decouverte.demarrer();
  app.addHook("preHandler", async (req, reply) => {
    if (!req.routeOptions.url?.startsWith("/api/diffusion/")) return;
    if (req.expositionWan) return reply.code(404).send({ message: "Disponible sur le réseau local uniquement" });
    if (req.routeOptions.url === "/api/diffusion/flux/:cle/:nom" || req.routeOptions.url === "/api/diffusion/sonde/:dossier/:fichier") return;
    const session = sessionDuJeton(jetonDeLaRequete(req));
    if (!session) return reply.code(401).send({ message: "Reconnectez le profil pour utiliser le cast" });
    req.profilImpose = session.profileId;
  });

  /**
   * L'état montré pour une cible : la préparation en cours, sinon la lecture, sinon le dernier échec.
   *
   * Comme sur YouTube, une diffusion se voit de tous les appareils du réseau, quel que soit le profil,
   * et chacun peut la piloter ; le nom du profil qui l'a lancée l'accompagne. Seul le dernier échec reste
   * propre au profil qui l'a rencontré.
   */
  const etatDe = (id: string, profil: string): { etat: EtatDiffusion | null; occupe: boolean; proprietaire?: string } => {
    const op = operations.get(id), l = lectures.get(id), e = echecs.get(id);
    const proprietaire = op?.profil ?? l?.profil;
    const nom = proprietaire ? nomDuProfil(proprietaire) : undefined;
    if (op) return { etat: op.etat, occupe: false, proprietaire: nom };
    if (l) return { etat: l.etat, occupe: false, proprietaire: nom };
    if (e && e.profil === profil) return { etat: e.etat, occupe: false };
    return { etat: null, occupe: false };
  };

  // Les clients interrogent ces routes toutes les deux ou trois secondes : les journaliser noyait le
  // journal du NAS, qui pesait 940 Mo le 2 octobre 2026, presque entièrement de battements.
  const discret = { logLevel: "warn" as const };
  app.get("/api/diffusion/cibles", discret, async (req) => ({ cibles: [
    ...registre.lister(req.profilImpose!),
    ...decouverte.lister().map((c) => ({ id: c.id, nom: c.nom, protocole: c.protocole, modele: c.modele, ...etatDe(c.id, req.profilImpose!) })),
  ] }));
  app.post("/api/diffusion/lecteurs", async (req, reply) => {
    const data = z.object({ nom: z.string().trim().min(1).max(120) }).safeParse(req.body);
    if (!data.success) return reply.code(400).send({ message: "Nom d’appareil invalide" });
    try { return registre.inscrire(req.profilImpose!, data.data.nom); }
    catch { return reply.code(429).send({ message: "Trop d’appareils connectés" }); }
  });
  app.post<{ Params: { id: string } }>("/api/diffusion/lecteurs/:id", discret, async (req, reply) => {
    const data = battementSchema.safeParse(req.body);
    if (!data.success) return reply.code(400).send({ message: "État du lecteur invalide" });
    const ordres = registre.battre(req.params.id, req.profilImpose!, data.data.cle, data.data.etat, data.data.accuses);
    return ordres ? { ordres } : reply.code(404).send({ message: "Lecteur déconnecté" });
  });
  app.get<{ Params: { id: string; ordre: string } }>("/api/diffusion/cibles/:id/ordres/:ordre", discret, async (req) => ({ resultat: registre.resultat(req.params.id, req.profilImpose!, req.params.ordre) }));
  app.get<{ Params: { dossier: string; fichier: string } }>("/api/diffusion/sonde/:dossier/:fichier", discret, (req, reply) => servirSonde(req.params.dossier, req.params.fichier, reply));

  /**
   * Prépare et lance une diffusion vers un téléviseur, de la connexion à la confirmation de lecture.
   * L'étape en cours est tenue à jour dans `op.etat`, que tous les clients du profil voient.
   */
  async function diffuser(op: Operation, id: string, cible: Recepteur, chargement: Chargement, origine: string, reprendreEnPause: boolean) {
    const profil = op.profil, signal = op.controle.signal, direct = chargement.contenu.genre === "direct";
    const etape = (e: Partial<EtatDiffusion>) => { op.etat = { ...op.etat, ...e }; };
    const verifierAnnulation = () => { if (signal.aborted) throw new Annulation(); };
    let media: MediaDiffuse | undefined;
    const actualiser = (e: Partial<EtatDiffusion>) => {
      // GET_STATUS peut envoyer le volume avant toute préparation média. Sans garde,
      // undefined === undefined entrait dans la branche et levait sur l.etat.
      if (!media) { if (e.volume != null) op.etat.volume = e.volume; return; }
      const l = lectures.get(id); if (!l || l.media !== media) return;
      l.etat = { ...l.etat, ...e, position: (e.position ?? Math.max(0, l.etat.position - media.decalage)) + media.decalage,
        duree: media.duree || e.duree || l.etat.duree, navigation: !media.direct, etape: undefined };
      media.vu = Date.now();
      if (e.lecture && e.lecture !== "repos") { l.repos = undefined; l.etat.motifRepos = undefined; }
      if (e.lecture === "repos" && e.motifRepos) l.repos ??= Date.now();
      const fin = e.motifRepos === "fin";
      if (!media.direct && l.etat.duree > 0 && (fin || (l.etat.position > 0 && Date.now() - (l.progression ?? 0) > 10_000))
        && contenuAutorise(profil, media.contenu)) {
        l.progression = Date.now();
        // La fin du média vaut lecture terminée : la position du récepteur, revenue à zéro, ne compte plus.
        const position = fin ? l.etat.duree : l.etat.position;
        // Une progression qui ne s'écrit pas (média retiré entre-temps) ne doit pas arrêter la diffusion.
        try { db.prepare(`INSERT INTO playback_progress (profile_id, media_id, position_seconds, duration_seconds, completed, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(profile_id, media_id) DO UPDATE SET
          position_seconds=excluded.position_seconds, duration_seconds=excluded.duration_seconds,
          completed=excluded.completed, updated_at=CURRENT_TIMESTAMP`).run(profil, media.contenu.id,
            position, l.etat.duree, fin || position / l.etat.duree >= .9 ? 1 : 0); }
        catch (e) { app.log.warn({ err: e instanceof Error ? e.message : String(e) }, "Progression de diffusion non enregistrée"); }
      }
    };
    const nouveauTransport = () => cible.protocole === "googlecast" ? new TransportCast(cible, actualiser) : new TransportDlna(cible, actualiser);
    let transport = nouveauTransport(), chargeEnvoye = false;
    // Annuler interrompt aussi un échange en cours avec le téléviseur : le transport fermé rejette
    // ses attentes, au lieu de laisser un chargement courir jusqu'à son délai de 35 secondes.
    signal.addEventListener("abort", () => transport.fermer(), { once: true });
    try {
      etape({ etape: "connexion" });
      // La connexion est vérifiée avant de réserver une conversion sur le NAS.
      let capacites: CapacitesRecepteur | null = null, dlnaSansHls = false, protocolesDlna: string[] | null = null;
      if (transport instanceof TransportCast) {
        try { await transport.verifier(); }
        catch (e) {
          app.log.warn({ protocole: "googlecast", phase: "connexion", code: e instanceof ErreurCast ? e.code : "CAST_CONNEXION" },
            "Échec de vérification Cast avant préparation média");
          throw e;
        }
        verifierAnnulation();
        capacites = capacitesConnues(id, cible.modele);
        if (!capacites) {
          etape({ etape: "sonde" });
          const verdicts: Partial<CapacitesRecepteur> = {};
          for (const nom of Object.keys(SONDES) as NomSonde[]) {
            verifierAnnulation();
            const sonde = SONDES[nom], depuis = Date.now();
            const verdict = await transport.sonder(`${origine}/api/diffusion/sonde/${sonde.dossier}/index.m3u8`, sonde.mime, sonde.fmp4);
            if (verdict === "accepte" || (verdict === "refuse" && segmentDemande(sonde.dossier, depuis))) verdicts[nom] = verdict === "accepte";
            if (nom === "hevc_2160_hdr10" && verdict === "accepte") { verdicts.h264_1080 = true; verdicts.hevc_1080 = true; break; }
          }
          // Sans aucun verdict sûr, rien n'est retenu : la prochaine diffusion sondera de nouveau.
          capacites = Object.keys(verdicts).length ? retenirCapacites(id, { ...verdicts, modele: cible.modele }) : null;
          app.log.info({ protocole: "googlecast", modele: cible.modele ?? null, capacites: verdicts }, "Capacités du récepteur Cast relevées");
        }
      } else {
        protocolesDlna = await transport.protocolesAcceptes();
        dlnaSansHls = dlnaLitLeHls(protocolesDlna) === false;
      }
      verifierAnnulation();
      // Le lecteur du téléviseur s'ouvre pendant que la vidéo se prépare.
      if (transport instanceof TransportCast) void transport.preparerLecteur();
      // Ce qui est diffusé, pour relire un échec dans le journal : « TF1 » ou le titre d'un film.
      const contenuJournal = { genre: chargement.contenu.genre, titre: chargement.contenu.titre?.slice(0, 80) ?? null };
      const source = direct ? null : await sourceVideo(chargement.contenu.id);
      let plan = planDeQualite(source, capacites, direct);
      // Un téléviseur DLNA qui ne lit pas le HLS ne recevra qu'un fichier tel quel ou un MPEG-TS continu.
      // Le direct garde son mode automatique : il convertira en MPEG-TS continu pour ce téléviseur.
      if (dlnaSansHls && !direct) plan = plan.filter((niveau) => !niveau.qualiteSource || source?.mp4Direct);
      // Un téléviseur DLNA qui déclare le conteneur du fichier le lit tel quel, avec son propre
      // déplacement : le 58PUS7304 lit le MKV d'un film 4K HDR sans aucune conversion.
      const fichierDlna = !direct && cible.protocole === "dlna" ? fichierDuMedia(chargement.contenu.id) : null;
      if (fichierDlna && dlnaLitLeConteneur(protocolesDlna, mimeDuFichier(fichierDlna))) {
        plan = [{ nom: "source", qualiteSource: true, compatible: false, hauteurMax: 2160, fichierTelQuel: true }, ...plan.filter((n) => !n.qualiteSource)];
      }
      const courante = lectures.get(id);
      for (let rang = 0; rang < plan.length; rang++) {
        const niveau = plan[rang]!, dernier = rang === plan.length - 1;
        verifierAnnulation();
        etape({ etape: "preparation", qualite: libelleNiveau(niveau) });
        // Une seule conversion du direct à la fois : celle de la chaîne affichée part avant la nouvelle.
        if (courante?.media.direct && direct && lectures.get(id) === courante) await retirer(id);
        try {
          media = await medias.preparer(profil, chargement.contenu, origine, chargement.position,
            { ...niveau, tsContinu: dlnaSansHls, signal });
        } catch (e) {
          if (signal.aborted) throw new Annulation();
          const repli = !dernier && e instanceof ErreurPreparationDiffusion && e.repliPossible;
          app.log.warn({ protocole: cible.protocole, phase: "preparation", niveau: niveau.nom,
            code: e instanceof ErreurPreparationDiffusion ? e.code : "CAST_PREPARATION", repli, appareil: cible.nom, modele: cible.modele ?? null, ...contenuJournal,
            message: e instanceof Error ? e.message.slice(0, 300) : null }, "Échec de préparation de diffusion");
          if (repli) continue;
          throw e;
        }
        if (signal.aborted) { await medias.retirer(media.cle); media = undefined; throw new Annulation(); }
        if (lectures.get(id)) await retirer(id);
        etape({ etape: "demarrage", qualite: media.qualite, contenu: media.contenu });
        lectures.set(id, { profil, media, etat: { ...op.etat, etape: "demarrage" }, transport, dernierControle: Date.now() });
        try {
          chargeEnvoye = true;
          if (transport instanceof TransportCast) await transport.charger(media.url, media.mime, media.contenu.titre, media.direct, media.position, media.segmentsFmp4, media.metadonnees);
          else await transport.charger(media.url, media.mime, media.contenu.titre, media.direct, media.position, media.metadonnees, media.fichier != null);
          if (reprendreEnPause) await transport.commander({ type: "pause" });
        } catch (e) {
          const requetes = media.requetes ?? 0;
          // Le téléviseur est rendu libre avant que le flux refusé ne soit révoqué, puis le niveau suivant
          // repart d'un lecteur neuf : un lecteur resté sur l'essai raté faisait échouer les suivants.
          lectures.delete(id); await transport.liberer(); chargeEnvoye = false; await medias.retirer(media.cle);
          const refus = e instanceof ErreurCast ? REFUS_CAST.test(e.code)
            : cible.protocole === "dlna" && /SetAVTransportURI|Play|démarrage/.test(e instanceof Error ? e.message : "");
          if (transport instanceof TransportCast && e instanceof ErreurCast && REFUS_CAST.test(e.code)) {
            retenirCapacites(id, enseignement(niveau, source, false, /^CAST_(LOAD_FAILED|MEDIA)/.test(e.code) && requetes <= 4));
          }
          const repli = !dernier && refus && !signal.aborted;
          app.log.warn({ protocole: cible.protocole, phase: "chargement", niveau: niveau.nom, requetesMedia: requetes,
            code: e instanceof ErreurCast ? e.code : "RECEPTEUR", repli, appareil: cible.nom, modele: cible.modele ?? null, ...contenuJournal,
            message: e instanceof Error ? e.message.slice(0, 300) : null }, "Échec de diffusion");
          media = undefined;
          if (signal.aborted) throw new Annulation();
          if (repli) {
            // Le transport DLNA se ferme définitivement ; le transport Cast se reconnecte de lui-même.
            if (transport instanceof TransportDlna) transport = nouveauTransport();
            continue;
          }
          if (e instanceof ErreurCast && REFUS_CAST.test(e.code) && !requetes) {
            throw new Error(`${e.message} Le récepteur n’a demandé aucun média au NAS : vérifiez son accès à l’adresse locale et au port FlixTunes.`);
          }
          throw e;
        }
        if (transport instanceof TransportCast) retenirCapacites(id, enseignement(niveau, source, true, false));
        app.log.info({ protocole: cible.protocole, niveau: niveau.nom, qualite: media.qualite, appareil: cible.nom, modele: cible.modele ?? null, ...contenuJournal,
          position: lectures.get(id)?.etat.position }, "Lecture distante confirmée");
        return;
      }
      throw new Error("Aucune qualité de diffusion n’a pu démarrer sur ce récepteur.");
    } catch (e) {
      if (!media || lectures.get(id)?.media !== media) {
        // Un chargement interrompu ou raté ne laisse pas le téléviseur sur un flux qui va disparaître.
        if (chargeEnvoye) await transport.liberer(); else transport.fermer();
      }
      throw e;
    }
  }

  app.post<{ Params: { id: string }; Querystring: { asynchrone?: string } }>("/api/diffusion/cibles/:id/commande", async (req, reply) => {
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
    const courante = lectures.get(id), enCours = operations.get(id);
    // Tout profil pilote la diffusion en cours, et un nouvel envoi la remplace : comme sur YouTube, le
    // téléviseur appartient à qui l'utilise maintenant.

    // Réinitialiser rend le téléviseur libre, même sans diffusion connue du serveur (après un
    // redémarrage du NAS, ou une diffusion lancée par une autre application restée bloquée).
    if (c.type === "reinitialiser") {
      if (enCours) { enCours.controle.abort(); await enCours.fin.catch(() => undefined); }
      if (lectures.get(id)) { await retirer(id, true); return { ok: true }; }
      try {
        if (cible.protocole === "googlecast") await new TransportCast(cible, () => {}).reinitialiser();
        else await new TransportDlna(cible, () => {}).liberer();
        return { ok: true };
      } catch (e) { return reply.code(502).send({ message: e instanceof Error ? e.message : "Téléviseur injoignable" }); }
    }

    // Arrêter pendant la préparation l'annule : la conversion est libérée, le téléviseur n'est pas pris.
    if (c.type === "arreter" && enCours) {
      enCours.controle.abort(); await enCours.fin.catch(() => undefined);
      if (lectures.get(id)) await retirer(id, true);
      return { ok: true };
    }
    let chargement: Chargement | null = c.type === "charger" ? c : null;
    if (c.type === "position" && courante?.media.session && !courante.media.direct) {
      // Dans la partie déjà convertie, le récepteur se déplace seul ; au-delà, la conversion repart.
      const pret = await medias.dureePreparee(courante.media.cle);
      const relatif = c.valeur - courante.media.decalage;
      if (relatif < 0 || relatif > pret - 4) chargement = { contenu: courante.media.contenu, position: c.valeur };
    }
    if (chargement) {
      if (enCours) { enCours.controle.abort(); await enCours.fin.catch(() => undefined); }
      echecs.delete(id);
      // Un déplacement relancé reste au nom de qui a lancé la diffusion : c'est sa progression qui avance.
      const proprietaire = c.type === "position" && courante ? courante.profil : profil;
      const op: Operation = { id: randomUUID(), profil: proprietaire, controle: new AbortController(), fin: Promise.resolve(),
        etat: { ...etatDiffusionVide(), contenu: chargement.contenu, lecture: "chargement", etape: "connexion",
          volume: courante?.etat.volume ?? 1, position: chargement.position } };
      const origine = origineDiffusion(req.headers.host ?? "", req.protocol, req.raw.socket.localAddress, req.raw.socket.localPort);
      op.fin = diffuser(op, id, cible, chargement, origine, c.type === "position" && courante?.etat.lecture === "pause")
        .catch((e) => {
          if (e instanceof Annulation) return;
          const message = e instanceof Error ? e.message : "Diffusion impossible";
          echecs.set(id, { profil: proprietaire, jusqua: Date.now() + 60_000, etat: { ...op.etat, lecture: "erreur", erreur: message.slice(0, 300), etape: undefined } });
          throw e;
        })
        .finally(() => { if (operations.get(id) === op) operations.delete(id); });
      operations.set(id, op);
      // Les clients r7 suivent l'étape par l'état de la cible ; les plus anciens attendent la fin.
      if (req.query.asynchrone === "1") { op.fin.catch(() => undefined); return reply.code(202).send({ operation: op.id }); }
      try { await op.fin; return { ok: true }; }
      catch (e) { return reply.code(502).send({ message: e instanceof Error ? e.message : "Diffusion impossible" }); }
    }
    if (enCours) return reply.code(409).send({ message: "La diffusion est encore en préparation" });
    if (!courante || c.type === "charger") return reply.code(409).send({ message: "Lancez un contenu sur ce récepteur avant de le piloter" });
    if (c.type === "position" && (!courante.etat.navigation || courante.media.direct)) return reply.code(409).send({ message: "Déplacement indisponible pour ce flux" });
    try {
      const commande = c.type === "position" ? { type: "position" as const, valeur: Math.max(0, c.valeur - courante.media.decalage) } : c;
      // Arrêter rend le téléviseur à son écran, comme quand on quitte un cast YouTube.
      if (c.type === "arreter") { await retirer(id, true); return { ok: true }; }
      await courante.transport.commander(commande); courante.dernierControle = Date.now();
      return { ok: true };
    } catch (e) { return reply.code(502).send({ message: e instanceof Error ? e.message : "Diffusion impossible" }); }
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
  app.get<{ Params: { cle: string; nom: string } }>("/api/diffusion/flux/:cle/:nom", discret, (req, reply) => medias.servir(req.params.cle, req.params.nom, req, reply));
}

/** Le chemin du fichier d'un média, pour savoir si un téléviseur DLNA peut le lire tel quel. */
function fichierDuMedia(id: string): string | null {
  const row = db.prepare("SELECT file_path FROM media_items WHERE id = ? AND available = 1").get(id) as { file_path: string } | undefined;
  return row?.file_path ?? null;
}
