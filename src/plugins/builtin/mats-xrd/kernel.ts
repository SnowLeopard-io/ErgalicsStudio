// ==========================================================================
// mats-xrd — powder diffraction numerics (pure, dependency-free, testable)
//
// Parses powder patterns (2θ–intensity), detects peaks by topographic
// prominence, converts each peak to a d-spacing via Bragg's law (λ =
// 2d·sinθ), and performs least-squares cubic lattice-parameter refinement
// from the indexed reflections. All functions are pure so the kernel is
// unit-testable without a canvas or DOM.
//
// The indexing approach for cubic systems: Q = 1/d² is proportional to
// s = h²+k²+l², so Q_i / Q_min = s_i / s_min. The allowed s values for a
// cubic lattice are {1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, ...} (7 is never
// expressible as a sum of three squares), which distinguishes simple / body-
// / face-centred lattices via systematic absences.
// ==========================================================================

// ---- X-ray anode wavelengths (Å) -------------------------------------------

export type XrdAnode = 'CuKa1' | 'CuKa2' | 'CuKaMean' | 'MoKa' | 'CoKa' | 'CrKa' | 'FeKa';

export interface AnodeInfo {
  wavelength: number;
  labelEn: string;
  labelZh: string;
}

export const ANODES: Record<XrdAnode, AnodeInfo> = {
  CuKa1: { wavelength: 1.54056, labelEn: 'Cu Kα1 (1.5406 Å)', labelZh: 'Cu Kα1 (1.5406 Å)' },
  CuKa2: { wavelength: 1.54439, labelEn: 'Cu Kα2 (1.5444 Å)', labelZh: 'Cu Kα2 (1.5444 Å)' },
  CuKaMean: { wavelength: 1.54184, labelEn: 'Cu Kα mean (1.5418 Å)', labelZh: 'Cu Kα 平均 (1.5418 Å)' },
  MoKa: { wavelength: 0.70932, labelEn: 'Mo Kα (0.7093 Å)', labelZh: 'Mo Kα (0.7093 Å)' },
  CoKa: { wavelength: 1.79026, labelEn: 'Co Kα (1.7903 Å)', labelZh: 'Co Kα (1.7903 Å)' },
  CrKa: { wavelength: 2.29092, labelEn: 'Cr Kα (2.2909 Å)', labelZh: 'Cr Kα (2.2909 Å)' },
  FeKa: { wavelength: 1.93728, labelEn: 'Fe Kα (1.9373 Å)', labelZh: 'Fe Kα (1.9373 Å)' },
};

// ---- data parsing ----------------------------------------------------------

export interface XrdPoint {
  twoTheta: number;
  intensity: number;
}

/**
 * Parse a powder pattern into (2θ, intensity) pairs. Accepts:
 *  - GSAS/FullProf `.xy`/`.xye`: header lines starting with `#` or a single
 *    metadata line, then whitespace-separated `2θ I` (or `2θ I σ`) rows,
 *    terminated by an empty line or EOF;
 *  - CSV (optionally with a header row, columns named after 2θ/angle and
 *    intensity/counts);
 *  - generic whitespace- or comma-separated two-column text.
 */
export function parseXrd(text: string): XrdPoint[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pts: XrdPoint[] = [];
  let sawHeader = false;
  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Skip comment / metadata lines.
    if (line.startsWith('#') || line.startsWith(';') || line.startsWith('//')) continue;
    // A metadata line with no comma but exactly one token (e.g. "1.54056") —
    // treat as a wavelength-only header like the GSAS .xy first line.
    const comma = line.includes(',');
    const toks = comma ? line.split(',') : line.split(/\s+/);
    const cleaned = toks.map((t) => t.trim()).filter(Boolean);
    if (cleaned.length === 1 && Number.isFinite(Number(cleaned[0]))) {
      sawHeader = true;
      continue;
    }
    // CSV header row detection: first token non-numeric.
    if (cleaned.length >= 2) {
      const a = Number(cleaned[0]);
      const b = Number(cleaned[1]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        pts.push({ twoTheta: a, intensity: b });
      } else if (!sawHeader && pts.length === 0) {
        sawHeader = true; // header row, skip
      }
    }
  }
  if (pts.length < 3) return [];
  // Sort by 2θ ascending; strip exact duplicates.
  pts.sort((p, q) => p.twoTheta - q.twoTheta);
  return pts;
}

// ---- Bragg's law -----------------------------------------------------------

/**
 * Interplanar d-spacing from Bragg's law: d = λ / (2 sin θ).
 * `twoThetaDeg` is the scattering angle 2θ in degrees.
 */
export function braggD(twoThetaDeg: number, wavelength: number): number {
  const theta = (twoThetaDeg * Math.PI) / 180 / 2; // θ in radians
  const sinT = Math.sin(theta);
  if (sinT <= 1e-12) return Number.POSITIVE_INFINITY;
  return wavelength / (2 * sinT);
}

// ---- peak detection by prominence ------------------------------------------

export interface XrdPeak {
  twoTheta: number;
  intensity: number;
  d: number;
  /** Topographic prominence (height above the higher of the two saddle points). */
  prominence: number;
}

export interface PeakDetectOptions {
  /** Minimum prominence as a fraction of the global intensity span [0,1]. */
  minProminenceFrac: number;
  /** Minimum 2θ separation (deg) so noise splinters are not counted twice. */
  minSeparation: number;
}

export const DEFAULT_PEAK_OPTS: PeakDetectOptions = {
  minProminenceFrac: 0.02,
  minSeparation: 0.25,
};

/**
 * Detect peaks by local maxima with topographic prominence. A peak's
 * prominence is the lesser of the drops to the lowest point reached before
 * encountering a higher peak on each side — the standard topographic
 * definition, robust to a sloping background.
 */
export function findPeaks(
  pts: XrdPoint[],
  wavelength: number,
  opts: PeakDetectOptions = DEFAULT_PEAK_OPTS,
): XrdPeak[] {
  if (pts.length < 5) return [];
  const n = pts.length;
  const tt = pts.map((p) => p.twoTheta);
  const I = pts.map((p) => p.intensity);
  const iMin = Math.min(...I);
  const iMax = Math.max(...I);
  const span = iMax - iMin || 1;
  const minProm = opts.minProminenceFrac * span;

  // Local maxima (strictly greater than immediate neighbours).
  const cand: number[] = [];
  for (let i = 1; i < n - 1; i += 1) {
    if (I[i]! > I[i - 1]! && I[i]! >= I[i + 1]!) {
      // Plateau: only count the leftmost point of a flat top.
      if (I[i]! === I[i + 1]! && i > 0 && I[i]! === I[i - 1]!) continue;
      cand.push(i);
    }
  }

  const peaks: XrdPeak[] = [];
  for (const idx of cand) {
    const leftB = leftBaseVal(I, idx);
    const rightB = rightBaseVal(I, idx, n);
    const prom = I[idx]! - Math.max(leftB, rightB);
    if (prom < minProm) continue;
    peaks.push({
      twoTheta: tt[idx]!,
      intensity: I[idx]!,
      d: braggD(tt[idx]!, wavelength),
      prominence: prom,
    });
  }
  // Merge peaks closer than the minimum separation, keeping the higher one.
  peaks.sort((a, b) => a.twoTheta - b.twoTheta);
  const merged: XrdPeak[] = [];
  for (const p of peaks) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(p.twoTheta - last.twoTheta) < opts.minSeparation) {
      if (p.prominence > last.prominence) merged[merged.length - 1] = p;
    } else {
      merged.push(p);
    }
  }
  return merged;
}

function leftBaseVal(I: number[], idx: number): number {
  // Walk left until the curve rises above the candidate (a higher peak).
  let base = I[idx]!;
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (I[i]! > I[idx]!) break;
    if (I[i]! < base) base = I[i]!;
  }
  return base;
}

function rightBaseVal(I: number[], idx: number, n: number): number {
  let base = I[idx]!;
  for (let i = idx + 1; i < n; i += 1) {
    if (I[i]! > I[idx]!) break;
    if (I[i]! < base) base = I[i]!;
  }
  return base;
}

// ---- cubic lattice-parameter refinement ------------------------------------

/** Allowed s = h²+k²+l² values for a cubic lattice (≤ 27). 7, 15, 23 are absent. */
export const CUBIC_S_VALUES = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27];

/** Centring rule: which s values survive systematic absences. */
export type CubicCentring = 'P' | 'I' | 'F';

export function centringAllows(s: number, centring: CubicCentring): boolean {
  if (centring === 'P') return true;
  // s = h²+k²+l². For I-centring h+k+l even → s ≡ (h+k+l)² mod 2 ≡ 0 mod 2
  // is a rough proxy; the exact parity test needs the indices, so we use the
  // standard absence rule: I → s even, F → s all-same-parity (h,k,l all even
  // or all odd). s all-even ⇒ h,k,l all even ⇒ s ≡ 0 mod 4; s all-odd ⇒
  // s ≡ 3 mod 4 (sum of three odd squares). F allows s ≡ 0 or 3 mod 4.
  if (centring === 'I') return s % 2 === 0;
  // F
  return s % 4 === 0 || s % 4 === 3;
}

export interface IndexedPeak {
  twoTheta: number;
  d: number;
  s: number; // h²+k²+l²
  hkl: [number, number, number];
}

export interface LatticeRefinement {
  /** Refined lattice parameter a (Å) via least squares: a² = s·d² (weighted). */
  a: number;
  /** Lattice centring that best fits the observed absences. */
  centring: CubicCentring;
  /** Per-peak (hkl) assignments. */
  indexed: IndexedPeak[];
  /** Mean absolute relative deviation of the fit. */
  relDev: number;
}

/**
 * Index a cubic powder pattern and refine the lattice parameter. Given the
 * set of d-spacings, this scales Q = 1/d² so that ratios land on allowed s
 * values, then solves the weighted least-squares `a² = s·d²` over all
 * indexed peaks. Three centring hypotheses (P / I / F) are tried and the one
 * with the lowest mean relative deviation wins.
 */
export function refineCubicLattice(peaks: XrdPeak[]): LatticeRefinement | null {
  // Use peaks with finite d-spacing, sorted by descending d (ascending 2θ).
  const finite = peaks.filter((p) => Number.isFinite(p.d) && p.d > 0).sort((a, b) => b.d - a.d);
  if (finite.length < 3) return null;

  // The smallest 2θ peak has the largest d → smallest Q; assign it s = 1..3
  // (try the first few s values as the reference s) and pick the assignment
  // that gives the best overall fit.
  let best: LatticeRefinement | null = null;
  const d0 = finite[0]!.d;
  const Q0 = 1 / (d0 * d0);
  for (const sRef of [1, 2, 3, 4]) {
    // Scale factor k: Q = k · s  →  k = Q0 / sRef
    const k = Q0 / sRef;
    for (const centring of ['P', 'I', 'F'] as CubicCentring[]) {
      const indexed: IndexedPeak[] = [];
      let ok = true;
      for (const p of finite) {
        const Q = 1 / (p.d * p.d);
        const sRaw = Q / k;
        // Snap to the nearest allowed s under this centring rule.
        const s = nearestAllowedS(sRaw, centring);
        if (s === null) {
          ok = false;
          break;
        }
        const rel = Math.abs(sRaw - s) / s;
        if (rel > 0.06) {
          ok = false;
          break;
        }
        indexed.push({ twoTheta: p.twoTheta, d: p.d, s, hkl: sToHkl(s) });
      }
      if (!ok || indexed.length < 3) continue;
      // Weighted least squares: a² = s·d². Minimise Σ w·(a² − s·d²)² with
      // w = prominence (stronger reflections weigh more).
      let sw = 0;
      let swx = 0;
      for (let i = 0; i < finite.length; i += 1) {
        const p = finite[i]!;
        const ix = indexed[i]!;
        const w = Math.max(p.prominence, 1e-6);
        const x = ix.s * p.d * p.d; // = a² if perfectly indexed
        sw += w;
        swx += w * x;
      }
      const a2 = sw > 0 ? swx / sw : 0;
      if (a2 <= 0) continue;
      const a = Math.sqrt(a2);
      // Mean relative deviation.
      let sumRel = 0;
      for (let i = 0; i < finite.length; i += 1) {
        const p = finite[i]!;
        const ix = indexed[i]!;
        const dPred = a / Math.sqrt(ix.s);
        sumRel += Math.abs(dPred - p.d) / p.d;
      }
      const relDev = sumRel / finite.length;
      if (!best || relDev < best.relDev) {
        best = { a, centring, indexed, relDev };
      }
    }
  }
  return best;
}

function nearestAllowedS(sRaw: number, centring: CubicCentring): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const s of CUBIC_S_VALUES) {
    if (!centringAllows(s, centring)) continue;
    const dist = Math.abs(sRaw - s);
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  return best;
}

/** A representative (hkl) for a given s = h²+k²+l² (lexicographically smallest). */
export function sToHkl(s: number): [number, number, number] {
  for (let h = 0; h * h <= s; h += 1) {
    for (let k = h; h * h + k * k <= s; k += 1) {
      const l2 = s - h * h - k * k;
      const l = Math.round(Math.sqrt(l2));
      if (l >= k && h * h + k * k + l * l === s) return [h, k, l];
    }
  }
  return [0, 0, 1];
}

// ---- reference phases ------------------------------------------------------

export interface ReferencePhase {
  name: string;
  nameZh: string;
  formula: string;
  /** Bravais lattice + lattice parameter a (cubic only here). */
  a: number;
  centring: CubicCentring;
  /** Strongest reference reflections (hkl) with relative intensity %. */
  reflections: Array<{ hkl: [number, number, number]; rel: number }>;
  source: string;
}

/**
 * Common cubic reference phases for identification. d-calculations use the
 * listed a and s = h²+k²+l² (d = a/√s). Intensities are approximate powder
 * relative intensities from ICDD / NIST reference cards.
 */
export const REFERENCE_PHASES: ReferencePhase[] = [
  {
    name: 'Silicon (Si)',
    nameZh: '硅 (Si)',
    formula: 'Si',
    a: 5.43102,
    centring: 'F',
    reflections: [
      { hkl: [1, 1, 1], rel: 55 },
      { hkl: [2, 2, 0], rel: 100 },
      { hkl: [3, 1, 1], rel: 37 },
      { hkl: [4, 0, 0], rel: 8 },
      { hkl: [3, 3, 1], rel: 14 },
      { hkl: [4, 2, 2], rel: 18 },
    ],
    source: 'NIST SRM 640e, Fd-3m',
  },
  {
    name: 'Halite (NaCl)',
    nameZh: '岩盐 (NaCl)',
    formula: 'NaCl',
    a: 5.6402,
    centring: 'F',
    reflections: [
      { hkl: [1, 1, 1], rel: 13 },
      { hkl: [2, 0, 0], rel: 100 },
      { hkl: [2, 2, 0], rel: 55 },
      { hkl: [3, 1, 1], rel: 21 },
      { hkl: [2, 2, 2], rel: 30 },
      { hkl: [4, 0, 0], rel: 9 },
      { hkl: [4, 2, 0], rel: 12 },
      { hkl: [4, 2, 2], rel: 6 },
    ],
    source: 'ICDD 05-0628, Fm-3m',
  },
  {
    name: 'Copper (Cu)',
    nameZh: '铜 (Cu)',
    formula: 'Cu',
    a: 3.6149,
    centring: 'F',
    reflections: [
      { hkl: [1, 1, 1], rel: 100 },
      { hkl: [2, 0, 0], rel: 46 },
      { hkl: [2, 2, 0], rel: 20 },
      { hkl: [3, 1, 1], rel: 17 },
    ],
    source: 'ICDD 04-0836, Fm-3m',
  },
  {
    name: 'α-Iron (ferrite)',
    nameZh: 'α-铁 (铁素体)',
    formula: 'Fe',
    a: 2.8664,
    centring: 'I',
    reflections: [
      { hkl: [1, 1, 0], rel: 100 },
      { hkl: [2, 0, 0], rel: 45 },
      { hkl: [2, 1, 1], rel: 32 },
      { hkl: [2, 2, 0], rel: 12 },
      { hkl: [3, 1, 0], rel: 16 },
    ],
    source: 'ICDD 06-0696, Im-3m',
  },
  {
    name: 'Fluorite (CaF₂)',
    nameZh: '萤石 (CaF₂)',
    formula: 'CaF₂',
    a: 5.463,
    centring: 'F',
    reflections: [
      { hkl: [1, 1, 1], rel: 100 },
      { hkl: [2, 0, 0], rel: 25 },
      { hkl: [2, 2, 0], rel: 70 },
      { hkl: [3, 1, 1], rel: 50 },
      { hkl: [2, 2, 2], rel: 30 },
      { hkl: [4, 0, 0], rel: 8 },
    ],
    source: 'ICDD 35-0816, Fm-3m',
  },
  {
    name: 'Diamond (C)',
    nameZh: '金刚石 (C)',
    formula: 'C',
    a: 3.5668,
    centring: 'F',
    reflections: [
      { hkl: [1, 1, 1], rel: 100 },
      { hkl: [2, 2, 0], rel: 65 },
      { hkl: [3, 1, 1], rel: 50 },
      { hkl: [4, 0, 0], rel: 8 },
    ],
    source: 'ICDD 06-0675, Fd-3m',
  },
];

/**
 * Compare detected peaks against reference phases. Returns, for each phase,
 * how many observed peaks match a reference reflection within the tolerance,
 * and the relative-2θ root-mean-square deviation of the matches.
 */
export interface PhaseMatch {
  phase: ReferencePhase;
  matches: number;
  total: number;
  rmsDev2Theta: number;
  /** Mean relative-intensity error (%). */
  meanIntErr: number;
}

export function matchReferencePhases(
  peaks: XrdPeak[],
  wavelength: number,
  tol2Theta = 0.3,
): PhaseMatch[] {
  const out: PhaseMatch[] = [];
  if (peaks.length === 0) return out;
  const iMax = Math.max(...peaks.map((p) => p.intensity));
  for (const phase of REFERENCE_PHASES) {
    let matches = 0;
    let sumSq = 0;
    let sumIntErr = 0;
    for (const ref of phase.reflections) {
      const s = ref.hkl[0] ** 2 + ref.hkl[1] ** 2 + ref.hkl[2] ** 2;
      const d = phase.a / Math.sqrt(s);
      // Bragg: 2θ = 2·asin(λ/(2d))
      const t2 = (2 * Math.asin(wavelength / (2 * d)) * 180) / Math.PI;
      const hit = peaks.find((p) => Math.abs(p.twoTheta - t2) <= tol2Theta);
      if (hit) {
        matches += 1;
        sumSq += (hit.twoTheta - t2) ** 2;
        const obsRel = (hit.intensity / iMax) * 100;
        sumIntErr += Math.abs(obsRel - ref.rel);
      }
    }
    out.push({
      phase,
      matches,
      total: phase.reflections.length,
      rmsDev2Theta: matches > 0 ? Math.sqrt(sumSq / matches) : NaN,
      meanIntErr: matches > 0 ? sumIntErr / matches : NaN,
    });
  }
  // Rank: matches desc, then rms asc.
  out.sort((a, b) => b.matches - a.matches || a.rmsDev2Theta - b.rmsDev2Theta);
  return out;
}
