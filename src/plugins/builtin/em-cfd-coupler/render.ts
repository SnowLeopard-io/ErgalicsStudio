// ==========================================================================
// EM-CFD Coupler plugin — canvas rendering
//
// Two views on the host canvas2d surface:
//   * coupling  — a single 1D-3D run: 1-D outlet flow & valve-opening time
//                 series (top), 3-D back pressure & interface error (bottom).
//   * verify    — the analytic-baseline comparison (Case A/B toplines) and
//                 the precision-vs-efficiency trade-off curve.
//
// Geometry helpers are pure and exported for unit tests.
// ==========================================================================

import type { EmCouplingResult, EmTradeRow, EmVerifyResult, EmWindowRecord } from './types';

export interface DrawInput {
  result: EmCouplingResult | null;
  verify: EmVerifyResult | null;
  logs: string[];
  busy: boolean;
  zh: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const AXIS = 'rgba(148, 163, 184, 0.5)';
const GRID = 'rgba(148, 163, 184, 0.14)';
const TEXT = 'rgba(148, 163, 184, 0.9)';
const ACCENT = '#2dd4bf';
const WARN = '#fbbf24';
const VIOLET = '#a78bfa';

function font(zh: boolean, size = 10): string {
  return `${size}px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
}

function short(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  if (a >= 1e-3) return v.toFixed(4);
  if (a >= 1e-6) return v.toFixed(0);
  return v.toExponential(1);
}

/** Inclusive [min, max] of a finite number sequence; NaN-safe widened. */
export function domainOf(values: number[]): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) {
    const pad = Math.max(Math.abs(lo) * 0.1, 0.5);
    return [lo - pad, hi + pad];
  }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

/** 0..1 t-value within a domain (clamped domain span). */
export function normT(v: number, lo: number, hi: number): number {
  const span = hi - lo || 1;
  return (v - lo) / span;
}

/** Milliseconds from a window time in seconds. */
export function toMs(w: EmWindowRecord): number {
  return w.t * 1e3;
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

  const { result, verify, logs, busy, zh } = input;
  if (!result && !verify && !busy && logs.length === 0) {
    drawEmpty(g, w, h, zh);
    return false;
  }

  const headerH = 30;
  drawHeader(g, w, result, verify, busy, zh);

  if (verify) {
    drawVerify(g, { x: 0, y: headerH, w, h: h - headerH }, verify, zh);
  } else if (result) {
    drawCoupling(g, { x: 0, y: headerH, w, h: h - headerH }, result, zh);
  } else {
    drawProgress(g, { x: 0, y: headerH, w, h: h - headerH }, logs, busy, zh);
  }
  return true;
}

function drawEmpty(g: CanvasRenderingContext2D, w: number, h: number, zh: boolean): void {
  g.fillStyle = 'rgba(150, 165, 185, 0.85)';
  g.font = font(zh, 12);
  g.textAlign = 'center';
  g.fillText(
    zh
      ? '1D-3D 双向耦合求解器 — 配置参数后运行耦合或验证'
      : '1D-3D bidirectional coupler — configure, then Run Coupling or Verify',
    w / 2,
    h / 2,
  );
}

function drawHeader(
  g: CanvasRenderingContext2D,
  w: number,
  result: EmCouplingResult | null,
  verify: EmVerifyResult | null,
  busy: boolean,
  zh: boolean,
): void {
  g.fillStyle = TEXT;
  g.font = font(zh, 11);
  g.textAlign = 'left';
  if (verify) {
    const a = verify.case_a;
    const b = verify.case_b;
    g.fillText(
      zh
        ? `验证基准：Case A 流量误差 ${(a.flow_rel_error * 100).toFixed(1)}% · 压力误差 ${(a.pressure_rel_error * 100).toFixed(1)}% · Case B 节流比 ${b.valve_throttle_ratio.toFixed(2)}`
        : `Verification: Case A flow err ${(a.flow_rel_error * 100).toFixed(1)}% · P err ${(a.pressure_rel_error * 100).toFixed(1)}% · Case B throttle ${b.valve_throttle_ratio.toFixed(2)}`,
      w - 10,
      18,
    );
    return;
  }
  if (result) {
    const m = result.metrics;
    const sync = m.control_sync_max_ms;
    g.fillText(
      zh
        ? `耦合完成 ${m.n_windows} 窗 · Δt1d:Δt3d=${m.time_ratio_1d_3d} · 最大误差 ${(m.worst_interface_error).toExponential(1)} · 控制同步 ${sync.toFixed(2)}ms`
        : `Coupling: ${m.n_windows} windows · ratio=${m.time_ratio_1d_3d} · worst err ${m.worst_interface_error.toExponential(1)} · sync ${sync.toFixed(2)}ms`,
      w - 10,
      18,
    );
    return;
  }
  g.fillText(zh ? '1D 管网 ↔ 3D 场 双向耦合（em-cfd-coupler）' : '1D pipe network ↔ 3D field bidirectional coupling', 10, 18);
  if (busy) {
    g.fillStyle = WARN;
    g.fillText(zh ? '● 计算中' : '● computing', w - 90, 18);
  }
}

/** Wrap canvas text so a long line does not overflow silently. */
function clampText(text: string, maxW: number): string {
  return text.length > maxW ? `${text.slice(0, maxW)}…` : text;
}

// ---------------------------------------------------------------------------
// Coupling view: two stacked time-series panels
// ---------------------------------------------------------------------------
function drawCoupling(
  g: CanvasRenderingContext2D,
  area: Rect,
  result: EmCouplingResult,
  zh: boolean,
): void {
  const ws = result.windows;
  const midH = Math.max(Math.round(area.h * 0.52), 60);
  const flowPanel: Rect = { x: area.x, y: area.y, w: area.w, h: midH };
  const bpPanel: Rect = { x: area.x, y: area.y + midH + 8, w: area.w, h: area.h - midH - 8 };
  drawFlowValve(g, flowPanel, ws, zh);
  drawBackPressure(g, bpPanel, ws, zh);
}

/** Top: 1-D outlet mass flow (left) with the valve-opening band (right 0..1). */
function drawFlowValve(g: CanvasRenderingContext2D, area: Rect, ws: EmWindowRecord[], zh: boolean): void {
  const margin = { left: 52, right: 16, top: 18, bottom: 26 };
  const x0 = area.x + margin.left;
  const x1 = area.x + area.w - margin.right;
  const y0 = area.y + area.h - margin.bottom;
  const y1 = area.y + margin.top;
  const ts = ws.map(toMs);
  const [tLo, tHi] = ts.length ? domainOf(ts) : [0, 1];
  const flows = ws.map((w) => w.md_1d);
  const [fLo, fHi] = domainOf(flows);
  const px = (t: number) => x0 + normT(t, tLo, tHi) * (x1 - x0);
  const py = (v: number) => y0 - normT(v, fLo, fHi) * (y0 - y1);

  // valves mapped into a thin band hugging the bottom axis (right 0..1 scale)
  const bandH = Math.max((y0 - y1) * 0.14, 12);
  const bandTop = y0 - bandH;
  const valveY = (open: number) => bandTop + (1 - open) * bandH;

  frame(g, area, x0, x1, y0, y1);

  // y gridlines + labels for flow (left)
  g.fillStyle = TEXT;
  g.font = font(zh);
  g.textAlign = 'right';
  for (let k = 0; k <= 4; k += 1) {
    const v = fLo + ((fHi - fLo) * k) / 4;
    const yy = py(v);
    gridLine(g, x0, x1, yy);
    g.fillText(short(v), x0 - 4, yy + 3);
  }
  // x ticks (time, ms)
  g.textAlign = 'center';
  for (let k = 0; k <= 4; k += 1) {
    const t = tLo + ((tHi - tLo) * k) / 4;
    g.fillText(short(t), px(t), y0 + 14);
  }

  // valve band baseline + fill
  g.fillStyle = 'rgba(167, 139, 250, 0.12)';
  g.fillRect(x0, bandTop, x1 - x0, y0 - bandTop);
  g.strokeStyle = 'rgba(167, 139, 250, 0.5)';
  g.beginPath();
  ws.forEach((w, i) => {
    const xx = px(ts[i]!);
    const yy = valveY(w.valve_opening);
    if (i === 0) g.moveTo(xx, yy);
    else g.lineTo(xx, yy);
  });
  g.stroke();

  // flow line (accent), filled under it
  g.beginPath();
  ws.forEach((w, i) => {
    const xx = px(ts[i]!);
    const yy = py(w.md_1d);
    if (i === 0) g.moveTo(xx, yy);
    else g.lineTo(xx, yy);
  });
  g.lineTo(px(ts[ts.length - 1]!), y0);
  g.lineTo(px(ts[0]!), y0);
  g.closePath();
  g.fillStyle = 'rgba(45, 212, 191, 0.18)';
  g.fill();
  g.strokeStyle = ACCENT;
  g.lineWidth = 1.5;
  g.beginPath();
  ws.forEach((w, i) => {
    const xx = px(ts[i]!);
    const yy = py(w.md_1d);
    if (i === 0) g.moveTo(xx, yy);
    else g.lineTo(xx, yy);
  });
  g.stroke();
  g.lineWidth = 1;

  g.fillStyle = TEXT;
  g.font = font(zh);
  g.textAlign = 'left';
  g.fillText(zh ? '1-D 出口流量（左轴）· 阀门开度（紫带，右 0..1）' : '1-D outlet flow (left) · valve opening (violet band 0..1)', x0, area.y + 12);
}

/** Bottom: 3-D outlet back pressure (left) + interface error bars (right log). */
function drawBackPressure(g: CanvasRenderingContext2D, area: Rect, ws: EmWindowRecord[], zh: boolean): void {
  const margin = { left: 52, right: 48, top: 18, bottom: 26 };
  const x0 = area.x + margin.left;
  const x1 = area.x + area.w - margin.right;
  const y0 = area.y + area.h - margin.bottom;
  const y1 = area.y + margin.top;
  const ts = ws.map(toMs);
  const [tLo, tHi] = ts.length ? domainOf(ts) : [0, 1];
  const prs = ws.map((w) => w.p_back_3d);
  const [pLo, pHi] = domainOf(prs);
  const errs = ws.map((w) => Math.max(w.iface_error, 1e-16));
  const eMin = Math.log10(Math.min(...errs));
  const eMax = Math.log10(Math.max(...errs));
  const px = (t: number) => x0 + normT(t, tLo, tHi) * (x1 - x0);
  const py = (v: number) => y0 - normT(v, pLo, pHi) * (y0 - y1);
  const ey = (v: number) => y0 - normT(Math.log10(v), eMin, eMax) * (y0 - y1);

  frame(g, area, x0, x1, y0, y1);

  g.fillStyle = TEXT;
  g.font = font(zh);
  g.textAlign = 'right';
  for (let k = 0; k <= 4; k += 1) {
    const v = pLo + ((pHi - pLo) * k) / 4;
    const yy = py(v);
    gridLine(g, x0, x1, yy);
    g.fillText(short(v), x0 - 4, yy + 3);
  }
  // right log axis for interface error
  g.textAlign = 'left';
  for (let k = 0; k <= 4; k += 1) {
    const e = Math.pow(10, eMin + ((eMax - eMin) * k) / 4);
    const yy = ey(e);
    g.fillText(short(e), x1 + 4, yy + 3);
  }
  g.textAlign = 'center';
  for (let k = 0; k <= 4; k += 1) {
    const t = tLo + ((tHi - tLo) * k) / 4;
    g.fillText(short(t), px(t), y0 + 14);
  }

  // back pressure line
  g.strokeStyle = VIOLET;
  g.lineWidth = 1.5;
  g.beginPath();
  ws.forEach((w, i) => {
    const xx = px(ts[i]!);
    const yy = py(w.p_back_3d);
    if (i === 0) g.moveTo(xx, yy);
    else g.lineTo(xx, yy);
  });
  g.stroke();

  // interface error bars (right log axis), accent when ~0, warn when large
  const bw = Math.max(2, ((x1 - x0) / Math.max(ws.length, 1)) * 0.5);
  ws.forEach((w, i) => {
    const xx = px(ts[i]!);
    const e = Math.max(w.iface_error, 1e-16);
    const yy = ey(e);
    g.fillStyle = e > 1e-3 ? WARN : 'rgba(45, 212, 191, 0.55)';
    g.fillRect(xx - bw / 2, yy, bw, y0 - yy);
  });
  g.lineWidth = 1;

  g.fillStyle = TEXT;
  g.font = font(zh);
  g.textAlign = 'left';
  g.fillText(zh ? '3-D 出口背压（左轴，紫）· 界面误差（右 log，柱）' : '3-D back pressure (left) · interface error (right log, bars)', x0, area.y + 12);
}

// ---------------------------------------------------------------------------
// Verify view: analytic-baseline toplines + trade-off curve
// ---------------------------------------------------------------------------
function drawVerify(g: CanvasRenderingContext2D, area: Rect, verify: EmVerifyResult, zh: boolean): void {
  const a = verify.case_a;
  const b = verify.case_b;
  // metric block rows
  const rows: Array<[string, string, number]> = [
    [zh ? 'Case A 流量相对误差' : 'Case A flow rel. err', `${(a.flow_rel_error * 100).toFixed(3)}%`, a.flow_rel_error],
    [zh ? 'Case A 压力相对误差' : 'Case A pressure rel. err', `${(a.pressure_rel_error * 100).toFixed(3)}%`, a.pressure_rel_error],
    [zh ? 'Case B 阀节流比' : 'Case B valve throttle ratio', b.valve_throttle_ratio.toFixed(3), b.valve_throttle_ratio],
    [zh ? 'Case B 控制同步误差（max）' : 'Case B control-sync (max)', `${b.control_sync_max_ms.toFixed(2)} ms`, b.control_sync_max_ms],
    [zh ? 'Case B 控制同步误差（mean）' : 'Case B control-sync (mean)', `${b.control_sync_mean_ms.toFixed(2)} ms`, b.control_sync_mean_ms],
  ];
  // vertical tolerance: analytic baseline parity for errors
  g.font = font(zh, 11);
  const statusColor = (name: string, err: number): string =>
    name.includes('误差') || name.includes('err') ? (err < 0.05 ? ACCENT : WARN) : err >= 2 ? ACCENT : WARN;

  const startX = area.x + 14;
  const startY = area.y + 14;
  rows.forEach(([label, val, num], i) => {
    const yy = startY + i * 22;
    g.fillStyle = statusColor(label, num);
    g.beginPath();
    g.arc(startX + 5, yy + 4, 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = TEXT;
    g.textAlign = 'left';
    g.fillText(clampText(label, 60), startX + 16, yy + 7);
    g.textAlign = 'right';
    g.fillStyle = ACCENT;
    g.fillText(val, area.x + area.w - 16, yy + 7);
  });

  // trade-off chart on the lower 2/3
  const chartTop = startY + rows.length * 22 + 16;
  const chart: Rect = { x: area.x, y: chartTop, w: area.w, h: Math.max(area.h - (chartTop - area.y) - 8, 40) };
  drawTradeOff(g, chart, verify.trade_off, zh);
}

/** Trade-off: bars of latency vs exchange period + composite score line. */
export function drawTradeOff(g: CanvasRenderingContext2D, area: Rect, rows: EmTradeRow[], zh: boolean): void {
  if (rows.length === 0) return;
  const margin = { left: 52, right: 48, top: 24, bottom: 26 };
  const x0 = area.x + margin.left;
  const x1 = area.x + area.w - margin.right;
  const y0 = area.y + area.h - margin.bottom;
  const y1 = area.y + margin.top;

  const periods = rows.map((r) => r.exchange_period_ms);
  const lats = rows.map((r) => r.latency_ms);
  const [pLo, pHi] = domainOf(periods);
  const [lLo, lHi] = domainOf(lats);
  const px = (p: number) => x0 + normT(p, pLo, pHi) * (x1 - x0);
  const ly = (v: number) => y0 - normT(v, lLo, lHi) * (y0 - y1);

  const scMin = Math.min(...rows.map((r) => r.composite_score));
  const scMax = Math.max(...rows.map((r) => r.composite_score));
  const sx = (p: number) => px(p);
  const sy = (v: number) => y0 - normT(v, Math.min(scMin, 90), scMax) * (y0 - y1) * 0.4;

  frame(g, area, x0, x1, y0, y1);

  g.fillStyle = TEXT;
  g.font = font(zh);
  g.textAlign = 'right';
  for (let k = 0; k <= 4; k += 1) {
    const v = lLo + ((lHi - lLo) * k) / 4;
    const yy = ly(v);
    gridLine(g, x0, x1, yy);
    g.fillText(short(v), x0 - 4, yy + 3);
  }

  // latency bars
  const bw = Math.max(6, ((x1 - x0) / rows.length) * 0.5);
  g.fillStyle = 'rgba(45, 212, 191, 0.55)';
  rows.forEach((r) => {
    const cx = px(r.exchange_period_ms);
    const top = ly(r.latency_ms);
    g.fillRect(cx - bw / 2, top, bw, y0 - top);
    g.fillStyle = TEXT;
    g.textAlign = 'center';
    g.fillText(short(r.exchange_period_ms), cx, y0 + 14);
    g.fillStyle = 'rgba(45, 212, 191, 0.55)';
  });

  // composite score line (right, ~40% height)
  g.strokeStyle = WARN;
  g.lineWidth = 1.5;
  g.beginPath();
  rows.forEach((r, i) => {
    const xx = sx(r.exchange_period_ms);
    const yy = sy(r.composite_score);
    if (i === 0) g.moveTo(xx, yy);
    else g.lineTo(xx, yy);
  });
  g.stroke();
  g.lineWidth = 1;

  // score labels
  g.fillStyle = WARN;
  g.textAlign = 'left';
  g.fillText(zh ? '综合评分' : 'composite score', x1 + 4, sy(rows[0]!.composite_score) + 3);

  g.fillStyle = TEXT;
  g.textAlign = 'left';
  g.fillText(zh ? '精度-效率权衡：柱=延迟(ms/窗) · 橙线=综合评分' : 'Precision-vs-efficiency: bars=latency(ms/window) · line=score', x0, area.y + 12);
}

// ---------------------------------------------------------------------------
// Busy view: log tail + progress
// ---------------------------------------------------------------------------
function drawProgress(g: CanvasRenderingContext2D, area: Rect, logs: string[], busy: boolean, zh: boolean): void {
  g.fillStyle = busy ? WARN : TEXT;
  g.font = font(zh, 12);
  g.textAlign = 'left';
  g.fillText(busy ? '● 计算中…' : zh ? '空闲' : 'idle', area.x + 14, area.y + 28);

  const logY0 = area.y + area.h - 14 - Math.min(logs.length, 8) * 15;
  g.font = font(true, 11);
  g.textAlign = 'left';
  logs.slice(-8).forEach((line, i) => {
    g.fillStyle = 'rgba(125, 145, 170, 0.95)';
    g.fillText(line.slice(0, Math.floor(area.w / 7)), area.x + 14, logY0 + i * 15);
  });
}

// ---------------------------------------------------------------------------
// Shared frame / grid helpers
// ---------------------------------------------------------------------------
function frame(g: CanvasRenderingContext2D, _area: Rect, x0: number, x1: number, y0: number, y1: number): void {
  g.strokeStyle = AXIS;
  g.beginPath();
  g.moveTo(x0, y1 - 6);
  g.lineTo(x0, y0);
  g.lineTo(x1, y0);
  g.stroke();
}

function gridLine(g: CanvasRenderingContext2D, x0: number, x1: number, y: number): void {
  g.strokeStyle = GRID;
  g.beginPath();
  g.moveTo(x0, y);
  g.lineTo(x1, y);
  g.stroke();
}