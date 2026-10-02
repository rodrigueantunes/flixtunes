import { afterEach, expect, it, vi } from "vitest";
import { lookup } from "node:dns";
import { lookupPublic, recupererPublic } from "./live-http-public.js";
import { adressePrivee } from "./live-relais.js";
import { adresseLiveDistante, lireAccesLiveDistant } from "./live-acces-distant.js";
vi.mock("node:dns", () => ({ lookup: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); });
it.each(["127.0.0.1", "10.20.30.254", "169.254.169.254", "100.64.0.1", "::1", "0:0:0:0:0:0:0:1", "::ffff:7f00:1", "fe80::1", "fd00::1"])("refuse la cible interne %s", async (ip) => {
  expect(adressePrivee(ip)).toBe(true);
  await expect(recupererPublic(`http://${ip.includes(":") ? `[${ip}]` : ip}/`, {})).rejects.toThrow();
});
it("refuse un DNS mêlant une adresse publique et une adresse privée lors de la connexion", () => {
  vi.mocked(lookup).mockImplementation(((_hote: unknown, _options: unknown, callback: Function) => {
    callback(null, [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
  }) as typeof lookup);
  const callback = vi.fn();
  lookupPublic("public.example", { all: true }, callback);
  expect(callback).toHaveBeenCalledWith(expect.any(Error));
});
it("connecte uniquement les adresses publiques effectivement vérifiées", () => {
  vi.mocked(lookup).mockImplementation(((_hote: unknown, _options: unknown, callback: Function) => {
    callback(null, [{ address: "8.8.8.8", family: 4 }]);
  }) as typeof lookup);
  const callback = vi.fn();
  lookupPublic("public.example", { all: true }, callback);
  expect(callback).toHaveBeenCalledWith(null, [{ address: "8.8.8.8", family: 4 }]);
});
it("expire les accès relayés et détecte une altération du contenu chiffré", () => {
  const url = new URL(adresseLiveDistante("https://tv.example/live.m3u8", "profil", "chaine"), "https://local");
  const token = url.searchParams.get("t")!;
  expect(lireAccesLiveDistant(token, "profil")?.chaine).toBe("chaine");
  const octets = Buffer.from(token, "base64url"); octets[30] = octets[30]! ^ 1;
  expect(lireAccesLiveDistant(octets.toString("base64url"), "profil")).toBeNull();
  const maintenant = Date.now(); vi.spyOn(Date, "now").mockReturnValue(maintenant + 7 * 60 * 60_000);
  expect(lireAccesLiveDistant(token, "profil")).toBeNull();
});
