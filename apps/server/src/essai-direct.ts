/**
 * La lecture directe est le défaut. Le reste est un repli.
 *
 * Le serveur ne teste jamais ce qu'un appareil sait décoder : il le lui demande, et il le croit.
 * Cette confiance est mal placée bien plus souvent qu'on ne le pensait — aucun navigateur ne déclare
 * le conteneur Matroska que plusieurs lisent, `decodingInfo` doute de la fluidité d'un HEVC 4K décodé
 * en matériel, et une marge de sécurité sur le débit refuse un fichier que le réseau porte sans peine.
 * Chaque refus faux envoie vers le chemin le plus coûteux du serveur un film qui se lisait gratuitement.
 *
 * La règle est donc simple, et c'est celle qui a été demandée : **on tente, et si ça ne marche pas on
 * convertit.** L'échec se rattrape — erreur du lecteur, images perdues, coupures répétées — et chacun
 * de ces trois signaux est déjà mesuré ailleurs.
 *
 * ## Ce qui reste refusé, et pourquoi ce n'est pas une exception à la règle
 *
 * Une seule famille de cas, et elle ne relève pas de « ça pourrait ne pas marcher » mais de « la
 * lecture directe ne peut structurellement pas le faire ». Y aller quand même ne serait pas un essai :
 * ce serait ignorer un réglage posé, sans le dire.
 *
 * | Refus | Raison |
 * |---|---|
 * | Sous-titres à incruster | le fichier part tel quel, les sous-titres n'y sont pas incrustés |
 * | Traitement audio demandé | normalisation et mode nuit se font à l'encodage, nulle part ailleurs |
 * | Piste audio choisie à la main | le fichier part entier, et le lecteur joue celle par défaut |
 * | Codec audio non décodable | un film muet ne lève aucune erreur et rien ne le rattrape |
 * | Plafond de définition réglé | un réglage expert est une consigne, pas une annonce prudente |
 * | Codec en quarantaine | il a déjà échoué deux fois ici : la question est tranchée |
 * | Débit au-dessus du plafond de coupures | deux coupures réelles l'ont déjà établi |
 *
 * Deux de ces lignes méritent un mot, parce qu'elles ont d'abord été écrites plus larges.
 *
 * **Le débit ne refuse plus sur une estimation.** La négociation appliquait un coussin de vingt pour
 * cent à la bande passante mesurée, ce qui refusait un fichier de 26,5 Mb/s sur un chemin de 29,4 que
 * ce chemin portait sans peine. Pire, cette mesure est relevée par hls.js **pendant la session en
 * cours** : pendant une conversion, elle mesure la vitesse de l'encodeur et non celle du réseau. Le
 * garde-fou se nourrissait donc de ce qu'il causait — on convertit, c'est lent, donc on convertit.
 * Ne subsiste que le plafond né de deux coupures réelles pendant une lecture réelle.
 *
 * **Le nombre de canaux ne refuse rien.** `maxAudioChannels` décrit la sortie de l'appareil, pas son
 * décodeur : un lecteur qui décode une piste huit canaux la mixe lui-même vers la stéréo, exactement
 * comme le ferait le serveur. Le compter comme une incompatibilité envoyait en conversion complète
 * tous les films dont la piste principale est en 5.1 ou 7.1, c'est-à-dire presque tous.
 */

/** Ce qui s'oppose à la lecture directe, tel que la négociation l'a constaté. */
export interface ConstatDirect {
  /**
   * La définition des pistes est rangée après les données, et ce lecteur analyse le flux linéairement.
   *
   * Il atteindra les données sans savoir quoi en faire : image noire, aucun son, aucune avance
   * rapide, et aucune erreur pour le dire.
   */
  entetesEnFinDeFichier: boolean;
  /** Des sous-titres doivent être incrustés dans l'image. */
  sousTitresAIncruster: boolean;
  /** Normalisation, mode nuit ou conversion audio explicitement demandées. */
  traitementAudioDemande: boolean;
  /**
   * Une piste audio a été **choisie explicitement**, et ce n'est pas celle du fichier.
   *
   * La nuance compte, et elle a coûté un aller-retour. Une préférence de langue est un souhait : si le
   * fichier ne la place pas en piste par défaut, la lecture directe jouera l'autre, ce qui s'entend et
   * se corrige. Un choix posé à la main dans le sélecteur de pistes est une consigne : la contredire
   * en silence n'est pas un essai, c'est ignorer ce qu'on vient de demander.
   */
  pisteAudioImposee: boolean;
  /** La définition tient sous le plafond annoncé. */
  definitionCompatible: boolean;
  /** Ce plafond vient d'un réglage explicite, non d'une sonde du client. */
  plafondDefinitionChoisi: boolean;
  /**
   * Le codec audio est décodable tel quel.
   *
   * C'est le dernier désaccord de capacité qui refuse encore, et il a été retiré puis remis — le
   * retrait a été démenti par l'usage en une lecture. Un DTS servi à un navigateur qui ne le décode
   * pas ne lève ni erreur ni compteur : l'image se déroule normalement et il n'y a simplement pas de
   * son. Aucun des trois signaux sur lesquels repose la règle ne le voit, et personne ne le rattrape.
   *
   * Le refus coûte d'ailleurs peu : l'alternative n'est pas le transcodage mais le remux, qui copie
   * l'image au bit près et ne convertit que la piste sonore.
   */
  codecAudioDecodable: boolean;
  /** Le codec vidéo a déjà échoué deux fois sur cet appareil. */
  codecEnQuarantaine: boolean;
  /**
   * La source tient sous le plafond que le lecteur s'impose après avoir constaté des coupures.
   *
   * Ce plafond est le seul chiffre de débit qui constate un fait. Le débit « mesuré » n'en est pas
   * un : il est relevé par hls.js pendant la session en cours, et pendant une session **convertie** il
   * mesure la vitesse de l'encodeur, non celle du réseau. S'en servir pour refuser la lecture directe
   * fermait un cercle — on convertit, c'est lent, donc le réseau est déclaré insuffisant, donc on
   * convertit — où le garde-fou se nourrissait de ce qu'il causait.
   *
   * Le plafond de coupures, lui, ne s'établit qu'après deux interruptions réelles pendant une lecture
   * réelle. C'est exactement le « si ça ne marche pas » de la règle, appliqué au débit.
   */
  debitSousLePlafondConstate: boolean;
}

/** Le verdict, et ce qui l'a motivé — la raison est affichée dans le panneau de diagnostic. */
export interface VerdictEssaiDirect {
  tenter: boolean;
  motif: string;
}

/**
 * Faut-il servir le fichier tel quel malgré ce que le client a déclaré ?
 *
 * La réponse est oui, sauf pour ce que la lecture directe ne peut pas faire. Fonction pure : elle
 * s'éprouve sans serveur, sans base et sans fichier.
 */
export function essaiDirectPertinent(constat: ConstatDirect): VerdictEssaiDirect {
  // La quarantaine passe avant tout : elle ne consigne pas une supposition mais deux échecs constatés
  // sur cet appareil. C'est la seule information du lot qui vaille mieux qu'une déclaration, et elle
  // interdit de reproduire une erreur déjà payée deux fois.
  // Le pari ne se tient que sur des échecs qui se voient. Celui-ci ne se voit pas : un lecteur
  // linéaire qui ne trouve pas la définition des pistes joue une image noire, sans son et sans avance
  // rapide, et ne lève aucune erreur — ni quarantaine, ni repli, rien à quoi se raccrocher. C'est
  // exactement le mode de panne que la note ci-dessous réserve au film muet, et il en existe donc
  // deux. Constaté le 25 août 2026 sur deux séries dont les pistes tiennent dans les derniers octets.
  if (constat.entetesEnFinDeFichier) {
    return { tenter: false, motif: "Pistes définies en fin de fichier : l'échec y serait muet" };
  }

  if (constat.codecEnQuarantaine) {
    return { tenter: false, motif: "Codec déjà défaillant sur cet appareil" };
  }

  // Ce que la personne a demandé et que le fichier servi tel quel ne peut pas rendre.
  if (constat.sousTitresAIncruster) {
    return { tenter: false, motif: "Sous-titres à incruster : le fichier tel quel ne les porte pas" };
  }
  if (constat.traitementAudioDemande) {
    return { tenter: false, motif: "Traitement audio demandé : il n'existe qu'à l'encodage" };
  }
  if (constat.pisteAudioImposee) {
    return { tenter: false, motif: "Piste audio choisie à la main : le direct jouerait celle du fichier" };
  }
  if (!constat.definitionCompatible && constat.plafondDefinitionChoisi) {
    return { tenter: false, motif: "Plafond de définition demandé dans les réglages" };
  }

  // Un film muet ne lève aucune erreur, n'use aucun compteur, et rien ne le rattrape : c'est le seul
  // échec qui échappe aux trois signaux sur lesquels repose toute la règle.
  if (!constat.codecAudioDecodable) {
    return { tenter: false, motif: "Codec audio non décodable : un film muet n'a pas de repli" };
  }

  // Le seul refus de débit qui subsiste porte sur un plafond né de coupures constatées. L'estimation
  // de bande passante, elle, ne refuse plus rien : pendant une conversion elle mesure l'encodeur.
  if (!constat.debitSousLePlafondConstate) {
    return { tenter: false, motif: "Débit au-dessus du plafond posé après des coupures constatées" };
  }

  return { tenter: true, motif: "Essai de lecture directe avant toute conversion" };
}
