// Data layer: CSV parsing, z-score normalization, and example-dataset loading.
//
// Example datasets live as real files under examples/data/ (ai-linear.csv,
// ai-nonlinear.csv, ai-logistic.csv, ai-mnist.csv) and are bundled at build
// time via import.meta.glob — matching the project-wide convention that all
// sample data is served from the examples/ folder, not generated in code.

import type { RawDataset } from './types';

/** Parse a delimited text file into column names + numeric rows.
 *  A leading row containing any non-numeric token is treated as a header. */
export function parseCsv(text: string): { columnNames: string[]; rows: number[][] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { columnNames: [], rows: [] };

  const first = (lines[0] ?? '').split(/[\s,]+/).filter(Boolean);
  const hasHeader = first.some((t) => !Number.isFinite(parseFloat(t)));

  let columnNames: string[];
  let dataLines: string[];
  if (hasHeader) {
    columnNames = first.map((t, i) => t || `c${i}`);
    dataLines = lines.slice(1);
  } else {
    columnNames = Array.from({ length: first.length }, (_, i) => `x${i}`);
    dataLines = lines;
  }

  const rows: number[][] = [];
  for (const line of dataLines) {
    const nums = line
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(parseFloat);
    if (nums.length === columnNames.length && nums.every(Number.isFinite)) {
      rows.push(nums);
    }
  }
  return { columnNames, rows };
}

/** Per-column z-score normalization. Returns normalized rows + cached stats. */
export function normalizeRows(
  rows: number[][],
): { norm: number[][]; means: number[]; stds: number[] } {
  const ncol = rows[0]?.length ?? 0;
  const means = new Array<number>(ncol).fill(0);
  const stds = new Array<number>(ncol).fill(1);
  if (rows.length === 0) return { norm: rows, means, stds };

  for (let j = 0; j < ncol; j += 1) {
    let s = 0;
    for (const r of rows) s += r[j]!;
    means[j] = s / rows.length;
    let v = 0;
    for (const r of rows) v += (r[j]! - means[j]!) ** 2;
    stds[j] = Math.sqrt(v / rows.length) || 1;
  }

  const norm = rows.map((r) => r.map((v, j) => (v - means[j]!) / stds[j]!));
  return { norm, means, stds };
}

/** Column mean (used to anchor free features when drawing partial-dependence curves). */
export function columnMean(rows: number[][], j: number): number {
  if (rows.length === 0) return 0;
  let s = 0;
  for (const r of rows) s += r[j]!;
  return s / rows.length;
}

/** Flatten [n][28][28] images into a single [n*784] array of numbers. */
export function flattenImages(images: number[][][]): number[] {
  const out: number[] = [];
  for (const img of images) {
    for (const row of img) {
      for (const v of row) out.push(v);
    }
  }
  return out;
}

/** Parse the MNIST-style CSV (label,p0..p783 per row) into an image dataset. */
export function parseMnistCsv(text: string): RawDataset {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const images: number[][][] = [];
  const labels: number[] = [];
  for (const line of lines) {
    const toks = line.split(',').map(parseFloat);
    if (toks.length !== 785) continue;
    const label = Math.round(toks[0]!);
    const px = toks.slice(1);
    const img: number[][] = [];
    for (let r = 0; r < 28; r += 1) img.push(px.slice(r * 28, r * 28 + 28));
    images.push(img);
    labels.push(label);
  }
  return {
    columnNames: ['label', ...Array.from({ length: 784 }, (_, i) => `p${i}`)],
    rows: [],
    isImage: true,
    images,
    labels,
  };
}

// Example datasets (ai-linear.csv etc.) are bundled and served exclusively
// through the global sample dialog (src/core/examples.ts), which lazily loads
// them via its own import.meta.glob. The plugin itself no longer loads
// samples, so no glob is kept here.
