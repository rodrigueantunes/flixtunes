import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { etatDiffusionVide, type AccuseDiffusion, type ActionRelais, type CibleDiffusion, type CommandeDiffusion, type EtatDiffusion,
  type OrdreDiffusion, type OrdreRelais } from "@flixtunes/contracts";

type Ordre = (OrdreDiffusion | OrdreRelais) & { expire: number };
type Inscription = { profil: string; cle: string; nom: string; vu: number; etat: EtatDiffusion;
  /** Un téléviseur vu par un téléphone ou un navigateur hors de chez soi, piloté à travers lui. */
  relais?: { modele?: string; media?: string };
  ordres: Ordre[]; resultats: Map<string, { resultat: AccuseDiffusion | null; expire: number }>;
  attentes: Map<string, (accuse: AccuseDiffusion | null) => void> };

/** Registre éphémère : la session de profil autorise le contrôleur, la clé propre au lecteur
 * autorise ses battements. Connaître l'identifiant d'une TV ne permet pas d'en voler les ordres. */
export class RegistreDiffusion {
  private appareils = new Map<string, Inscription>();
  constructor(private maintenant = Date.now) {}
  private purger() {
    const now = this.maintenant();
    for (const [id, a] of this.appareils) {
      if (now - a.vu > 30_000) {
        this.appareils.delete(id);
        // Un relais disparu ne répondra plus : ses attentes échouent tout de suite.
        for (const fin of a.attentes.values()) fin(null);
        a.attentes.clear();
      }
      for (const [idOrdre, r] of a.resultats) if (r.expire < now) a.resultats.delete(idOrdre);
      a.ordres = a.ordres.filter((o) => o.expire >= now);
    }
  }
  private ajouter(profil: string, nom: string, prefixe: "ft" | "rl", relais?: Inscription["relais"]) {
    this.purger();
    if (this.appareils.size >= 128 || [...this.appareils.values()].filter((a) => a.profil === profil).length >= 24) {
      throw new Error("Trop d’appareils connectés. Patientez quelques secondes.");
    }
    const id = `${prefixe}-${randomUUID()}`, cle = randomBytes(32).toString("hex");
    this.appareils.set(id, { profil, cle, nom, vu: this.maintenant(), etat: etatDiffusionVide(), relais, ordres: [],
      resultats: new Map(), attentes: new Map() });
    return { id, cle };
  }
  inscrire(profil: string, nom: string) { return this.ajouter(profil, nom, "ft"); }
  /** Un téléviseur qu'un relais voit sur son réseau : le NAS le pilotera par des ordres de relais. */
  inscrireRelais(profil: string, nom: string, modele?: string) { return this.ajouter(profil, nom, "rl", { modele }); }
  private trouver(id: string, profil: string) { this.purger(); const a = this.appareils.get(id); return a?.profil === profil ? a : null; }
  battre(id: string, profil: string, cle: string, etat: EtatDiffusion, accuses: AccuseDiffusion[], media?: string): Array<OrdreDiffusion | OrdreRelais> | null {
    const a = this.trouver(id, profil);
    if (!a || cle.length !== a.cle.length || !timingSafeEqual(Buffer.from(cle), Buffer.from(a.cle))) return null;
    a.vu = this.maintenant(); a.etat = etat;
    if (a.relais) a.relais.media = media;
    for (const accuse of accuses) {
      const r = a.resultats.get(accuse.id); if (r && !r.resultat) r.resultat = accuse;
      const fin = a.attentes.get(accuse.id); if (fin) { a.attentes.delete(accuse.id); fin(accuse); }
    }
    return a.ordres.splice(0).map(({ expire: _expire, ...ordre }) => ordre);
  }
  lister(profil: string): CibleDiffusion[] {
    this.purger();
    return [...this.appareils].filter(([, a]) => a.profil === profil).map(([id, a]): CibleDiffusion => a.relais
      ? { id, nom: a.nom, protocole: "googlecast", modele: a.relais.modele, relais: true, etat: null, occupe: false }
      : { id, nom: a.nom, protocole: "flixtunes", etat: a.etat, occupe: false });
  }
  /** Le téléviseur relayé, tel que le relais l'a annoncé, et ce qu'il lit d'après son dernier battement. */
  relais(id: string, profil: string): { id: string; nom: string; modele?: string; etat: EtatDiffusion; media?: string } | null {
    const a = this.trouver(id, profil);
    return a?.relais ? { id, nom: a.nom, modele: a.relais.modele, etat: a.etat, media: a.relais.media } : null;
  }
  private poser(id: string, profil: string, ordre: Omit<OrdreDiffusion, "id"> | Omit<OrdreRelais, "id">): string | null {
    const a = this.trouver(id, profil); if (!a) return null;
    if (a.ordres.length >= 16) throw new Error("Le lecteur ne répond pas encore.");
    const ordreId = randomUUID();
    a.ordres.push({ id: ordreId, ...ordre, expire: this.maintenant() + 10_000 } as Ordre);
    a.resultats.set(ordreId, { resultat: null, expire: this.maintenant() + 60_000 });
    return ordreId;
  }
  commander(id: string, profil: string, commande: CommandeDiffusion): string | null { return this.poser(id, profil, { commande }); }
  /**
   * Pose un ordre pour un relais et attend son accusé. `null` : le relais n'a pas répondu à temps, ou
   * n'est plus là — le téléphone a quitté le réseau, ou l'onglet a été fermé.
   */
  async ordonner(id: string, profil: string, action: ActionRelais, delai: number): Promise<AccuseDiffusion | null> {
    const ordre = this.poser(id, profil, { relais: action });
    const a = this.appareils.get(id);
    if (!ordre || !a) return null;
    return await new Promise<AccuseDiffusion | null>((resolve) => {
      const timer = setTimeout(() => { a.attentes.delete(ordre); resolve(null); }, delai);
      timer.unref?.();
      a.attentes.set(ordre, (accuse) => { clearTimeout(timer); resolve(accuse); });
    });
  }
  resultat(id: string, profil: string, ordre: string) { return this.trouver(id, profil)?.resultats.get(ordre)?.resultat ?? null; }
  fermer() {
    for (const a of this.appareils.values()) { for (const fin of a.attentes.values()) fin(null); a.attentes.clear(); }
    this.appareils.clear();
  }
}
