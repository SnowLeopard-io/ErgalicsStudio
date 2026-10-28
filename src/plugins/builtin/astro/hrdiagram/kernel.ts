// ==========================================================================
// astro-hrdiagram — Hertzsprung–Russell diagram numerics (pure, testable)
//
// Parses a star table (name, B−V colour, V magnitude[, parallax]), converts
// apparent magnitudes to absolute magnitudes through the distance modulus
//     M_V = V + 5·log10(π/100)   (π in milliarcseconds)
//   = V + 5 + 5·log10(π″)        (π in arcseconds, d = 1/π pc),
// and provides an empirical main-sequence reference (luminosity class V
// knots, linearly interpolated) for annotating the diagram.
//
// Embedded validation benchmark: analytic distance-modulus anchors
// (10 pc ⇔ M = m; the 0.7687″ Proxima-Centauri-parallax anchor), the solar
// anchor (B−V = 0.65, M_V = 4.83) and monotonicity/continuity of the
// main-sequence interpolation. Unified relative-error convention throughout.
// All functions are pure: no DOM / canvas dependency.
// ==========================================================================

/** One catalogue star. `parallax` is the trigonometric parallax in arcseconds (null when missing). */
export interface StarRecord {
  name: string;
  /** B−V colour index (mag). */
  bv: number;
  /** Apparent V magnitude. */
  v: number;
  /** Trigonometric parallax in arcseconds, or null when unavailable. */
  parallax: number | null;
}

/**
 * Parse a star table from CSV / TSV / whitespace text with flexible headers:
 * name (name/star), B−V (bv / B-V), V (v / V / mag / Vmag) and parallax
 * (parallax / plx in arcseconds; parallax_mas / plx_mas in milliarcseconds).
 * `#`-comment lines and non-numeric header rows are skipped.
 */
export function parseStarTable(text: string): StarRecord[] {
  const out: StarRecord[] = [];
  let headerMap: Array<{ field: 'name' | 'bv' | 'v' | 'parallax' | 'parallaxMas'; col: number }> | null = null;
  for (const line of text.trim().split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    let cells = l.split(/[,;\t]+/).map((c) => c.trim());
    if (cells.length < 4 && /\s/.test(l)) {
      // Whitespace-separated row without commas: re-split on whitespace runs.
      const ws = l.split(/\s+/);
      if (ws.length > cells.length) cells = ws;
    }
    if (!headerMap) {
      // Try to interpret the first non-comment line as a header.
      const lower = cells.map((c) => c.toLowerCase().replace(/[_\s]/g, ''));
      const find = (...names: string[]): number =>
        lower.findIndex((c) => names.includes(c));
      const iName = find('name', 'star', 'id');
      const iBv = find('bv', 'b-v', 'b−v', 'bminusv');
      const iV = find('v', 'mag', 'vmag');
      const iPlx = find('parallax', 'plx');
      const iPlxMas = find('parallaxmas', 'plxmas');
      if (iName >= 0 && iBv >= 0 && iV >= 0) {
        headerMap = [
          { field: 'name', col: iName },
          { field: 'bv', col: iBv },
          { field: 'v', col: iV },
          ...(iPlx >= 0 ? [{ field: 'parallax' as const, col: iPlx }] : []),
          ...(iPlxMas >= 0 ? [{ field: 'parallaxMas' as const, col: iPlxMas }] : []),
        ];
        continue;
      }
      headerMap = [
        { field: 'name', col: 0 },
        { field: 'bv', col: 1 },
        { field: 'v', col: 2 },
        { field: 'parallax', col: 3 },
      ];
    }
    const get = (field: 'name' | 'bv' | 'v' | 'parallax' | 'parallaxMas'): string | undefined => {
      const hit = headerMap!.find((h) => h.field === field);
      return hit ? cells[hit.col] : undefined;
    };
    const name = (get('name') ?? '').replace(/^"|"$/g, '').trim();
    const bv = Number(get('bv'));
    const v = Number(get('v'));
    if (!name || !Number.isFinite(bv) || !Number.isFinite(v)) continue;
    let parallax: number | null = null;
    const plxTxt = get('parallax');
    const plxMasTxt = get('parallaxMas');
    const plxMas = plxMasTxt !== undefined && plxMasTxt !== '' ? Number(plxMasTxt) : NaN;
    if (Number.isFinite(plxMas) && plxMas > 0) parallax = plxMas / 1000;
    else if (plxTxt !== undefined && plxTxt !== '') {
      const plx = Number(plxTxt);
      if (Number.isFinite(plx) && plx > 0) parallax = plx;
    }
    out.push({ name, bv, v, parallax });
  }
  return out;
}

/**
 * Distance modulus: M_V = V + 5·log10(π/100) with π in milliarcseconds,
 * i.e. M_V = V + 5 + 5·log10(π″) for a parallax in arcseconds.
 * Returns NaN for a non-positive or missing parallax.
 */
export function absoluteMagnitude(v: number, parallaxArcsec: number): number {
  if (!(parallaxArcsec > 0)) return NaN;
  return v + 5 + 5 * Math.log10(parallaxArcsec);
}

/** Apparent − absolute magnitude (distance modulus μ) for a parallax in arcseconds. */
export function distanceModulus(parallaxArcsec: number): number {
  if (!(parallaxArcsec > 0)) return NaN;
  return -5 * (1 + Math.log10(parallaxArcsec));
}

/** Solar anchor point: B−V = 0.65, M_V = +4.83 (IAU nominal solar values). */
export const SUN_ANCHOR = { bv: 0.65, mv: 4.83 } as const;

/** One knot of the empirical main-sequence (luminosity class V) reference. */
export interface MsKnot {
  bv: number;
  mv: number;
}

/**
 * Empirical main-sequence reference knots (standard MK class-V values,
 * textbook magnitudes; approximate to ~0.1–0.2 mag). The G2 knot is pinned
 * to the solar anchor so the Sun sits exactly on the reference line.
 */
export const MAIN_SEQUENCE_KNOTS: MsKnot[] = [
  { bv: -0.33, mv: -5.8 },
  { bv: -0.3, mv: -4.0 },
  { bv: -0.23, mv: -2.2 },
  { bv: -0.17, mv: -1.2 },
  { bv: -0.02, mv: 0.65 },
  { bv: 0.19, mv: 2.0 },
  { bv: 0.3, mv: 2.7 },
  { bv: 0.45, mv: 3.5 },
  { bv: 0.58, mv: 4.4 },
  { bv: 0.65, mv: 4.83 },
  { bv: 0.81, mv: 5.9 },
  { bv: 1.15, mv: 7.4 },
  { bv: 1.4, mv: 8.8 },
  { bv: 1.6, mv: 10.0 },
];

/**
 * Linear interpolation of the main-sequence reference at a colour index.
 * Clamped to the end-knot values outside the tabulated range.
 */
export function mainSequenceMagnitude(bv: number): number {
  const knots = MAIN_SEQUENCE_KNOTS;
  if (bv <= knots[0]!.bv) return knots[0]!.mv;
  const last = knots[knots.length - 1]!;
  if (bv >= last.bv) return last.mv;
  for (let i = 1; i < knots.length; i += 1) {
    const hi = knots[i]!;
    const lo = knots[i - 1]!;
    if (bv <= hi.bv) return lo.mv + ((hi.mv - lo.mv) * (bv - lo.bv)) / (hi.bv - lo.bv);
  }
  return last.mv;
}

/** Least-squares slope/intercept of the reference over a colour range. */
export function mainSequenceSlope(bvMin: number, bvMax: number): { slope: number; intercept: number; n: number } {
  const pts = MAIN_SEQUENCE_KNOTS.filter((k) => k.bv >= bvMin && k.bv <= bvMax);
  const n = pts.length;
  if (n < 2) return { slope: 0, intercept: 0, n };
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    sx += p.bv;
    sy += p.mv;
    sxx += p.bv * p.bv;
    sxy += p.bv * p.mv;
  }
  const denom = n * sxx - sx * sx;
  const slope = Math.abs(denom) < 1e-30 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept, n };
}

/**
 * Crude textbook linear main-sequence approximation M_V ≈ 2.5·(B−V) + 4.5
 * sometimes quoted for a narrow colour band. Far steeper empirical slopes
 * (~4–6 mag/mag) hold for the real class-V sequence; this form is exposed
 * only as the coarse pedagogical comparison, never as the drawn reference.
 */
export function mainSequenceLinearApprox(bv: number): number {
  return 2.5 * bv + 4.5;
}

/**
 * Least-squares fit of M_V vs B−V for the observed main sequence. Because
 * bright catalogues are giant-dominated, candidates are first screened for
 * main-sequence membership (|M_V − empirical reference| < 1.5 mag) across
 * the FULL colour range, then fitted. Returns null when fewer than 5
 * members remain or the fitted colour span is too narrow (< 0.3 mag of
 * B−V) to constrain a slope.
 */
export function fitDataMainSequence(records: StarRecord[]): {
  slope: number;
  intercept: number;
  n: number;
  rms: number;
  screenedOut: number;
  bvMin: number;
  bvMax: number;
} | null {
  const band: Array<{ x: number; y: number }> = [];
  let screenedOut = 0;
  for (const r of records) {
    if (r.parallax === null || !(r.parallax > 0)) continue;
    const mv = absoluteMagnitude(r.v, r.parallax);
    if (!Number.isFinite(mv) || r.bv < MAIN_SEQUENCE_KNOTS[0]!.bv || r.bv > MAIN_SEQUENCE_KNOTS[MAIN_SEQUENCE_KNOTS.length - 1]!.bv) continue;
    if (Math.abs(mv - mainSequenceMagnitude(r.bv)) < 1.5) band.push({ x: r.bv, y: mv });
    else screenedOut += 1;
  }
  if (band.length < 5) return null;
  let bvMin = Number.POSITIVE_INFINITY;
  let bvMax = Number.NEGATIVE_INFINITY;
  for (const p of band) {
    bvMin = Math.min(bvMin, p.x);
    bvMax = Math.max(bvMax, p.x);
  }
  if (bvMax - bvMin < 0.3) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of band) {
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    sxy += p.x * p.y;
  }
  const n = band.length;
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-30) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const rms = Math.sqrt(band.reduce((a, p) => a + (p.y - (intercept + slope * p.x)) ** 2, 0) / n);
  return { slope, intercept, n, rms, screenedOut, bvMin, bvMax };
}

// ---- embedded validation benchmark -------------------------------------------

export const HR_BENCHMARK = {
  id: 'distance-modulus-anchor',
  /**
   * Anchor A: a star of V = 4.83 at exactly 10 pc (π = 0.1″) has M_V = 4.83
   * (distance modulus μ = 0). Exact by construction.
   */
  anchor10pc: { v: 4.83, parallax: 0.1, expectedMv: 4.83 },
  /**
   * Anchor B: the Proxima-Centauri parallax π = 0.7687″. A star with
   * V = 0.401 at that distance has M_V = 0.401 + 5 + 5·log10(0.7687)
   * = 4.8301 ≈ 4.83 (relative error < 1e-3).
   */
  anchorProxima: { v: 0.401, parallax: 0.7687, expectedMv: 4.83 },
  /** Anchor C: the same star seen from 1 pc (π = 1″) is 5 mag brighter: M_V = 9.83. */
  anchor1pc: { v: 4.83, parallax: 1.0, expectedMv: 9.83 },
  /** Solar anchor must sit on the drawn main-sequence reference within 0.05 mag. */
  sunTolerance: 0.05,
} as const;

export interface HrBenchmarkResult {
  /** |M_V − expected| for the 10 pc anchor (relative-error convention). */
  err10pc: number;
  /** |M_V − 4.83| for the Proxima-parallax anchor. */
  errProxima: number;
  /** |M_V − 9.83| for the 1 pc anchor. */
  err1pc: number;
  /** |mainSequenceMagnitude(0.65) − 4.83| (mag). */
  sunOnMsDeviation: number;
  /** True when the reference interpolation is strictly decreasing and continuous. */
  msMonotonic: boolean;
  /** Largest discontinuity found at knots (mag, ~0 for C0 continuity). */
  msMaxJump: number;
  /** Reference least-squares slope over 0.3 ≤ B−V ≤ 1.0 (mag/mag). */
  msSlope: number;
  passed: boolean;
}

/**
 * Run the embedded validation benchmark: analytic distance-modulus anchors,
 * the solar anchor on the main-sequence reference, and monotonicity /
 * continuity of the class-V interpolation.
 */
export function runHrBenchmark(): HrBenchmarkResult {
  const b = HR_BENCHMARK;
  const mv10 = absoluteMagnitude(b.anchor10pc.v, b.anchor10pc.parallax);
  const mvProxima = absoluteMagnitude(b.anchorProxima.v, b.anchorProxima.parallax);
  const mv1pc = absoluteMagnitude(b.anchor1pc.v, b.anchor1pc.parallax);
  const err10pc = Math.abs(mv10 - b.anchor10pc.expectedMv);
  const errProxima = Math.abs(mvProxima - b.anchorProxima.expectedMv);
  const err1pc = Math.abs(mv1pc - b.anchor1pc.expectedMv);
  const sunOnMsDeviation = Math.abs(mainSequenceMagnitude(SUN_ANCHOR.bv) - SUN_ANCHOR.mv);

  let monotonic = true;
  let maxJump = 0;
  for (let i = 1; i < MAIN_SEQUENCE_KNOTS.length; i += 1) {
    if (MAIN_SEQUENCE_KNOTS[i]!.mv <= MAIN_SEQUENCE_KNOTS[i - 1]!.mv) monotonic = false;
    const mid = (MAIN_SEQUENCE_KNOTS[i]!.bv + MAIN_SEQUENCE_KNOTS[i - 1]!.bv) / 2;
    maxJump = Math.max(maxJump, Math.abs(mainSequenceMagnitude(mid) - (MAIN_SEQUENCE_KNOTS[i]!.mv + MAIN_SEQUENCE_KNOTS[i - 1]!.mv) / 2));
  }
  // Continuity at the interior knots: approaching from either side must agree.
  for (const k of MAIN_SEQUENCE_KNOTS) {
    maxJump = Math.max(maxJump, Math.abs(mainSequenceMagnitude(k.bv) - k.mv));
  }

  const msSlope = mainSequenceSlope(0.3, 1.0).slope;
  const passed =
    err10pc < 1e-9 &&
    errProxima < 1e-3 &&
    err1pc < 1e-9 &&
    sunOnMsDeviation < b.sunTolerance &&
    monotonic &&
    maxJump < 1e-9;
  return { err10pc, errProxima, err1pc, sunOnMsDeviation, msMonotonic: monotonic, msMaxJump: maxJump, msSlope, passed };
}
