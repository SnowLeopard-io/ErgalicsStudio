// ==========================================================================
// EM Eigensolver plugin — canvas rendering
//
// Three panels on the host canvas2d surface:
//   * spectrum scatter (sorted eigenvalues, sigma marker)
//   * residual bars vs the tolerance line (log scale)
//   * outer convergence trace (max residual per restart cycle, log scale)
//
// Geometry helpers are pure and exported for unit tests.
// ==========================================================================

import type { EmProgressInfo, EmResultPayload } from './types';

export interface SpectrumLayout {
  min: number;
  max: number;
}

/** Value domain with 8% padding; NaN-safe, degenerate ranges widened. */
export function spectrumDomain(values: number[]): SpectrumLayout {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: -1, max: 1 };
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.1, 0.5);
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

/** Map a value to a pixel x within [x0, x1]. */
export function mapToX(value: number, domain: SpectrumLayout, x0: number, x1: number): number {
  const t = (value - domain.min) / (domain.max - domain.min || 1);
  return x0 + t * (x1 - x0);
}

function font(zh: boolean, size = 10): string {
  return `${size}px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
}

function short(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  if (a >= 0.001) return v.toFixed(4);
  return v.toExponential(1);
}

const AXIS = 'rgba(148, 163, 184, 0.5)';
const TEXT = 'rgba(148, 163, 184, 0.9)';
const ACCENT = '#2dd4bf';
const WARN = '#fbbf24';

export interface DrawInput {
  result: EmResultPayload | null;
  history: EmProgressInfo[];
  logs: string[];
  busy: boolean;
  hasFile: boolean;
  sigma: number | null;
  zh: boolean;
}

/** Latest scalar residual from any kernel's progress event. */
export function maxRelOf(info: EmProgressInfo): number | null {
  if (info.residuals && info.residuals.length) return Math.max(...info.residuals);
  if (info.rel_residuals && info.rel_residuals.length) return Math.max(...info.rel_residuals);
  return typeof info.rel === 'number' ? info.rel : null;
}

/** ~8 evenly spaced indices (0-based) for an x axis of n points. */
export function tickIndices(n: number, target = 8): number[] {
  if (n <= 0) return [];
  if (n <= target) return Array.from({ length: n }, (_, i) => i);
  const step = (n - 1) / (target - 1);
  const idx = new Set<number>();
  for (let k = 0; k < target; k += 1) idx.add(Math.round(k * step));
  idx.add(n - 1);
  return [...idx].sort((a, b) => a - b);
}

/** One-line progress summary (cycle/iter, matvecs, latest residual). */
export function progressLine(info: EmProgressInfo | undefined, zh: boolean): string {
  if (!info) {
    return zh ? '等待内核第一轮进度…' : 'waiting for first kernel cycle…';
  }
  const stage = info.cycle !== undefined ? `cycle ${info.cycle}` : `iter ${info.iter ?? '?'}`;
  const rel = maxRelOf(info);
  const relStr = rel !== null ? `rel ${rel.toExponential(2)}` : '';
  const extra = info.locked !== undefined ? `locked ${info.locked}` : '';
  return [stage, relStr, extra, `mv ${info.matvecs ?? '?'}`].filter(Boolean).join(' | ');
}

/** Draw the full panel set. Returns false when there is nothing to draw. */
export function drawPanels(canvas: HTMLCanvasElement, input: DrawInput): boolean {
  canvas.width = canvas.clientWidth || 640;
  canvas.height = canvas.clientHeight || 400;
  const g = canvas.getContext('2d');
  if (!g) return false;
  const { width: w, height: h } = canvas;
  g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
  g.fillRect(0, 0, w, h);

  const { result, history, logs, busy, hasFile, sigma, zh } = input;
  if (!result && !busy && !hasFile && history.length === 0) {
    drawEmpty(g, w, h, zh);
    return false;
  }

  const headerH = 30;
  drawHeader(g, w, result, busy, zh);

  if (result) {
    const topH = Math.round((h - headerH) * 0.55);
    drawSpectrum(g, 0, headerH, w, topH, result, sigma, zh);
    const botY = headerH + topH;
    const botH = h - headerH - topH;
    drawResiduals(g, 0, botY, Math.round(w * 0.45), botH, result, zh);
    drawConvergence(g, Math.round(w * 0.45), botY, Math.round(w * 0.55), botH, history, zh);
  } else {
    drawProgress(g, 0, headerH, w, h - headerH, history, logs, busy, zh);
  }
  return true;
}

/** Busy (no result yet): live progress line + kernel log tail. */
function drawProgress(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  history: EmProgressInfo[],
  logs: string[],
  busy: boolean,
  zh: boolean,
): void {
  const x0 = x + 14;
  g.textAlign = 'left';

  // live progress summary
  const last = history[history.length - 1];
  g.font = font(zh, 13);
  g.fillStyle = ACCENT;
  g.fillText(busy ? progressLine(last, zh) : (zh ? '空闲' : 'idle'), x0, y + 34);
  if (history.length > 0) {
    g.fillStyle = TEXT;
    g.font = font(zh, 11);
    g.fillText(`${history.length} ${zh ? '条进度事件' : 'progress events'}`, x0, y + 54);
  }

  // mini convergence sparkline of recent events
  const rels = history.map(maxRelOf).filter((v): v is number => v !== null);
  if (rels.length >= 2) {
    const sx0 = x0 + 8;
    const sx1 = x + w - 20;
    const sy0 = y + 76;
    const sy1 = y + Math.min(h * 0.35, 160);
    const hi = Math.max(...rels.map(logScale)) + 0.2;
    const lo = Math.min(...rels.map(logScale)) - 0.2;

    // minimal axes: L frame + first/last value labels + cycle ticks
    g.strokeStyle = AXIS;
    g.beginPath();
    g.moveTo(sx0, sy0 - 4);
    g.lineTo(sx0, sy1);
    g.lineTo(sx1, sy1);
    g.stroke();
    g.fillStyle = TEXT;
    g.font = font(zh);
    g.textAlign = 'right';
    g.fillText(short(Math.pow(10, hi)), sx0 - 3, sy0 + 3);
    g.fillText(short(Math.pow(10, lo)), sx0 - 3, sy1 + 3);
    g.textAlign = 'center';
    for (const i of tickIndices(rels.length)) {
      const px = sx0 + ((i / Math.max(rels.length - 1, 1)) * (sx1 - sx0));
      g.fillText(String(i + 1), px, sy1 + 12);
    }

    g.strokeStyle = WARN;
    g.lineWidth = 1.5;
    g.beginPath();
    rels.forEach((v, i) => {
      const px = sx0 + ((i / (rels.length - 1)) * (sx1 - sx0));
      const t = (logScale(v) - lo) / (hi - lo);
      const yy = sy1 - t * (sy1 - sy0);
      if (i === 0) g.moveTo(px, yy);
      else g.lineTo(px, yy);
    });
    g.stroke();
    g.lineWidth = 1;
    g.fillStyle = TEXT;
    g.font = font(zh);
    g.textAlign = 'left';
    g.fillText(zh ? '残差收敛（log）' : 'residual convergence (log)', sx0, sy0 - 10);
  }

  // kernel log tail
  const logY0 = y + h - 14 - Math.min(logs.length, 8) * 16;
  g.font = font(true, 11);
  g.textAlign = 'left';
  logs.slice(-8).forEach((line, i) => {
    g.fillStyle = 'rgba(125, 145, 170, 0.95)';
    g.fillText(line.slice(0, Math.floor(w / 7)), x0, logY0 + i * 16);
  });
}

function drawHeader(
  g: CanvasRenderingContext2D,
  w: number,
  result: EmResultPayload | null,
  busy: boolean,
  zh: boolean,
): void {
  g.fillStyle = TEXT;
  g.font = font(zh, 11);
  g.textAlign = 'left';
  if (!result) {
    g.fillText(zh ? '电磁谐振特征值求解器' : 'EM resonant eigensolver', 10, 18);
    if (busy) {
      g.fillStyle = WARN;
      g.fillText(zh ? '● 计算中' : '● computing', w - 90, 18);
    }
    return;
  }
  const [n] = result.meta.shape;
  const conv = result.converged
    ? zh
      ? '已收敛'
      : 'converged'
    : zh
      ? '未收敛'
      : 'NOT converged';
  const line =
    `${result.meta.name}  n=${n}  nnz=${short(result.meta.nnz)}  ` +
    `${result.method} / ${result.backend}  it=${result.iterations} mv=${short(result.matvecs)}  ${conv}`;
  g.fillStyle = result.converged ? ACCENT : result.method ? TEXT : TEXT;
  g.fillText(line, 10, 18, w - 20);
}

function drawEmpty(g: CanvasRenderingContext2D, w: number, h: number, zh: boolean): void {
  g.fillStyle = 'rgba(150, 165, 185, 0.85)';
  g.font = font(zh, 12);
  g.textAlign = 'center';
  g.fillText(
    zh
      ? '电磁谐振特征值求解器 — 选择样例或导入矩阵后运行'
      : 'EM resonant eigensolver — pick a sample or import a matrix, then solve',
    w / 2,
    h / 2,
  );
}

/** Top panel: sorted eigenvalues as a strip plot with an optional sigma marker. */
function drawSpectrum(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  result: EmResultPayload,
  sigma: number | null,
  zh: boolean,
): void {
  const margin = { left: 46, right: 14, top: 16, bottom: 24 };
  const x0 = x + margin.left;
  const x1 = x + w - margin.right;
  const midY = y + h / 2;
  const vals = [...result.eigenvalues].sort((a, b) => a - b);
  const domain = spectrumDomain(sigma !== null ? [...vals, sigma] : vals);

  g.strokeStyle = AXIS;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x0, midY);
  g.lineTo(x1, midY);
  g.stroke();

  g.fillStyle = TEXT;
  g.font = font(zh);
  g.textAlign = 'center';
  for (let t = 0; t <= 4; t += 1) {
    const v = domain.min + ((domain.max - domain.min) * t) / 4;
    const px = mapToX(v, domain, x0, x1);
    g.fillText(short(v), px, midY + 16);
    g.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    g.beginPath();
    g.moveTo(px, y + margin.top - 6);
    g.lineTo(px, midY - 6);
    g.stroke();
  }

  g.fillStyle = ACCENT;
  for (const v of vals) {
    const px = mapToX(v, domain, x0, x1);
    g.beginPath();
    g.arc(px, midY, 4, 0, Math.PI * 2);
    g.fill();
  }

  if (sigma !== null && Number.isFinite(sigma)) {
    const px = mapToX(sigma, domain, x0, x1);
    g.strokeStyle = WARN;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(px, y + margin.top - 6);
    g.lineTo(px, midY + 8);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = WARN;
    g.textAlign = 'left';
    g.fillText(`σ=${short(sigma)}`, px + 4, y + margin.top + 2);
  }

  g.fillStyle = TEXT;
  g.textAlign = 'left';
  g.fillText(zh ? '特征值谱（λ 升序）' : 'Spectrum (λ ascending)', x0, y + 10);
}

function logScale(v: number): number {
  return Math.log10(Math.max(v, 1e-16));
}

/** Bottom-left: one residual bar per eigenpair + tolerance line (log scale). */
function drawResiduals(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  result: EmResultPayload,
  zh: boolean,
): void {
  const margin = { left: 46, right: 10, top: 18, bottom: 22 };
  const x0 = x + margin.left;
  const x1 = x + w - margin.right;
  const y0 = y + h - margin.bottom;
  const y1 = y + margin.top;

  const residuals = result.residuals;
  const tol = Number(result.diagnostics.tol ?? 1e-8) || 1e-8;
  const lo = Math.min(logScale(Math.min(...residuals, tol)),
    logScale(Math.max(...residuals, tol)) - 1) - 0.3;
  const hi = Math.max(logScale(Math.max(...residuals, tol)), lo + 1) + 0.3;
  // standard log axis: larger values on top, convergence shrinks downward
  const py = (v: number) => {
    const t = (logScale(v) - lo) / (hi - lo);
    return y0 - t * (y0 - y1);
  };

  g.strokeStyle = AXIS;
  g.beginPath();
  g.moveTo(x0, y1 - 6);
  g.lineTo(x0, y0);
  g.lineTo(x1, y0);
  g.stroke();

  // y gridlines + labels (3 log ticks)
  g.fillStyle = TEXT;
  g.font = font(zh);
  g.textAlign = 'right';
  for (const lt of [lo, (lo + hi) / 2, hi]) {
    const yy = y0 - ((lt - lo) / (hi - lo)) * (y0 - y1);
    g.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    g.beginPath();
    g.moveTo(x0, yy);
    g.lineTo(x1, yy);
    g.stroke();
    g.fillText(short(Math.pow(10, lt)), x0 - 4, yy + 3);
  }

  // tolerance line
  g.strokeStyle = ACCENT;
  g.setLineDash([4, 3]);
  g.beginPath();
  g.moveTo(x0, py(tol));
  g.lineTo(x1, py(tol));
  g.stroke();
  g.setLineDash([]);

  const bw = Math.max(4, (x1 - x0) / Math.max(residuals.length, 1) - 4);
  residuals.forEach((r, i) => {
    const cx = x0 + ((i + 0.5) * (x1 - x0)) / residuals.length;
    g.fillStyle = r <= tol ? ACCENT : WARN;
    g.fillRect(cx - bw / 2, py(r), bw, y0 - py(r));
  });

  g.fillStyle = TEXT;
  g.font = font(zh);
  g.textAlign = 'left';
  g.fillText(zh ? '相对残差（log）' : 'Rel. residual (log)', x0, y + 10);
  g.textAlign = 'right';
  g.fillStyle = ACCENT;
  g.fillText(short(tol), x0 - 4, py(tol) + 3);
  g.fillStyle = TEXT;
}

/** Bottom-right: max residual per restart cycle (log scale convergence trace). */
function drawConvergence(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  history: EmProgressInfo[],
  zh: boolean,
): void {
  const margin = { left: 46, right: 12, top: 18, bottom: 22 };
  const x0 = x + margin.left;
  const x1 = x + w - margin.right;
  const y0 = y + h - margin.bottom;
  const y1 = y + margin.top;

  const series = history.map(maxRelOf).filter((v): v is number => v !== null);
  g.fillStyle = TEXT;
  g.font = font(zh);
  g.textAlign = 'left';
  if (series.length < 1) {
    g.fillText(zh ? '收敛轨迹（等待首轮进度）' : 'Convergence (waiting for progress)', x0, y + 10);
    return;
  }

  const hi = Math.max(logScale(Math.max(...series)), -8) + 0.3;
  const lo = Math.min(logScale(Math.min(...series)), hi - 1) - 0.3;
  const px = (i: number) => x0 + ((series.length === 1 ? 0.5 : i / (series.length - 1)) * (x1 - x0));
  const py = (v: number) => {
    const t = (logScale(v) - lo) / (hi - lo);
    return y0 - t * (y0 - y1);
  };

  g.strokeStyle = AXIS;
  g.beginPath();
  g.moveTo(x0, y1 - 6);
  g.lineTo(x0, y0);
  g.lineTo(x1, y0);
  g.stroke();

  // y gridlines + labels (3 log ticks)
  g.fillStyle = TEXT;
  g.font = font(zh);
  g.textAlign = 'right';
  for (const lt of [lo, (lo + hi) / 2, hi]) {
    const yy = y0 - ((lt - lo) / (hi - lo)) * (y0 - y1);
    g.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    g.beginPath();
    g.moveTo(x0, yy);
    g.lineTo(x1, yy);
    g.stroke();
    g.fillText(short(Math.pow(10, lt)), x0 - 4, yy + 3);
  }
  // x ticks: ~8 evenly spaced cycle indices
  g.textAlign = 'center';
  for (const i of tickIndices(series.length)) {
    g.fillText(String(i + 1), px(i), y0 + 14);
  }

  g.strokeStyle = WARN;
  g.lineWidth = 1.5;
  g.beginPath();
  series.forEach((v, i) => {
    if (i === 0) g.moveTo(px(i), py(v));
    else g.lineTo(px(i), py(v));
  });
  g.stroke();
  g.lineWidth = 1;

  g.fillStyle = TEXT;
  g.fillText(zh ? '外层收敛轨迹（每轮最大残差）' : 'Outer convergence (max residual per cycle)', x0, y + 10);
  g.textAlign = 'right';
  g.fillText(`cycle ${series.length}`, x1, y0 - 4);
}
