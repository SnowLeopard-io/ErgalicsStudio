// ==========================================================================
// EM Eigensolver plugin — standalone diagnostic report (PRD REQ-G)
//
// buildDiagReportHtml renders ONE self-contained HTML file (inline CSS +
// inline SVG, zero JavaScript) carrying the full engineering-diagnosis
// context of a solve: parameters, the eigenvalue spectrum, per-mode residual
// bars against the tolerance line, the outer convergence trace, and every
// returned mode field as a diverging-colormap heatmap. The recipient opens
// the file offline — no server, no plugins, no data beyond this solve.
//
// Pure: string in → string out, directly unit-testable. All externally
// sourced text (matrix names) is HTML-escaped before embedding.
// ==========================================================================

import type { EmModeField, EmProgressInfo, EmResultPayload, EmSolverConfig } from './types';
import { maxRelOf } from './render';

export const DIAG_REPORT_SCHEMA = 'ergalics.em-diag-report';
export const DIAG_REPORT_VERSION = 1;

export interface DiagReportInput {
  result: EmResultPayload;
  /** Resolved solver configuration for the run. */
  config: EmSolverConfig;
  /** Per-cycle progress events (convergence trace source). */
  history?: EmProgressInfo[];
  /** 'zh-CN' renders Chinese labels, anything else English. */
  locale?: string;
  generatedAt?: Date;
}

// --------------------------------------------------------------------------
// Formatting helpers
// --------------------------------------------------------------------------

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Compact exponential formatting, axis-safe. */
function fmtExp(v: number): string {
  if (!Number.isFinite(v)) return '—';
  return v.toExponential(2);
}

function fmtShort(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(3);
  if (a >= 1e-3) return v.toFixed(4);
  return v.toExponential(1);
}

const logScale = (v: number): number => Math.log10(Math.max(v, 1e-16));

/** Diverging colormap for normalised field values in [-1, 1]: blue → white → red. */
export function fieldColor(v: number): string {
  const t = Math.max(-1, Math.min(1, v));
  const m = Math.abs(t);
  // white → full saturation as |v| grows (piecewise-linear on the channel)
  if (t >= 0) {
    const r = Math.round(255);
    const g = Math.round(255 - 213 * m); // 255 → 42
    const b = Math.round(255 - 198 * m); // 255 → 57
    return `rgb(${r},${g},${b})`;
  }
  const r = Math.round(255 - 194 * m); // 255 → 61
  const g = Math.round(255 - 141 * m); // 255 → 114
  const b = Math.round(255); // constant
  return `rgb(${r},${g},${b})`;
}

// --------------------------------------------------------------------------
// SVG charts
// --------------------------------------------------------------------------

const AXIS = '#94a3b8';
const GRID = 'rgba(148,163,184,0.18)';
const ACCENT = '#14b8a6';
const WARN = '#f59e0b';

/** Spectrum strip: sorted eigenvalues as dots on one axis, optional σ marker. */
export function svgSpectrum(eigenvalues: number[], sigma: number | null, width = 680): string {
  const h = 96;
  const x0 = 56;
  const x1 = width - 16;
  const midY = 52;
  const vals = [...eigenvalues].filter(Number.isFinite).sort((a, b) => a - b);
  const dom = vals.length ? vals : [0, 1];
  let min = Math.min(...dom, sigma ?? Infinity);
  let max = Math.max(...dom, sigma ?? -Infinity);
  if (min === max) { const p = Math.max(Math.abs(min) * 0.1, 0.5); min -= p; max += p; }
  else { const p = (max - min) * 0.08; min -= p; max += p; }
  const px = (v: number) => x0 + ((v - min) / (max - min)) * (x1 - x0);

  const parts: string[] = [];
  parts.push(`<line x1="${x0}" y1="${midY}" x2="${x1}" y2="${midY}" stroke="${AXIS}" stroke-width="1"/>`);
  for (let t = 0; t <= 4; t += 1) {
    const v = min + ((max - min) * t) / 4;
    parts.push(`<line x1="${px(v)}" y1="26" x2="${px(v)}" y2="${midY - 6}" stroke="${GRID}"/>`);
    parts.push(`<text x="${px(v)}" y="${midY + 18}" fill="${AXIS}" font-size="10" text-anchor="middle" font-family="Consolas, monospace">${fmtShort(v)}</text>`);
  }
  for (const v of vals) {
    parts.push(`<circle cx="${px(v)}" cy="${midY}" r="4" fill="${ACCENT}"/>`);
  }
  if (sigma !== null && Number.isFinite(sigma)) {
    parts.push(`<line x1="${px(sigma)}" y1="24" x2="${px(sigma)}" y2="${midY + 10}" stroke="${WARN}" stroke-dasharray="4 3"/>`);
    parts.push(`<text x="${px(sigma) + 4}" y="30" fill="${WARN}" font-size="10" font-family="Consolas, monospace">σ=${fmtShort(sigma)}</text>`);
  }
  return `<svg viewBox="0 0 ${width} ${h}" width="100%" height="${h}" role="img" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

/** Per-mode residual bars (log scale) + dashed tolerance line. */
export function svgResiduals(residuals: number[], tol: number, width = 680): string {
  const h = 170;
  const m = { left: 56, right: 14, top: 22, bottom: 20 };
  const x0 = m.left;
  const x1 = width - m.right;
  const y0 = h - m.bottom;
  const y1 = m.top;
  const rs = residuals.filter(Number.isFinite);
  if (rs.length === 0) return '';
  const lo = Math.min(logScale(Math.min(...rs, tol)), logScale(Math.max(...rs, tol)) - 1) - 0.3;
  const hi = Math.max(logScale(Math.max(...rs, tol)), lo + 1) + 0.3;
  const py = (v: number) => y0 - ((logScale(v) - lo) / (hi - lo)) * (y0 - y1);

  const parts: string[] = [];
  parts.push(`<path d="M ${x0} ${y1 - 6} L ${x0} ${y0} L ${x1} ${y0}" stroke="${AXIS}" fill="none"/>`);
  for (const lt of [lo, (lo + hi) / 2, hi]) {
    const yy = y0 - ((lt - lo) / (hi - lo)) * (y0 - y1);
    parts.push(`<line x1="${x0}" y1="${yy}" x2="${x1}" y2="${yy}" stroke="${GRID}"/>`);
    parts.push(`<text x="${x0 - 4}" y="${yy + 3}" fill="${AXIS}" font-size="10" text-anchor="end" font-family="Consolas, monospace">${fmtShort(Math.pow(10, lt))}</text>`);
  }
  parts.push(`<line x1="${x0}" y1="${py(tol)}" x2="${x1}" y2="${py(tol)}" stroke="${ACCENT}" stroke-dasharray="4 3"/>`);
  parts.push(`<text x="${x1}" y="${py(tol) - 4}" fill="${ACCENT}" font-size="10" text-anchor="end" font-family="Consolas, monospace">tol ${fmtExp(tol)}</text>`);
  const bw = Math.max(4, (x1 - x0) / rs.length - 4);
  rs.forEach((r, i) => {
    const cx = x0 + ((i + 0.5) * (x1 - x0)) / rs.length;
    const color = r <= tol ? ACCENT : WARN;
    parts.push(`<rect x="${cx - bw / 2}" y="${py(r)}" width="${bw}" height="${Math.max(y0 - py(r), 0)}" fill="${color}"/>`);
    parts.push(`<text x="${cx}" y="${y0 + 13}" fill="${AXIS}" font-size="9" text-anchor="middle" font-family="Consolas, monospace">${i + 1}</text>`);
  });
  return `<svg viewBox="0 0 ${width} ${h}" width="100%" height="${h}" role="img" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

/** Convergence trace: max relative residual per progress event (log scale). */
export function svgConvergence(history: EmProgressInfo[], width = 680): string {
  const h = 170;
  const m = { left: 56, right: 14, top: 22, bottom: 20 };
  const x0 = m.left;
  const x1 = width - m.right;
  const y0 = h - m.bottom;
  const y1 = m.top;
  const series = history.map(maxRelOf).filter((v): v is number => v !== null && Number.isFinite(v));
  if (series.length === 0) return '';
  const hi = Math.max(logScale(Math.max(...series)), -8) + 0.3;
  const lo = Math.min(logScale(Math.min(...series)), hi - 1) - 0.3;
  const px = (i: number) => x0 + ((series.length === 1 ? 0.5 : i / (series.length - 1)) * (x1 - x0));
  const py = (v: number) => y0 - ((logScale(v) - lo) / (hi - lo)) * (y0 - y1);

  const parts: string[] = [];
  parts.push(`<path d="M ${x0} ${y1 - 6} L ${x0} ${y0} L ${x1} ${y0}" stroke="${AXIS}" fill="none"/>`);
  for (const lt of [lo, (lo + hi) / 2, hi]) {
    const yy = y0 - ((lt - lo) / (hi - lo)) * (y0 - y1);
    parts.push(`<line x1="${x0}" y1="${yy}" x2="${x1}" y2="${yy}" stroke="${GRID}"/>`);
    parts.push(`<text x="${x0 - 4}" y="${yy + 3}" fill="${AXIS}" font-size="10" text-anchor="end" font-family="Consolas, monospace">${fmtShort(Math.pow(10, lt))}</text>`);
  }
  const d = series.map((v, i) => `${i === 0 ? 'M' : 'L'} ${px(i)} ${py(v)}`).join(' ');
  parts.push(`<path d="${d}" stroke="${WARN}" stroke-width="1.5" fill="none"/>`);
  parts.push(`<text x="${x1}" y="${y0 - 4}" fill="${AXIS}" font-size="10" text-anchor="end" font-family="Consolas, monospace">n=${series.length}</text>`);
  return `<svg viewBox="0 0 ${width} ${h}" width="100%" height="${h}" role="img" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

/** One mode-field heatmap as inline SVG (diverging colormap, cell grid). */
export function svgModeField(field: EmModeField, size = 320): string {
  const rows = Math.max(1, field.rows);
  const cols = Math.max(1, field.cols);
  const cw = size / cols;
  const ch = size / rows;
  const parts: string[] = [`<rect x="0" y="0" width="${size}" height="${size}" fill="#ffffff"/>`];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const v = field.values[r * cols + c] ?? 0;
      if (v === 0) continue;
      parts.push(`<rect x="${(c * cw).toFixed(2)}" y="${(r * ch).toFixed(2)}" width="${Math.ceil(cw)}" height="${Math.ceil(ch)}" fill="${fieldColor(v)}"/>`);
    }
  }
  parts.push(`<rect x="0.5" y="0.5" width="${size - 1}" height="${size - 1}" fill="none" stroke="rgba(148,163,184,0.4)"/>`);
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="mode field ${field.index + 1}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

// --------------------------------------------------------------------------
// Labels + document assembly
// --------------------------------------------------------------------------

const LABELS = {
  zh: {
    heading: '电磁谐振特征值求解 — 诊断报告',
    params: '求解参数',
    matrix: '矩阵',
    spectrum: '特征值谱（λ 升序）',
    residuals: '相对残差（log，逐特征对）',
    convergence: '外层收敛轨迹（每轮最大残差，log）',
    modes: '模态场（归一化，发散色标：蓝负红正）',
    converged: '已收敛',
    notConverged: '未收敛',
    noTrace: '（本次会话无进度轨迹）',
    offline: '自包含 · 可离线打开 · 无脚本无外部资源',
    colMethod: '算法', colK: 'k', colSigma: 'σ', colTol: '容差', colBasis: '基宽',
    colSeed: '种子', colIters: '轮次', colMatvecs: 'matvec', colMaxRes: '最大残差',
    colShape: '规模', colNnz: '非零元', colComplex: '复矩阵',
  },
  en: {
    heading: 'EM Eigensolver — Diagnostic Report',
    params: 'Solver parameters',
    matrix: 'Matrix',
    spectrum: 'Spectrum (λ ascending)',
    residuals: 'Relative residuals (log, per eigenpair)',
    convergence: 'Outer convergence (max residual per cycle, log)',
    modes: 'Mode fields (normalized, diverging: negative blue / positive red)',
    converged: 'converged',
    notConverged: 'NOT converged',
    noTrace: '(no progress trace in this session)',
    offline: 'Self-contained · works offline · no scripts, no external assets',
    colMethod: 'Method', colK: 'k', colSigma: 'σ', colTol: 'Tolerance', colBasis: 'Basis',
    colSeed: 'Seed', colIters: 'Cycles', colMatvecs: 'matvec', colMaxRes: 'Max residual',
    colShape: 'Shape', colNnz: 'nnz', colComplex: 'Complex',
  },
} as const;

/**
 * Render the standalone diagnostic report as a single HTML string.
 * Pure; safe against adversarial matrix names (everything is escaped).
 */
export function buildDiagReportHtml(input: DiagReportInput): string {
  const lang = input.locale === 'zh-CN' ? 'zh' : 'en';
  const L = LABELS[lang];
  const { result, config } = input;
  const now = (input.generatedAt ?? new Date()).toISOString();
  const sigma = config.sigma;
  const status = result.converged ? L.converged : L.notConverged;
  const maxRes = result.residuals.length ? Math.max(...result.residuals) : 0;

  const paramRows: Array<[string, string]> = [
    [L.colMethod, esc(result.method)],
    [L.colK, esc(config.k)],
    [L.colSigma, sigma === null || sigma === undefined ? '—' : fmtShort(sigma)],
    [L.colTol, fmtExp(config.tol)],
    [L.colBasis, esc(config.basisDim)],
    [L.colSeed, esc(config.seed)],
    [L.colIters, esc(result.iterations)],
    [L.colMatvecs, esc(result.matvecs)],
    [L.colMaxRes, fmtExp(maxRes)],
  ];
  // Two label/value cells per <tr>; an odd trailing cell closes its own row.
  const paramRowsHtml = paramRows.map(([k, v], i) => {
    const cell = `<th>${k}</th><td>${v}</td>`;
    return i % 2 === 0 ? `<tr>${cell}` : `${cell}</tr>`;
  }).join('\n') + (paramRows.length % 2 === 1 ? '</tr>' : '');
  const matrixRows: Array<[string, string]> = [
    [L.colShape, `${result.meta.shape[0]} × ${result.meta.shape[1]}`],
    [L.colNnz, esc(result.meta.nnz)],
    [L.colComplex, result.meta.complex ? '✓' : '—'],
  ];

  const trace = svgConvergence(input.history ?? []);
  const modes = result.modeFields ?? [];

  return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(L.heading)} · ${esc(result.meta.name)}</title>
<style>
:root{--bg:#ffffff;--fg:#1a1c1e;--muted:#5f6368;--card:#f7f8fa;--border:#dfe1e5}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:36px 22px 64px}
header{border-bottom:1px solid var(--border);margin-bottom:20px;padding-bottom:14px}
h1{font-size:22px;margin:0 0 8px}
.badge{display:inline-block;font-size:12px;color:var(--muted);border:1px solid var(--border);border-radius:999px;padding:2px 10px;margin-right:6px}
.badge.ok{color:#0f7b3f;border-color:#0f7b3f}
.badge.warn{color:#c5221f;border-color:#c5221f}
h2{font-size:17px;margin:26px 0 8px}
table{border-collapse:collapse;font-size:13px;margin:6px 0}
th,td{border:1px solid var(--border);padding:4px 10px;text-align:left}
th{background:var(--card)}
figure{margin:14px 0;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:8px}
figure svg{max-width:100%;height:auto;display:block;margin:0 auto}
figcaption{color:var(--muted);font-size:12px;margin-top:8px;text-align:center}
.fields{display:flex;flex-wrap:wrap;gap:14px}
.field{text-align:center}
.field .cap{color:var(--muted);font-size:12px;margin-top:4px;font-family:Consolas,monospace}
footer{margin-top:30px;border-top:1px solid var(--border);padding-top:10px;color:var(--muted);font-size:12px}
</style>
</head>
<body>
<div class="wrap">
<header>
<h1>${esc(L.heading)}</h1>
<span class="badge ${result.converged ? 'ok' : 'warn'}">${esc(status)}</span>
<span class="badge">${esc(result.method)} / ${esc(result.backend)}</span>
<span class="badge">${esc(now)}</span>
</header>

<h2>${esc(L.params)}</h2>
<table><tbody>
${paramRowsHtml}
</tbody></table>

<h2>${esc(L.matrix)}</h2>
<table><tbody>
${matrixRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('\n')}
<tr><th>${esc('name')}</th><td>${esc(result.meta.name)}</td></tr>
${result.meta.description ? `<tr><th>${esc('description')}</th><td>${esc(result.meta.description)}</td></tr>` : ''}
</tbody></table>

<figure>${svgSpectrum(result.eigenvalues, sigma)}<figcaption>${esc(L.spectrum)}</figcaption></figure>

<figure>${svgResiduals(result.residuals, config.tol)}<figcaption>${esc(L.residuals)}</figcaption></figure>

${trace ? `<figure>${trace}<figcaption>${esc(L.convergence)}</figcaption></figure>` : `<p>${esc(L.noTrace)}</p>`}

${modes.length ? `<h2>${esc(L.modes)}</h2>
<div class="fields">
${modes.map((f) => `<div class="field">${svgModeField(f)}<div class="cap">${esc(`mode ${f.index + 1} · λ=${fmtExp(f.eigenvalue)} · ${f.rows}×${f.cols}${f.approx ? ' (approx)' : ''}`)}</div></div>`).join('\n')}
</div>` : ''}

<footer>${esc(DIAG_REPORT_SCHEMA)} v${DIAG_REPORT_VERSION} · ${esc(L.offline)}</footer>
</div>
</body>
</html>`;
}
