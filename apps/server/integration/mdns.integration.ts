import { Bonjour } from "bonjour-service";

process.env.PORT = process.env.PORT ?? "4110";
process.env.FLIXTUNES_MDNS = "1";
process.env.FLIXTUNES_WATCH = "0";
const [{ buildApp }, { startRuntimeServices }, { config }] = await Promise.all([
  import("../src/app.js"), import("../src/runtime-services.js"), import("../src/config.js"),
]);
const app = await buildApp(); await app.listen({ host: "0.0.0.0", port: config.port });
const runtime = startRuntimeServices(app.log); const discovery = new Bonjour();
try {
  const service = await new Promise<{ name: string; port: number }>((resolve, reject) => {
    const browser = discovery.find({ type: "flixtunes", protocol: "tcp" }, (found) => {
      if (found.port === config.port) { browser.stop(); resolve({ name: found.name, port: found.port }); }
    });
    setTimeout(() => { browser.stop(); reject(new Error("Service _flixtunes._tcp non découvert")); }, 8000).unref();
  });
  if (!service.name.startsWith("FlixTunes (")) throw new Error(`Nom inattendu: ${service.name}`);
  console.log(`mDNS OK: ${service.name} sur ${service.port}`);
} finally { discovery.destroy(); await runtime.close(); await app.close(); }
