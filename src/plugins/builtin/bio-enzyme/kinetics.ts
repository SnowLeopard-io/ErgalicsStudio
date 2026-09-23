// ==========================================================================
// bio-enzyme — enzyme kinetics numerics (pure, dependency-free, testable)
//
// The classic rapid-equilibrium rate law and its three textbook inhibition
// families, a Lineweaver-Burk linear form for robust initial guesses, and a
// compact Levenberg-Marquardt nonlinear least-squares solver to back-fit
// Vmax / Km from real (noisy) initial-rate data. All functions are pure so
// the kernel unit-tests without a canvas or DOM.
// ==========================================================================

export type InhibitionMode = 'none' | 'competitive' | 'noncompetitive' | 'uncompetitive';

export interface RateParams {
  vmax: number;
  km: number;
  inhibitor: number; // [I]
  ki: number; // inhibition constant
  mode: InhibitionMode;
}

/** Initial velocity under the chosen inhibition family (µmol·min⁻¹ or same units). */
export function initialRate(p: RateParams, s: number): number {
  const { vmax, km, inhibitor: i, ki, mode } = p;
  const sPos = Math.max(0, s);
  if (mode === 'none') return (vmax * sPos) / (km + sPos);
  const f = 1 + i / Math.max(ki, 1e-12);
  if (mode === 'competitive') return (vmax * sPos) / (km * f + sPos);
  if (mode === 'uncompetitive') return ((vmax / f) * sPos) / (km / f + sPos);
  // non-competitive: Vmax scaled by 1/f, Km unchanged → v = (Vmax/f)·S/(Km+S)
  return ((vmax / f) * sPos) / (km + sPos);
}

/**
 * Apparent kinetic parameters for a given inhibition state — the quantities a
 * Lineweaver-Burk straight line actually predicts. Rewriting each law as
 * v = Vapp·s/(Kapp+s):
 *   none           Vapp=Vmax,          Kapp=Km
 *   competitive    Vapp=Vmax,          Kapp=Km·(1+I/Ki)
 *   noncompetitive Vapp=Vmax/(1+I/Ki), Kapp=Km
 *   uncompetitive  Vapp=Vmax/(1+I/Ki), Kapp=Km/(1+I/Ki)
 */
export function apparentParams(p: RateParams): { Vapp: number; Kapp: number } {
  const f = 1 + p.inhibitor / Math.max(p.ki, 1e-12);
  switch (p.mode) {
    case 'competitive':
      return { Vapp: p.vmax, Kapp: p.km * f };
    case 'uncompetitive':
      return { Vapp: p.vmax / f, Kapp: p.km / f };
    case 'noncompetitive':
      return { Vapp: p.vmax / f, Kapp: p.km };
    default:
      return { Vapp: p.vmax, Kapp: p.km };
  }
}

/** Lineweaver-Burk co-ordinates: 1/[S], 1/v for a data point. */
export function lineweaverBurkX(s: number): number {
  return s <= 0 ? Number.POSITIVE_INFINITY : 1 / s;
}
export function lineweaverBurkY(p: RateParams, s: number): number {
  const v = initialRate(p, s);
  return v === 0 ? Number.POSITIVE_INFINITY : 1 / v;
}

// ---- curve fitting ----------------------------------------------------------

export interface FitPoint {
  s: number;
  v: number;
}

/** Deterministic (seeded) pseudo-random normal noise, so fits are reproducible. */
export function seededNormal(seed: number): () => number {
  let state = seed >>> 0 || 1;
  const next = () => {
    // xorshift32 → unit uniform
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
  // Box-Muller
  return () => {
    let u = 0;
    do {
      u = next();
    } while (u <= 1e-9);
    const v = next() || 0.5;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/**
 * Synthesise a noisy initial-rate dataset (s points, 2·replicates each) from
 * the exact law plus gaussian noise proportional to v. Deterministic for a
 * fixed seed — the fit below recovers the truth approximately on this data.
 */
export function synthesizeRates(p: RateParams, sValues: number[], noise = 0.08, seed = 20260922): FitPoint[] {
  const rand = seededNormal(seed);
  const pts: FitPoint[] = [];
  for (const s of sValues) {
    const v = initialRate(p, s);
    pts.push({ s, v: Math.max(0, v * (1 + noise * rand())) });
    pts.push({ s, v: Math.max(0, v * (1 + noise * rand())) });
  }
  return pts;
}

/** Ordinary least-squares fit of x/y to a=(slope,b=intercept) via normal equations. */
function lsline(points: Array<{ x: number; y: number }>): { slope: number; intercept: number; r2: number } {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    sxy += p.x * p.y;
  }
  const denom = n * sxx - sx * sx;
  const slope = Math.abs(denom) < 1e-30 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const ssTot = points.reduce((a, p) => a + (p.y - sy / n) ** 2, 0);
  const ssRes = points.reduce((a, p) => a + (p.y - (intercept + slope * p.x)) ** 2, 0);
  const r2 = ssTot < 1e-30 ? 1 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

/**
 * Lineweaver-Burk linear regression → initial (Km, Vmax) guess. Only finite
 * (s>0, v>0) points are usable; returns null when not enough remain.
 */
export function lbInitialGuess(data: FitPoint[]): { vmax: number; km: number } | null {
  const pts = data
    .filter((d) => d.s > 0 && d.v > 0)
    .map((d) => ({ x: 1 / d.s, y: 1 / d.v }));
  if (pts.length < 2) return null;
  const { slope, intercept } = lsline(pts);
  if (intercept === 0) return null;
  const vmax = 1 / intercept;
  const km = slope * vmax;
  if (vmax <= 0 || km < 0) return null;
  return { vmax, km: Math.max(km, 1e-9) };
}

/**
 * Levenberg-Marquardt fit of {Vmax, Km} to the no-inhibition law (the three
 * inhibition families shift only the apparent values, so a single generic
 * solver suffices for the "does the fit recover the data" question). Exact
 * when the data are noise-free; otherwise converges to a robust least-squares
 * optimum. Returns null when the data cannot constrain the model.
 */
export function fitMichaelisMenten(data: FitPoint[], maxIter = 60): { vmax: number; km: number } | null {
  const guess = lbInitialGuess(data);
  if (!guess) return null;
  let vmax = guess.vmax;
  let km = guess.km;
  let lambda = 1e-2;
  const model = (v: number, k: number, s: number) => (v * s) / (k + s);
  const residual = (v: number, k: number) => data.reduce((a, d) => a + (model(v, k, d.s) - d.v) ** 2, 0);
  let err = residual(vmax, km);
  for (let it = 0; it < maxIter; it += 1) {
    let j11 = 0;
    let j22 = 0;
    let j12 = 0;
    let g1 = 0;
    let g2 = 0;
    for (const d of data) {
      const den = km + d.s;
      // ∂v/∂Vmax = s/(km+s); ∂v/∂Km = -Vmax·s/(km+s)²
      const dv = d.s / den;
      const dk = (-vmax * d.s) / (den * den);
      const r = model(vmax, km, d.s) - d.v;
      j11 += dv * dv;
      j22 += dk * dk;
      j12 += dv * dk;
      g1 += dv * r;
      g2 += dk * r;
    }
    j11 += lambda;
    j22 += lambda;
    const det = j11 * j22 - j12 * j12;
    if (Math.abs(det) < 1e-30) break;
    const dv = -(g1 * j22 - g2 * j12) / det;
    const dk = -(j11 * g2 - j12 * g1) / det;
    const nv = Math.max(1e-12, vmax + dv);
    const nk = Math.max(1e-12, km + dk);
    const nerr = residual(nv, nk);
    if (nerr < err) {
      const rel = Math.max(Math.abs(dv) / nv, Math.abs(dk) / nk);
      vmax = nv;
      km = nk;
      err = nerr;
      lambda = Math.max(lambda * 0.5, 1e-10);
      if (rel < 1e-10) break;
    } else {
      lambda = Math.min(lambda * 3, 1e6);
      if (lambda > 1e5) break;
    }
  }
  return { vmax, km };
}

export interface FitReport {
  fit: { vmax: number; km: number } | null;
  r2: number;
  rmse: number;
  n: number;
}

/** Overall quality of a fitted model against the data. */
export function reportFit(data: FitPoint[], vmax: number, km: number): { r2: number; rmse: number } {
  const n = data.length;
  if (n === 0) return { r2: 0, rmse: 0 };
  const mean = data.reduce((a, d) => a + d.v, 0) / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const d of data) {
    const pred = (vmax * d.s) / (km + d.s);
    ssTot += (d.v - mean) ** 2;
    ssRes += (d.v - pred) ** 2;
  }
  const r2 = ssTot < 1e-30 ? 1 : 1 - ssRes / ssTot;
  return { r2, rmse: Math.sqrt(ssRes / n) };
}

/** Derived turnover & efficiency from fitted Vmax (µmol/min) and [E]t. */
export function derivedKinetics(vmax: number, km: number, enzymeConc: number): {
  kcat: number | null;
  efficiency: number | null;
} {
  if (enzymeConc <= 0) return { kcat: null, efficiency: null };
  const kcat = vmax / enzymeConc;
  return { kcat, efficiency: kcat / km };
}

/** Simple defaults for the kinetic parameters/demo substrate span. */
export const DEFAULT_S_SUBSTRATES = [0.5, 1, 2, 4, 6, 10, 16, 25, 40, 60, 90, 130, 200];

/**
 * Parse an initial-rate dataset (substrate, v0) from tabular or JSON text.
 * Accepted mainstream formats:
 *   - JSON: `[{s,v}]`, `{"points":[{...}]}`, `{"data":[...]}`, or keyed objects
 *     using `s`/`substrate`/`S`/`[S]` and `v`/`v0`/`velocity`/`rate`/`V`.
 *   - CSV / TSV / DAT: two numeric columns (substrate, v0); header rows and
 *     `#`-comment lines are skipped. Missing/zero substrate rows are dropped.
 * Returns [] when nothing usable is found (caller decides the minimum count).
 */
export function parseRateData(text: string): FitPoint[] {
  const trim = text.trim();
  if (!trim) return [];
  const num = (x: unknown): number => (typeof x === 'number' ? x : Number(x));
  if (trim.startsWith('{') || trim.startsWith('[')) {
    try {
      const json = JSON.parse(trim) as unknown;
      if (!json || typeof json !== 'object') return [];
      const arr = Array.isArray(json) ? json : (json as { points?: unknown; data?: unknown }).points ?? (json as { data?: unknown }).data;
      if (!Array.isArray(arr)) return [];
      const pts: FitPoint[] = [];
      for (const it of arr) {
        if (!it || typeof it !== 'object') continue;
        const o = it as Record<string, unknown>;
        const s = num(o.s ?? o.substrate ?? o.S ?? o['[S]']);
        const v = num(o.v ?? o.v0 ?? o.velocity ?? o.rate ?? o.V);
        if (Number.isFinite(s) && Number.isFinite(v) && s > 0 && v >= 0) pts.push({ s, v });
      }
      return pts;
    } catch {
      return [];
    }
  }
  const pts: FitPoint[] = [];
  for (const line of trim.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const cells = l.split(/[,\s;]+/).map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const s = Number(cells[0]);
    const v = Number(cells[1]);
    if (Number.isFinite(s) && Number.isFinite(v) && s > 0 && v >= 0) pts.push({ s, v });
  }
  return pts;
}

export const DEFAULT_RATE_PARAMS: RateParams = {
  vmax: 120,
  km: 8,
  inhibitor: 12,
  ki: 10,
  mode: 'none',
};