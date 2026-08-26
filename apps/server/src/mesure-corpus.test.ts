import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMediaPath } from "./media-parser.js";
import { elisionsRestaurees, relaxationQueries } from "./query-relaxation.js";

/**
 * Mesure sur la médiathèque réelle, et non sur des exemples choisis.
 *
 * Les cas cités jusqu'ici — « C'est arrivé près de chez vous », « Camping 3 » — venaient de ce que
 * l'utilisateur avait remarqué à l'écran. Rien ne dit qu'ils sont représentatifs : ce sont les défauts
 * *visibles*, pas forcément les plus nombreux. Ce fichier compte sur les 1 567 noms de fichiers du NAS.
 *
 * La liste des noms est produite hors test et lue ici. Sans elle, le fichier ne mesure rien et le dit,
 * plutôt que de passer en silence — un test vert qui n'a rien vérifié est pire que pas de test.
 */

const LISTE = process.env.FLIXTUNES_CORPUS_FICHIERS
  ?? "C:/Users/ANTUNE~1/AppData/Local/Temp/claude/N--Application-Web-Android-FlixTunes/d2fab1f1-b981-484b-a880-92c8648f6685/scratchpad/films-nas.txt";

const chemins = existsSync(LISTE)
  ? readFileSync(LISTE, "utf8").split(/\r?\n/).map((ligne) => ligne.trim()).filter(Boolean)
  : [];

describe.skipIf(chemins.length === 0)("corpus réel de films", () => {
  it("dénombre les titres dont une élision a été effacée par le nom de fichier", () => {
    const élidés: Array<{ fichier: string; analysé: string; restauré: string }> = [];
    const sansAnnée: string[] = [];

    for (const chemin of chemins) {
      const analysé = parseMediaPath(chemin, "movie");
      const restauré = elisionsRestaurees(analysé.title);
      if (restauré) élidés.push({ fichier: chemin.split(/[\\/]/).pop()!, analysé: analysé.title, restauré });
      if (!analysé.year) sansAnnée.push(chemin.split(/[\\/]/).pop()!);
    }

    const rapport = {
      total: chemins.length,
      élisionsEffacées: élidés.length,
      partEnPourcent: Number(((élidés.length / chemins.length) * 100).toFixed(2)),
      sansAnnéeDétectée: sansAnnée.length,
      exemples: élidés.slice(0, 40),
      exemplesSansAnnée: sansAnnée.slice(0, 30),
    };
    writeFileSync(`${LISTE}.rapport-elisions.json`, `${JSON.stringify(rapport, null, 2)}\n`);
    // eslint-disable-next-line no-console
    console.log(`corpus ${rapport.total} films | élisions effacées : ${rapport.élisionsEffacées}`
      + ` (${rapport.partEnPourcent} %) | sans année : ${rapport.sansAnnéeDétectée}`);
    for (const cas of élidés.slice(0, 25)) console.log(`  ${cas.analysé}  ->  ${cas.restauré}`);

    expect(rapport.total).toBeGreaterThan(1_000);
  });

  it("vérifie que la variante élidée est bien proposée au fournisseur", () => {
    // Compter les cas ne suffit pas : encore faut-il que la requête corrigée parte réellement.
    const concernés = chemins
      .map((chemin) => parseMediaPath(chemin, "movie").title)
      .filter((titre) => elisionsRestaurees(titre));
    if (concernés.length === 0) return;
    const couverts = concernés.filter((titre) => {
      const attendu = elisionsRestaurees(titre)!;
      return relaxationQueries(titre).includes(attendu);
    });
    // eslint-disable-next-line no-console
    console.log(`variante élidée réellement envoyée : ${couverts.length}/${concernés.length}`);
    expect(couverts.length).toBe(concernés.length);
  });
});
