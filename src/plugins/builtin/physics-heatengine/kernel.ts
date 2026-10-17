// ==========================================================================
// physics-heatengine — ideal-gas heat-engine cycle kernels (pure, no DOM)
//
// Air-standard cycles on n moles of an ideal gas (p V = n R T,
// U = n c_v T with c_v = R/(gamma-1)), evaluated quasi-statically:
//   - Otto      1->2 adiabatic compression, 2->3 isochoric heat addition,
//               3->4 adiabatic expansion, 4->1 isochoric cooling
//   - Diesel    1->2 adiabatic compression, 2->3 isobaric heat addition
//               (cutoff ratio rc = V3/V2), 3->4 adiabatic expansion,
//               4->1 isochoric cooling
//   - Carnot    adiabatic / hot isotherm / adiabatic / cold isotherm
//   - Stirling  isochore / hot isotherm / isochore / cold isotherm, with an
//               optional perfect regenerator absorbing both isochores
//
// Work is the trapezoid rule W = closed-p integral p dV sampled uniformly in
// ln V (p is a smooth exponential in ln V for every branch, so 1500 samples
// per branch land the efficiency at ~1e-8 relative accuracy or better).
// Branch heat follows the first law Q = dU + W. Efficiency eta = W / Q_in is
// cross-checked against the closed forms:
//   Otto    eta = 1 - r^(1-gamma)
//   Diesel  eta = 1 - r^(1-gamma) (rc^gamma - 1) / (gamma (rc - 1))
//   Carnot  eta = 1 - Tc/Th,  W = n R (Th - Tc) ln r
//   Stirling regen eta = 1 - Tc/Th; non-regen eta = W / (n R Th ln r + n c_v dT)
//
// Invalid parameter combinations return null rather than throwing, so the
// UI can fall back to a "fix the parameters" state.
// ==========================================================================

/** Universal gas constant J/(mol K). */
export const R = 8.31446261815324;

/** Trapezoid samples per cycle branch (uniform in ln V). */
export const SEGMENT_POINTS = 1500;

export type EngineCycle = 'otto' | 'diesel' | 'carnot' | 'stirling';
export type SegmentKind = 'isochoric' | 'isothermal' | 'adiabatic' | 'isobaric';

export interface EngineInput {
  cycle: EngineCycle;
  /** Working-fluid amount (mol). */
  n: number;
  /** Ratio of specific heats cp/cv (> 1; air ~ 1.4). */
  gamma: number;
  /** Cold-end / compression-start temperature (K). */
  Tcold: number;
  /**
   * Hot-end / peak temperature (K). Otto and Carnot/Stirling take it
   * directly; for Diesel the peak temperature is fixed by the cutoff ratio
   * instead (isobaric branch: T3 = T2 * rc), so `Thot` is unused there.
   */
  Thot: number;
  /**
   * Volume ratio (> 1): compression ratio Vmax/Vmin for Otto and Diesel,
   * isothermal volume ratio V3/V2 for Carnot, Vmax/Vmin for Stirling.
   */
  ratio: number;
  /** Diesel cutoff ratio V3/V2 (> 1, <= ratio); ignored by other cycles. */
  cutoff: number;
  /** Stirling only: perfect regenerator absorbs both isochores. */
  regenerative: boolean;
  /** Minimum cycle volume (m^3); the default engine uses 1e-3. */
  Vmin: number;
}

export interface EngineSegment {
  kind: SegmentKind;
  Va: number;
  Ta: number;
  Vb: number;
  Tb: number;
  /** Trapezoid work integral of the branch (J). */
  W: number;
  /** Branch heat, Q = dU + W (J); sign says absorbed (+) or rejected (-). */
  Q: number;
  /** Stirling isochore handled internally by the regenerator. */
  regenerated: boolean;
}

export interface EngineStatePoint {
  /** Corner index 1..4 in cycle order. */
  label: string;
  V: number;
  T: number;
  p: number;
}

export interface EngineResult {
  cycle: EngineCycle;
  states: EngineStatePoint[];
  segments: EngineSegment[];
  /** Net work W = (closed-p) integral p dV (J). */
  W: number;
  /** External heat absorbed from the hot reservoir (J). */
  Qin: number;
  /** External heat rejected to the cold reservoir, >= 0 (J). */
  Qout: number;
  /** Thermal efficiency eta = W / Qin. */
  eta: number;
  /** Closed-form reference efficiency. */
  etaAnalytic: number;
  /** First-law closure residual W - (Qin - Qout) (J). */
  closure: number;
  pMax: number;
  pMin: number;
}

/**
 * Evaluate one ideal-gas cycle. Returns null for physically meaningless
 * inputs (non-positive n / Tcold / Vmin, gamma <= 1, ratio <= 1, a hot
 * temperature that leaves no heat input, a Diesel cutoff outside (1, ratio]).
 */
export function computeCycle(input: EngineInput): EngineResult | null {
  const { cycle, gamma, ratio, cutoff, regenerative } = input;
  const n = input.n;
  const Tcold = input.Tcold;
  const Thot = input.Thot;
  const Vmin = input.Vmin;
  const finite =
    Number.isFinite(n) && Number.isFinite(gamma) && Number.isFinite(Tcold) &&
    Number.isFinite(Thot) && Number.isFinite(ratio) && Number.isFinite(cutoff) &&
    Number.isFinite(Vmin);
  if (!finite || n <= 0 || gamma <= 1 || Tcold <= 0 || ratio <= 1 || Vmin <= 0) return null;

  const cv = R / (gamma - 1);
  const Vmax = Vmin * ratio;
  const pow = Math.pow;
  let segs: Array<Omit<EngineSegment, 'W' | 'Q'>>;
  let states: EngineStatePoint[];
  let etaAnalytic: number;

  switch (cycle) {
    case 'otto': {
      const T2 = Tcold * pow(ratio, gamma - 1);
      const T4 = Thot / pow(ratio, gamma - 1);
      // The isochoric heat input must stay positive, otherwise there is no engine.
      if (!Number.isFinite(T4) || !(Thot > T2)) return null;
      segs = [
        { kind: 'adiabatic', Va: Vmax, Ta: Tcold, Vb: Vmin, Tb: T2, regenerated: false },
        { kind: 'isochoric', Va: Vmin, Ta: T2, Vb: Vmin, Tb: Thot, regenerated: false },
        { kind: 'adiabatic', Va: Vmin, Ta: Thot, Vb: Vmax, Tb: T4, regenerated: false },
        { kind: 'isochoric', Va: Vmax, Ta: T4, Vb: Vmax, Tb: Tcold, regenerated: false },
      ];
      states = [
        st(1, Vmax, Tcold, n), st(2, Vmin, T2, n), st(3, Vmin, Thot, n), st(4, Vmax, T4, n),
      ];
      etaAnalytic = 1 - pow(ratio, 1 - gamma);
      break;
    }
    case 'diesel': {
      if (cutoff <= 1 || cutoff > ratio) return null;
      const T2 = Tcold * pow(ratio, gamma - 1);
      const T3 = T2 * cutoff;
      const V3 = Vmin * cutoff;
      const T4 = T3 * pow(V3 / Vmax, gamma - 1);
      segs = [
        { kind: 'adiabatic', Va: Vmax, Ta: Tcold, Vb: Vmin, Tb: T2, regenerated: false },
        { kind: 'isobaric', Va: Vmin, Ta: T2, Vb: V3, Tb: T3, regenerated: false },
        { kind: 'adiabatic', Va: V3, Ta: T3, Vb: Vmax, Tb: T4, regenerated: false },
        { kind: 'isochoric', Va: Vmax, Ta: T4, Vb: Vmax, Tb: Tcold, regenerated: false },
      ];
      states = [
        st(1, Vmax, Tcold, n), st(2, Vmin, T2, n), st(3, V3, T3, n), st(4, Vmax, T4, n),
      ];
      etaAnalytic =
        1 - pow(ratio, 1 - gamma) * ((pow(cutoff, gamma) - 1) / (gamma * (cutoff - 1)));
      break;
    }
    case 'carnot': {
      if (!(Thot > Tcold)) return null;
      // Adiabat volume factor between the cold and hot isotherms (< 1).
      const fC = pow(Tcold / Thot, 1 / (gamma - 1));
      const V2 = Vmin;
      const V1 = V2 / fC;
      const V3 = V2 * ratio;
      const V4 = V3 / fC;
      segs = [
        { kind: 'adiabatic', Va: V1, Ta: Tcold, Vb: V2, Tb: Thot, regenerated: false },
        { kind: 'isothermal', Va: V2, Ta: Thot, Vb: V3, Tb: Thot, regenerated: false },
        { kind: 'adiabatic', Va: V3, Ta: Thot, Vb: V4, Tb: Tcold, regenerated: false },
        { kind: 'isothermal', Va: V4, Ta: Tcold, Vb: V1, Tb: Tcold, regenerated: false },
      ];
      states = [
        st(1, V1, Tcold, n), st(2, V2, Thot, n), st(3, V3, Thot, n), st(4, V4, Tcold, n),
      ];
      etaAnalytic = 1 - Tcold / Thot;
      break;
    }
    case 'stirling': {
      if (!(Thot > Tcold)) return null;
      segs = [
        { kind: 'isochoric', Va: Vmin, Ta: Tcold, Vb: Vmin, Tb: Thot, regenerated: regenerative },
        { kind: 'isothermal', Va: Vmin, Ta: Thot, Vb: Vmax, Tb: Thot, regenerated: false },
        { kind: 'isochoric', Va: Vmax, Ta: Thot, Vb: Vmax, Tb: Tcold, regenerated: regenerative },
        { kind: 'isothermal', Va: Vmax, Ta: Tcold, Vb: Vmin, Tb: Tcold, regenerated: false },
      ];
      states = [
        st(1, Vmin, Tcold, n), st(2, Vmin, Thot, n), st(3, Vmax, Thot, n), st(4, Vmax, Tcold, n),
      ];
      etaAnalytic = regenerative
        ? 1 - Tcold / Thot
        : (n * R * (Thot - Tcold) * Math.log(ratio)) /
          (n * R * Thot * Math.log(ratio) + n * cv * (Thot - Tcold));
      break;
    }
    default:
      return null;
  }

  const segments: EngineSegment[] = segs.map((s) => {
    const { W, Q } = integrateSegment(s, n, gamma);
    return { ...s, W, Q };
  });

  let W = 0;
  let Qin = 0;
  let Qout = 0;
  let sumQ = 0;
  let pMax = 0;
  let pMin = Infinity;
  for (const s of segments) {
    W += s.W;
    sumQ += s.Q;
    // Adiabatic branches exchange no heat by definition; their tiny nonzero
    // Q is pure quadrature residual and must stay out of Qin/Qout. Stirling
    // isochores bypassed by a perfect regenerator are internal as well.
    if (s.kind === 'adiabatic' || s.regenerated) continue;
    if (s.Q > 0) Qin += s.Q;
    else Qout += -s.Q;
  }
  for (const p of states) {
    pMax = Math.max(pMax, p.p);
    pMin = Math.min(pMin, p.p);
  }
  // First-law closure against ALL branch heats (regenerated pairs cancel and
  // the branch dU terms telescope to ~machine epsilon over the closed loop).
  const closure = W - sumQ;
  return {
    cycle,
    states,
    segments,
    W,
    Qin,
    Qout,
    eta: Qin > 0 ? W / Qin : NaN,
    etaAnalytic,
    closure,
    pMax,
    pMin,
  };
}

function st(label: number, V: number, T: number, n: number): EngineStatePoint {
  return { label: String(label), V, T, p: (n * R * T) / V };
}

/** Pressure along a branch at volume V (ideal-gas branch relation). */
export function segmentPressure(s: Pick<EngineSegment, 'kind' | 'Va' | 'Ta'>, V: number, n: number, gamma: number): number {
  switch (s.kind) {
    case 'isothermal':
      return (n * R * s.Ta) / V;
    case 'isobaric':
      return (n * R * s.Ta) / s.Va;
    case 'adiabatic':
      return (n * R * s.Ta * Math.pow(s.Va, gamma - 1)) / Math.pow(V, gamma);
    case 'isochoric':
      return (n * R * s.Ta) / s.Va;
  }
}

/** Trapezoid work of one branch (uniform sampling in ln V) plus Q = dU + W. */
function integrateSegment(
  s: Pick<EngineSegment, 'kind' | 'Va' | 'Ta' | 'Vb' | 'Tb'>,
  n: number,
  gamma: number,
): { W: number; Q: number } {
  const dU = (n * R * (s.Tb - s.Ta)) / (gamma - 1);
  if (s.kind === 'isochoric' || s.Va === s.Vb) return { W: 0, Q: dU };
  const ua = Math.log(s.Va);
  const ub = Math.log(s.Vb);
  const du = (ub - ua) / SEGMENT_POINTS;
  let Vprev = s.Va;
  let pPrev = segmentPressure(s, Vprev, n, gamma);
  let W = 0;
  for (let i = 1; i <= SEGMENT_POINTS; i++) {
    const V = Math.exp(ua + du * i);
    const p = segmentPressure(s, V, n, gamma);
    W += (0.5 * (pPrev + p)) * (V - Vprev);
    Vprev = V;
    pPrev = p;
  }
  return { W, Q: dU + W };
}

/**
 * Evenly log-spaced points along a branch for plotting (endpoints inclusive).
 * Isochores return the two endpoints so the vertical line renders correctly.
 */
export function sampleSegment(
  s: Pick<EngineSegment, 'kind' | 'Va' | 'Ta' | 'Vb' | 'Tb'>,
  n: number,
  gamma: number,
  points = 160,
): Array<{ V: number; p: number }> {
  if (s.kind === 'isochoric' || s.Va === s.Vb) {
    const p = segmentPressure(s, s.Va, n, gamma);
    return [
      { V: s.Va, p },
      { V: s.Va, p },
    ];
  }
  const ua = Math.log(s.Va);
  const ub = Math.log(s.Vb);
  const m = Math.max(2, Math.round(points));
  const out: Array<{ V: number; p: number }> = [];
  for (let i = 0; i < m; i++) {
    const V = Math.exp(ua + ((ub - ua) * i) / (m - 1));
    out.push({ V, p: segmentPressure(s, V, n, gamma) });
  }
  return out;
}
