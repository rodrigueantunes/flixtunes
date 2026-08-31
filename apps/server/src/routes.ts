import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import mime from "mime-types";
import {
  libraryInputSchema,
  libraryLocalizationInputSchema,
  metadataMatchInputSchema,
  manualMetadataInputSchema,
  metadataProviderConfigurationSchema,
  metadataSearchQuerySchema,
  playbackCapabilitiesSchema,
  profileInputSchema,
  profileGroupInputSchema,
  profileUpdateSchema,
  profileUnlockSchema,
  correctionCommandSchema,
  progressInputSchema,
  recommendationFeedbackSchema,
  watchedInputSchema,
  scanRequestSchema,
  setupInputSchema,
  parametresDirectSchema,
  subtitlePreferenceSchema,
} from "@flixtunes/contracts";
import type { CatalogFilter, CatalogSort, ClassementListe, CommandeAppareil, MetadataSearchCandidate } from "@flixtunes/contracts";
import { listSkippedFiles } from "./scan-safety.js";
import { clearCodecQuarantine, listCodecQuarantine, quarantinedCodecs, recordCodecFailure } from "./codec-quarantine.js";
import { db, getDefaultProfile, getProfile, isFirstRunRequired, listLibraries, listProfileGroups, mapMedia, mapProfile, mediaAgeRatingSql, mediaSelect, setSetting } from "./database.js";
import { buildHome, getDetails, getMediaItem, getPersonDetails, getPlaybackNeighbors, isCatalogAllowed, listCatalog, searchCatalog } from "./catalog-view.js";
import { scanCoordinator } from "./scan-coordinator.js";
import { scanLibraryById } from "./scanner.js";
import { getArtworkAsset } from "./artwork.js";
import { fetchTmdbPreview } from "./tmdb.js";
import { fetchMetadataWithProviders, metadataProviderStatuses, resetProviderRuntimeCaches, searchAllMetadata } from "./metadata-providers.js";
import { resoudreIdentifiantExterne } from "./tmdb.js";
import { saveProviderConfiguration } from "./provider-settings.js";
import {
  adresseRelayee,
  estUnManifeste,
  hoteAutorise,
  lireAdresseRelayee,
  reecrireManifeste,
  signatureValide,
} from "./live-relais.js";
import { fetchWithTimeout } from "./resilience.js";
import { enregistrerXtream, listerSources, reglerFast, retirerSource } from "./live-fournisseurs.js";
import {
  arreterRafraichissement,
  chaineDetaillee,
  chaineParNumero,
  derniereChaine,
  chaineVoisine,
  cheminDuCatalogue,
  enregistrerParametres,
  etatClient,
  etatDirect,
  listerChaines,
  listerListesClient,
  listerFiabilites,
  listerListes,
  listerPays,
  marquerFavorite,
  noterResultat,
  parametresDirect,
  retenirDerniereChaine,
  rafraichirDirect,
} from "./television-direct.js";
import { listMetadataProvenance, recordMetadataField } from "./metadata-fields.js";
import {
  cleanupIdleSessions,
  cleanupPlaybackSessions,
  createPlaybackSession,
  detectFfmpegSupport,
  extractSubtitle,
  extractExternalSubtitle,
  getPlaybackFile,
  getPlaybackInfo,
  getTimelineSheet,
  getPlaybackSession,
  getPlaybackSystemInfo,
  getServerMediaInventory,
  stopPlaybackSession,
} from "./playback.js";
import { getCapacityReport, oublierCalibrages } from "./capacity.js";
import { annoncerAppareil, appareilsActifs, envoyerCommande, retirerCommandes } from "./appareils.js";
import { definirPreferencesConversion, preferencesConversion } from "./preferences-conversion.js";
import { applyCorrection, listAudit, previewMassCorrection, undoCorrection } from "./corrections.js";
import { backupPath, createBackup, databaseHealth, listBackups, requestRestore } from "./maintenance.js";
import { config } from "./config.js";
import { telemetrySnapshot } from "./telemetry.js";
import { browseDirectories } from "./filesystem-browser.js";
import {
  PIN_MINIMUM_DISTANT, blocageDeverrouillage, enregistrerEchec, jetonDeLaRequete, oublierEchecs,
  ouvrirSession, poserCookieSession, revoquerSessionsDuProfil, sessionDuJeton,
} from "./sessions-profil.js";
import { journaliserAccesWan } from "./wan-journal.js";
import { reparerCapacites } from "./capacites-client.js";
import { definirParametresWan, parametresWan } from "./wan-parametres.js";
import { diagnostiquerWan } from "./wan-diagnostic.js";
import { activerLesGeneriques, arreterLaPasse, etatDesGeneriques, generiquesActifs } from "./marqueurs-passe.js";
import { etatDuSchema } from "./migrations.js";
import {
  compteDuJeton,
  creerCompteDistant,
  jetonCompteDeLaRequete,
  listerComptesDistants,
  ouvrirCompteDistant,
  poserCookieCompte,
  supprimerCompteDistant,
} from "./comptes-distants.js";

function hashPin(pin: string): string { const salt = randomBytes(16); return `${salt.toString("hex")}:${scryptSync(pin, salt, 32).toString("hex")}`; }
function verifyPin(pin: string, stored: string): boolean { try { const [salt, digest] = stored.split(":"); if (!salt || !digest) return false;
  return timingSafeEqual(Buffer.from(digest, "hex"), scryptSync(pin, Buffer.from(salt, "hex"), 32)); } catch { return false; } }

/**
 * Le déverrouillage rend un jeton de session, désormais enregistré en base.
 *
 * Il vivait dans une `Map` en mémoire : chaque redémarrage du NAS déconnectait tout le monde, et
 * rien n'était révocable. Sur un réseau local c'était un défaut de confort, puisque tout était
 * lisible sans session ; devant Internet, la session est le rempart, et un rempart qui disparaît à
 * chaque mise à jour n'en est pas un.
 *
 * La durée reste de douze heures sur le réseau local, et suit `FLIXTUNES_WAN_SESSION_HOURS` à
 * distance.
 */
function issueProfileUnlockToken(profileId: string, origine: "lan" | "wan" = "lan", appareil?: string | null) {
  return ouvrirSession({
    profileId, origine, appareil,
    dureeHeures: origine === "wan" ? config.wan.sessionHours : 12,
  });
}

function hasProfileAccess(request: FastifyRequest, profileId: string): boolean {
  // Sur l'écoute distante, le garde a déjà validé la session et fixé le profil : aucune requête ne
  // peut en désigner un autre.
  if (request.profilImpose) return request.profilImpose === profileId;
  const row = db.prepare("SELECT pin_hash FROM profiles WHERE id = ?").get(profileId) as { pin_hash: string | null } | undefined;
  if (!row?.pin_hash) return true;
  const session = sessionDuJeton(jetonDeLaRequete(request));
  return session?.profileId === profileId;
}

type IdParams = { id: string };

function profileFromRequest(request: FastifyRequest) {
  // Le profil imposé par une session distante prime sur tout paramètre de requête.
  if (request.profilImpose) return getProfile(request.profilImpose);
  const query = request.query as { profileId?: string } | undefined;
  const header = request.headers["x-flixtunes-profile"];
  const profile = getProfile(query?.profileId ?? (typeof header === "string" ? header : null));
  return profile && hasProfileAccess(request, profile.id) ? profile : null;
}

function parseSingleRange(rangeHeader: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;
  if (!match[1] && !match[2]) return null;

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

function sendMedia(request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) {
  const profile = profileFromRequest(request);
  if (!profile || !getMediaItem(profile.id, request.params.id)) {
    return reply.code(404).send({ message: "Média introuvable" });
  }
  const row = db.prepare("SELECT file_path FROM media_items WHERE id = ? AND file_path IS NOT NULL AND available = 1").get(request.params.id) as
    | { file_path: string }
    | undefined;
  if (!row) return reply.code(404).send({ message: "Média introuvable" });

  let info;
  try {
    info = statSync(row.file_path);
  } catch {
    return reply.code(410).send({ message: "Le fichier n'est plus accessible" });
  }
  const contentType = mime.lookup(row.file_path) || "application/octet-stream";
  const rangeHeader = request.headers.range;
  reply.header("Accept-Ranges", "bytes").header("Content-Type", contentType);

  if (!rangeHeader) {
    return reply.header("Content-Length", info.size).send(createReadStream(row.file_path));
  }
  const range = parseSingleRange(rangeHeader, info.size);
  if (!range) return reply.code(416).header("Content-Range", `bytes */${info.size}`).send();
  const length = range.end - range.start + 1;
  return reply
    .code(206)
    .header("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`)
    .header("Content-Length", length)
    .send(createReadStream(row.file_path, range));
}

export async function registerRoutes(app: FastifyInstance) {
  /**
   * Contrôle de santé.
   *
   * Réduit à distance : la version exacte et la révision du paquet servent surtout à choisir sur quel
   * défaut connu s'appuyer. Le réseau local, lui, en a besoin — c'est ce que lit l'écran de
   * diagnostic, et une version fausse ou absente y fait chercher la panne au mauvais endroit.
   */
  app.get("/api/health", async (request) => request.expositionWan
    ? { status: "ok", name: "FlixTunes" }
    : {
      status: "ok", name: "FlixTunes", version: config.version, step: config.step, phase: config.phase,
      packageRevision: config.packageRevision,
    });

  app.get("/api/remote/session", async (request) => {
    if (!request.expositionWan) return { required: false, authenticated: true, account: null };
    const compte = compteDuJeton(jetonCompteDeLaRequete(request));
    return { required: true, authenticated: Boolean(compte), account: compte?.username ?? null };
  });

  app.post("/api/remote/login", async (request, reply) => {
    if (!request.expositionWan) return reply.code(404).send({ message: "Route introuvable" });
    const body = request.body as { username?: unknown; password?: unknown; device?: unknown } | undefined;
    if (typeof body?.username !== "string" || typeof body?.password !== "string") {
      return reply.code(400).send({ message: "Identifiant et mot de passe requis" });
    }
    try {
      const session = ouvrirCompteDistant({ username: body.username, password: body.password,
        source: request.ip, device: typeof body.device === "string" ? body.device : request.headers["user-agent"] });
      poserCookieCompte(reply, session.token);
      return { token: session.token, expiresAt: session.expiresAt,
        account: { id: session.account.id, username: session.account.username } };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connexion refusée";
      return reply.code(message.startsWith("Trop de tentatives") ? 429 : 401).send({ message });
    }
  });

  // Administration locale uniquement : ces motifs ne figurent pas dans la liste blanche WAN.
  app.get("/api/system/remote-accounts", async () => listerComptesDistants());
  app.post("/api/system/remote-accounts", async (request, reply) => {
    const body = request.body as { username?: unknown; password?: unknown } | undefined;
    try {
      return reply.code(201).send(creerCompteDistant(String(body?.username ?? ""), String(body?.password ?? "")));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Compte invalide";
      return reply.code(message.includes("existe déjà") ? 409 : 400).send({ message });
    }
  });
  app.delete<{ Params: { id: string } }>("/api/system/remote-accounts/:id", async (request, reply) =>
    supprimerCompteDistant(request.params.id) ? reply.code(204).send()
      : reply.code(404).send({ message: "Compte introuvable" }));

  app.get("/api/system/status", async () => ({
    // La révision voyage avec la version : sans elle, deux paquets qui portent des correctifs
    // différents annoncent le même « 0.5.6 », et aucun diagnostic à distance n'est possible.
    status: "ok", version: config.version, packageRevision: config.packageRevision,
    step: config.step, phase: config.phase, uptimeSeconds: Math.round(process.uptime()),
    // La version du schéma dit ce que la base a réellement traversé — une restauration peut la
    // ramener en arrière sans que la version du paquet, elle, ne bouge.
    schema: etatDuSchema(db),
    memory: process.memoryUsage(), database: databaseHealth(), playback: await getPlaybackSystemInfo(),
    scans: scanCoordinator.stats(), telemetry: telemetrySnapshot(),
    security: { tokenRequiredForWrites: Boolean(config.apiToken), trustedLanCors: true },
  }));
  // Diagnostic des fichiers restés à la porte. Sans lui, un média qui n'entre jamais dans le catalogue
  // reste muet : rien ne dit s'il a été écarté, refusé, ou s'il a échoué, ni depuis combien de temps.
  app.get("/api/scans/skipped", async (request) => {
    const query = request.query as { libraryId?: string };
    return listSkippedFiles(query.libraryId);
  });

  app.get("/api/system/metrics", async () => ({ ...telemetrySnapshot(), scans: scanCoordinator.stats(), memory: process.memoryUsage(), uptimeSeconds: Math.round(process.uptime()) }));
  app.get("/api/system/backups", async () => listBackups());
  app.post("/api/system/backups", async (_request, reply) => reply.code(201).send(createBackup()));
  app.get<{ Params: { name: string } }>("/api/system/backups/:name", async (request, reply) => {
    const file = backupPath(request.params.name); if (!file) return reply.code(400).send({ message: "Sauvegarde invalide" });
    try { const info = statSync(file); return reply.header("Content-Type", "application/vnd.sqlite3").header("Content-Length", info.size)
      .header("Content-Disposition", `attachment; filename=\"${request.params.name}\"`).send(createReadStream(file)); }
    catch { return reply.code(404).send({ message: "Sauvegarde introuvable" }); }
  });
  app.post<{ Params: { name: string }; Body: { confirm?: string } }>("/api/system/backups/:name/restore", async (request, reply) => {
    if (request.body?.confirm !== "RESTORE") return reply.code(400).send({ message: "Confirmation RESTORE requise" });
    try { await requestRestore(request.params.name); return reply.code(202).send({ restartRequired: true }); }
    catch (error) { return reply.code(404).send({ message: error instanceof Error ? error.message : String(error) }); }
  });

  app.get("/api/profile-groups", async (request) => {
    // Groupes et profils sont désormais visibles à distance dès que le compte de connexion est
    // franchi. Ils étaient filtrés sur la longueur du PIN à l'époque où celui-ci était le **seul**
    // rempart depuis Internet : la conséquence était qu'un foyer n'ayant pas encore reposé ses codes
    // ne voyait strictement rien, sans qu'aucun message ne l'explique. La porte est maintenant tenue
    // par un compte à mot de passe, et le PIN reprend son rôle d'origine — séparer les profils entre
    // eux, pas protéger la maison d'Internet.
    return listProfileGroups();
  });

  app.post("/api/profile-groups", async (request, reply) => {
    const parsed = profileGroupInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Groupe invalide", issues: parsed.error.issues });
    const count = Number((db.prepare("SELECT COUNT(*) AS count FROM profile_groups").get() as { count: number }).count);
    if (count >= 12) return reply.code(409).send({ message: "Douze groupes maximum" });
    if (db.prepare("SELECT 1 FROM profile_groups WHERE name = ? COLLATE NOCASE").get(parsed.data.name)) {
      return reply.code(409).send({ message: "Ce groupe existe déjà" });
    }
    const id = randomUUID();
    db.prepare("INSERT INTO profile_groups (id, name) VALUES (?, ?)").run(id, parsed.data.name);
    return reply.code(201).send(listProfileGroups().find((group) => group.id === id));
  });

  const mettreAJourGroupe = async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
    const parsed = profileGroupInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Groupe invalide", issues: parsed.error.issues });
    if (db.prepare("SELECT 1 FROM profile_groups WHERE name = ? COLLATE NOCASE AND id <> ?").get(parsed.data.name, request.params.id)) {
      return reply.code(409).send({ message: "Ce groupe existe déjà" });
    }
    const changed = Number(db.prepare("UPDATE profile_groups SET name = ? WHERE id = ?").run(parsed.data.name, request.params.id).changes);
    if (!changed) return reply.code(404).send({ message: "Groupe introuvable" });
    return listProfileGroups().find((group) => group.id === request.params.id);
  };
  app.patch<{ Params: IdParams }>("/api/profile-groups/:id", mettreAJourGroupe);
  app.put<{ Params: IdParams }>("/api/profile-groups/:id", mettreAJourGroupe);
  app.delete<{ Params: IdParams }>("/api/profile-groups/:id", async (request, reply) => {
    if (db.prepare("SELECT 1 FROM profiles WHERE group_id = ?").get(request.params.id)) {
      return reply.code(409).send({ message: "Déplacez ou supprimez d'abord les profils de ce groupe" });
    }
    const count = Number((db.prepare("SELECT COUNT(*) AS count FROM profile_groups").get() as { count: number }).count);
    if (count <= 1) return reply.code(409).send({ message: "Le dernier groupe ne peut pas être supprimé" });
    const changed = Number(db.prepare("DELETE FROM profile_groups WHERE id = ?").run(request.params.id).changes);
    if (!changed) return reply.code(404).send({ message: "Groupe introuvable" });
    return reply.code(204).send();
  });

  app.get("/api/profiles", async (request) => {
    const query = request.query as { groupId?: string };
    const rows = db.prepare("SELECT * FROM profiles ORDER BY created_at").all() as Array<{
      id: string;
      name: string;
      avatar_color: string;
      language: string;
      preferred_audio_languages: string; preferred_subtitle_languages: string; subtitle_mode: string; pin_hash: string | null;
      audio_output_mode: string; audio_normalization: number; night_mode: number; dynamic_range_priority: string;
      resume_mode: string; resume_rewind_seconds: number; default_playback_rate: number; autoplay_next: number; autoplay_limit: number;
      pin_digits: number | null;
    }>;
    // Aucun filtre distant : le compte de connexion a déjà été franchi pour arriver ici, et masquer
    // les profils ne protégeait plus rien tout en rendant l'accès distant inutilisable.
    return rows.map(mapProfile).filter((profile) => !query.groupId || profile.groupId === query.groupId);
  });

  app.post("/api/profiles", async (request, reply) => {
    const parsed = profileInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Profil invalide", issues: parsed.error.issues });
    const count = db.prepare("SELECT COUNT(*) AS count FROM profiles").get() as { count: number };
    if (count.count >= 12) return reply.code(409).send({ message: "Douze profils maximum" });
    const groupId = parsed.data.groupId ?? listProfileGroups()[0]?.id;
    if (!groupId || !db.prepare("SELECT 1 FROM profile_groups WHERE id = ?").get(groupId)) {
      return reply.code(400).send({ message: "Groupe introuvable" });
    }
    const id = randomUUID();
    db.prepare(`INSERT INTO profiles (id, group_id, name, avatar_color, language, preferred_audio_languages,
      preferred_subtitle_languages, subtitle_mode, audio_output_mode, audio_normalization, night_mode, dynamic_range_priority,
      resume_mode, resume_rewind_seconds, default_playback_rate, autoplay_next, autoplay_limit, is_child, age, pin_hash, pin_digits)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, groupId, parsed.data.name, parsed.data.avatarColor, parsed.data.language,
        JSON.stringify(parsed.data.preferredAudioLanguages), JSON.stringify(parsed.data.preferredSubtitleLanguages), parsed.data.subtitleMode,
        parsed.data.audioOutputMode, parsed.data.audioNormalization ? 1 : 0, parsed.data.nightMode ? 1 : 0, parsed.data.dynamicRangePriority,
        parsed.data.resumeMode, parsed.data.resumeRewindSeconds, parsed.data.defaultPlaybackRate,
        parsed.data.autoplayNext ? 1 : 0, parsed.data.autoplayLimit,
        parsed.data.isChild ? 1 : 0, parsed.data.isChild ? parsed.data.age : null,
        parsed.data.pin ? hashPin(parsed.data.pin) : null,
        parsed.data.pin ? parsed.data.pin.length : null);
    return reply.code(201).send(getProfile(id));
  });

  /**
   * Modification partielle d'un profil.
   *
   * Deux verbes pour un seul traitement, et ce n'est pas une commodité : `HttpURLConnection`, dont
   * dépend le client Android, refuse `PATCH` à la source — la liste des méthodes autorisées est
   * figée dans `java.net.HttpURLConnection` et n'a jamais été étendue. Le client Android ne pourrait
   * donc pas modifier un profil, alors que le client Web le fait depuis toujours.
   *
   * L'alternative aurait été de réécrire toute la couche réseau d'Android sur OkHttp pour un seul
   * appel, ou de faire passer la vraie méthode dans un en-tête que Fastify ne peut pas honorer — le
   * routage y précède les crochets. Accepter les deux verbes sur le même traitement est ce qui coûte
   * le moins et ne fait diverger aucun des deux clients.
   */
  const mettreAJourProfil = async (request: FastifyRequest<{ Params: IdParams }>, reply: FastifyReply) => {
    const parsed = profileUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Modification invalide", issues: parsed.error.issues });
    const current = getProfile(request.params.id);
    if (!current) return reply.code(404).send({ message: "Profil introuvable" });
    const groupId = parsed.data.groupId ?? current.groupId;
    if (!db.prepare("SELECT 1 FROM profile_groups WHERE id = ?").get(groupId)) {
      return reply.code(400).send({ message: "Groupe introuvable" });
    }
    const isChild = parsed.data.isChild ?? current.isChild;
    const age = isChild ? (parsed.data.age ?? current.age) : null;
    if (isChild && age == null) return reply.code(400).send({ message: "L'âge est requis pour un profil enfant" });
    /**
     * Changer un PIN exige de connaître l'ancien.
     *
     * Il ne l'exigeait pas : n'importe qui pouvant atteindre l'API remplaçait le code d'un profil,
     * puis se déverrouillait avec le sien. Inoffensif tant que rien n'était protégé, inacceptable
     * dès lors que ce code est ce qui garde la médiathèque depuis Internet.
     *
     * Poser un premier PIN sur un profil qui n'en avait pas reste libre : il n'y a pas d'ancien
     * secret à prouver, et l'opération ne retire aucun droit.
     */
    if (parsed.data.pin !== undefined && current.protected) {
      const ancien = (request.body as { ancienPin?: unknown } | undefined)?.ancienPin;
      const ligne = db.prepare("SELECT pin_hash FROM profiles WHERE id = ?").get(current.id) as { pin_hash: string | null } | undefined;
      if (typeof ancien !== "string" || !ligne?.pin_hash || !verifyPin(ancien, ligne.pin_hash)) {
        return reply.code(403).send({ message: "Code PIN actuel requis pour le modifier" });
      }
    }
    const pinHash = parsed.data.pin === undefined ? undefined : parsed.data.pin ? hashPin(parsed.data.pin) : null;
    db.prepare(`UPDATE profiles SET group_id = ?, name = ?, avatar_color = ?, language = ?, preferred_audio_languages = ?,
      preferred_subtitle_languages = ?, subtitle_mode = ?, audio_output_mode = ?, audio_normalization = ?, night_mode = ?, dynamic_range_priority = ?,
      resume_mode = ?, resume_rewind_seconds = ?, default_playback_rate = ?, autoplay_next = ?, autoplay_limit = ?,
      is_child = ?, age = ?, pin_hash = CASE WHEN ? = 1 THEN ? ELSE pin_hash END,
      pin_digits = CASE WHEN ? = 1 THEN ? ELSE pin_digits END WHERE id = ?`)
      .run(groupId, parsed.data.name ?? current.name, parsed.data.avatarColor ?? current.avatarColor,
        parsed.data.language ?? current.language, JSON.stringify(parsed.data.preferredAudioLanguages ?? current.preferredAudioLanguages),
        JSON.stringify(parsed.data.preferredSubtitleLanguages ?? current.preferredSubtitleLanguages),
        parsed.data.subtitleMode ?? current.subtitleMode ?? "forced", parsed.data.audioOutputMode ?? current.audioOutputMode ?? "auto",
        (parsed.data.audioNormalization ?? current.audioNormalization) ? 1 : 0, (parsed.data.nightMode ?? current.nightMode) ? 1 : 0,
        parsed.data.dynamicRangePriority ?? current.dynamicRangePriority ?? "auto",
        parsed.data.resumeMode ?? current.resumeMode ?? "continue", parsed.data.resumeRewindSeconds ?? current.resumeRewindSeconds ?? 5,
        parsed.data.defaultPlaybackRate ?? current.defaultPlaybackRate ?? 1, (parsed.data.autoplayNext ?? current.autoplayNext) ? 1 : 0,
        parsed.data.autoplayLimit ?? current.autoplayLimit ?? 3,
        isChild ? 1 : 0, age,
        pinHash === undefined ? 0 : 1, pinHash ?? null,
        pinHash === undefined ? 0 : 1, parsed.data.pin ? parsed.data.pin.length : null, current.id);
    // Un code changé doit fermer ce que l'ancien avait ouvert : sinon une session volée survivrait
    // précisément au geste censé y mettre fin.
    if (pinHash !== undefined) revoquerSessionsDuProfil(current.id);
    return getProfile(current.id);
  };
  app.patch<{ Params: IdParams }>("/api/profiles/:id", mettreAJourProfil);
  app.put<{ Params: IdParams }>("/api/profiles/:id", mettreAJourProfil);

  /**
   * Déverrouillage d'un profil.
   *
   * Trois différences selon l'origine de la requête, et elles tiennent toutes à une seule idée : sur
   * le réseau local le PIN empêche un enfant d'ouvrir le profil d'un adulte, alors que depuis
   * Internet il est la seule chose qui sépare la médiathèque de n'importe qui.
   *
   * - **À distance, un profil sans PIN d'au moins six chiffres n'est pas déverrouillable.** Il est
   *   d'ailleurs absent de la liste rendue au client.
   * - **Les essais sont comptés par source et ralentis.** Cinq essais libres, puis une attente qui
   *   double — une heure au dixième échec. Un million de combinaisons devient hors de portée.
   * - **Le jeton part aussi en cookie.** La balise vidéo, les images et les pistes de sous-titres ne
   *   savent pas porter d'en-tête ; sans cookie, le flux resterait ouvert alors que l'API serait
   *   gardée.
   */
  app.post<{ Params: IdParams }>("/api/profiles/:id/unlock", async (request, reply) => {
    const distant = Boolean(request.expositionWan);
    const source = request.ip;

    const blocage = blocageDeverrouillage(source);
    if (blocage.bloque) {
      const secondes = Math.ceil(blocage.attenteMs / 1000);
      if (distant) journaliserAccesWan({ verdict: "pin-bloque", source, profil: request.params.id, route: null, appareil: null });
      return reply.code(429).header("Retry-After", String(secondes))
        .send({ message: `Trop d'essais. Réessayez dans ${secondes} seconde(s).` });
    }

    // Le profil est lu **avant** le code, et non l'inverse.
    //
    // Le schéma exige quatre à huit chiffres. Un profil sans code ne pouvait donc pas être
    // déverrouillé du tout : la demande était refusée en « PIN invalide » avant même qu'on regarde
    // s'il y avait un code à vérifier. Sans conséquence sur le réseau local, où aucune session n'est
    // réclamée — mais impasse complète sur Internet, où chaque lecture en exige une : le profil
    // demandait une session, et le seul moyen d'en obtenir une réclamait un code inexistant.
    // Constaté en retirant le code d'un profil, ce qui l'a rendu inaccessible à distance.
    const row = db.prepare("SELECT pin_hash, pin_digits FROM profiles WHERE id = ?").get(request.params.id) as
      | { pin_hash: string | null; pin_digits: number | null } | undefined;
    if (!row) return reply.code(404).send({ message: "Profil introuvable" });

    const parsed = profileUnlockSchema.safeParse(request.body);
    if (row.pin_hash && !parsed.success) return reply.code(400).send({ message: "PIN invalide" });

    if (row.pin_hash && (!parsed.success || !verifyPin(parsed.data.pin, row.pin_hash))) {
      enregistrerEchec(source);
      if (distant) journaliserAccesWan({ verdict: "pin-refuse", source, profil: request.params.id, route: null, appareil: null });
      return reply.code(401).send({ message: "Code PIN incorrect" });
    }

    oublierEchecs(source);
    const appareil = typeof request.headers["x-flixtunes-appareil"] === "string"
      ? String(request.headers["x-flixtunes-appareil"]).slice(0, 64) : null;
    const session = issueProfileUnlockToken(request.params.id, distant ? "wan" : "lan", appareil);
    if (distant) {
      poserCookieSession(reply, session.token, config.wan.sessionHours);
      journaliserAccesWan({ verdict: "ouverture", source, profil: request.params.id, route: null, appareil });
    }
    return { unlocked: true, ...session };
  });

  app.delete<{ Params: IdParams }>("/api/profiles/:id", async (request, reply) => {
    const count = db.prepare("SELECT COUNT(*) AS count FROM profiles").get() as { count: number };
    if (count.count <= 1) return reply.code(409).send({ message: "Le dernier profil ne peut pas être supprimé" });
    const changes = Number(db.prepare("DELETE FROM profiles WHERE id = ?").run(request.params.id).changes);
    if (!changes) return reply.code(404).send({ message: "Profil introuvable" });
    return reply.code(204).send();
  });

  app.get("/api/libraries", async () => listLibraries());

  app.get("/api/recommendations", async (request, reply) => {
    const profile = profileFromRequest(request); if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    return buildHome(profile).recommendations ?? [];
  });
  app.put("/api/recommendations/feedback", async (request, reply) => {
    const profile = profileFromRequest(request); if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    const parsed = recommendationFeedbackSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Avis invalide", issues: parsed.error.issues });
    db.prepare(`INSERT INTO recommendation_feedback (profile_id, catalog_id, value, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(profile_id, catalog_id) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
      .run(profile.id, parsed.data.catalogId, parsed.data.value);
    return reply.code(204).send();
  });

  app.get("/api/scans", async (request) => {
    const query = request.query as { limit?: string };
    return scanCoordinator.list(Number(query.limit ?? 100));
  });

  /**
   * Où en est le repérage des génériques.
   *
   * Séparé des analyses parce qu'il ne porte sur aucune bibliothèque : il traverse les saisons, pas
   * les dossiers. Le ranger dans `scan_jobs` aurait obligé à lui inventer une bibliothèque.
   */
  app.get("/api/system/generiques", async () => etatDesGeneriques());

  /**
   * Allumer ou éteindre le repérage.
   *
   * Éteint, rien n'est décodé et la passe en cours s'arrête ; le réglage vit en base, donc il tient
   * après un redémarrage. Les repères déjà trouvés, eux, restent : ils ne coûtent plus rien, et le
   * lecteur continue de les proposer.
   */
  app.post("/api/system/generiques", async (request, reply) => {
    const corps = request.body as { actif?: unknown } | null;
    if (typeof corps?.actif !== "boolean") return reply.code(400).send({ message: "Réglage invalide" });
    const etat = activerLesGeneriques(corps.actif);
    // Allumer, c'est demander que ça se fasse : on n'attend pas la prochaine analyse pour commencer.
    if (etat.actif && !etat.enCours) scanCoordinator.relancerLesGeneriques();
    return etat;
  });

  /** Arrêter la passe en cours sans éteindre le repérage : « pas maintenant », pas « jamais ». */
  app.post("/api/system/generiques/arret", async () => arreterLaPasse());

  /**
   * Reprendre le repérage **sur ce qui manque, et rien d'autre**.
   *
   * Jusqu'ici, il n'y avait que l'interrupteur : pour relancer une passe il fallait éteindre puis
   * rallumer le repérage, ce qui est un geste de réglage détourné en geste d'action. Et il fallait
   * sinon attendre la fin d'une analyse de bibliothèque — donc en relancer une, c'est-à-dire
   * reparcourir des milliers de fichiers pour quelques saisons.
   *
   * Ce bouton ne relance **aucune** analyse, ne retouche aucune fiche et n'interroge aucun
   * fournisseur. Il reprend la liste des saisons sans repère, et s'arrête quand elle est vide.
   *
   * Une passe déjà en cours n'est pas doublée : deux passes se disputeraient les mêmes saisons et le
   * même processeur. On rend l'état tel quel, et l'écran montre qu'elle tourne déjà.
   */
  app.post("/api/system/generiques/passe", async (_request, reply) => {
    if (!generiquesActifs()) {
      return reply.code(409).send({ message: "Le repérage des génériques est désactivé : activez-le d'abord." });
    }
    const avant = etatDesGeneriques();
    if (!avant.enCours) scanCoordinator.relancerLesGeneriques();
    return etatDesGeneriques();
  });

  /* ---------------------------------------------------------------------- */
  /* La télévision en direct                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * Ces routes ne figurent **pas** dans la liste blanche de l'accès distant, et c'est délibéré.
   *
   * Régler un dossier du NAS, cocher cinq cents listes ou lancer un rafraîchissement qui télécharge
   * quarante mégaoctets sont des gestes sur la machine. La grille elle-même rejoindra les lectures
   * autorisées quand l'écran existera et aura été éprouvé — un geste délibéré, comme le veut
   * `wan-exposition.ts`, et non un effet de bord de cette étape.
   */
  app.get("/api/system/live", async () => ({ parametres: parametresDirect(), etat: etatDirect() }));

  app.put("/api/system/live", async (request, reply) => {
    const parsed = parametresDirectSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: "Réglage invalide", issues: parsed.error.issues });
    try {
      return { parametres: enregistrerParametres(parsed.data), etat: etatDirect() };
    } catch (cause) {
      return reply.code(400).send({ message: cause instanceof Error ? cause.message : "Réglage invalide" });
    }
  });

  /**
   * Relire le catalogue et les listes cochées.
   *
   * La réponse ne l'attend pas : cinq cents listes prennent des secondes, et une requête HTTP qui
   * reste ouverte pendant ce temps ne dit rien de plus que l'avancement, déjà lisible sur `GET`.
   * Une passe déjà en cours n'est pas doublée — deux passes se disputeraient les mêmes écritures.
   */
  app.post("/api/system/live/rafraichir", async (_request, reply) => {
    const parametres = parametresDirect();
    if (!parametres.actif) {
      return reply.code(409).send({ message: "La télévision en direct est désactivée : activez-la d'abord." });
    }
    if (!etatDirect().configure) {
      return reply.code(409).send({ message: "Aucune source n'est réglée." });
    }
    const avant = etatDirect();
    if (!avant.enCours) {
      void rafraichirDirect().catch((cause) => {
        app.log.warn({ err: cause }, "Rafraîchissement de la télévision en direct interrompu");
      });
    }
    return etatDirect();
  });

  /** Arrêter la passe en cours sans éteindre la fonction : « pas maintenant », pas « jamais ». */
  app.post("/api/system/live/arret", async () => { arreterRafraichissement(); return etatDirect(); });

  app.get("/api/system/live/listes", async () => listerListes());

  /**
   * Les fournisseurs réglés, et de quoi en ajouter.
   *
   * Trois sortes, un seul écran : le fichier du NAS, un portail Xtream — hôte, identifiant, mot de
   * passe — et les listes publiques, qui ne demandent rien. Le mot de passe est chiffré au repos par
   * le même mécanisme que les jetons TMDB, et il n'est jamais réaffiché.
   */
  app.get("/api/system/live/sources", async () => listerSources());

  app.post("/api/system/live/sources", async (request, reply) => {
    const corps = request.body as { type?: unknown; hote?: unknown; utilisateur?: unknown; motDePasse?: unknown; libelle?: unknown } | null;
    if (corps?.type === "fast") return { source: reglerFast(true) };
    if (corps?.type !== "xtream" || typeof corps.hote !== "string" || typeof corps.utilisateur !== "string"
      || typeof corps.motDePasse !== "string") {
      return reply.code(400).send({ message: "Fournisseur invalide" });
    }
    try {
      return { source: enregistrerXtream(
        { hote: corps.hote, utilisateur: corps.utilisateur, motDePasse: corps.motDePasse },
        typeof corps.libelle === "string" ? corps.libelle : undefined,
      ) };
    } catch (cause) {
      return reply.code(400).send({ message: cause instanceof Error ? cause.message : "Fournisseur invalide" });
    }
  });

  app.delete<{ Params: IdParams }>("/api/system/live/sources/:id", async (request, reply) => {
    if (!retirerSource(request.params.id)) return reply.code(404).send({ message: "Fournisseur introuvable" });
    return reply.code(204).send();
  });

  app.get("/api/live", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    return etatClient();
  });

  app.get("/api/live/fiabilites", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    return listerFiabilites();
  });

  /**
   * L'étoile d'une chaîne, pour ce profil.
   *
   * Le même geste que la liste d'envies du catalogue, et rangé pareil : par profil, jamais au foyer.
   */
  app.put<{ Params: IdParams }>("/api/live/channels/:id/favori", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    marquerFavorite(profile.id, request.params.id, true);
    return reply.code(204).send();
  });

  app.delete<{ Params: IdParams }>("/api/live/channels/:id/favori", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    marquerFavorite(profile.id, request.params.id, false);
    return reply.code(204).send();
  });

  /**
   * La dernière chaîne regardée, et celle d'avant.
   *
   * Elles sont retenues par le serveur : un téléviseur qu'on rallume retrouve ce qu'on regardait,
   * même si on l'avait quitté depuis le téléphone. C'est aussi ce qui rend « chaîne précédente »
   * possible d'un appareil à l'autre.
   */
  app.get("/api/live/derniere", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    return { chaine: derniereChaine(profile.id) };
  });

  app.get("/api/live/pays", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    return listerPays();
  });

  app.get("/api/live/listes", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    return listerListesClient();
  });

  app.get("/api/live/channels", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    const query = request.query as Record<string, string | undefined>;
    if (query.q && query.q.length > 120) return reply.code(400).send({ message: "Recherche trop longue" });
    const offset = Number(query.offset ?? 0);
    const limit = Number(query.limit ?? 60);
    if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(limit) || limit < 1) {
      return reply.code(400).send({ message: "Pagination invalide" });
    }
    const decouper = (valeur: string | undefined): string[] =>
      (valeur ?? "").split(",").map((element) => element.trim()).filter(Boolean).slice(0, 200);
    return listerChaines({
      q: query.q, profileId: profile.id,
      favoris: query.favoris === "1", masquerMortes: query.masquerMortes === "1",
      listes: decouper(query.listes), pays: decouper(query.pays),
      fiabilites: decouper(query.fiabilites) as ClassementListe[], offset, limit,
    });
  });

  /**
   * La chaîne d'un numéro, ou sa voisine — les deux gestes de la télécommande.
   *
   * `numero` répond à la saisie d'un numéro, `sens` à P+ et P−. Les deux vivent sur la même route
   * parce qu'ils répondent à la même question — « quelle chaîne ouvrir maintenant ? » — et rendent la
   * même chose.
   */
  app.get("/api/live/numero", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    const query = request.query as { numero?: string; sens?: string };
    const numero = Number(query.numero);
    if (!Number.isInteger(numero) || numero < 1 || numero > 99_999) {
      return reply.code(400).send({ message: "Numéro invalide" });
    }
    const sens = query.sens === "1" ? 1 : query.sens === "-1" ? -1 : null;
    const chaine = sens ? chaineVoisine(numero, sens) : chaineParNumero(numero);
    if (!chaine) return reply.code(404).send({ message: "Aucune chaîne à ce numéro" });
    return chaine;
  });

  app.get<{ Params: IdParams }>("/api/live/channels/:id", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    const chaine = chaineDetaillee(request.params.id);
    if (!chaine) return reply.code(404).send({ message: "Chaîne introuvable" });
    /*
     * Chaque adresse part avec son doublon relayé, signé pour elle seule.
     *
     * Le client essaie la directe d'abord — c'est le chemin qui ne coûte rien au NAS — et bascule sur
     * l'autre quand le navigateur refuse : contenu mixte, ou absence d'en-tête CORS. Signer ici plutôt
     * qu'à la demande évite d'ouvrir une route qui signerait n'importe quelle adresse.
     */
    return { ...chaine, sources: chaine.sources.map((source) => ({ ...source, relais: adresseRelayee(source.url) })) };
  });

  /**
   * Ce que la lecture a appris : cette adresse a joué, ou elle n'a pas répondu.
   *
   * C'est ainsi que l'ordre d'essai s'améliore et que l'état d'une chaîne se mesure — à l'usage,
   * plutôt qu'en sondant les cent mille adresses du corpus. L'adresse doit appartenir à la chaîne :
   * sans cette vérification, n'importe quel corps de requête écrirait n'importe quelle ligne.
   */
  app.post<{ Params: IdParams }>("/api/live/channels/:id/resultat", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    const corps = request.body as { url?: unknown; ok?: unknown } | null;
    if (typeof corps?.url !== "string" || typeof corps.ok !== "boolean") {
      return reply.code(400).send({ message: "Résultat invalide" });
    }
    if (!noterResultat(request.params.id, corps.url, corps.ok)) {
      return reply.code(404).send({ message: "Adresse inconnue pour cette chaîne" });
    }
    // Une adresse qui a joué vaut « c'est ce qu'on regarde » : c'est le moment le plus sûr pour
    // retenir la chaîne, plutôt qu'à l'ouverture d'un flux dont on ignore encore s'il répondra.
    if (corps.ok) retenirDerniereChaine(profile.id, request.params.id);
    return reply.code(204).send();
  });

  /**
   * Le relais du navigateur : les octets d'une chaîne, recopiés par le NAS.
   *
   * Il n'est jamais le premier chemin — le client essaie l'adresse en direct d'abord, et n'y revient
   * que sur un blocage CORS ou un contenu mixte, les deux cas que rien côté navigateur ne peut lever.
   * Le serveur ne décode rien : il recopie, et ne signe que des adresses qu'il connaît déjà.
   *
   * Un manifeste est réécrit pour que ses segments repassent par ici ; tout le reste est transmis tel
   * quel, sans être mis en mémoire — un flux en direct n'a pas de fin, et l'accumuler serait une fuite
   * de mémoire à retardement.
   */
  app.get("/api/live/relais", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    const query = request.query as { u?: string; s?: string };
    const cible = query.u ? lireAdresseRelayee(query.u) : null;
    if (!cible || !query.s || !signatureValide(cible, query.s)) {
      // Indiscernable d'une route inexistante : un 403 confirmerait qu'une adresse existe.
      return reply.code(404).send({ message: "Adresse inconnue" });
    }
    if (!(await hoteAutorise(new URL(cible).hostname))) {
      return reply.code(403).send({ message: "Adresse interne refusée" });
    }
    try {
      const amont = await fetchWithTimeout(cible, {
        headers: { "User-Agent": "FlixTunes", ...(request.headers.range ? { Range: String(request.headers.range) } : {}) },
      }, 20_000);
      if (!amont.ok || !amont.body) return reply.code(502).send({ message: `Source indisponible (${amont.status})` });

      const type = amont.headers.get("content-type");
      // Un manifeste tient en quelques kilooctets : le lire entier pour le réécrire ne coûte rien.
      // Un segment, lui, est transmis en flux — d'où les deux chemins.
      if ((type ?? "").toLowerCase().includes("mpegurl") || /\.m3u8(\?|$)/i.test(cible)) {
        const corps = await amont.text();
        if (estUnManifeste(type, corps)) {
          return reply.header("Content-Type", "application/vnd.apple.mpegurl")
            .header("Cache-Control", "no-store")
            .send(reecrireManifeste(corps, cible));
        }
        return reply.header("Content-Type", type ?? "application/octet-stream").send(corps);
      }
      reply.code(amont.status === 206 ? 206 : 200);
      if (type) reply.header("Content-Type", type);
      for (const entete of ["content-length", "content-range", "accept-ranges"]) {
        const valeur = amont.headers.get(entete);
        if (valeur) reply.header(entete, valeur);
      }
      return reply.header("Cache-Control", "no-store").send(Readable.fromWeb(amont.body as never));
    } catch (cause) {
      return reply.code(502).send({ message: cause instanceof Error ? cause.message : "Relais impossible" });
    }
  });

  app.post("/api/scans", async (request, reply) => {
    const parsed = scanRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: "Demande d'analyse invalide", issues: parsed.error.issues });
    try {
      const { scope, mode, libraryId, priority } = parsed.data;
      const jobs = scope === "library"
        ? [scanCoordinator.enqueue(libraryId!, mode, scope, priority).job]
        : scanCoordinator.enqueueScope(scope, mode, priority);
      return reply.code(202).send({ jobs });
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: IdParams }>("/api/scans/:id/cancel", async (request, reply) => {
    const job = scanCoordinator.cancel(request.params.id);
    if (!job) return reply.code(404).send({ message: "Analyse introuvable" });
    if (!job.cancellable && job.status !== "cancelled") return reply.code(409).send({ message: "Cette analyse est déjà terminée" });
    return reply.code(202).send(scanCoordinator.get(request.params.id));
  });

  app.post<{ Params: IdParams }>("/api/scans/:id/retry", async (request, reply) => {
    const result = scanCoordinator.retry(request.params.id);
    if (!result) return reply.code(409).send({ message: "Cette analyse ne peut pas être relancée" });
    return reply.code(202).send(result.job);
  });

  app.post("/api/corrections", async (request, reply) => {
    const parsed = correctionCommandSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Commande de correction invalide" });
    try { return reply.code(201).send(applyCorrection(parsed.data)); }
    catch (error) { return reply.code(409).send({ message: error instanceof Error ? error.message : "Correction impossible" }); }
  });
  app.post<{ Params: IdParams }>("/api/corrections/:id/undo", async (request, reply) => {
    return undoCorrection(request.params.id)
      ? reply.send({ undone: true })
      : reply.code(409).send({ message: "Cette correction a déjà été annulée ou n'existe pas" });
  });
  app.get<{ Querystring: { command?: string; scope?: string; limit?: string } }>("/api/corrections", async (request) =>
    listAudit({ command: request.query.command as never, scope: request.query.scope,
      limit: request.query.limit ? Number(request.query.limit) : undefined }));
  app.post<{ Body: { catalogIds?: unknown } }>("/api/corrections/preview", async (request, reply) => {
    const catalogIds = Array.isArray(request.body?.catalogIds) ? request.body.catalogIds.filter((id): id is string => typeof id === "string") : null;
    if (!catalogIds?.length) return reply.code(400).send({ message: "Aucune fiche à prévisualiser" });
    return previewMassCorrection(catalogIds.slice(0, 2000));
  });

  app.get("/api/system/playback", async () => getPlaybackSystemInfo());
  /**
   * Un client signale qu'un codec annoncé ne s'est pas lu.
   *
   * Le serveur ne peut pas le constater seul : en lecture directe, il ne fait que servir le fichier,
   * et l'échec se produit dans le décodeur du client. Sans ce signalement, la même erreur se répète à
   * chaque lecture — le serveur repropose le codec, le client échoue, et personne n'apprend.
   *
   * Deux échecs sont nécessaires avant que le codec cesse d'être proposé : un échec isolé peut venir
   * d'un fichier abîmé ou d'un réseau qui a lâché, et priver de lecture directe pour un accident
   * coûterait plus que d'attendre la confirmation.
   */
  app.post("/api/playback/codec-failure", async (request, reply) => {
    const body = request.body as { deviceId?: unknown; codec?: unknown; reason?: unknown };
    const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
    const codec = typeof body.codec === "string" ? body.codec.trim() : "";
    if (deviceId.length < 6 || !codec) return reply.code(400).send({ message: "Appareil ou codec manquant" });
    const failures = recordCodecFailure(deviceId, codec, typeof body.reason === "string" ? body.reason : null);
    return { codec: codec.toLowerCase(), failures, quarantined: quarantinedCodecs(deviceId).includes(codec.toLowerCase()) };
  });

  /** Une lecture directe réussie vaut démenti : le codec fonctionne, quoi qu'on ait cru. */
  app.post("/api/playback/codec-success", async (request, reply) => {
    const body = request.body as { deviceId?: unknown; codec?: unknown };
    const deviceId = typeof body.deviceId === "string" ? body.deviceId.trim() : "";
    const codec = typeof body.codec === "string" ? body.codec.trim() : "";
    if (deviceId.length < 6 || !codec) return reply.code(400).send({ message: "Appareil ou codec manquant" });
    clearCodecQuarantine(deviceId, codec);
    return reply.code(204).send();
  });

  /** État lisible de la quarantaine, pour l'écran de diagnostic. */
  app.get("/api/playback/codec-quarantine", async () => listCodecQuarantine());

  app.get("/api/system/capacity", async () => getCapacityReport(await detectFfmpegSupport(), scanCoordinator.stats()));

  // Les reglages de conversion, lisibles et modifiables sans terminal. Ce qui les rend utiles n'est
  // pas de pouvoir tout forcer, mais de pouvoir comparer un choix force au verdict de la mesure —
  // qui se lit sur la meme page, dans le tableau des accelerateurs et des chemins de tone mapping.
  // Refait les micro-bancs au prochain rapport. Utile apres une mise a jour du paquet ou une
  // correction d'acces au peripherique : la signature du calibrage ne voit pas tout, et un verdict
  // perime se lit comme l'etat courant.
  app.post("/api/system/capacity/recalibrate", async () => { oublierCalibrages(); return { relance: true }; });

  // Télécommande : un appareil s'annonce, un autre lui adresse un ordre.
  //
  // Le contrôleur ne relaie jamais la vidéo. Il dépose un ordre, la cible le retire et négocie
  // elle-même sa lecture — c'est la règle que l'étape 58 reprendra pour le transfert de session, et la
  // poser ici évite d'avoir à défaire un raccourci plus tard.
  app.post<{ Body: { id?: string; nom?: string; type?: "tv" | "mobile" | "web"; mediaEnCours?: string | null } }>(
    "/api/devices/announce", async (request, reply) => {
      const corps = request.body ?? {};
      if (!corps.id || !corps.nom) return reply.code(400).send({ error: "Identifiant et nom requis" });
      return annoncerAppareil({
        id: corps.id, nom: corps.nom, type: corps.type ?? "web", mediaEnCours: corps.mediaEnCours ?? null,
      });
    });

  app.get("/api/devices", async () => appareilsActifs());

  // Le retrait vaut signe de vie : une cible qui vient chercher ses ordres est vivante par définition.
  app.get<{ Params: { id: string } }>("/api/devices/:id/commands",
    async (request) => ({ commandes: retirerCommandes(request.params.id) }));

  // L'échec est rendu explicitement plutôt qu'avalé : appuyer sans rien voir se produire, sans savoir
  // si l'appareil a reçu ou n'était plus là, est le défaut le plus déroutant d'une télécommande.
  app.post<{ Params: { id: string }; Body: CommandeAppareil }>("/api/devices/:id/command",
    async (request, reply) => {
      if (!request.body?.type) return reply.code(400).send({ error: "Commande sans type" });
      if (!envoyerCommande(request.params.id, request.body)) {
        return reply.code(404).send({ error: "Appareil inconnu ou hors ligne" });
      }
      return { transmis: true };
    });

  /**
   * Réglages de l'accès distant, et son contrôle.
   *
   * Ces routes ne figurent pas dans la liste blanche du WAN : on ne règle pas l'ouverture d'une porte
   * depuis l'extérieur de celle-ci.
   */
  app.get("/api/system/wan", async () => ({ parametres: parametresWan(), minimumPin: PIN_MINIMUM_DISTANT }));
  app.put("/api/system/wan", async (request, reply) => {
    try {
      return { parametres: definirParametresWan((request.body ?? {}) as Record<string, unknown>),
        // Le domaine est lu au démarrage par le serveur **et** par le script qui lance le proxy :
        // l'enregistrement ne suffit pas, il faut relancer pour qu'il prenne effet.
        redemarrageRequis: true };
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Réglage invalide" });
    }
  });
  app.post("/api/system/wan/verifier", async () => diagnostiquerWan());

  app.get("/api/system/conversion-preferences", async () => preferencesConversion());
  app.put<{ Body: Partial<ReturnType<typeof preferencesConversion>> }>("/api/system/conversion-preferences",
    async (request) => definirPreferencesConversion(request.body ?? {}));
  app.get("/api/system/media-inventory", async () => getServerMediaInventory());

  app.get<{ Params: IdParams }>("/api/artwork/:id", async (request, reply) => {
    const asset = getArtworkAsset(request.params.id);
    if (!asset) return reply.code(404).send({ message: "Image introuvable" });
    try {
      const info = await stat(asset.localPath);
      return reply.header("Content-Type", asset.mimeType).header("Content-Length", info.size)
        .header("Cache-Control", "public, max-age=31536000, immutable").send(createReadStream(asset.localPath));
    } catch {
      return reply.code(410).send({ message: "Le fichier d'image n'est plus accessible" });
    }
  });

  app.get<{ Params: { size: string; name: string } }>("/api/metadata/image/:size/:name", async (request, reply) => {
    if (!/^(w185|w342|w500)$/.test(request.params.size) || !/^[a-zA-Z0-9_.-]+$/.test(request.params.name)) {
      return reply.code(400).send({ message: "Image TMDB invalide" });
    }
    try {
      const response = await fetchTmdbPreview(`/${request.params.size}/${request.params.name}`);
      if (!response.ok) return reply.code(response.status).send({ message: "Aperçu indisponible" });
      const contentType = response.headers.get("content-type") || "image/jpeg";
      return reply.header("Content-Type", contentType).header("Cache-Control", "public, max-age=86400")
        .send(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/metadata/search", async (request, reply) => {
    const parsed = metadataSearchQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ message: "Recherche de métadonnées invalide", issues: parsed.error.issues });
    try {
      return await searchAllMetadata(parsed.data.kind, parsed.data.query, parsed.data.language, parsed.data.year, parsed.data.minYear);
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/metadata/providers", async () => metadataProviderStatuses());

  app.patch("/api/metadata/providers", async (request, reply) => {
    const parsed = metadataProviderConfigurationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Configuration fournisseur invalide", issues: parsed.error.issues });
    saveProviderConfiguration(parsed.data);
    resetProviderRuntimeCaches();
    const jobs = parsed.data.tmdbToken || parsed.data.tvdbApiKey || parsed.data.imdbApiToken || parsed.data.allocineApiToken
      ? scanCoordinator.enqueueScope("all", "metadata", 90)
      : [];
    return { providers: metadataProviderStatuses(), jobs };
  });

  app.get("/api/catalog", async (request, reply) => {
    const query = request.query as { libraryId?: string; query?: string; focusId?: string };
    if (!query.libraryId) return reply.code(400).send({ message: "Bibliothèque requise" });
    const search = `%${(query.query ?? "").trim()}%`;
    /**
     * Une fiche demandée nommément est servie **seule**.
     *
     * L'écran de correction s'ouvre de deux façons : depuis le bouton général, où l'on parcourt le
     * catalogue, et depuis une fiche précise, où l'on vient corriger *ce* titre. Servir la liste
     * entière dans le second cas oblige à retrouver soi-même son film parmi des centaines — et
     * comme la liste est plafonnée à 250 titres, un film situé plus loin dans l'alphabet n'y figurait
     * même pas : l'écran s'ouvrait alors sur un tout autre titre, sans rien signaler.
     */
    const rows = query.focusId
      ? db.prepare(`
          SELECT id, library_id, parent_id, kind, title, overview, year, season_number, episode_number, poster_url,
            external_provider, external_id, match_status, metadata_locked, match_confidence
          FROM catalog_items
          WHERE id = ? AND library_id = ? AND kind IN ('movie', 'show')
        `).all(query.focusId, query.libraryId)
      : db.prepare(`
          SELECT id, library_id, parent_id, kind, title, overview, year, season_number, episode_number, poster_url,
            external_provider, external_id, match_status, metadata_locked, match_confidence
          FROM catalog_items
          WHERE library_id = ? AND kind IN ('movie', 'show') AND title LIKE ?
          ORDER BY sort_title LIMIT 250
        `).all(query.libraryId, search);
    const typedRows = rows as Array<{
      id: string; library_id: string; parent_id: string | null; kind: "movie" | "show"; title: string; overview: string | null;
      year: number | null; season_number: number | null; episode_number: number | null; poster_url: string | null;
      external_provider: string | null; external_id: string | null; match_status: "unmatched" | "review" | "automatic" | "manual";
      metadata_locked: number; match_confidence: number | null;
    }>;
    return typedRows.map((row) => ({
      id: row.id, libraryId: row.library_id, parentId: row.parent_id, kind: row.kind, title: row.title, overview: row.overview, year: row.year,
      seasonNumber: row.season_number, episodeNumber: row.episode_number, posterUrl: row.poster_url,
      externalProvider: row.external_provider, externalId: row.external_id, matchStatus: row.match_status,
      metadataLocked: row.metadata_locked === 1, matchConfidence: row.match_confidence,
      needsReview: row.match_status === "unmatched" || row.match_status === "review" || (row.match_confidence ?? 0) < 0.82,
    }));
  });

  app.get("/api/metadata/review", async (request) => {
    const query = request.query as { libraryId?: string };
    const rows = db.prepare(`SELECT id, library_id, parent_id, kind, title, year, season_number, episode_number, poster_url,
      catalog_items.external_provider, catalog_items.external_id, match_status, metadata_locked, match_confidence,
      proposal.provider AS proposal_provider, proposal.external_id AS proposal_external_id,
      proposal.candidate_title AS proposal_title, proposal.candidate_year AS proposal_year,
      proposal.score AS proposal_score, proposal.reasons_json AS proposal_reasons
      FROM catalog_items LEFT JOIN metadata_match_proposals proposal ON proposal.catalog_id = catalog_items.id
      WHERE kind IN ('movie', 'show') AND (? IS NULL OR library_id = ?)
        AND (match_status IN ('unmatched', 'review') OR COALESCE(match_confidence, 0) < 0.82)
      ORDER BY COALESCE(match_confidence, 0), sort_title LIMIT 250`).all(query.libraryId ?? null, query.libraryId ?? null) as Array<{
        id: string; library_id: string; parent_id: string | null; kind: "movie" | "show"; title: string; year: number | null;
        season_number: number | null; episode_number: number | null; poster_url: string | null; external_provider: string | null;
        external_id: string | null; match_status: "unmatched" | "review" | "automatic" | "manual"; metadata_locked: number; match_confidence: number | null;
        proposal_provider: MetadataSearchCandidate["provider"] | null; proposal_external_id: string | null;
        proposal_title: string | null; proposal_year: number | null; proposal_score: number | null; proposal_reasons: string | null;
      }>;
    return rows.map((row) => ({ id: row.id, libraryId: row.library_id, parentId: row.parent_id, kind: row.kind,
      title: row.title, year: row.year, seasonNumber: row.season_number, episodeNumber: row.episode_number,
      posterUrl: row.poster_url, externalProvider: row.external_provider, externalId: row.external_id,
      matchStatus: row.match_status, metadataLocked: row.metadata_locked === 1, matchConfidence: row.match_confidence, needsReview: true,
      matchProposal: row.proposal_provider && row.proposal_external_id && row.proposal_title ? {
        provider: row.proposal_provider, externalId: row.proposal_external_id, kind: row.kind === "movie" ? "movie" : "tv",
        title: row.proposal_title, originalTitle: null, year: row.proposal_year, overview: null, posterUrl: null,
        score: row.proposal_score ?? 0, matchReasons: row.proposal_reasons ? JSON.parse(row.proposal_reasons) as string[] : [],
      } : null }));
  });

  app.post<{ Params: IdParams }>("/api/catalog/:id/match", async (request, reply) => {
    const parsed = metadataMatchInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Correspondance invalide", issues: parsed.error.issues });
    const item = db.prepare(`SELECT item.id, item.library_id, item.kind, item.title, item.year, library.language
      FROM catalog_items item JOIN library_folders library ON library.id = item.library_id
      WHERE item.id = ? AND item.kind IN ('movie', 'show')`)
      .get(request.params.id) as { id: string; library_id: string; kind: "movie" | "show"; title: string;
        year: number | null; language: string } | undefined;
    if (!item) return reply.code(404).send({ message: "Film ou série introuvable" });

    /*
     * Un identifiant IMDb collé à la main désigne une **œuvre**, pas un fournisseur.
     *
     * TMDB tient la correspondance et la rend en une requête. On la résout donc ici, et tout ce qui
     * suit travaille sur la fiche TMDB — résumé français, jaquette, distribution avec portraits. Sans
     * cette résolution, un `tt…` partait vers le connecteur IMDb licencié, que personne n'a configuré,
     * et l'écran répondait « fournisseur indisponible » pour un identifiant pourtant parfaitement
     * valide.
     *
     * Rien n'est deviné : si TMDB ne connaît pas l'identifiant, on le dit et on n'enregistre rien.
     * Proposer à la place un titre approchant serait exactement ce qu'une correction manuelle vient
     * corriger.
     */
    let fournisseur: typeof parsed.data.provider = parsed.data.provider;
    let identifiant = parsed.data.externalId;
    if (fournisseur === "imdb" && /^tt\d+$/i.test(identifiant)) {
      let resolu: string | null;
      try {
        resolu = await resoudreIdentifiantExterne(identifiant.toLowerCase(), "imdb_id",
          item.kind === "movie" ? "movie" : "tv");
      } catch (error) {
        return reply.code(502).send({
          message: `TMDB n'a pas pu être interrogé pour ${identifiant} : ${error instanceof Error ? error.message : String(error)}`,
        });
      }
      if (!resolu) {
        return reply.code(404).send({
          message: `TMDB ne connaît aucun${item.kind === "movie" ? " film" : "e série"} portant l'identifiant IMDb ${identifiant}.`,
        });
      }
      fournisseur = "tmdb";
      identifiant = resolu;
    }

    const titre = parsed.data.title ?? item.title;
    const annee = parsed.data.year === undefined ? item.year : parsed.data.year;
    const base = item.kind === "movie"
      ? { kind: "movie" as const, title: titre, year: annee, showTitle: null, seasonNumber: null, episodeNumber: null }
      : { kind: "episode" as const, title: titre, year: annee, showTitle: titre, seasonNumber: null, episodeNumber: null };
    let validated;
    try {
      validated = await fetchMetadataWithProviders(base, item.language, { provider: fournisseur, id: identifiant });
    } catch (error) {
      return reply.code(502).send({ message: `La fiche choisie n'a pas pu être validée : ${error instanceof Error ? error.message : String(error)}` });
    }
    const entity = item.kind === "movie" ? validated?.movie : validated?.show;
    if (!entity || entity.provider !== fournisseur || entity.externalId !== identifiant) {
      return reply.code(422).send({ message: "Le fournisseur ne confirme pas cette fiche ; aucune modification n'a été enregistrée." });
    }
    applyCorrection({ type: "rematch", catalogId: item.id, provider: fournisseur,
      externalId: identifiant, title: entity.title, year: entity.year });
    db.prepare("DELETE FROM metadata_match_proposals WHERE catalog_id = ?").run(item.id);

    // La correction s'applique ici même, sur cette seule fiche, et la réponse porte son nouvel état.
    //
    // Elle passait auparavant par une analyse de toute la bibliothèque, mise en file derrière le
    // reste : mille quatre cents interrogations du fournisseur pour un film. L'écran, lui, se
    // refermait sur la fiche inchangée — la correction semblait ignorée, et on la refaisait.
    //
    // L'échec n'est pas caché : la correspondance est enregistrée de toute façon, mais la réponse dit
    // ce qui n'a pas pu être récupéré, au lieu de laisser croire à une réussite.
    let refreshError: string | null = null;
    try {
      await scanLibraryById(item.library_id, { mode: "metadata", onlyCatalogId: item.id });
    } catch (error) {
      refreshError = error instanceof Error ? error.message : String(error);
    }
    const refreshed = db.prepare(`SELECT title, year, overview, poster_url, external_provider, external_id, match_status
      FROM catalog_items WHERE id = ?`).get(item.id);
    return reply.code(200).send({ catalogId: item.id, matchStatus: "manual", item: refreshed, refreshError });
  });

  app.delete<{ Params: IdParams }>("/api/catalog/:id/match", async (request, reply) => {
    try { applyCorrection({ type: "unlock", catalogId: request.params.id }); }
    catch { return reply.code(404).send({ message: "Élément de catalogue introuvable" }); }
    db.prepare("DELETE FROM metadata_match_proposals WHERE catalog_id = ?").run(request.params.id);
    return reply.code(204).send();
  });

  app.patch<{ Params: IdParams }>("/api/catalog/:id/metadata", async (request, reply) => {
    const parsed = manualMetadataInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Métadonnées manuelles invalides", issues: parsed.error.issues });
    const item = db.prepare("SELECT id, kind FROM catalog_items WHERE id = ?").get(request.params.id) as { id: string; kind: string } | undefined;
    if (!item) return reply.code(404).send({ message: "Élément de catalogue introuvable" });
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`UPDATE catalog_items SET title = ?, sort_title = ?, year = ?, overview = ?, metadata_language = ?,
        metadata_locked = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(parsed.data.title, parsed.data.title.toLocaleLowerCase(parsed.data.language), parsed.data.year, parsed.data.overview, parsed.data.language, item.id);
      for (const [field, value] of [["title", parsed.data.title], ["year", parsed.data.year], ["overview", parsed.data.overview]] as const) {
        if (value !== null) recordMetadataField({ catalogId: item.id, field, value, source: "manual", sourceId: null,
          language: parsed.data.language, confidence: 1, locked: true });
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return reply.send({ id: item.id, ...parsed.data, provenance: listMetadataProvenance(item.id) });
  });

  app.put<{ Params: IdParams }>("/api/catalog/:id/watchlist", async (request, reply) => {
    const profile = profileFromRequest(request); if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    const catalog = db.prepare("SELECT id FROM catalog_items WHERE id = ? AND kind IN ('movie', 'show')").get(request.params.id);
    if (!catalog || !isCatalogAllowed(profile.id, request.params.id)) return reply.code(404).send({ message: "Film ou série introuvable" });
    db.prepare("INSERT OR IGNORE INTO profile_watchlist (profile_id, catalog_id) VALUES (?, ?)").run(profile.id, request.params.id);
    return reply.code(204).send();
  });
  app.delete<{ Params: IdParams }>("/api/catalog/:id/watchlist", async (request, reply) => {
    const profile = profileFromRequest(request); if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    db.prepare("DELETE FROM profile_watchlist WHERE profile_id = ? AND catalog_id = ?").run(profile.id, request.params.id);
    return reply.code(204).send();
  });

  app.get("/api/setup", async (request) => request.expositionWan
    // Le Web appelle cette route avant le sélecteur de groupes. Refuser la route bloquait donc toute
    // connexion distante, mais rendre `listLibraries()` aurait publié les chemins du NAS. Le WAN ne
    // peut jamais effectuer l'assistant initial : il reçoit seulement le bit nécessaire au démarrage.
    ? { firstRunRequired: false, libraries: [] }
    : { firstRunRequired: isFirstRunRequired(), libraries: listLibraries() });

  app.get<{ Querystring: { path?: string; fichiers?: string } }>("/api/filesystem/directories", async (request, reply) => {
    try {
      // Les extensions voulues, nommées par l'appelant. Deux au plus, et courtes : ce paramètre sert à
      // choisir un fichier de réglages, pas à faire du serveur un explorateur de fichiers.
      const extensions = (request.query.fichiers ?? "").split(",").map((item) => item.trim().toLowerCase())
        .filter((item) => /^[a-z0-9]{1,8}$/.test(item)).slice(0, 2);
      return await browseDirectories(request.query.path, undefined, extensions);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Parcours du dossier impossible";
      return reply.code(message.includes("hors des volumes") ? 403 : 404).send({ message });
    }
  });

  app.post("/api/setup", async (request, reply) => {
    if (!isFirstRunRequired()) return reply.code(409).send({ message: "La configuration initiale est déjà terminée" });
    const parsed = setupInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Configuration initiale invalide", issues: parsed.error.issues });

    const resolvedLibraries = [] as Array<(typeof parsed.data.libraries)[number] & { resolvedPath: string }>;
    const uniquePaths = new Set<string>();
    for (const library of parsed.data.libraries) {
      const resolvedPath = path.resolve(library.path);
      const comparable = process.platform === "win32" ? resolvedPath.toLocaleLowerCase("fr") : resolvedPath;
      if (uniquePaths.has(comparable)) return reply.code(400).send({ message: `Le dossier ${library.path} est présent plusieurs fois` });
      uniquePaths.add(comparable);
      try {
        const info = await stat(resolvedPath);
        if (!info.isDirectory()) return reply.code(400).send({ message: `${library.path} n'est pas un dossier` });
      } catch {
        return reply.code(400).send({ message: `Le dossier ${library.path} est introuvable ou inaccessible depuis le serveur` });
      }
      resolvedLibraries.push({ ...library, organizeSeasons: false, resolvedPath });
    }

    const createdIds: string[] = [];
    db.exec("BEGIN IMMEDIATE");
    try {
      const insert = db.prepare(`
        INSERT INTO library_folders (id, name, path, kind, language, organize_seasons)
        VALUES (?, ?, ?, ?, ?, 0)
      `);
      for (const library of resolvedLibraries) {
        const id = randomUUID();
        insert.run(id, library.name, library.resolvedPath, library.kind, library.language);
        createdIds.push(id);
      }
      setSetting("first_run_completed", "true");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    for (const id of createdIds) scanCoordinator.enqueue(id, "files");
    return reply.code(201).send({ firstRunRequired: false, libraries: listLibraries() });
  });

  app.post("/api/libraries", async (request, reply) => {
    const parsed = libraryInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Configuration de bibliothèque invalide", issues: parsed.error.issues });
    const folderPath = path.resolve(parsed.data.path);
    try {
      const info = await stat(folderPath);
      if (!info.isDirectory()) return reply.code(400).send({ message: "Le chemin doit désigner un dossier" });
    } catch {
      return reply.code(400).send({ message: "Ce dossier est introuvable ou inaccessible depuis le serveur" });
    }
    try {
      const id = randomUUID();
      db.prepare(`
        INSERT INTO library_folders (id, name, path, kind, language, organize_seasons)
        VALUES (?, ?, ?, ?, ?, 0)
      `).run(id, parsed.data.name, folderPath, parsed.data.kind, parsed.data.language);
      setSetting("first_run_completed", "true");
      scanCoordinator.enqueue(id, "files");
      return reply.code(201).send(listLibraries().find((library) => library.id === id));
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        return reply.code(409).send({ message: "Ce dossier est déjà configuré" });
      }
      throw error;
    }
  });

  app.delete<{ Params: IdParams }>("/api/libraries/:id", async (request, reply) => {
    db.exec("BEGIN IMMEDIATE");
    let changes = 0;
    try {
      db.prepare("UPDATE media_items SET available = 0 WHERE library_id = ?").run(request.params.id);
      changes = Number(db.prepare("DELETE FROM library_folders WHERE id = ?").run(request.params.id).changes);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    if (changes === 0) return reply.code(404).send({ message: "Bibliothèque introuvable" });
    return reply.code(204).send();
  });

  app.patch<{ Params: IdParams }>("/api/libraries/:id/localization", async (request, reply) => {
    const parsed = libraryLocalizationInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Langue de bibliothèque invalide", issues: parsed.error.issues });
    const result = db.prepare("UPDATE library_folders SET language = ? WHERE id = ?").run(parsed.data.language, request.params.id);
    if (result.changes === 0) return reply.code(404).send({ message: "Bibliothèque introuvable" });
    const scan = scanCoordinator.enqueue(request.params.id, "metadata", "library", 85);
    return { library: listLibraries().find((library) => library.id === request.params.id), ...scan };
  });

  app.post<{ Params: IdParams }>("/api/libraries/:id/scan", async (request, reply) => {
    try {
      const result = scanCoordinator.enqueue(request.params.id, "files");
      return reply.code(202).send(result);
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: IdParams }>("/api/libraries/:id/refresh-metadata", async (request, reply) => {
    try {
      const result = scanCoordinator.enqueue(request.params.id, "metadata");
      return reply.code(202).send(result);
    } catch (error) {
      return reply.code(404).send({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/home-legacy", async () => {
    const profile = getDefaultProfile();
    const parental = profile.isChild ? `AND (${mediaAgeRatingSql} IS NULL OR ${mediaAgeRatingSql} <= ?)` : "";
    const rows = db.prepare(`${mediaSelect} WHERE m.available = 1 AND m.library_id IS NOT NULL ${parental} ORDER BY m.created_at DESC`)
      .all(profile.id, ...(profile.isChild ? [profile.age ?? 0] : [])) as Parameters<typeof mapMedia>[0][];
    const items = rows.map(mapMedia);
    const movies = items.filter((item) => item.kind === "movie");
    const episodes = items.filter((item) => item.kind === "episode");
    const showMap = new Map<string, (typeof episodes)[number] & { seasonCount: number }>();
    for (const episode of episodes) {
      if (!episode.showTitle) continue;
      const current = showMap.get(episode.showTitle);
      if (!current) showMap.set(episode.showTitle, { ...episode, id: `show:${episode.showTitle}`, kind: "show", title: episode.showTitle, seasonCount: 1 });
      else {
        const seasons = new Set(
          episodes.filter((candidate) => candidate.showTitle === episode.showTitle).map((candidate) => candidate.seasonNumber),
        );
        current.seasonCount = seasons.size;
      }
    }
    const continueWatching = items.filter((item) => item.progressPercent > 0 && !item.completed).slice(0, 12);
    return {
      profile,
      featured: continueWatching[0] ?? movies[0] ?? Array.from(showMap.values())[0] ?? null,
      continueWatching,
      recentlyAdded: items.slice(0, 12),
      movies,
      shows: Array.from(showMap.values()),
    };
  });

  app.get<{ Params: IdParams }>("/api/media-legacy/:id", async (request, reply) => {
    const profile = getDefaultProfile();
    const media = getMediaItem(profile.id, request.params.id);
    if (!media) return reply.code(404).send({ message: "Média introuvable" });
    return media;
  });

  app.get("/api/home", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    return buildHome(profile);
  });

  app.get<{ Params: IdParams }>("/api/media/:id", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    const media = getMediaItem(profile.id, request.params.id);
    if (!media) return reply.code(404).send({ message: "Média introuvable" });
    return media;
  });

  app.get<{ Params: IdParams }>("/api/media/:id/neighbors", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    if (!getMediaItem(profile.id, request.params.id)) {
      return reply.code(404).send({ message: "Média introuvable" });
    }
    return getPlaybackNeighbors(profile.id, request.params.id);
  });

  app.get<{ Params: IdParams }>("/api/catalog/:id/details", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    const details = getDetails(profile.id, request.params.id);
    if (!details) return reply.code(404).send({ message: "Fiche introuvable" });
    return details;
  });

  app.get<{ Params: IdParams }>("/api/catalog/:id/metadata-provenance", async (request, reply) => {
    const exists = db.prepare("SELECT 1 FROM catalog_items WHERE id = ?").get(request.params.id);
    if (!exists) return reply.code(404).send({ message: "Élément introuvable" });
    return listMetadataProvenance(request.params.id);
  });

  app.get("/api/search", async (request, reply) => {
    const query = request.query as { q?: string };
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    if (!query.q?.trim()) return [];
    if (query.q.length > 120) return reply.code(400).send({ message: "Recherche trop longue" });
    return searchCatalog(profile.id, query.q);
  });

  // « /api/catalog » sert déjà le centre de correspondances, qui liste les fiches d'une bibliothèque
  // pour l'administration. Le parcours du catalogue par une personne est un tout autre usage et prend
  // son propre chemin — les autres routes du préfixe sont en quatre segments, aucune collision.
  app.get("/api/catalog/browse", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    if (query.kind !== "movies" && query.kind !== "shows") {
      return reply.code(400).send({ message: "Type de catalogue invalide" });
    }
    if (query.q && query.q.length > 120) return reply.code(400).send({ message: "Recherche trop longue" });
    const sort = query.sort as CatalogSort | undefined;
    const filter = query.filter as CatalogFilter | undefined;
    if (sort && !["title", "release", "added"].includes(sort)) {
      return reply.code(400).send({ message: "Tri invalide" });
    }
    if (filter && !["all", "progress", "watched", "unwatched"].includes(filter)) {
      return reply.code(400).send({ message: "Filtre invalide" });
    }
    const letter = query.letter?.toLocaleLowerCase("fr");
    if (letter && !/^(?:[a-z]|#)$/.test(letter)) {
      return reply.code(400).send({ message: "Lettre invalide" });
    }
    const offset = Number(query.offset ?? 0);
    const limit = Number(query.limit ?? 60);
    if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(limit) || limit < 1) {
      return reply.code(400).send({ message: "Pagination invalide" });
    }
    /** Une borne d'année absente ne borne rien ; une borne illisible est refusée plutôt qu'ignorée. */
    const borne = (valeur: unknown): number | undefined | null => {
      if (valeur == null || valeur === "") return undefined;
      const annee = Number(valeur);
      // Refuser plutôt qu'ignorer : une borne silencieusement écartée donnerait un résultat qui ne
      // correspond pas à ce qui est affiché à l'écran, sans que rien ne le signale.
      return Number.isInteger(annee) && annee >= 1870 && annee <= 2200 ? annee : null;
    };
    const minYear = borne(query.minYear);
    const maxYear = borne(query.maxYear);
    if (minYear === null || maxYear === null) return reply.code(400).send({ message: "Année invalide" });
    if (minYear != null && maxYear != null && minYear > maxYear) {
      return reply.code(400).send({ message: "Intervalle d'années inversé" });
    }
    // Les genres arrivent séparés par des virgules : c'est ce qu'une chaîne de requête sait porter
    // sans ambiguïté, et le nom d'un genre TMDB n'en contient jamais.
    const genres = (query.genres ?? "").split(",").map((genre) => genre.trim()).filter(Boolean);
    if (genres.length > 12) return reply.code(400).send({ message: "Trop de genres demandés" });
    return listCatalog(profile.id, { kind: query.kind, sort, filter, query: query.q, minYear, maxYear, genres,
      letter, offset, limit });
  });

  app.get<{ Params: IdParams }>("/api/media/:id/stream", sendMedia);

  app.get<{ Params: IdParams }>("/api/media/:id/playback-info", async (request, reply) => {
    const profile = profileFromRequest(request);
    const media = profile ? getMediaItem(profile.id, request.params.id) : null;
    if (!media) return reply.code(404).send({ message: "Média introuvable" });
    const info = await getPlaybackInfo(request.params.id);
    if (!info) return reply.code(404).send({ message: "Média introuvable" });
    /**
     * De quoi nommer ce qu'on regarde.
     *
     * Le lecteur Android sait composer « Série · S1 E3 · Titre » depuis ces quatre champs — il le
     * faisait déjà pour l'épisode suivant, que le voisinage lui livre complet. Mais à l'ouverture il
     * ne recevait que cette réponse-ci, qui décrit les flux et rien d'autre : faute de titre, son
     * bandeau affichait « FlixTunes » pendant tout le film.
     */
    return { ...info, title: media.title, showTitle: media.showTitle,
      seasonNumber: media.seasonNumber, episodeNumber: media.episodeNumber };
  });
  // Une planche de cent vignettes plutôt qu'une image par survol : voir `getTimelineSheet`. La
  // ressource est immuable une fois produite, d'où le cache d'un an — c'est ce qui rend le second
  // balayage gratuit.
  app.get<{ Params: IdParams; Querystring: { sheet?: string } }>("/api/media/:id/timeline-sheet", async (request, reply) => {
    const planche = Number(request.query.sheet ?? 0);
    if (!Number.isFinite(planche) || planche < 0 || planche > 500) return reply.code(400).send({ message: "Planche invalide" });
    const profile = profileFromRequest(request);
    if (!profile || !getMediaItem(profile.id, request.params.id)) return reply.code(404).send({ message: "Média introuvable" });
    const file = await getTimelineSheet(request.params.id, planche);
    if (!file) return reply.code(404).send({ message: "Vignettes indisponibles" });
    const info = await stat(file);
    return reply.header("Content-Type", "image/jpeg").header("Content-Length", info.size)
      .header("Cache-Control", "public, max-age=31536000, immutable").send(createReadStream(file));
  });
  app.get<{ Params: IdParams }>("/api/media/:id/inventory", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile || !getMediaItem(profile.id, request.params.id)) return reply.code(404).send({ message: "Média introuvable" });
    const info = await getPlaybackInfo(request.params.id);
    if (!info) return reply.code(404).send({ message: "Média introuvable" });
    return info;
  });

  app.post<{ Params: IdParams }>("/api/media/:id/playback", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile || !getMediaItem(profile.id, request.params.id)) return reply.code(404).send({ message: "Média introuvable" });
    // Les capacités sont des indications, pas un contrat : une valeur aberrante est retirée plutôt que
    // de faire échouer la lecture. Un projecteur annonçant une enveloppe `0 × 0` — parce que
    // `Display.Mode` n'a pas encore de mode — ne lisait plus rien du tout.
    const { corps, rapport } = reparerCapacites(request.body);
    const parsed = playbackCapabilitiesSchema.safeParse(corps);
    if (!parsed.success) {
      // Le message ne disait pas quel champ était en cause : « Capacités de lecture invalides » sur un
      // téléviseur, et rien pour chercher. Les champs sont désormais nommés, au client comme au journal.
      const champs = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".") || "corps"))];
      request.log.warn({ champs, reparés: rapport.champs, media: request.params.id },
        "Capacités de lecture refusées après réparation");
      return reply.code(400).send({ message: `Capacités de lecture invalides : ${champs.join(", ")}`,
        champs, issues: parsed.error.issues });
    }
    if (rapport.champs.length) {
      request.log.info({ champs: rapport.champs, media: request.params.id },
        "Capacités de lecture réparées : valeurs ignorées, défauts appliqués");
    }
    const session = await createPlaybackSession(request.params.id, parsed.data);
    if (!session) return reply.code(404).send({ message: "Média introuvable" });
    return reply.code(session.status === "starting" ? 202 : 200).send(session);
  });

  app.get<{ Params: IdParams }>("/api/playback/:id", async (request, reply) => {
    const session = await getPlaybackSession(request.params.id);
    if (!session) return reply.code(404).send({ message: "Session de lecture introuvable" });
    return session;
  });

  app.get<{ Params: { id: string; file: string } }>("/api/playback/:id/:file", async (request, reply) => {
    const file = getPlaybackFile(request.params.id, request.params.file);
    if (!file) return reply.code(404).send({ message: "Segment introuvable" });
    try {
      const info = await stat(file.path);
      return reply.header("Content-Type", file.contentType).header("Content-Length", info.size)
        .header("Cache-Control", /\.(?:m3u8|mpd)$/.test(request.params.file) ? "no-cache" : "public, max-age=86400")
        .send(createReadStream(file.path));
    } catch {
      return reply.code(404).send({ message: "Segment en cours de préparation" });
    }
  });

  app.delete<{ Params: IdParams }>("/api/playback/:id", async (request, reply) => {
    if (!await stopPlaybackSession(request.params.id)) return reply.code(404).send({ message: "Session introuvable" });
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string; index: string }; Querystring: { offset?: string } }>("/api/media/:id/subtitles/:index.vtt", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile || !getMediaItem(profile.id, request.params.id)) return reply.code(404).send({ message: "Média introuvable" });
    const index = Number(request.params.index);
    if (!Number.isInteger(index) || index < 0) return reply.code(400).send({ message: "Piste invalide" });
    try {
      const subtitle = await extractSubtitle(request.params.id, index, Number(request.query.offset ?? 0));
      if (!subtitle) return reply.code(404).send({ message: "Cette piste ne peut pas être convertie en WebVTT" });
      const info = await stat(subtitle.path);
      return reply.header("Content-Type", subtitle.contentType).header("Content-Length", info.size)
        .header("Cache-Control", "public, max-age=86400").send(createReadStream(subtitle.path));
    } catch (error) {
      return reply.code(502).send({ message: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { id: string; index: string }; Querystring: { offset?: string; encoding?: string } }>("/api/media/:id/subtitles/external/:index.vtt", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile || !getMediaItem(profile.id, request.params.id)) return reply.code(404).send({ message: "Média introuvable" });
    const index = Number(request.params.index);
    if (!Number.isInteger(index) || index < 0) return reply.code(400).send({ message: "Sous-titre externe invalide" });
    try {
      const subtitle = await extractExternalSubtitle(request.params.id, index, Number(request.query.offset ?? 0), request.query.encoding);
      if (!subtitle) return reply.code(404).send({ message: "Ce sous-titre externe ne peut pas être converti en WebVTT" });
      const info = await stat(subtitle.path);
      return reply.header("Content-Type", subtitle.contentType).header("Content-Length", info.size)
        .header("Cache-Control", "public, max-age=86400").send(createReadStream(subtitle.path));
    } catch (error) { return reply.code(502).send({ message: error instanceof Error ? error.message : String(error) }); }
  });

  app.get<{ Params: IdParams }>("/api/media/:id/subtitle-preference", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    if (!getMediaItem(profile.id, request.params.id)) return reply.code(404).send({ message: "Média introuvable" });
    const row = db.prepare(`SELECT selection_type, stream_index, external_name, offset_seconds, size, background, color,
      position, font_family, encoding_override FROM subtitle_preferences WHERE profile_id = ? AND media_id = ?`)
      .get(profile.id, request.params.id) as { selection_type: string; stream_index: number | null; external_name: string | null;
        offset_seconds: number; size: string; background: number; color: string; position: string; font_family: string; encoding_override: string } | undefined;
    if (!row) return null;
    return subtitlePreferenceSchema.parse({ selectionType: row.selection_type, streamIndex: row.stream_index,
      externalName: row.external_name, offsetSeconds: row.offset_seconds, size: row.size, background: Boolean(row.background), color: row.color,
      position: row.position, fontFamily: row.font_family, encodingOverride: row.encoding_override });
  });

  app.put<{ Params: IdParams }>("/api/media/:id/subtitle-preference", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    const parsed = subtitlePreferenceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Préférences de sous-titres invalides", issues: parsed.error.issues });
    if (!getMediaItem(profile.id, request.params.id)) return reply.code(404).send({ message: "Média introuvable" });
    const value = parsed.data;
    db.prepare(`INSERT INTO subtitle_preferences (profile_id, media_id, selection_type, stream_index, external_name,
      offset_seconds, size, background, color, position, font_family, encoding_override, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(profile_id, media_id) DO UPDATE SET selection_type = excluded.selection_type,
      stream_index = excluded.stream_index, external_name = excluded.external_name, offset_seconds = excluded.offset_seconds,
      size = excluded.size, background = excluded.background, color = excluded.color, position = excluded.position, font_family = excluded.font_family,
      encoding_override = excluded.encoding_override, updated_at = CURRENT_TIMESTAMP`)
      .run(profile.id, request.params.id, value.selectionType, value.streamIndex, value.externalName, value.offsetSeconds,
        value.size, value.background ? 1 : 0, value.color, value.position, value.fontFamily, value.encodingOverride);
    return reply.code(204).send();
  });

  app.put<{ Params: IdParams }>("/api/media/:id/progress", async (request, reply) => {
    const parsed = progressInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Progression invalide", issues: parsed.error.issues });
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    if (!getMediaItem(profile.id, request.params.id)) return reply.code(404).send({ message: "Média introuvable" });
    const completed = (parsed.data.completed ?? parsed.data.positionSeconds / parsed.data.durationSeconds >= 0.9) ? 1 : 0;
    db.prepare(`
      INSERT INTO playback_progress (profile_id, media_id, position_seconds, duration_seconds, completed, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(profile_id, media_id) DO UPDATE SET position_seconds = excluded.position_seconds,
        duration_seconds = excluded.duration_seconds, completed = excluded.completed, updated_at = CURRENT_TIMESTAMP
    `).run(profile.id, request.params.id, parsed.data.positionSeconds, parsed.data.durationSeconds, completed);
    return reply.code(204).send();
  });

  app.delete<{ Params: IdParams }>("/api/media/:id/progress", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    db.prepare("DELETE FROM playback_progress WHERE profile_id = ? AND media_id = ?").run(profile.id, request.params.id);
    return reply.code(204).send();
  });

  app.get<{ Params: IdParams }>("/api/people/:id", async (request, reply) => {
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    const details = getPersonDetails(profile.id, request.params.id);
    if (!details) return reply.code(404).send({ message: "Personne introuvable" });
    return details;
  });

  /** Marque d'un seul geste un film, un épisode, une saison ou une série entière. */
  app.put<{ Params: IdParams }>("/api/catalog/:id/watched", async (request, reply) => {
    const parsed = watchedInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "État vu invalide", issues: parsed.error.issues });
    const profile = profileFromRequest(request);
    if (!profile) return reply.code(404).send({ message: "Profil introuvable" });
    const catalog = db.prepare("SELECT id, kind FROM catalog_items WHERE id = ?").get(request.params.id) as
      { id: string; kind: "movie" | "show" | "season" | "episode" } | undefined;
    if (!catalog) return reply.code(404).send({ message: "Fiche introuvable" });
    if (!isCatalogAllowed(profile.id, catalog.id)) return reply.code(404).send({ message: "Fiche introuvable" });
    const media = db.prepare(`
      SELECT DISTINCT m.id FROM media_items m
      WHERE m.available = 1 AND (
        m.catalog_id = ?
        OR m.catalog_id IN (SELECT e.id FROM catalog_items e WHERE e.parent_id = ? AND e.kind = 'episode')
        OR m.catalog_id IN (
          SELECT e.id FROM catalog_items e
          JOIN catalog_items s ON s.id = e.parent_id AND s.kind = 'season'
          WHERE s.parent_id = ? AND e.kind = 'episode'))
    `).all(catalog.id, catalog.id, catalog.id) as Array<{ id: string }>;
    if (!media.length) return reply.code(409).send({ message: "Aucun fichier disponible pour cette fiche" });
    db.exec("BEGIN IMMEDIATE");
    try {
      if (parsed.data.completed) {
        const mark = db.prepare(`
          INSERT INTO playback_progress (profile_id, media_id, position_seconds, duration_seconds, completed, updated_at)
          VALUES (?, ?, 1, 1, 1, CURRENT_TIMESTAMP)
          ON CONFLICT(profile_id, media_id) DO UPDATE SET position_seconds = 1, duration_seconds = 1,
            completed = 1, updated_at = CURRENT_TIMESTAMP
        `);
        for (const item of media) mark.run(profile.id, item.id);
      } else {
        const clear = db.prepare("DELETE FROM playback_progress WHERE profile_id = ? AND media_id = ?");
        for (const item of media) clear.run(profile.id, item.id);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { completed: parsed.data.completed, count: media.length };
  });

  app.post("/api/library/scan", async (_request, reply) => {
    const results = scanCoordinator.enqueueScope("all", "files");
    return reply.code(202).send(results);
  });

  const cleanupTimer = setInterval(() => void cleanupPlaybackSessions(), 30 * 60 * 1000);
  cleanupTimer.unref();
  // Les sessions abandonnées se balaient bien plus souvent que le cache : chacune tient un FFmpeg
  // vivant et une part du budget de conversion, alors qu'un répertoire en trop ne coûte que du disque.
  const idleTimer = setInterval(() => void cleanupIdleSessions(), 60 * 1000);
  idleTimer.unref();
  app.addHook("onClose", async () => {
    clearInterval(cleanupTimer); clearInterval(idleTimer); await cleanupPlaybackSessions(0);
  });
}

export { parseSingleRange };
