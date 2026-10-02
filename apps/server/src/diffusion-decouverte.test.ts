import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const fixture = vi.hoisted(() => ({ navigateurs: [] as any[], options: [] as any[], reseaux: {} as Record<string, any[]> }));
vi.mock("node:os", () => ({ networkInterfaces: () => fixture.reseaux }));
vi.mock("bonjour-service", () => ({ Bonjour: class {
  constructor(options: unknown) { fixture.options.push(options); }
  find(_options: unknown, callback: (...args: any[]) => void) {
    const b = Object.assign(new EventEmitter(), { update: vi.fn(), stop: vi.fn() });
    b.on("up", callback); fixture.navigateurs.push(b); return b;
  }
  destroy() {}
} }));
vi.mock("node:dgram", () => ({ default: { createSocket: () => Object.assign(new EventEmitter(), {
  bind: (_port: number, _adresse: string, cb: () => void) => cb(), setMulticastTTL() {}, send() {}, close() {},
}) } }));
import { DecouverteDiffusion } from "./diffusion-reseau.js";
afterEach(() => { vi.unstubAllEnvs(); fixture.navigateurs = []; fixture.options = []; fixture.reseaux = {}; });
it("suit le port et l’adresse actualisés après un réveil sans dupliquer le récepteur", () => {
  vi.stubEnv("NODE_ENV", "development");
  const d = new DecouverteDiffusion();
  try {
    d.demarrer();
    const ancien = { addresses: ["10.0.0.2"], port: 8009, name: "TV", txt: { id: "identite-stable", fn: "Téléviseur" } };
    fixture.navigateurs[0].emit("up", ancien);
    const id = d.lister()[0]!.id;
    const nouveau = { ...ancien, addresses: ["10.0.0.3"], port: 8010 };
    fixture.navigateurs[0].emit("srv-update", nouveau, ancien);
    expect(d.lister()).toHaveLength(1);
    expect(d.trouver(id)).toMatchObject({ adresse: "10.0.0.3", port: 8010 });
    fixture.navigateurs[0].emit("down", nouveau); expect(d.lister()).toEqual([]);
  } finally { d.fermer(); }
});

it("cherche sur chaque interface privée et conserve un appareil encore vu sur une autre", () => {
  vi.stubEnv("NODE_ENV", "development");
  fixture.reseaux = { lan: [{ address: "10.0.0.1", internal: false }], vm: [{ address: "192.168.7.1", internal: false }],
    boucle: [{ address: "127.0.0.1", internal: true }], public: [{ address: "8.8.8.8", internal: false }] };
  const d = new DecouverteDiffusion();
  try {
    d.demarrer(); expect(fixture.options).toEqual([
      { bind: "0.0.0.0", interface: "10.0.0.1", reuseAddr: true },
      { bind: "0.0.0.0", interface: "192.168.7.1", reuseAddr: true },
    ]);
    const service = { addresses: ["10.0.0.2"], port: 8009, name: "TV", txt: { id: "meme-tv", fn: "TV" } };
    for (const b of fixture.navigateurs) b.emit("up", service);
    expect(d.lister()).toHaveLength(1);
    fixture.navigateurs[0].emit("down", service); expect(d.lister()).toHaveLength(1);
    fixture.navigateurs[1].emit("down", service); expect(d.lister()).toHaveLength(0);
  } finally { d.fermer(); }
  expect(fixture.navigateurs.every(b => b.stop.mock.calls.length === 1)).toBe(true);
});
