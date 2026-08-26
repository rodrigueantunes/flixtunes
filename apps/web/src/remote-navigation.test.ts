// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { type Boite, choisirCible, laisserAuChamp, sansGeometrie } from "./remote-navigation";

/**
 * Le choix de la cible est une fonction pure : elle reçoit des rectangles et rend un index. C'est ce
 * qui permet d'éprouver la navigation à la télécommande sans navigateur, alors que c'est précisément
 * la partie qu'on ne peut pas vérifier « à l'œil » sur un téléviseur qu'on n'a pas sous la main.
 */

/** Une jaquette de 200×300 posée à ces coordonnées. */
function jaquette(left: number, top: number, largeur = 200, hauteur = 300): Boite {
  return { left, top, right: left + largeur, bottom: top + hauteur };
}

/** Une grille de `colonnes` × `rangs`, comme la page catalogue. */
function grille(colonnes: number, rangs: number): Boite[] {
  const boites: Boite[] = [];
  for (let rang = 0; rang < rangs; rang += 1) {
    for (let colonne = 0; colonne < colonnes; colonne += 1) {
      boites.push(jaquette(colonne * 220, rang * 340));
    }
  }
  return boites;
}

describe("déplacement dans une grille de jaquettes", () => {
  const quatreParTrois = grille(4, 3);

  it("avance et recule sur la même ligne", () => {
    expect(choisirCible(0, quatreParTrois, "right")).toBe(1);
    expect(choisirCible(1, quatreParTrois, "left")).toBe(0);
  });

  it("descend et remonte dans la même colonne", () => {
    // La jaquette 5 est en deuxième ligne, deuxième colonne ; celle du dessous porte l'index 9.
    expect(choisirCible(5, quatreParTrois, "down")).toBe(9);
    expect(choisirCible(5, quatreParTrois, "up")).toBe(1);
  });

  it("ne saute jamais en diagonale", () => {
    // Sans pénalité sur l'écart latéral, la jaquette en diagonale peut être plus proche à vol
    // d'oiseau que celle juste en dessous — et le déplacement paraît alors erratique.
    for (const depart of [0, 1, 2, 5, 6]) {
      const cible = choisirCible(depart, quatreParTrois, "down");
      expect(cible, `depuis ${depart}`).toBe(depart + 4);
    }
  });

  it("s'arrête aux bords au lieu de repartir de l'autre côté", () => {
    // Un enroulement ferait traverser tout l'écran pour un appui de trop : sur un téléviseur, la
    // personne perd alors complètement le fil de sa position.
    expect(choisirCible(3, quatreParTrois, "right"), "dernière colonne").toBeNull();
    expect(choisirCible(0, quatreParTrois, "up"), "première ligne").toBeNull();
    expect(choisirCible(0, quatreParTrois, "left"), "première colonne").toBeNull();
  });
});

describe("déplacement entre rails de l'accueil", () => {
  // Deux rails superposés, décalés : le second commence plus à gauche, comme après un défilement.
  const rails: Boite[] = [
    jaquette(0, 0), jaquette(220, 0), jaquette(440, 0),
    jaquette(60, 340), jaquette(280, 340), jaquette(500, 340),
  ];

  it("descend sur la jaquette la mieux alignée du rail suivant", () => {
    // Depuis la deuxième jaquette du rail du haut, c'est celle qui lui fait face en dessous.
    expect(choisirCible(1, rails, "down")).toBe(4);
  });

  it("remonte symétriquement", () => {
    expect(choisirCible(4, rails, "up")).toBe(1);
  });
});

describe("repli quand la mise en page est absente", () => {
  const platitudes: Boite[] = [
    { left: 0, top: 0, right: 0, bottom: 0 },
    { left: 0, top: 0, right: 0, bottom: 0 },
    { left: 0, top: 0, right: 0, bottom: 0 },
  ];

  it("reconnaît l'absence de géométrie", () => {
    expect(sansGeometrie(platitudes)).toBe(true);
    expect(sansGeometrie(grille(2, 2))).toBe(false);
  });

  it("suit l'ordre du document plutôt que de s'immobiliser", () => {
    // Ce repli ne remplace pas la géométrie ; il garantit seulement qu'aucun appui ne reste sans effet.
    expect(choisirCible(0, platitudes, "right")).toBe(1);
    expect(choisirCible(1, platitudes, "left")).toBe(0);
    expect(choisirCible(2, platitudes, "right")).toBeNull();
  });
});

describe("commandes qui gardent leurs flèches", () => {
  /** Construit un élément détaché pour l'interroger. */
  function element(html: string): Element {
    const hote = document.createElement("div");
    hote.innerHTML = html;
    return hote.firstElementChild!;
  }

  it("laisse les flèches aux champs où elles ont déjà un sens", () => {
    // La barre de progression du lecteur est un curseur : lui prendre ses flèches empêcherait de se
    // déplacer dans le film à la télécommande, ce qui est exactement l'inverse du but.
    expect(laisserAuChamp(element('<input type="range" />'))).toBe(true);
    expect(laisserAuChamp(element('<input type="text" />'))).toBe(true);
    expect(laisserAuChamp(element("<select></select>"))).toBe(true);
    expect(laisserAuChamp(element("<textarea></textarea>"))).toBe(true);
  });

  it("reprend les flèches là où elles ne servent à rien", () => {
    expect(laisserAuChamp(element("<button>Lire</button>"))).toBe(false);
    expect(laisserAuChamp(element('<a href="#films">Films</a>'))).toBe(false);
    expect(laisserAuChamp(element('<input type="checkbox" />'))).toBe(false);
  });
});
