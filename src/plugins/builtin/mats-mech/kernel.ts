// ==========================================================================
// mats-mech — tensile stress-strain numerics (pure, dependency-free)
//
// Parses an engineering stress-strain curve and extracts the canonical set
// of tensile-property indices used in materials testing (ASTM E8 / GB/T
// 228). All functions are pure so the kernel is unit-testable without a
// canvas or DOM.
//
// Methodology:
//  - Young's modulus E: linear least-squares on the elastic region, which
//    is auto-detected as the window of max local slope (most metals have a
//    clearly dominant initial linear branch);
//  - 0.2 % offset yield σ_y: intersection of the elastic line shifted by
//    +0.002 strain with the curve;
//  - UTS: max engineering stress (point of diffuse necking);
//  - Hollomon n: σ = K·ε_p^n on the uniform-plastic region (yield → UTS)
//    in log-log space;
//  - resilience & toughness: trapezoidal area under the curve.
// ==========================================================================

export interface SSPoint {
  strain: number;
  stress: number;
}

export interface TensileResult {
  youngsModulus: number; // GPa
  yieldStrength02: number; // MPa (0.2 % offset)
  ultimateTensile: number; // MPa
  fractureStress: number; // MPa
  fractureStrain: number; // mm/mm
  uniformElongation: number; // strain at UTS
  elongation: number; // total fracture strain, %
  hollomonN: number; // strain-hardening exponent
  hollomonK: number; // strength coefficient (MPa)
  hollomonR2: number; // fit R²
  resilience: number; // MJ/m³, area to yield
  toughness: number; // MJ/m³, total area under curve
  elasticStart: number; // index
  elasticEnd: number; // index (exclusive)
  yieldIdx: number; // index of yield point
  utsIdx: number; // index of UTS
}

/**
 * Parse an engineering stress-strain curve. Accepts CSV/TSV/whitespace
 * (strain, stress columns, optional header) and JSON arrays of
 * {strain,stress}/{e,s}/{strain,stress} objects. Strain may be in % or
 * fraction — auto-detected and normalised to fraction (mm/mm).
 */
export function parseStressStrain(text: string): SSPoint[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseJson(trimmed);
  }
  const lines = trimmed.split(/\r\n|\r|\n/);
  const pts: SSPoint[] = [];
  let sawHeader = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const toks = line.includes(',') ? line.split(',') : line.split(/\s+|;|\t/);
    const c = toks.map((t) => t.trim()).filter(Boolean);
    if (c.length < 2) continue;
    const a = Number(c[0]);
    const b = Number(c[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      pts.push({ strain: a, stress: b });
    } else if (!sawHeader && pts.length === 0) {
      sawHeader = true; // header row
    }
  }
  return normalize(pts);
}

function parseJson(text: string): SSPoint[] {
  try {
    const obj = JSON.parse(text);
    const arr: unknown = Array.isArray(obj) ? obj : Array.isArray((obj as { data?: unknown }).data) ? (obj as { data: unknown }).data : [];
    const raw = arr as Array<Record<string, unknown>>;
    const pts: SSPoint[] = [];
    for (const r of raw) {
      const s = (r.strain ?? r.e ?? r.strain_percent ?? r.epsilon) as number | undefined;
      const sig = (r.stress ?? r.sigma ?? r.s) as number | undefined;
      if (typeof s === 'number' && typeof sig === 'number') pts.push({ strain: s, stress: sig });
    }
    return normalize(pts);
  } catch {
    return [];
  }
}

/** If strains span ≥ 1, assume they are in %; convert to fraction. */
function normalize(pts: SSPoint[]): SSPoint[] {
  if (pts.length < 3) return [];
  const maxS = Math.max(...pts.map((p) => p.strain));
  const factor = maxS >= 1.5 ? 0.01 : 1;
  const out = pts.map((p) => ({ strain: p.strain * factor, stress: p.stress }));
  out.sort((a, b) => a.strain - b.strain);
  return out;
}

// ---- elastic region & Young's modulus --------------------------------------

/**
 * Auto-detect the elastic region: slide a small window (5–10 points) over
 * the curve, pick the window of maximum least-squares slope, then extend
 * forward while the slope stays within 15 % of the maximum — this localises
 * the steepest initial linear branch even when the elastic region is a tiny
 * fraction of the curve (fine-sampled tensile data). Returns [start, end).
 */
export function detectElasticRegion(curve: SSPoint[]): [number, number] {
  const n = curve.length;
  if (n < 5) return [0, Math.min(n, 5)];
  // A small window isolates the elastic branch even when it is < 1 % of the
  // sampled points; 8 % would average in plastic deformation and understate E.
  const win = Math.max(4, Math.min(10, Math.floor(n * 0.015)));
  let bestSlope = -Infinity;
  let bestStart = 0;
  for (let i = 0; i + win <= n; i += 1) {
    const seg = curve.slice(i, i + win);
    const { slope } = linreg(seg.map((p) => ({ x: p.strain, y: p.stress })));
    if (slope > bestSlope && Number.isFinite(slope)) {
      bestSlope = slope;
      bestStart = i;
    }
  }
  // Extend the elastic region forward while the local slope stays within
  // 8 % of the best — stops at the proportional limit before yield-plateau
  // contamination dilutes the modulus.
  let end = bestStart + win;
  while (end < n && end - bestStart < Math.floor(n * 0.5)) {
    const seg = curve.slice(bestStart, end + 1);
    const { slope } = linreg(seg.map((p) => ({ x: p.strain, y: p.stress })));
    if (slope < bestSlope * 0.92) break;
    end += 1;
  }
  return [bestStart, Math.min(end, n)];
}

/** Least-squares fit y = a + b·x over the given points. Returns slope b, intercept a, R². */
export function linreg(pts: Array<{ x: number; y: number }>): { slope: number; intercept: number; r2: number } {
  const n = pts.length;
  if (n < 2) return { slope: NaN, intercept: NaN, r2: NaN };
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    sxy += p.x * p.y;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-18) return { slope: NaN, intercept: NaN, r2: NaN };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  // R²
  const yMean = sy / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const p of pts) {
    const yHat = intercept + slope * p.x;
    ssTot += (p.y - yMean) ** 2;
    ssRes += (p.y - yHat) ** 2;
  }
  const r2 = ssTot > 1e-18 ? 1 - ssRes / ssTot : 0;
  return { slope, intercept, r2 };
}

// ---- full tensile-property extraction --------------------------------------

export function analyseTensile(curve: SSPoint[]): TensileResult | null {
  if (curve.length < 5) return null;
  const [eStart, eEnd] = detectElasticRegion(curve);
  const elastic = curve.slice(eStart, eEnd);
  const { slope: E_MPa, intercept: E_b } = linreg(elastic.map((p) => ({ x: p.strain, y: p.stress })));
  // Young's modulus in GPa (slope is in MPa / (mm/mm) = MPa, → GPa by /1000).
  const E_GPa = E_MPa / 1000;

  // UTS: max stress, its index, and uniform elongation.
  let utsIdx = 0;
  for (let i = 1; i < curve.length; i += 1) {
    if (curve[i]!.stress > curve[utsIdx]!.stress) utsIdx = i;
  }
  const UTS = curve[utsIdx]!.stress;
  const uniformElong = curve[utsIdx]!.strain;

  // Fracture: last point.
  const fracture = curve[curve.length - 1]!;
  const fractureStress = fracture.stress;
  const fractureStrain = fracture.strain;

  // 0.2 % offset yield: elastic line shifted by +0.002 strain; find the
  // intersection with the curve (first crossing after the elastic region).
  const yieldLineStrain = (i: number) => curve[i]!.strain + 0.002;
  const yieldLineStress = (i: number) => E_b + E_MPa * yieldLineStrain(i);
  let yieldIdx = -1;
  for (let i = eEnd; i < curve.length; i += 1) {
    // Curve stress vs offset-line stress at same index.
    const lineStress = yieldLineStress(i);
    if (curve[i]!.stress >= lineStress) {
      yieldIdx = i;
      break;
    }
  }
  // Fallback: if the offset never crosses (rare), use the proportional limit.
  if (yieldIdx < 0) yieldIdx = eEnd;
  const yieldStrength = curve[yieldIdx]!.stress;

  // Hollomon: σ = K·ε_p^n on uniform-plastic region [yield, UTS].
  // ε_p = ε_total − σ/E (engineering plastic strain via elastic removal).
  const plasticPts: Array<{ x: number; y: number }> = [];
  for (let i = yieldIdx; i <= utsIdx && i < curve.length; i += 1) {
    const s = curve[i]!.stress;
    const e = curve[i]!.strain;
    const ep = e - s / (E_MPa || 1);
    if (ep > 1e-6 && s > 0) plasticPts.push({ x: Math.log(ep), y: Math.log(s) });
  }
  let hollomonN = NaN;
  let hollomonK = NaN;
  let hollomonR2 = NaN;
  if (plasticPts.length >= 3) {
    const { slope, intercept, r2 } = linreg(plasticPts);
    if (Number.isFinite(slope)) {
      hollomonN = slope;
      hollomonK = Math.exp(intercept);
      hollomonR2 = r2;
    }
  }

  // Resilience: area under curve from 0 to yield (trapezoidal).
  const resilience = trapezoidArea(curve.slice(0, yieldIdx + 1));
  // Toughness: total area under the curve.
  const toughness = trapezoidArea(curve);

  return {
    youngsModulus: E_GPa,
    yieldStrength02: yieldStrength,
    ultimateTensile: UTS,
    fractureStress,
    fractureStrain,
    uniformElongation: uniformElong,
    elongation: fractureStrain * 100,
    hollomonN,
    hollomonK,
    hollomonR2,
    resilience,
    toughness,
    elasticStart: eStart,
    elasticEnd: eEnd,
    yieldIdx,
    utsIdx,
  };
}

/** Trapezoidal area under a (strain, stress) curve → MJ/m³ (1 MPa·(mm/mm) = 1 MJ/m³). */
export function trapezoidArea(pts: SSPoint[]): number {
  if (pts.length < 2) return 0;
  let a = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const dx = pts[i]!.strain - pts[i - 1]!.strain;
    if (dx <= 0) continue;
    a += (dx * (pts[i]!.stress + pts[i - 1]!.stress)) / 2;
  }
  return a;
}
