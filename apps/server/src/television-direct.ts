import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ChaineDirect, ChaineDirectDetaillee, ClassementListe, EtatDirect, ListeDirect, PageChaines, ParametresDirect, SourceChaine } from "@flixtunes/contracts";
import { db, getSetting, setSetting } from "./database.js";
import { MASQUES_CLASSEMENT, analyserM3U, cleDeChaine, lireCatalogueM3U, lisibleParNosLecteurs, masqueDesClassements } from "./m3u.js";
import { RANG_INCONNU, RANG_SANS_PAYS, empreinteDesRangs, nomDuPays, numerosTnt, paysDeLaChaine, rangsDesPays } from "./pays.js";
import { listerSources, listesDeLaSource, type SourceDirect } from "./live-fournisseurs.js";
import { fetchWithTimeout } from "./resilience.js";
import { normaliseForSearch } from "./search-normalise.js";

/**
 * La télévision en direct : réglages, import, fusion, grille.
 *
 * Le corpus de référence est mesuré et non supposé — 535 listes déclarées, 527 qui répondent, 42 Mio,
 * 181 126 entrées pour 100 113 adresses distinctes. Tout ce qui suit découle de ces chiffres, et
 * `docs/CHANTIER_LIVE_TV_0.5.7.md` en garde le détail.
 *
 * **Trois principes tiennent ce fichier :**
 *
 * 1. *Le serveur rafraîchit, les clients lisent.* Quarante-deux mégaoctets retéléchargés par chaque
 *    téléphone à chaque démarrage seraient la fin de « ultra performant » avant d'avoir commencé.
 * 2. *Rien n'est gardé en mémoire au-delà d'une liste.* Une liste fait 193 entrées en médiane et 2 518
 *    au pire ; le corpus entier, lui, ne tiendrait pas confortablement dans le tas d'un Celeron.
 * 3. *La fonction s'active.* Éteinte au départ, réglage en base, arrêt net — la même règle que le
 *    repérage des génériques, pour la même raison : elle coûte, donc elle ne s'impose pas.
 */

const CLE_PARAMETRES = "live.parametres";
const DEFAUTS: ParametresDirect = { actif: false, dossier: null, fichier: "m3u.json", cadenceHeures: 12 };

/**
 * Combien de listes on télécharge en même temps.
 *
 * Seize fils tenaient sur le poste de développement — 527 listes en 4,1 s. Huit ici, parce que la
 * mesure qui compte est celle du NAS : un Celeron à quatre cœurs qui sert peut-être un film en même
 * temps n'a pas à ouvrir seize connexions pour gagner deux secondes sur un travail de fond.
 */
const FILS = 8;
/** Une liste de plus de 8 Mio n'est pas une liste : la plus grosse du corpus mesuré fait 0,35 Mio. */
const TAILLE_MAX = 8 * 1024 * 1024;
/** Le catalogue lui-même : 535 entrées font 60 Kio. Deux mégaoctets laissent large. */
const CATALOGUE_MAX = 2 * 1024 * 1024;

export function parametresDirect(): ParametresDirect {
  const brut = getSetting(CLE_PARAMETRES);
  if (!brut) return { ...DEFAUTS };
  try {
    const lu = JSON.parse(brut) as Partial<ParametresDirect>;
    return {
      actif: lu.actif === true,
      dossier: typeof lu.dossier === "string" && lu.dossier.trim() ? lu.dossier.trim() : null,
      fichier: typeof lu.fichier === "string" && lu.fichier.trim() ? lu.fichier.trim() : DEFAUTS.fichier,
      cadenceHeures: Number.isFinite(lu.cadenceHeures) ? Math.min(168, Math.max(1, Number(lu.cadenceHeures))) : DEFAUTS.cadenceHeures,
    };
  } catch {
    return { ...DEFAUTS };
  }
}

/**
 * Enregistre les réglages, et arrête net ce qui tourne si on éteint.
 *
 * Le nom de fichier est vérifié plutôt que nettoyé : `../../etc/passwd` glissé dans ce champ
 * remonterait hors du dossier choisi. Un nom de fichier n'a ni séparateur ni point-point, c'est une
 * règle simple à énoncer et donc simple à vérifier.
 */
export function enregistrerParametres(entree: Partial<ParametresDirect>): ParametresDirect {
  const actuels = parametresDirect();
  const fichier = entree.fichier?.trim() ?? actuels.fichier;
  if (fichier.includes("/") || fichier.includes("\\") || fichier.includes("..") || !fichier) {
    throw new Error("Le nom du fichier ne peut pas contenir de chemin.");
  }
  const suivants: ParametresDirect = {
    actif: entree.actif ?? actuels.actif,
    dossier: entree.dossier === undefined ? actuels.dossier : (entree.dossier?.trim() || null),
    fichier,
    cadenceHeures: entree.cadenceHeures === undefined
      ? actuels.cadenceHeures
      : Math.min(168, Math.max(1, Math.round(Number(entree.cadenceHeures) || DEFAUTS.cadenceHeures))),
  };
  setSetting(CLE_PARAMETRES, JSON.stringify(suivants));
  // Arrêt net : éteindre veut dire « je veux ma machine », pas « finis les cinq cents listes en cours ».
  if (!suivants.actif) arreterRafraichissement();
  return suivants;
}

/* ------------------------------------------------------------------------ */
/* L'état d'un rafraîchissement                                              */
/* ------------------------------------------------------------------------ */

let interruption: AbortController | null = null;
let enCours = false;
let faites = 0;
let total = 0;
let listeCourante: string | null = null;
let entreesLues = 0;
let ecarteesDeLaPasse = 0;

export function arreterRafraichissement(): void {
  interruption?.abort();
}

/* ------------------------------------------------------------------------ */
/* La source, et ses listes                                                  */
/* ------------------------------------------------------------------------ */

interface LigneSource { id: string; emplacement: string; rafraichie_le: string | null; dernier_message: string | null }

/** Le chemin complet du catalogue, ou `null` si rien n'est réglé. */
export function cheminDuCatalogue(parametres = parametresDirect()): string | null {
  return parametres.dossier ? path.join(parametres.dossier, parametres.fichier) : null;
}

/**
 * La source locale, créée à la demande.
 *
 * Une seule sorte de source existe aujourd'hui. La table en accepte trois : c'est ce qui permettra à
 * Xtream Codes et aux listes publiques de se ranger à côté sans toucher à ce qui suit.
 */
function sourceLocale(creer: boolean): LigneSource | null {
  const chemin = cheminDuCatalogue();
  if (!chemin) return null;
  const trouvee = db.prepare("SELECT id, emplacement, rafraichie_le, dernier_message FROM live_sources WHERE type = 'm3u' AND emplacement = ?")
    .get(chemin) as unknown as LigneSource | undefined;
  if (trouvee) return trouvee;
  if (!creer) return null;
  const id = identifiant(`source:${chemin}`);
  /**
   * Changer de fichier de listes retire l'ancien, il ne s'ajoute pas à côté.
   *
   * Sans cela, désigner un autre `m3u.json` laisserait les listes du précédent dans la base : ses
   * chaînes resteraient dans la grille, sans que rien à l'écran ne dise d'où elles viennent ni
   * comment s'en défaire. Les chaînes elles-mêmes survivent — c'est la cascade des listes qui emporte
   * les adresses —, donc les numéros restent tenus.
   */
  db.prepare("DELETE FROM live_sources WHERE type = 'm3u' AND emplacement <> ?").run(chemin);
  db.prepare("INSERT INTO live_sources (id, type, libelle, emplacement) VALUES (?, 'm3u', ?, ?)")
    .run(id, path.basename(chemin), chemin);
  return { id, emplacement: chemin, rafraichie_le: null, dernier_message: null };
}

/**
 * Le nom réduit à ce qui se tape : sans accents, sans espaces, **ponctuation gardée**.
 *
 * C'est la forme qui rend une recherche littérale possible. « Canal+ », « CANAL + » et
 * « canal+ » donnent tous `canal+` ; « Canal 8 » donne `canal8`. Taper « canal + » ne trouve donc
 * plus les mille chaînes hispanophones dont le nom contient seulement le mot *canal*.
 *
 * Les espaces partent parce qu'on ne se souvient jamais s'il y en a un : le corpus écrit
 * « Canal+ », « Canal + » et « CANAL+ » pour la même chaîne.
 */
export function compacterNom(nom: string): string {
  return nom.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, "");
}

/** Un identifiant court, stable et dérivé — deux imports du même nom retombent sur la même ligne. */
function identifiant(graine: string): string {
  return createHash("sha1").update(graine).digest("hex").slice(0, 16);
}

export function listerListes(): ListeDirect[] {
  const lignes = db.prepare(`SELECT id, nom, url, classement, cochee, entrees, ecartees, rafraichie_le, dernier_message
    FROM live_playlists ORDER BY nom COLLATE NOCASE`).all() as unknown as Array<{
      id: string; nom: string; url: string; classement: ClassementListe; cochee: number;
      entrees: number; ecartees: number; rafraichie_le: string | null; dernier_message: string | null;
    }>;
  return lignes.map((ligne) => ({
    id: ligne.id, nom: ligne.nom, url: ligne.url, classement: ligne.classement,
    cochee: ligne.cochee === 1, entrees: ligne.entrees, ecartees: ligne.ecartees,
    rafraichieLe: ligne.rafraichie_le, dernierMessage: ligne.dernier_message,
  }));
}

/* ------------------------------------------------------------------------ */
/* L'état lu en base                                                         */
/* ------------------------------------------------------------------------ */

let derniereDuree: number | null = null;

export function etatDirect(): EtatDirect {
  const parametres = parametresDirect();
  const source = sourceLocale(false);
  const compte = (requete: string, ...params: unknown[]): number => {
    const ligne = db.prepare(requete).get(...params as never[]) as unknown as { n: number } | undefined;
    return ligne?.n ?? 0;
  };
  // Les comptes portent sur **toutes** les sources actives : la grille les mêle, l'état doit les mêler
  // aussi. S'en tenir au fichier local ferait disparaître de l'écran ce qu'un portail apporte.
  const listes = compte("SELECT COUNT(*) AS n FROM live_playlists");
  const retenues = compte(`SELECT COUNT(*) AS n FROM live_playlists p JOIN live_sources s ON s.id = p.source_id
    WHERE p.cochee = 1 AND s.activee = 1`);
  const lues = compte(`SELECT COALESCE(SUM(p.entrees), 0) AS n FROM live_playlists p JOIN live_sources s ON s.id = p.source_id
    WHERE p.cochee = 1 AND s.activee = 1`);
  const chaines = compte("SELECT COUNT(*) AS n FROM live_channels WHERE adresses > 0");
  const adresses = compte("SELECT COUNT(*) AS n FROM live_channel_urls");
  return {
    actif: parametres.actif,
    // Une source suffit, quelle que soit sa sorte : un portail Xtream seul est une installation
    // parfaitement réglée, sans aucun fichier sur le NAS.
    configure: Boolean(cheminDuCatalogue(parametres)) || listerSources().some((candidate) => candidate.activee),
    enCours,
    listes,
    listesRetenues: retenues,
    chaines,
    adresses,
    fusionnees: Math.max(0, lues - chaines),
    ecartees: compte(`SELECT COALESCE(SUM(p.ecartees), 0) AS n FROM live_playlists p JOIN live_sources s ON s.id = p.source_id
      WHERE p.cochee = 1 AND s.activee = 1`),
    // La date la plus récente parmi les sources : c'est celle de la grille qu'on regarde.
    rafraichieLe: (db.prepare("SELECT MAX(rafraichie_le) AS date FROM live_sources")
      .get() as unknown as { date: string | null } | undefined)?.date ?? null,
    dernierMessage: getSetting("live.bilan"),
    progression: enCours ? { faites, total, liste: listeCourante, entrees: entreesLues } : null,
    dureeSecondes: derniereDuree,
  };
}

/* ------------------------------------------------------------------------ */
/* Le rafraîchissement                                                       */
/* ------------------------------------------------------------------------ */

interface ResultatListe { id: string; nom: string; url: string; texte: string | null; message: string | null }

/**
 * Relit le catalogue et toutes les listes cochées.
 *
 * Le déroulé, et la raison de chaque choix :
 *
 * 1. **Le catalogue est lu sur le disque du serveur**, pas envoyé par un client : c'est un fichier du
 *    NAS, désigné par un réglage, et c'est le serveur qui y a accès.
 * 2. **Les listes connues sont mises à jour, les disparues retirées.** Une liste qu'on retire du
 *    `m3u.json` doit disparaître de l'écran, sinon le fichier ne commande plus rien.
 * 3. **Chaque liste est téléchargée puis écrite aussitôt**, dans une transaction qui ne dure que le
 *    temps de ses quelques centaines d'entrées. Une transaction unique de 181 000 lignes tiendrait le
 *    verrou d'écriture pendant toute la durée du téléchargement, et le reste du serveur avec.
 * 4. **Les numéros sont attribués à la fin**, aux seules chaînes qui n'en ont pas encore.
 */
export async function rafraichirDirect(): Promise<EtatDirect> {
  const parametres = parametresDirect();
  if (!parametres.actif) throw new Error("La télévision en direct est désactivée.");
  /*
   * Le fichier local n'est plus obligatoire.
   *
   * Un portail Xtream seul, ou les listes publiques seules, sont des installations parfaitement
   * réglées : exiger un `m3u.json` sur le NAS obligerait à en inventer un pour rien. La ligne de la
   * source locale n'est créée que si un fichier est effectivement désigné.
   */
  if (cheminDuCatalogue(parametres)) sourceLocale(true);
  const reglees = listerSources().filter((candidate) => candidate.activee);
  if (!reglees.length) throw new Error("Aucune source n'est réglée.");
  if (enCours) return etatDirect();

  const debut = Date.now();
  interruption = new AbortController();
  const signal = interruption.signal;
  enCours = true;
  faites = 0; total = 0; listeCourante = null; entreesLues = 0; ecarteesDeLaPasse = 0;

  try {
    /*
     * Toutes les sources réglées, pas seulement le fichier local.
     *
     * Chacune apporte ses listes à sa façon — un fichier les énumère, un portail Xtream n'en rend
     * qu'une, les listes publiques sont écrites en dur — et tout ce qui suit est commun. C'est ce qui
     * fait qu'ajouter un fournisseur ne touche à rien d'autre que `listesDeLaSource`.
     *
     * Une source qui échoue ne fait pas échouer les autres : son message est retenu sur sa ligne, et
     * ses listes précédentes restent en place. Une panne d'un portail ne doit pas vider la grille.
     */
    for (const reglee of reglees) {
      try {
        synchroniserLesListes(reglee.id, await listesDeLaSource(reglee, CATALOGUE_MAX));
        marquerLaSource(reglee.id, null);
      } catch (cause) {
        marquerLaSource(reglee.id, cause instanceof Error ? cause.message : "Source illisible");
      }
    }

    const retenues = db.prepare(`SELECT p.id, p.nom, p.url FROM live_playlists p
      JOIN live_sources s ON s.id = p.source_id
      WHERE p.cochee = 1 AND s.activee = 1 ORDER BY p.nom COLLATE NOCASE`)
      .all() as unknown as Array<{ id: string; nom: string; url: string }>;
    total = retenues.length;

    await enParallele(retenues, FILS, async (liste) => {
      if (signal.aborted) return;
      const resultat = await telecharger(liste, signal);
      if (signal.aborted) return;
      listeCourante = liste.nom;
      if (resultat.texte === null) {
        db.prepare("UPDATE live_playlists SET rafraichie_le = CURRENT_TIMESTAMP, dernier_message = ? WHERE id = ?")
          .run(resultat.message, liste.id);
      } else {
        const bilan = ecrireLaListe(liste.id, resultat.texte);
        entreesLues += bilan.retenues;
        ecarteesDeLaPasse += bilan.ecartees;
      }
      faites += 1;
    });

    if (signal.aborted) {
      /*
       * Une passe interrompue ne laisse rien à moitié visible.
       *
       * Les chaînes déjà écrites gardent `adresses = 0` — le recompte, la numérotation et l'index de
       * recherche sont tous après ce point : elles n'apparaissent donc ni dans la grille, ni dans la
       * recherche, et n'ont pas consommé de numéro. La prochaine passe complète les fera entrer d'un
       * coup. Un écran à demi peuplé serait pire qu'un écran inchangé.
       */
      setSetting("live.bilan", "Rafraîchissement interrompu.");
      enCours = false;
      return etatDirect();
    }

    /**
     * Les listes décochées perdent leurs adresses **ici**, et non dans la boucle.
     *
     * La boucle ne visite que les listes retenues : une liste qu'on vient de décocher n'y passe pas,
     * et ses adresses seraient restées pour toujours — décocher n'aurait rien changé à l'écran. Une
     * liste qui n'a pas *répondu*, elle, garde les siennes : une panne de dix secondes chez un
     * hébergeur ne doit pas vider la grille.
     */
    db.prepare(`DELETE FROM live_channel_urls WHERE playlist_id IN
      (SELECT p.id FROM live_playlists p JOIN live_sources s ON s.id = p.source_id
       WHERE p.cochee = 0 OR s.activee = 0)`).run();

    recompterLesAdresses();
    rangerLesPays();
    reunirLesFiabilites();
    numeroterLesNouvelles();
    reconstruireIndexRecherche();
    derniereDuree = Math.round((Date.now() - debut) / 100) / 10;
    setSetting("live.bilan", `${faites} liste(s) relues, ${entreesLues} entrées, ${ecarteesDeLaPasse} écartées, en ${derniereDuree} s.`);
    // L'état rendu est celui d'**après** la passe : l'annoncer encore en cours ferait attendre un
    // écran qui n'a plus rien à attendre.
    enCours = false;
    return etatDirect();
  } catch (cause) {
    setSetting("live.bilan", cause instanceof Error ? cause.message : "Rafraîchissement impossible");
    throw cause;
  } finally {
    enCours = false;
    listeCourante = null;
    interruption = null;
  }
}

function marquerLaSource(sourceId: string, message: string | null): void {
  db.prepare("UPDATE live_sources SET rafraichie_le = CURRENT_TIMESTAMP, dernier_message = ? WHERE id = ?")
    .run(message, sourceId);
}

/**
 * Aligne la table des listes sur le fichier.
 *
 * Une liste déjà connue **garde sa coche** : le fichier dit quelles listes existent, l'écran dit
 * lesquelles on regarde, et relire le fichier ne doit pas défaire un choix fait à l'écran.
 */
function synchroniserLesListes(sourceId: string, catalogue: Array<{ nom: string; url: string; classement: ClassementListe }>): void {
  const ajout = db.prepare(`INSERT INTO live_playlists (id, source_id, nom, url, classement) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_id, url) DO UPDATE SET nom = excluded.nom, classement = excluded.classement`);
  const connues = new Set(catalogue.map((liste) => liste.url));
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const liste of catalogue) {
      ajout.run(identifiant(`${sourceId}:${liste.url}`), sourceId, liste.nom, liste.url, liste.classement);
    }
    const existantes = db.prepare("SELECT id, url FROM live_playlists WHERE source_id = ?")
      .all(sourceId) as unknown as Array<{ id: string; url: string }>;
    const suppression = db.prepare("DELETE FROM live_playlists WHERE id = ?");
    for (const ligne of existantes) if (!connues.has(ligne.url)) suppression.run(ligne.id);
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
}

async function telecharger(liste: { id: string; nom: string; url: string }, signal: AbortSignal): Promise<ResultatListe> {
  const base = { id: liste.id, nom: liste.nom, url: liste.url };
  if (signal.aborted) return { ...base, texte: null, message: "Interrompu" };
  try {
    const reponse = await fetchWithTimeout(liste.url, { headers: { "User-Agent": "FlixTunes" } }, 20_000);
    if (!reponse.ok) return { ...base, texte: null, message: `HTTP ${reponse.status}` };
    const taille = Number(reponse.headers.get("content-length") ?? 0);
    if (taille > TAILLE_MAX) return { ...base, texte: null, message: "Liste trop volumineuse" };
    const texte = await reponse.text();
    if (texte.length > TAILLE_MAX) return { ...base, texte: null, message: "Liste trop volumineuse" };
    return { ...base, texte, message: null };
  } catch (cause) {
    return { ...base, texte: null, message: cause instanceof Error ? cause.message : "Injoignable" };
  }
}

/**
 * Écrit une liste : ses adresses remplacent les précédentes, et les chaînes se fusionnent.
 *
 * L'ordre compte. Les anciennes adresses de **cette** liste partent d'abord — sinon une chaîne
 * retirée de la liste y resterait rattachée pour toujours. Les chaînes, elles, ne sont jamais
 * supprimées : c'est ce qui rend leur numéro stable.
 */
function ecrireLaListe(playlistId: string, texte: string): { retenues: number; ecartees: number } {
  const entrees = analyserM3U(texte);
  let ecartees = 0;
  const chaine = db.prepare(`INSERT INTO live_channels (id, cle, nom, nom_recherche, nom_compact, logo, groupe, tvg_id, pays, numero_souhaite, vue_le, disparue_le)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL)
    ON CONFLICT(cle) DO UPDATE SET
      logo = COALESCE(live_channels.logo, excluded.logo),
      groupe = COALESCE(live_channels.groupe, excluded.groupe),
      tvg_id = COALESCE(live_channels.tvg_id, excluded.tvg_id),
      -- Le nom **le plus court** l'emporte, et les deux colonnes suivent le même choix.
      --
      -- Le nom affiche etait garde de la premiere entree vue tandis que le nom compact etait reecrit
      -- par la derniere : les deux decrivaient des entrees differentes, et « Canal+ » s'affichait
      -- « Canal ?? » parce qu'une liste avait ecrit ce nom-la en premier. Le plus court est presque
      -- toujours le plus propre — « TF1 » plutot que « TF1 FHD [1080p-…] » — et il ne depend pas de
      -- l'ordre de lecture des listes, donc il ne change pas d'un rafraichissement a l'autre.
      nom = CASE WHEN length(excluded.nom) < length(live_channels.nom)
        THEN excluded.nom ELSE live_channels.nom END,
      nom_compact = CASE WHEN length(excluded.nom) < length(live_channels.nom)
        THEN excluded.nom_compact ELSE live_channels.nom_compact END,
      -- Le premier pays trouve gagne : une meme chaine peut figurer dans une liste qui le declare
      -- et dans dix qui n'en disent rien, et les secondes ne doivent pas effacer la premiere.
      pays = COALESCE(live_channels.pays, excluded.pays),
      numero_souhaite = COALESCE(live_channels.numero_souhaite, excluded.numero_souhaite),
      vue_le = CURRENT_TIMESTAMP,
      disparue_le = NULL`);
  const adresse = db.prepare("INSERT OR IGNORE INTO live_channel_urls (channel_id, url, playlist_id) VALUES (?, ?, ?)");

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM live_channel_urls WHERE playlist_id = ?").run(playlistId);
    const vues = new Set<string>();
    for (const entree of entrees) {
      if (!lisibleParNosLecteurs(entree.url)) { ecartees += 1; continue; }
      const cle = cleDeChaine(entree.nom);
      if (!cle) { ecartees += 1; continue; }
      const id = identifiant(`chaine:${cle}`);
      // Une même liste répète parfois la même chaîne : on ne réécrit pas la fiche à chaque fois.
      if (!vues.has(cle)) {
        chaine.run(id, cle, entree.nom, normaliseForSearch(entree.nom), compacterNom(entree.nom), entree.logo, entree.groupe, entree.tvgId,
          paysDeLaChaine({ tvgId: entree.tvgId, groupe: entree.groupe, nom: entree.nom }), entree.numero);
        vues.add(cle);
      }
      adresse.run(id, entree.url, playlistId);
    }
    db.prepare("UPDATE live_playlists SET entrees = ?, ecartees = ?, rafraichie_le = CURRENT_TIMESTAMP, dernier_message = NULL WHERE id = ?")
      .run(entrees.length - ecartees, ecartees, playlistId);
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
  return { retenues: entrees.length - ecartees, ecartees };
}

/**
 * Reconstruit l'index de recherche à partir de la table.
 *
 * Une reconstruction plutôt que des déclencheurs : elle est exacte par construction, se mesure en
 * dixièmes de seconde sur 78 000 lignes, et elle a lieu une fois par rafraîchissement — soit
 * quelques fois par jour au plus. Un déclencheur, lui, coûterait à chacune des 180 000 écritures de
 * l'import, et un oubli s'y traduirait par des chaînes introuvables sans que rien ne le signale.
 */
export function reconstruireIndexRecherche(): void {
  db.exec("INSERT INTO live_channels_fts(live_channels_fts) VALUES('rebuild')");
}

/** Le compte d'adresses par chaîne, recalculé en une passe plutôt qu'entretenu ligne à ligne. */
function recompterLesAdresses(): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`UPDATE live_channels SET adresses = (
      SELECT COUNT(*) FROM live_channel_urls WHERE live_channel_urls.channel_id = live_channels.id)`);
    db.exec("UPDATE live_channels SET disparue_le = CURRENT_TIMESTAMP WHERE adresses = 0 AND disparue_le IS NULL");
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
}

/**
 * Réunir en un entier les fiabilités que chaque chaîne traverse.
 *
 * Recalculé en une passe après le rafraîchissement, comme le rang des pays et pour la même raison :
 * une valeur dérivée rangée en colonne se lit par un `ET` binaire, là où la calculer au vol demandait
 * un `EXISTS` corrélé sur 118 335 adresses — 190 ms mesurées pour compter les pays sous une fiabilité.
 */
export function reunirLesFiabilites(): number {
  const branches = Object.entries(MASQUES_CLASSEMENT)
    .map(([nom, masque]) => `WHEN '${nom}' THEN ${masque}`).join(" ");
  const calcul = `(SELECT COALESCE(SUM(masque), 0) FROM
    (SELECT DISTINCT CASE p.classement ${branches} ELSE 0 END AS masque
     FROM live_channel_urls u JOIN live_playlists p ON p.id = u.playlist_id
     WHERE u.channel_id = live_channels.id))`;
  return Number(db.prepare(`UPDATE live_channels SET classements = ${calcul}
    WHERE adresses > 0 AND classements <> ${calcul}`).run().changes ?? 0);
}

/**
 * L'expression qui donne son rang à un pays, en SQL.
 *
 * Elle est construite depuis la table des pays plutôt qu'écrite à la main : une table et son ordre
 * tenus à deux endroits, c'est la garantie qu'ils divergeront un jour. `CASE pays WHEN …` ne rencontre
 * jamais `NULL` — aucune comparaison n'est vraie avec lui —, si bien que l'absence de pays tombe
 * d'elle-même dans le dernier rang.
 */
function expressionDuRang(): string {
  const branches = [...rangsDesPays()].map(([code, rang]) => `WHEN '${code}' THEN ${rang}`).join(" ");
  return `CASE pays ${branches} ELSE (CASE WHEN pays IS NULL THEN ${RANG_SANS_PAYS} ELSE ${RANG_INCONNU} END) END`;
}

/**
 * Ranger les pays : une passe, et seulement sur ce qui change.
 *
 * Le rang ne se calcule pas à l'insertion, parce que le pays retenu n'est pas toujours celui qu'on
 * vient d'écrire — l'`ON CONFLICT` garde le premier trouvé, et une chaîne traverse dix listes. Le
 * calculer après coup, depuis la colonne `pays` telle qu'elle est vraiment, est à la fois plus simple
 * et impossible à désynchroniser.
 *
 * Le `WHERE` n'est pas une coquetterie : sans lui, chaque rafraîchissement réécrirait 76 899 lignes
 * pour n'en changer aucune, et le journal de la base grossirait d'autant à chaque passe.
 */
export function rangerLesPays(): number {
  const rang = expressionDuRang();
  const change = db.prepare(`UPDATE live_channels SET rang_pays = ${rang} WHERE rang_pays <> (${rang})`).run();
  setSetting("live.rangs", empreinteDesRangs());
  return Number(change.changes ?? 0);
}

/**
 * Rattraper les rangs quand la table des pays a changé de forme.
 *
 * Ajouter un pays décale tous ceux qui le suivent : les rangs en base deviennent faux, et la grille
 * mélangerait les pays jusqu'au prochain rafraîchissement complet — c'est-à-dire des minutes plus
 * tard, et seulement si quelqu'un en demande un. La comparaison d'empreintes coûte une lecture de
 * réglage au démarrage ; elle ne recalcule que le jour d'une mise à jour.
 */
export function rattraperLesRangs(): number {
  if (getSetting("live.rangs") === empreinteDesRangs()) return 0;
  return rangerLesPays();
}

/** La forme de numérotation en vigueur. La changer déclenche une renumérotation, une fois. */
const NUMEROTATION = "tnt-2025-canal-v1";

/** Le dernier numéro du plan national. Ce qui suit commence après lui, jamais dedans. */
const DERNIER_NUMERO_TNT = 26;

/**
 * Renuméroter dans l'ordre où la grille se lit — la France d'abord, puis l'alphabet des pays.
 *
 * **Le numéro est le geste principal d'un téléviseur**, et il ne correspondait plus à rien. Les
 * numéros avaient été attribués dans l'ordre alphabétique mondial, avant que la grille ne se range
 * par pays : mesuré sur le corpus, la chaîne 2 était « 1+1 Ukraina », la 3 « 24 Horas », et la
 * première française arrivait au 47. Composer « 2 » sur la télécommande tombait sur une chaîne
 * ukrainienne, et rien à l'écran ne l'expliquait.
 *
 * **Une seule fois, et jamais à chaque rafraîchissement.** La promesse tient toujours : un numéro
 * attribué ne bouge plus. Ce qui bouge ici, c'est la convention elle-même, et une convention se
 * change une fois — d'où l'empreinte rangée en réglage, qui empêche la passe de se répéter. Les
 * numéros posés à la main sont préservés et leurs valeurs retirées du tirage : ce sont des décisions,
 * pas des attributions.
 *
 * Les chaînes sans adresse perdent leur numéro et le retrouveront en réapparaissant : elles ne sont
 * pas dans la grille, et leur garder une place reviendrait à décaler tout le monde pour des absentes.
 */
export function renumeroterDansLOrdreDAffichage(): number {
  const manuels = new Set<number>();
  for (const ligne of db.prepare("SELECT numero_manuel FROM live_channels WHERE numero_manuel IS NOT NULL")
    .all() as unknown as Array<{ numero_manuel: number }>) {
    manuels.add(ligne.numero_manuel);
  }
  const aRanger = db.prepare(`SELECT id FROM live_channels WHERE adresses > 0 AND numero_manuel IS NULL
    ORDER BY rang_pays, pays, nom_recherche`).all() as unknown as Array<{ id: string }>;

  /*
   * La TNT d'abord, l'alphabet ensuite.
   *
   * Ranger la France en tête ne suffisait pas : la chaîne 1 s'appelait « 20 Minutes TV ». Personne ne
   * compose un numéro au hasard — on tape 1 pour TF1, 6 pour M6 —, et c'est exactement le geste que la
   * saisie à la télécommande sert. Le corpus donne souvent plusieurs chaînes du même nom : on retient
   * **celle qui a le plus d'adresses**, qui est presque toujours la vraie, et de loin la plus jouable.
   */
  const parNom = db.prepare(`SELECT id FROM live_channels WHERE nom_compact = ? AND adresses > 0
    AND numero_manuel IS NULL ORDER BY adresses DESC LIMIT 1`);
  const tnt = new Map<string, number>();
  for (const [nom, numero] of numerosTnt()) {
    if (manuels.has(numero) || [...tnt.values()].includes(numero)) continue;
    const trouvee = parNom.get(nom) as unknown as { id: string } | undefined;
    if (trouvee && !tnt.has(trouvee.id)) tnt.set(trouvee.id, numero);
  }
  /*
   * Le bouquet Canal+ juste après la TNT, à la demande.
   *
   * Canal+ a quitté la TNT — le 4 est à France 4 — mais ses chaînes restent celles qu'on cherche
   * juste après les vingt-six premières, et pas noyées au milieu de quatre-vingt-dix mille. Elles
   * prennent donc le bloc suivant, entre elles dans l'ordre alphabétique, la chaîne mère en tête.
   *
   * Le préfixe est comparé sur le nom **compact**, ponctuation gardée : `canal+` ne ramasse pas les
   * mille « Canal 8 » hispanophones. Et le filtre sur le pays fait le reste — depuis que le suffixe
   * de nom est lu, « Canal+ Family Poland-PL » est polonaise et n'entre plus dans le bloc français.
   */
  const bouquet = db.prepare(`SELECT id FROM live_channels
    WHERE adresses > 0 AND numero_manuel IS NULL AND pays = 'fr' AND nom_compact LIKE 'canal+%'
    ORDER BY length(nom_recherche), nom_recherche`).all() as unknown as Array<{ id: string }>;
  const rangsBouquet = new Map<string, number>();
  let apresTnt = DERNIER_NUMERO_TNT + 1;
  for (const chaine of bouquet) {
    if (tnt.has(chaine.id)) continue;
    while (manuels.has(apresTnt)) apresTnt += 1;
    rangsBouquet.set(chaine.id, apresTnt);
    apresTnt += 1;
  }

  /*
   * Les vingt-six premiers numéros restent à la TNT, même absente du corpus.
   *
   * Sans cela, le remplissage alphabétique venait boucher les trous : le 8 est allé à « 20 Minutes
   * TV » faute de LCP dans les listes. Un numéro de TNT vide vaut mieux qu'un numéro de TNT qui ment.
   */
  const reserves = new Set<number>([...manuels, ...tnt.values(), ...rangsBouquet.values()]);

  const pose = db.prepare("UPDATE live_channels SET numero = ? WHERE id = ?");
  let curseur = apresTnt;
  db.exec("BEGIN IMMEDIATE");
  try {
    /*
     * Tout est vidé avant d'être reposé, et c'est obligatoire : `numero` est unique, et réécrire
     * ligne à ligne ferait entrer en collision la valeur qu'on pose et celle qu'on n'a pas encore
     * retirée. Une passe pour libérer, une passe pour attribuer.
     */
    db.exec("UPDATE live_channels SET numero = NULL WHERE numero_manuel IS NULL");
    db.exec("UPDATE live_channels SET numero = numero_manuel WHERE numero_manuel IS NOT NULL");
    for (const [id, numero] of tnt) pose.run(numero, id);
    for (const [id, numero] of rangsBouquet) pose.run(numero, id);
    for (const chaine of aRanger) {
      if (tnt.has(chaine.id) || rangsBouquet.has(chaine.id)) continue;
      while (reserves.has(curseur)) curseur += 1;
      pose.run(curseur, chaine.id);
      curseur += 1;
    }
    setSetting("live.numerotation", NUMEROTATION);
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
  return aRanger.length;
}

/**
 * Renuméroter si la convention a changé depuis la dernière fois — et sinon, ne rien faire.
 *
 * La lecture d'un réglage suffit à répondre « rien à faire ». La passe elle-même ne tourne qu'une
 * fois, au premier démarrage suivant la mise à jour, et écrit alors autant de lignes qu'il y a de
 * chaînes joignables. C'est cher une fois ; ce serait insupportable à chaque rafraîchissement, et
 * c'est bien pourquoi ça n'y est pas.
 */
export function renumeroterSiNecessaire(): number {
  if (getSetting("live.numerotation") === NUMEROTATION) return 0;
  // Les rangs d'abord : renuméroter dans un ordre qui n'est pas encore calculé donnerait l'ancien.
  rattraperLesRangs();
  return renumeroterDansLOrdreDAffichage();
}

/**
 * Attribue un numéro aux chaînes qui n'en ont pas — et **seulement** à celles-là.
 *
 * L'arbitrage retenu, dans cet ordre : la correction manuelle l'emporte toujours, sinon le `tvg-chno`
 * de la liste s'il est libre, sinon le premier numéro disponible. Un numéro attribué ne bouge plus
 * jamais : sur un corpus où 87 % des entrées n'en portent aucun, une renumérotation à chaque
 * rafraîchissement rendrait la saisie à la télécommande inutilisable.
 */
export function numeroterLesNouvelles(): number {
  const pris = new Set<number>();
  for (const ligne of db.prepare("SELECT numero FROM live_channels WHERE numero IS NOT NULL").all() as unknown as Array<{ numero: number }>) {
    pris.add(ligne.numero);
  }
  const aNumeroter = db.prepare(`SELECT id, numero_souhaite FROM live_channels
    WHERE numero IS NULL AND adresses > 0 ORDER BY nom_recherche`).all() as unknown as Array<{ id: string; numero_souhaite: number | null }>;
  if (!aNumeroter.length) return 0;

  /**
   * **Les souhaits d'abord, le remplissage ensuite** — et l'ordre entre les deux n'est pas un détail.
   *
   * En une seule passe par ordre alphabétique, « Arte » prenait le 1 avant que « TF1 » n'arrive avec
   * son `tvg-chno="1"` : le seul numéro que la liste donnait explicitement était le seul à ne pas
   * être respecté. Sur un corpus où 87 % des entrées n'en portent aucun, laisser l'alphabet écraser
   * les 13 % restants revenait à jeter la seule information fiable qu'on ait.
   */
  const souhaits = new Map<string, number>();
  for (const chaine of aNumeroter) {
    const souhait = chaine.numero_souhaite;
    if (souhait == null || pris.has(souhait)) continue;
    pris.add(souhait);
    souhaits.set(chaine.id, souhait);
  }

  const pose = db.prepare("UPDATE live_channels SET numero = ? WHERE id = ?");
  let curseur = 1;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const chaine of aNumeroter) {
      let numero = souhaits.get(chaine.id);
      if (numero == null) {
        while (pris.has(curseur)) curseur += 1;
        numero = curseur;
        pris.add(numero);
      }
      pose.run(numero, chaine.id);
    }
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
  return aNumeroter.length;
}

/** Une correction à la main : elle l'emporte sur tout, et libère l'ancien numéro. */
export function corrigerNumero(channelId: string, numero: number | null): void {
  if (numero != null && (!Number.isInteger(numero) || numero < 1 || numero > 99_999)) {
    throw new Error("Numéro de chaîne invalide.");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    if (numero != null) db.prepare("UPDATE live_channels SET numero = NULL WHERE numero = ? AND id <> ?").run(numero, channelId);
    db.prepare("UPDATE live_channels SET numero_manuel = ?, numero = COALESCE(?, numero) WHERE id = ?")
      .run(numero, numero, channelId);
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
}

/* ------------------------------------------------------------------------ */
/* La grille                                                                 */
/* ------------------------------------------------------------------------ */

export interface RequeteChaines {
  q?: string;
  /** Le profil, requis dès qu'on parle de favorites : elles sont à lui, pas au foyer. */
  profileId?: string;
  /** N'afficher que les favorites de ce profil. */
  favoris?: boolean;
  /** Écarter les chaînes dont toutes les adresses ont échoué. Éteint par défaut. */
  masquerMortes?: boolean;
  listes?: string[];
  /** Codes a deux lettres. Vide : tous les pays, chaines sans pays connu comprises. */
  pays?: string[];
  /** Fiabilités de liste retenues. Vide : toutes, quelle que soit la part de flux qui répondent. */
  fiabilites?: ClassementListe[];
  offset?: number;
  limit?: number;
}

function motif(valeur: string): string {
  return `%${valeur.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

/**
 * La saisie, traduite en expression FTS5 : chaque mot devient un préfixe.
 *
 * « canal p » donne `"canal"* "p"*`, qui trouve « Canal Plus » sans trouver « Canal Sport ». Les
 * guillemets ne sont pas décoratifs : sans eux, un `-` ou un `*` tapé par mégarde serait lu comme un
 * opérateur de la syntaxe FTS et la requête échouerait au lieu de ne rien trouver.
 *
 * Rend `null` quand la saisie ne contient aucun mot indexable — « + », « ??? ». L'appelant retombe
 * alors sur une comparaison littérale.
 */
function expressionFts(saisie: string): string | null {
  const mots = normaliseForSearch(saisie).split(" ").filter(Boolean);
  if (!mots.length) return null;
  return mots.map((mot) => `"${mot.replaceAll("\"", "")}"*`).join(" ");
}

/**
 * La grille, paginée et filtrée.
 *
 * Une chaîne sans adresse n'y figure pas : elle existe en base pour garder son numéro, pas pour être
 * proposée. La recherche porte sur `nom_recherche`, la forme sans accent ni ponctuation — « canal »
 * y trouve « Canal+ », et c'est la colonne indexée.
 */
export function listerChaines(requete: RequeteChaines = {}): PageChaines {
  const offset = Math.max(0, Math.trunc(requete.offset ?? 0));
  const limit = Math.min(200, Math.max(1, Math.trunc(requete.limit ?? 60)));
  const conditions = ["c.adresses > 0"];
  const params: unknown[] = [];
  let jointure = "";

  /*
   * « Morte » n'est pas un jugement définitif : c'est ce que la dernière lecture a appris. Une chaîne
   * peut l'être hier soir et répondre ce matin, d'où un filtre **éteint par défaut** — on ne cache
   * pas de soi-même quelque chose qui marche peut-être.
   */
  if (requete.masquerMortes) conditions.push("c.etat <> 'morte'");
  if (requete.favoris && requete.profileId) {
    jointure += " JOIN live_favoris f ON f.channel_id = c.id AND f.profile_id = ?";
    params.push(requete.profileId);
  }

  const saisie = requete.q?.trim();
  if (saisie) {
    const expression = expressionFts(saisie);
    if (expression) {
      jointure = "JOIN live_channels_fts f ON f.rowid = c.rowid";
      conditions.push("live_channels_fts MATCH ?");
      params.push(expression);
      /**
       * **Un signe tapé compte.**
       *
       * L'index ne connaît que des mots : il découpe « canal + » en un seul terme, *canal*, et rend
       * les 1 141 chaînes hispanophones dont c'est le nom commun. Or celui qui a tapé le « + » l'a
       * voulu. Quand la saisie porte un signe, on exige donc en plus la **suite de caractères**, dans
       * la forme compacte où seuls les espaces et les accents ont disparu.
       *
       * La comparaison littérale ne s'indexe pas, mais elle ne s'applique qu'aux lignes que l'index a
       * déjà retenues — quelques milliers au plus, pas les 76 899 de la table.
       *
       * Sans signe, rien ne change : « canal » cherche bien le mot.
       */
      const compacte = compacterNom(saisie);
      if (/[^\p{Letter}\p{Number}]/u.test(compacte)) {
        conditions.push("c.nom_compact LIKE ? ESCAPE '\\'");
        params.push(motif(compacte));
      }
    } else {
      // Une saisie qui ne laisse aucun mot — « + », « … » — n'a rien à donner à l'index. On retombe
      // sur la comparaison littérale plutôt que de rendre la grille entière comme si rien n'avait
      // été tapé, ce qui serait le contraire de ce qu'on demande.
      conditions.push("c.nom LIKE ? ESCAPE '\\'");
      params.push(motif(saisie));
    }
  }
  if (requete.listes?.length) {
    conditions.push(`EXISTS (SELECT 1 FROM live_channel_urls u WHERE u.channel_id = c.id
      AND u.playlist_id IN (${requete.listes.map(() => "?").join(", ")}))`);
    params.push(...requete.listes);
  }
  if (requete.pays?.length) {
    conditions.push(`c.pays IN (${requete.pays.map(() => "?").join(", ")})`);
    params.push(...requete.pays);
  }
  /*
   * La fiabilité est celle des **listes**, et une chaîne en traverse parfois dix.
   *
   * Il suffit donc qu'une seule d'entre elles réponde au critère : demander « au moins une source
   * fiable » est ce qu'on veut dire, alors qu'exiger que **toutes** le soient écarterait les chaînes
   * les mieux servies — celles justement qu'on reprend partout, y compris dans de mauvaises listes.
   */
  /*
   * Ici l'`EXISTS` reste, et c'est une mesure qui l'a décidé.
   *
   * Le masque binaire posé pour les facettes semblait devoir servir aussi à la grille — une colonne
   * plutôt qu'une sous-requête. Mesuré sur les 92 204 chaînes du corpus : **111 ms contre 0,2 ms**.
   * L'`EXISTS` laisse SQLite parcourir l'index de la grille dans l'ordre et s'arrêter à la
   * soixantième ligne, en vérifiant chaque candidate au passage ; le masque, absent de cet index,
   * l'oblige à tout regarder. Le même raccourci est excellent pour compter et mauvais pour paginer.
   */
  if (requete.fiabilites?.length) {
    conditions.push(`EXISTS (SELECT 1 FROM live_channel_urls u JOIN live_playlists p ON p.id = u.playlist_id
      WHERE u.channel_id = c.id AND p.classement IN (${requete.fiabilites.map(() => "?").join(", ")}))`);
    params.push(...requete.fiabilites);
  }
  const where = `WHERE ${conditions.join(" AND ")}`;

  const compte = db.prepare(`SELECT COUNT(*) AS n FROM live_channels c ${jointure} ${where}`)
    .get(...params as never[]) as unknown as { n: number };

  /**
   * Deux tris, parce qu'il y a deux gestes.
   *
   * **Sans recherche, on parcourt** : l'ordre est celui des numéros, qui suit l'index
   * `(adresses, numero)`. Il portait auparavant `c.numero IS NULL` en tête — une expression, donc un
   * tri complet des 76 899 lignes à chaque page, pour départager un cas qui n'existe pas.
   *
   * **Avec une recherche, on cherche quelque chose de précis**, et l'ordre des numéros n'a plus aucun
   * sens : taper « canal + » rendait 1 452 chaînes dont Canal+ était noyée. Quatre critères, dans cet
   * ordre :
   *
   * 1. **le nom exact d'abord.** La normalisation retire la ponctuation, si bien que « canal + » et
   *    « Canal+ » se rejoignent — c'est le cas le plus fréquent d'une recherche courte ;
   * 2. **puis ce qui commence par la saisie**, « Canal+ Sport » avant « TV Canal 8 » ;
   * 3. **puis le nombre d'adresses.** C'est la meilleure mesure de notoriété qu'on ait : une chaîne
   *    reprise dans onze listes est presque toujours celle qu'on cherchait, une chaîne présente une
   *    fois presque jamais. Elle ne coûte rien puisqu'elle est déjà comptée ;
   * 4. **puis le nom le plus court**, qui départage « Canal+ » de « Canal+ Sport 360 HD [1080p] ».
   */
  const tri = saisie
    ? `CASE WHEN c.nom_recherche = ? THEN 0 WHEN c.nom_recherche LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,
       c.adresses DESC, length(c.nom_recherche), c.numero`
    : "c.rang_pays, c.pays, c.numero";
  const parametresTri: unknown[] = saisie
    ? [normaliseForSearch(saisie), `${normaliseForSearch(saisie).replaceAll("%", "\\%").replaceAll("_", "\\_")}%`]
    : [];

  /*
   * L'étoile est lue en une fois pour la page, pas chaîne par chaîne.
   *
   * Un `EXISTS` par ligne coûterait soixante sous-requêtes ; ici c'est une jointure gauche sur une
   * table dont la clé primaire commence par le profil. La grille garde ses 0,4 ms.
   */
  const favori = requete.profileId
    ? "EXISTS (SELECT 1 FROM live_favoris fa WHERE fa.channel_id = c.id AND fa.profile_id = ?) AS favori"
    : "0 AS favori";
  const lignes = db.prepare(`SELECT c.id, c.nom, c.numero, c.logo, c.groupe, c.pays, c.etat, c.adresses, ${favori}
    FROM live_channels c ${jointure} ${where}
    ORDER BY ${tri}
    LIMIT ? OFFSET ?`)
    /*
     * L'ordre des paramètres suit celui des `?` **dans le texte de la requête**, pas celui du code.
     * Celui de l'étoile est dans le SELECT : il passe donc avant ceux de la jointure et du filtre.
     */
    .all(...[...(requete.profileId ? [requete.profileId] : []), ...params, ...parametresTri, limit, offset] as never[]) as unknown as Array<{
      id: string; nom: string; numero: number | null; logo: string | null; groupe: string | null;
      pays: string | null; etat: ChaineDirect["etat"]; adresses: number; favori: number;
    }>;

  return {
    items: lignes.map((ligne) => ({ ...ligne, favori: ligne.favori === 1 })),
    total: compte.n, offset, limit,
  };
}

/**
 * Le rafraîchissement dû au démarrage, ou rien.
 *
 * Trois conditions, et les trois comptent. **La fonction doit être activée** — sinon rien ne tourne,
 * c'est la règle de toute fonction qui coûte. **Une source doit être réglée.** Et **la cadence doit
 * être échue** : redémarrer le serveur trois fois de suite ne doit pas retélécharger quarante
 * mégaoctets trois fois. Le délai par défaut est de douze heures.
 *
 * Il part **après** la médiathèque, jamais avant : c'est l'accueil qu'on veut voir en premier, et
 * une analyse de bibliothèque a plus de valeur qu'une grille de chaînes.
 */
export function rafraichissementDuAuDemarrage(): boolean {
  const parametres = parametresDirect();
  if (!parametres.actif || !cheminDuCatalogue(parametres)) return false;
  const source = sourceLocale(false);
  if (!source?.rafraichie_le) return true;
  const derniere = Date.parse(`${source.rafraichie_le.replace(" ", "T")}Z`);
  if (!Number.isFinite(derniere)) return true;
  return Date.now() - derniere >= parametres.cadenceHeures * 3_600_000;
}

/**
 * Une chaîne et ses adresses, dans l'ordre où il faut les essayer.
 *
 * L'ordre est la seule chose qui rende le repli utile plutôt qu'aléatoire : ce qui a déjà marché
 * passe devant, ce qui a échoué passe derrière. Il se corrige tout seul à l'usage — c'est la
 * décision n° 5 du chantier, « on retient ce qui s'est passé à la lecture » —, sans jamais sonder
 * les cent mille adresses du corpus, ce qui ne se fait pas d'un bloc.
 */
export function chaineDetaillee(id: string): ChaineDirectDetaillee | null {
  const chaine = db.prepare(`SELECT id, nom, numero, logo, groupe, etat, adresses FROM live_channels WHERE id = ?`)
    .get(id) as unknown as ChaineDirect | undefined;
  if (!chaine) return null;
  /*
   * L'ordre des sources, du meilleur au pire, et dans cet ordre de priorité :
   *
   * 1. **les échecs**, parce qu'une source qui ne marche pas n'a pas de qualité ;
   * 2. **la définition**, mesurée dans le manifeste — c'est elle qui distingue deux sources vivantes,
   *    et le client n'a aucun moyen de la connaître lui-même : sans en-tête CORS, un navigateur ne
   *    peut pas lire un manifeste ;
   * 3. **le débit**, qui départage deux variantes de même hauteur ;
   * 4. **les succès**, ce qui a effectivement marché quand on regardait.
   *
   * `DESC` range les inconnues en dernier sous SQLite : une adresse jamais sondée passe donc derrière
   * une adresse mesurée, ce qui est exactement le comportement voulu — on préfère ce qu'on sait.
   */
  const sources = db.prepare(`SELECT url, succes, echecs, hauteur, debit FROM live_channel_urls
    WHERE channel_id = ?
    ORDER BY echecs ASC, hauteur DESC, debit DESC, succes DESC, url`).all(id) as unknown as SourceChaine[];
  return { ...chaine, sources };
}

/**
 * La chaîne qui porte ce numéro, ou rien.
 *
 * C'est la moitié serveur de la saisie à la télécommande : composer « 1 340 » ne peut pas dépendre de
 * ce que le client a déjà fait défiler, puisqu'il n'en tient que soixante à la fois. Le numéro est
 * unique — la colonne le garantit —, donc il n'y a rien à départager.
 */
export function chaineParNumero(numero: number): ChaineDirect | null {
  return db.prepare(`SELECT id, nom, numero, logo, groupe, pays, etat, adresses FROM live_channels
    WHERE numero = ? AND adresses > 0`).get(numero) as unknown as ChaineDirect | null ?? null;
}

/**
 * La chaîne voisine, par numéro — P+ et P− d'un téléviseur.
 *
 * « La suivante » n'est pas « numéro + 1 » : les numéros ont des trous, parce qu'une chaîne disparue
 * garde le sien. On demande donc la première au-dessus, ou la première au-dessous, et l'on boucle aux
 * extrémités : après la dernière vient la première, comme sur n'importe quel téléviseur.
 */
export function chaineVoisine(numero: number, sens: 1 | -1): ChaineDirect | null {
  const colonnes = "id, nom, numero, logo, groupe, pays, etat, adresses";
  const suivante = sens > 0
    ? `SELECT ${colonnes} FROM live_channels WHERE adresses > 0 AND numero > ? ORDER BY numero LIMIT 1`
    : `SELECT ${colonnes} FROM live_channels WHERE adresses > 0 AND numero < ? ORDER BY numero DESC LIMIT 1`;
  const trouvee = db.prepare(suivante).get(numero) as unknown as ChaineDirect | undefined;
  if (trouvee) return trouvee;
  const bouclage = sens > 0
    ? `SELECT ${colonnes} FROM live_channels WHERE adresses > 0 ORDER BY numero LIMIT 1`
    : `SELECT ${colonnes} FROM live_channels WHERE adresses > 0 ORDER BY numero DESC LIMIT 1`;
  return (db.prepare(bouclage).get() as unknown as ChaineDirect | undefined) ?? null;
}

/**
 * Ce que la lecture apprend, retenu.
 *
 * Deux effets, et le second est le plus important : l'adresse remonte ou descend dans l'ordre
 * d'essai, **et** l'état de la chaîne se met à jour. Une chaîne n'est déclarée morte que lorsque
 * *toutes* ses adresses ont échoué sans qu'aucune n'ait jamais réussi — une panne passagère sur la
 * première ne condamne pas une chaîne qui en a quatre.
 */
export function noterResultat(id: string, url: string, ok: boolean): boolean {
  const existe = db.prepare("SELECT 1 AS n FROM live_channel_urls WHERE channel_id = ? AND url = ?")
    .get(id, url) as unknown as { n: number } | undefined;
  if (!existe) return false;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (ok) {
      // Une réussite efface l'ardoise de cette adresse : un échec d'hier ne doit pas la faire passer
      // derrière une adresse qui n'a jamais rien rendu.
      db.prepare(`UPDATE live_channel_urls SET succes = succes + 1, echecs = 0, essayee_le = CURRENT_TIMESTAMP
        WHERE channel_id = ? AND url = ?`).run(id, url);
      db.prepare("UPDATE live_channels SET etat = 'bonne', vue_le = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    } else {
      db.prepare(`UPDATE live_channel_urls SET echecs = echecs + 1, essayee_le = CURRENT_TIMESTAMP
        WHERE channel_id = ? AND url = ?`).run(id, url);
      db.prepare(`UPDATE live_channels SET etat = 'morte' WHERE id = ? AND NOT EXISTS (
        SELECT 1 FROM live_channel_urls WHERE channel_id = ? AND (succes > 0 OR echecs = 0))`).run(id, id);
    }
    db.exec("COMMIT");
  } catch (cause) {
    db.exec("ROLLBACK");
    throw cause;
  }
  return true;
}

/**
 * Une chaîne entre dans les favorites d'un profil, ou en sort.
 *
 * Vingt chaînes sur 76 823 : c'est le vrai usage d'une grille de cette taille, et c'est ce qui la
 * rend utilisable au quotidien. Le geste est le même que la liste d'envies du catalogue.
 */
export function marquerFavorite(profileId: string, channelId: string, favorite: boolean): boolean {
  if (favorite) {
    return db.prepare("INSERT OR IGNORE INTO live_favoris (profile_id, channel_id) VALUES (?, ?)")
      .run(profileId, channelId).changes > 0;
  }
  return db.prepare("DELETE FROM live_favoris WHERE profile_id = ? AND channel_id = ?")
    .run(profileId, channelId).changes > 0;
}

/**
 * La dernière chaîne regardée par un profil.
 *
 * Elle est retenue **côté serveur** et non dans le client : un téléviseur qu'on rallume doit
 * retrouver ce qu'on regardait, y compris quand on l'avait quitté depuis le téléphone. C'est aussi
 * ce qui rend la touche « chaîne précédente » possible d'un appareil à l'autre.
 */
export function retenirDerniereChaine(profileId: string, channelId: string): void {
  db.prepare(`INSERT INTO live_derniere_chaine (profile_id, channel_id, vue_le) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(profile_id) DO UPDATE SET channel_id = excluded.channel_id, vue_le = CURRENT_TIMESTAMP`)
    .run(profileId, channelId);
}

export function derniereChaine(profileId: string): ChaineDirect | null {
  const ligne = db.prepare(`SELECT c.id, c.nom, c.numero, c.logo, c.groupe, c.pays, c.etat, c.adresses
    FROM live_derniere_chaine d JOIN live_channels c ON c.id = d.channel_id
    WHERE d.profile_id = ? AND c.adresses > 0`).get(profileId) as unknown as ChaineDirect | undefined;
  return ligne ?? null;
}

/**
 * Ce qu'un client a besoin de savoir avant d'afficher quoi que ce soit.
 *
 * Une seule question, en réalité : **l'entrée « Direct » doit-elle exister ?** Elle n'existe que si
 * la fonction est activée *et* qu'une source a effectivement rendu des chaînes — un réglage à demi
 * fait ne doit pas ajouter au menu une section vide.
 *
 * La réponse ne dit rien des chemins du NAS, des listes ni de leur état : c'est l'affaire de l'écran
 * d'administration, pas d'un client.
 */
export function etatClient(): { disponible: boolean; chaines: number; rafraichieLe: string | null } {
  const etat = etatDirect();
  return { disponible: etat.actif && etat.chaines > 0, chaines: etat.chaines, rafraichieLe: etat.rafraichieLe };
}

/**
 * Les pays présents, avec leur effectif et leur nom français.
 *
 * C'est le filtre qui manquait. Chercher « canal » rend plus de mille chaînes parce que le mot est
 * espagnol et portugais, et **aucun classement ne peut réparer cela** : tous ces résultats sont
 * justes. Restreindre à la France, c'est passer de mille à quelques dizaines.
 *
 * Les chaînes dont on ignore le pays n'y figurent pas, et n'en sont pas exclues pour autant : elles
 * restent visibles tant qu'aucun pays n'est coché.
 */
/**
 * Les critères qui pèsent sur une facette — tous sauf elle-même.
 *
 * Une facette compte ce qu'on obtiendrait **en la cochant en plus de ce qui l'est déjà**. S'y inclure
 * elle-même n'aurait aucun sens : cocher France ferait alors afficher « France 1 355 » et rien d'autre.
 */
export interface CriteresFacette {
  listes?: string[];
  pays?: string[];
  fiabilites?: string[];
  q?: string;
}

/**
 * Les pays présents, comptés **sous les autres filtres actifs**.
 *
 * Ils étaient comptés sur le corpus entier : on cochait une playlist, l'écran promettait toujours
 * « France 1 355 », on cliquait, et on tombait sur zéro. Rien ne s'était annulé — ces 1 355 chaînes
 * existent, elles ne sont simplement pas dans cette liste-là —, mais l'écran avait menti. Et comme
 * **74 % des chaînes n'ont aucun pays**, ce vide était le cas courant.
 *
 * Le compte part des **adresses** quand une liste est cochée, et non des chaînes : mesuré sur le
 * corpus, 18,3 ms contre 163,6 ms pour la forme qui parcourait toutes les chaînes — et même moins que
 * les 24,5 ms de l'ancien compte global, qui, lui, les parcourait toutes sans exception.
 */
export function listerPays(criteres: CriteresFacette = {}): Array<{ code: string; nom: string; chaines: number }> {
  const conditions = ["c.adresses > 0", "c.pays IS NOT NULL"];
  const params: unknown[] = [];
  if (criteres.fiabilites?.length) {
    conditions.push("(c.classements & ?) <> 0");
    params.push(masqueDesClassements(criteres.fiabilites));
  }
  const compact = criteres.q?.trim() ? compacterNom(criteres.q) : "";
  if (compact) {
    conditions.push("c.nom_compact LIKE ? ESCAPE '\'");
    params.push(`%${compact.replaceAll("\\", "\\\\").replaceAll("%", "\%").replaceAll("_", "\_")}%`);
  }

  const requete = criteres.listes?.length
    ? `SELECT c.pays AS code, COUNT(DISTINCT c.id) AS chaines
       FROM live_channel_urls u JOIN live_channels c ON c.id = u.channel_id
       WHERE u.playlist_id IN (${criteres.listes.map(() => "?").join(", ")}) AND ${conditions.join(" AND ")}
       GROUP BY c.pays ORDER BY chaines DESC LIMIT 60`
    : `SELECT c.pays AS code, COUNT(*) AS chaines FROM live_channels c
       WHERE ${conditions.join(" AND ")} GROUP BY c.pays ORDER BY chaines DESC LIMIT 60`;
  const tous = criteres.listes?.length ? [...criteres.listes, ...params] : params;
  const lignes = db.prepare(requete).all(...tous as never[]) as unknown as Array<{ code: string; chaines: number }>;
  return lignes.map((ligne) => ({ ...ligne, nom: nomDuPays(ligne.code) }));
}

/**
 * Les fiabilités présentes, avec le nombre de listes de chacune.
 *
 * C'est une mesure, pas un avis : le script qui produit `m3u.json` sonde toutes les adresses de
 * chaque liste et range le résultat en quatre bandes — 75 % de chaînes joignables et plus, 50 à 74 %,
 * 25 à 49 %, moins de 25 %. Pouvoir s'en tenir à la première, c'est écarter d'un geste les listes où
 * une chaîne sur deux ne répond pas.
 */
export function listerFiabilites(): Array<{ classement: ClassementListe; listes: number }> {
  return db.prepare(`SELECT p.classement, COUNT(*) AS listes FROM live_playlists p
    JOIN live_sources s ON s.id = p.source_id
    WHERE s.activee = 1 AND p.entrees > 0 GROUP BY p.classement`)
    .all() as unknown as Array<{ classement: ClassementListe; listes: number }>;
}

/** Les listes que l'on regarde, telles qu'un client les propose à cocher — comme les genres. */
export function listerListesClient(criteres: CriteresFacette = {}): Array<{ id: string; nom: string; classement: ClassementListe; chaines: number }> {
  const filtres: string[] = [];
  const params: unknown[] = [];
  if (criteres.pays?.length) {
    filtres.push(`c.pays IN (${criteres.pays.map(() => "?").join(", ")})`);
    params.push(...criteres.pays);
  }
  if (criteres.fiabilites?.length) {
    filtres.push("(c.classements & ?) <> 0");
    params.push(masqueDesClassements(criteres.fiabilites));
  }
  const compact = criteres.q?.trim() ? compacterNom(criteres.q) : "";
  if (compact) {
    filtres.push("c.nom_compact LIKE ? ESCAPE '\'");
    params.push(`%${compact.replaceAll("\\", "\\\\").replaceAll("%", "\%").replaceAll("_", "\_")}%`);
  }

  /*
   * Sans autre filtre, le compte reste celui que la liste déclare — il est déjà rangé, et le
   * recalculer coûterait une jointure sur 118 335 adresses pour la même réponse.
   */
  if (!filtres.length) {
    return db.prepare(`SELECT p.id, p.nom, p.classement, p.entrees AS chaines FROM live_playlists p
      JOIN live_sources s ON s.id = p.source_id
      WHERE p.cochee = 1 AND s.activee = 1 AND p.entrees > 0 ORDER BY p.nom COLLATE NOCASE`)
      .all() as unknown as Array<{ id: string; nom: string; classement: ClassementListe; chaines: number }>;
  }
  // Mesuré à 8,3 ms sous un pays : la jointure part des adresses, qui portent déjà l'index qu'il faut.
  return db.prepare(`SELECT p.id, p.nom, p.classement, COUNT(DISTINCT c.id) AS chaines
    FROM live_playlists p JOIN live_sources s ON s.id = p.source_id
    JOIN live_channel_urls u ON u.playlist_id = p.id
    JOIN live_channels c ON c.id = u.channel_id
    WHERE p.cochee = 1 AND s.activee = 1 AND c.adresses > 0 AND ${filtres.join(" AND ")}
    GROUP BY p.id ORDER BY p.nom COLLATE NOCASE`)
    .all(...params as never[]) as unknown as Array<{ id: string; nom: string; classement: ClassementListe; chaines: number }>;
}

/* ------------------------------------------------------------------------ */
/* Outils                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Exécute un traitement sur une file, avec un nombre de fils constant.
 *
 * `Promise.all` sur cinq cent vingt-sept téléchargements ouvrirait cinq cent vingt-sept connexions
 * d'un coup. Ce puits en tient huit, et rend la main quand la file est vide.
 */
async function enParallele<T>(file: T[], fils: number, traiter: (element: T) => Promise<void>): Promise<void> {
  let curseur = 0;
  const ouvriers = Array.from({ length: Math.min(fils, file.length) }, async () => {
    while (curseur < file.length) {
      const element = file[curseur]!;
      curseur += 1;
      await traiter(element);
    }
  });
  await Promise.all(ouvriers);
}
