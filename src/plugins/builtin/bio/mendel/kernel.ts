// ==========================================================================
// bio-mendel — chi-square goodness-of-fit numerics (pure, DOM-free)
//
// Self-implemented χ² statistic and p-values through the regularized upper
// incomplete gamma function Q(df/2, χ²/2): series expansion (small x) plus
// modified Lentz continued fraction (large x) on top of a Lanczos log-Gamma.
// No external statistics dependency is used anywhere.
//
// Reference data: Mendel (1866) "Versuche über Pflanzen-Hybriden" — the
// seven monohybrid F2 traits and the dihybrid seed experiment (public
// domain). Included as MENDEL_F2_TRAITS and bundled as a sample CSV.
// ==========================================================================

// ---- special functions -------------------------------------------------------

/** Lanczos approximation g=7, n=9 — |lnΓ| error ≲ 1e-13 over the needed range. */
const LANCZOS = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

export function logGamma(z: number): number {
  if (z < 0.5) {
    // reflection: Γ(z)·Γ(1−z) = π / sin(πz)
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  const x = z - 1;
  let a = LANCZOS[0]!;
  const t = x + 7.5;
  for (let i = 1; i < LANCZOS.length; i += 1) a += LANCZOS[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

const FPMIN = 1e-300;

/** Regularized lower incomplete gamma P(s,x) by series (converges for x < s+1). */
export function gammaP(s: number, x: number): number {
  if (x <= 0) return 0;
  let ap = s;
  let sum = 1 / s;
  let del = sum;
  for (let n = 1; n <= 500; n += 1) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
  }
  return sum * Math.exp(-x + s * Math.log(x) - logGamma(s));
}

/** Regularized upper incomplete gamma Q(s,x) by modified Lentz continued fraction. */
export function gammaQ(s: number, x: number): number {
  if (x <= 0) return 1;
  const b = x + 1 - s;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 500; i += 1) {
    const an = -i * (i - s);
    const b2 = b + 2 * i;
    d = an * d + b2;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b2 + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + s * Math.log(x) - logGamma(s)) * h;
}

/** Regularized upper incomplete gamma Q(s,x), choosing the faster branch. */
export function upperGammaQ(s: number, x: number): number {
  if (Number.isNaN(s) || Number.isNaN(x) || s <= 0 || x < 0) return Number.NaN;
  return x >= s + 1 ? gammaQ(s, x) : 1 - gammaP(s, x);
}

/** χ² survival function p = P(χ²_df ≥ x) = Q(df/2, x/2). */
export function chiSquarePValue(chi2: number, df: number): number {
  if (chi2 <= 0) return 1;
  return upperGammaQ(df / 2, chi2 / 2);
}

// ---- χ² goodness-of-fit -------------------------------------------------------

export interface ChiResult {
  /** Expected counts under the normalized ratio (same order as observed). */
  expected: number[];
  /** χ² = Σ (O−E)²/E over categories with ratio > 0. */
  chi2: number;
  /** Degrees of freedom k − 1. */
  df: number;
  /** Survival probability p = Q(df/2, χ²/2). */
  p: number;
}

/** χ² goodness of fit for observed counts against an expected ratio pattern. */
export function chiSquareGof(observed: number[], ratios: number[]): ChiResult {
  if (observed.length === 0 || observed.length !== ratios.length) {
    return { expected: [], chi2: Number.NaN, df: Number.NaN, p: Number.NaN };
  }
  const total = observed.reduce((a, b) => a + b, 0);
  const ratioSum = ratios.reduce((a, b) => a + b, 0);
  const expected: number[] = [];
  let chi2 = 0;
  let k = 0;
  for (let i = 0; i < observed.length; i += 1) {
    const e = ratioSum > 0 ? (total * ratios[i]!) / ratioSum : 0;
    if (ratios[i]! <= 0) {
      expected.push(0);
      if (observed[i]! > 0) chi2 = Number.POSITIVE_INFINITY;
      continue;
    }
    expected.push(e);
    chi2 += ((observed[i]! - e) * (observed[i]! - e)) / e;
    k += 1;
  }
  const df = Math.max(k - 1, 0);
  return { expected, chi2, df, p: chiSquarePValue(chi2, df) };
}

// ---- data model / parsing ------------------------------------------------------

export interface TraitRow {
  trait: string;
  category: string;
  observed: number;
  expectedRatio: number;
}

export interface TraitTest {
  trait: string;
  categories: string[];
  observed: number[];
  ratios: number[];
  result: ChiResult;
}

/** Group parsed rows per trait and compute each χ² test. */
export function groupTraits(rows: TraitRow[]): TraitTest[] {
  const order: string[] = [];
  const byTrait = new Map<string, TraitRow[]>();
  for (const r of rows) {
    if (!byTrait.has(r.trait)) {
      byTrait.set(r.trait, []);
      order.push(r.trait);
    }
    byTrait.get(r.trait)!.push(r);
  }
  const tests: TraitTest[] = [];
  for (const trait of order) {
    const rs = byTrait.get(trait)!;
    const test: TraitTest = {
      trait,
      categories: rs.map((r) => r.category),
      observed: rs.map((r) => r.observed),
      ratios: rs.map((r) => r.expectedRatio),
      result: chiSquareGof(
        rs.map((r) => r.observed),
        rs.map((r) => r.expectedRatio),
      ),
    };
    tests.push(test);
  }
  return tests;
}

/**
 * Parse trait,category,observed,expectedRatio CSV/TSV (also bare
 * observed,expectedRatio). `#` comment lines are skipped; a text header is
 * detected and used to map columns by name.
 */
export function parseTraitCsv(text: string): TraitRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const rows: TraitRow[] = [];
  // -1 means "column absent" (trait/category default to placeholders).
  let colTrait = -1;
  let colCategory = -1;
  let colObserved = -1;
  let colRatio = -1;
  let first = true;
  for (const line of lines) {
    const cells = line.split(/[,\t;]/).map((c) => c.trim());
    if (first) {
      first = false;
      const looksNumeric = cells.every((c) => c === '' || Number.isFinite(Number(c)));
      if (!looksNumeric) {
        // header row — map columns by name; numeric fallbacks depend on width
        const lower = cells.map((c) => c.toLowerCase());
        const idx = (names: string[], fallback: number): number => {
          const hit = lower.findIndex((c) => names.includes(c));
          return hit >= 0 ? hit : fallback;
        };
        const wide = cells.length >= 4;
        colTrait = idx(['trait', 'group', 'experiment'], wide ? 0 : -1);
        colCategory = idx(['category', 'phenotype', 'class'], wide ? 1 : -1);
        colObserved = idx(['observed', 'count', 'o'], wide ? 2 : 0);
        colRatio = idx(['expectedratio', 'ratio', 'expected', 'e'], wide ? 3 : 1);
        continue;
      }
      // numeric first row — infer layout from cell count
      if (cells.length >= 4) {
        colTrait = 0;
        colCategory = 1;
        colObserved = 2;
        colRatio = 3;
      } else {
        colObserved = 0;
        colRatio = 1;
      }
    }
    const observed = Number(cells[colObserved]);
    const ratio = Number(cells[colRatio]);
    if (!Number.isFinite(observed) || observed < 0 || !Number.isFinite(ratio) || ratio < 0) continue;
    rows.push({
      trait: cells[colTrait] || 'dataset',
      category: cells[colCategory] || `cat${rows.length}`,
      observed,
      expectedRatio: ratio,
    });
  }
  return rows;
}

/** Merge independent χ² tests (same null) into one pooled statistic. */
export function mergedChiSquare(tests: TraitTest[]): { chi2: number; df: number; p: number } {
  let chi2 = 0;
  let df = 0;
  for (const t of tests) {
    if (!Number.isFinite(t.result.chi2)) continue;
    chi2 += t.result.chi2;
    df += t.result.df;
  }
  return { chi2, df, p: chiSquarePValue(chi2, df) };
}

// ---- Mendel (1866) reference data (public domain) -------------------------------

export const MENDEL_F2_TRAITS: TraitRow[] = [
  // Seven monohybrid F2 traits — expected 3:1 dominance segregation.
  { trait: 'seed-form', category: 'round', observed: 5474, expectedRatio: 3 },
  { trait: 'seed-form', category: 'wrinkled', observed: 1850, expectedRatio: 1 },
  { trait: 'seed-colour', category: 'yellow', observed: 6022, expectedRatio: 3 },
  { trait: 'seed-colour', category: 'green', observed: 2001, expectedRatio: 1 },
  { trait: 'seed-coat', category: 'violet-red', observed: 705, expectedRatio: 3 },
  { trait: 'seed-coat', category: 'white', observed: 224, expectedRatio: 1 },
  { trait: 'pod-form', category: 'inflated', observed: 882, expectedRatio: 3 },
  { trait: 'pod-form', category: 'constricted', observed: 299, expectedRatio: 1 },
  { trait: 'pod-colour', category: 'green', observed: 428, expectedRatio: 3 },
  { trait: 'pod-colour', category: 'yellow', observed: 152, expectedRatio: 1 },
  { trait: 'flower-position', category: 'axial', observed: 651, expectedRatio: 3 },
  { trait: 'flower-position', category: 'terminal', observed: 207, expectedRatio: 1 },
  { trait: 'stem-length', category: 'long', observed: 787, expectedRatio: 3 },
  { trait: 'stem-length', category: 'short', observed: 277, expectedRatio: 1 },
  // Dihybrid F2 (round-yellow × wrinkled-green) — expected 9:3:3:1.
  { trait: 'dihybrid-seed', category: 'round-yellow', observed: 315, expectedRatio: 9 },
  { trait: 'dihybrid-seed', category: 'round-green', observed: 108, expectedRatio: 3 },
  { trait: 'dihybrid-seed', category: 'wrinkled-yellow', observed: 101, expectedRatio: 3 },
  { trait: 'dihybrid-seed', category: 'wrinkled-green', observed: 32, expectedRatio: 1 },
];

// ---- embedded validation benchmarks ---------------------------------------------

export interface MendelBenchmark {
  key: string;
  label: string;
  value: number;
  /** Closed-form / hand-computed reference. */
  expected: number;
  relErr: number;
  tolerance: number;
}

function bench(key: string, label: string, value: number, expected: number, tolerance: number): MendelBenchmark {
  return {
    key,
    label,
    value,
    expected,
    relErr: Math.abs(value - expected) / Math.abs(expected),
    tolerance,
  };
}

/**
 * Validation battery:
 *  1. hand-computable small sample: O=[12,8], 3:1 → E=[15,5], χ² = 2.4 exactly
 *  2. df=1 quantile: p(χ²=3.8414588206941236) = 0.05
 *  3. even-df identity: Q(df=2, x) = e^(−x/2) and Q(df=4, x) = e^(−x/2)(1+x/2)
 *  4. Mendel 1866 round:wrinkled 5474:1850 → χ² = 361/5493 + 361/1831 ≈ 0.262879
 *     (E = 3/4·7324 = 5493, 1/4·7324 = 1831), p ≈ 0.6083
 */
export function runMendelBenchmarks(): MendelBenchmark[] {
  const hand = chiSquareGof([12, 8], [3, 1]);
  const df1 = chiSquarePValue(3.8414588206941236, 1);
  const df2 = chiSquarePValue(2.71, 2);
  const df2Exact = Math.exp(-2.71 / 2);
  const df4 = chiSquarePValue(6.31, 4);
  const df4Exact = Math.exp(-6.31 / 2) * (1 + 6.31 / 2);
  const mendel = chiSquareGof([5474, 1850], [3, 1]);
  const mendelChi2Exact = (19 * 19) / 5493 + (19 * 19) / 1831;
  return [
    bench('hand-chi2', 'O=[12,8] vs 3:1 → χ² = 2.4', hand.chi2, 2.4, 1e-9),
    bench('df1-p', 'p(χ²=3.84146, df=1) = 0.05', df1, 0.05, 1e-4),
    bench('df2-p', 'p(χ²=2.71, df=2) = e^(−x/2)', df2, df2Exact, 1e-9),
    bench('df4-p', 'p(χ²=6.31, df=4) = e^(−x/2)(1+x/2)', df4, df4Exact, 1e-9),
    bench('mendel-chi2', 'Mendel 5474:1850 → χ² ≈ 0.262879', mendel.chi2, mendelChi2Exact, 1e-9),
  ];
}
