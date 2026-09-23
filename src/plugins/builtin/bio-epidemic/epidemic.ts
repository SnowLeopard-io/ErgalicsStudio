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
  const herd = cfg.r0 > 1 ? 1 - 1 / cfg.r0 : 0;
  return {
    peakInfectious: peakInf,
    peakDay: traj.days[peakIdx] ?? 0,
    peakFraction: peakInf / N,
    finalRecoveredFraction: lastRec / N,
    finalSusceptibleFraction: lastSus / N,
    totalCasesFraction: lastRec / N,
    r0: cfg.r0,
    herdImmunityFraction: herd,
    attackRateFraction: lastRec / N,
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