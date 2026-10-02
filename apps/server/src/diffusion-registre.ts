import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { etatDiffusionVide, type AccuseDiffusion, type CibleDiffusion, type CommandeDiffusion, type EtatDiffusion, type OrdreDiffusion } from "@flixtunes/contracts";

type Inscription = { profil: string; cle: string; nom: string; vu: number; etat: EtatDiffusion;
  ordres: Array<OrdreDiffusion & { expire: number }>; resultats: Map<string, { resultat: AccuseDiffusion | null; expire: number }> };

/** Registre éphémère : la session de profil autorise le contrôleur, la clé propre au lecteur
 * autorise ses battements. Connaître l'identifiant d'une TV ne permet pas d'en voler les ordres. */
export class RegistreDiffusion {
  private appareils = new Map<string, Inscription>();
  constructor(private maintenant = Date.now) {}
  private purger() {
    const now = this.maintenant();
    for (const [id, a] of this.appareils) {
      if (now - a.vu > 30_000) this.appareils.delete(id);
      for (const [idOrdre, r] of a.resultats) if (r.expire < now) a.resultats.delete(idOrdre);
      a.ordres = a.ordres.filter((o) => o.expire >= now);
    }
  }
  inscrire(profil: string, nom: string) {
    this.purger();
    if (this.appareils.size >= 128 || [...this.appareils.values()].filter((a) => a.profil === profil).length >= 24) {
      throw new Error("Trop d’appareils connectés. Patientez quelques secondes.");
    }
    const id = `ft-${randomUUID()}`, cle = randomBytes(32).toString("hex");
    this.appareils.set(id, { profil, cle, nom, vu: this.maintenant(), etat: etatDiffusionVide(), ordres: [], resultats: new Map() });
    return { id, cle };
  }
  private trouver(id: string, profil: string) { this.purger(); const a = this.appareils.get(id); return a?.profil === profil ? a : null; }
  battre(id: string, profil: string, cle: string, etat: EtatDiffusion, accuses: AccuseDiffusion[]): OrdreDiffusion[] | null {
    const a = this.trouver(id, profil);
    if (!a || cle.length !== a.cle.length || !timingSafeEqual(Buffer.from(cle), Buffer.from(a.cle))) return null;
    a.vu = this.maintenant(); a.etat = etat;
    for (const accuse of accuses) { const r = a.resultats.get(accuse.id); if (r && !r.resultat) r.resultat = accuse; }
    const ordres = a.ordres.splice(0);
    return ordres.map(({ id: ordreId, commande }) => ({ id: ordreId, commande }));
  }
  lister(profil: string): CibleDiffusion[] {
    this.purger();
    return [...this.appareils].filter(([, a]) => a.profil === profil).map(([id, a]) => ({
      id, nom: a.nom, protocole: "flixtunes", etat: a.etat, occupe: false,
    }));
  }
  commander(id: string, profil: string, commande: CommandeDiffusion): string | null {
    const a = this.trouver(id, profil); if (!a) return null;
    if (a.ordres.length >= 16) throw new Error("Le lecteur ne répond pas encore.");
    const ordreId = randomUUID();
    a.ordres.push({ id: ordreId, commande, expire: this.maintenant() + 10_000 });
    a.resultats.set(ordreId, { resultat: null, expire: this.maintenant() + 60_000 });
    return ordreId;
  }
  resultat(id: string, profil: string, ordre: string) { return this.trouver(id, profil)?.resultats.get(ordre)?.resultat ?? null; }
  fermer() { this.appareils.clear(); }
}
