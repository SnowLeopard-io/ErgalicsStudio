// ==========================================================================
// env-predator-prey — Lotka–Volterra predator–prey numerics (pure, DOM-free)
//
// dx/dt = αx − βxy,  dy/dt = δxy − γy  (x prey, y predator).
// Classical RK4 integration. The closed orbits admit the conserved quantity
// V(x,y) = δx − γ ln x + βy − α ln y, used as the numeric drift check.
// Parameter estimation from a time series by linear regression on log-space
// central differences: d(ln x)/dt = α − βy and d(ln y)/dt = δx − γ.
// ==========================================================================

export interface LvParams {
  alpha: number; // prey growth rate
  beta: number; // predation rate
  gamma: number; // predator mortality
  delta: number; // predation-to-offspring conversion
  x0: number; // initial prey
  y0: number; // initial predator
}

export const DEFAULT_LV_PARAMS: LvParams = {
  alpha: 1.0,
  beta: 0.1,
  gamma: 1.5,
  delta: 0.75,
  x0: 10,
  y0: 5,
};

export interface LvSeries {
  times: number[];
  x: number[];
  y: number[];
}

export interface LvData {
  times: number[];
  x: number[]; // prey (hare)
  y: number[]; // predator (lynx)
}

export interface LvFit {
  alpha: number;
  beta: number;
  gamma: number;
  delta: number;
}

/** RHS of the LV system at (x, y). */
export function lvDeriv(x: number, y: number, p: LvParams): [number, number] {
  return [p.alpha * x - p.beta * x * y, p.delta * x * y - p.gamma * y];
}

/** Conserved orbit invariant V(x,y) = δx − γln x + βy − αln y. */
export function lvConserved(x: number, y: number, p: LvParams): number {
  return p.delta * x - p.gamma * Math.log(x) + p.beta * y - p.alpha * Math.log(y);
}

/** Coexistence equilibrium: prey x* = γ/δ, predator y* = α/β. */
export function lvEquilibrium(p: LvParams): { xStar: number; yStar: number } {
  return { xStar: p.gamma / p.delta, yStar: p.alpha / p.beta };
}

/** Linearized angular frequency around the equilibrium: ω₀ = √(αγ). */
export function linearOmega(p: LvParams): number {
  return Math.sqrt(p.alpha * p.gamma);
}

/** Classical RK4 integration on a uniform grid. */
export function simulateLv(p: LvParams, tMax: number, steps: number): LvSeries {
  const n = Math.max(2, Math.round(steps));
  const dt = tMax / (n - 1);
  const times = new Array<number>(n);
  const xs = new Array<number>(n);
  const ys = new Array<number>(n);
  let x = p.x0;
  let y = p.y0;
  times[0] = 0;
  xs[0] = x;
  ys[0] = y;
  for (let i = 0; i < n - 1; i += 1) {
    const t = i * dt;
    const [dx1, dy1] = lvDeriv(x, y, p);
    const [dx2, dy2] = lvDeriv(x + (dt / 2) * dx1, y + (dt / 2) * dy1, p);
    const [dx3, dy3] = lvDeriv(x + (dt / 2) * dx2, y + (dt / 2) * dy2, p);
    const [dx4, dy4] = lvDeriv(x + dt * dx3, y + dt * dy3, p);
    x += (dt / 6) * (dx1 + 2 * dx2 + 2 * dx3 + dx4);
    y += (dt / 6) * (dy1 + 2 * dy2 + 2 * dy3 + dy4);
    times[i + 1] = t + dt;
    xs[i + 1] = x;
    ys[i + 1] = y;
  }
  return { times, x: xs, y: ys };
}

// ---- orbit geometry -------------------------------------------------------------

export interface PeakInfo {
  time: number;
  value: number;
}

/** Local maxima of a sampled series with parabolic sub-sample refinement. */
export function detectPeaks(times: number[], values: number[]): PeakInfo[] {
  const peaks: PeakInfo[] = [];
  for (let i = 1; i < values.length - 1; i += 1) {
    const a = values[i - 1]!;
    const b = values[i]!;
    const c = values[i + 1]!;
    if (b > a && b >= c) {
      const denom = a - 2 * b + c;
      let time = times[i]!;
      if (Math.abs(denom) > 1e-15) {
        time += ((a - c) / (2 * denom)) * (times[i + 1]! - times[i - 1]!) * 0.5;
      }
      peaks.push({ time, value: b });
    }
  }
  return peaks;
}

/** Mean peak-to-peak spacing, or null when fewer than two peaks exist. */
export function measurePeriod(times: number[], values: number[]): number | null {
  const peaks = detectPeaks(times, values);
  if (peaks.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < peaks.length; i += 1) sum += peaks[i]!.time - peaks[i - 1]!.time;
  return sum / (peaks.length - 1);
}

/** Linear interpolation of a uniformly sampled series at time t. */
function sampleLinear(times: number[], arr: number[], t: number): number {
  const n = times.length;
  if (n === 0) return Number.NaN;
  if (t <= times[0]!) return arr[0]!;
  if (t >= times[n - 1]!) return arr[n - 1]!;
  const dt = times[1]! - times[0]!;
  const pos = (t - times[0]!) / dt;
  const i = Math.max(0, Math.min(Math.floor(pos), n - 2));
  const f = pos - i;
  return arr[i]! * (1 - f) + arr[i + 1]! * f;
}

/**
 * Relative state difference between two consecutive prey maxima — an orbit
 * closure measure insensitive to grid quantization (states are read by
 * linear interpolation at the parabolically refined peak times).
 */
export function orbitClosure(times: number[], x: number[], y: number[]): number {
  const peaks = detectPeaks(times, x);
  if (peaks.length < 2) return Infinity;
  const xa = sampleLinear(times, x, peaks[0]!.time);
  const ya = sampleLinear(times, y, peaks[0]!.time);
  const xb = sampleLinear(times, x, peaks[1]!.time);
  const yb = sampleLinear(times, y, peaks[1]!.time);
  return Math.max(Math.abs(xb - xa) / Math.abs(xa), Math.abs(yb - ya) / Math.abs(ya));
}

// ---- parameter fitting ------------------------------------------------------------

function regress(us: number[], vs: number[]): { slope: number; intercept: number } {
  const n = us.length;
  let mu = 0;
  let mv = 0;
  for (let i = 0; i < n; i += 1) {
    mu += us[i]!;
    mv += vs[i]!;
  }
  mu /= n;
  mv /= n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (us[i]! - mu) * (vs[i]! - mv);
    sxx += (us[i]! - mu) * (us[i]! - mu);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { slope, intercept: mv - slope * mu };
}

/**
 * Estimate (α, β, γ, δ) from an observed (t, x, y) series by regressing the
 * log-space central differences d(ln x)/dt on y and d(ln y)/dt on x.
 */
export function fitLv(times: number[], x: number[], y: number[]): LvFit | null {
  const us1: number[] = [];
  const vs1: number[] = [];
  const us2: number[] = [];
  const vs2: number[] = [];
  for (let i = 1; i < times.length - 1; i += 1) {
    const h = times[i + 1]! - times[i - 1]!;
    if (!(h > 0)) continue;
    const ok =
      x[i - 1]! > 0 && x[i]! > 0 && x[i + 1]! > 0 && y[i - 1]! > 0 && y[i]! > 0 && y[i + 1]! > 0;
    if (!ok) continue;
    us1.push(y[i]!);
    vs1.push((Math.log(x[i + 1]!) - Math.log(x[i - 1]!)) / h);
    us2.push(x[i]!);
    vs2.push((Math.log(y[i + 1]!) - Math.log(y[i - 1]!)) / h);
  }
  if (us1.length < 8 || us2.length < 8) return null;
  const r1 = regress(us1, vs1); // d(ln x)/dt = α − βy
  const r2 = regress(us2, vs2); // d(ln y)/dt = δx − γ
  return {
    alpha: r1.intercept,
    beta: -r1.slope,
    gamma: -r2.intercept,
    delta: r2.slope,
  };
}

// ---- data parsing ------------------------------------------------------------------

/**
 * Parse a CSV/TSV with columns time/year, prey, predator (header names such
 * as year/time/t, hare/prey/x, lynx/predator/y). `#` comment lines are
 * skipped; rows with missing or non-positive counts are dropped.
 */
export function parseLvCsv(text: string): LvData {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  let colT = 0;
  let colX = 1;
  let colY = 2;
  let rowIdx = 0;
  const times: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let li = 0; li < lines.length; li += 1) {
    const cells = lines[li]!.split(/[,\t;]/).map((c) => c.trim());
    if (li === 0) {
      const looksNumeric = cells.every((c) => c === '' || Number.isFinite(Number(c)));
      if (!looksNumeric) {
        const lower = cells.map((c) => c.toLowerCase());
        const idx = (names: string[]): number => lower.findIndex((c) => names.includes(c));
        const wide = cells.length >= 3;
        const tHit = idx(['year', 'time', 't', 'date']);
        const xHit = idx(['hare', 'prey', 'x']);
        const yHit = idx(['lynx', 'predator', 'y']);
        colT = tHit >= 0 ? tHit : wide ? 0 : -1;
        colX = xHit >= 0 ? xHit : wide ? 1 : 0;
        colY = yHit >= 0 ? yHit : wide ? 2 : 1;
        continue;
      }
    }
    const x = Number(cells[colX]);
    const y = Number(cells[colY]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) continue;
    const t = colT >= 0 ? Number(cells[colT]) : rowIdx;
    times.push(Number.isFinite(t) ? t : rowIdx);
    xs.push(x);
    ys.push(y);
    rowIdx += 1;
  }
  return { times, x: xs, y: ys };
}

// ---- embedded validation benchmarks ------------------------------------------------

export interface LvBenchmark {
  key: string;
  label: string;
  display: string;
  pass: boolean;
  hint: string;
}

/**
 * Validation battery on the default parameters:
 *  1. conservation: |ΔV|/|V| over 10 periods < 1e-3 (RK4, 24000 steps)
 *  2. orbit closure: state repeats after one full period (peak-to-peak)
 *     within 1e-3 relative
 *  3. linearized frequency: 1% perturbation at the coexistence equilibrium
 *     oscillates at ω₀ = √(αγ) within 5%
 *  4. fit recovery: regression on 6 simulated periods recovers all four
 *     parameters within 5%
 */
export function runLvBenchmarks(): LvBenchmark[] {
  const p = DEFAULT_LV_PARAMS;
  const w0 = linearOmega(p);
  const T0 = (2 * Math.PI) / w0;

  const s10 = simulateLv(p, 10 * T0, 24000);
  const v0 = lvConserved(p.x0, p.y0, p);
  const vEnd = lvConserved(s10.x[s10.x.length - 1]!, s10.y[s10.y.length - 1]!, p);
  const drift = Math.abs(vEnd - v0) / Math.abs(v0);

  const s12 = simulateLv(p, 12 * T0, 24000);
  const closure = orbitClosure(s12.times, s12.x, s12.y);

  const eq = lvEquilibrium(p);
  const pSmall: LvParams = { ...p, x0: eq.xStar * 1.01, y0: eq.yStar };
  const sF = simulateLv(pSmall, 20 * T0, 24000);
  const tMeas = measurePeriod(sF.times, sF.x);
  const wMeas = tMeas ? (2 * Math.PI) / tMeas : NaN;
  const freqErr = Number.isFinite(wMeas) ? Math.abs(wMeas - w0) / w0 : Infinity;

  const sFit = simulateLv(p, 6 * T0, 1200);
  const fit = fitLv(sFit.times, sFit.x, sFit.y);
  let fitErr = Infinity;
  if (fit) {
    fitErr = Math.max(
      Math.abs(fit.alpha - p.alpha) / p.alpha,
      Math.abs(fit.beta - p.beta) / p.beta,
      Math.abs(fit.gamma - p.gamma) / p.gamma,
      Math.abs(fit.delta - p.delta) / p.delta,
    );
  }

  return [
    {
      key: 'conservation',
      label: '|ΔV|/|V| over 10 periods < 1e-3',
      display: drift.toExponential(2),
      pass: drift < 1e-3,
      hint: 'RK4 drift of the conserved V = δx − γln x + βy − αln y',
    },
    {
      key: 'closure',
      label: 'orbit closes after one period (rel < 1e-3)',
      display: Number.isFinite(closure) ? closure.toExponential(2) : 'n/a',
      pass: Number.isFinite(closure) && closure < 1e-3,
      hint: 'state at consecutive prey maxima repeats',
    },
    {
      key: 'lin-freq',
      label: 'small-orbit frequency vs √(αγ) < 5%',
      display: Number.isFinite(freqErr) ? `${(freqErr * 100).toFixed(3)}%` : 'n/a',
      pass: Number.isFinite(freqErr) && freqErr < 0.05,
      hint: '1% perturbation at equilibrium (γ/δ, α/β)',
    },
    {
      key: 'fit-recovery',
      label: 'regression fit recovers α/β/γ/δ < 5%',
      display: Number.isFinite(fitErr) ? `${(fitErr * 100).toFixed(3)}%` : 'n/a',
      pass: Number.isFinite(fitErr) && fitErr < 0.05,
      hint: 'log-space central-difference regression on simulated data',
    },
  ];
}
