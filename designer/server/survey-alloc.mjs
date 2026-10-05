// survey-alloc.mjs — the browser's best-worst → 100-point conversion, extracted
// as a pure, importable module so the frozen "browser computes sum-100" clause is
// machine-checked in node (test_survey_server.mjs) AND is the single source the
// browser (survey.js) imports. No DOM, no dependencies.

// Fixed rank→weight template for six ranked axes. Sums to exactly 100 by
// construction, so any full 6-axis ranking yields sum-100 integer weights.
export const TRADEOFF_TEMPLATE = [30, 24, 19, 14, 9, 4];

/** ranking: axis ids ordered best (most important) → worst. → { axis: weight }. */
export function weightsFromRanking(ranking) {
  const weights = {};
  ranking.forEach((axis, i) => { weights[axis] = TRADEOFF_TEMPLATE[i] ?? 0; });
  return weights;
}

/**
 * The "one you would never sacrifice" defaults to the TOP of the ranking — the
 * axis the user ranked MOST important — not the least (that inversion was
 * audit finding f1). The user can still override via the confirm chips.
 */
export function neverSacrificeDefault(ranking) {
  return ranking[0] ?? null;
}
