import { describe, expect, it } from "vitest";
import { ecartEntre, repereDansLaPlaylist, tempsPourRepere, type SegmentRepere } from "./releve-direct";

/**
 * Le raccord de la relève : deux lectures de la même chaîne, ouvertes à des moments différents, n'ont
 * pas la même origine des temps. Le raccord doit montrer la même image, et le dire quand il ne peut pas.
 */

/** Six segments de 9 s à partir du numéro `premier`, sur une ligne de temps qui commence à `origine`. */
function playlist(premier: number, origine: number, avecHeure = false): SegmentRepere[] {
  return Array.from({ length: 6 }, (_, index) => ({
    sn: premier + index, start: origine + index * 9, duration: 9,
    programDateTime: avecHeure ? 1_800_000_000_000 + (premier + index) * 9_000 : null,
  }));
}

describe("le raccord de la relève", () => {
  it("retrouve la même image par le numéro de segment, malgré deux origines des temps", () => {
    const principale = playlist(100, 250);
    const releve = playlist(102, 12);
    const repere = repereDansLaPlaylist(principale, 250 + 3 * 9 + 4.5);
    expect(repere).toEqual({ sn: 103, decalage: 4.5, pdt: null });
    // Le segment 103 est le deuxième de la relève, qui commence à 12 s : 12 + 9 + 4,5.
    expect(tempsPourRepere(releve, repere!)).toBe(25.5);
  });

  it("préfère l'heure de programme quand la chaîne la publie", () => {
    const principale = playlist(100, 250, true);
    // Une numérotation décalée d'un cran : seule l'heure relie encore les deux lectures.
    const releve = playlist(500, 0, true).map((segment, index) => ({ ...segment, programDateTime: 1_800_000_000_000 + (102 + index) * 9_000 }));
    const repere = repereDansLaPlaylist(principale, 250 + 3 * 9 + 4.5)!;
    expect(tempsPourRepere(releve, repere)).toBe(13.5);
  });

  it("dit quand le segment est déjà sorti de la fenêtre de la relève", () => {
    const repere = repereDansLaPlaylist(playlist(100, 250), 251)!;
    expect(tempsPourRepere(playlist(120, 0), repere)).toBeNull();
    expect(repereDansLaPlaylist(playlist(100, 250), 10)).toBeNull();
  });

  it("mesure l'avance d'une lecture sur l'autre", () => {
    expect(ecartEntre({ sn: 103, decalage: 4.5, pdt: null }, { sn: 104, decalage: 1, pdt: null }, 9)).toBe(5.5);
    expect(ecartEntre({ sn: 1, decalage: 0, pdt: 10_000 }, { sn: 9, decalage: 0, pdt: 9_950 }, 9)).toBe(-0.05);
    expect(ecartEntre(null, { sn: 1, decalage: 0, pdt: null }, 9)).toBeNull();
  });
});
