// ==========================================================================
// Ergalics Studio — PlotSpec → SVG string renderer (pure TS)
//
// Emits a self-contained, publication-grade SVG: inset plotting area, crisp
// 1px axes, "nice" ticks with outward-facing tick marks, optional gridlines,
// labelled axes, an optional legend, and a title. No external libraries.
// ==========================================================================

import { formatTick, makeScale, niceTicks, type Scale } from './scale';
import type { FieldData, PlotSpec, PlotSeries } from './types';

const FONT = "'Helvetica Neue', Arial, sans-serif";
const FONT_AXIS = "'Helvetica Neue', Arial, sans-serif";
const FONT_TITLE = "'Helvetica Neue', Arial, sans-serif";
const MARGIN = { top: 36, right: 20, bottom: 48, left: 60 };
const TICK_LEN = 6;
const COL_W = 150; // legend column width budget
/** Reserve space right of the plot area for a field colorbar. */
const COLORBAR_SPACE = 52;
const COLORBAR_W = 12;
const COLORBAR_STEPS = 32;

/**
 * Diverging colormap for scalar fields on white: negative → Okabe-Ito blue,
 * positive → Okabe-Ito vermilion, zero → white (colorblind-safe, print-safe).
 * `t` is the normalized value in [-1, 1]; returns a CSS `rgb(...)` color.
 */
export function fieldColorCss(t: number): string {
  const [r, g, b] = fieldColorRgb(t);
  return `rgb(${r},${g},${b})`;
}

/** RGB triple of the diverging field colormap (see `fieldColorCss`). */
function fieldColorRgb(t: number): [number, number, number] {
  const NEG = [0, 114, 178];
  const POS = [213, 94, 0];
  const WHITE = [255, 255, 255];
  const a = Math.max(-1, Math.min(1, Number.isFinite(t) ? t : 0));
  // u=0 → white (zero), u=1 → full hue (|t| = 1).
  const [to, u] = a < 0 ? [NEG, -a] : [POS, a];
  return WHITE.map((f, i) => Math.round(f + (to[i]! - f) * u)) as [number, number, number];
}

/** mplot3d-style view constants: default elevation/azimuth, orthographic. */
const VIEW_AZ = (-60 * Math.PI) / 180;
const VIEW_EL = (30 * Math.PI) / 180;
const VIEW_COS_AZ = Math.cos(VIEW_AZ);
const VIEW_SIN_AZ = Math.sin(VIEW_AZ);
const VIEW_COS_EL = Math.cos(VIEW_EL);
const VIEW_SIN_EL = Math.sin(VIEW_EL);
const Z_ASPECT = 0.75; // z axis height as a fraction of the x/y span
const PANE_FILL = '#f1f1f6';
const PANE_GRID = '#ffffff';
/** World-space light direction for Lambert shading of the surface (unit). */
const SURFACE_LIGHT = [0.36, -0.48, 0.8] as const;

/**
 * mplot3d-style 3D frame (orthographic, azim=-60°, elev=30°): three shaded
 * background panes with white grid lines, the shaded surface inside the unit
 * box, and dark axis edges with outward tick numbers — mirroring matplotlib's
 * default `plot_surface` look. The whole unit box is projected and fitted
 * into `box`, so the surface can never escape or misalign with the frame.
 */
function surfaceFrame(
  field: FieldData,
  box: { x: number; y: number; w: number; h: number },
  labels?: { x?: string; y?: string; z?: string },
): { base: string[]; quads: string[]; axes: string[] } {
  const { values, rows, cols } = field;
  const [fMin, fMax] = fieldDomain(field);
  const span = fMax - fMin || 1;
  // Height axis uses the *actual* data range so valleys sit on the floor and
  // peaks reach the top (the color domain may be symmetric beyond it).
  let dMin = Infinity;
  let dMax = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < dMin) dMin = v;
    if (v > dMax) dMax = v;
  }
  if (dMin > dMax) {
    dMin = 0;
    dMax = 1;
  }
  const dSpan = dMax - dMin || 1;

  // mplot3d view basis (orthographic, azim=-60°, elev=30°). Returns
  // [screen-right, screen-up, toward-viewer] for a point in the unit box.
  const view = (x: number, y: number, z: number): [number, number, number] => [
    -VIEW_SIN_AZ * x + VIEW_COS_AZ * y,
    -VIEW_COS_AZ * VIEW_SIN_EL * x - VIEW_SIN_AZ * VIEW_SIN_EL * y + VIEW_COS_EL * z,
    VIEW_COS_EL * VIEW_COS_AZ * x + VIEW_COS_EL * VIEW_SIN_AZ * y + VIEW_SIN_EL * z,
  ];
  const at = (c: number, r: number): number =>
    values[Math.min(r, rows - 1) * cols + Math.min(c, cols - 1)] ?? 0;

  // Fit the *whole unit box* (8 corners) into the panel — the surface lives
  // inside the box, so fitting the box guarantees the surface can never
  // escape the axes or drift out of register with the frame.
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const z of [0, Z_ASPECT]) {
    for (const x of [0, 1]) {
      for (const y of [0, 1]) {
        const p = view(x, y, z);
        if (p[0] < uMin) uMin = p[0];
        if (p[0] > uMax) uMax = p[0];
        if (p[1] < vMin) vMin = p[1];
        if (p[1] > vMax) vMax = p[1];
      }
    }
  }
  const s = Math.min((box.w * 0.98) / (uMax - uMin || 1), (box.h * 0.98) / (vMax - vMin || 1));
  const ox = box.x + box.w / 2 - ((uMin + uMax) / 2) * s;
  const oy = box.y + box.h / 2 + ((vMin + vMax) / 2) * s;
  const S = (x: number, y: number, z: number): [number, number] => {
    const p = view(x, y, z);
    return [ox + p[0] * s, oy - p[1] * s];
  };
  // Data point → screen (world cube: x/y ∈ [0,1], z ∈ [0, Z_ASPECT]).
  const P = (c: number, r: number, v: number): [number, number] => S(
    c / Math.max(1, cols - 1),
    r / Math.max(1, rows - 1),
    ((v - dMin) / dSpan) * Z_ASPECT,
  );
  const seg = (
    a: [number, number],
    b: [number, number],
    stroke: string,
    w: number,
  ): string =>
    `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${stroke}" stroke-width="${w}"/>`;
  const poly = (pts: Array<[number, number]>, fill: string): string =>
    `<polygon points="${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}" fill="${fill}"/>`;

  // --- Three background panes (floor + two back walls) with white grids. ---
  const base: string[] = [];
  base.push(poly([S(0, 0, 0), S(1, 0, 0), S(1, 1, 0), S(0, 1, 0)], PANE_FILL));
  base.push(poly([S(0, 0, 0), S(0, 1, 0), S(0, 1, Z_ASPECT), S(0, 0, Z_ASPECT)], PANE_FILL));
  base.push(poly([S(1, 1, 0), S(0, 1, 0), S(0, 1, Z_ASPECT), S(1, 1, Z_ASPECT)], PANE_FILL));
  // Grid lines align with the tick positions on each axis (white on gray).
  const clip = (t: number, lo: number, hi: number): boolean => t >= lo - 1e-9 && t <= hi + 1e-9;
  const cxs = Math.max(1, cols - 1);
  const rys = Math.max(1, rows - 1);
  const xT = niceTicks(0, cxs, 5).ticks.filter((t) => clip(t, 0, cxs));
  const yT = niceTicks(0, rys, 5).ticks.filter((t) => clip(t, 0, rys));
  const zT = niceTicks(dMin, dMax, 5).ticks.filter((t) => clip(t, dMin, dMax));
  for (const t of xT) {
    base.push(seg(S(t / cxs, 0, 0), S(t / cxs, 1, 0), PANE_GRID, 1));
    base.push(seg(S(t / cxs, 1, 0), S(t / cxs, 1, Z_ASPECT), PANE_GRID, 1));
  }
  for (const t of yT) {
    base.push(seg(S(0, t / rys, 0), S(1, t / rys, 0), PANE_GRID, 1));
    base.push(seg(S(0, t / rys, 0), S(0, t / rys, Z_ASPECT), PANE_GRID, 1));
  }
  for (const t of zT) {
    const z = ((t - dMin) / dSpan) * Z_ASPECT;
    base.push(seg(S(0, 0, z), S(0, 1, z), PANE_GRID, 1));
    base.push(seg(S(0, 1, z), S(1, 1, z), PANE_GRID, 1));
  }
  // Back box edges (left/back faces) — behind the surface, occluded by it.
  base.push(seg(S(1, 1, 0), S(0, 1, 0), '#b9b9c2', 0.8));
  base.push(seg(S(0, 1, 0), S(0, 0, 0), '#b9b9c2', 0.8));
  base.push(seg(S(1, 1, Z_ASPECT), S(0, 1, Z_ASPECT), '#c9c9d2', 0.7));
  base.push(seg(S(0, 1, Z_ASPECT), S(0, 0, Z_ASPECT), '#c9c9d2', 0.7));
  base.push(seg(S(0, 1, 0), S(0, 1, Z_ASPECT), '#b9b9c2', 0.8));

  // --- Shaded quads (painter's algorithm, back to front). ---
  interface Quad { depth: number; path: string; fill: string; }
  const quads: Quad[] = [];
  const stepWx = 1 / cxs;
  const stepWy = 1 / rys;
  for (let r = 0; r < rows - 1; r += 1) {
    for (let c = 0; c < cols - 1; c += 1) {
      const v00 = at(c, r);
      const v10 = at(c + 1, r);
      const v01 = at(c, r + 1);
      const v11 = at(c + 1, r + 1);
      const p00 = P(c, r, v00);
      const p10 = P(c + 1, r, v10);
      const p11 = P(c + 1, r + 1, v11);
      const p01 = P(c, r + 1, v01);
      // Lambert shading from the world-space quad normal (two-sided, so
      // backfacing slopes darken symmetrically instead of going black).
      const az = ((v10 - v00) / dSpan) * Z_ASPECT;
      const bz = ((v01 - v00) / dSpan) * Z_ASPECT;
      const nxv = -az * stepWy;
      const nyv = -bz * stepWx;
      const nzv = stepWx * stepWy;
      const nl = Math.hypot(nxv, nyv, nzv) || 1;
      const lambert = Math.abs(
        (nxv / nl) * SURFACE_LIGHT[0] + (nyv / nl) * SURFACE_LIGHT[1] + (nzv / nl) * SURFACE_LIGHT[2],
      );
      const shade = 0.58 + 0.42 * lambert;
      const mean = (v00 + v10 + v01 + v11) / 4;
      const [cr, cg, cb] = fieldColorRgb(((mean - fMin) / span) * 2 - 1);
      quads.push({
        depth:
          VIEW_COS_EL * VIEW_COS_AZ * ((c + 0.5) * stepWx) +
          VIEW_COS_EL * VIEW_SIN_AZ * ((r + 0.5) * stepWy) +
          VIEW_SIN_EL * ((((v00 + v11) / 2 - dMin) / dSpan) * Z_ASPECT),
        path: `M${p00[0].toFixed(1)} ${p00[1].toFixed(1)}L${p10[0].toFixed(1)} ${p10[1].toFixed(1)}L${p11[0].toFixed(1)} ${p11[1].toFixed(1)}L${p01[0].toFixed(1)} ${p01[1].toFixed(1)}Z`,
        fill: `rgb(${Math.round(cr * shade)},${Math.round(cg * shade)},${Math.round(cb * shade)})`,
      });
    }
  }
  quads.sort((a, b) => a.depth - b.depth); // far (small viewer depth) first

  // --- Ticks + labels on top (they sit outside the box, never covered). ---
  const axes: string[] = [];

  // Front + right face edges of the box, drawn *over* the surface so the
  // near side of the frame always floats on top (matplotlib-like).
  const Z = Z_ASPECT;
  axes.push(seg(S(0, 0, 0), S(1, 0, 0), '#222', 1.2)); // x axis (front-bottom)
  axes.push(seg(S(1, 0, 0), S(1, 1, 0), '#222', 1.2)); // y axis (right-bottom)
  axes.push(seg(S(1, 1, 0), S(1, 1, Z), '#222', 1.2)); // z axis (right vertical)
  axes.push(seg(S(0, 0, 0), S(0, 0, Z), '#b9b9c2', 0.8)); // front-left vertical
  axes.push(seg(S(1, 0, 0), S(1, 0, Z), '#b9b9c2', 0.8)); // front-right vertical
  axes.push(seg(S(0, 0, Z), S(1, 0, Z), '#c9c9d2', 0.7)); // front-top edge
  axes.push(seg(S(1, 0, Z), S(1, 1, Z), '#c9c9d2', 0.7)); // right-top edge

  // Outward tick directions in screen space, derived from the view basis.
  const dirOf = (x: number, y: number, z: number): [number, number] => {
    const p = view(x, y, z);
    const n = Math.hypot(p[0], p[1]) || 1;
    return [p[0] / n, -p[1] / n];
  };
  const xDir = dirOf(0, -1, 0);
  const yDir = dirOf(1, 0, 0);
  const zDir = dirOf(1, 1, 0);
  const tick = (p: [number, number], dir: [number, number], text: string) => {
    axes.push(seg([p[0], p[1]], [p[0] + dir[0] * 4, p[1] + dir[1] * 4], '#222', 1));
    axes.push(
      `<text x="${(p[0] + dir[0] * 11).toFixed(1)}" y="${(p[1] + dir[1] * 11 + 3).toFixed(1)}" font-family="${FONT_AXIS}" font-size="10" text-anchor="middle" fill="#222">${escapeText(text)}</text>`,
    );
  };
  for (const t of xT) tick(S(t / cxs, 0, 0), xDir, formatTick(t));
  for (const t of yT) tick(S(1, t / rys, 0), yDir, formatTick(t));
  for (const t of zT) tick(S(1, 1, ((t - dMin) / dSpan) * Z_ASPECT), zDir, formatTick(t));
  // Axis labels, offset further out along the same outward directions.
  const axisLabel = (p: [number, number], dir: [number, number], text: string) => {
    axes.push(
      `<text x="${(p[0] + dir[0] * 28).toFixed(1)}" y="${(p[1] + dir[1] * 28 + 4).toFixed(1)}" font-family="${FONT_AXIS}" font-size="12" font-style="italic" text-anchor="middle" fill="#000">${escapeText(text)}</text>`,
    );
  };
  axisLabel(S(0.5, 0, 0), xDir, labels?.x || 'x');
  axisLabel(S(1, 0.5, 0), yDir, labels?.y || 'y');
  if (labels?.z) axisLabel(S(1, 1, Z_ASPECT / 2), zDir, labels.z);

  return {
    base,
    quads: quads.map((q) => `<path d="${q.path}" fill="${q.fill}" stroke="${q.fill}" stroke-width="0.6"/>`),
    axes,
  };
}

/** Symmetric diverging domain for a field: [-m, m] when it straddles zero. */
function fieldDomain(field: FieldData): [number, number] {
  if (field.domain) return field.domain;
  let min = Infinity;
  let max = -Infinity;
  for (const v of field.values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min > max) return [-1, 1];
  if (min < 0 && max > 0) {
    const m = Math.max(Math.abs(min), Math.abs(max));
    return [-m, m];
  }
  return [min, max];
}

/** Escape text content. `#` is *not* special here and must survive verbatim. */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escape a value destined for a double-quoted attribute. Prevents breaking out
 * of the attribute; `#` is deliberately preserved so hex colours still work.
 */
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

function autoDomain(series: PlotSeries[], axis: 'x' | 'y'): [number, number] | undefined {
  const vals: number[] = [];
  for (const s of series) {
    if (s.kind === 'bar' || s.kind === 'histogram') {
      if (axis === 'x') {
        for (const b of s.bars ?? []) {
          vals.push(b.x0, b.x1);
        }
      } else {
        for (const b of s.bars ?? []) vals.push(b.y);
      }
    } else {
      for (const p of s.points ?? []) vals.push(axis === 'x' ? p.x : p.y);
    }
  }
  // Reduce rather than `Math.min(...finite)`: spreading a large sample blows the
  // call stack (RangeError at roughly 125k elements) and crashed big plots.
  let min = Infinity;
  let max = -Infinity;
  for (const v of vals) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min > max) return undefined;
  return [min, max];
}

/** Render a PlotSpec to a standalone SVG document string. */
export function renderSVG(spec: PlotSpec): string {
  const width = spec.width || 640;
  const height = spec.height || 420;
  // A field panel narrows the plot area to make room for its colorbar.
  const firstField = spec.series.find(
    (s): s is PlotSeries & { field: FieldData } => s.kind === 'field' && !!s.field,
  );
  const plotW = width - MARGIN.left - MARGIN.right - (firstField ? COLORBAR_SPACE : 0);
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const xScaleKind = spec.xScale ?? 'linear';
  const yScaleKind = spec.yScale ?? 'linear';

  // A field grid spans exactly [0, cols] × [0, rows] unless overridden.
  const xDomain =
    spec.xDomain ?? (firstField ? [0, firstField.field.cols] : autoDomain(spec.series, 'x')) ?? [0, 1];
  const yDomain =
    spec.yDomain ?? (firstField ? [0, firstField.field.rows] : autoDomain(spec.series, 'y')) ?? [0, 1];
  const xTicksInfo = niceTicks(xDomain[0], xDomain[1], spec.ticks ?? 5);
  const yTicksInfo = niceTicks(yDomain[0], yDomain[1], spec.ticks ?? 5);
  // A field grid maps 1:1 onto its data domain (niceTicks would pad it and
  // leave the heatmap floating inside the axes).
  const xDom: [number, number] = firstField
    ? [xDomain[0], xDomain[1]]
    : xScaleKind === 'log'
      ? [Math.max(1e-12, xTicksInfo.min), Math.max(1e-11, xTicksInfo.max)]
      : [xTicksInfo.min, xTicksInfo.max];
  const yDom: [number, number] = firstField
    ? [yDomain[0], yDomain[1]]
    : yScaleKind === 'log'
      ? [Math.max(1e-12, yTicksInfo.min), Math.max(1e-11, yTicksInfo.max)]
      : [yTicksInfo.min, yTicksInfo.max];

  const x: Scale = makeScale(xScaleKind, xDom, [MARGIN.left, MARGIN.left + plotW]);
  const y: Scale = makeScale(yScaleKind, yDom, [MARGIN.top + plotH, MARGIN.top]);

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}" font-family="${FONT}">`,
  );

  // Plotting-area background.
  parts.push(
    `<rect x="${MARGIN.left}" y="${MARGIN.top}" width="${plotW}" height="${plotH}" ` +
      `fill="#ffffff" stroke="none"/>`,
  );

  // Gridlines (behind everything).
  if (spec.grid) {
    for (const t of yTicksInfo.ticks) {
      const py = y.toPixel(t);
      if (py < MARGIN.top - 0.5 || py > MARGIN.top + plotH + 0.5) continue;
      parts.push(
        `<line x1="${MARGIN.left}" y1="${py.toFixed(1)}" x2="${MARGIN.left + plotW}" y2="${py.toFixed(1)}" stroke="#e6e6e6" stroke-width="1"/>`,
      );
    }
    for (const t of xTicksInfo.ticks) {
      const px = x.toPixel(t);
      if (px < MARGIN.left - 0.5 || px > MARGIN.left + plotW + 0.5) continue;
      parts.push(
        `<line x1="${px.toFixed(1)}" y1="${MARGIN.top}" x2="${px.toFixed(1)}" y2="${MARGIN.top + plotH}" stroke="#e6e6e6" stroke-width="1"/>`,
      );
    }
  }

  // Series.
  for (const s of spec.series) {
    if (s.kind === 'field' && s.field) {
      const { rows, cols } = s.field;
      const cw = plotW / Math.max(1, cols);
      const ch = plotH / Math.max(1, rows);
      if (s.field.surface) {
        // Shaded 3D landscape in a real 3D box: floor grid behind, surface,
        // then frame/z-axis/ticks on top.
        const fr = surfaceFrame(
          s.field,
          { x: MARGIN.left, y: MARGIN.top, w: plotW, h: plotH },
          { x: spec.xLabel, y: spec.yLabel },
        );
        parts.push(...fr.base, ...fr.quads, ...fr.axes);
      } else {
        const { values } = s.field;
        const [fMin, fMax] = fieldDomain(s.field);
        const span = fMax - fMin || 1;
        for (let r = 0; r < rows; r += 1) {
          for (let c = 0; c < cols; c += 1) {
            const v = values[r * cols + c];
            if (v === undefined) continue;
            // Row 0 is the top of the grid (image convention).
            const px = MARGIN.left + c * cw;
            const py = MARGIN.top + r * ch;
            parts.push(
              `<rect x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${cw.toFixed(2)}" height="${ch.toFixed(2)}" ` +
                `fill="${fieldColorCss(((v - fMin) / span) * 2 - 1)}"/>`,
            );
          }
        }
      }
    } else if (s.kind === 'bar' || s.kind === 'histogram') {
      for (const b of s.bars ?? []) {
        const x0 = x.toPixel(b.x0);
        const x1 = x.toPixel(b.x1);
        const yTop = y.toPixel(b.y);
        const w = Math.max(0.5, Math.abs(x1 - x0) - 1);
        const h = Math.max(0, MARGIN.top + plotH - yTop);
        parts.push(
          `<rect x="${(Math.min(x0, x1) + 0.5).toFixed(1)}" y="${yTop.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${escapeAttr(s.color)}"/>`,
        );
      }
    } else if (s.kind === 'line') {
      const pts = (s.points ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (pts.length > 0) {
        const d = pts
          .map((p, i) => `${i === 0 ? 'M' : 'L'}${x.toPixel(p.x).toFixed(1)} ${y.toPixel(p.y).toFixed(1)}`)
          .join(' ');
        const dash = s.dash && s.dash.length ? ` stroke-dasharray="${s.dash.join(',')}"` : '';
        parts.push(
          `<path d="${d}" fill="none" stroke="${escapeAttr(s.color)}" stroke-width="1.6"${dash} stroke-linejoin="round" stroke-linecap="round"/>`,
        );
      }
    } else if (s.kind === 'scatter') {
      for (const p of s.points ?? []) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        parts.push(
          `<circle cx="${x.toPixel(p.x).toFixed(1)}" cy="${y.toPixel(p.y).toFixed(1)}" r="3.2" fill="${escapeAttr(s.color)}" fill-opacity="0.75" stroke="none"/>`,
        );
      }
    }
  }

  // Axes (drawn on top so they are never covered by data). Surface panels
  // draw their own 3D box instead of the flat 2D spines.
  const isSurface = firstField?.field.surface === true;
  if (!isSurface) {
    parts.push(
      `<line x1="${MARGIN.left}" y1="${MARGIN.top}" x2="${MARGIN.left}" y2="${MARGIN.top + plotH}" stroke="#222" stroke-width="1"/>`,
    );
    parts.push(
      `<line x1="${MARGIN.left}" y1="${MARGIN.top + plotH}" x2="${MARGIN.left + plotW}" y2="${MARGIN.top + plotH}" stroke="#222" stroke-width="1"/>`,
    );
  }

  // X ticks + labels (2D panels only — surface panels tick the 3D floor).
  if (!isSurface) {
  if (spec.xTicksOverride && spec.xTicksOverride.length > 0) {
    for (const t of spec.xTicksOverride) {
      const px = x.toPixel(t.pos);
      parts.push(
        `<line x1="${px.toFixed(1)}" y1="${MARGIN.top + plotH}" x2="${px.toFixed(1)}" y2="${(MARGIN.top + plotH + TICK_LEN).toFixed(1)}" stroke="#222" stroke-width="1"/>`,
      );
      parts.push(
        `<text x="${px.toFixed(1)}" y="${MARGIN.top + plotH + TICK_LEN + 16}" font-size="13" text-anchor="middle" fill="#222">${escapeText(t.label)}</text>`,
      );
    }
  } else {
    for (const t of xTicksInfo.ticks) {
      const px = x.toPixel(t);
      if (px < MARGIN.left - 0.5 || px > MARGIN.left + plotW + 0.5) continue;
      parts.push(
        `<line x1="${px.toFixed(1)}" y1="${MARGIN.top + plotH}" x2="${px.toFixed(1)}" y2="${(MARGIN.top + plotH + TICK_LEN).toFixed(1)}" stroke="#222" stroke-width="1"/>`,
      );
      parts.push(
        `<text x="${px.toFixed(1)}" y="${MARGIN.top + plotH + TICK_LEN + 16}" font-size="13" text-anchor="middle" fill="#222">${escapeText(formatTick(t))}</text>`,
      );
    }
  }
  // Y ticks + labels.
  for (const t of yTicksInfo.ticks) {
    const py = y.toPixel(t);
    if (py < MARGIN.top - 0.5 || py > MARGIN.top + plotH + 0.5) continue;
    parts.push(
      `<line x1="${MARGIN.left}" y1="${py.toFixed(1)}" x2="${(MARGIN.left - TICK_LEN).toFixed(1)}" y2="${py.toFixed(1)}" stroke="#222" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${(MARGIN.left - TICK_LEN - 6).toFixed(1)}" y="${(py + 4).toFixed(1)}" font-size="13" text-anchor="end" fill="#222">${escapeText(formatTick(t))}</text>`,
    );
  }

  // Axis labels.
  if (spec.xLabel) {
    parts.push(
      `<text x="${(MARGIN.left + plotW / 2).toFixed(1)}" y="${(height - 10).toFixed(1)}" font-family="${FONT_AXIS}" font-size="14" text-anchor="middle" fill="#000">${escapeText(spec.xLabel)}</text>`,
    );
  }
  if (spec.yLabel) {
    parts.push(
      `<text transform="translate(${16},${(MARGIN.top + plotH / 2).toFixed(1)}) rotate(-90)" font-family="${FONT_AXIS}" font-size="14" text-anchor="middle" fill="#000">${escapeText(spec.yLabel)}</text>`,
    );
  }
  } // end !isSurface (2D axes)

  // Field colorbar: a discrete diverging strip right of the plot area.
  if (firstField) {
    const [fMin, fMax] = fieldDomain(firstField.field);
    const cbX = MARGIN.left + plotW + 14;
    const stepH = plotH / COLORBAR_STEPS;
    for (let i = 0; i < COLORBAR_STEPS; i += 1) {
      // Top = fMax, bottom = fMin.
      const t = 1 - (2 * (i + 0.5)) / COLORBAR_STEPS;
      parts.push(
        `<rect x="${cbX}" y="${(MARGIN.top + i * stepH).toFixed(1)}" width="${COLORBAR_W}" ` +
          `height="${(stepH + 0.5).toFixed(1)}" fill="${fieldColorCss(t)}"/>`,
      );
    }
    parts.push(
      `<rect x="${cbX}" y="${MARGIN.top}" width="${COLORBAR_W}" height="${plotH}" fill="none" stroke="#222" stroke-width="1"/>`,
    );
    const lbl = (v: number, py: number) => {
      parts.push(
        `<text x="${cbX + COLORBAR_W + 4}" y="${(py + 4).toFixed(1)}" font-size="11" fill="#222">${escapeText(formatTick(v))}</text>`,
      );
    };
    lbl(fMax, MARGIN.top);
    lbl(fMin, MARGIN.top + plotH);
    if (fMin < 0 && fMax > 0) {
      lbl(0, MARGIN.top + plotH * (fMax / (fMax - fMin)));
    }
  }

  // Title.
  if (spec.title) {
    parts.push(
      `<text x="${(width / 2).toFixed(1)}" y="22" font-family="${FONT_TITLE}" font-size="16" text-anchor="middle" fill="#000">${escapeText(spec.title)}</text>`,
    );
  }

  // Legend.
  const showLegend =
    spec.legend ?? spec.series.length > 1;
  if (showLegend && spec.series.length > 0) {
    const legendX = MARGIN.left + plotW + 12;
    const itemH = 20;
    spec.series.forEach((s, i) => {
      const ly = MARGIN.top + i * itemH + 4;
      if (s.kind === 'line') {
        parts.push(
          `<line x1="${legendX}" y1="${ly}" x2="${legendX + 18}" y2="${ly}" stroke="${escapeAttr(s.color)}" stroke-width="2"/>`,
        );
      } else {
        parts.push(`<rect x="${legendX}" y="${ly - 6}" width="14" height="12" fill="${escapeAttr(s.color)}"/>`);
      }
      parts.push(
        `<text x="${legendX + 24}" y="${ly + 4}" font-size="12" fill="#222">${escapeText(s.name)}</text>`,
      );
    });
    void COL_W;
  }

  parts.push('</svg>');
  return parts.join('');
}
