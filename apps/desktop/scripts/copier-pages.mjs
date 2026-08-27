import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Les pages de la coque suivent le code compilé.
 *
 * `tsc` ne copie que ce qu'il compile ; ces deux pages sont du HTML servi localement — l'écran qui
 * demande l'adresse du serveur, et le fond noir de la fenêtre vidéo. Sans elles, la coque démarre sur
 * une fenêtre vide et rien ne dit pourquoi.
 */
const racine = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
await mkdir(path.join(racine, "dist", "pages"), { recursive: true });
await cp(path.join(racine, "src", "pages"), path.join(racine, "dist", "pages"), { recursive: true });
console.log("pages copiées vers dist/pages");
