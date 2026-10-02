import { afterEach, expect, it, vi } from "vitest";
import { TransportDlna } from "./diffusion-dlna.js";
import { descriptionDlna } from "./diffusion-reseau.js";
import type { EtatDiffusion } from "@flixtunes/contracts";

afterEach(() => vi.unstubAllGlobals());
it("accepte le lecteur DLNA imbriqué et sa base tout en refusant une autre adresse", () => {
  const xml = '<root><URLBase>http://10.0.0.2:8080/services/</URLBase><device><deviceType>box</deviceType><deviceList><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>TV &amp; salon</friendlyName><UDN>uuid:tv</UDN><serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>control?a=1&amp;b=2</controlURL></service></serviceList></device></deviceList></device></root>';
  expect(descriptionDlna(xml, "http://10.0.0.2/root.xml", "10.0.0.2")).toMatchObject({ nom: "TV & salon", transport: { url: "http://10.0.0.2:8080/services/control?a=1&b=2" } });
  expect(() => descriptionDlna(xml.replace("10.0.0.2:8080", "10.0.0.3:8080"), "http://10.0.0.2/root.xml", "10.0.0.2")).toThrow();
});
it("confirme la lecture malgré GetPositionInfo absent et attend PLAYING avant Seek", async () => {
  const actions: string[] = [], etats: Partial<EtatDiffusion>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    const action = options.headers.SOAPAction.split("#")[1].replace('"', ''); actions.push(action);
    if (action === "GetPositionInfo") return new Response('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><detail><UPnPError><errorCode>701</errorCode></UPnPError></detail></s:Fault></s:Body></s:Envelope>', { status: 500 });
    const contenu = action === "GetTransportInfo" ? "<CurrentTransportState>PLAYING</CurrentTransportState>" : "";
    return new Response(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">${contenu}</u:${action}Response></s:Body></s:Envelope>`);
  }));
  const t = new TransportDlna({ id: "tv", nom: "TV", protocole: "dlna", adresse: "10.0.0.2", port: 80, vu: 0, transport: { url: "http://10.0.0.2/control", type: "urn:schemas-upnp-org:service:AVTransport:1" } }, (e) => etats.push(e));
  try {
    await t.charger("http://10.0.0.1/video.mp4", "video/mp4", "Été", false, 40);
    expect(etats.at(-1)?.lecture).toBe("lecture");
    expect(actions.indexOf("Seek")).toBeGreaterThan(actions.indexOf("GetTransportInfo"));
    expect(etats.at(-1)?.navigation).toBe(false);
  } finally { t.fermer(); }
});
