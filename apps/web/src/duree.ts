/**
 * La durée d'une vidéo, au format `hh:mm:ss`, telle qu'elle s'affiche à droite de sa date.
 *
 * La durée vient du **fichier** — le sondage fait à l'analyse —, jamais de la plateforme : c'est ce
 * qui a été demandé, et c'est aussi la seule qui dise ce qu'on va réellement regarder. Une vidéo
 * remontée ou tronquée au téléchargement n'a plus la durée que YouTube annonce.
 *
 * Les heures sont toujours écrites, même à zéro : `00:12:34`. Toutes les durées d'une grille ont
 * alors la même largeur et s'alignent à droite, ce qu'un `12:34` voisin d'un `1:02:15` ne ferait pas.
 * Une durée inconnue n'affiche rien plutôt qu'un `00:00:00` qui passerait pour une vraie mesure.
 */
export function dureeLisible(secondes: number | null | undefined): string {
  if (secondes == null || !Number.isFinite(secondes) || secondes <= 0) return "";
  const total = Math.round(secondes);
  const deux = (valeur: number) => String(valeur).padStart(2, "0");
  return `${deux(Math.floor(total / 3600))}:${deux(Math.floor((total % 3600) / 60))}:${deux(total % 60)}`;
}
