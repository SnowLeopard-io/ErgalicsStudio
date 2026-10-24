// ==========================================================================
// chem-titration — acid–base titration numerics (pure, dependency-free)
//
// Full ionic-balance solver: at every added titrant volume the proton
// concentration [H+] is the root of the *charge-balance* equation
//     [H+] + [Na+] = [OH-] + [A-]
// closed with (i) the mass balance of the diluted analytical acid
// concentration, (ii) the acid dissociation equilibrium
// Ka = [H+][A-]/[HA], and (iii) water auto-ionisation Kw = [H+][OH-].
// Including Kw is what puts the equivalence point of a strong-acid /
// strong-base titration at pH 7.00 instead of drifting off it.
//
// The residual f(h) = [H+] + [Na+] - [OH-] - [A-] is strictly monotonically
// increasing in h = [H+] on (0, ∞) — every term of df/dh is non-negative —
// so a Newton-Raphson iteration with a bisection safeguard inside a fixed
// bracket converges to machine precision. All functions are pure so the
// kernel unit-tests without a canvas or DOM.
// ==========================================================================

/** Ionic product of water at 25 °C (mol²·L⁻²), pKw = 14.00. */
export const KW = 1e-14;

/** Lower/upper bracket for h = [H+]: f(1e-16) < 0 and f(100) > 0 always. */
const H_LO = 1e-16;
const H_HI = 100;

export type AcidKind = 'strong' | 'weak';

export interface AcidSpec {
  kind: AcidKind;
  /** Acid concentration before titration (mol/L). */
  conc: number;
  /** Acid sample volume (mL). */
  volume: number;
  /** Titrant concentration (strong monoprotic base, NaOH) (mol/L). */
  baseConc: number;
  /** Acid dissociation constant; ignored for strong acids (complete). */
  ka: number;
}

export interface TitrationPoint {
  /** Added titrant volume (mL). */
  vBase: number;
  /** pH = −log10[H+]. */
  ph: number;
  /** [H+] (mol/L). */
  h: number;
}

// ---- reference acids (25 °C textbook Ka values) -----------------------------

export interface AcidPreset {
  key: string;
  en: string;
  zh: string;
  /** mol/L; Infinity encodes a strong acid (complete dissociation). */
  ka: number;
}

export const ACID_PRESETS: AcidPreset[] = [
  { key: 'strong', en: 'HCl (strong)', zh: '盐酸 HCl（强酸）', ka: Number.POSITIVE_INFINITY },
  { key: 'hac', en: 'Acetic acid HAc', zh: '乙酸 HAc', ka: 1.8e-5 },
  { key: 'hcooh', en: 'Formic acid', zh: '甲酸 HCOOH', ka: 1.8e-4 },
  { key: 'hf', en: 'Hydrofluoric acid', zh: '氢氟酸 HF', ka: 6.8e-4 },
  { key: 'hcn', en: 'Hydrocyanic acid', zh: '氢氰酸 HCN', ka: 6.2e-10 },
];

// ---- equilibrium bookkeeping -------------------------------------------------

/** Diluted total (analytical) acid concentration at added volume v (mol/L). */
export function dilutedAcid(a: AcidSpec, v: number): number {
  return (a.conc * a.volume) / (a.volume + v);
}

/** Diluted sodium concentration from the strong-base titrant at volume v (mol/L). */
export function dilutedNa(a: AcidSpec, v: number): number {
  return (a.baseConc * v) / (a.volume + v);
}

/**
 * [A-] from the mass balance + Ka equilibrium at a trial [H+]:
 * [A-] = Ca·Ka/(Ka+[H+]) for a weak acid; complete dissociation
 * ([A-] = Ca) for a strong acid (Ka = ∞).
 */
export function aMinus(h: number, caTotal: number, ka: number): number {
  if (!Number.isFinite(ka)) return caTotal;
  return (caTotal * ka) / (ka + h);
}

/** Charge-balance residual f(h) = [H+] + [Na+] − [OH−] − [A−]. */
export function chargeResidual(h: number, na: number, caTotal: number, ka: number): number {
  return h + na - KW / h - aMinus(h, caTotal, ka);
}

/** df/dh — all three terms are ≥ 0, hence f is strictly increasing in h. */
export function chargeResidualSlope(h: number, caTotal: number, ka: number): number {
  const strong = !Number.isFinite(ka);
  return 1 + KW / (h * h) + (strong ? 0 : (caTotal * ka) / ((ka + h) * (ka + h)));
}

export interface SolveOptions {
  /** Relative tolerance on the h iterate (default 1e-12). */
  tol?: number;
  /** Iteration cap (default 200). */
  maxIter?: number;
}

/**
 * Solve the charge balance for h = [H+] by bracketed Newton–Raphson.
 * The bisection midpoint is taken whenever the Newton step leaves the
 * current bracket, so convergence never diverges.
 */
export function solveH(na: number, caTotal: number, ka: number, opts: SolveOptions = {}): number {
  const tol = opts.tol ?? 1e-12;
  const maxIter = opts.maxIter ?? 200;
  let lo = H_LO;
  let hi = H_HI;
  // Chemistry-informed initial guess: neutral water, weak-acid dilution law,
  // or the strong-acid concentration — whichever proton source dominates.
  const weakGuess = Number.isFinite(ka) ? Math.sqrt(Math.max(ka * caTotal, 0)) : 0;
  let h = Math.max(Math.sqrt(KW), weakGuess, Number.isFinite(ka) ? 0 : caTotal);
  if (!(h > H_LO) || !(h < H_HI)) h = Math.sqrt(H_LO * H_HI);
  for (let i = 0; i < maxIter; i += 1) {
    const f = chargeResidual(h, na, caTotal, ka);
    if (f > 0) hi = h;
    else if (f < 0) lo = h;
    else return h;
    const slope = chargeResidualSlope(h, caTotal, ka);
    let next = h - f / slope;
    if (!Number.isFinite(next) || next <= lo || next >= hi) next = Math.sqrt(lo * hi);
    if (Math.abs(next - h) <= tol * h) return next;
    h = next;
  }
  return h;
}

/** pH at a given added titrant volume (mL). */
export function phAt(a: AcidSpec, v: number, tol = 1e-12): number {
  const h = solveH(dilutedNa(a, v), dilutedAcid(a, v), a.ka, { tol });
  return -Math.log10(h);
}

// ---- titration curve ---------------------------------------------------------

export interface CurveOptions {
  /** Relative [H+] tolerance forwarded to the solver. */
  tol?: number;
  /** Number of volume samples (default 400). */
  steps?: number;
  /** Maximum plotted/added volume (mL); defaults to 2× the equivalence volume. */
  vMax?: number;
}

/** Equivalence volume: monoprotic acid + monohydroxide base → n(OH⁻) = n(HA). */
export function equivalenceVolume(a: AcidSpec): number {
  return (a.conc * a.volume) / a.baseConc;
}

/** Full pH(V) titration curve from v = 0 to vMax. */
export function titrationCurve(a: AcidSpec, opts: CurveOptions = {}): TitrationPoint[] {
  if (!(a.baseConc > 0)) {
    throw new Error('Base concentration must be positive (no equivalence volume exists otherwise)');
  }
  const steps = Math.max(2, Math.floor(opts.steps ?? 400));
  const vEq = equivalenceVolume(a);
  const vMax = opts.vMax ?? 2 * vEq;
  const pts: TitrationPoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const v = (vMax * i) / steps;
    const h = solveH(dilutedNa(a, v), dilutedAcid(a, v), a.ka, { tol: opts.tol });
    pts.push({ vBase: v, ph: -Math.log10(h), h });
  }
  return pts;
}

// ---- analytic references (benchmark oracles) ---------------------------------

/** Relative error |computed − reference| / |reference| (unified criterion). */
export function relErr(computed: number, reference: number): number {
  return Math.abs(computed - reference) / Math.abs(reference);
}

/**
 * Analytic initial pH from the dilution law:
 * strong acid  [H+] = (Ca + √(Ca²+4Kw))/2 (includes water auto-ionisation);
 * weak acid    the exact quadratic of Ka = h²/(Ca−h) → h = (−Ka+√(Ka²+4KaCa))/2.
 */
export function initialPhAnalytic(a: AcidSpec): number {
  const c = a.conc;
  if (a.kind === 'strong' || !Number.isFinite(a.ka)) {
    const h = (c + Math.sqrt(c * c + 4 * KW)) / 2;
    return -Math.log10(h);
  }
  const ka = a.ka;
  const h = (-ka + Math.sqrt(ka * ka + 4 * ka * c)) / 2;
  return -Math.log10(h);
}

/**
 * Analytic equivalence pH.
 * Strong acid + strong base: exactly neutral, pH = ½pKw = 7.00.
 * Weak acid: hydrolysis of A− past equivalence, the classic
 * pH = ½(pKw + pKa + lg c_salt) with c_salt the diluted salt concentration.
 */
export function equivalencePhAnalytic(a: AcidSpec): number {
  if (a.kind === 'strong' || !Number.isFinite(a.ka)) return -Math.log10(Math.sqrt(KW));
  const vEq = equivalenceVolume(a);
  const cSalt = (a.conc * a.volume) / (a.volume + vEq);
  const pKw = -Math.log10(KW);
  const pKa = -Math.log10(a.ka);
  return 0.5 * (pKw + pKa + Math.log10(cSalt));
}

/**
 * Henderson–Hasselbalch anchor: at half equivalence [A−] = [HA] so
 * pH ≈ pKa (the numeric solution also carries the small water term).
 */
export function pKaOf(a: AcidSpec): number {
  return Number.isFinite(a.ka) ? -Math.log10(a.ka) : Number.NaN;
}

// ---- indicators ---------------------------------------------------------------

export interface Indicator {
  key: string;
  en: string;
  zh: string;
  /** Transition range in pH units. */
  low: number;
  high: number;
  /** Translucent canvas fill for the overlay band. */
  color: string;
}

/** Textbook transition ranges of the two most common acid–base indicators. */
export const INDICATORS: Indicator[] = [
  { key: 'methyl-orange', en: 'Methyl orange 3.1–4.4', zh: '甲基橙 3.1–4.4', low: 3.1, high: 4.4, color: 'rgba(255,150,60,0.16)' },
  { key: 'phenolphthalein', en: 'Phenolphthalein 8.2–10.0', zh: '酚酞 8.2–10.0', low: 8.2, high: 10.0, color: 'rgba(235,110,220,0.16)' },
];
