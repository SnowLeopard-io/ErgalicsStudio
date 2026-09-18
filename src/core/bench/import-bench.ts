// ==========================================================================
// FR-23 benchmark — data-import path.
//
// Generates fixed-seed CSV and JSON samples (mulberry32, seed 42 → the exact
// same bytes every run) and pushes them through the *real* import pipeline
// (`parseDataText` from @/blocks/fileData, the same entry point the workbench
// uses for dropped files). Throughput is reported in rows/s.
//
// Pure TS, Node-safe: the import chain (fileData → types/datatable) touches
// no DOM.
// ==========================================================================

import { mulberry32 } from '../repro/random';
import { parseDataText } from '@/blocks/fileData';
import { median, timeBestOf, type BenchMetric, type BenchSuite } from './types';

/** Rows per sample — sized so each rep finishes well under a second. */
const ROWS = 50_000;
/** Timing reps; the median of per-rep throughputs damps scheduler jitter. */
const REPS = 5;

/** Deterministic CSV: header + ROWS rows of 4 numeric columns. The CSV path
 *  of `parseDataText` is the numeric delimited-columns parser (scientific
 *  convention: text tokens make a row malformed), so the sample stays purely
 *  numeric; occasional empty cells exercise the NaN-missing path. */
export function makeCsvSample(rows: number, seed = 42): string {
  const rnd = mulberry32(seed);
  const out: string[] = ['x,y,temperature,weight'];
  for (let i = 0; i < rows; i += 1) {
    const x = (rnd() * 100).toFixed(4);
    const y = (rnd() * -50 + 25).toFixed(4);
    const t = rnd() < 0.02 ? '' : (273 + rnd() * 50).toFixed(2);
    const w = (rnd() * 10).toFixed(3);
    out.push(`${x},${y},${t},${w}`);
  }
  return out.join('\n');
}

/** Deterministic JSON row-records sample (same seed → same numbers). */
export function makeJsonSample(rows: number, seed = 42): string {
  const rnd = mulberry32(seed);
  const records = new Array<{ x: number; y: number; label: string }>(rows);
  for (let i = 0; i < rows; i += 1) {
    records[i] = {
      x: Math.round(rnd() * 1e6) / 1e4,
      y: Math.round(rnd() * 1e6) / 1e4,
      label: `r${i}`,
    };
  }
  return JSON.stringify(records);
}

/** Run one parse rep set; returns median throughput in rows/s. */
function benchParse(text: string, fileName: string, expectedRows: number): number {
  // Warm-up rep (JIT), not counted.
  const warm = parseDataText(text, fileName);
  if (warm.length !== expectedRows) {
    throw new Error(`bench import: parsed ${warm.length} rows, expected ${expectedRows}`);
  }
  const rates: number[] = [];
  for (let r = 0; r < REPS; r += 1) {
    const ms = timeBestOf(1, () => {
      const table = parseDataText(text, fileName);
      if (table.length !== expectedRows) throw new Error('bench import: row count drift');
    });
    rates.push((expectedRows / ms) * 1000);
  }
  return median(rates);
}

export function runImportBench(): BenchSuite {
  const t0 = performance.now();
  const csv = makeCsvSample(ROWS);
  const json = makeJsonSample(ROWS);

  const csvRowsPerSec = benchParse(csv, 'bench.csv', ROWS);
  const jsonRowsPerSec = benchParse(json, 'bench.json', ROWS);

  const metrics: BenchMetric[] = [
    {
      id: 'import.csv_rows_per_sec',
      label: `CSV 导入吞吐（${ROWS} 行 × 4 列）`,
      value: Math.round(csvRowsPerSec),
      unit: 'rows/s',
      direction: 'up',
      workload: `${ROWS} rows, seed=42`,
    },
    {
      id: 'import.json_rows_per_sec',
      label: `JSON 导入吞吐（${ROWS} 行记录）`,
      value: Math.round(jsonRowsPerSec),
      unit: 'rows/s',
      direction: 'up',
      workload: `${ROWS} records, seed=42`,
    },
  ];

  return {
    name: 'import',
    duration_ms: Math.round(performance.now() - t0),
    metrics,
  };
}
