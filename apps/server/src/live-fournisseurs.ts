import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { db, getSetting, setSetting } from "./database.js";
import { decryptProviderSecret, encryptProviderSecret } from "./provider-settings.js";
import { lireCatalogueM3U, type ClassementListe } from "./m3u.js";

/**
 * D'où viennent les chaînes — et pourquoi les trois sortes se ramènent à une seule.
 *
 * L'étape 1 ne connaissait qu'un fichier `m3u.json` sur le NAS. Deux autres fournisseurs ont été
 * retenus au chantier, et le point important est qu'**aucun des deux ne demande un second pipeline** :
 *
 * | Sorte | Ce qu'on règle | Ce qu'elle produit |
 * | --- | --- | --- |
 * | `m3u` | un fichier du serveur | les listes qu'il énumère |
 * | `xtream` | un hôte, un utilisateur, un mot de passe | **une** liste, celle que le portail rend |
 * | `fast` | rien | les listes publiques gratuites et légales |
 *
 * Xtream Codes expose bien une API JSON — `player_api.php` et ses actions —, mais il expose aussi
 * `get.php?type=m3u_plus`, qui rend **exactement le même contenu au format M3U**, attributs compris :
 * `tvg-id`, `tvg-logo`, `tvg-chno`, `group-title`. Passer par là fait tomber tout le reste dans
 * l'analyseur déjà écrit et déjà éprouvé, au lieu d'en écrire un second qui divergerait.
 */

export type SorteSource = "m3u" | "xtream" | "fast";

export interface SourceDirect {
  id: string;
  type: SorteSource;
  libelle: string;
  emplacement: string;
  activee: boolean;
  rafraichieLe: string | null;
  dernierMessage: string | null;
}

/**
 * Les listes publiques retenues.
 *
 * Elles sont gratuites, légales et distribuées par leurs éditeurs : ce sont des chaînes financées par
 * la publicité, que Pluto TV et Samsung diffusent librement. C'est ce qui rend cette source
 * particulière — elle ne demande **aucun réglage**, et c'est ce qu'un nouvel arrivant verra en
 * premier s'il n'a rien d'autre.
 *
 * Les adresses viennent du projet iptv-org, qui les tient à jour ; elles sont écrites ici plutôt que
 * dans un fichier de configuration parce qu'elles font partie de ce que l'application propose.
 */
/*
 * Les quatre adresses précédentes étaient **mortes**, et le fournisseur ne livrait donc rien.
 *
 * Vérifié le 1er septembre 2026 : les trois de `i.mjh.nz` rendent 404 — l'hébergeur ne publie plus
 * que des guides XMLTV, ses playlists ont disparu — et `iptv-org.github.io/iptv/subdivisions/fr.m3u`
 * répond 404 lui aussi. Personne ne s'en apercevait : une source qui ne rend aucune liste ressemble à
 * une source qu'on n'a pas encore rafraîchie.
 *
 * Les deux qui les remplacent sont vérifiées : **215 et 459 chaînes** au moment de l'écriture. Elles
 * portent les mêmes bouquets gratuits — iptv-org référence les chaînes Pluto, Samsung et Rakuten —,
 * simplement rassemblées par pays et par langue plutôt que par éditeur.
 */
const LISTES_FAST: Array<{ nom: string; url: string }> = [
  { nom: "Chaînes françaises", url: "https://iptv-org.github.io/iptv/countries/fr.m3u" },
  { nom: "Chaînes francophones", url: "https://iptv-org.github.io/iptv/languages/fra.m3u" },
];

/** Le secret d'une source Xtream, chiffré au repos comme les jetons des fournisseurs de métadonnées. */
function cleSecret(sourceId: string): string {
  return `live_xtream_${sourceId}`;
}

export interface IdentifiantsXtream { hote: string; utilisateur: string; motDePasse: string }

/**
 * L'adresse M3U d'un portail Xtream.
 *
 * `m3u_plus` est la seule forme qui porte les attributs — sans elle, on perd les logos, les groupes
 * et surtout les numéros de chaîne, que le portail est justement l'un des rares à fournir.
 */
export function adresseXtream(identifiants: IdentifiantsXtream): string {
  const hote = identifiants.hote.replace(/\/+$/, "");
  const parametres = new URLSearchParams({
    username: identifiants.utilisateur,
    password: identifiants.motDePasse,
    type: "m3u_plus",
    output: "m3u8",
  });
  return `${hote}/get.php?${parametres.toString()}`;
}

export function listerSources(): SourceDirect[] {
  const lignes = db.prepare(`SELECT id, type, libelle, emplacement, activee, rafraichie_le, dernier_message
    FROM live_sources ORDER BY type, libelle COLLATE NOCASE`).all() as unknown as Array<{
      id: string; type: SorteSource; libelle: string; emplacement: string; activee: number;
      rafraichie_le: string | null; dernier_message: string | null;
    }>;
  return lignes.map((ligne) => ({
    id: ligne.id, type: ligne.type, libelle: ligne.libelle, emplacement: ligne.emplacement,
    activee: ligne.activee === 1, rafraichieLe: ligne.rafraichie_le, dernierMessage: ligne.dernier_message,
  }));
}

/**
 * Enregistre un portail Xtream.
 *
 * L'hôte est vérifié plutôt que nettoyé : ce texte devient une adresse que le serveur ira chercher
 * lui-même, et un `file://` ou un hôte interne y ferait sortir le NAS d'où il ne doit pas sortir. Le
 * mot de passe, lui, est chiffré au repos par le même mécanisme que les jetons TMDB — il n'a aucune
 * raison d'être plus exposé.
 */
export function enregistrerXtream(identifiants: IdentifiantsXtream, libelle?: string): SourceDirect {
  const hote = identifiants.hote.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(hote)) throw new Error("Adresse de portail invalide.");
  if (!identifiants.utilisateur.trim() || !identifiants.motDePasse) throw new Error("Identifiant ou mot de passe manquant.");

  const existante = db.prepare("SELECT id FROM live_sources WHERE type = 'xtream' AND emplacement = ?")
    .get(hote) as unknown as { id: string } | undefined;
  const id = existante?.id ?? randomUUID();
  const nom = libelle?.trim() || new URL(hote).hostname;
  db.prepare(`INSERT INTO live_sources (id, type, libelle, emplacement) VALUES (?, 'xtream', ?, ?)
    ON CONFLICT(type, emplacement) DO UPDATE SET libelle = excluded.libelle, activee = 1`).run(id, nom, hote);
  setSetting(cleSecret(id), encryptProviderSecret(JSON.stringify({
    hote, utilisateur: identifiants.utilisateur.trim(), motDePasse: identifiants.motDePasse,
  })));
  return listerSources().find((source) => source.id === id)!;
}

export function identifiantsXtream(sourceId: string): IdentifiantsXtream | null {
  const brut = getSetting(cleSecret(sourceId));
  if (!brut) return null;
  try { return JSON.parse(decryptProviderSecret(brut)) as IdentifiantsXtream; } catch { return null; }
}

/** Active ou retire les listes publiques. Elles n'ont pas de réglage : leur seule question est oui ou non. */
export function reglerFast(actif: boolean): SourceDirect | null {
  if (!actif) {
    db.prepare("DELETE FROM live_sources WHERE type = 'fast'").run();
    return null;
  }
  const id = "fast-public";
  // Le libellé est réécrit à chaque activation : une source enregistrée sous l'ancien nom le porterait
  // sinon pour toujours, la ligne n'étant jamais réinsérée.
  db.prepare(`INSERT INTO live_sources (id, type, libelle, emplacement) VALUES (?, 'fast', 'Chaînes', 'public')
    ON CONFLICT(type, emplacement) DO UPDATE SET activee = 1, libelle = excluded.libelle`).run(id);
  return listerSources().find((source) => source.type === "fast") ?? null;
}

export function retirerSource(id: string): boolean {
  // Le secret part avec la source : le laisser en base serait garder un mot de passe dont plus rien
  // ne se sert, ce qui est le pire des deux mondes.
  db.prepare("DELETE FROM server_settings WHERE key = ?").run(cleSecret(id));
  return db.prepare("DELETE FROM live_sources WHERE id = ?").run(id).changes > 0;
}

/**
 * Les listes qu'une source apporte, quelle que soit sa sorte.
 *
 * C'est le seul endroit où les trois diffèrent. Tout ce qui suit — téléchargement, analyse, fusion,
 * numérotation — est commun, et c'est ce qui fait qu'ajouter un fournisseur ne touche à rien d'autre.
 */
export async function listesDeLaSource(source: SourceDirect, tailleMax: number):
Promise<Array<{ nom: string; url: string; classement: ClassementListe }>> {
  if (source.type === "fast") {
    return LISTES_FAST.map((liste) => ({ ...liste, classement: "inconnue" as ClassementListe }));
  }
  if (source.type === "xtream") {
    const identifiants = identifiantsXtream(source.id);
    if (!identifiants) throw new Error("Identifiants du portail introuvables.");
    // Une seule liste : le portail rend tout son bouquet dans un seul M3U.
    return [{ nom: source.libelle, url: adresseXtream(identifiants), classement: "inconnue" }];
  }
  const infos = await stat(source.emplacement).catch(() => null);
  if (!infos?.isFile()) throw new Error(`Fichier introuvable : ${source.emplacement}`);
  if (infos.size > tailleMax) throw new Error("Le fichier de listes dépasse deux mégaoctets.");
  const listes = lireCatalogueM3U(await readFile(source.emplacement, "utf8"));
  if (!listes.length) throw new Error("Aucune liste utilisable dans le fichier.");
  return listes;
}
