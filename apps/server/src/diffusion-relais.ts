import type { ActionRelais, CommandeDiffusion, EtatDiffusion } from "@flixtunes/contracts";
import { ErreurCast, type MetadonneesDiffusion } from "./diffusion-cast.js";
import type { RegistreDiffusion } from "./diffusion-registre.js";
import type { EnvoiSoap } from "./diffusion-dlna.js";
import type { Recepteur } from "./diffusion-reseau.js";

/**
 * Un téléviseur vu par un relais, tel que la diffusion le manipule. Pour un téléviseur DLNA (r11), la
 * description qu'en a faite le téléphone, et l'adresse du relais vidéo qu'il tient sur son Wi-Fi.
 */
export interface CibleRelais { id: string; nom: string; protocole: "googlecast" | "dlna"; modele?: string; relais: true;
  dlna?: { recepteur: Recepteur; local: string } }

/**
 * Les commandes SOAP d'un téléviseur DLNA chez un proche : le NAS les compose comme pour un
 * téléviseur de la maison, et le téléphone les poste au téléviseur qu'il a lui-même annoncé.
 */
export function envoiSoapParRelais(registre: RegistreDiffusion, id: string, profil: string): EnvoiSoap {
  return async (url, action, corps) => {
    const accuse = await registre.ordonner(id, profil, { type: "soap", url, action, corps }, 12_000);
    if (!accuse) throw new Error("Le téléphone qui voit ce téléviseur ne répond plus");
    if (!accuse.ok || !accuse.reponse) throw new Error(accuse.erreur?.slice(0, 300) || "Le téléviseur DLNA ne répond pas");
    return new Response(accuse.reponse.corps, { status: accuse.reponse.statut >= 200 && accuse.reponse.statut <= 599 ? accuse.reponse.statut : 502 });
  };
}

type Verdict = "accepte" | "refuse" | "inconnu";

/**
 * Le transport d'un téléviseur relayé : chaque geste du NAS devient un ordre au téléphone ou au
 * navigateur qui voit ce téléviseur, et qui l'exécute avec le SDK Cast.
 *
 * Il reprend l'interface de `TransportCast`, pour que la diffusion — sonde, plan de qualité, replis,
 * progression — reste la même qu'à la maison. Seul le canal change : le NAS ne peut pas joindre un
 * téléviseur chez un proche, le téléphone qui est à côté de lui le peut.
 */
export class TransportRelais {
  readonly relais = true;
  private url?: string;
  private ferme = false;
  constructor(private registre: RegistreDiffusion, private cible: CibleRelais, private profil: string,
    private etat: (etat: Partial<EtatDiffusion>) => void) {}

  private async ordre(action: ActionRelais, delai: number, silence: { code: string; message: string }) {
    if (this.ferme) throw new ErreurCast("CAST_CONNEXION", "Connexion au relais fermée");
    const accuse = await this.registre.ordonner(this.cible.id, this.profil, action, delai);
    if (!accuse) throw new ErreurCast(silence.code, silence.message);
    if (!accuse.ok) throw new ErreurCast(accuse.code && /^[A-Z0-9_]{3,40}$/.test(accuse.code) ? accuse.code : "CAST_RELAIS",
      accuse.erreur?.slice(0, 300) || "Le téléviseur a refusé la commande");
    return accuse;
  }

  /** Le relais ouvre la session Cast du téléviseur, ou confirme qu'elle est ouverte. */
  async verifier() {
    await this.ordre({ type: "verifier" }, 25_000,
      { code: "CAST_CONNEXION", message: "Le téléphone qui voit ce téléviseur ne répond plus" });
  }

  async sonder(url: string, mime: string, fmp4: boolean): Promise<Verdict> {
    try {
      const accuse = await this.ordre({ type: "sonder", url, mime, fmp4 }, 15_000, { code: "CAST_SONDE", message: "Sonde sans réponse" });
      return accuse.verdict ?? "inconnu";
    } catch (e) {
      return e instanceof ErreurCast && /^CAST_(LOAD_FAILED|MEDIA)/.test(e.code) ? "refuse" : "inconnu";
    }
  }

  /** Le lecteur du téléviseur s'ouvre avec la session, à la vérification : rien de plus à faire ici. */
  preparerLecteur(): Promise<void> { return Promise.resolve(); }

  async charger(url: string, mime: string, titre: string, direct: boolean, position: number, segmentsFmp4 = false, metadonnees?: MetadonneesDiffusion) {
    this.url = url;
    await this.ordre({ type: "charger", url, mime, direct, position: direct ? 0 : position, fmp4: segmentsFmp4,
      metadonnees: metadonnees ?? { genre: direct ? "direct" : "film", titre } }, 45_000,
    { code: "CAST_DEMARRAGE", message: "Le téléviseur n’a pas confirmé le démarrage de la vidéo" });
  }

  async commander(c: Exclude<CommandeDiffusion, { type: "charger" | "reinitialiser" }>) {
    await this.ordre({ type: "commande", commande: c }, 10_000, { code: "CAST_DELAI", message: "Le téléphone relais ne répond pas" });
  }

  /**
   * Arrête le média et ferme l'application Cast du téléviseur. Un relais disparu n'empêche rien. Comme
   * le transport Cast, le transport reste utilisable : un repli recharge le niveau suivant juste après.
   */
  async liberer() {
    this.url = undefined;
    try { await this.ordre({ type: "liberer" }, 8_000, { code: "CAST_DELAI", message: "Relais injoignable" }); }
    catch { /* le téléviseur est peut-être déjà libre, ou le relais parti */ }
  }

  async reinitialiser() { await this.liberer(); this.fermer(); }

  fermer() { this.ferme = true; this.url = undefined; }

  /**
   * L'état du téléviseur, tel que le relais le rapporte à chaque battement. Seul l'état du média que
   * le NAS a chargé compte : celui d'une sonde ou d'une autre application ne doit pas s'y mêler.
   */
  recevoir(etat: EtatDiffusion, media?: string) {
    if (this.ferme || !this.url) return;
    if (media !== this.url) {
      // Le téléviseur lit autre chose : repris par une autre application, ou arrêté depuis sa télécommande.
      if (media && etat.lecture !== "repos") this.etat({ lecture: "repos", motifRepos: "tiers" });
      return;
    }
    this.etat({ lecture: etat.lecture, position: etat.position, ...(etat.duree > 0 ? { duree: etat.duree } : {}),
      volume: etat.volume, ...(etat.motifRepos ? { motifRepos: etat.motifRepos } : {}),
      ...(etat.lecture === "erreur" ? { erreur: etat.erreur } : {}) });
  }
}
