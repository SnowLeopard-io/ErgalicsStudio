// ==========================================================================
// Ergalics Studio — multiple-comparison correction
//
// When many tests are run, raw p-values must be adjusted to control the family
// -wise error rate (Bonferroni) or the false-discovery rate (Benjamini-
// Hochberg). Both return adjusted values plus a boolean significance mask at
// the chosen `alpha`.
// ==========================================================================

export interface CorrectionResult {
  /** Adjusted p-values (Bonferroni) or q-values (BH), aligned to input order. */
  adjusted: number[];
  /** True where the adjusted value is below `alpha`. */
  significant: boolean[];
}

/** Bonferroni: multiply each p by the number of tests (capped at 1). */
export function bonferroni(pvals: number[], alpha = 0.05): CorrectionResult {
  const m = pvals.length;
  const adjusted = pvals.map((p) => Math.min(1, p * m));
  return { adjusted, significant: adjusted.map((a) => a <= alpha) };
}

/**
 * Benjamini-Hochberg FDR control. Sorts ascending, computes q_i = p_i * m / i,
 * then enforces monotonicity from the largest (step-up). Returns q-values and
 * the significance mask at `alpha`.
 */
export function benjaminiHochberg(pvals: number[], alpha = 0.05): CorrectionResult {
  const m = pvals.length;
  const order = [...pvals.keys()].sort((a, b) => pvals[a]! - pvals[b]!);
  const q = new Array<number>(m).fill(0);
  let prev = 0;
  for (let k = 0; k < m; k += 1) {
    const i = order[k]!;
    const val = (pvals[i]! * m) / (k + 1);
    const qq = Math.max(val, prev);
    q[i] = qq;
    prev = qq;
  }
  return { adjusted: q, significant: q.map((v) => v <= alpha) };
}
