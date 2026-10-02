import { afterAll, beforeAll, expect, it } from "vitest";
import { buildApp } from "./app.js";

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app?.close(); });
it("autorise les requêtes Range du récepteur uniquement sur un accès de média cast", async () => {
  const headers = { origin: "https://www.gstatic.com", "access-control-request-method": "GET", "access-control-request-headers": "range" };
  const r = await app.inject({ method: "OPTIONS", url: `/api/diffusion/flux/${"a".repeat(64)}/media.mp4`, headers });
  expect(r.statusCode).toBe(204);
  expect(r.headers["access-control-allow-origin"]).toBe("*");
  expect(r.headers["access-control-allow-credentials"]).toBeUndefined();
  const prive = await app.inject({ method: "OPTIONS", url: "/api/diffusion/cibles", headers });
  expect(prive.headers["access-control-allow-origin"]).toBeUndefined();
});
it("conserve les origines LAN des routes habituelles", async () => {
  const r = await app.inject({ method: "OPTIONS", url: "/api/profiles", headers: { origin: "http://10.20.30.254:4000", "access-control-request-method": "GET" } });
  expect(r.headers["access-control-allow-origin"]).toBe("http://10.20.30.254:4000");
});
