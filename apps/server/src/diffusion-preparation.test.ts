import { expect, it } from "vitest";
import { AvancementPreparation, filtresPreparationDiffusion } from "./diffusion-preparation.js";

it("laisse une conversion avancer au-delà de vingt secondes et repère son blocage réel", () => {
  let maintenant = 0; const a = new AvancementPreparation(() => maintenant);
  for (let i = 1; i <= 8; i++) {
    maintenant = i * 10_000; a.recevoir(`frame=${i}\nout_time_us=${i * 100000}\nprogress=continue\n`);
    expect(a.bloquee(20_000)).toBe(false);
  }
  maintenant += 20_001; a.recevoir("frame=8\nout_time_us=800000\nprogress=continue\n");
  expect(a.bloquee(20_000)).toBe(true);
});
it("une relance a son propre délai et les messages sans avancement ne la maintiennent pas en vie", () => {
  let maintenant = 0; const initial = new AvancementPreparation(() => maintenant);
  maintenant = 25_000; expect(initial.bloquee(20_000)).toBe(true);
  const repli = new AvancementPreparation(() => maintenant);
  expect(repli.bloquee(20_000)).toBe(false);
  maintenant += 20_001; repli.recevoir("frame=0\nout_time_us=N/A\nprogress=continue\n");
  expect(repli.bloquee(20_000)).toBe(true);
});
it("accepte les blocs de progression fragmentés sans confondre bruit et avancement", () => {
  let maintenant = 0; const a = new AvancementPreparation(() => maintenant);
  maintenant = 19_000; a.recevoir("fra"); a.recevoir("me=12\r\nout_time_us=100"); a.recevoir("0000\n");
  maintenant = 25_000; expect(a.bloquee(20_000)).toBe(false);
  maintenant = 40_000; a.recevoir("frame=-1\nframe=NaN\nframe=1\n" + "x".repeat(40_000));
  expect(a.bloquee(20_000)).toBe(true);
});
it("réduit le HDR avant le traitement flottant, après le désentrelacement, sans modifier les autres chemins", () => {
  const hdr = ["yadif", "zscale=transfer=linear", "format=gbrpf32le", "tonemap=hable"];
  expect(filtresPreparationDiffusion(hdr, "scale=1920:1080", true)).toEqual([
    "yadif", "scale=1920:1080", ...hdr.slice(1),
  ]);
  expect(filtresPreparationDiffusion(hdr, "scale=1920:1080", false)).toEqual([...hdr, "scale=1920:1080"]);
  expect(hdr[1]).toBe("zscale=transfer=linear");
});
