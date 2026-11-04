// ==========================================================================
// stats-utils — shared parsing, linear algebra and canvas helpers for the
// seven statistics plugins.
//
// The kernels are pure TypeScript (no DOM); this module keeps the common
// numeric plumbing (CSV parsing, z-scores, symmetric eigen-solver, matrix
// inverse) and the canvas chrome in one place so the individual plugins stay
// focused on their statistical model.
// ==========================================================================

import { CS, font, type PlotBox } from './cs-utils';

export interface Table {
  header: string[];
  rows: string[][];
}

/** Split one CSV line, honouring quoted fields with doubled quotes. */
export function splitCsvLine(line: string, delimiter = ','): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function detectDelimiter(line: string): string {
  const counts = [',', '\t', ';'].map((d) => [d, line.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 1 ? counts[0]![0] : ',';
}

/** Parse CSV / TSV / semicolon text with a header row. */
export function parseTable(text: string): Table {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const delimiter = detectDelimiter(lines[0]!);
  const header = splitCsvLine(lines[0]!, delimiter).map((h, i) => h || `col${i + 1}`);
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]!, delimiter);
    if (cells.every((c) => c === '')) continue;
    rows.push(cells);
  }
  return { header, rows };
}

/** Numeric column by header name (or index); non-finite cells dropped. */
export function numericColumn(table: Table, column: string | number): number[] {
  const idx = typeof column === 'number' ? column : table.header.indexOf(column);
  if (idx < 0) return [];
  const out: number[] = [];
  for (const row of table.rows) {
    const v = Number(row[idx]);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** Numeric column paired with a label column, dropping invalid rows. */
export function labelledColumn(
  table: Table,
  labelColumn: string | number,
  valueColumn: string | number,
): Array<{ label: string; value: number }> {
  const li = typeof labelColumn === 'number' ? labelColumn : table.header.indexOf(labelColumn);
  const vi = typeof valueColumn === 'number' ? valueColumn : table.header.indexOf(valueColumn);
  const out: Array<{ label: string; value: number }> = [];
  if (li < 0 || vi < 0) return out;
  for (const row of table.rows) {
    const v = Number(row[vi]);
    if (Number.isFinite(v)) out.push({ label: String(row[li] ?? ''), value: v });
  }
  return out;
}

/** Group rows by a categorical column. */
export function groupColumn(table: Table, groupColumn: string | number, valueColumn: string | number): Array<{ label: string; values: number[] }> {
  const gi = typeof groupColumn === 'number' ? groupColumn : table.header.indexOf(groupColumn);
  const vi = typeof valueColumn === 'number' ? valueColumn : table.header.indexOf(valueColumn);
  if (gi < 0 || vi < 0) return [];
  const groups = new Map<string, number[]>();
  for (const row of table.rows) {
    const v = Number(row[vi]);
    if (!Number.isFinite(v)) continue;
    const key = String(row[gi] ?? 'group');
    const arr = groups.get(key) ?? [];
    arr.push(v);
    groups.set(key, arr);
  }
  return [...groups.entries()].map(([label, values]) => ({ label, values }));
}

/** Columns that parse as numbers for at least half of their non-empty cells. */
export function numericColumns(table: Table): string[] {
  return table.header.filter((_name, idx) => {
    let seen = 0;
    let ok = 0;
    for (const row of table.rows) {
      const raw = row[idx];
      if (raw === undefined || raw === '') continue;
      seen += 1;
      if (Number.isFinite(Number(raw))) ok += 1;
    }
    return seen > 0 && ok / seen >= 0.5;
  });
}

export function mean(x: readonly number[]): number {
  if (x.length === 0) return NaN;
  let s = 0;
  for (const v of x) s += v;
  return s / x.length;
}

export function variance(x: readonly number[], sample = true): number {
  if (x.length < 2) return NaN;
  const m = mean(x);
  let s = 0;
  for (const v of x) s += (v - m) ** 2;
  return s / (sample ? x.length - 1 : x.length);
}

export function std(x: readonly number[], sample = true): number {
  const v = variance(x, sample);
  return Number.isFinite(v) ? Math.sqrt(v) : v;
}

export function zscore(x: readonly number[]): number[] {
  const m = mean(x);
  const s = std(x, true);
  if (!Number.isFinite(s) || s === 0) return x.map(() => 0);
  return x.map((v) => (v - m) / s);
}

// ---- linear algebra -------------------------------------------------------

export type Matrix = number[][];

export function zeros(n: number, m: number): Matrix {
  return Array.from({ length: n }, () => new Array<number>(m).fill(0));
}

export function matMul(a: Matrix, b: Matrix): Matrix {
  const n = a.length;
  const k = a[0]?.length ?? 0;
  const m = b[0]?.length ?? 0;
  const out = zeros(n, m);
  for (let i = 0; i < n; i += 1) {
    for (let t = 0; t < k; t += 1) {
      const av = a[i]![t]!;
      if (av === 0) continue;
      const brow = b[t]!;
      const orow = out[i]!;
      for (let j = 0; j < m; j += 1) orow[j]! += av * brow[j]!;
    }
  }
  return out;
}

export function transpose(a: Matrix): Matrix {
  const n = a.length;
  const m = a[0]?.length ?? 0;
  const out = zeros(m, n);
  for (let i = 0; i < n; i += 1) for (let j = 0; j < m; j += 1) out[j]![i] = a[i]![j]!;
  return out;
}

/** Gauss-Jordan inverse with partial pivoting; returns null when singular. */
export function invert(a: Matrix): Matrix | null {
  const n = a.length;
  const aug = zeros(n, 2 * n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) aug[i]![j] = a[i]![j]!;
    aug[i]![n + i] = 1;
  }
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(aug[r]![col]!) > Math.abs(aug[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(aug[pivot]![col]!) < 1e-12) return null;
    if (pivot !== col) {
      const tmp = aug[pivot]!;
      aug[pivot] = aug[col]!;
      aug[col] = tmp;
    }
    const pv = aug[col]![col]!;
    for (let j = 0; j < 2 * n; j += 1) aug[col]![j]! /= pv;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = aug[r]![col]!;
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j += 1) aug[r]![j]! -= factor * aug[col]![j]!;
    }
  }
  return aug.map((row) => row.slice(n));
}

/** Solve A x = b via the inverse (null when singular). */
export function solve(a: Matrix, b: number[]): number[] | null {
  const inv = invert(a);
  if (!inv) return null;
  return inv.map((row) => row.reduce((s, v, j) => s + v * b[j]!, 0));
}

export interface EigenResult {
  values: number[];
  /** Columns are eigenvectors. */
  vectors: Matrix;
}

/** Cyclic Jacobi eigen-decomposition of a real symmetric matrix. */
export function jacobiEigen(input: Matrix, sweeps = 100): EigenResult {
  const n = input.length;
  const a = input.map((row) => [...row]);
  const v = zeros(n, n);
  for (let i = 0; i < n; i += 1) v[i]![i] = 1;
  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n; p += 1) for (let q = p + 1; q < n; q += 1) off += a[p]![q]! ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < 1e-15) continue;
        const app = a[p]![p]!;
        const aqq = a[q]![q]!;
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values: number[] = [];
  for (let i = 0; i < n; i += 1) values.push(a[i]![i]!);
  // Sort descending, reorder eigenvector columns to match.
  const order = [...values.keys()].sort((i, j) => values[j]! - values[i]!);
  return {
    values: order.map((i) => values[i]!),
    vectors: Array.from({ length: n }, (_, r) => order.map((c) => v[r]![c]!)),
  };
}

/** Covariance matrix (columns = variables). */
export function covarianceMatrix(rows: Matrix, sample = true): Matrix {
  const n = rows.length;
  const p = rows[0]?.length ?? 0;
  const out = zeros(p, p);
  if (n === 0) return out;
  const means = new Array<number>(p).fill(0);
  for (const row of rows) for (let j = 0; j < p; j += 1) means[j]! += row[j]!;
  for (let j = 0; j < p; j += 1) means[j]! /= n;
  const denom = sample ? Math.max(1, n - 1) : n;
  for (const row of rows) {
    for (let i = 0; i < p; i += 1) {
      for (let j = i; j < p; j += 1) {
        out[i]![j]! += (row[i]! - means[i]!) * (row[j]! - means[j]!) / denom;
      }
    }
  }
  for (let i = 0; i < p; i += 1) for (let j = 0; j < i; j += 1) out[i]![j] = out[j]![i]!;
  return out;
}

export function standardizeRows(rows: Matrix): Matrix {
  const n = rows.length;
  const p = rows[0]?.length ?? 0;
  const cols: number[][] = [];
  for (let j = 0; j < p; j += 1) cols.push(zscore(rows.map((r) => r[j]!)));
  return Array.from({ length: n }, (_, i) => cols.map((c) => c[i]!));
}

// ---- canvas helpers -------------------------------------------------------

/** Map a value from [lo, hi] into the plot box's vertical range. */
export function yScale(box: PlotBox, lo: number, hi: number) {
  const span = hi - lo || 1;
  return (v: number) => box.y1 - ((v - lo) / span) * box.h;
}

export function xScale(box: PlotBox, lo: number, hi: number) {
  const span = hi - lo || 1;
  return (v: number) => box.x0 + ((v - lo) / span) * box.w;
}

/** Grid + axes with roughly five ticks each. */
export function drawFrame(
  g: CanvasRenderingContext2D,
  box: PlotBox,
  zh: boolean,
  xLabel = '',
  yLabel = '',
): void {
  g.strokeStyle = CS.axis;
  g.lineWidth = 1;
  g.strokeRect(box.x0, box.y0, box.w, box.h);
  g.font = font(false, 9);
  g.fillStyle = CS.faint;
  g.textAlign = 'center';
  if (xLabel) g.fillText(xLabel, (box.x0 + box.x1) / 2, box.y1 + 30);
  if (yLabel) {
    g.save();
    g.translate(14, (box.y0 + box.y1) / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(yLabel, 0, 0);
    g.restore();
  }
  void zh;
}

/** Draw a polyline through x/y points (already scaled to pixels). */
export function strokedPath(
  g: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  color: string,
  width = 1.6,
  dash: number[] = [],
): void {
  if (pts.length === 0) return;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.setLineDash(dash);
  g.beginPath();
  pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
  g.stroke();
  g.setLineDash([]);
}

/** Draw bars from a baseline. */
export function filledBars(
  g: CanvasRenderingContext2D,
  bars: Array<{ x0: number; x1: number; y: number; base: number }>,
  color: string,
): void {
  g.fillStyle = color;
  for (const b of bars) {
    const top = Math.min(b.y, b.base);
    const height = Math.abs(b.base - b.y);
    g.fillRect(b.x0, top, Math.max(1, b.x1 - b.x0), Math.max(0.5, height));
  }
}

export function fmt(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  if (v !== 0 && Math.abs(v) < 1e-3) return v.toExponential(2);
  if (Math.abs(v) >= 1e5) return v.toExponential(2);
  return v.toFixed(digits);
}

export function fmtP(p: number): string {
  if (!Number.isFinite(p)) return '—';
  if (p < 1e-4) return '< 0.0001';
  return p.toFixed(4);
}

/** Erfc-free normal tail used by several kernels. */
export function normalTwoSidedP(z: number): number {
  // Abramowitz & Stegun 7.1.26 error-function approximation.
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return Math.max(0, Math.min(1, 1 - erf));
}
