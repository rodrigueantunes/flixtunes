/**
 * La course : essayer les adresses d'une chaîne **en même temps**, et garder l'ordre des réponses.
 *
 * Le lecteur essayait la première adresse, attendait jusqu'à douze secondes, puis passait à la
 * deuxième. Une chaîne à trois adresses dont les deux premières sont mortes mettait donc jusqu'à
 * vingt-quatre secondes à démarrer — c'est-à-dire qu'on avait changé de chaîne avant.
 *
 * Ici les N adresses partent ensemble, et l'ordre de retour devient l'ordre d'essai. Le coût pour le
 * NAS est **nul** : ces requêtes partent du navigateur, pas du serveur.
 *
 * **Pourquoi `no-cors`.** Un `fetch` ordinaire vers un hébergeur qui n'envoie pas d'en-tête CORS est
 * refusé par le navigateur — c'est exactement le mur que le relais existe pour contourner. Une
 * requête `no-cors` rend une réponse *opaque* : on ne peut ni lire son corps ni connaître son code,
 * mais elle **aboutit** quand l'hôte a répondu et **échoue** quand il n'y a personne. Or c'est
 * précisément la distinction qui compte ici : dans le journal du navigateur, les adresses mortes du
 * corpus sortent en `ERR_NAME_NOT_RESOLVED` et en délais dépassés, pas en 404.
 *
 * La course ne remplace donc pas le repli — une adresse qui répond peut encore refuser ses segments —
 * elle le **réordonne**, et fait tomber d'emblée celles qui ne répondent à personne.
 */

/** Au-delà, on n'attend plus : une adresse qui n'a rien dit en trois secondes fera perdre du temps. */
const DELAI_MS = 3_000;

/**
 * Ce dont la course a besoin : une adresse, et rien d'autre.
 *
 * Le reste — le relais, la définition mesurée — voyage avec elle sans qu'elle le regarde. Le type est
 * donc générique : elle rend exactement ce qu'on lui a donné, réordonné.
 */
export interface AdresseCourue { url: string }

/**
 * Rend les adresses réordonnées : celles qui ont répondu d'abord, puis les autres.
 *
 * **Entre celles qui répondent, l'ordre du serveur est conservé** — et ce n'est pas un détail. La
 * première écriture gardait l'ordre d'*arrivée*, si bien qu'une source en 480p qui répond en 100 ms
 * passait devant la même chaîne en 1080p qui répond en 300 ms. Or le serveur, lui, sait laquelle est
 * la meilleure : il les classe par échecs, puis par définition, puis par débit. La course ne doit donc
 * répondre qu'à une seule question — *qui est joignable* —, et laisser le classement à qui l'a mesuré.
 *
 * Les silencieuses ne sont pas jetées. Une réponse opaque ne prouve pas grand-chose, et son absence
 * ne prouve pas davantage : un hébergeur lent reste jouable, et si tout se tait il faut bien essayer
 * quelque chose. On ne perd donc jamais une adresse, on ne fait que changer l'ordre.
 */
export async function courirLesAdresses<T extends AdresseCourue>(
  adresses: T[],
  sonder: (url: string, signal: AbortSignal) => Promise<unknown> = sondeParDefaut,
  delaiMs = DELAI_MS,
): Promise<T[]> {
  if (adresses.length <= 1) return adresses;

  const controleur = new AbortController();
  const arrivees: T[] = [];
  const minuteur = setTimeout(() => controleur.abort(), delaiMs);
  try {
    await Promise.all(adresses.map(async (adresse) => {
      try {
        await sonder(adresse.url, controleur.signal);
        arrivees.push(adresse);
      } catch {
        // Ni résolue, ni joignable, ni assez rapide : elle garde sa place d'origine, derrière.
      }
    }));
  } finally {
    clearTimeout(minuteur);
    controleur.abort();
  }

  const repondues = new Set(arrivees.map((adresse) => adresse.url));
  return [
    ...adresses.filter((adresse) => repondues.has(adresse.url)),
    ...adresses.filter((adresse) => !repondues.has(adresse.url)),
  ];
}

/**
 * La sonde par défaut : une requête opaque, qu'on n'attend pas jusqu'au bout.
 *
 * `no-cors` évite le refus du navigateur ; le corps n'est jamais lu, ce qui suffit à savoir que
 * quelqu'un a répondu sans télécharger un manifeste dont on n'a pas encore besoin.
 */
async function sondeParDefaut(url: string, signal: AbortSignal): Promise<unknown> {
  return fetch(url, { method: "GET", mode: "no-cors", signal, cache: "no-store" });
}
