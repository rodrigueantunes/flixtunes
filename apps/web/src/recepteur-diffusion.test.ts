// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connecterRecepteur } from "./recepteur-diffusion";
const { diffusion } = vi.hoisted(() => ({ diffusion: vi.fn() }));
vi.mock("./api", () => ({ api: { diffusion } }));
beforeEach(() => { vi.useFakeTimers(); diffusion.mockReset(); });
afterEach(() => vi.useRealTimers());

it("ne réinscrit pas un ancien profil quand sa réponse arrive après la fermeture", async () => {
  let repondre!: (r: unknown) => void;
  diffusion.mockImplementation(() => new Promise(r => { repondre = r; }));
  const catalogue = { profil: "ancien", charger: vi.fn() }, monId = { current: null as string | null };
  const fermer = connecterRecepteur(catalogue, () => catalogue, monId);
  fermer(); monId.current = "nouveau-profil";
  repondre({ id: "ancien-lecteur", cle: "cle" });
  await vi.advanceTimersByTimeAsync(3000);
  expect(monId.current).toBe("nouveau-profil");
  expect(diffusion).toHaveBeenCalledTimes(1);
});

it("ne lance aucun contenu reçu après le démontage du récepteur", async () => {
  let repondre!: (r: unknown) => void;
  diffusion.mockResolvedValueOnce({ id: "lecteur", cle: "cle" })
    .mockImplementationOnce(() => new Promise(r => { repondre = r; }));
  const catalogue = { profil: "profil", charger: vi.fn() }, monId = { current: null as string | null };
  const fermer = connecterRecepteur(catalogue, () => catalogue, monId);
  await vi.advanceTimersByTimeAsync(0);
  expect(diffusion).toHaveBeenCalledTimes(2);
  fermer();
  repondre({ ordres: [{ id: "ordre", commande: { type: "charger", contenu: { genre: "media", id: "film", titre: "Test" }, position: 0 } }] });
  await vi.advanceTimersByTimeAsync(3000);
  expect(catalogue.charger).not.toHaveBeenCalled();
  expect(monId.current).toBeNull(); expect(diffusion).toHaveBeenCalledTimes(2);
});
