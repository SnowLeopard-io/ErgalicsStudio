// ==========================================================================
// bio-epidemic — deterministic compartment-model epidemiology (pure TS)
//
// SIR / SEIR ordinary differential-equation models advanced with an explicit
// classical RK4 integrator. All quantities are normalised by default so the
// model scales to any population; every run is fully deterministic (no RNG),
// which makes the trajectories, peak, final size and the effective-R₀ line
// exactly reproducible and unit-testable.
// ==========================================================================

export type EpidemicModel = 'SIR' | 'SEIR';

export interface ModelConfig {
  model: EpidemicModel;
  r0: number; // basic reproduction number (at t=0, fully susceptible)
  infectiousDays: number; // 1/γ
  latentDays: number; // 1/σ (SEIR only), ignored by SIR
  population: number;
  initialInfected: number;
  initialExposed: number; // SEIR only
  days: number;
  timeStep?: number; // integration step in days (default 0.05)
}

export interface Trajectory {
  days: number[];
  susceptible: number[];
  exposed?: number[]; // SEIR only
  infectious: number[];
  recovered: number[];
  /** effective reproduction number R_eff = R₀·S/N over time. */
  rEff: number[];
}

export interface EpidemicReport {
  peakInfectious: number; // absolute count
  peakDay: number;
  peakFraction: number; // I/N at peak
  finalRecoveredFraction: number;
  finalSusceptibleFraction: number;
  totalCasesFraction: number;
  r0: number;
  herdImmunityFraction: number; // 1 − 1/R₀ (when R₀>1)
  attackRateFraction: number; // cumulative attack rate at end
}

/** R₀ from contact rate β (per day) and removal rate γ=1/D: R₀ = β/γ. */
export function reproductionFromβ(β: number, infectiousDays: number): number {
  return β * infectiousDays;
}

function rhs(cfg: ModelConfig, y: number[], pop: number): number[] {
  const β = cfg.r0 / cfg.infectiousDays;
  const γ = 1 / cfg.infectiousDays;
  const S = y[0]!;
  const isSEIR = cfg.model === 'SEIR';
  // infectious compartment is index 1 in SIR, index 2 in SEIR
  const I = y[isSEIR ? 2 : 1]!;
  const infection = (β * S * I) / pop;
  const dS = -infection;
  if (!isSEIR) return [dS, infection - γ * I, γ * I];
  const E = y[1]!;
  const σ = 1 / cfg.latentDays;
  const latent = infection - σ * E;
  const infectious = σ * E - γ * I;
  return [dS, latent, infectious, γ * I];
}

/** Advance one RK4 step of a copy of `y`, returning the new state. */
function rk4Step(cfg: ModelConfig, y: number[], pop: number, h: number): number[] {
  const k1 = rhs(cfg, y, pop);
  const k2 = rhs(
    cfg,
    y.map((v, i) => v + 0.5 * h * k1[i]!),
    pop,
  );
  const k3 = rhs(
    cfg,
    y.map((v, i) => v + 0.5 * h * k2[i]!),
    pop,
  );
  const k4 = rhs(
    cfg,
    y.map((v, i) => v + h * k3[i]!),
    pop,
  );
  return y.map((v, i) => {
    const next = v + (h / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
    return next < 0 ? 0 : next;
  });
}

/**
 * Integrate the model from t=0 to `days`, returning daily samples. Conserves
 * total population to within RK4 rounding error.
 */
export function simulateEpidemic(cfg: ModelConfig): Trajectory {
  const pop = Math.max(1, cfg.population);
  const n = cfg.model === 'SIR' ? 3 : 4;
  const i0 = Math.min(Math.max(1, cfg.initialInfected), pop);
  const e0 = Math.min(Math.max(0, cfg.initialExposed), pop - i0);
  const s0 = Math.max(0, pop - i0 - e0);
  const y0 = cfg.model === 'SIR' ? [s0, i0, 0] : [s0, e0, i0, 0];

  const h = Math.max(0.001, cfg.timeStep ?? 0.05);
  const steps = Math.max(2, Math.round(cfg.days / h));
  const traj = integrate(cfg, y0, h, steps);
  const N = pop;
  if (n === 3) {
    const rEff = traj.susceptible.map((s) => (cfg.r0 * s) / N);
    return {
      days: traj.days,
      susceptible: traj.susceptible,
      infectious: traj.infectious,
      recovered: traj.recovered,
      rEff,
    };
  }
  const rEff2 = traj.susceptible.map((s) => (cfg.r0 * s) / N);
  return {
    days: traj.days,
    susceptible: traj.susceptible,
    exposed: traj.exposed,
    infectious: traj.infectious,
    recovered: traj.recovered,
    rEff: rEff2,
  };
}

/** Clean daily integration (kept separate from the reporting loop). */
function integrate(cfg: ModelConfig, y0: number[], h: number, steps: number): {
  days: number[];
  susceptible: number[];
  exposed?: number[];
  infectious: number[];
  recovered: number[];
} {
  const days: number[] = [];
  const sus: number[] = [];
  const ex: number[] = [];
  const inf: number[] = [];
  const rec: number[] = [];
  let y = y0.slice();
  const isSEIR = cfg.model === 'SEIR';
  for (let k = 0; k <= steps; k += 1) {
    const t = k * h;
    const whole = Math.abs(t % 1) < h / 2 || Math.abs(t % 1) > 1 - h / 2;
    if (k === 0 || whole || k === steps) {
      days.push(t);
      sus.push(y[0]!);
      if (isSEIR) ex.push(y[1]!);
      inf.push(isSEIR ? y[2]! : y[1]!);
      rec.push(isSEIR ? y[3]! : y[2]!);
    }
    y = rk4Step(cfg, y, cfg.population, h);
  }
  return { days, susceptible: sus, exposed: isSEIR ? ex : undefined, infectious: inf, recovered: rec };
}

/** Derive the headline metrics from an integrated trajectory. */
export function reportEpidemic(cfg: ModelConfig, traj: Trajectory): EpidemicReport {
  const N = Math.max(1, cfg.population);
  let peakInf = 0;
  let peakIdx = 0;
  for (let i = 0; i < traj.infectious.length; i += 1) {
    if (traj.infectious[i]! > peakInf) {
      peakInf = traj.infectious[i]!;
      peakIdx = i;
    }
  }
  const lastRec = traj.recovered[traj.recovered.length - 1]!;
  const lastSus = traj.susceptible[traj.susceptible.length - 1]!;
  // Cumulative attack rate = fraction ever infected = 1 − S(t)/N. Using only
  // the recovered compartment omits cases still in E/I at the final time.
  const everInfected = Math.max(0, Math.min(1, 1 - lastSus / N));
  const herd = cfg.r0 > 1 ? 1 - 1 / cfg.r0 : 0;
  return {
    peakInfectious: peakInf,
    peakDay: traj.days[peakIdx] ?? 0,
    peakFraction: peakInf / N,
    finalRecoveredFraction: lastRec / N,
    finalSusceptibleFraction: lastSus / N,
    totalCasesFraction: everInfected,
    r0: cfg.r0,
    herdImmunityFraction: herd,
    attackRateFraction: everInfected,
  };
}

/** Classic single-population default scenario (measles-like SIR demo). */
export const DEFAULT_CONFIG: ModelConfig = {
  model: 'SIR',
  r0: 4,
  infectiousDays: 5,
  latentDays: 5,
  population: 1_000_000,
  initialInfected: 10,
  initialExposed: 0,
  days: 120,
};

// ---- research-grade diagnostics (docs/technical/11 §2.4 / §3 L2) -----------

/**
 * Population-conservation diagnostic: max |N(t) − N₀| / N₀ over the sampled
 * trajectory, where N(t) is the sum of all compartments. A correct RK4
 * integration conserves N to rounding error; drift above ~1e-6 signals a
 * step-size or clipping problem.
 */
export function conservationDrift(traj: Trajectory, pop: number): number {
  const N = Math.max(1, pop);
  const hasE = Boolean(traj.exposed);
  let max = 0;
  for (let i = 0; i < traj.days.length; i += 1) {
    const n = traj.susceptible[i]! + traj.infectious[i]! + traj.recovered[i]! + (hasE ? traj.exposed![i]! : 0);
    const d = Math.abs(n - N) / N;
    if (d > max) max = d;
  }
  return max;
}

export interface EarlyGrowth {
  /** Fitted exponential growth rate r = d(ln I)/dt (per day). */
  growthRate: number;
  /** R_t from the early-growth relation (SEIR includes the latent delay). */
  rt: number;
  /** Number of log-slope points used. */
  points: number;
}

/**
 * Early-exponential-growth R_t estimate: log-linear fit of ln I(t) over the
 * rising segment before the peak, then the SIR relation R_t ≈ 1 + r/γ.
 * Returns null when the rising branch is too short to fit (≥4 points).
 */
export function earlyGrowthRt(cfg: ModelConfig, traj: Trajectory): EarlyGrowth | null {
  let peak = 0;
  for (let i = 0; i < traj.infectious.length; i += 1) {
    if (traj.infectious[i]! > traj.infectious[peak]!) peak = i;
  }
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 1; i <= peak && pts.length < 30; i += 1) {
    const v = traj.infectious[i]!;
    const prev = traj.infectious[i - 1]!;
    if (v > 0 && prev > 0 && v >= prev) pts.push({ x: traj.days[i]!, y: Math.log(v) });
    else break; // stop at the first non-growing sample
  }
  if (pts.length < 4) return null;
  const n = pts.length;
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
  const r = Math.abs(denom) < 1e-30 ? 0 : (n * sxy - sx * sy) / denom;
  // SIR: R = 1 + r/γ. SEIR adds the latent delay: R = (1 + r/γ)(1 + r/σ).
  const rt =
    cfg.model === 'SEIR'
      ? (1 + r * cfg.infectiousDays) * (1 + r * cfg.latentDays)
      : 1 + r * cfg.infectiousDays;
  return { growthRate: r, rt, points: n };
}

export interface FinalSizeCheck {
  /** −ln(s∞) from the simulated endpoint. */
  lhs: number;
  /** R₀·(1 − s∞) from the analytic final-size relation. */
  rhs: number;
  /** Relative discrepancy |lhs − rhs| / |lhs|. */
  relErr: number;
}

/**
 * Final-size relation check for the SIR/SEIR endpoint: s∞ must satisfy
 * −ln(s∞) = R₀·(1 − s∞), independent of the latent period. Returns null when
 * the endpoint is degenerate (s∞ = 0 or 1).
 */
export function finalSizeCheck(cfg: ModelConfig, traj: Trajectory): FinalSizeCheck | null {
  const N = Math.max(1, cfg.population);
  const sInf = traj.susceptible[traj.susceptible.length - 1]! / N;
  if (sInf <= 0 || sInf >= 1) return null;
  const s0 = Math.max(1e-12, traj.susceptible[0]! / N);
  // Final-size relation: −ln(s∞/s0) = R₀(1 − s∞).
  const lhs = -Math.log(sInf / s0);
  const rhs = cfg.r0 * (1 - sInf);
  return { lhs, rhs, relErr: Math.abs(lhs - rhs) / Math.abs(lhs) };
}

/** Parsed daily epidemic incidence series (observed data, not modeled). */
export interface ObservedSeries {
  /** Day index (0-based). */
  days: number[];
  /** Daily new (incident) cases per day. */
  newCases: number[];
  /** Running cumulative cases (derived when only new cases are supplied). */
  cumulative: number[];
}

function toNum(v: string): number {
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Parse an observed daily case-count series from CSV / TSV / JSON text.
 * Accepted tables: an optional header names the columns — the case column is
 * authoritative: tokens containing `cumul` are treated as cumulative counts
 * (new cases derived by first differences), otherwise the column is treated as
 * daily NEW cases. For header-less input we default to daily NEW cases.
 * Returns null when fewer than 2 day rows are found. */
export function parseObservedSeries(text: string): ObservedSeries | null {
  const trim = text.trim();
  if (!trim) return null;

  // JSON arrays of {day, cases} / {t, new_cases} / {day, cumulative} etc.
  if (trim.startsWith('[') || trim.startsWith('{')) {
    try {
      const json = JSON.parse(trim) as unknown;
      const arr = Array.isArray(json) ? json : (json as { data?: unknown; series?: unknown }).data ?? json;
      if (Array.isArray(arr) && arr.length > 0) {
        const days: number[] = [];
        const inc: number[] = [];
        let mode: 'new' | 'cum' | null = null;
        for (const it of arr) {
          if (!it || typeof it !== 'object') continue;
          const o = it as Record<string, unknown>;
          const d = toNum(String(o.day ?? o.date ?? o.t ?? o.x ?? 0));
          if (!Number.isFinite(d)) continue;
          const hasCum = 'cumulative' in o || 'cum' in o;
          const hasNew = 'new_cases' in o || 'new' in o || 'daily' in o;
          const c = toNum(
            String(o.cumulative ?? o.cum ?? o.new_cases ?? o.new ?? o.daily ?? o.cases ?? o.y ?? 0),
          );
          if (!Number.isFinite(c)) continue;
          if (mode === null) mode = hasCum && !hasNew ? 'cum' : 'new';
          days.push(d);
          inc.push(Math.max(0, c));
        }
        if (days.length >= 2 && days.length === inc.length) return buildSeries(days, inc, mode ?? inferSeriesType(inc));
      }
    } catch {
      /* fall through to table parsing */
    }
  }

  // Tabular CSV / TSV / whitespace.
  const rows = trim
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (rows.length === 0) return null;

  // Detect header: first row contains at least one non-numeric cell.
  const isNumericCell = (c: string) => c !== '' && /^-?\d+(\.\d+)?$/.test(c);
  const isHeader = rows[0]!.split(/[,;\t ]+/).some((c) => !isNumericCell(c));
  const headerCells = isHeader ? rows[0]!.split(/[,;\t ]+/).filter((c) => c !== '') : null;
  // headerCells = [dayToken, caseToken] (caseToken may be empty)
  const caseToken = headerCells && headerCells.length >= 2 ? headerCells[1]!.toLowerCase() : '';
  // Headered tables classify by the case-column token (cumul → cumulative);
  // bare header-less numeric pairs are daily (day, new-cases) by default.
  const mode: SeriesType =
    headerCells !== null && caseToken.includes('cumul') ? 'cum' : 'new';

  const body = isHeader ? rows.slice(1) : rows;
  const days: number[] = [];
  const inc: number[] = [];
  for (const row of body) {
    const cells = row.split(/[,;\t ]+/).filter((c) => c !== '');
    if (cells.length < 2) continue;
    const d = toNum(cells[0]!);
    const c = toNum(cells[cells.length - 1]!);
    if (!Number.isFinite(d) || !Number.isFinite(c)) continue;
    days.push(d);
    inc.push(Math.max(0, c));
  }
  if (days.length < 2) return null;
  return buildSeries(days, inc, mode);
}

type SeriesType = 'new' | 'cum' | 'auto';

/** Heuristic for header-less input: cumulative if values never decrease. */
function inferSeriesType(values: number[]): SeriesType {
  return values.every((v, i) => i === 0 || v >= values[i - 1]!) ? 'cum' : 'new';
}

/** Normalize day offsets to 0..max and derive both the cumulative and new-case axes. */
export function buildSeries(days: number[], incident: number[], mode: SeriesType = 'auto'): ObservedSeries {
  const min = Math.min(...days);
  const norm = days.map((d) => Math.round(d - min));
  const rounded = incident.map((v) => Math.max(0, Math.round(v)));
  const isCum = mode === 'cum' || (mode === 'auto' && inferSeriesType(rounded) === 'cum');
  if (isCum) {
    // Input is cumulative: new = first differences (>0), re-accumulate exactly.
    const newCases: number[] = rounded.map((v, i) => (i === 0 ? v : Math.max(0, v - rounded[i - 1]!)));
    const cumulative: number[] = [];
    let acc = 0;
    for (const x of newCases) {
      acc += x;
      cumulative.push(acc);
    }
    return { days: norm, newCases, cumulative };
  }
  // Input is daily new cases: cumulative is the running sum.
  const cumulative: number[] = [];
  let acc = 0;
  for (const x of rounded) {
    acc += x;
    cumulative.push(acc);
  }
  return { days: norm, newCases: rounded, cumulative };
}

// ==========================================================================
// Metapopulation extension: multi-region SEIR with age structure, vaccination
// / waning immunity, a competing second strain, scheduled interventions and
// gravity or user-supplied symmetric mobility. Pure TS, deterministic RK4.
//
// State layout per (region, age group): [S, V, E1, I1, E2, I2, R] where
//   S  susceptible, V vaccinated (retains (1-efficacy) susceptibility),
//   E1/I1 exposed/infectious of strain 1, E2/I2 of strain 2, R recovered.
// Two cumulative counters per (region, age): new infections of strain 1
// (incl. vaccine breakthroughs) and of strain 2. Migration applies the same
// rate to every compartment, so a symmetric mobility matrix conserves the
// global total exactly (up to RK4 rounding).
// ==========================================================================

/** One modelled region: name, resident population and initial infected. */
export interface RegionSpec {
  name: string;
  population: number;
  infected: number;
}

/** A scheduled intervention: active on [start, end) days with strength 0..1. */
export interface InterventionWindow {
  start: number;
  end: number;
  /** Reduction fraction while active (contact/transmission/mobility cut). */
  strength: number;
}

export interface MetapopConfig {
  regions: RegionSpec[];
  r0: number;
  infectiousDays: number;
  latentDays: number;
  days: number;
  timeStep?: number;
  /**
   * Symmetric per-capita migration rates m[i][j] (from region j into i, per
   * day). When null/absent a gravity model `gravityCoeff * Ni*Nj/N^2` is used.
   */
  mobility?: number[][] | null;
  gravityCoeff?: number;
  ageStructure?: boolean;
  /** Multiplier on the fixed POLYMOD-style 3x3 contact matrix (1 = reference). */
  ageContactScale?: number;
  vaccinationRate?: number; // fraction of S vaccinated per day
  vaccineEfficacy?: number; // susceptibility reduction for vaccinated (0..1)
  waningRate?: number; // per-day R->S and V->S return rate
  strain2Enabled?: boolean;
  strain2R0?: number; // independent basic reproduction number of strain 2
  strain2Share?: number; // initial fraction of infected carrying strain 2
  lockdown?: InterventionWindow | null; // scales contact rate
  mask?: InterventionWindow | null; // scales transmission rate
  travelRestriction?: InterventionWindow | null; // scales mobility matrix
}

export interface RegionTrajectory {
  name: string;
  population: number;
  days: number[];
  susceptible: number[];
  exposed: number[];
  infectious: number[];
  recovered: number[];
  vaccinated: number[];
}

export interface RegionSummary {
  name: string;
  population: number;
  peakInfectious: number;
  peakDay: number;
  /** Cumulative infections of this region's residents (incl. breakthroughs). */
  totalInfections: number;
  /** totalInfections / initial population. */
  attackRate: number;
}

export interface AgeGroupSummary {
  name: string;
  population: number;
  infectious: number[];
  totalInfections: number;
}

export interface MetapopResult {
  days: number[];
  regions: RegionTrajectory[];
  /** Total infectious across all regions over time. */
  totalInfectious: number[];
  totalPopulation: number;
  /** Fraction of currently infectious carrying strain 2 (null when disabled). */
  strain2Share: number[] | null;
  /** Final share of cumulative infections attributable to strain 2. */
  strain2CumulativeShare: number | null;
  ageGroups: AgeGroupSummary[] | null;
  /** Expected severe cases by age group using fixed teaching severity rates. */
  severeEstimate: Array<{ name: string; severe: number }> | null;
  perRegion: RegionSummary[];
}

/** Simplified POLYMOD-style 3x3 contact matrix (children, adults, elderly). */
const POLYMOD3: number[][] = [
  [9.2, 5.1, 0.9],
  [5.1, 8.4, 1.7],
  [0.9, 1.7, 2.9],
];

const AGE_NAMES = ['children', 'adults', 'elderly'] as const;
/** Fixed demographic shares of each region's population (teaching values). */
const AGE_SHARE = [0.22, 0.62, 0.16] as const;
/** Fixed age-group severe-outcome rates used only for output stratification. */
const AGE_SEVERE = [0.004, 0.011, 0.055] as const;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Spectral radius of a symmetric non-negative matrix (power iteration). */
function spectralRadius(m: number[][]): number {
  const n = m.length;
  let v = new Array<number>(n).fill(1 / Math.sqrt(n));
  let rho = 0;
  for (let it = 0; it < 80; it += 1) {
    const w = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      const row = m[i]!;
      let s = 0;
      for (let j = 0; j < n; j += 1) s += row[j]! * v[j]!;
      w[i] = s;
    }
    const norm = Math.sqrt(w.reduce((s, x) => s + x * x, 0));
    if (norm < 1e-30) return 0;
    rho = norm;
    v = w.map((x) => x / norm);
  }
  return rho;
}

/** Gravity mobility: m[i][j] = coeff * Ni*Nj / N^2 (symmetric, zero diagonal). */
export function gravityMobility(populations: number[], coeff: number): number[][] {
  const n = populations.length;
  const total = populations.reduce((s, p) => s + Math.max(0, p), 0);
  const m: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    m.push(new Array<number>(n).fill(0));
  }
  if (total <= 0 || n === 0) return m;
  const g = Math.max(0, coeff);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const v = (g * populations[i]! * populations[j]!) / (total * total);
      m[i]![j] = v;
      m[j]![i] = v;
    }
  }
  return m;
}

/**
 * Parse a region table CSV/TSV with columns `region,population,infected`
 * (header required; `#` comment lines skipped; tolerant aliases: name,
 * pop, infected/inf/cases/i0). Returns null on any format mismatch.
 */
export function parseRegionCsv(text: string): RegionSpec[] | null {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (rows.length < 2) return null;
  const header = rows[0]!.split(/[,;\t]+/).map((c) => c.trim().toLowerCase());
  const nameIdx = header.findIndex((c) => c === 'region' || c === 'name');
  const popIdx = header.findIndex((c) => c === 'population' || c === 'pop');
  const infIdx = header.findIndex((c) => c === 'infected' || c === 'inf' || c === 'cases' || c === 'i0');
  if (nameIdx < 0 || popIdx < 0 || infIdx < 0) return null;
  const regions: RegionSpec[] = [];
  for (const row of rows.slice(1)) {
    const cells = row.split(/[,;\t]+/).map((c) => c.trim());
    if (cells.length < header.length) continue;
    const name = cells[nameIdx]!;
    const pop = toNum(cells[popIdx]!);
    if (!name || !Number.isFinite(pop) || pop <= 0) continue;
    const infRaw = toNum(cells[infIdx]!);
    const infected = Number.isFinite(infRaw) ? Math.min(Math.max(0, infRaw), pop) : 0;
    regions.push({ name, population: pop, infected });
  }
  return regions.length > 0 ? regions : null;
}

/**
 * Parse a mobility matrix from text: either a full n x n square of rates
 * (symmetrized by averaging with its transpose, diagonal forced to zero) or
 * the upper triangle row-wise (row i holds n-1-i cells for j > i). Row sums
 * above 1/day are scaled down for integrator stability. Returns null when
 * the shape does not match n regions.
 */
export function parseMobilityMatrix(text: string, n: number): number[][] | null {
  if (n <= 0) return null;
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/[,;\t ]+/).filter((c) => c !== ''));
  // n rows for a full square, or n-1 rows when the trailing all-zero row of
  // an upper-triangle layout is omitted.
  if (rows.length !== n && rows.length !== n - 1) return null;
  const m: number[][] = [];
  for (let i = 0; i < n; i += 1) m.push(new Array<number>(n).fill(0));

  const full = rows.length === n && rows.every((r) => r.length === n);
  // Upper triangle row-wise: row i holds n-1-i cells (j > i); the trailing
  // all-zero row may be omitted, so n-1 rows are accepted too.
  const upper =
    (rows.length === n || rows.length === n - 1) && rows.every((r, i) => r.length === n - 1 - i);
  if (full) {
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const v = toNum(rows[i]![j]!);
        if (!Number.isFinite(v) || v < 0) return null;
        m[i]![j] = v;
      }
    }
  } else if (upper) {
    for (let i = 0; i < n; i += 1) {
      const src = rows[i];
      if (!src) continue; // trailing all-zero row may be omitted
      for (let k = 0; k < src.length; k += 1) {
        const v = toNum(src[k]!);
        if (!Number.isFinite(v) || v < 0) return null;
        // Mirror immediately: triangle values are the symmetric rates.
        m[i]![i + 1 + k] = v;
        m[i + 1 + k]![i] = v;
      }
    }
  } else {
    return null;
  }
  // Symmetrize, zero the diagonal.
  for (let i = 0; i < n; i += 1) {
    m[i]![i] = 0;
    for (let j = i + 1; j < n; j += 1) {
      const v = (m[i]![j]! + m[j]![i]!) / 2;
      m[i]![j] = v;
      m[j]![i] = v;
    }
  }
  // Stability cap: total outflow rate per person below 1/day.
  let maxRow = 0;
  for (let i = 0; i < n; i += 1) maxRow = Math.max(maxRow, m[i]!.reduce((s, x) => s + x, 0));
  if (maxRow > 1) {
    const f = 1 / maxRow;
    for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) m[i]![j] = m[i]![j]! * f;
  }
  return m;
}

/**
 * Integrate the multi-region SEIR system with classical RK4 (time-dependent
 * rates evaluated at the stage times). Returns daily samples of the full
 * state. Deterministic: no RNG anywhere.
 */
export function simulateMetapop(cfg: MetapopConfig): MetapopResult | null {
  const regions = cfg.regions.filter((r) => r.population > 0);
  if (regions.length === 0) return null;
  const n = regions.length;
  const ages = cfg.ageStructure ? 3 : 1;
  const blockSize = 7;
  const off = (r: number, a: number): number => (r * ages + a) * blockSize;
  const cntBase = n * ages * blockSize;
  const c1 = (r: number, a: number): number => cntBase + r * ages + a;
  const c2 = (r: number, a: number): number => cntBase + n * ages + r * ages + a;
  const len = cntBase + 2 * n * ages;

  const gamma = 1 / Math.max(0.1, cfg.infectiousDays);
  const sigma = 1 / Math.max(0.1, cfg.latentDays);
  const cBase = cfg.ageStructure ? POLYMOD3.map((row) => row.slice()) : [[1]];
  // Force symmetry for the power iteration, then scale contacts.
  for (let i = 0; i < cBase.length; i += 1) {
    for (let j = i + 1; j < cBase.length; j += 1) {
      const v = (cBase[i]![j]! + cBase[j]![i]!) / 2;
      cBase[i]![j] = v;
      cBase[j]![i] = v;
    }
  }
  const rho = spectralRadius(cBase);
  const safeRho = rho > 1e-9 ? rho : 1;
  const scale = cfg.ageStructure ? Math.max(0.05, cfg.ageContactScale ?? 1) : 1;
  const C = cBase.map((row) => row.map((v) => (v * scale) / safeRho));
  const beta1 = Math.max(0, cfg.r0) * gamma;
  const beta2 = cfg.strain2Enabled ? Math.max(0, cfg.strain2R0 ?? 0) * gamma : 0;
  const nu = Math.max(0, cfg.vaccinationRate ?? 0);
  const eff = clamp01(cfg.vaccineEfficacy ?? 0);
  const omega = Math.max(0, cfg.waningRate ?? 0);
  const share2 = cfg.strain2Enabled ? clamp01(cfg.strain2Share ?? 0) : 0;

  const pops = regions.map((r) => r.population);
  // Programmatic mobility matrices are symmetrized in place (diagonal zero);
  // text input is validated through parseMobilityMatrix, gravity otherwise.
  let M: number[][];
  if (cfg.mobility && cfg.mobility.length === n && cfg.mobility.every((row) => row.length === n)) {
    M = cfg.mobility.map((row) => row.map((v) => (Number.isFinite(v) && v > 0 ? v : 0)));
    for (let i = 0; i < n; i += 1) {
      M[i]![i] = 0;
      for (let j = i + 1; j < n; j += 1) {
        const v = (M[i]![j]! + M[j]![i]!) / 2;
        M[i]![j] = v;
        M[j]![i] = v;
      }
    }
  } else {
    M = gravityMobility(pops, cfg.gravityCoeff ?? 0);
  }

  const inWindow = (w: InterventionWindow | null | undefined, t: number): number => {
    if (!w || !(w.strength > 0) || !(w.end > w.start)) return 1;
    return t >= w.start && t < w.end ? 1 - clamp01(w.strength) : 1;
  };
  const lockdown = cfg.lockdown ?? null;
  const mask = cfg.mask ?? null;
  const travel = cfg.travelRestriction ?? null;

  // Initial state.
  const y: number[] = new Array<number>(len).fill(0);
  for (let r = 0; r < n; r += 1) {
    const rg = regions[r]!;
    const i0 = Math.min(Math.max(0, rg.infected), rg.population);
    const i1 = i0 * (1 - share2);
    const i2 = i0 * share2;
    for (let a = 0; a < ages; a += 1) {
      const share = ages === 3 ? AGE_SHARE[a]! : 1;
      const o = off(r, a);
      y[o] = rg.population * share - i0 * share;
      y[o + 3] = i1 * share;
      y[o + 5] = i2 * share;
    }
  }

  const deriv = (t: number, yv: number[]): number[] => {
    const d = new Array<number>(len).fill(0);
    const contactFactor = inWindow(lockdown, t) * inWindow(mask, t);
    const travelFactor = inWindow(travel, t);
    const b1 = beta1 * contactFactor;
    const b2 = beta2 * contactFactor;

    // Local present population per (region, age).
    const nloc = new Array<number>(n * ages).fill(0);
    for (let r = 0; r < n; r += 1) {
      for (let a = 0; a < ages; a += 1) {
        const o = off(r, a);
        nloc[r * ages + a] = yv[o]! + yv[o + 1]! + yv[o + 2]! + yv[o + 3]! + yv[o + 4]! + yv[o + 5]! + yv[o + 6]!;
      }
    }
    // Forces of infection per (region, age) and strain.
    const lam1 = new Array<number>(n * ages).fill(0);
    const lam2 = new Array<number>(n * ages).fill(0);
    for (let r = 0; r < n; r += 1) {
      for (let a = 0; a < ages; a += 1) {
        let l1 = 0;
        let l2 = 0;
        for (let b = 0; b < ages; b += 1) {
          const nb = nloc[r * ages + b]!;
          if (nb > 1e-9) {
            const c = C[a]![b]! / nb;
            l1 += c * yv[off(r, b) + 3]!;
            l2 += c * yv[off(r, b) + 5]!;
          }
        }
        lam1[r * ages + a] = b1 * l1;
        lam2[r * ages + a] = b2 * l2;
      }
    }
    // Reactions + migration per compartment.
    for (let r = 0; r < n; r += 1) {
      let rowSum = 0;
      for (let j = 0; j < n; j += 1) rowSum += M[r]![j]!;
      rowSum *= travelFactor;
      for (let a = 0; a < ages; a += 1) {
        const o = off(r, a);
        const S = yv[o]!;
        const V = yv[o + 1]!;
        const E1 = yv[o + 2]!;
        const I1 = yv[o + 3]!;
        const E2 = yv[o + 4]!;
        const I2 = yv[o + 5]!;
        const R = yv[o + 6]!;
        const l1 = lam1[r * ages + a]!;
        const l2 = lam2[r * ages + a]!;
        const inf1 = l1 * S;
        const inf2 = l2 * S;
        const infV1 = (1 - eff) * l1 * V;
        const infV2 = (1 - eff) * l2 * V;
        const vax = nu * S;
        const wanR = omega * R;
        const wanV = omega * V;
        const react = [
          // Breakthrough infections (infV*) leave V, not S, so they do not
          // appear in dS; every flow is counted exactly once for conservation.
          -inf1 - inf2 - vax + wanR + wanV,
          vax - infV1 - infV2 - wanV,
          inf1 + infV1 - sigma * E1,
          sigma * E1 - gamma * I1,
          inf2 + infV2 - sigma * E2,
          sigma * E2 - gamma * I2,
          gamma * (I1 + I2) - wanR,
        ];
        for (let c = 0; c < blockSize; c += 1) {
          let flux = -rowSum * yv[o + c]!;
          for (let j = 0; j < n; j += 1) {
            const m = M[r]![j]! * travelFactor;
            if (m !== 0) flux += m * yv[off(j, a) + c]!;
          }
          d[o + c] = react[c]! + flux;
        }
        d[c1(r, a)] = inf1 + infV1;
        d[c2(r, a)] = inf2 + infV2;
      }
    }
    return d;
  };

  const rk4 = (t: number, yv: number[], h: number): number[] => {
    const k1 = deriv(t, yv);
    const y2 = yv.map((v, i) => v + 0.5 * h * k1[i]!);
    const k2 = deriv(t + 0.5 * h, y2);
    const y3 = yv.map((v, i) => v + 0.5 * h * k2[i]!);
    const k3 = deriv(t + 0.5 * h, y3);
    const y4 = yv.map((v, i) => v + h * k3[i]!);
    const k4 = deriv(t + h, y4);
    return yv.map((v, i) => {
      let next = v + (h / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!);
      if (next < 1e-12) next = 0;
      return next;
    });
  };

  const h = Math.max(0.001, cfg.timeStep ?? 0.05);
  const steps = Math.max(2, Math.round(cfg.days / h));
  const days: number[] = [];
  const states: number[][] = [];
  let cur = y.slice();
  for (let k = 0; k <= steps; k += 1) {
    const t = k * h;
    const whole = Math.abs(t % 1) < h / 2 || Math.abs(t % 1) > 1 - h / 2;
    if (k === 0 || whole || k === steps) {
      days.push(t);
      states.push(cur.slice());
    }
    cur = rk4(t, cur, h);
  }

  // Assemble per-region trajectories and summaries.
  const outDays = days;
  const regionTraj: RegionTrajectory[] = regions.map((rg) => ({
    name: rg.name,
    population: rg.population,
    days: outDays,
    susceptible: [],
    exposed: [],
    infectious: [],
    recovered: [],
    vaccinated: [],
  }));
  const totalI: number[] = [];
  const i2Totals: number[] = [];
  const i1Totals: number[] = [];
  const ageCurves: number[][] = ages === 3 ? AGE_NAMES.map(() => []) : [];
  for (let s = 0; s < outDays.length; s += 1) {
    const st = states[s]!;
    let ti = 0;
    let t1 = 0;
    let t2 = 0;
    const ageSum = new Array<number>(ages).fill(0);
    for (let r = 0; r < n; r += 1) {
      let sSum = 0;
      let eSum = 0;
      let iSum = 0;
      let rSum = 0;
      let vSum = 0;
      for (let a = 0; a < ages; a += 1) {
        const o = off(r, a);
        sSum += st[o]!;
        vSum += st[o + 1]!;
        eSum += st[o + 2]! + st[o + 4]!;
        const ii = st[o + 3]! + st[o + 5]!;
        iSum += ii;
        rSum += st[o + 6]!;
        t1 += st[o + 3]!;
        t2 += st[o + 5]!;
        ageSum[a] = ageSum[a]! + ii;
      }
      const tj = regionTraj[r]!;
      tj.susceptible.push(sSum);
      tj.exposed.push(eSum);
      tj.infectious.push(iSum);
      tj.recovered.push(rSum);
      tj.vaccinated.push(vSum);
      ti += iSum;
    }
    totalI.push(ti);
    i1Totals.push(t1);
    i2Totals.push(t2);
    for (let a = 0; a < ages; a += 1) ageCurves[a]?.push(ageSum[a]!);
  }

  const finalState = states[states.length - 1]!;
  const cum1ByRegionAge = new Array<number>(n * ages).fill(0);
  const cum2ByRegionAge = new Array<number>(n * ages).fill(0);
  for (let r = 0; r < n; r += 1) {
    for (let a = 0; a < ages; a += 1) {
      cum1ByRegionAge[r * ages + a] = finalState[c1(r, a)]!;
      cum2ByRegionAge[r * ages + a] = finalState[c2(r, a)]!;
    }
  }
  const perRegion: RegionSummary[] = regions.map((rg, r) => {
    const tj = regionTraj[r]!;
    let peak = 0;
    let peakIdx = 0;
    for (let i = 0; i < tj.infectious.length; i += 1) {
      if (tj.infectious[i]! > peak) {
        peak = tj.infectious[i]!;
        peakIdx = i;
      }
    }
    let cum = 0;
    for (let a = 0; a < ages; a += 1) cum += cum1ByRegionAge[r * ages + a]! + cum2ByRegionAge[r * ages + a]!;
    return {
      name: rg.name,
      population: rg.population,
      peakInfectious: peak,
      peakDay: outDays[peakIdx] ?? 0,
      totalInfections: cum,
      attackRate: cum / rg.population,
    };
  });

  const totalPop = pops.reduce((s, p) => s + p, 0);
  const totalCum = perRegion.reduce((s, r) => s + r.totalInfections, 0);
  const totalCum2 = cum2ByRegionAge.reduce((s, v) => s + v, 0);

  const ageGroups: AgeGroupSummary[] | null =
    ages === 3
      ? AGE_NAMES.map((name, a) => {
          let cum = 0;
          for (let r = 0; r < n; r += 1) cum += finalState[c1(r, a)]! + finalState[c2(r, a)]!;
          return { name, population: totalPop * AGE_SHARE[a]!, infectious: ageCurves[a]!, totalInfections: cum };
        })
      : null;
  const severeEstimate: Array<{ name: string; severe: number }> | null =
    ages === 3
      ? AGE_NAMES.map((name, a) => {
          let cum = 0;
          for (let r = 0; r < n; r += 1) cum += finalState[c1(r, a)]! + finalState[c2(r, a)]!;
          return { name, severe: cum * AGE_SEVERE[a]! };
        })
      : null;

  return {
    days: outDays,
    regions: regionTraj,
    totalInfectious: totalI,
    totalPopulation: totalPop,
    strain2Share: cfg.strain2Enabled ? i2Totals.map((v, i) => (v + i1Totals[i]! > 1e-9 ? v / (v + i1Totals[i]!) : 0)) : null,
    strain2CumulativeShare: cfg.strain2Enabled && totalCum > 1e-9 ? totalCum2 / totalCum : cfg.strain2Enabled ? 0 : null,
    ageGroups,
    severeEstimate,
    perRegion,
  };
}

/** Max relative drift of the global total population across a metapop run. */
export function metapopConservationDrift(res: MetapopResult): number {
  const n0 = Math.max(1, res.totalPopulation);
  let max = 0;
  for (let i = 0; i < res.days.length; i += 1) {
    let sum = 0;
    for (const r of res.regions) {
      sum += r.susceptible[i]! + r.exposed[i]! + r.infectious[i]! + r.recovered[i]! + r.vaccinated[i]!;
    }
    const d = Math.abs(sum - n0) / n0;
    if (d > max) max = d;
  }
  return max;
}

// ==========================================================================
// Rt estimation from incidence data: Cori et al. (2013) Bayesian sliding
// window with a Gamma(a=1, b=5) prior and a Gamma serial interval
// discretized on daily units. Pure TS, deterministic.
// ==========================================================================

/** Natural log of the Gamma function (Lanczos, g=7). */
export function logGamma(x: number): number {
  const cof = [
    76.180091729471, -86.5053203294168, 24.0140982408309, -1.23173957245016,
    0.120865097386618e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j += 1) {
    y += 1;
    ser += cof[j]! / y;
  }
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  return -tmp + Math.log(2.506628274631001 * ser / x);
}

/** Regularized lower incomplete gamma P(a, x) (NR gser/gcf). */
export function gammaLowerReg(a: number, x: number): number {
  if (a <= 0 || x < 0) return Number.NaN;
  if (x === 0) return 0;
  if (x < a + 1) {
    // Series expansion; needs O(x) terms to converge for large x.
    const maxIter = Math.max(300, Math.ceil(x + 20 * Math.sqrt(x) + 20));
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let k = 1; k < maxIter; k += 1) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  // Continued fraction for Q, then P = 1 - Q.
  const fpmin = 1e-300;
  let b = x + 1 - a;
  let c = 1 / fpmin;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 300; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = b + an / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Gamma CDF with `shape` and `scale`. */
export function gammaCdf(x: number, shape: number, scale: number): number {
  return gammaLowerReg(shape, x / scale);
}

/** Inverse standard normal CDF (Acklam's rational approximation, <1.2e-9 rel). */
export function normQuantile(p: number): number {
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const q = p < plow ? Math.sqrt(-2 * Math.log(p)) : p > 1 - plow ? Math.sqrt(-2 * Math.log(1 - p)) : p - 0.5;
  if (p < plow) {
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - plow) {
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** Inverse Gamma CDF (bisection on the regularized lower incomplete gamma). */
export function gammaQuantile(p: number, shape: number, scale: number): number {
  if (!(p > 0)) return 0;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  // For very large shapes the series expansion of P(a, x) cannot converge in
  // reasonable iterations; use the Cornish-Fisher asymptotic expansion
  // instead (relative error far below the posterior CrI width there).
  if (shape > 1e5) {
    const z = normQuantile(p);
    const x = shape + Math.sqrt(shape) * z + (z * z - 1) / 3;
    return Math.max(0, x * scale);
  }
  let lo = 0;
  let hi = shape * scale + 12 * scale * Math.sqrt(shape) + 10 * scale;
  for (let i = 0; i < 200; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (gammaLowerReg(shape, mid / scale) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-10 * Math.max(1, hi)) break;
  }
  return 0.5 * (lo + hi);
}

/** Discretized Gamma serial interval on days 1..K, normalized to sum 1. */
export function discretizeSerialInterval(siMean: number, siSd: number, kMax?: number): number[] {
  const mean = siMean > 0 ? siMean : 5.2;
  const sd = siSd > 0 ? siSd : 1.7;
  const shape = (mean / sd) ** 2;
  const scale = (sd * sd) / mean;
  const K = Math.max(3, Math.min(30, kMax ?? Math.ceil(mean + 4 * sd)));
  const w: number[] = [];
  let acc = 0;
  for (let k = 1; k <= K; k += 1) {
    const v = gammaLowerReg(shape, (k + 0.5) / scale) - gammaLowerReg(shape, Math.max(0, k - 0.5) / scale);
    w.push(Math.max(0, v));
    acc += Math.max(0, v);
  }
  return acc > 0 ? w.map((v) => v / acc) : w;
}

export interface RtOptions {
  siMean?: number;
  siSd?: number;
  window?: number;
  priorShape?: number;
  priorScale?: number;
}

export interface RtPoint {
  /** Right edge (day index) of the estimation window. */
  day: number;
  rt: number;
  lo: number;
  hi: number;
}

export interface RtEstimate {
  points: RtPoint[];
  latest: RtPoint | null;
  /** Log-linear growth rate of incidence over the trailing 14 days (1/d). */
  growthRate: number;
  window: number;
}

/**
 * Cori et al. (2013) sliding-window Rt: with a Gamma(a0, b0) prior on Rt and
 * total infectiousness Lambda_t = sum_k w_k I_{t-k}, the posterior over a
 * tau-day window is Gamma(a0 + sum I, 1/(1/b0 + sum Lambda)). Returns null
 * when the series is shorter than the window.
 */
export function estimateRt(newCases: number[], opts: RtOptions = {}): RtEstimate | null {
  const I = newCases.map((v) => Math.max(0, v));
  const tau = Math.max(1, Math.round(opts.window ?? 7));
  const n = I.length;
  if (n < tau + 1) return null;
  const w = discretizeSerialInterval(opts.siMean ?? 5.2, opts.siSd ?? 1.7);
  const K = w.length;
  const lambda = new Array<number>(n).fill(0);
  for (let t = 0; t < n; t += 1) {
    let s = 0;
    for (let k = 1; k <= K && k <= t; k += 1) s += w[k - 1]! * I[t - k]!;
    lambda[t] = s;
  }
  const a0 = opts.priorShape ?? 1;
  const b0 = opts.priorScale ?? 5;
  const points: RtPoint[] = [];
  for (let t = tau; t < n; t += 1) {
    let sumI = 0;
    let sumL = 0;
    for (let s = t - tau + 1; s <= t; s += 1) {
      sumI += I[s]!;
      sumL += lambda[s]!;
    }
    const shape = a0 + sumI;
    const scale = 1 / (1 / b0 + sumL);
    points.push({
      day: t,
      rt: shape * scale,
      lo: gammaQuantile(0.025, shape, scale),
      hi: gammaQuantile(0.975, shape, scale),
    });
  }
  if (points.length === 0) return null;
  // Trailing log-linear growth rate (last 14 points, ln(I+1) guarded).
  const m = Math.min(14, n);
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < m; i += 1) {
    const idx = n - m + i;
    const yv = Math.log(Math.max(I[idx]!, 1) + 1);
    sx += i;
    sy += yv;
    sxx += i * i;
    sxy += i * yv;
  }
  const denom = m * sxx - sx * sx;
  const growthRate = Math.abs(denom) < 1e-30 ? Number.NaN : (m * sxy - sx * sy) / denom;
  return { points, latest: points[points.length - 1]!, growthRate, window: tau };
}

/**
 * Parse an incidence CSV with columns `date,new_cases` (ISO dates or numeric
 * days) or `time,incidence`. Dates are normalized to day offsets from the
 * first date and missing days are filled with zero cases. Returns null when
 * the header is missing the expected columns or fewer than 2 valid rows.
 */
export function parseIncidenceCsv(text: string): ObservedSeries | null {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (rows.length < 2) return null;
  const header = rows[0]!.split(/[,;\t]+/).map((c) => c.trim().toLowerCase());
  const dateIdx = header.findIndex((c) => c === 'date' || c === 'time' || c === 'day');
  const caseIdx = header.findIndex((c) => c === 'new_cases' || c === 'incidence' || c === 'cases' || c === 'new');
  if (dateIdx < 0 || caseIdx < 0) return null;
  type Raw = { d: number; iso: boolean; v: number };
  const raw: Raw[] = [];
  for (const row of rows.slice(1)) {
    const cells = row.split(/[,;\t]+/).map((c) => c.trim());
    if (cells.length <= Math.max(dateIdx, caseIdx)) continue;
    const dRaw = cells[dateIdx]!;
    const v = toNum(cells[caseIdx]!);
    if (!Number.isFinite(v)) continue;
    const numDay = toNum(dRaw);
    if (Number.isFinite(numDay)) {
      raw.push({ d: numDay, iso: false, v: Math.max(0, v) });
      continue;
    }
    const parsed = Date.parse(dRaw);
    if (Number.isFinite(parsed)) raw.push({ d: parsed, iso: true, v: Math.max(0, v) });
  }
  if (raw.length < 2) return null;
  if (raw[0]!.iso) {
    raw.sort((a, b) => a.d - b.d);
    const t0 = raw[0]!.d;
    const byDay = new Map<number, number>();
    for (const r of raw) {
      const day = Math.round((r.d - t0) / 86400000);
      byDay.set(day, Math.max(byDay.get(day) ?? 0, r.v));
    }
    const maxDay = Math.max(...byDay.keys());
    const days: number[] = [];
    const inc: number[] = [];
    for (let d = 0; d <= maxDay; d += 1) {
      days.push(d);
      inc.push(byDay.get(d) ?? 0);
    }
    return buildSeries(days, inc, 'new');
  }
  return buildSeries(raw.map((r) => r.d), raw.map((r) => r.v), 'new');
}