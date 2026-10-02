/** Avancement réel de FFmpeg, distinct de ses messages d'erreur et des requêtes du client. */
export class AvancementPreparation {
  private tampon = "";
  private image = 0;
  private temps = 0;
  private avance: number;
  constructor(private horloge = Date.now) { this.avance = horloge(); }
  recevoir(texte: string) {
    this.tampon = (this.tampon + texte).slice(-16_384);
    const lignes = this.tampon.split(/\r?\n/); this.tampon = lignes.pop() ?? "";
    for (const ligne of lignes) {
      const r = /^(frame|out_time_us)=(\d+)$/.exec(ligne);
      if (!r) continue;
      const valeur = Number(r[2]); if (!Number.isSafeInteger(valeur)) continue;
      if (r[1] === "frame" && valeur > this.image) { this.image = valeur; this.avance = this.horloge(); }
      if (r[1] === "out_time_us" && valeur > this.temps) { this.temps = valeur; this.avance = this.horloge(); }
    }
  }
  bloquee(delai: number) { return this.horloge() - this.avance > delai; }
}

/** Réduit le travail HDR avant la conversion flottante, uniquement pour la diffusion distante. */
export function filtresPreparationDiffusion(filtres: string[], echelle: string, reduireHdrLogiciel: boolean): string[] {
  if (!reduireHdrLogiciel) return [...filtres, echelle];
  // Le désentrelacement éventuel garde sa place avant le redimensionnement.
  const debut = filtres.findIndex(f => !/^(yadif|bwdif)(=|$)/.test(f));
  const index = debut < 0 ? filtres.length : debut;
  return [...filtres.slice(0, index), echelle, ...filtres.slice(index)];
}

export class ErreurPreparationDiffusion extends Error {
  constructor(readonly code: "CAST_PREPARATION_REFUSEE" | "CAST_PREPARATION_ECHOUEE" | "CAST_PREPARATION_DELAI",
    message: string, readonly repliPossible: boolean) {
    super(`${message} [${code}]`);
  }
}
