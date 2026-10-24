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

/**
 * Clamp a raw p-value into [0, 1]. NaN/Infinity become 1 (never significant)
 * rather than poisoning every adjusted value downstream.
 */
function sanitizeP(p: number): number {
  if (!Number.isFinite(p)) return 1;
  if (p < 0) return 0;
  if (p > 1) return 1;
  return p;
}

/** Bonferroni: multiply each p by the number of tests (capped at 1). */
export function bonferroni(pvals: number[], alpha = 0.05): CorrectionResult {
  const m = pvals.length;
  const adjusted = pvals.map((p) => Math.min(1, sanitizeP(p) * m));
  return { adjusted, significant: adjusted.map((a) => a <= alpha) };
}

/**
 * Benjamini-Hochberg FDR control. Sorts ascending, computes q_i = p_i * m / i,
 * then enforces monotonicity from the largest (step-up). Returns q-values and
 * the significance mask at `alpha`.
 */
export function benjaminiHochberg(pvals: number[], alpha = 0.05): CorrectionResult {
  const m = pvals.length;
  // Sanitize first: NaN would otherwise make the sort comparator inconsistent
  // and propagate NaN through every q-value it touches.
  const p = pvals.map(sanitizeP);
  const order = [...p.keys()].sort((a, b) => p[a]! - p[b]!);
  const q = new Array<number>(m).fill(0);
  let prev = 0;
  for (let k = 0; k < m; k += 1) {
    const i = order[k]!;
    const val = (p[i]! * m) / (k + 1);
    const qq = Math.max(val, prev);
    q[i] = qq;
    prev = qq;
  }
  return { adjusted: q, significant: q.map((v) => v <= alpha) };
}
