import type { NoteMedia } from "@flixtunes/contracts";

/**
 * La note d'un film ou d'une série, en étoiles (r14).
 *
 * Cinq étoiles grises, et par-dessus les mêmes en or, coupées à la note arrondie à la demi-étoile :
 * c'est ce qu'on lit d'un coup d'œil. Le chiffre suit, au dixième, pour qui veut départager deux
 * films. La phrase complète — note, votes, fournisseur — est pour les lecteurs d'écran et l'infobulle.
 */
export function Etoiles({ note, compacte = false }: { note: NoteMedia; compacte?: boolean }) {
  const remplissage = Math.round(note.surCinq * 2) * 10;
  const chiffre = note.surCinq.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const phrase = `Note : ${chiffre} sur 5, ${note.votes.toLocaleString("fr-FR")} vote${note.votes > 1 ? "s" : ""}`
    + (note.source === "tmdb" ? " sur TMDB" : "");
  return <span className={`etoiles${compacte ? " compactes" : ""}`} role="img" aria-label={phrase} title={phrase}>
    <span className="etoiles-fond" aria-hidden="true">★★★★★<span className="etoiles-or" style={{ width: `${remplissage}%` }}>★★★★★</span></span>
    <span className="etoiles-chiffre" aria-hidden="true">{chiffre}</span>
  </span>;
}
