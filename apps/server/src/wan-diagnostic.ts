import { createConnection } from "node:net";
import { readdirSync, statSync } from "node:fs";
import { lookup } from "node:dns/promises";
import path from "node:path";
import { config } from "./config.js";
import { db } from "./database.js";
import { parametresWan } from "./wan-parametres.js";

/**
 * Le contrôle de l'accès distant, maillon par maillon.
 *
 * Sans lui, « ça ne marche pas » n'a aucune valeur diagnostique : la chaîne compte un enregistrement
 * DNS, deux redirections sur la box, un certificat obtenu auprès d'une autorité, un proxy, une écoute
 * interne et un code PIN — et l'échec de n'importe lequel produit exactement le même symptôme, une
 * page qui ne s'ouvre pas.
 *
 * Chaque contrôle dit ce qu'il a constaté **et** le geste qui le corrige. Un diagnostic qui se
 * contente d'un rouge ne fait que déplacer la question.
 */

export type EtatControle = "ok" | "attention" | "echec" | "inconnu";

export interface Controle {
  id: string;
  libelle: string;
  etat: EtatControle;
  constat: string;
  action: string | null;
}

export interface DiagnosticWan {
  genereLe: string;
  domaine: string | null;
  /** Vrai si la chaîne complète est en état de servir. */
  pret: boolean;
  controles: Controle[];
}

function ok(id: string, libelle: string, constat: string): Controle {
  return { id, libelle, etat: "ok", constat, action: null };
}

async function portOuvert(hote: string, port: number, delaiMs = 2000): Promise<boolean> {
  return new Promise((resoudre) => {
    const socket = createConnection({ host: hote, port });
    const fin = (valeur: boolean) => { socket.destroy(); resoudre(valeur); };
    socket.setTimeout(delaiMs);
    socket.once("connect", () => fin(true));
    socket.once("timeout", () => fin(false));
    socket.once("error", () => fin(false));
  });
}

/** L'adresse publique vue de l'extérieur, ou `null` si elle n'a pas pu être obtenue. */
async function adressePublique(): Promise<string | null> {
  try {
    const reponse = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(5000),
    });
    if (!reponse.ok) return null;
    const donnees = await reponse.json() as { ip?: string };
    return typeof donnees.ip === "string" ? donnees.ip : null;
  } catch {
    return null;
  }
}

/**
 * Le dossier où Caddy range ses certificats.
 *
 * Il vit dans le partage persistant et non dans le dossier du paquet, qu'une mise à jour remplace :
 * perdre la clé de compte à chaque révision épuiserait le quota de l'autorité en une semaine.
 */
function dossierCaddy(): string {
  return path.resolve(config.dataDir, "..", "caddy");
}

function certificatPresent(domaine: string): boolean {
  const racine = dossierCaddy();
  const pile: string[] = [racine];
  let visites = 0;
  while (pile.length && visites < 2000) {
    const courant = pile.pop()!;
    visites += 1;
    let entrees: string[];
    try { entrees = readdirSync(courant); } catch { continue; }
    for (const entree of entrees) {
      const complet = path.join(courant, entree);
      if (entree === `${domaine}.crt`) return true;
      try { if (statSync(complet).isDirectory()) pile.push(complet); } catch { /* illisible : ignoré */ }
    }
  }
  return false;
}

export async function diagnostiquerWan(): Promise<DiagnosticWan> {
  const parametres = parametresWan();
  const controles: Controle[] = [];
  const domaine = parametres.domaine;

  if (!domaine) {
    controles.push({
      id: "domaine", libelle: "Nom de domaine", etat: "echec",
      constat: "Aucun domaine n'est enregistré : l'accès distant n'existe pas.",
      action: "Renseignez le domaine ci-dessus, puis redémarrez FlixTunes.",
    });
    return { genereLe: new Date().toISOString(), domaine: null, pret: false, controles };
  }
  controles.push(ok("domaine", "Nom de domaine", domaine));

  // 1. Le domaine désigne-t-il cette maison ?
  let adresseDomaine: string | null = null;
  try {
    adresseDomaine = (await lookup(domaine, { family: 4 })).address;
    controles.push(ok("dns", "Résolution DNS", `${domaine} pointe sur ${adresseDomaine}.`));
  } catch {
    controles.push({
      id: "dns", libelle: "Résolution DNS", etat: "echec",
      constat: `${domaine} ne résout vers aucune adresse.`,
      action: "Créez un enregistrement A chez votre hébergeur DNS, pointant sur l'adresse publique de votre box.",
    });
  }

  const publique = await adressePublique();
  if (!publique) {
    controles.push({
      id: "adresse", libelle: "Adresse publique", etat: "inconnu",
      constat: "L'adresse publique n'a pas pu être vérifiée depuis le serveur.",
      action: null,
    });
  } else if (!adresseDomaine) {
    controles.push({ id: "adresse", libelle: "Adresse publique", etat: "inconnu",
      constat: `Adresse publique : ${publique}. Comparaison impossible, le domaine ne résout pas.`, action: null });
  } else if (adresseDomaine === publique) {
    controles.push(ok("adresse", "Adresse publique", `Le domaine pointe bien sur cette connexion (${publique}).`));
  } else {
    controles.push({
      id: "adresse", libelle: "Adresse publique", etat: "echec",
      constat: `Le domaine pointe sur ${adresseDomaine}, alors que cette connexion est en ${publique}.`,
      action: "Corrigez l'enregistrement DNS. Tant qu'il désigne une autre adresse, le certificat ne pourra pas être renouvelé.",
    });
  }

  // 2. Le serveur écoute-t-il derrière le proxy ?
  const ecouteInterne = await portOuvert("127.0.0.1", parametres.portInterne);
  controles.push(ecouteInterne
    ? ok("ecoute", "Écoute distante", `Le serveur répond sur 127.0.0.1:${parametres.portInterne}.`)
    : {
      id: "ecoute", libelle: "Écoute distante", etat: "echec",
      constat: `Rien ne répond sur 127.0.0.1:${parametres.portInterne}.`,
      action: "Redémarrez FlixTunes : l'écoute distante n'est créée qu'au démarrage, lorsqu'un domaine est enregistré.",
    });

  // 3. Le proxy est-il en place ?
  const proxyHttp = await portOuvert("127.0.0.1", parametres.portHttp);
  const proxyHttps = await portOuvert("127.0.0.1", parametres.portHttps);
  if (proxyHttp && proxyHttps) {
    controles.push(ok("proxy", "Proxy TLS", `Caddy écoute sur ${parametres.portHttp} et ${parametres.portHttps}.`));
  } else {
    controles.push({
      id: "proxy", libelle: "Proxy TLS", etat: "echec",
      constat: `Caddy ne répond pas sur ${proxyHttp ? "" : parametres.portHttp}${!proxyHttp && !proxyHttps ? " ni " : ""}${proxyHttps ? "" : parametres.portHttps}.`,
      action: "Redémarrez FlixTunes, puis consultez logs/caddy.log si le problème persiste.",
    });
  }

  // 4. Le certificat a-t-il été obtenu ?
  const certificat = certificatPresent(domaine);
  controles.push(certificat
    ? ok("certificat", "Certificat", `Un certificat est enregistré pour ${domaine}.`)
    : {
      id: "certificat", libelle: "Certificat", etat: proxyHttp ? "attention" : "echec",
      constat: `Aucun certificat enregistré pour ${domaine}.`,
      action: `Le 443 public doit atteindre ce NAS sur ${parametres.portHttps} : Caddy obtient alors son `
        + "certificat par TLS-ALPN, sans que le port 80 soit nécessaire. Rediriger aussi 80 vers "
        + `${parametres.portHttp} ajoute une seconde voie de validation et la redirection HTTP vers HTTPS.`,
    });

  // 5. Quelqu'un peut-il seulement entrer ?
  //
  // C'est le compte de connexion qui garde la porte, et non plus la longueur d'un code PIN. Sans
  // compte, l'écran distant s'arrête sur une demande d'identifiants que personne ne peut satisfaire —
  // et c'est le seul défaut de la chaîne qu'aucun message d'erreur réseau ne laisse deviner.
  const comptes = db.prepare("SELECT COUNT(*) AS n FROM remote_accounts").get() as { n: number };
  controles.push(comptes.n > 0
    ? ok("comptes", "Comptes de connexion", `${comptes.n} compte(s) autorisé(s) à ouvrir la plateforme à distance.`)
    : {
      id: "comptes", libelle: "Comptes de connexion", etat: "echec",
      constat: "Aucun compte de connexion : personne ne peut franchir la première barrière.",
      action: "Créez un compte dans « Comptes de connexion à distance », plus bas dans ce panneau.",
    });

  const pret = controles.every((controle) => controle.etat === "ok" || controle.etat === "inconnu");
  return { genereLe: new Date().toISOString(), domaine, pret, controles };
}
