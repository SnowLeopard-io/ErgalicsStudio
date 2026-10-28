// ==========================================================================
// geo-hydrogeology — groundwater hydraulics kernel (pure TS, DOM-free)
//
// Confined-aquifer well hydraulics (Theis / Cooper–Jacob), Darcy's law and
// seepage velocity, well superposition and cones of depression, Ogata–Banks
// advective–dispersive transport with retardation and decay, pumping-test
// analysis, and tidal / barometric water-level response.
// ==========================================================================

export const EULER_GAMMA = 0.5772156649015329;

// --------------------------------------------------------------------------
// Theis well function
// --------------------------------------------------------------------------

/** Theis well function W(u) = ∫_u^∞ e^-x / x dx (E1). */
export function wellFunction(u: number): number {
  if (!(u > 0)) return Number.POSITIVE_INFINITY;
  if (u < 1) {
    // Convergent series: W(u) = -γ - ln u + Σ (-1)^(n+1) u^n / (n·n!)
    let term = 1;
    let sum = 0;
    for (let n = 1; n <= 120; n += 1) {
      term *= -u / n;
      const contribution = -term / n;
      sum += contribution;
      if (Math.abs(contribution) < 1e-17 * Math.max(1, Math.abs(sum))) break;
    }
    return -EULER_GAMMA - Math.log(u) + sum;
  }
  // Modified Lentz continued fraction for E1 (Numerical Recipes §6.3).
  const maxIter = 200;
  const eps = 1e-16;
  const tiny = 1e-300;
  let b = u + 1;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= maxIter; i += 1) {
    const a = -i * i;
    b += 2;
    d = 1 / (a * d + b);
    c = b + a / c;
    const delta = c * d;
    h *= delta;
    if (Math.abs(delta - 1) < eps) break;
  }
  return Math.exp(-u) * h;
}

export interface TheisInput {
  /** Pumping rate (m³/d). */
  q: number;
  /** Transmissivity (m²/d). */
  t: number;
  /** Storativity (dimensionless). */
  s: number;
  /** Radial distance from the pumping well (m). */
  r: number;
  /** Time since pumping started (d). */
  time: number;
}

export interface TheisPoint {
  timeDays: number;
  drawdownM: number;
  u: number;
  wellFunction: number;
}

/** Theis drawdown s = Q·W(u)/(4πT), u = r²S/(4Tt). */
export function theisDrawdown(input: TheisInput): TheisPoint {
  const { q, t, s, r, time } = input;
  const safeT = Math.max(t, 1e-12);
  const u = (r * r * Math.max(s, 0)) / (4 * safeT * Math.max(time, 1e-12));
  const w = wellFunction(u);
  return { timeDays: time, drawdownM: (q * w) / (4 * Math.PI * safeT), u, wellFunction: w };
}

/** Cooper–Jacob approximation s ≈ Q/(4πT) · (−γ − ln u), valid for u < 0.01. */
export function jacobDrawdown(input: TheisInput): number {
  const { q, t, s, r, time } = input;
  const safeT = Math.max(t, 1e-12);
  const u = (r * r * Math.max(s, 0)) / (4 * safeT * Math.max(time, 1e-12));
  return (q / (4 * Math.PI * safeT)) * (-EULER_GAMMA - Math.log(Math.max(u, 1e-300)));
}

/** Relative difference between Theis and Cooper–Jacob (dimensionless). */
export function jacobError(input: TheisInput): number {
  const exact = theisDrawdown(input).drawdownM;
  const approx = jacobDrawdown(input);
  return exact !== 0 ? Math.abs(approx - exact) / Math.abs(exact) : 0;
}

/** Time at which Cooper–Jacob is within `tol` of Theis at a given radius. */
export function jacobValidityTime(input: Omit<TheisInput, 'time'>, tol = 0.01): number {
  let lo = 1e-4;
  let hi = 10;
  for (let i = 0; i < 60; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (jacobError({ ...input, time: mid }) > tol) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** Build a time–drawdown curve on a logarithmic time grid. */
export function theisCurve(input: Omit<TheisInput, 'time'>, times: number[]): TheisPoint[] {
  return times.map((time) => theisDrawdown({ ...input, time }));
}

// --------------------------------------------------------------------------
// Darcy's law
// --------------------------------------------------------------------------

export interface DarcyInput {
  /** Hydraulic conductivity (m/d). */
  k: number;
  /** Hydraulic head difference (m). */
  dh: number;
  /** Flow-path length (m). */
  dl: number;
  /** Effective porosity (dimensionless). */
  porosity: number;
}

export interface DarcyResult {
  /** Specific discharge (m/d). */
  flux: number;
  /** Darcy velocity magnitude (m/d). */
  darcyVelocity: number;
  /** Seepage / pore-water velocity (m/d). */
  seepageVelocity: number;
  /** Gradient dh/dl (dimensionless). */
  gradient: number;
}

export function darcyLaw(input: DarcyInput): DarcyResult {
  const gradient = Math.max(input.dl, 1e-12) === 0 ? 0 : input.dh / Math.max(Math.abs(input.dl), 1e-12);
  const flux = -Math.max(input.k, 0) * gradient;
  const n = Math.min(1, Math.max(1e-6, input.porosity));
  return {
    flux,
    darcyVelocity: Math.abs(flux),
    seepageVelocity: Math.abs(flux) / n,
    gradient,
  };
}

/** Hydraulic conductivity from a constant-head permeameter test. */
export function conductivityFromPermeameter(q: number, l: number, a: number, dh: number, time: number): number {
  return (q * l) / Math.max(a * dh * time, 1e-12);
}

// --------------------------------------------------------------------------
// Multiple wells / cone of depression
// --------------------------------------------------------------------------

export interface Well {
  id: string;
  /** Ground position (m). */
  x: number;
  y: number;
  /** Pumping rate (m³/d, positive for abstraction). */
  q: number;
  /** Radius (m). */
  radius: number;
  /** Start time (d). */
  startTime: number;
}

export interface SuperpositionInput {
  wells: Well[];
  t: number;
  s: number;
  /** Aquifer transmissivity (m²/d). */
  transmissivity: number;
  x: number;
  y: number;
}

/** Drawdown at (x,y) by superposition of Theis solutions. */
export function superpositionDrawdown(input: SuperpositionInput): number {
  let s = 0;
  for (const w of input.wells) {
    const dt = input.t - w.startTime;
    if (dt <= 0 || w.q === 0) continue;
    const r = Math.max(Math.hypot(input.x - w.x, input.y - w.y), w.radius);
    s += theisDrawdown({ q: w.q, t: input.transmissivity, s: input.s, r, time: dt }).drawdownM;
  }
  return s;
}

export interface ConeProfilePoint {
  distanceM: number;
  drawdownM: number;
}

/** Radial drawdown profile around a single pumping well. */
export function coneOfDepression(
  well: Well,
  transmissivity: number,
  storativity: number,
  timeDays: number,
  maxRadius = 1000,
  samples = 120,
): ConeProfilePoint[] {
  const out: ConeProfilePoint[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const r = Math.max(well.radius, (i / samples) * maxRadius);
    out.push({
      distanceM: r,
      drawdownM: theisDrawdown({ q: well.q, t: transmissivity, s: storativity, r, time: timeDays }).drawdownM,
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Pumping-test analysis (Cooper–Jacob straight-line fit)
// --------------------------------------------------------------------------

export interface PumpingPoint {
  timeDays: number;
  drawdownM: number;
}

export interface PumpingFit {
  transmissivity: number;
  storativity: number;
  slope: number;
  intercept: number;
  r2: number;
  points: number;
}

/** Fit s = m·log10(t) + b, then T = 2.303Q/(4πm), S = 2.25T·t0/r². */
export function fitCooperJacob(points: PumpingPoint[], q: number, r: number): PumpingFit {
  const valid = points.filter((p) => p.timeDays > 0 && Number.isFinite(p.drawdownM));
  if (valid.length < 2) {
    return { transmissivity: 0, storativity: 0, slope: 0, intercept: 0, r2: 0, points: valid.length };
  }
  const xs = valid.map((p) => Math.log10(p.timeDays));
  const ys = valid.map((p) => p.drawdownM);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    syy += (ys[i]! - my) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const ssRes = ys.reduce((acc, y, i) => acc + (y - (slope * xs[i]! + intercept)) ** 2, 0);
  const r2 = syy > 0 ? 1 - ssRes / syy : 1;
  const transmissivity = Math.abs(slope) > 0 ? (2.302585092994046 * q) / (4 * Math.PI * Math.abs(slope)) : 0;
  const logT0 = slope !== 0 ? -intercept / slope : 0;
  const t0 = 10 ** logT0;
  const storativity = transmissivity > 0 && r > 0 ? (2.25 * transmissivity * t0) / (r * r) : 0;
  return { transmissivity, storativity, slope, intercept, r2, points: n };
}

/** Parse time_days,drawdown_m (or time_min, drawdown_m) pumping-test CSV. */
export function parsePumpingCsv(text: string): PumpingPoint[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const find = (...names: string[]) => names.map((n) => header.indexOf(n)).find((i) => i >= 0) ?? -1;
  let ti = find('time_days', 'time_day', 'day', 't');
  const si = find('drawdown_m', 'drawdown', 's');
  const useMinutes = ti < 0;
  if (useMinutes) ti = find('time_min', 'time_minutes', 'minute', 'minutes');
  if (ti < 0 || si < 0) return [];
  const out: PumpingPoint[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]!);
    const tv = Number(cols[ti]);
    const sv = Number(cols[si]);
    if (!Number.isFinite(tv) || !Number.isFinite(sv)) continue;
    out.push({ timeDays: useMinutes ? tv / 1440 : tv, drawdownM: sv });
  }
  return out.sort((a, b) => a.timeDays - b.timeDays);
}

// --------------------------------------------------------------------------
// Contaminant transport (Ogata–Banks)
// --------------------------------------------------------------------------

export interface PlumeInput {
  /** Seepage velocity (m/d). */
  velocity: number;
  /** Longitudinal dispersivity (m). */
  dispersivity: number;
  /** Retardation factor R ≥ 1. */
  retardation: number;
  /** First-order decay half-life (d), 0 = conservative. */
  halfLifeDays: number;
  /** Source concentration (mg/L). */
  source: number;
  /** Observation time (d). */
  time: number;
  /** Maximum distance (m). */
  maxDistance: number;
  samples?: number;
}

export interface PlumePoint {
  x: number;
  concentration: number;
  relative: number;
}

/** Complementary error function (Taylor series near 0, asymptotic tail). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  if (z === 0) return 1;
  if (z < 3) {
    // erf(z) = 2/√π Σ (-1)^n z^(2n+1) / (n! (2n+1))
    let term = z;
    let sum = z;
    for (let n = 1; n <= 200; n += 1) {
      term *= (-z * z) / n;
      const contribution = term / (2 * n + 1);
      sum += contribution;
      if (Math.abs(contribution) < 1e-17 * Math.max(1, Math.abs(sum))) break;
      if (!Number.isFinite(term)) break;
    }
    const erf = (2 / Math.sqrt(Math.PI)) * sum;
    return x > 0 ? 1 - erf : 1 + erf;
  }
  // Asymptotic expansion, truncated at its smallest term.
  let term = 1;
  let sum = 1;
  let prevAbs = Number.POSITIVE_INFINITY;
  for (let n = 1; n < 60; n += 1) {
    term *= -(2 * n - 1) / (2 * z * z);
    const abs = Math.abs(term);
    if (abs > prevAbs) break;
    sum += term;
    prevAbs = abs;
  }
  const tail = (Math.exp(-z * z) / (z * Math.sqrt(Math.PI))) * sum;
  return x > 0 ? tail : 2 - tail;
}

/** Ogata–Banks 1-D solution C/C0 = ½ erfc((x−vt)/(2√(Dt))) · exp(−λt). */
export function ogataBanks(x: number, vt: number, d: number, halfLifeDays: number, time: number): number {
  const denom = 2 * Math.sqrt(Math.max(d, 1e-12) * Math.max(time, 1e-12));
  const front = 0.5 * erfc((x - vt) / denom);
  const decay = halfLifeDays > 0 ? Math.exp((-Math.LN2 * time) / halfLifeDays) : 1;
  return Math.max(0, Math.min(1, front * decay));
}

export function plumeProfile(input: PlumeInput): PlumePoint[] {
  const samples = input.samples ?? 160;
  const r = Math.max(1, input.retardation);
  const v = input.velocity / r;
  const d = Math.max(1e-9, input.dispersivity * v);
  const out: PlumePoint[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const x = (i / samples) * input.maxDistance;
    const relative = ogataBanks(x, v * input.time, d, input.halfLifeDays, input.time);
    out.push({ x, concentration: relative * input.source, relative });
  }
  return out;
}

/** Arrival time (d) at a compliance distance, including retardation. */
export function arrivalTime(distance: number, velocity: number, retardation: number): number {
  return (distance * Math.max(1, retardation)) / Math.max(velocity, 1e-12);
}

// --------------------------------------------------------------------------
// Water-level fluctuation: tidal and barometric response
// --------------------------------------------------------------------------

export interface TidalInput {
  /** Ocean tide amplitude (m). */
  amplitude: number;
  /** Tidal angular frequency (rad/d), e.g. 2π/0.5175 for M2. */
  omega: number;
  /** Aquifer diffusivity T/S (m²/d). */
  diffusivity: number;
  /** Depth of the observation point below the seabed (m). */
  depth: number;
}

export interface TidalResponse {
  amplitudeRatio: number;
  phaseLagRad: number;
  phaseLagHours: number;
  wellAmplitude: number;
}

/** Confined-aquifer tidal efficiency and phase lag (Jacob 1950). */
export function tidalResponse(input: TidalInput): TidalResponse {
  const d = Math.max(input.diffusivity, 1e-9);
  const k = Math.sqrt(input.omega / (2 * d));
  const amp = Math.exp(-input.depth * k);
  const lag = input.depth * k;
  return {
    amplitudeRatio: amp,
    phaseLagRad: lag,
    phaseLagHours: (lag / Math.max(input.omega, 1e-9)) * 24,
    wellAmplitude: input.amplitude * amp,
  };
}

/** Water-level series driven by a sinusoidal tide plus the response lag. */
export function tidalSeries(input: TidalInput, days: number, samples = 240): Array<{ timeDays: number; seaLevelM: number; wellLevelM: number }> {
  const resp = tidalResponse(input);
  const out: Array<{ timeDays: number; seaLevelM: number; wellLevelM: number }> = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = (i / samples) * days;
    out.push({
      timeDays: t,
      seaLevelM: input.amplitude * Math.sin(input.omega * t),
      wellLevelM: resp.wellAmplitude * Math.sin(input.omega * t - resp.phaseLagRad),
    });
  }
  return out;
}

/** Barometric efficiency BE = −Δh_well / Δp (m per m of water equivalent). */
export function barometricEfficiency(waterLevelChangeM: number, pressureHeadChangeM: number): number {
  return Math.abs(pressureHeadChangeM) > 1e-12 ? -waterLevelChangeM / pressureHeadChangeM : 0;
}

// --------------------------------------------------------------------------
// CSV helper
// --------------------------------------------------------------------------

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// --------------------------------------------------------------------------
// Benchmarks
// --------------------------------------------------------------------------

export interface HydroBenchmark {
  id: string;
  pass: boolean;
  detail: string;
}

export function runHydrogeologyBenchmarks(): HydroBenchmark[] {
  const out: HydroBenchmark[] = [];

  // 1. W(u) reference values (Abramowitz & Stegun / standard tables).
  const w1 = wellFunction(1);
  out.push({
    id: 'theis-w1',
    pass: Math.abs(w1 - 0.2193839344) < 1e-6,
    detail: `W(1) = ${w1.toFixed(10)} (expected 0.2193839344)`,
  });

  // 2. Cooper–Jacob converges to Theis for small u.
  const input = { q: 500, t: 1000, s: 1e-4, r: 50, time: 2 };
  const err = jacobError(input);
  out.push({
    id: 'theis-jacob',
    pass: err < 1e-3,
    detail: `u=${theisDrawdown(input).u.toExponential(2)}; relative error = ${err.toExponential(2)} (< 1e-3)`,
  });

  // 3. Darcy hand calculation: K=10 m/d, dh=-1 m over 100 m, n=0.25.
  const darcy = darcyLaw({ k: 10, dh: -1, dl: 100, porosity: 0.25 });
  out.push({
    id: 'darcy-handcalc',
    pass: Math.abs(darcy.darcyVelocity - 0.1) < 1e-12 && Math.abs(darcy.seepageVelocity - 0.4) < 1e-12,
    detail: `q=${darcy.darcyVelocity.toFixed(3)} m/d, v=${darcy.seepageVelocity.toFixed(3)} m/d`,
  });

  // 4. Ogata–Banks front: C/C0 = 0.5 at x = vt for a conservative tracer.
  const relFront = ogataBanks(100, 100, 1, 0, 10);
  out.push({
    id: 'ogata-banks-front',
    pass: Math.abs(relFront - 0.5) < 1e-9,
    detail: `C/C0 at x = vt is ${relFront.toFixed(6)}`,
  });

  // 5. Superposition linearity: doubling every pumping rate doubles drawdown.
  const wells: Well[] = [
    { id: 'W1', x: 0, y: 0, q: 300, radius: 0.15, startTime: 0 },
    { id: 'W2', x: 400, y: 0, q: 150, radius: 0.15, startTime: 0 },
  ];
  const one = superpositionDrawdown({ wells, t: 2, s: 1e-4, transmissivity: 900, x: 200, y: 100 });
  const two = superpositionDrawdown({
    wells: wells.map((w) => ({ ...w, q: w.q * 2 })),
    t: 2,
    s: 1e-4,
    transmissivity: 900,
    x: 200,
    y: 100,
  });
  const linearity = Math.abs(two - 2 * one);
  out.push({ id: 'superposition-linearity', pass: linearity < 1e-12, detail: `|s(2Q) − 2s(Q)| = ${linearity.toExponential(2)} m` });

  // 6. Tidal response is bounded and attenuates with depth.
  const shallow = tidalResponse({ amplitude: 1, omega: (2 * Math.PI) / 0.5175, diffusivity: 1000, depth: 10 });
  const deep = tidalResponse({ amplitude: 1, omega: (2 * Math.PI) / 0.5175, diffusivity: 1000, depth: 100 });
  out.push({
    id: 'tidal-attenuation',
    pass: shallow.amplitudeRatio > deep.amplitudeRatio && shallow.amplitudeRatio <= 1 && deep.phaseLagRad > shallow.phaseLagRad,
    detail: `A(10 m)=${shallow.amplitudeRatio.toFixed(3)}, A(100 m)=${deep.amplitudeRatio.toFixed(3)}`,
  });

  // 7. Cooper–Jacob fit recovers a synthetic transmissivity.
  const q = 800;
  const r = 60;
  const tTrue = 1200;
  const sTrue = 2e-4;
  const pts: PumpingPoint[] = [];
  for (let k = 1; k <= 40; k += 1) {
    const timeDays = 0.0005 * k;
    pts.push({ timeDays, drawdownM: jacobDrawdown({ q, t: tTrue, s: sTrue, r, time: timeDays }) });
  }
  const fit = fitCooperJacob(pts, q, r);
  const tErr = Math.abs(fit.transmissivity - tTrue) / tTrue;
  out.push({
    id: 'pumping-fit',
    pass: tErr < 0.01 && fit.r2 > 0.999,
    detail: `T fit = ${fit.transmissivity.toFixed(1)} m²/d vs ${tTrue} (relErr ${(tErr * 100).toFixed(3)}%), R²=${fit.r2.toFixed(5)}`,
  });

  return out;
}
