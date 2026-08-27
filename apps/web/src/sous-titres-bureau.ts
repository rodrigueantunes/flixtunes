/**
 * Les sous-titres quand c'est VLC qui décode.
 *
 * Dans un navigateur, une balise `<track>` fait tout : elle charge le WebVTT, suit l'horloge de la
 * vidéo, et affiche la réplique du moment, que la feuille de style habille par `::cue`. Rien de tout
 * cela n'existe quand l'image est peinte par un autre processus — il n'y a plus de balise vidéo à qui
 * accrocher la piste.
 *
 * Deux réponses étaient possibles. **Laisser VLC les dessiner** : c'est le plus court, et c'est
 * mauvais. VLC a sa propre police, sa propre taille, son propre placement, et n'a jamais entendu
 * parler des préférences du profil — taille, couleur, fond, position, police. Le client de bureau
 * aurait alors des sous-titres qui ne ressemblent ni à ceux du Web ni à ceux d'Android, et six
 * réglages devenus sans effet. **Ou les dessiner nous-mêmes**, à partir du même fichier WebVTT que
 * le navigateur aurait chargé, sur la position que VLC nous donne. C'est ce que fait ce module :
 * l'apparence reste celle du Web, réglages compris, parce que c'est la même feuille de style.
 *
 * VLC est donc lancé avec `--no-spu` : il ne dessine aucun sous-titre, et il n'y a jamais deux jeux
 * de répliques superposés.
 */

/** Une réplique : quand elle apparaît, quand elle disparaît, ce qu'elle dit. */
export interface Replique {
  debut: number;
  fin: number;
  texte: string;
}

const HORODATAGE = /(\d{1,3}:)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

/** `01:23:45.678`, `23:45.678` — les deux formes que WebVTT autorise. */
export function lireHorodatage(valeur: string): number | null {
  const trouve = HORODATAGE.exec(valeur.trim());
  if (!trouve) return null;
  const heures = trouve[1] ? Number(trouve[1].slice(0, -1)) : 0;
  const minutes = Number(trouve[2]);
  const secondes = Number(trouve[3]);
  const millisecondes = Number((trouve[4] ?? "0").padEnd(3, "0"));
  return heures * 3600 + minutes * 60 + secondes + millisecondes / 1000;
}

/**
 * Analyse un WebVTT.
 *
 * Le serveur produit une forme régulière — en-tête, puis des blocs `début --> fin` suivis de leur
 * texte — mais on reste tolérant : un identifiant de réplique avant l'horodatage, des réglages de
 * placement après, une ligne `NOTE`, tout cela existe dans la nature et ne doit pas faire perdre le
 * fichier entier.
 *
 * Les balises `<i>`, `<b>` et consorts sont retirées plutôt qu'interprétées. Les insérer telles
 * quelles dans la page reviendrait à faire confiance au contenu d'un fichier de sous-titres pour y
 * écrire du HTML, ce qui n'est pas une chose à faire ; les interpréter proprement viendra avec la
 * mise en forme, si l'italique manque.
 */
export function analyserWebVtt(source: string): Replique[] {
  const texte = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const repliques: Replique[] = [];
  for (const bloc of texte.split(/\n{2,}/)) {
    const lignes = bloc.split("\n").filter((ligne) => ligne.trim().length > 0);
    const rang = lignes.findIndex((ligne) => ligne.includes("-->"));
    if (rang < 0) continue;
    const [avant, apres] = lignes[rang]!.split("-->");
    const debut = lireHorodatage(avant ?? "");
    const fin = lireHorodatage(apres ?? "");
    if (debut == null || fin == null || fin <= debut) continue;
    const corps = lignes.slice(rang + 1).join("\n").replace(/<[^>]*>/g, "").trim();
    if (corps) repliques.push({ debut, fin, texte: corps });
  }
  return repliques;
}

/**
 * Ce qui doit être à l'écran à cet instant.
 *
 * Plusieurs répliques peuvent se chevaucher — deux personnes qui parlent en même temps, une
 * indication de lieu par-dessus un dialogue. Le navigateur les empile ; on fait de même.
 */
export function repliquesA(repliques: Replique[], position: number): string[] {
  if (!Number.isFinite(position)) return [];
  return repliques.filter((replique) => position >= replique.debut && position < replique.fin)
    .map((replique) => replique.texte);
}
