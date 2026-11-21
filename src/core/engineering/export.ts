// ==========================================================================
// Ergalics Studio — engineering export + result plotting (pure TS)
//
// Everything here is DOM-free so it can be unit-tested and reused by the
// report builder, the workspace archiver and the chart surface:
//   • CSV exports      — nodes, elements, fields, metrics, design scans;
//   • SVG mesh figure  — vector contour of the mesh/field for papers;
//   • PlotSpec builders — field histograms and design-scan responses, fed to
//     the shared `renderSVG` renderer used by the research suite.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot/types';
import { engineeringFingerprint, toStudySnapshot } from './study';
import { ensureCase } from './cases';
import type {
  EngineeringField,
  EngineeringGeometry,
  EngineeringMesh,
  EngineeringSolveResult,
  EngineeringStudy,
} from './types';
import type { EngineeringScanRow } from './projectState';

// --------------------------------------------------------------------------
// CSV
// --------------------------------------------------------------------------

/** RFC-4180-ish cell quoting; numbers stay unquoted for spreadsheet readers. */
function cell(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCSV(rows: unknown[][]): string {
  return `${rows.map((row) => row.map(cell).join(',')).join('\n')}\n`;
}

export function nodesToCSV(mesh: EngineeringMesh): string {
  const rows: unknown[][] = [['nodeId', 'x', 'y', 'z']];
  for (const node of mesh.nodes) rows.push([node.id, node.x, node.y, node.z]);
  return rowsToCSV(rows);
}

export function elementsToCSV(mesh: EngineeringMesh): string {
  const rows: unknown[][] = [['elementId', 'type', 'group', 'nodes']];
  for (const element of mesh.elements) {
    rows.push([element.id, element.type, element.group ?? '', element.nodes.join(' ')]);
  }
  return rowsToCSV(rows);
}

/** One row per field entry; multi-component fields become c0…cN columns. */
export function fieldToCSV(study: EngineeringStudy, field: EngineeringField): string {
  const n = field.components;
  const header = ['index'];
  if (field.location === 'node') header.push('nodeId', 'x', 'y', 'z');
  else if (field.location === 'element') header.push('elementId', 'type', 'group');
  for (let c = 0; c < n; c += 1) header.push(`c${c}`);
  const rows: unknown[][] = [header];
  const count = Math.floor(field.values.length / Math.max(1, n));
  for (let i = 0; i < count; i += 1) {
    const row: unknown[] = [i];
    if (field.location === 'node') {
      const node = study.mesh.nodes[i];
      row.push(node?.id ?? i + 1, node?.x ?? '', node?.y ?? '', node?.z ?? '');
    } else if (field.location === 'element') {
      const element = study.mesh.elements[i];
      row.push(element?.id ?? i + 1, element?.type ?? '', element?.group ?? '');
    }
    for (let c = 0; c < n; c += 1) row.push(field.values[i * n + c] ?? '');
    rows.push(row);
  }
  return rowsToCSV(rows);
}

export function metricsToCSV(metrics: Record<string, number>): string {
  const rows: unknown[][] = [['metric', 'value']];
  for (const [key, value] of Object.entries(metrics)) rows.push([key, value]);
  return rowsToCSV(rows);
}

export function resultToCSV(result: EngineeringSolveResult): string {
  return metricsToCSV(result.metrics);
}

/** Design scan: union of parameter and metric columns, one row per point. */
export function scanToCSV(scan: readonly EngineeringScanRow[]): string {
  const params = new Set<string>();
  const metrics = new Set<string>();
  for (const row of scan) {
    for (const key of Object.keys(row.params)) params.add(key);
    for (const key of Object.keys(row.metrics)) metrics.add(key);
  }
  const paramKeys = [...params];
  const metricKeys = [...metrics];
  const rows: unknown[][] = [['point', 'name', ...paramKeys, ...metricKeys]];
  for (const row of scan) {
    rows.push([
      row.id,
      row.name,
      ...paramKeys.map((key) => row.params[key] ?? ''),
      ...metricKeys.map((key) => row.metrics[key] ?? ''),
    ]);
  }
  return rowsToCSV(rows);
}

export function geometryToCSV(geometry: EngineeringGeometry): string {
  const rows: unknown[][] = [['entityId', 'kind', 'layer', 'closed', 'points']];
  for (const entity of geometry.entities) {
    rows.push([
      entity.id,
      entity.kind,
      entity.layer ?? '',
      entity.closed ? 'true' : 'false',
      entity.points.map((p) => p.join(' ')).join(';'),
    ]);
  }
  return rowsToCSV(rows);
}

/** Full study document: snapshot + fingerprint, matching study/engineering.json. */
export function studyDocument(study: EngineeringStudy): string {
  return JSON.stringify(
    // Use the snapshot form: raw fields hold Float64Arrays which JSON would
    // serialise as {"0":…} objects, losing every value on reload.
    { study: toStudySnapshot(study), fingerprint: engineeringFingerprint(study), exportedAt: new Date().toISOString() },
    null,
    2,
  );
}

// --------------------------------------------------------------------------
// Mesh figure (SVG)
// --------------------------------------------------------------------------

/** Blue → cyan → yellow → red, matching the on-screen MeshCanvas. */
function fieldColor(t: number, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  return `hsla(${220 - 220 * clamped}, 82%, 55%, ${alpha})`;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function fieldRange(field: EngineeringField | null | undefined): [number, number] {
  if (!field) return [0, 0];
  let min = Infinity;
  let max = -Infinity;
  for (const value of field.values) {
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return Number.isFinite(min) ? [min, max] : [0, 0];
}

function elementFieldValue(
  field: EngineeringField,
  mesh: EngineeringMesh,
  elementIndex: number,
): number {
  if (field.location === 'element') {
    return field.values[elementIndex * field.components] ?? 0;
  }
  const element = mesh.elements[elementIndex];
  if (!element) return 0;
  let total = 0;
  let count = 0;
  for (const node of element.nodes) {
    const value = field.values[node * field.components];
    if (Number.isFinite(value)) {
      total += value!;
      count += 1;
    }
  }
  return count > 0 ? total / count : 0;
}

export interface MeshFigureOptions {
  width?: number;
  height?: number;
  title?: string;
  /** Draw element edges (default true). */
  edges?: boolean;
  /** Maximum elements to draw before striding (default 12000). */
  maxElements?: number;
}

/**
 * Vector contour of the mesh. Uses the same top-down projection as the
 * interactive canvas, so an exported figure matches what the user sees.
 */
export function meshToSVG(
  study: EngineeringStudy,
  field: EngineeringField | null | undefined,
  options: MeshFigureOptions = {},
): string {
  const width = options.width ?? 720;
  const height = options.height ?? 480;
  const pad = 32;
  const [minX, minY, , maxX, maxY] = study.mesh.bounds;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const px = (x: number) => offX + (x - minX) * scale;
  const py = (y: number) => height - offY - (y - minY) * scale;

  const [minValue, maxValue] = fieldRange(field);
  const valueSpan = maxValue - minValue || 1;
  const maxElements = options.maxElements ?? 12000;
  const stride = Math.max(1, Math.ceil(study.mesh.elements.length / maxElements));

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(options.title ?? study.name)}">`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
  );
  if (options.title) {
    parts.push(
      `<text x="${pad}" y="22" font-family="ui-sans-serif, system-ui, sans-serif" font-size="14" font-weight="600" fill="#1f2933">${esc(options.title)}</text>`,
    );
  }

  for (let index = 0; index < study.mesh.elements.length; index += stride) {
    const element = study.mesh.elements[index]!;
    if (element.nodes.length < 2) continue;
    const points = element.nodes
      .map((nodeIndex) => study.mesh.nodes[nodeIndex])
      .filter((node): node is NonNullable<typeof node> => Boolean(node))
      .map((node) => `${px(node.x).toFixed(2)},${py(node.y).toFixed(2)}`)
      .join(' ');
    if (!points) continue;
    if (element.nodes.length >= 3) {
      const value = field ? elementFieldValue(field, study.mesh, index) : 0;
      const t = field ? (value - minValue) / valueSpan : 0;
      parts.push(
        `<polygon points="${points}" fill="${fieldColor(t, 0.55)}" stroke="rgba(30,41,59,0.35)" stroke-width="0.7"/>`,
      );
    } else {
      parts.push(
        `<polyline points="${points}" fill="none" stroke="rgba(59,130,246,0.8)" stroke-width="1"/>`,
      );
    }
  }

  if (field) {
    const [minValueText, maxValueText] = [minValue, maxValue].map((value) =>
      Math.abs(value) >= 1e4 || (value !== 0 && Math.abs(value) < 1e-3)
        ? value.toExponential(3)
        : Number(value.toPrecision(5)).toString(),
    );
    parts.push(
      `<text x="${pad}" y="${height - 10}" font-family="ui-monospace, monospace" font-size="11" fill="#52606d">${esc(field.name)} · ${esc(minValueText!)} … ${esc(maxValueText!)}${
        field.unit ? ` (${esc(field.unit)})` : ''
      }</text>`,
    );
  }
  parts.push('</svg>');
  return parts.join('\n');
}

// --------------------------------------------------------------------------
// PlotSpec builders
// --------------------------------------------------------------------------

/** Scalar samples for a field: component 0, or the vector magnitude. */
export function fieldSamples(field: EngineeringField): number[] {
  const n = Math.max(1, field.components);
  const count = Math.floor(field.values.length / n);
  const out: number[] = [];
  if (n === 1) {
    for (let i = 0; i < count; i += 1) {
      const value = field.values[i];
      if (Number.isFinite(value)) out.push(value!);
    }
    return out;
  }
  for (let i = 0; i < count; i += 1) {
    let sum = 0;
    let ok = true;
    for (let c = 0; c < n; c += 1) {
      const value = field.values[i * n + c];
      if (!Number.isFinite(value)) { ok = false; break; }
      sum += value! * value!;
    }
    if (ok) out.push(Math.sqrt(sum));
  }
  return out;
}

export interface FieldHistogramOptions {
  title?: string;
  xLabel?: string;
  bins?: number;
  color?: string;
}

export function fieldHistogramSpec(
  field: EngineeringField,
  options: FieldHistogramOptions = {},
): PlotSpec {
  const values = fieldSamples(field);
  const n = values.length;
  const color = options.color ?? '#3b82f6';
  const label = options.xLabel ?? (field.components > 1 ? `${field.name} |·|` : field.name);
  if (n === 0) {
    return {
      width: 640,
      height: 360,
      title: options.title,
      xLabel: label,
      yLabel: 'count',
      grid: true,
      series: [],
    };
  }
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const bins = options.bins && options.bins > 0 ? options.bins : Math.max(8, Math.ceil(Math.log2(n)) + 1);
  const span = max - min || 1;
  const step = span / bins;
  const counts = new Array<number>(bins).fill(0);
  for (const value of values) {
    let index = Math.floor((value - min) / step);
    if (index >= bins) index = bins - 1;
    if (index < 0) index = 0;
    counts[index] = (counts[index] ?? 0) + 1;
  }
  const bars = counts.map((count, index) => ({
    x0: min + index * step,
    x1: min + (index + 1) * step,
    y: count,
  }));
  const series: PlotSeries[] = [
    { name: `${field.name} (n=${n})`, kind: 'histogram', color, bars },
  ];
  return {
    width: 640,
    height: 360,
    title: options.title,
    xLabel: label,
    yLabel: 'count',
    grid: true,
    series,
  };
}

export interface ScanPlotOptions {
  title?: string;
  xLabel?: string;
  yLabel?: string;
  color?: string;
}

/**
 * Response plot for a design scan. With a single parameter the x axis is the
 * parameter value; with several, points keep their expansion order and the
 * x axis becomes the design-point index (a categorical-style sweep).
 */
export function scanMetricSpec(
  scan: readonly EngineeringScanRow[],
  metricKey: string,
  options: ScanPlotOptions = {},
): PlotSpec {
  const paramNames = [...new Set(scan.flatMap((row) => Object.keys(row.params)))];
  const xName = paramNames.length === 1 ? paramNames[0]! : '';
  const points = scan
    .map((row, index) => {
      const y = row.metrics[metricKey];
      if (!Number.isFinite(y)) return null;
      const x = xName ? row.params[xName] : index + 1;
      return Number.isFinite(x) ? { x: x as number, y: y as number } : null;
    })
    .filter((point): point is { x: number; y: number } => point !== null);

  const series: PlotSeries[] = [
    {
      name: metricKey,
      kind: points.length > 1 ? 'line' : 'scatter',
      color: options.color ?? '#10b981',
      points,
    },
  ];
  return {
    width: 640,
    height: 360,
    title: options.title,
    xLabel: options.xLabel ?? (xName || 'design point'),
    yLabel: options.yLabel ?? metricKey,
    grid: true,
    series,
  };
}

/** Metric keys worth plotting from a scan (skips counts / errors). */
export function scanMetricKeys(scan: readonly EngineeringScanRow[]): string[] {
  const keys = new Set<string>();
  for (const row of scan) {
    for (const key of Object.keys(row.metrics)) {
      if (key === 'nodeCount' || key === 'elementCount' || key === 'error') continue;
      keys.add(key);
    }
  }
  return [...keys];
}

/** Convenience: the active case's first step (report/export headers). */
export function activeStep(study: EngineeringStudy) {
  return ensureCase(study.cases)[0]?.steps[0] ?? null;
}
