import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "./database.js";
import {
  OUBLI_JOURS, SEUIL_QUARANTAINE, clearCodecQuarantine, listCodecQuarantine,
  quarantinedCodecs, recordCodecFailure, withoutQuarantined,
} from "./codec-quarantine.js";

/**
 * Codec annoncé mais défaillant — cas limite nommé au dossier de l'étape 56.
 *
 * Un appareil déclare ce qu'il sait décoder, et le serveur le croit : c'est ce qui permet la lecture
 * directe, sans conversion. Mais la déclaration ment parfois — un téléviseur annonce HEVC que son
 * décodeur refuse au-delà d'un profil, une box annonce AV1 sans matériel derrière.
 *
 * Sans mémoire, l'erreur se répète à **chaque** lecture. C'est le défaut qui use le plus vite la
 * patience, précisément parce qu'il se reproduit à l'identique.
 */

const appareils: string[] = [];

/** Un identifiant d'appareil neuf, nettoyé en fin de test. */
function appareil(): string {
  const id = `appareil-${randomUUID()}`;
  appareils.push(id);
  return id;
}

afterEach(() => {
  for (const id of appareils.splice(0)) clearCodecQuarantine(id);
});

describe("mémoire des échecs", () => {
  it("ne punit pas un échec isolé", () => {
    // Un fichier abîmé, un réseau qui lâche, un appareil qui se met en veille : rien de tout cela ne
    // prouve que le décodeur est en cause. Priver de lecture directe dès le premier échec coûterait
    // plus que d'attendre la confirmation.
    const id = appareil();
    expect(recordCodecFailure(id, "hevc")).toBe(1);
    expect(quarantinedCodecs(id)).toEqual([]);
  });

  it("cesse de proposer le codec au second échec", () => {
    const id = appareil();
    recordCodecFailure(id, "hevc");
    expect(recordCodecFailure(id, "hevc")).toBe(SEUIL_QUARANTAINE);
    expect(quarantinedCodecs(id)).toEqual(["hevc"]);
  });

  it("garde chaque appareil séparé", () => {
    // Le même codec peut être parfait sur le téléviseur du salon et défaillant sur la tablette : une
    // mémoire commune ferait payer à tous le défaut d'un seul.
    const salon = appareil();
    const tablette = appareil();
    recordCodecFailure(tablette, "av1");
    recordCodecFailure(tablette, "av1");
    expect(quarantinedCodecs(tablette)).toEqual(["av1"]);
    expect(quarantinedCodecs(salon)).toEqual([]);
  });

  it("oublie un échec devenu trop ancien plutôt que de l'additionner", () => {
    // Deux pannes séparées de plusieurs mois ne valent pas un défaut permanent. Sans cet oubli, un
    // appareil finirait mis en quarantaine par accumulation d'accidents sans rapport.
    const id = appareil();
    recordCodecFailure(id, "vp9");
    db.prepare(`UPDATE device_codec_failures SET last_failure_at = datetime('now', ?)
      WHERE device_id = ? AND codec = ?`).run(`-${OUBLI_JOURS + 1} days`, id, "vp9");
    expect(recordCodecFailure(id, "vp9"), "le compteur repart de un").toBe(1);
    expect(quarantinedCodecs(id)).toEqual([]);
  });

  it("relâche une quarantaine devenue trop ancienne", () => {
    // Une mise à jour du micrologiciel corrige les décodeurs : une quarantaine définitive
    // condamnerait l'appareil à convertir pour toujours.
    const id = appareil();
    recordCodecFailure(id, "hevc");
    recordCodecFailure(id, "hevc");
    db.prepare(`UPDATE device_codec_failures SET last_failure_at = datetime('now', ?)
      WHERE device_id = ?`).run(`-${OUBLI_JOURS + 1} days`, id);
    expect(quarantinedCodecs(id)).toEqual([]);
  });

  it("accepte un démenti immédiat", () => {
    // Une lecture directe réussie prouve que le codec fonctionne : inutile d'attendre l'oubli.
    const id = appareil();
    recordCodecFailure(id, "hevc");
    recordCodecFailure(id, "hevc");
    clearCodecQuarantine(id, "hevc");
    expect(quarantinedCodecs(id)).toEqual([]);
  });

  it("normalise la casse du codec", () => {
    const id = appareil();
    recordCodecFailure(id, "HEVC");
    recordCodecFailure(id, "hevc");
    expect(quarantinedCodecs(id)).toEqual(["hevc"]);
  });

  it("ignore un appareil ou un codec vide plutôt que d'enregistrer du bruit", () => {
    expect(recordCodecFailure("", "hevc")).toBe(0);
    expect(recordCodecFailure("appareil-valide-123", "")).toBe(0);
  });
});

describe("filtrage des codecs proposés", () => {
  it("retire le codec mis en quarantaine", () => {
    const id = appareil();
    recordCodecFailure(id, "hevc");
    recordCodecFailure(id, "hevc");
    expect(withoutQuarantined(["h264", "hevc", "av1"], id)).toEqual(["h264", "av1"]);
  });

  it("ne touche à rien pour un appareil inconnu", () => {
    expect(withoutQuarantined(["h264", "hevc"], appareil())).toEqual(["h264", "hevc"]);
    expect(withoutQuarantined(["h264", "hevc"], null)).toEqual(["h264", "hevc"]);
  });

  it("rend la liste d'origine plutôt que de la vider entièrement", () => {
    // Un appareil sans aucun codec ne pourrait plus rien lire, et le serveur convertirait vers un
    // format qu'il vient lui-même de déclarer impossible. Mieux vaut réessayer que garantir l'échec.
    const id = appareil();
    for (const codec of ["h264", "hevc"]) { recordCodecFailure(id, codec); recordCodecFailure(id, codec); }
    expect(withoutQuarantined(["h264", "hevc"], id)).toEqual(["h264", "hevc"]);
  });
});

describe("état lisible", () => {
  it("rapporte l'appareil, le codec, le compte et la raison", () => {
    const id = appareil();
    recordCodecFailure(id, "hevc", "MediaCodec: erreur de configuration");
    const ligne = listCodecQuarantine().find((entree) => entree.deviceId === id);
    expect(ligne?.codec).toBe("hevc");
    expect(ligne?.failures).toBe(1);
    expect(ligne?.reason).toContain("MediaCodec");
  });
});
