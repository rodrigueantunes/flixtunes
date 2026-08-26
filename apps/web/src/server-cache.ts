import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Cache d'état serveur, affiché immédiatement puis réconcilié — exigence d'architecture de l'étape 55.
 *
 * Les pages du catalogue sont démontées dès qu'on change de vue : revenir sur Films retéléchargeait
 * tout, écran de chargement compris, et perdait la position de défilement comme les pages déjà
 * parcourues. Sur une médiathèque de deux mille films, cette attente revient à chaque aller-retour.
 *
 * Le principe tient en une phrase : **montrer tout de suite ce qu'on sait, vérifier ensuite**. Une
 * valeur déjà connue s'affiche sans délai et sans indicateur de chargement ; la requête part malgré
 * tout en arrière-plan, et ne remplace l'affichage que si le serveur répond autre chose.
 *
 * Rien n'est ajouté comme dépendance : une bibliothèque de cache apporterait ici bien plus que ce
 * qu'on lui demande, et l'installation de ce dépôt est trop fragile pour qu'on l'alourdisse.
 *
 * Ce cache ne survit pas au rechargement de la page. C'est délibéré : il accélère la navigation à
 * l'intérieur d'une session, il n'a pas à décider ce qui reste vrai d'une session à l'autre.
 */

interface Entree<T> { valeur: T; ecritLe: number; }

const entrees = new Map<string, Entree<unknown>>();

/** Durée au-delà de laquelle une valeur n'est plus affichée sans avoir été revérifiée. */
const PEREMPTION_MS = 5 * 60 * 1000;

/** La valeur connue pour cette clé, si elle n'est pas périmée. */
export function lireCache<T>(cle: string): T | undefined {
  const entree = entrees.get(cle) as Entree<T> | undefined;
  if (!entree) return undefined;
  if (Date.now() - entree.ecritLe > PEREMPTION_MS) { entrees.delete(cle); return undefined; }
  return entree.valeur;
}

/** Retient une valeur pour cette clé. */
export function ecrireCache<T>(cle: string, valeur: T): void {
  entrees.set(cle, { valeur, ecritLe: Date.now() });
}

/**
 * Oublie ce qui commence par ce préfixe, ou tout si aucun n'est donné.
 *
 * À appeler après une modification qui change ce que le serveur répondra : ajouter une bibliothèque,
 * corriger une correspondance, marquer un épisode vu. Sans cela, l'affichage montrerait l'état
 * d'avant jusqu'à ce que la réconciliation le rattrape — bref, mais visible.
 */
export function oublierCache(prefixe?: string): void {
  if (!prefixe) { entrees.clear(); return; }
  for (const cle of [...entrees.keys()]) if (cle.startsWith(prefixe)) entrees.delete(cle);
}

export interface EtatServeur<T> {
  /** La valeur connue : celle du cache d'abord, celle du serveur ensuite. */
  donnees: T | undefined;
  /** Vrai seulement quand rien n'est encore connu : une valeur en cache ne fait jamais patienter. */
  chargement: boolean;
  /** Vrai pendant qu'une valeur déjà affichée est revérifiée en arrière-plan. */
  reconciliation: boolean;
  erreur: string | null;
  /** Relance la requête en gardant la valeur affichée. */
  rafraichir: () => void;
}

/**
 * Lit un état serveur : d'abord le cache, puis le serveur.
 *
 * `cle` doit décrire exactement ce qui est demandé — profil compris. Deux profils ne voient pas les
 * mêmes progressions ; partager leur cache les mélangerait.
 */
export function useEtatServeur<T>(cle: string | null, charger: () => Promise<T>): EtatServeur<T> {
  const chargerRef = useRef(charger);
  chargerRef.current = charger;

  const [donnees, setDonnees] = useState<T | undefined>(() => (cle ? lireCache<T>(cle) : undefined));
  const [reconciliation, setReconciliation] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [demande, setDemande] = useState(0);

  useEffect(() => {
    if (!cle) { setDonnees(undefined); return; }
    // Le passage d'une clé à l'autre montre aussitôt ce qu'on sait de la nouvelle, sans laisser
    // l'ancienne à l'écran : afficher les films sur l'onglet des séries serait pire qu'attendre.
    const connu = lireCache<T>(cle);
    setDonnees(connu);
    setErreur(null);
    setReconciliation(true);

    let abandonne = false;
    chargerRef.current().then((valeur) => {
      if (abandonne) return;
      ecrireCache(cle, valeur);
      setDonnees(valeur);
      setReconciliation(false);
    }).catch((cause: unknown) => {
      if (abandonne) return;
      // Une valeur déjà affichée n'est pas retirée pour autant : périmée vaut mieux que vide, et
      // l'erreur reste signalée à côté.
      setErreur(cause instanceof Error ? cause.message : "Chargement impossible");
      setReconciliation(false);
    });
    return () => { abandonne = true; };
  }, [cle, demande]);

  const rafraichir = useCallback(() => setDemande((valeur) => valeur + 1), []);

  return { donnees, chargement: donnees === undefined && reconciliation, reconciliation, erreur, rafraichir };
}
