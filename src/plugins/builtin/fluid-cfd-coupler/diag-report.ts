// ==========================================================================
// Fluid-CFD Coupler plugin — standalone diagnostic report
//
// buildDiagReportHtml renders ONE self-contained HTML file (inline CSS +
// inline SVG, zero JavaScript) carrying the full engineering context of a
// coupling run or verification: parameters, the key metrics, the 1-D flow &
// valve-opening time series, the 3-D back-pressure & interface-error series,
// and (when available) the precision-vs-efficiency trade-off table. The
// recipient opens the file offline — no server, no plugins, no external data.
//
// Pure: string in → string out, directly unit-testable.
// ==========================================================================

import type { FluidCouplingResult, FluidSubsonicCurve, FluidTradeRow, FluidVerifyResult, FluidWindowRecord } from './types';

export const DIAG_REPORT_SCHEMA = 'ergalics.em-cfd-diag-report';
export const DIAG_REPORT_VERSION = 1;

interface DiagReportInput {
  result: FluidCouplingResult | null;
  verify: FluidVerifyResult | null;
  /** 'zh-CN' renders Chinese labels, anything else English. */
  locale?: string;
  generatedAt?: Date;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtShort(v: number): string {
  const s = Number(v);
  const a = Math.abs(s);
  if (!Number.isFinite(s)) return '—';
  if (a >= 1e6) return `${(s / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(s / 1e3).toFixed(1)}k`;
  if (a >= 100) return s.toFixed(0);
  if (a >= 1) return s.toFixed(3);
  if (a >= 1e-3) return s.toFixed(4);
  if (a >= 1e-6) return `${(s * 1e6).toFixed(0)}μ`;
  return s.toExponential(2);
}

/** One line-series as inline SVG (time-series panels). */
export function svgSeries(
  ws: FluidWindowRecord[],
  key: 'md_1d' | 'p_back_3d' | 'iface_error',
  width = 660,
): string {
  const h = 168;
  const m = { left: 56, right: 16, top: 20, bottom: 22 };
  const x0 = m.left;
  const x1 = width - m.right;
  const y0 = h - m.bottom;
  const y1 = m.top;
  if (ws.length < 2) return '';
  const ts = ws.map((w) => w.t * 1e3); // ms
  const ys = ws.map((w) => Number(w[key]));
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of ys) {
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!Number.isFinite(lo) || lo === hi) {
    const pad = Math.max(Math.abs(lo || 1) * 0.1, 0.5);
    lo -= pad;
    hi += pad;
  } else {
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
  }
  const px = (t: number) => x0 + ((t - ts[0]!) / (ts[ts.length - 1]! - ts[0]! || 1)) * (x1 - x0);
  const py = (v: number) => y0 - ((v - lo) / (hi - lo || 1)) * (y0 - y1);

  const parts: string[] = [];
  parts.push(repeatLines(lo, hi, py, x0, x1, y0, y1));
  const d = ws.map((_, i) => `${i === 0 ? 'M' : 'L'} ${px(ts[i]!).toFixed(1)} ${py(ys[i]!).toFixed(1)}`).join(' ');
  parts.push(`<path d="${d}" stroke="${key === 'p_back_3d' ? '#a78bfa' : '#14b8a6'}" stroke-width="1.5" fill="none"/>`);
  parts.push(`<rect x="0" y="0" width="${width}" height="${h}" fill="none" stroke="rgba(148,163,184,0.2)"/>`);
  return `<svg viewBox="0 0 ${width} ${h}" width="100%" height="${h}" role="img" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

/** Gridlines + y labels for the SVG chart. */
function repeatLines(lo: number, hi: number, py: (v: number) => number, x0: number, x1: number, _y0: number, _y1: number): string {
  const parts: string[] = [];
  for (let k = 0; k <= 4; k += 1) {
    const v = lo + ((hi - lo) * k) / 4;
    const yy = py(v);
    parts.push(`<line x1="${x0}" y1="${yy}" x2="${x1}" y2="${yy}" stroke="rgba(148,163,184,0.14)"/>`);
    parts.push(`<text x="${x0 - 4}" y="${yy + 3}" fill="#94a3b8" font-size="9" text-anchor="end" font-family="Consolas,monospace">${fmtShort(v)}</text>`);
  }
  return parts.join('');
}

/** Valve-opening step strip (0..1). */
export function svgValve(ws: FluidWindowRecord[], width = 660): string {
  const h = 76;
  const m = { left: 56, right: 16, top: 8, bottom: 14 };
  const x0 = m.left;
  const x1 = width - m.right;
  const y0 = h - m.bottom;
  const y1 = m.top;
  if (ws.length < 2) return '';
  const ts = ws.map((w) => w.t * 1e3);
  const px = (t: number) => x0 + ((t - ts[0]!) / (ts[ts.length - 1]! - ts[0]! || 1)) * (x1 - x0);
  const py = (open: number) => y0 - open * (y0 - y1);
  const parts: string[] = [];
  for (let k = 0; k <= 4; k += 1) {
    const v = k / 4;
    const yy = py(v);
    parts.push(`<line x1="${x0}" y1="${yy}" x2="${x1}" y2="${yy}" stroke="rgba(148,163,184,0.14)"/>`);
    parts.push(`<text x="${x0 - 4}" y="${yy + 3}" fill="#94a3b8" font-size="9" text-anchor="end" font-family="Consolas,monospace">${v}</text>`);
  }
  const d = ws.map((w, i) => `${i === 0 ? 'M' : 'L'} ${px(ts[i]!).toFixed(1)} ${py(w.valve_opening).toFixed(1)}`).join(' ');
  parts.push(`<path d="${d}" stroke="#a78bfa" stroke-width="1.5" fill="none"/>`);
  parts.push(`<rect x="0" y="0" width="${width}" height="${h}" fill="none" stroke="rgba(148,163,184,0.2)"/>`);
  return `<svg viewBox="0 0 ${width} ${h}" width="100%" height="${h}" role="img" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

/** Two-column label/value table from an array of key/value rows. */
function table(rows: Array<[string, string]>): string {
  return `<table><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('\n')}</tbody></table>`;
}

const METRIC_ROWS: Array<[string, string]> = [
  ['exchange windows', 'n_windows'],
  ['total sim time (s)', 'total_sim_time'],
  ['1D:3D time ratio', 'time_ratio_1d_3d'],
  ['exchange period (ms)', 'exchange_period_ms'],
  ['3-D sub-steps / window', 'sub3d_per_window'],
  ['mean exchange latency (ms)', 'mean_exchange_latency_ms'],
  ['worst exchange latency (ms)', 'worst_exchange_latency_ms'],
  ['mean interface error', 'mean_interface_error'],
  ['worst interface error', 'worst_interface_error'],
  ['control-sync max (ms)', 'control_sync_max_ms'],
  ['control-sync mean (ms)', 'control_sync_mean_ms'],
  ['final back pressure (Pa)', 'final_back_pressure'],
  ['final plenum pressure (Pa)', 'final_plenum_pressure'],
  ['final flow (kg/s)', 'final_flow_kg_s'],
];

export function buildDiagReportHtml(input: DiagReportInput): string {
  const L = input.locale === 'zh-CN' ? zh : en;
  const now = (input.generatedAt ?? new Date()).toISOString();
  const { result, verify } = input;

  let body = '';
  if (verify) {
    const a = verify.case_a;
    const b = verify.case_b;
    const c = verify.case_c;
    const d = verify.case_d;
    body += `<h2>${L.verifyHeading}</h2>`;
    body += table([
      ['Case A · flow rel. err', `${(a.flow_rel_error * 100).toFixed(3)}%`],
      ['Case A · pressure rel. err', `${(a.pressure_rel_error * 100).toFixed(3)}%`],
      ['Case B · valve throttle ratio', b.valve_throttle_ratio.toFixed(3)],
      ['Case B · control-sync max (ms)', `${b.control_sync_max_ms.toFixed(3)}`],
      ['Case C · flow rel. err', `${(c.flow_rel_error * 100).toFixed(3)}%`],
      ['Case C · back pressure rise (Pa)', c.back_pressure_rise_pa.toFixed(1)],
      ['Case D · flow rel. err', `${(d.flow_rel_error * 100).toFixed(3)}%`],
      ['Case D · pressure ratio (r)', d.pressure_ratio_actual.toFixed(3)],
    ]);
    body += `<h2>${L.metricsHeading}</h2>`;
    body += tableMetricBlock(a.metrics);
    body += `<h2>${L.caseBHeading}</h2>`;
    body += tableMetricBlock(b.metrics);
    body += `<h2>${L.caseCHeading}</h2>`;
    body += tableMetricBlock(c.metrics);
    body += `<h2>${L.caseDHeading}</h2>`;
    body += tableMetricBlock(d.metrics);
    body += subsonicBlock(verify.subsonic_curve);
    body += tradeOffBlock(verify.trade_off);
  } else if (result) {
    body += `<h2>${L.metricsHeading}</h2>`;
    body += tableMetricBlock(result.metrics);
    if (result.windows.length >= 2) {
      body += `<figure>${svgSeries(result.windows, 'md_1d')}<figcaption>${L.flowSeries}</figcaption></figure>`;
      body += `<figure>${svgValve(result.windows)}<figcaption>${L.valveSeries}</figcaption></figure>`;
      body += `<figure>${svgSeries(result.windows, 'p_back_3d')}<figcaption>${L.bpSeries}</figcaption></figure>`;
      body += `<figure>${svgSeries(result.windows, 'iface_error')}<figcaption>${L.errSeries}</figcaption></figure>`;
    }
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${L.heading}</title>
<style>
:root{--bg:#ffffff;--fg:#1a1c1e;--muted:#5f6368;--card:#f7f8fa;--border:#dfe1e5}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,"Segoe UI",Roboto,Arial,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:780px;margin:0 auto;padding:36px 22px 64px}
header{border-bottom:1px solid var(--border);margin-bottom:20px;padding-bottom:14px}
h1{font-size:22px;margin:0 0 8px}
.badge{display:inline-block;font-size:12px;color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:2px 10px;margin-right:6px}
h2{font-size:17px;margin:26px 0 8px}
table{border-collapse:collapse;font-size:13px;margin:6px 0}
th,td{border:1px solid var(--border);padding:4px 10px;text-align:left}
th{background:var(--card)}
figure{margin:14px 0;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:8px}
figure svg{max-width:100%;height:auto;display:block;margin:0 auto}
figcaption{color:var(--muted);font-size:12px;margin-top:8px;text-align:center}
footer{margin-top:30px;border-top:1px solid var(--border);padding-top:10px;color:var(--muted);font-size:12px}
</style>
</head>
<body>
<div class="wrap">
<header>
<h1>${L.heading}</h1>
<span class="badge">1D-3D bidirectional coupler</span>
<span class="badge">${esc(now)}</span>
</header>
${body}
<footer>${esc(DIAG_REPORT_SCHEMA)} v${DIAG_REPORT_VERSION} · ${L.offline}</footer>
</div>
</body>
</html>`;
}

function tableMetricBlock(metrics: FluidCouplingResult['metrics']): string {
  return table(METRIC_ROWS.map(([label, key]) => [label, fmtShort(metrics[key as keyof typeof metrics] as number)]));
}

function tradeOffBlock(rows: FluidTradeRow[]): string {
  if (!rows || rows.length === 0) return '';
  const head = ['period (ms)', 'freq (Hz)', 'latency (ms)', 'iface error', 'score'].map((c) => `<th>${c}</th>`).join('');
  const body = rows
    .map((r) => `<tr><td>${r.exchange_period_ms}</td><td>${r.exchange_freq_hz.toFixed(1)}</td><td>${r.latency_ms}</td><td>${r.interface_error}</td><td>${r.composite_score.toFixed(1)}</td></tr>`)
    .join('\n');
  return `<h2>Precision-vs-efficiency trade-off</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Subsonic-branch literature scan table (Case D supporting evidence). */
function subsonicBlock(sc: FluidSubsonicCurve): string {
  if (!sc || !sc.rows || sc.rows.length === 0) return '';
  const cells = [
    `critical ratio PR* = ${sc.critical_pressure_ratio_lit.toFixed(4)}`,
    `max rel err = ${fmtShort(sc.max_rel_error)}`,
    `sens dln mdot/dln r = ${sc.sensitivity_dln_md_over_dln_r.toFixed(4)}`,
  ]
    .map((t) => `<span class="badge">${esc(t)}</span>`)
    .join('');
  const head = ['pressure ratio', 'subsonic', 'solver mdot (kg/s)', 'literature mdot (kg/s)', 'rel error'].map((c) => `<th>${c}</th>`).join('');
  const body = sc.rows
    .map((r) => `<tr><td>${r.pressure_ratio.toFixed(4)}</td><td>${r.subsonic ? '✓' : '—'}</td><td>${fmtShort(r.md_solver_kg_s)}</td><td>${fmtShort(r.md_literature_kg_s)}</td><td>${fmtShort(r.rel_error)}</td></tr>`)
    .join('\n');
  return `<h2>Subsonic literature scan (Case D)</h2><div>${cells}</div><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const zh = {
  heading: '1D 管网 ↔ 3D 场 双向耦合 — 诊断报告',
  verifyHeading: '验证基准（解析解对照）',
  metricsHeading: '耦合关键指标',
  caseBHeading: 'Case B（毫秒级阀门控制）',
  caseCHeading: 'Case C（能量/核安全通道）',
  caseDHeading: 'Case D（亚临界双向耦合）',
  flowSeries: '1-D 出口流量 vs 时间',
  valveSeries: '阀门开度（0..1, 毫秒级控制）',
  bpSeries: '3-D 出口背压（反向耦合反馈）',
  errSeries: '双向界面误差',
  offline: '自包含 · 可离线打开 · 无脚本无外部资源',
};

const en = {
  heading: '1D-3D Bidirectional Coupling — Diagnostic Report',
  verifyHeading: 'Verification baseline (analytical comparison)',
  metricsHeading: 'Coupling metrics',
  caseBHeading: 'Case B (millisecond valve control)',
  caseCHeading: 'Case C (energy / nuclear-safety channel)',
  caseDHeading: 'Case D (subsonic bidirectional coupling)',
  flowSeries: '1-D outlet flow vs time',
  valveSeries: 'Valve opening (0..1, ms control)',
  bpSeries: '3-D outlet back pressure (reverse coupling)',
  errSeries: 'Bidirectional interface error',
  offline: 'Self-contained · works offline · no scripts, no external assets',
};