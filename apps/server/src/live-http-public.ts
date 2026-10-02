import { request as http } from "node:http";
import { request as https } from "node:https";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { adressePrivee } from "./live-relais.js";

/** Le DNS contrôlé est celui de la connexion elle-même : pas de deuxième résolution après contrôle. */
export const lookupPublic: typeof lookup = ((hote: string, options: { all?: boolean } | number, rappel: (...args: any[]) => void) => {
  lookup(hote, { all: true }, (erreur, adresses) => {
    if (erreur || !adresses.length || adresses.some((a) => adressePrivee(a.address))) {
      rappel(erreur ?? new Error("Adresse interne refusée"));
      return;
    }
    if (typeof options === "object" && "all" in options && options.all) rappel(null, adresses);
    else rappel(null, adresses[0]!.address, adresses[0]!.family);
  });
}) as unknown as typeof lookup;

export async function recupererPublic(url: string, init: RequestInit): Promise<Response> {
  const cible = new URL(url);
  const hote = cible.hostname.replace(/^\[|\]$/g, "");
  if (!["http:", "https:"].includes(cible.protocol) || (isIP(hote) && adressePrivee(hote))) {
    throw new Error("Adresse interne refusée");
  }
  return new Promise((resoudre, rejeter) => {
    const requete = (cible.protocol === "https:" ? https : http)(cible, {
      method: "GET", headers: { ...Object.fromEntries(new Headers(init.headers)), "accept-encoding": "identity" }, lookup: lookupPublic,
      signal: init.signal ?? undefined,
    }, (reponse) => {
      clearTimeout(echeance);
      const entetes = new Headers();
      for (const [nom, valeur] of Object.entries(reponse.headers)) {
        if (valeur != null) entetes.set(nom, Array.isArray(valeur) ? valeur.join(", ") : valeur);
      }
      const status = reponse.statusCode ?? 502;
      const vide = [204, 205, 304].includes(status);
      if (vide) reponse.resume();
      resoudre(new Response(vide ? null : Readable.toWeb(reponse) as never, { status, headers: entetes }));
    });
    const echeance = setTimeout(() => requete.destroy(new Error("Délai réseau dépassé")), 20_000);
    requete.setTimeout(20_000, () => requete.destroy(new Error("Source silencieuse")));
    requete.once("error", (erreur) => { clearTimeout(echeance); rejeter(erreur); });
    requete.end();
  });
}
