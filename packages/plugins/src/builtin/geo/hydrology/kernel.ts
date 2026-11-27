// ==========================================================================
// Ergalics Studio — geo-hydrology kernel (pure TS, DOM-free)
//
// SCS-CN rainfall excess partitioning plus SCS synthetic unit hydrograph
// convolution producing direct runoff hydrographs.
//
// References:
// - SCS, National Engineering Handbook, Section 4: Hydrology (1972):
//     S = 25400/CN - 254 [mm],  Ia = 0.2 S,
//     Q(P) = (P - Ia)^2 / (P + 0.8 S)   for P > Ia, else 0.
// - NWS/NOHRSC "Unit Hydrograph (UHG) Technical Manual": dimensionless
//   curvilinear UH table (t/Tp, q/qp); equivalent triangle Tb = 2.67 Tp
//   with 37.5% of volume on the rising limb, giving the SI peak relation
//   qp [m3/s per mm] = 0.208 * A[km2] / Tp[h].
//
// Mass conservation: excess rainfall is obtained by differencing the
// cumulative SCS runoff function (telescoping sum) and the unit hydrograph
// ordinates are discretely renormalized so that, to machine precision,
// sum(Q_k) * 3600 * dt == sum(excess_mm) * 1000 * A.
// ==========================================================================

/** Initial abstraction ratio Ia = IA_RATIO * S (SCS 1972 standard). */
export const IA_RATIO = 0.2;

/** Triangular UH time base Tb = TRIANGLE_TB_RATIO * Tp (SCS 1972). */
export const TRIANGLE_TB_RATIO = 2.67;

/**
 * SI peak factor: qp [m3/s per mm of excess] = PEAK_FACTOR_SI * A[km2] / Tp[h].
 * Exact value 2000/(2.67*3600) = 0.2081; the classic 484 peaking factor in
 * English units corresponds to the same geometry.
 */
export const PEAK_FACTOR_SI = 0.208;

/** Curvilinear table extends to 5.0 * Tp. */
export const CURVILINEAR_TB_RATIO = 5.0;

/** 1 mm of depth over 1 km2 of area is 1000 m3 of water. */
export const M3_PER_MM_PER_KM2 = 1000;

/**
 * Built-in demo design storm: 6-hour, 90 mm total, hourly increments with the
 * peak at 40% of the duration (6.25 / 18.75 / 27.50 / 20.83 / 12.50 / 4.17).
 * This is a synthetic NWS-style design hyetograph envelope, not observed data.
 */
export const DESIGN_STORM_90MM_6H: readonly number[] = [6.25, 18.75, 27.5, 20.83, 12.5, 4.17];

// --------------------------------------------------------------------------
// SCS curve number runoff
// --------------------------------------------------------------------------

/** Potential maximum retention S [mm] from the curve number CN (10..100). */
export function potentialRetention(cn: number): number {
  return 25400 / cn - 254;
}

/** Initial abstraction Ia [mm] = IA_RATIO * S. */
export function initialAbstraction(sMm: number): number {
  return IA_RATIO * sMm;
}

/** Cumulative SCS runoff Q [mm] for cumulative rainfall P [mm] and retention S [mm]. */
export function scsRunoff(pMm: number, sMm: number): number {
  const ia = IA_RATIO * sMm;
  if (pMm <= ia) return 0;
  const num = pMm - ia;
  return (num * num) / (pMm + 0.8 * sMm);
}

/**
 * Incremental excess rainfall [mm] per step, obtained by differencing the
 * cumulative SCS runoff function at the cumulative precipitation depths.
 * The increments telescope, so sum(increments) === Q(P_total) to machine
 * precision — the foundation of the mass-conservation guarantee.
 */
export function excessRainfallIncrements(precipMm: readonly number[], sMm: number): number[] {
  const out: number[] = [];
  let cumP = 0;
  let cumQPrev = 0;
  for (let i = 0; i < precipMm.length; i += 1) {
    cumP += precipMm[i]!;
    const q = scsRunoff(cumP, sMm);
    out.push(q - cumQPrev);
    cumQPrev = q;
  }
  return out;
}

// --------------------------------------------------------------------------
// Unit hydrograph
// --------------------------------------------------------------------------

export type UhType = 'triangular' | 'curvilinear';

export interface DimensionlessPoint {
  tRatio: number;
  qRatio: number;
}

/**
 * SCS dimensionless curvilinear unit hydrograph, discharge ratios q/qp vs
 * t/Tp, as tabulated in the NWS/NOHRSC UHG technical manual (Table 1).
 */
export const CURVILINEAR_UH_TABLE: readonly DimensionlessPoint[] = [
  { tRatio: 0.0, qRatio: 0.0 },
  { tRatio: 0.1, qRatio: 0.03 },
  { tRatio: 0.2, qRatio: 0.1 },
  { tRatio: 0.3, qRatio: 0.19 },
  { tRatio: 0.4, qRatio: 0.31 },
  { tRatio: 0.5, qRatio: 0.47 },
  { tRatio: 0.6, qRatio: 0.66 },
  { tRatio: 0.7, qRatio: 0.82 },
  { tRatio: 0.8, qRatio: 0.93 },
  { tRatio: 0.9, qRatio: 0.99 },
  { tRatio: 1.0, qRatio: 1.0 },
  { tRatio: 1.1, qRatio: 0.99 },
  { tRatio: 1.2, qRatio: 0.93 },
  { tRatio: 1.3, qRatio: 0.86 },
  { tRatio: 1.4, qRatio: 0.78 },
  { tRatio: 1.5, qRatio: 0.68 },
  { tRatio: 1.6, qRatio: 0.56 },
  { tRatio: 1.7, qRatio: 0.46 },
  { tRatio: 1.8, qRatio: 0.39 },
  { tRatio: 1.9, qRatio: 0.33 },
  { tRatio: 2.0, qRatio: 0.28 },
  { tRatio: 2.2, qRatio: 0.207 },
  { tRatio: 2.4, qRatio: 0.147 },
  { tRatio: 2.6, qRatio: 0.107 },
  { tRatio: 2.8, qRatio: 0.077 },
  { tRatio: 3.0, qRatio: 0.055 },
  { tRatio: 3.2, qRatio: 0.04 },
  { tRatio: 3.4, qRatio: 0.029 },
  { tRatio: 3.6, qRatio: 0.021 },
  { tRatio: 3.8, qRatio: 0.015 },
  { tRatio: 4.0, qRatio: 0.011 },
  { tRatio: 4.5, qRatio: 0.005 },
  { tRatio: 5.0, qRatio: 0.0 },
];

/** Linear interpolation of the dimensionless curvilinear shape (0 outside [0, 5]). */
export function curvilinearShapeRatio(tRatio: number): number {
  if (tRatio <= 0 || tRatio >= CURVILINEAR_TB_RATIO) return 0;
  const table = CURVILINEAR_UH_TABLE;
  for (let i = 1; i < table.length; i += 1) {
    const hi = table[i]!;
    const lo = table[i - 1]!;
    if (tRatio <= hi.tRatio) {
      const w = (tRatio - lo.tRatio) / (hi.tRatio - lo.tRatio);
      return lo.qRatio + w * (hi.qRatio - lo.qRatio);
    }
  }
  return 0;
}

export interface UnitHydrograph {
  /** Ordinates [m3/s per mm of excess] on the grid t_k = k * dtHours, renormalized. */
  ordinates: number[];
  /** Analytic peak qp [m3/s per mm] before discrete renormalization. */
  qpAnalyticM3s: number;
  /** Analytic time base [h] (2.67 Tp triangular, 5.0 Tp curvilinear). */
  timeBaseHours: number;
  /** Discrete renormalization factor applied so the volume is exact. */
  renormFactor: number;
  dtHours: number;
  type: UhType;
}

/**
 * Build the SCS unit hydrograph sampled on the k*dt grid.
 *
 * The analytic peak is qp = peakFactor * A / Tp. Sampling a continuous shape
 * on a finite grid plus the tiny rounded-peak deficit of the 0.208 constant
 * leaves the rectangle-sum volume a fraction of a percent off; the ordinates
 * are therefore renormalized by k = 1000*A / (3600*dt*sum(u)) so the unit
 * hydrograph volume is EXACTLY 1 mm over the basin.
 */
export function buildUnitHydrograph(
  areaKm2: number,
  tpHours: number,
  dtHours: number,
  type: UhType,
  peakFactor: number = PEAK_FACTOR_SI,
): UnitHydrograph {
  const qp = (peakFactor * areaKm2) / tpHours;
  const tbRatio = type === 'triangular' ? TRIANGLE_TB_RATIO : CURVILINEAR_TB_RATIO;
  const tb = tbRatio * tpHours;
  const n = Math.max(1, Math.ceil(tb / dtHours - 1e-9));
  const raw: number[] = [];
  for (let k = 0; k <= n; k += 1) {
    const t = k * dtHours;
    if (t > tb) {
      raw.push(0);
      continue;
    }
    if (type === 'triangular') {
      if (t <= tpHours) {
        raw.push((qp * t) / tpHours);
      } else {
        raw.push((qp * (tb - t)) / (tb - tpHours));
      }
    } else {
      raw.push(qp * curvilinearShapeRatio(t / tpHours));
    }
  }
  const sum = raw.reduce((a, b) => a + b, 0);
  // Ordinate sum required for exact volume: sum(u) * 3600 * dt = 1000 * A.
  const target = (M3_PER_MM_PER_KM2 * areaKm2) / (3600 * dtHours);
  const k = sum > 0 ? target / sum : 1;
  return {
    ordinates: raw.map((v) => v * k),
    qpAnalyticM3s: qp,
    timeBaseHours: tb,
    renormFactor: k,
    dtHours,
    type,
  };
}

/**
 * Discrete convolution of excess-rainfall increments [mm] with unit
 * hydrograph ordinates [m3/s per mm]; returns direct runoff [m3/s] of
 * length excess.length + uh.length - 1 on the same dt grid.
 */
export function convolveHyetograph(excessMm: readonly number[], uh: readonly number[]): number[] {
  const n = excessMm.length + uh.length - 1;
  const out = new Array<number>(Math.max(n, 0)).fill(0);
  for (let i = 0; i < excessMm.length; i += 1) {
    const x = excessMm[i]!;
    if (x === 0) continue;
    for (let j = 0; j < uh.length; j += 1) {
      out[i + j] = out[i + j]! + x * uh[j]!;
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// Full event
// --------------------------------------------------------------------------

export interface ScsEventOptions {
  /** Incremental precipitation [mm]; increment i is applied at t = i*dt. */
  precipMm: readonly number[];
  dtHours: number;
  cn: number;
  areaKm2: number;
  /** Time to peak of the unit hydrograph [h]. */
  tpHours: number;
  uhType: UhType;
  /** SI peak factor (default 0.208). */
  peakFactor?: number;
}

export interface ScsEventResult {
  cn: number;
  sMm: number;
  iaMm: number;
  dtHours: number;
  precipMm: number[];
  excessMm: number[];
  cumulativePrecipMm: number[];
  cumulativeExcessMm: number[];
  /** Renormalized unit hydrograph ordinates [m3/s per mm]. */
  uhOrdinates: number[];
  /** Direct runoff hydrograph [m3/s]. */
  directRunoff: number[];
  /** Time axis of the hydrograph [h]. */
  timesHours: number[];
  totalPrecipMm: number;
  totalExcessMm: number;
  peakFlowM3s: number;
  timeToPeakHours: number;
  volumeExcessM3: number;
  volumeRunoffM3: number;
  /** |V_runoff - V_excess| / V_excess after renormalization (~machine eps). */
  massRelResidual: number;
  uh: UnitHydrograph;
}

export function runScsEvent(opts: ScsEventOptions): ScsEventResult {
  const s = potentialRetention(opts.cn);
  const ia = initialAbstraction(s);
  const excess = excessRainfallIncrements(opts.precipMm, s);
  const uh = buildUnitHydrograph(opts.areaKm2, opts.tpHours, opts.dtHours, opts.uhType, opts.peakFactor);
  const runoff = convolveHyetograph(excess, uh.ordinates);

  const cumP: number[] = [];
  const cumQ: number[] = [];
  let pAcc = 0;
  let qAcc = 0;
  for (let i = 0; i < opts.precipMm.length; i += 1) {
    pAcc += opts.precipMm[i]!;
    qAcc += excess[i]!;
    cumP.push(pAcc);
    cumQ.push(qAcc);
  }

  let peak = 0;
  let peakIdx = 0;
  for (let k = 0; k < runoff.length; k += 1) {
    if (runoff[k]! > peak) {
      peak = runoff[k]!;
      peakIdx = k;
    }
  }

  const volumeExcess = qAcc * M3_PER_MM_PER_KM2 * opts.areaKm2;
  const volumeRunoff = runoff.reduce((a, b) => a + b, 0) * 3600 * opts.dtHours;
  const residual = volumeExcess > 0 ? Math.abs(volumeRunoff - volumeExcess) / volumeExcess : 0;

  return {
    cn: opts.cn,
    sMm: s,
    iaMm: ia,
    dtHours: opts.dtHours,
    precipMm: opts.precipMm.slice(),
    excessMm: excess,
    cumulativePrecipMm: cumP,
    cumulativeExcessMm: cumQ,
    uhOrdinates: uh.ordinates,
    directRunoff: runoff,
    timesHours: runoff.map((_, k) => k * opts.dtHours),
    totalPrecipMm: pAcc,
    totalExcessMm: qAcc,
    peakFlowM3s: peak,
    timeToPeakHours: peakIdx * opts.dtHours,
    volumeExcessM3: volumeExcess,
    volumeRunoffM3: volumeRunoff,
    massRelResidual: residual,
    uh,
  };
}

// --------------------------------------------------------------------------
// Parsing
// --------------------------------------------------------------------------

export interface ParsedHyetograph {
  /** Incremental rainfall depths [mm]. */
  rainMm: number[];
  /** Inferred time step [h]; time column median diff, else the fallback. */
  dtHours: number;
  hasTimeColumn: boolean;
}

const splitRow = (line: string): string[] => {
  const cells = line.split(/[,\t;]+/).map((c) => c.trim());
  if (cells.length === 1) return cells[0]!.split(/\s+/).filter((c) => c.length > 0);
  return cells.filter((c) => c.length > 0);
};

/**
 * Parse hyetograph text (CSV / TSV / whitespace, '#'-comment lines allowed).
 * Recognized header names: rain / precip / mm / p for rainfall; time / hour /
 * t for the time column [h]. Without a header a single column is rainfall and
 * multi-column input is read as [time, ..., rain(last)].
 */
export function parseHyetograph(text: string, fallbackDtHours = 1): ParsedHyetograph {
  const rows: string[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    rows.push(splitRow(line));
  }
  if (rows.length === 0) return { rainMm: [], dtHours: fallbackDtHours, hasTimeColumn: false };

  const first = rows[0]!;
  const isNum = (c: string) => c !== '' && Number.isFinite(Number(c));
  const headerLike = first.some((c) => !isNum(c));

  let rainCol = -1;
  let timeCol = -1;
  let startRow = 0;
  const ncols = first.length;

  if (headerLike) {
    startRow = 1;
    for (let c = 0; c < ncols; c += 1) {
      const low = first[c]!.toLowerCase();
      if (rainCol < 0 && (low.includes('rain') || low.includes('precip') || low.includes('mm') || low === 'p')) {
        rainCol = c;
      }
      if (timeCol < 0 && (low.includes('time') || low.includes('hour') || low === 't' || low === 't_h')) {
        timeCol = c;
      }
    }
    if (rainCol < 0) rainCol = timeCol >= 0 && ncols === 2 ? 1 - timeCol : ncols - 1;
  } else {
    rainCol = ncols === 1 ? 0 : ncols - 1;
    timeCol = ncols >= 2 ? 0 : -1;
  }

  const rain: number[] = [];
  const times: number[] = [];
  for (let r = startRow; r < rows.length; r += 1) {
    const cells = rows[r]!;
    const rv = Number(cells[rainCol]);
    if (cells[rainCol] === undefined || cells[rainCol] === '' || !Number.isFinite(rv)) continue;
    rain.push(rv);
    if (timeCol >= 0) {
      const tv = Number(cells[timeCol]);
      times.push(Number.isFinite(tv) ? tv : rain.length - 1);
    }
  }

  let dt = fallbackDtHours;
  let hasTime = timeCol >= 0 && times.length === rain.length;
  if (hasTime && times.length >= 2) {
    const diffs: number[] = [];
    for (let i = 1; i < times.length; i += 1) {
      const d = times[i]! - times[i - 1]!;
      if (d > 0) diffs.push(d);
    }
    if (diffs.length > 0) {
      diffs.sort((a, b) => a - b);
      const mid = Math.floor(diffs.length / 2);
      const median = diffs.length % 2 === 1 ? diffs[mid]! : (diffs[mid - 1]! + diffs[mid]!) / 2;
      if (Number.isFinite(median) && median > 0) dt = Math.round(median * 1e6) / 1e6;
    } else {
      hasTime = false;
    }
  } else if (timeCol >= 0 && times.length !== rain.length) {
    hasTime = false;
  }

  return { rainMm: rain, dtHours: dt, hasTimeColumn: hasTime };
}

/** Parse pasted rainfall text (comma / whitespace / semicolon separated mm). */
export function parseRainText(text: string): number[] {
  return text
    .split(/[\s,;]+/)
    .filter((tok) => tok.length > 0)
    .map((tok) => Number(tok))
    .filter((v) => Number.isFinite(v));
}

// --------------------------------------------------------------------------
// Validation benchmarks (convention: relErr = |computed - analytic| / |analytic|)
// --------------------------------------------------------------------------

export interface BenchmarkOutcome {
  name: string;
  passed: boolean;
  relErr: number | null;
  detail: string;
}

/**
 * CN hand calculation: CN=80, P=50 mm gives S=63.5, Ia=12.7 and
 * Q = (50-12.7)^2 / (50 + 0.8*63.5) = 1391.29 / 100.8 = 13.8033 mm.
 */
export function benchmarkCnHandcalc(): BenchmarkOutcome {
  const cn = 80;
  const p = 50;
  const s = potentialRetention(cn);
  const q = scsRunoff(p, s);
  const analytic = ((p - 0.2 * s) * (p - 0.2 * s)) / (p + 0.8 * s);
  const relErr = Math.abs(q - analytic) / analytic;
  return {
    name: 'scs-cn-handcalc',
    passed: relErr < 1e-12 && Math.abs(s - 63.5) < 1e-9,
    relErr,
    detail: `CN=80: S=25400/80-254=63.5 mm, Ia=12.7 mm, Q=(50-12.7)^2/(50+0.8*63.5)=1391.29/100.8=${analytic.toFixed(4)} mm (got ${q.toFixed(6)})`,
  };
}

/**
 * Unit hydrograph peak: sampled on a fine grid (dt = Tp/100) the
 * renormalized peak must reproduce qp = 0.208 * A / Tp within 1% for both
 * the triangular and the curvilinear shape.
 */
export function benchmarkUnitHydrographPeak(): BenchmarkOutcome {
  const area = 10;
  const tp = 2;
  const dt = tp / 100;
  const qp = (PEAK_FACTOR_SI * area) / tp;
  let worst = 0;
  const parts: string[] = [];
  for (const type of ['triangular', 'curvilinear'] as UhType[]) {
    const u = buildUnitHydrograph(area, tp, dt, type);
    const peak = u.ordinates.reduce((a, b) => Math.max(a, b), 0);
    const rel = Math.abs(peak - qp) / qp;
    worst = Math.max(worst, rel);
    parts.push(`${type}: peak=${peak.toFixed(5)} vs qp=${qp.toFixed(5)} (renorm x${u.renormFactor.toFixed(6)})`);
  }
  return {
    name: 'scs-uh-peak',
    passed: worst < 0.01,
    relErr: worst,
    detail: `dt=Tp/100 (A=10 km2, Tp=2 h); ${parts.join('; ')}`,
  };
}

/**
 * Mass conservation over a full event: runoff volume must equal excess
 * volume to <1e-9 relative (holds to machine precision by construction).
 */
export function benchmarkMassConservation(): BenchmarkOutcome {
  let worst = 0;
  const parts: string[] = [];
  for (const type of ['triangular', 'curvilinear'] as UhType[]) {
    const ev = runScsEvent({
      precipMm: DESIGN_STORM_90MM_6H,
      dtHours: 0.5,
      cn: 80,
      areaKm2: 10,
      tpHours: 2,
      uhType: type,
    });
    worst = Math.max(worst, ev.massRelResidual);
    parts.push(
      `${type}: V_excess=${ev.volumeExcessM3.toFixed(4)} m3, V_runoff=${ev.volumeRunoffM3.toFixed(4)} m3, relResidual=${ev.massRelResidual.toExponential(2)}`,
    );
  }
  return {
    name: 'scs-mass-conservation',
    passed: worst < 1e-9,
    relErr: worst,
    detail: `90 mm / 6 h storm, CN=80, A=10 km2, dt=0.5 h; ${parts.join('; ')}`,
  };
}

/**
 * Linear superposition: the response to excess [a, b] must equal the
 * response to [a, 0] plus the response to [0, b] shifted by one step.
 */
export function benchmarkSuperposition(): BenchmarkOutcome {
  const uh = buildUnitHydrograph(5, 1.5, 0.5, 'curvilinear').ordinates;
  const a = 3.2;
  const b = 7.1;
  const full = convolveHyetograph([a, b], uh);
  const r1 = convolveHyetograph([a, 0], uh);
  const r2 = convolveHyetograph([0, b], uh);
  let maxDiff = 0;
  let peak = 0;
  for (let i = 0; i < full.length; i += 1) {
    const v = full[i]!;
    peak = Math.max(peak, Math.abs(v));
    maxDiff = Math.max(maxDiff, Math.abs(v - (r1[i]! + r2[i]!)));
  }
  const relErr = peak > 0 ? maxDiff / peak : 0;
  return {
    name: 'scs-superposition',
    passed: relErr < 1e-12,
    relErr,
    detail: `max|Q([a,b]) - (Q([a,0]) + shift(Q([0,b])))| / peak = ${relErr.toExponential(2)} (a=${a}, b=${b} mm)`,
  };
}

/** All geo-hydrology validation benchmarks, in report order. */
export function runAllBenchmarks(): BenchmarkOutcome[] {
  return [benchmarkCnHandcalc(), benchmarkUnitHydrographPeak(), benchmarkMassConservation(), benchmarkSuperposition()];
}
