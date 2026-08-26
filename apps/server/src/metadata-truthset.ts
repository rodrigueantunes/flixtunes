import type { MetadataSearchCandidate } from "@flixtunes/contracts";
import { MATCH_THRESHOLDS, scoreMetadataMatch, type MatchEvidence } from "./match-engine.js";

/**
 * Jeu de vérité de la fédération de métadonnées — étape 52.
 *
 * Il mesure la correspondance hors ligne : aucun appel réseau, des candidats fournisseurs figés jouant le
 * rôle des réponses d'API. Les titres sont inventés ou génériques. Le but n'est pas de vérifier qu'un
 * fournisseur répond, mais que FlixTunes retient la bonne réponse et refuse les mauvaises.
 */

export interface TruthCase {
  id: string;
  kind: "movie" | "tv" | "documentary";
  /** Ce que la détection de fichiers a produit. */
  source: MatchEvidence;
  /** Réponses simulées d'un fournisseur, dans l'ordre où elles arriveraient. */
  candidates: MetadataSearchCandidate[];
  /** Identifiant attendu, ou null si aucune réponse ne doit être retenue automatiquement. */
  expected: string | null;
  note?: string;
}

function candidate(over: Partial<MetadataSearchCandidate> & Pick<MetadataSearchCandidate, "externalId" | "title">): MetadataSearchCandidate {
  return {
    provider: "tmdb", kind: "movie", originalTitle: null, year: null, overview: null, posterUrl: null, score: 0, ...over,
  };
}

export const truthSet: TruthCase[] = [
  {
    id: "film-exact",
    kind: "movie",
    source: { title: "Voyage Azur", year: 2019 },
    candidates: [candidate({ externalId: "1", title: "Voyage Azur", year: 2019 })],
    expected: "1",
  },
  {
    id: "film-homonyme-annee-differente",
    kind: "movie",
    source: { title: "Nuit Blanche", year: 2021 },
    candidates: [
      candidate({ externalId: "ancien", title: "Nuit Blanche", year: 1984 }),
      candidate({ externalId: "recent", title: "Nuit Blanche", year: 2021 }),
    ],
    expected: "recent",
    note: "Deux remakes homonymes : seule l'année les sépare.",
  },
  {
    id: "film-annee-voisine",
    kind: "movie",
    source: { title: "Ciel de Fer", year: 2011 },
    candidates: [candidate({ externalId: "42", title: "Ciel de Fer", year: 2012 })],
    expected: "42",
    note: "Un an d'écart est courant entre sortie festival et sortie salle.",
  },
  {
    id: "film-annee-eloignee-refusee",
    kind: "movie",
    source: { title: "Ciel de Fer", year: 2011 },
    candidates: [candidate({ externalId: "mauvais", title: "Ciel de Fer", year: 1975 })],
    expected: null,
    note: "Trente-six ans d'écart : la correspondance doit passer en revue, pas être appliquée seule.",
  },
  {
    id: "film-titre-original",
    kind: "movie",
    source: { title: "L'Élève", originalTitle: "The Student", year: 2016 },
    candidates: [candidate({ externalId: "7", title: "The Student", originalTitle: "The Student", year: 2016 })],
    expected: "7",
  },
  {
    id: "film-identifiant-croise",
    kind: "movie",
    source: { title: "Titre totalement différent", year: 1999, externalIds: { tmdb: "550" } },
    candidates: [candidate({ externalId: "550", title: "Autre Chose", year: 2005 })],
    expected: "550",
    note: "Un identifiant explicite prime sur toute ressemblance de titre.",
  },
  {
    id: "film-titre-sans-rapport-refuse",
    kind: "movie",
    source: { title: "Voyage Azur", year: 2019 },
    candidates: [candidate({ externalId: "hors-sujet", title: "Le Dernier Rivage", year: 2019 })],
    expected: null,
    note: "Un titre sans rapport ne doit jamais être retenu au seul motif que l'année concorde.",
  },
  {
    id: "serie-relancee",
    kind: "tv",
    source: { title: "Les Veilleurs", year: 2022 },
    candidates: [
      candidate({ provider: "tvmaze", kind: "tv", externalId: "origine", title: "Les Veilleurs", year: 1998 }),
      candidate({ provider: "tvmaze", kind: "tv", externalId: "relance", title: "Les Veilleurs", year: 2022 }),
    ],
    expected: "relance",
    note: "Série relancée sous le même titre : l'année départage.",
  },
  {
    id: "serie-accent-et-casse",
    kind: "tv",
    source: { title: "L'ECHO DES CIMES", year: 2020 },
    candidates: [candidate({ provider: "tvmaze", kind: "tv", externalId: "9", title: "L'Écho des Cimes", year: 2020 })],
    expected: "9",
    note: "Accents et casse ne doivent pas empêcher la correspondance.",
  },
  {
    id: "documentaire-titre-long",
    kind: "documentary",
    source: { title: "Les Trois Rivières", year: 2010 },
    candidates: [candidate({ externalId: "doc", title: "Les Trois Rivières", year: 2010 })],
    expected: "doc",
  },
  {
    id: "aucun-resultat",
    kind: "movie",
    source: { title: "Média introuvable", year: 2024 },
    candidates: [],
    expected: null,
    note: "Un fournisseur sans résultat ne doit produire aucune correspondance, pas un choix par défaut.",
  },
  {
    id: "annee-absente-des-deux-cotes",
    kind: "movie",
    source: { title: "Nuit Blanche" },
    candidates: [candidate({ externalId: "sans-annee", title: "Nuit Blanche" })],
    expected: "sans-annee",
    note: "Sans année de part et d'autre, le titre exact suffit.",
  },
];

export interface FederationMetrics {
  total: number;
  /** Cas où l'identifiant attendu a été retenu automatiquement. */
  matched: number;
  /** Cas où un identifiant a été retenu automatiquement alors qu'il ne fallait pas, ou le mauvais. */
  falsePositives: number;
  /** Cas correctement laissés sans correspondance automatique. */
  correctlyAbstained: number;
  coverage: number;
  falsePositiveRate: number;
  details: Array<{ id: string; expected: string | null; chosen: string | null; status: string; score: number; ok: boolean }>;
}

/** Retient le meilleur candidat s'il dépasse le seuil d'application automatique. */
export function bestAutomaticMatch(testCase: TruthCase): { id: string | null; status: string; score: number } {
  const scored = testCase.candidates
    .map((entry) => ({ entry, decision: scoreMetadataMatch(testCase.source, entry) }))
    .sort((left, right) => right.decision.score - left.decision.score);
  const best = scored[0];
  if (!best) return { id: null, status: "aucun-resultat", score: 0 };
  return {
    id: best.decision.score >= MATCH_THRESHOLDS.automatic ? best.entry.externalId : null,
    status: best.decision.status, score: best.decision.score,
  };
}

export function evaluateTruthSet(cases: TruthCase[] = truthSet): FederationMetrics {
  const details: FederationMetrics["details"] = [];
  let matched = 0; let falsePositives = 0; let correctlyAbstained = 0;
  for (const testCase of cases) {
    const best = bestAutomaticMatch(testCase);
    const ok = best.id === testCase.expected;
    if (testCase.expected === null) {
      if (best.id === null) correctlyAbstained += 1; else falsePositives += 1;
    } else if (ok) matched += 1;
    else if (best.id !== null) falsePositives += 1;
    details.push({ id: testCase.id, expected: testCase.expected, chosen: best.id, status: best.status, score: best.score, ok });
  }
  const expectedMatches = cases.filter((entry) => entry.expected !== null).length;
  return {
    total: cases.length, matched, falsePositives, correctlyAbstained,
    coverage: expectedMatches ? matched / expectedMatches : 1,
    falsePositiveRate: cases.length ? falsePositives / cases.length : 0,
    details,
  };
}
