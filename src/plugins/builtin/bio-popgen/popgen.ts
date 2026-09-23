// ==========================================================================
// bio-popgen — deterministic population-genetics numerics (pure TS)
//
// Two classical analyses:
//  1. Hardy-Weinberg equilibrium — allele frequencies from genotype counts,
//     expected genotype proportions under random mating, and a chi-square
//     goodness-of-fit test (df=1, p-value from the exact normal-tail of a
//     chi-square-1 variate).
//  2. Wright-Fisher genetic drift with optional additive/recessive/dominant
//     selection — a seeded pseudo-random, fully reproducible many-replicate
//     simulation tracking allele-frequency trajectories and fixation.
// ==========================================================================

// ---------------- RNG -------------------------------------------------------

/** Deterministic mulberry32 generator (seeded) → unit uniform [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- Hardy-Weinberg -------------------------------------------

export interface GenotypeCounts {
  AA: number;
  Aa: number;
  aa: number;
}

export interface HweResult {
  nInd: number;
  alleleA: number; // p
  alleleB: number; // q = 1-p
  expected: { AA: number; Aa: number; aa: number };
  chi2: number;
  df: number;
  pValue: number;
  /** statistical significance at the conventional 0.05 level */
  deviates: boolean;
}

/** Normal CDF via Abramowitz–Stegun 7.1.26 error function. */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/**
 * HWE test for a biallelic locus. A chi-square-1 variate is the square of a
 * standard normal, so P(X ≤ x) is exact via the normal CDF.
 */
export function hweTest(counts: GenotypeCounts): HweResult {
  const n = counts.AA + counts.Aa + counts.aa;
  if (n === 0) return { nInd: 0, alleleA: 0, alleleB: 0, expected: { AA: 0, Aa: 0, aa: 0 }, chi2: 0, df: 1, pValue: 1, deviates: false };
  const nAlleles = 2 * n;
  const p = (2 * counts.AA + counts.Aa) / nAlleles;
  const q = 1 - p;
  const eAA = p * p * n;
  const eAa = 2 * p * q * n;
  const eaa = q * q * n;
  const obs = [counts.AA, counts.Aa, counts.aa];
  const exp = [eAA, eAa, eaa];
  let chi2 = 0;
  for (let i = 0; i < 3; i += 1) {
    if (exp[i]! > 0) chi2 += (obs[i]! - exp[i]!) ** 2 / exp[i]!;
  }
  // p-value = P(chi2_1 > chi2) = 2·(1 − Phi(√chi2))
  const pValue = chi2 <= 0 ? 1 : 2 * (1 - normalCdf(Math.sqrt(chi2)));
  return {
    nInd: n,
    alleleA: p,
    alleleB: q,
    expected: { AA: eAA, Aa: eAa, aa: eaa },
    chi2,
    df: 1,
    pValue: Math.min(1, Math.max(0, pValue)),
    deviates: pValue < 0.05,
  };
}

// ---------------- Wright-Fisher drift --------------------------------------

export interface WfConfig {
  p0: number; // initial frequency of allele A
  diploidN: number; // number of diploid individuals → 2N gametes
  generations: number;
  replicates: number;
  selection: number; // s, selection coefficient on the homozygous carrier
  dominance: number; // h: 0 recessive, 0.5 additive, 1 dominant
  seed: number;
}

export interface WfResult {
  generations: number[];
  /** one allele-frequency path per replicate (length = generations+1). */
  paths: number[][];
  mean: number[];
  /** number of replicates that fixed the A allele during the run. */
  fixedA: number;
  /** number of replicates that lost the A allele during the run. */
  lostA: number;
  /** generations averaged over replicates until fixation (null if < 2 fixed+lost). */
  meanFixationTime: number | null;
}

/**
 * Wright-Fisher process with viability selection. Each generation:
 *   1. genotype frequencies p², 2pq, q² (random mating),
 *   2. viability selection → post-selection allele frequency,
 *   3. binomial sampling of 2N gametes (genetic drift).
 * Fully deterministic for the seed — scientifically reproducible.
 */
export function wrightFisher(cfg: WfConfig): WfResult {
  const N = Math.max(1, cfg.diploidN);
  const reps = Math.max(1, cfg.replicates);
  const gens = Math.max(1, cfg.generations);
  const p0 = Math.min(1, Math.max(0, cfg.p0));
  const s = cfg.selection;
  const h = cfg.dominance;
  const rand = mulberry32(cfg.seed);

  const paths: number[][] = Array.from({ length: reps }, () => []);
  const nGametes = 2 * N;
  let fixed = 0;
  let lost = 0;
  const fixGens: number[] = [];

  for (let r = 0; r < reps; r += 1) {
    let p = p0;
    const path = paths[r]!;
    path.push(p);
    for (let g = 1; g <= gens; g += 1) {
      // selection on genotype fitness (identity when s = 0)
      const pSel = applySelection(p, s, h);
      // drift: sample 2N gametes
      let aCount = 0;
      for (let k = 0; k < nGametes; k += 1) {
        if (rand() < pSel) aCount += 1;
      }
      p = aCount / nGametes;
      path.push(p);
      if (p === 0) {
        if (g <= gens) {
          lost += 1;
          fixGens.push(g);
          break;
        }
      } else if (p === 1) {
        if (g <= gens) {
          fixed += 1;
          fixGens.push(g);
          break;
        }
      }
    }
    // pad remaining generations with the fixation value
    const end = p;
    while (path.length <= gens) path.push(end);
  }

  // mean frequency per generation
  const mean: number[] = [];
  for (let g = 0; g <= gens; g += 1) {
    let sum = 0;
    for (let r = 0; r < reps; r += 1) sum += paths[r]![g]!;
    mean.push(sum / reps);
  }

  return {
    generations: Array.from({ length: gens + 1 }, (_, i) => i),
    paths,
    mean,
    fixedA: fixed,
    lostA: lost,
    meanFixationTime: fixGens.length >= 2 ? fixGens.reduce((a, b) => a + b, 0) / fixGens.length : null,
  };
}

/** Genotype-fitness selection (A is the advantageous allele):
 *  w(AA)=1+s, w(Aa)=1+h·s, w(aa)=1.  h controls dominance (0 recessive,
 *  0.5 additive, 1 dominant). */
export function applySelection(p: number, s: number, h: number): number {
  const wAA = 1 + s;
  const wAa = 1 + h * s;
  const waa = 1;
  const fAA = p * p;
  const fAa = 2 * p * (1 - p);
  const faa = (1 - p) * (1 - p);
  const wbar = fAA * wAA + fAa * wAa + faa * waa;
  const pAfter = (fAA * wAA + 0.5 * fAa * wAa) / (wbar > 0 ? wbar : 1);
  return Math.min(1, Math.max(0, pAfter));
}

export function effectiveHeterozygosity(paths: number[][]): number {
  const steps = paths[0]?.length ?? 0;
  const h: number[] = [];
  for (let g = 0; g < steps; g += 1) {
    let sum = 0;
    for (const p of paths) sum += 2 * p[g]! * (1 - p[g]!);
    h.push(sum / paths.length);
  }
  return h.length ? h[h.length - 1]! : 0;
}

export const DEFAULT_COUNTS: GenotypeCounts = { AA: 42, Aa: 46, aa: 12 };
export const DEFAULT_WF: WfConfig = { p0: 0.5, diploidN: 50, generations: 60, replicates: 40, selection: 0, dominance: 0.5, seed: 20260922 };

/** Parse genotype counts (AA, Aa, aa) from CSV/TSV/JSON text. Accepts
 *  `AA,Aa,aa` rows, lone numeric rows, or a JSON object `{AA,Aa,aa}` /
 *  array `[AA,Aa,aa]`. Returns null when counts are invalid/non-finite. */
export function parseGenotypeCounts(text: string): GenotypeCounts | null {
  const trim = text.trim();
  if (!trim) return null;
  let AA: number | null = null;
  let Aa: number | null = null;
  let aa: number | null = null;

  if (trim.startsWith('{') || trim.startsWith('[')) {
    try {
      const json = JSON.parse(trim) as unknown;
      if (Array.isArray(json)) {
        if (json.length >= 3) {
          AA = Number(json[0]);
          Aa = Number(json[1]);
          aa = Number(json[2]);
        }
      } else if (json && typeof json === 'object') {
        const o = json as { AA?: unknown; Aa?: unknown; aa?: unknown; genotypes?: { AA?: unknown; Aa?: unknown; aa?: unknown } };
        AA = Number(o.AA ?? o.genotypes?.AA);
        Aa = Number(o.Aa ?? o.genotypes?.Aa);
        aa = Number(o.aa ?? o.genotypes?.aa);
      }
    } catch {
      return null;
    }
  } else {
    for (const raw of trim.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const cells = line.split(/[,;\t ]+/).filter((c) => c !== '');
      if (cells.length === 3 && cells.every(isFiniteNum)) {
        AA = Number(cells[0]);
        Aa = Number(cells[1]);
        aa = Number(cells[2]);
      } else if (/^a|^A|^a/i.test(cells.join())) {
        // header row (AA,Aa,aa) — skip
        continue;
      }
    }
  }

  if (AA === null || Aa === null || aa === null) return null;
  if (!Number.isFinite(AA) || !Number.isFinite(Aa) || !Number.isFinite(aa)) return null;
  if (AA < 0 || Aa < 0 || aa < 0) return null;
  return { AA, Aa, aa };
}

function isFiniteNum(v: string): boolean {
  return Number.isFinite(Number(v));
}

/**
 * Count genotypes from a VCF (variant-call format) text. Reads the FORMAT/GT
 * field of each sample column; 0/0 & 0|0 → AA (homozygous ref), 1/1 & 1|1 →
 * aa (homozygous alt), any 0/1, 1/0, 0|1, 1|0 → Aa (heterozygous), and any
 * missing (./.) is skipped. Returns null when no usable diploid genotypes are
 * found.
 */
export function parseVcfGenotypes(text: string): GenotypeCounts | null {
  let AA = 0;
  let Aa = 0;
  let aa = 0;
  let seen = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const tokens = line.split('\t');
    if (tokens.length < 10) continue; // need at least one sample column
    const format = tokens[8]!.toUpperCase().split(':')[0]!;
    if (format !== 'GT') continue;
    for (let i = 9; i < tokens.length; i += 1) {
      const gt = tokens[i]!.split(':')[0]!;
      if (!gt || gt === './.' || gt === '.') continue;
      const alleles = gt.replace('|', '/').split('/');
      if (alleles.length !== 2) continue;
      const a = alleles[0]!;
      const b = alleles[1]!;
      seen += 1;
      if (a === b) {
        if (a === '0') AA += 1;
        else if (a === '1') aa += 1;
      } else {
        Aa += 1;
      }
    }
  }
  if (seen === 0) return null;
  return { AA, Aa, aa };
}