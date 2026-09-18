// ==========================================================================
// Subject templates — deterministic sample-data builders (pure TS)
//
// Every template ships with a small, fully valid dataset generated from a
// fixed mulberry32 seed (see core/repro/random), so `buildProject()` never
// produces an empty first screen and results are identical across runs.
// Datasets are plain text (CSV / JSON) to stay inside the project's
// text-file storage contract (types/project FileEntry).
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

/** Standard-normal sample via Box–Muller on top of a seeded uniform RNG. */
export function gauss(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Round to `d` decimals (keeps generated text compact and stable). */
export function round(x: number, d = 4): number {
  const p = 10 ** d;
  return Math.round(x * p) / p;
}

/** Build a CSV document (headers + rows) from scalar cell values. */
export function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(r.map((c) => String(c)).join(','));
  return lines.join('\n') + '\n';
}

// ---- per-template generators ----------------------------------------------

/** physics-error: free-fall timing trials used to estimate g. */
export function freefallCsv(): string {
  const rng = mulberry32(20260901);
  const rows: Array<Array<string | number>> = [];
  for (let i = 0; i < 24; i += 1) {
    const h = round(0.2 + (i / 23) * 1.3 + gauss(rng) * 0.004, 3); // drop height, m
    const g = 9.81;
    const t = round(Math.sqrt((2 * h) / g) + Math.abs(gauss(rng)) * 0.004 + 0.002, 4);
    rows.push([i + 1, h, t]);
  }
  return toCsv(['trial', 'height_m', 'time_s'], rows);
}

/** bio-stats: enzyme activity, control vs treatment (true difference). */
export function enzymeCsv(): string {
  const rng = mulberry32(20260902);
  const rows: Array<Array<string | number>> = [];
  for (let i = 0; i < 30; i += 1) rows.push([`C${i + 1}`, 'control', round(12.4 + gauss(rng) * 1.6, 2)]);
  for (let i = 0; i < 30; i += 1) rows.push([`T${i + 1}`, 'treatment', round(10.1 + gauss(rng) * 1.8, 2)]);
  return toCsv(['sample', 'group', 'activity_U_per_mL'], rows);
}

/** astro-fits: extracted 1-D spectrum, three emission lines on a continuum. */
export function spectrumCsv(): string {
  const rng = mulberry32(20260903);
  const peaks = [
    { c: 4861, a: 42, w: 6 }, // H-beta
    { c: 4959, a: 25, w: 5 }, // [O III]
    { c: 5007, a: 70, w: 5 }, // [O III]
  ];
  const rows: Array<Array<string | number>> = [];
  for (let i = 0; i < 300; i += 1) {
    const wl = round(4000 + i * 10, 1);
    let flux = 12 + (wl - 4000) * 0.002;
    for (const p of peaks) flux += p.a * Math.exp(-((wl - p.c) ** 2) / (2 * p.w * p.w));
    const err = round(0.9 + Math.abs(gauss(rng)) * 0.3, 3);
    rows.push([wl, round(flux + gauss(rng) * err, 3), err]);
  }
  return toCsv(['wavelength_A', 'flux', 'flux_err'], rows);
}

/** eng-signal: damped structural vibration + broadband noise (accelerometer). */
export function vibrationCsv(): string {
  const rng = mulberry32(20260904);
  const fs = 2048;
  const rows: Array<Array<string | number>> = [];
  for (let i = 0; i < 1024; i += 1) {
    const t = i / fs;
    const x =
      1.6 * Math.exp(-1.1 * t) * Math.sin(2 * Math.PI * 49 * t) +
      0.7 * Math.exp(-2.4 * t) * Math.sin(2 * Math.PI * 123 * t + 0.6) +
      gauss(rng) * 0.12;
    rows.push([round(t, 5), round(x, 4)]);
  }
  return toCsv(['time_s', 'accel_g'], rows);
}

/** chem-kinetics: temperature-programmed first-order concentration decay. */
export function kineticsCsv(): string {
  const rng = mulberry32(20260905);
  const rows: Array<Array<string | number>> = [];
  for (let i = 0; i < 120; i += 1) {
    const t = round(i * 5, 1);
    const temp = round(298 + i * 0.8 + gauss(rng) * 0.4, 2);
    const k = 0.004 * Math.exp((temp - 298) / 45);
    const c = round(1.0 * Math.exp(-k * t) + Math.abs(gauss(rng)) * 0.008, 5);
    rows.push([t, temp, c]);
  }
  return toCsv(['time_s', 'temp_K', 'conc_mM'], rows);
}

/** geo-hdf5: gridded terrain elevation point cloud (synthetic DEM). */
export function terrainCsv(): string {
  const rng = mulberry32(20260906);
  const rows: Array<Array<string | number>> = [];
  for (let gy = 0; gy < 30; gy += 1) {
    for (let gx = 0; gx < 30; gx += 1) {
      const x = gx * 10;
      const y = gy * 10;
      const z =
        120 +
        38 * Math.sin(x / 85) * Math.cos(y / 70) +
        14 * Math.sin((x + y) / 33) +
        gauss(rng) * 1.6;
      rows.push([x, y, round(z, 2)]);
    }
  }
  return toCsv(['x_m', 'y_m', 'elev_m'], rows);
}

/** med-bayes: Weibull survival times with censoring. */
export function survivalCsv(): string {
  const rng = mulberry32(20260907);
  const shape = 1.3;
  const scale = 180;
  const rows: Array<Array<string | number>> = [];
  for (let i = 0; i < 150; i += 1) {
    const u = Math.min(0.999999, rng());
    const t = round(scale * (-Math.log(1 - u)) ** (1 / shape), 1);
    const censored = rng() < 0.25 && t > 240;
    rows.push([`P${String(i + 1).padStart(3, '0')}`, t, censored ? 0 : 1]);
  }
  return toCsv(['patient_id', 'time_days', 'event'], rows);
}

/** math-qq: log-normal return series (right-skewed, fat tail). */
export function returnsCsv(): string {
  const rng = mulberry32(20260908);
  const rows: Array<Array<string | number>> = [];
  for (let i = 0; i < 240; i += 1) {
    const z = gauss(rng);
    const r = round(Math.exp(0.02 + 0.25 * z) - 1, 5);
    rows.push([i + 1, r]);
  }
  return toCsv(['obs', 'return'], rows);
}

/** eng-heat: steady-state 2-D heat-equation solution on a 32x32 grid. */
export function heatFieldJson(): string {
  const rng = mulberry32(20260909);
  const n = 32;
  const cells: number[] = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const x = i / (n - 1);
      const y = j / (n - 1);
      const t =
        300 +
        90 * Math.sin(Math.PI * x) * Math.sin(Math.PI * y) +
        25 * Math.exp(-(((x - 0.75) ** 2 + (y - 0.25) ** 2) / 0.01)) -
        40 * x;
      cells.push(round(t + gauss(rng) * 0.4, 2));
    }
  }
  return JSON.stringify({ rows: n, cols: n, cell_size_m: 0.01, T_K: cells });
}

/** bio-sankey: phylum → class → genus abundance flow edges. */
export function microbiomeCsv(): string {
  const rng = mulberry32(20260910);
  const tree: Array<[string, string[], string[]]> = [
    ['Firmicutes', ['Bacilli', 'Clostridia'], ['Lactobacillus', 'Staphylococcus', 'Clostridium', 'Ruminococcus']],
    ['Bacteroidetes', ['Bacteroidia'], ['Bacteroides', 'Prevotella']],
    ['Proteobacteria', ['Gammaproteobacteria'], ['Escherichia', 'Pseudomonas']],
    ['Actinobacteria', ['Actinomycetia'], ['Bifidobacterium']],
  ];
  const rows: Array<Array<string | number>> = [];
  const v = () => Math.round(20 + rng() * 180);
  for (const [phylum, classes, genera] of tree) {
    for (const cls of classes) rows.push([phylum, cls, v()]);
    for (const gen of genera) {
      const cls = classes[(gen.length + phylum.length) % classes.length] ?? classes[0]!;
      rows.push([cls, gen, v()]);
    }
  }
  return toCsv(['source', 'target', 'abundance'], rows);
}

/** astro-sql: multi-band photometric time series for SQL aggregation. */
export function lightcurveCsv(): string {
  const rng = mulberry32(20260911);
  const bands = ['G', 'R', 'I'] as const;
  const offset: Record<string, number> = { G: 0, R: 0.18, I: 0.42 };
  const rows: Array<Array<string | number>> = [];
  for (let i = 0; i < 400; i += 1) {
    const mjd = round(60400 + i * 0.35, 3);
    const band = bands[i % 3]!;
    const phase = (i * 0.35) / 12.4;
    const mag = round(14.2 + offset[band]! + 0.35 * Math.sin(2 * Math.PI * phase) + gauss(rng) * 0.03, 4);
    rows.push([mjd, band, mag, round(0.02 + rng() * 0.03, 4)]);
  }
  return toCsv(['mjd', 'band', 'mag', 'mag_err'], rows);
}

/** med-dose: 4-parameter log-logistic dose–response replicates. */
export function doseResponseCsv(): string {
  const rng = mulberry32(20260912);
  const top = 98;
  const bottom = 4;
  const ic50 = 32;
  const hill = 1.4;
  const doses = [0.1, 0.3, 1, 3, 10, 30, 100, 300];
  const rows: Array<Array<string | number>> = [];
  for (const d of doses) {
    for (let r = 0; r < 12; r += 1) {
      const y = bottom + (top - bottom) / (1 + (ic50 / d) ** hill);
      rows.push([d, round(y + gauss(rng) * 3.5, 2)]);
    }
  }
  return toCsv(['dose_uM', 'response_pct'], rows);
}
