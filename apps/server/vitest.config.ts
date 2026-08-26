import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Les délais par défaut de Vitest — 5 s par test, 10 s par accroche — sont taillés pour un dépôt sur
 * disque local. Ici le dépôt et la base SQLite vivent sur un partage réseau, et plusieurs tests font un
 * travail réellement lent : `buildApp()` sonde FFmpeg et calibre le matériel, `/api/system/status`
 * exécute un `PRAGMA quick_check`, et les tests de conservation lancent de vraies analyses de dossier.
 *
 * Ces délais ont produit des échecs qui n'avaient rien à voir avec le code testé, ce qui coûte plus
 * cher qu'une suite lente : un échec dont on doute n'est plus un signal. Les valeurs ci-dessous laissent
 * la place au partage réseau tout en restant assez basses pour qu'un blocage réel finisse par échouer.
 *
 * `fileParallelism` est désactivé pour la même raison qu'il l'est dans le script `test` : les fichiers
 * partagent une seule base SQLite et se verrouillent mutuellement lorsqu'ils s'exécutent en parallèle.
 */
/**
 * Répertoire de données propre à la suite de tests.
 *
 * Sans cette variable, les tests ouvrent la base de `data/` — celle du serveur. Sur une machine de
 * développement c'est sans conséquence visible ; sur une installation où `data/` contient une vraie
 * médiathèque, une suite de tests écrirait dedans. Elle y a d'ailleurs laissé des traces : des
 * bibliothèques créées par les tests de conservation s'y accumulaient à chaque exécution, faussant
 * les comptages des autres fichiers, qui interrogent la même base.
 *
 * Le répertoire est fixe et non temporaire : les tests s'appuient sur des migrations appliquées au
 * premier démarrage, et un répertoire neuf à chaque exécution rendrait la suite plus lente sans rien
 * prouver de plus. Il suffit qu'il ne soit pas celui du serveur.
 */
process.env.FLIXTUNES_DATA_DIR ??= fileURLToPath(new URL("./.vitest-data", import.meta.url));

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
