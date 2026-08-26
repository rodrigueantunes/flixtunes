/**
 * Libellé grand public de la définition encodée.
 *
 * Un film cinémascope conserve généralement la largeur de sa famille vidéo mais retire les bandes
 * noires de l'image encodée : un master 1080p devient par exemple 1920×804, et un master UHD
 * 3840×1606. Classer uniquement le petit côté les annonçait respectivement 720p et 1440p. La largeur
 * nominale doit donc compter autant que la hauteur, quelle que soit l'orientation de la vidéo.
 *
 * Les seuils du grand côté restent légèrement sous les largeurs normalisées afin d'accepter les
 * quelques colonnes de recadrage usuelles. Une définition atypique qui n'appartient à aucune famille
 * garde sa hauteur réelle au lieu d'être artificiellement arrondie vers le bas.
 */
export function displayResolution(width: number | null | undefined, height: number | null | undefined): string | null {
  const longest = Math.max(width ?? 0, height ?? 0);
  const shortest = Math.min(width ?? 0, height ?? 0);
  if (longest <= 0 || shortest <= 0) return null;
  if (longest >= 7000 || shortest >= 4000) return "8K";
  if (longest >= 3600 || shortest >= 2000) return "4K";
  if (longest >= 2400 || shortest >= 1350) return "1440p";
  if (longest >= 1800 || shortest >= 1000) return "1080p";
  // 1280×720 et 1366×768 appartiennent à la famille 720p. Ne pas englober 1600×900 : cette
  // définition atypique est réellement supérieure et mérite son libellé 900p.
  if ((longest >= 1200 && longest < 1500) || (shortest >= 700 && shortest < 850)) return "720p";
  return `${shortest}p`;
}
