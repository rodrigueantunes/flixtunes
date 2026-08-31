import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "../src/database.js";
import { enregistrerParametres, etatDirect, listerChaines, listerListes, listerPays, rafraichirDirect } from "../src/television-direct.js";

/**
 * Le banc de la télévision en direct — étape 1 du chantier 0.5.7.
 *
 * Il mesure ce que coûte **réellement** un rafraîchissement complet du corpus, sur la machine où on
 * le lance. C'est la mesure qui clôt l'étape 1, et elle doit être refaite **sur le NAS** : un chiffre
 * relevé sur un poste de développement en fibre ne dit rien de ce qu'un Celeron N5105 fera du même
 * travail, et c'est précisément ce qu'on veut savoir.
 *
 * Il n'invente aucun corpus : il prend le `m3u.json` qu'on lui désigne, celui dont on se sert.
 *
 *   pnpm --filter @flixtunes/server test:live-corpus <chemin du m3u.json>
 *
 * La base de mesure est un répertoire temporaire, jamais celle du serveur : indexer cent mille
 * chaînes dans la base d'une vraie installation pour produire un chiffre serait payer la mesure au
 * prix de l'installation.
 */

const source = process.argv[2];
if (!source) {
  console.error("Usage : test:live-corpus <chemin du m3u.json>");
  process.exit(1);
}

const dossier = mkdtempSync(path.join(os.tmpdir(), "flixtunes-live-banc-"));
copyFileSync(source, path.join(dossier, "m3u.json"));

function chiffre(valeur: number): string {
  return valeur.toLocaleString("fr-FR");
}

async function main(): Promise<void> {
  enregistrerParametres({ actif: true, dossier, fichier: "m3u.json" });

  const debut = performance.now();
  const etat = await rafraichirDirect();
  const secondes = (performance.now() - debut) / 1000;

  const listes = listerListes();
  const muettes = listes.filter((liste) => liste.dernierMessage);
  const lues = listes.reduce((total, liste) => total + liste.entrees, 0);

  console.log("");
  console.log(`Corpus              ${source}`);
  console.log(`Listes déclarées    ${chiffre(etat.listes)}`);
  console.log(`Listes qui répondent ${chiffre(listes.length - muettes.length)}  (${chiffre(muettes.length)} muettes)`);
  console.log(`Entrées retenues    ${chiffre(lues)}`);
  console.log(`Entrées écartées    ${chiffre(etat.ecartees)}  (transports illisibles)`);
  console.log(`Chaînes après fusion ${chiffre(etat.chaines)}`);
  console.log(`Adresses conservées ${chiffre(etat.adresses)}`);
  console.log(`Doublons fusionnés  ${chiffre(etat.fusionnees)}  (${(etat.fusionnees * 100 / Math.max(1, lues)).toFixed(1)} %)`);
  console.log(`Rafraîchissement    ${secondes.toFixed(1)} s`);

  // Les trois budgets du §7 du chantier, mesurés là où le banc tourne.
  for (const [intitule, mesure] of [
    ["Première grille  ", () => listerChaines({ limit: 60 })],
    ["Page 500         ", () => listerChaines({ limit: 60, offset: 30_000 })],
    ["Recherche « tf1 »", () => listerChaines({ q: "tf1", limit: 60 })],
    ["Recherche « can »", () => listerChaines({ q: "can", limit: 60 })],
  ] as Array<[string, () => { total: number }]>) {
    // Trois passages : le premier paie la préparation de la requête, les suivants disent le régime.
    let dernier = 0;
    let total = 0;
    for (let essai = 0; essai < 3; essai += 1) {
      const depart = performance.now();
      total = mesure().total;
      dernier = performance.now() - depart;
    }
    console.log(`${intitule}   ${dernier.toFixed(1)} ms  (${chiffre(total)} résultats)`);
  }

  // Le pays est ce qui rend la recherche utilisable sur un corpus mondial : on mesure sa couverture.
  const avecPays = db.prepare("SELECT COUNT(*) AS n FROM live_channels WHERE adresses > 0 AND pays IS NOT NULL")
    .get() as unknown as { n: number };
  console.log(`Pays connu          ${chiffre(avecPays.n)}  (${(avecPays.n * 100 / Math.max(1, etat.chaines)).toFixed(1)} %)`);
  for (const pays of listerPays().slice(0, 6)) console.log(`  ${pays.nom.padEnd(14)} ${chiffre(pays.chaines)}`);
  const france = listerPays().find((pays) => pays.code === "fr");
  if (france) {
    const sans = listerChaines({ q: "canal" });
    const avec = listerChaines({ q: "canal", pays: ["fr"] });
    console.log(`« canal »           ${chiffre(sans.total)} sans filtre, ${chiffre(avec.total)} en France`);
    console.log(`  premières         ${avec.items.slice(0, 5).map((chaine) => chaine.nom).join(" | ")}`);
    // Un signe tapé compte : « canal + » n'est pas « canal ».
    const signe = listerChaines({ q: "canal +" });
    console.log(`« canal + »         ${chiffre(signe.total)} sans aucun filtre`);
    console.log(`  premières         ${signe.items.slice(0, 5).map((chaine) => chaine.nom).join(" | ")}`);
  }

  const taille = db.prepare("SELECT page_count * page_size AS octets FROM pragma_page_count(), pragma_page_size()")
    .get() as unknown as { octets: number };
  console.log(`Base après import   ${(taille.octets / 1048576).toFixed(1)} Mio`);
  console.log("");
}

main()
  .catch((cause) => { console.error(cause); process.exitCode = 1; })
  .finally(() => rmSync(dossier, { recursive: true, force: true }));
