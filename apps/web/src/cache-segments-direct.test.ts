import { describe, expect, it, vi } from "vitest";
import type Hls from "hls.js";
import type { FragmentLoaderContext, HlsConfig, LoaderConfiguration } from "hls.js";
import { CacheSegmentsDirect, chargeurAvecCache, cleSegment } from "./cache-segments-direct";

describe("la réserve de segments pour une reprise", () => {
  it("reste bornée, expire sans être prolongée par les lectures et protège les octets transférés", () => {
    let date = 0;
    const cache = new CacheSegmentsDirect(8, 90, () => date);
    const octets = new Uint8Array([1, 2, 3, 4]);
    cache.garder("a", octets.buffer, 20);
    octets.fill(9);
    new Uint8Array(cache.lire("a")!.octets).fill(8);
    expect(new Uint8Array(cache.lire("a")!.octets)).toEqual(new Uint8Array([1, 2, 3, 4]));
    cache.garder("b", octets.buffer, 20);
    cache.garder("c", octets.buffer, 20);
    expect(cache.lire("a")).toBeNull();
    date = 89;
    expect(cache.lire("b")).not.toBeNull();
    date = 90;
    expect(cache.lire("b")).toBeNull();
    cache.vider();
    expect(cache.lire("c")).toBeNull();
  });

  it("distingue les plages, les sessions et les numéros de segments même si l'URL est réutilisée", () => {
    const contexte = { url: "https://tv.test/live.ts?session=1", frag: { sn: 7, cc: 0 } } as FragmentLoaderContext;
    const cle = cleSegment(contexte);
    expect(cleSegment({ ...contexte, rangeStart: 100 })).not.toBe(cle);
    expect(cleSegment({ ...contexte, url: contexte.url + "2" })).not.toBe(cle);
    expect(cleSegment({ ...contexte, frag: { ...contexte.frag, sn: 8 } } as FragmentLoaderContext)).not.toBe(cle);
  });

  it("réutilise un segment complet sans réseau et annule un rappel après destruction", async () => {
    const load = vi.fn();
    class Reseau { stats = { loading: {} }; load = load; destroy() {} abort() {} }
    const Classe = chargeurAvecCache({ DefaultConfig: { loader: Reseau } } as unknown as typeof Hls, new CacheSegmentsDirect());
    const contexte = { url: "https://tv.test/7.ts", frag: { sn: 7, cc: 0 } } as FragmentLoaderContext;
    const config = {} as LoaderConfiguration;
    const callbacks = { onSuccess: vi.fn(), onError: vi.fn(), onTimeout: vi.fn() };
    const premier = new Classe({} as HlsConfig);
    premier.load(contexte, config, callbacks);
    const reponse = new Uint8Array([1, 2]).buffer;
    load.mock.calls[0]![2].onSuccess({ data: reponse }, { loading: { start: 1, end: 10 } }, contexte, null);
    const second = new Classe({} as HlsConfig);
    second.load(contexte, config, callbacks);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    expect(callbacks.onSuccess).toHaveBeenCalledTimes(2);
    const abandon = new Classe({} as HlsConfig);
    abandon.load(contexte, config, callbacks);
    abandon.destroy();
    await Promise.resolve();
    expect(callbacks.onSuccess).toHaveBeenCalledTimes(2);
  });
});
