/**
 * Contraste des couleurs — étape 55.
 *
 * Le dossier impose le niveau WCAG 2.2 AA. Le contraste est la seule exigence d'accessibilité qui se
 * vérifie entièrement par le calcul, sans navigateur ni moteur de rendu : il ne dépend que des
 * couleurs déclarées. Autant l'éprouver plutôt que de l'espérer.
 *
 * Rappel des seuils AA : 4,5 pour un texte courant, 3 pour un texte large — au moins 24 px, ou 18,66 px
 * en gras — et 3 pour les éléments d'interface et les indicateurs de focus.
 */

export const AA_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;
export const AA_INTERFACE = 3;

export interface Rgb { r: number; g: number; b: number; a: number }

/** Lit `#rgb`, `#rrggbb`, `#rrggbbaa` et `rgba(...)`. Rend `null` sur une écriture non reconnue. */
export function parseColor(value: string): Rgb | null {
  const texte = value.trim().toLowerCase();
  if (texte === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (texte === "black") return { r: 0, g: 0, b: 0, a: 1 };

  const hex = texte.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const chiffres = hex[1]!;
    const etendu = chiffres.length === 3 || chiffres.length === 4
      ? [...chiffres].map((caractere) => caractere + caractere).join("")
      : chiffres;
    if (etendu.length !== 6 && etendu.length !== 8) return null;
    return {
      r: Number.parseInt(etendu.slice(0, 2), 16),
      g: Number.parseInt(etendu.slice(2, 4), 16),
      b: Number.parseInt(etendu.slice(4, 6), 16),
      a: etendu.length === 8 ? Number.parseInt(etendu.slice(6, 8), 16) / 255 : 1,
    };
  }

  const fonctionnel = texte.match(/^rgba?\(([^)]+)\)$/);
  if (fonctionnel) {
    const parties = fonctionnel[1]!.split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parties.length < 3 || parties.slice(0, 3).some((nombre) => !Number.isFinite(nombre))) return null;
    return { r: parties[0]!, g: parties[1]!, b: parties[2]!, a: parties[3] ?? 1 };
  }
  return null;
}

/**
 * Compose une couleur translucide sur son fond.
 *
 * Sans cette étape, une couleur semi-transparente serait jugée sur sa valeur nominale, alors que
 * l'œil perçoit le résultat du mélange — et c'est ce résultat que la norme évalue.
 */
export function flatten(foreground: Rgb, background: Rgb): Rgb {
  const alpha = Math.min(1, Math.max(0, foreground.a));
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
    a: 1,
  };
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const canal = (valeur: number) => {
    const proportion = valeur / 255;
    return proportion <= 0.03928 ? proportion / 12.92 : ((proportion + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/** Rapport de contraste WCAG entre deux couleurs, la première étant composée sur la seconde. */
export function contrastRatio(foreground: string, background: string): number | null {
  const avant = parseColor(foreground);
  const arriere = parseColor(background);
  if (!avant || !arriere) return null;
  const composee = flatten(avant, arriere);
  const clair = Math.max(relativeLuminance(composee), relativeLuminance(arriere));
  const sombre = Math.min(relativeLuminance(composee), relativeLuminance(arriere));
  return (clair + 0.05) / (sombre + 0.05);
}

/** Extrait les propriétés personnalisées déclarées sur `:root`. */
export function readRootTokens(css: string): Record<string, string> {
  const bloc = css.match(/:root\s*\{([\s\S]*?)\}/);
  const jetons: Record<string, string> = {};
  if (!bloc) return jetons;
  for (const declaration of bloc[1]!.split(";")) {
    const paire = declaration.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/);
    if (paire) jetons[paire[1]!] = paire[2]!;
  }
  const couleur = bloc[1]!.match(/(?:^|;)\s*color\s*:\s*([^;]+)/);
  const fond = bloc[1]!.match(/(?:^|;)\s*background\s*:\s*([^;]+)/);
  if (couleur) jetons["color"] = couleur[1]!.trim();
  if (fond) jetons["background"] = fond[1]!.trim();
  return jetons;
}
