import path from "node:path";
import { readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";

const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
try {
  loadEnvFile(path.join(workspaceRoot, ".env"));
} catch {
  // La configuration par variables système reste valide sans fichier .env.
}

const configuredDataDir = process.env.FLIXTUNES_DATA_DIR?.trim() || "data";

/**
 * Version réellement déployée, lue au démarrage plutôt qu'écrite en dur.
 *
 * Elle était figée à « 0.5.3 » et n'avait pas suivi trois versions de suite : l'écran de diagnostic
 * annonçait 0.5.3 sur un serveur 0.5.6, et il devenait impossible de savoir ce qui tournait
 * réellement — donc impossible de dire si un correctif était installé ou non. Une version fausse est
 * pire qu'une version absente : elle fait chercher la panne au mauvais endroit.
 */
function versionDeployee(): { version: string; etape: number } {
  const secours = { version: "0.0.0", etape: 0 };
  try {
    const manifeste = JSON.parse(readFileSync(path.resolve(workspaceRoot, "apps/server/package.json"), "utf8"));
    const version = String(manifeste.version ?? secours.version);
    // L'étape se déduit de la version : 0.5.6 correspond à l'étape 56, et les deux ne peuvent plus
    // diverger comme elles l'avaient fait.
    const [, mineur = NaN, correctif = NaN] = version.split(".").map(Number);
    const etape = Number.isFinite(mineur) && Number.isFinite(correctif) ? mineur * 10 + correctif : secours.etape;
    return { version, etape };
  } catch {
    return secours;
  }
}

const deployee = versionDeployee();

/**
 * Révision du paquet installé — « r7 » —, annoncée par le script de démarrage ASUSTOR.
 *
 * La version applicative ne suffit pas à identifier ce qui tourne : plusieurs révisions d'un paquet
 * partagent la même version, et c'est justement entre deux révisions qu'un correctif d'empaquetage se
 * juge. Vide hors installation par paquet.
 */
const revision = process.env.FLIXTUNES_PACKAGE_REVISION?.trim() || null;

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 4000),
  dataDir: path.isAbsolute(configuredDataDir) ? configuredDataDir : path.resolve(workspaceRoot, configuredDataDir),
  tmdbToken: process.env.TMDB_ACCESS_TOKEN?.trim() || null,
  tmdbLanguage: process.env.TMDB_LANGUAGE?.trim() || "fr-FR",
  tvdbApiKey: process.env.TVDB_API_KEY?.trim() || null,
  tvdbPin: process.env.TVDB_PIN?.trim() || null,
  fanartApiKey: process.env.FANART_API_KEY?.trim() || null,
  imdbApiUrl: process.env.IMDB_LICENSED_API_URL?.trim() || null,
  imdbApiToken: process.env.IMDB_LICENSED_API_TOKEN?.trim() || null,
  allocineApiUrl: process.env.ALLOCINE_LICENSED_API_URL?.trim() || null,
  allocineApiToken: process.env.ALLOCINE_LICENSED_API_TOKEN?.trim() || null,
  youtubeApiKey: process.env.YOUTUBE_API_KEY?.trim() || null,
  ffmpegPath: process.env.FFMPEG_PATH?.trim() || "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH?.trim() || "ffprobe",
  hardwareAcceleration: process.env.FLIXTUNES_HW_ACCEL?.trim().toLowerCase() || "auto",
  hardwareDevice: process.env.FLIXTUNES_HW_DEVICE?.trim() || "/dev/dri/renderD128",
  // Codec de sortie des conversions. `auto` conserve le HEVC d'une source HEVC quand l'appareil
  // l'annonce, et sort du H.264 partout ailleurs. `h264` et `hevc` forcent, pour le mode expert.
  videoOutputCodec: process.env.FLIXTUNES_VIDEO_CODEC?.trim().toLowerCase() || "auto",
  // Plafond de définition imposé au serveur. `auto` respecte ce que l'appareil annonce.
  maxOutputHeight: process.env.FLIXTUNES_MAX_HEIGHT?.trim() || "auto",
  // auto = libplacebo/Vulkan puis zscale logiciel, ou le chemin que la mesure designe.
  toneMapping: process.env.FLIXTUNES_TONEMAP?.trim().toLowerCase() || "auto",
  // Part de la capacité mesurée réellement offerte aux conversions. Le reste protège interface et analyses.
  transcodeHeadroom: Math.max(0.1, Math.min(1, Number(process.env.FLIXTUNES_TRANSCODE_HEADROOM ?? 0.6))),
  minimumFreeMemoryBytes: Math.max(128, Number(process.env.FLIXTUNES_MIN_FREE_MEMORY_MB ?? 384)) * 1024 * 1024,
  thermalLimitCelsius: Math.max(45, Math.min(110, Number(process.env.FLIXTUNES_THERMAL_LIMIT_C ?? 85))),
  version: deployee.version,
  step: deployee.etape,
  packageRevision: revision,
  // Alias temporaire conservé dans l'API pour les clients antérieurs à 0.4.7.
  phase: deployee.etape,
  webDistDir: path.resolve(workspaceRoot, "apps/web/dist"),
  apiToken: process.env.FLIXTUNES_API_TOKEN?.trim() || null,
  mdnsEnabled: process.env.FLIXTUNES_MDNS !== "0" && process.env.NODE_ENV !== "test",
  watchLibraries: process.env.FLIXTUNES_WATCH !== "0" && process.env.NODE_ENV !== "test",
  watchPolling: process.env.FLIXTUNES_WATCH_POLLING === "1",
  scanIntervalHours: Math.max(1, Number(process.env.FLIXTUNES_SCAN_INTERVAL_HOURS ?? 6)),
  scanConcurrency: Math.max(1, Math.min(4, Number(process.env.FLIXTUNES_SCAN_CONCURRENCY ?? 2))),
  /**
   * Plafond de conversions simultanées, ou `null` si personne ne l'a fixé.
   *
   * Le `?? 2` d'avant rendait « non posée » et « posée à 2 » indiscernables : une installation qui ne
   * configurait rien ressemblait à une installation ayant délibérément choisi 2, et le plafond
   * automatique déduit de la mesure ne pouvait donc pas exister. Cette machine soutient sept
   * conversions 1080p et n'en autorisait que deux.
   */
  transcodeConcurrency: process.env.FLIXTUNES_TRANSCODE_CONCURRENCY
    ? Math.max(1, Math.min(16, Number(process.env.FLIXTUNES_TRANSCODE_CONCURRENCY)))
    : null,
  // Vitesse maximale de production d'une conversion, en multiple du temps réel. 0 désactive la
  // régulation et rend à FFmpeg le droit d'encoder le film entier à fond, comme avant l'étape 57.
  readRate: Math.max(0, Math.min(10, Number(process.env.FLIXTUNES_READRATE ?? 2))),
  // Durée produite à pleine vitesse avant que la régulation ne s'applique. Elle couvre la première
  // image et les déplacements courts, qui ne doivent rien perdre à la régulation.
  readRateBurstSeconds: Math.max(0, Math.min(600, Number(process.env.FLIXTUNES_READRATE_BURST_SECONDS ?? 60))),
  // Sans la moindre requête d'un client pendant ce délai, une session de conversion est abandonnée.
  sessionIdleMinutes: Math.max(1, Math.min(240, Number(process.env.FLIXTUNES_SESSION_IDLE_MINUTES ?? 10))),
  transcodeCacheHours: Math.max(0.25, Math.min(72, Number(process.env.FLIXTUNES_TRANSCODE_CACHE_HOURS ?? 6))),
  transcodeCacheMaxBytes: Math.max(512, Number(process.env.FLIXTUNES_TRANSCODE_CACHE_MAX_MB ?? 8192)) * 1024 * 1024,
  backupIntervalHours: Math.max(1, Number(process.env.FLIXTUNES_BACKUP_INTERVAL_HOURS ?? 24)),
  backupRetention: Math.max(1, Number(process.env.FLIXTUNES_BACKUP_RETENTION ?? 7)),

  /**
   * Accès distant. **Rien n'existe tant que le domaine n'est pas posé.**
   *
   * Le réglage décisif est `FLIXTUNES_WAN_DOMAIN` : sans lui, pas de seconde écoute, pas de port lié,
   * pas de Caddy démarré. Une mise à jour ne peut donc pas ouvrir l'accès distant par inadvertance —
   * il faut l'avoir demandé.
   *
   * L'écoute distante parle en clair, mais sur la **boucle locale uniquement** : c'est Caddy, devant,
   * qui porte TLS et le certificat. Écouter sur `0.0.0.0` exposerait ce port en clair au réseau, et
   * une erreur de redirection sur la box l'exposerait en clair à Internet — d'où un défaut à
   * `127.0.0.1` qu'il faut vraiment vouloir changer.
   */
  wan: {
    domain: process.env.FLIXTUNES_WAN_DOMAIN?.trim() || null,
    host: process.env.FLIXTUNES_WAN_HOST?.trim() || "127.0.0.1",
    port: Number(process.env.FLIXTUNES_WAN_PORT ?? 4001),
    // Ports du NAS vers lesquels la box redirige le 80 et le 443 publics. Ils n'ont pas besoin d'être
    // privilégiés : les serveurs ACME joignent l'adresse publique, pas ceux-ci.
    httpPort: Number(process.env.FLIXTUNES_WAN_HTTP_PORT ?? 8080),
    httpsPort: Number(process.env.FLIXTUNES_WAN_HTTPS_PORT ?? 8444),
    sessionHours: Math.max(1, Math.min(720, Number(process.env.FLIXTUNES_WAN_SESSION_HOURS ?? 12))),
    /**
     * Adresses dont on accepte l'en-tête `X-Forwarded-For`.
     *
     * Derrière Caddy, toute requête arrive de la boucle locale. Sans ce réglage, la limitation de
     * débit compterait Internet entier sur un seul compteur, le ralentissement du PIN bloquerait
     * tout le monde au premier attaquant venu, et le journal n'enregistrerait que `127.0.0.1`.
     *
     * On ne met jamais `true` : Fastify ferait alors confiance à l'en-tête que **le visiteur**
     * fabrique, et n'importe qui choisirait l'adresse sous laquelle il est compté.
     */
    proxies: (process.env.FLIXTUNES_WAN_PROXIES?.trim() || "127.0.0.1,::1")
      .split(",").map((item) => item.trim()).filter(Boolean),
  },
};
