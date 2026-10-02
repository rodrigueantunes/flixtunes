import { afterEach, expect, it, vi } from "vitest";
import { TransportCast } from "./diffusion-cast.js";
import type { EtatDiffusion } from "@flixtunes/contracts";
function banc() {
  const etats: Partial<EtatDiffusion>[] = [];
  const t = new TransportCast({ id: "test", nom: "Test", adresse: "127.0.0.1", port: 8009, protocole: "googlecast", vu: 0 }, e => etats.push(e));
  // Injection de notifications récepteur ; la suite TLS couvre leur décodage et leur provenance.
  const interne = t as any; interne.contenuAttendu = "http://nas/nouveau";
  const statut = (time: number, state = "PLAYING", id = 42, contenu: string | undefined = "http://nas/nouveau") =>
    interne.actualiser({ mediaSessionId: id, currentTime: time, playerState: state, ...(contenu ? { media: { contentId: contenu } } : {}) });
  return { etats, interne, statut };
}
afterEach(() => vi.useRealTimers());
it("ne confirme pas un PLAYING transitoire ou une position immobile", () => {
  const { etats, interne, statut } = banc();
  statut(0); statut(0); expect(interne.enLecture).toBe(false); expect(etats.at(-1)?.lecture).toBe("chargement");
  statut(0, "BUFFERING"); statut(0); expect(interne.enLecture).toBe(false);
  statut(1); expect(interne.enLecture).toBe(true); expect(etats.at(-1)?.lecture).toBe("lecture");
});
it("ignore la progression du média précédent et d’une autre session", () => {
  const { etats, interne, statut } = banc();
  statut(40, "PLAYING", 9, "http://nas/ancien"); statut(42, "PLAYING", 9, "http://nas/ancien");
  expect(etats).toHaveLength(0); expect(interne.enLecture).toBe(false);
  statut(0); statut(50, "PLAYING", 9); expect(interne.enLecture).toBe(false);
  interne.actualiser({mediaSessionId:42,playerState:"PLAYING",currentTime:1}); expect(interne.enLecture).toBe(true);
});
it("efface le succès lorsque le récepteur n’a plus de session", () => {
  const { etats, interne, statut } = banc(); statut(0); statut(1); interne.actualiser(undefined);
  expect(interne.enLecture).toBe(false); expect(etats.at(-1)?.lecture).toBe("repos");
});
it("signale une lecture annoncée PLAYING mais figée, puis accepte sa reprise réelle", () => {
  vi.useFakeTimers(); const { etats, statut } = banc(); statut(0); statut(1);
  vi.advanceTimersByTime(21_000); statut(1); expect(etats.at(-1)?.lecture).toBe("erreur");
  statut(2); expect(etats.at(-1)?.lecture).toBe("lecture");
});
it("ne confond pas une longue pause avec une lecture bloquée", () => {
  vi.useFakeTimers(); const { etats, statut } = banc(); statut(0); statut(1); statut(1, "PAUSED");
  vi.advanceTimersByTime(60_000); statut(1); expect(etats.at(-1)?.erreur).toBeNull();
});
it("rend IDLE/ERROR comme une erreur de lecture", () => {
  const { etats, interne, statut } = banc(); statut(0);
  interne.actualiser({ mediaSessionId: 42, playerState: "IDLE", idleReason: "ERROR" });
  expect(etats.at(-1)?.lecture).toBe("erreur"); expect(interne.erreurLecture.code).toBe("CAST_MEDIA");
});
