// ==========================================================================
// EM-CFD Coupler — Figure Studio panels
//
// Turns a completed coupling result into publication-grade PlotSpec panels:
//   1. a surface-heatmap of the 3-D field mid-plane slice,
//   2. the 1-D outlet mass-flow time series,
//   3. the 3-D back-pressure time series (reverse coupling),
//   4. the valve-opening schedule (ms control).
// Pure so it is directly unit-testable; the plugin streams these into the
// figure store's shared sheet via `sendToFigure`.
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import type { EmCouplingResult } from './types';
import { fieldIndex } from './render3d';

/** One Figure Studio panel placement (row-major, spreadsheet-style tags). */
export interface FigurePanel {
  spec: PlotSpec;
  row: number;
  col: number;
  tag: string;
}

const COLS = 3;

/** Pull the 3-D grid dims out of `result.config.dom` (falls back to 12×12×12). */
function domDims(result: EmCouplingResult): { nx: number; ny: number; nz: number } {
  const dom = (result.config?.dom ?? {}) as Record<string, unknown>;
  const n = (k: string, d: number) =>
    typeof dom[k] === 'number' && (dom[k] as number) > 0 ? (dom[k] as number) : d;
  return { nx: n('nx', 12), ny: n('ny', 12), nz: n('nz', 12) };
}

/** Slice the flat z-major 3-D field at a fixed iz plane → rows×cols 2-D grid. */
function sliceField(values: number[], nx: number, ny: number, iz: number): { values: number[]; rows: number; cols: number } {
  const out: number[] = [];
  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      out.push(values[fieldIndex(ix, iy, iz, nx, ny)] ?? 0);
    }
  }
  return { values: out, rows: ny, cols: nx };
}

/**
 * Build the full panel layout for one coupling result. Rows are filled
 * row-major with fixed panel spacing; tag letters a, b, c, … label each.
 */
export function couplingFigurePanels(result: EmCouplingResult): FigurePanel[] {
  const panels: FigurePanel[] = [];
  const w = result.windows ?? [];
  const { nx, ny, nz } = domDims(result);
  const f3d = result.final_state_3d;
  const raw = Array.isArray(f3d?.field) ? (f3d!.field as number[]) : [];

  // --- panel a: mid-plane field slice (surface) ----------------------------
  if (raw.length >= nx * ny * nz) {
    const zn = Math.floor((nz - 1) / 2);
    const slice = sliceField(raw, nx, ny, zn);
    panels.push({
      row: 0,
      col: 0,
      tag: 'a',
      spec: {
        width: 336,
        height: 252,
        title: '3-D field · mid-z slice',
        xLabel: 'x',
        yLabel: 'y',
        ticks: 4,
        series: [
          {
            name: 'heat content',
            kind: 'field',
            color: '#3CA0FF',
            field: { values: slice.values, rows: slice.rows, cols: slice.cols, surface: true },
          },
        ],
      },
    });
  }

  // --- panel b: 1-D outlet mass flow ---------------------------------------
  if (w.length > 0) {
    panels.push({
      row: 0,
      col: panels.length % COLS,
      tag: String.fromCharCode(97 + panels.length),
      spec: {
        width: 336,
        height: 252,
        title: '1-D outlet mass flow',
        xLabel: 't [ms]',
        yLabel: 'ṁ [kg/s]',
        ticks: 5,
        grid: true,
        series: [
          {
            name: 'ṁ_out',
            kind: 'line',
            color: '#E6A23C',
            points: w.map((row) => ({ x: row.t * 1e3, y: row.md_1d })),
          },
        ],
      },
    });
  }

  // --- panel c: 3-D back pressure (reverse coupling) ------------------------
  if (w.length > 0) {
    panels.push({
      row: 0,
      col: panels.length % COLS,
      tag: String.fromCharCode(97 + panels.length),
      spec: {
        width: 336,
        height: 252,
        title: '3-D outlet back pressure',
        xLabel: 't [ms]',
        yLabel: 'p [kPa]',
        ticks: 5,
        grid: true,
        series: [
          {
            name: 'p_back',
            kind: 'line',
            color: '#4E79A7',
            points: w.map((row) => ({ x: row.t * 1e3, y: row.p_back_3d / 1e3 })),
          },
        ],
      },
    });
  }

  // --- panel d: valve opening (ms control) ----------------------------------
  if (w.length > 0) {
    panels.push({
      row: 1,
      col: 0,
      tag: String.fromCharCode(97 + panels.length),
      spec: {
        width: 336,
        height: 252,
        title: 'Valve opening · ms control',
        xLabel: 't [ms]',
        yLabel: 'opening',
        ticks: 5,
        grid: true,
        series: [
          {
            name: 'valve',
            kind: 'line',
            color: '#B07AA1',
            points: w.map((row) => ({ x: row.t * 1e3, y: row.valve_opening })),
          },
        ],
      },
    });
  }

  return panels;
}