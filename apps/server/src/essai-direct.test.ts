import { describe, expect, it } from "vitest";

import { type ConstatDirect, essaiDirectPertinent } from "./essai-direct.js";

/**
 * La lecture directe est le défaut ; ces cas fixent le très petit nombre d'exceptions.
 *
 * La première version de ce fichier en comptait sept, et c'était trop : elle refusait sur le HDR, sur
 * le nombre de canaux audio, sur une marge de sécurité de débit — autant de choses que la lecture
 * directe sait faire, ou dont l'échec se rattrape. Un film qui se lisait sans peine partait en
 * conversion 4K, et il fallait cliquer « Essayer en direct » à chaque fois.
 *
 * Ne restent que les cas où servir le fichier tel quel ne serait pas un essai mais l'abandon
 * silencieux d'un réglage posé, ou un échec qu'aucun signal ne rattrape.
 */
function constat(modifications: Partial<ConstatDirect> = {}): ConstatDirect {
  return {
    entetesEnFinDeFichier: false,
    sousTitresAIncruster: false,
    traitementAudioDemande: false,
    pisteAudioImposee: false,
    codecAudioDecodable: true,
    definitionCompatible: true,
    plafondDefinitionChoisi: false,
    codecEnQuarantaine: false,
    debitSousLePlafondConstate: true,
    ...modifications,
  };
}

describe("la lecture directe est le défaut", () => {
  it("tente, même sur un constat où tout est en désaccord côté image", () => {
    // Conteneur non déclaré, définition au-dessus du plafond annoncé, HDR que l'appareil ne dit pas
    // gérer : rien de tout cela n'entre plus dans la décision. Ces désaccords viennent de déclarations
    // trop prudentes, et leur échec se voit — erreur du lecteur, images perdues, coupures.
    expect(essaiDirectPertinent(constat({ definitionCompatible: false })).tenter).toBe(true);
    expect(essaiDirectPertinent(constat()).tenter).toBe(true);
  });

  it("ne refuse plus sur une piste à plus de canaux que la sortie", () => {
    // `maxAudioChannels` décrit la sortie, pas le décodeur : le lecteur mixe huit canaux vers deux
    // comme le ferait le serveur. Ce refus envoyait en conversion tous les films en 5.1 ou 7.1.
    // Le constat n'a plus de champ pour cela — c'est le sujet de ce cas.
    expect(Object.keys(constat())).not.toContain("canauxCompatibles");
    expect(essaiDirectPertinent(constat({ codecAudioDecodable: true })).tenter).toBe(true);
  });
});

describe("ce que la lecture directe ne peut structurellement pas rendre", () => {
  it("refuse quand des sous-titres doivent être incrustés", () => {
    // Le fichier part tel quel : les sous-titres n'y sont pas incrustés, et leur absence ne lève
    // aucune erreur. Ce ne serait pas un essai, mais l'abandon d'un réglage posé.
    expect(essaiDirectPertinent(constat({ sousTitresAIncruster: true })).tenter).toBe(false);
  });

  it("refuse quand un traitement audio a été demandé", () => {
    // Normalisation et mode nuit se font à l'encodage, nulle part ailleurs.
    expect(essaiDirectPertinent(constat({ traitementAudioDemande: true })).tenter).toBe(false);
  });

  it("refuse quand une piste audio a été choisie à la main", () => {
    // Un choix posé dans le sélecteur est une consigne : le fichier partant entier, le lecteur jouerait
    // celle que le fichier désigne, et la contredire en silence n'est pas un essai.
    const verdict = essaiDirectPertinent(constat({ pisteAudioImposee: true }));
    expect(verdict.tenter).toBe(false);
    expect(verdict.motif).toContain("Piste audio");
  });

  it("ne refuse pas sur une simple préférence de langue", () => {
    // La distinction a coûté un aller-retour. Une préférence est un souhait, pas une consigne : si le
    // fichier ne place pas la piste française par défaut, la lecture directe jouera l'autre — ce qui
    // s'entend et se corrige. Refuser sur cette base condamnait au transcodage la plupart des fichiers
    // multipistes, c'est-à-dire presque tous.
    expect(essaiDirectPertinent(constat()).tenter).toBe(true);
  });

  it("refuse de passer outre un plafond de définition demandé dans les réglages", () => {
    // Un réglage expert est une consigne, pas une annonce prudente : servir du 4K à qui vient de
    // demander 1080p serait le contredire en silence.
    expect(essaiDirectPertinent(constat({ definitionCompatible: false, plafondDefinitionChoisi: true })).tenter)
      .toBe(false);
    // Sans réglage, la même définition redevient tentable : c'est bien la consigne qui bloque.
    expect(essaiDirectPertinent(constat({ definitionCompatible: false })).tenter).toBe(true);
  });
});

describe("les échecs que rien ne rattraperait", () => {
  it("refuse un codec audio que le lecteur ne décode pas", () => {
    // Ce refus a été retiré une fois, et l'usage l'a démenti en une lecture : un DTS servi à Chrome
    // donne une image normale et aucun son. Ni erreur, ni images perdues, ni coupure — aucun des trois
    // signaux sur lesquels repose la règle ne le voit.
    //
    // Il coûte peu, du reste : l'alternative n'est pas le transcodage mais le remux, qui copie l'image
    // au bit près et ne convertit que la piste sonore.
    const verdict = essaiDirectPertinent(constat({ codecAudioDecodable: false }));
    expect(verdict.tenter).toBe(false);
    expect(verdict.motif).toContain("muet");
  });

  it("refuse une source au-dessus du plafond posé après des coupures", () => {
    // Ce plafond ne s'établit qu'après deux interruptions réelles pendant une lecture réelle : c'est
    // le « si ça ne marche pas » de la règle, appliqué au débit.
    const verdict = essaiDirectPertinent(constat({ debitSousLePlafondConstate: false }));
    expect(verdict.tenter).toBe(false);
    expect(verdict.motif).toContain("coupures constatées");
  });

  it("ne refuse plus sur une estimation de bande passante", () => {
    // L'estimation est relevée par hls.js pendant la session en cours : pendant une conversion, elle
    // mesure la vitesse de l'encodeur et non celle du réseau. S'en servir fermait un cercle — on
    // convertit, c'est lent, donc le réseau est déclaré insuffisant, donc on convertit. Le constat
    // n'a plus de champ pour elle, et c'est le sujet de ce cas.
    expect(Object.keys(constat())).not.toContain("debitTientDansLaMesure");
    expect(essaiDirectPertinent(constat()).tenter).toBe(true);
  });
});

describe("mémoire des échecs", () => {
  it("ne retente pas un codec déjà mis en quarantaine", () => {
    // Deux échecs constatés sur cet appareil valent mieux que n'importe quelle déclaration. C'est
    // exactement le « si ça ne marche pas alors on convertit » appliqué à la lecture suivante.
    const verdict = essaiDirectPertinent(constat({ codecEnQuarantaine: true }));
    expect(verdict.tenter).toBe(false);
    expect(verdict.motif).toContain("déjà défaillant");
  });

  it("fait passer la quarantaine avant tout autre motif", () => {
    expect(essaiDirectPertinent(constat({ sousTitresAIncruster: true, codecEnQuarantaine: true })).motif)
      .toContain("déjà défaillant");
  });
});
