// ==========================================================================
// Ergalics Studio — PlotSpec → SVG string renderer (pure TS)
//
// Emits a self-contained, publication-grade SVG: inset plotting area, crisp
// 1px axes, "nice" ticks with outward-facing tick marks, optional gridlines,
// labelled axes, an optional legend, and a title. No external libraries.
// ==========================================================================

import { formatTick, makeScale, niceTicks, type Scale } from './scale';
import type { PlotSpec, PlotSeries } from './types';

const FONT = "13px 'Helvetica Neue', Arial, sans-serif";
const FONT_AXIS = "14px 'Helvetica Neue', Arial, sans-serif";
const FONT_TITLE = "16px 'Helvetica Neue', Arial, sans-serif";
const MARGIN = { top: 36, right: 20, bottom: 48, left: 60 };
const TICK_LEN = 6;
const COL_W = 150; // legend column width budget

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/#/g, '%23'); // '#' breaks hex colours inside attributes
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
  const finite = vals.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return undefined;
  return [Math.min(...finite), Math.max(...finite)];
}

/** Render a PlotSpec to a standalone SVG document string. */
export function renderSVG(spec: PlotSpec): string {
  const width = spec.width || 640;
  const height = spec.height || 420;
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const xScaleKind = spec.xScale ?? 'linear';
  const yScaleKind = spec.yScale ?? 'linear';

  const xDomain = spec.xDomain ?? autoDomain(spec.series, 'x') ?? [0, 1];
  const yDomain = spec.yDomain ?? autoDomain(spec.series, 'y') ?? [0, 1];
  const xTicksInfo = niceTicks(xDomain[0], xDomain[1], spec.ticks ?? 5);
  const yTicksInfo = niceTicks(yDomain[0], yDomain[1], spec.ticks ?? 5);
  const xDom: [number, number] =
    xScaleKind === 'log' ? [Math.max(1e-12, xTicksInfo.min), Math.max(1e-11, xTicksInfo.max)] : [xTicksInfo.min, xTicksInfo.max];
  const yDom: [number, number] =
    yScaleKind === 'log' ? [Math.max(1e-12, yTicksInfo.min), Math.max(1e-11, yTicksInfo.max)] : [yTicksInfo.min, yTicksInfo.max];

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
    if (s.kind === 'bar' || s.kind === 'histogram') {
      for (const b of s.bars ?? []) {
        const x0 = x.toPixel(b.x0);
        const x1 = x.toPixel(b.x1);
        const yTop = y.toPixel(b.y);
        const w = Math.max(0.5, Math.abs(x1 - x0) - 1);
        const h = Math.max(0, MARGIN.top + plotH - yTop);
        parts.push(
          `<rect x="${(Math.min(x0, x1) + 0.5).toFixed(1)}" y="${yTop.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${s.color}"/>`,
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
          `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.6"${dash} stroke-linejoin="round" stroke-linecap="round"/>`,
        );
      }
    } else if (s.kind === 'scatter') {
      for (const p of s.points ?? []) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        parts.push(
          `<circle cx="${x.toPixel(p.x).toFixed(1)}" cy="${y.toPixel(p.y).toFixed(1)}" r="3.2" fill="${s.color}" fill-opacity="0.75" stroke="none"/>`,
        );
      }
    }
  }

  // Axes (drawn on top so they are never covered by data).
  parts.push(
    `<line x1="${MARGIN.left}" y1="${MARGIN.top}" x2="${MARGIN.left}" y2="${MARGIN.top + plotH}" stroke="#222" stroke-width="1"/>`,
  );
  parts.push(
    `<line x1="${MARGIN.left}" y1="${MARGIN.top + plotH}" x2="${MARGIN.left + plotW}" y2="${MARGIN.top + plotH}" stroke="#222" stroke-width="1"/>`,
  );

  // X ticks + labels.
  if (spec.xTicksOverride && spec.xTicksOverride.length > 0) {
    for (const t of spec.xTicksOverride) {
      const px = x.toPixel(t.pos);
      parts.push(
        `<line x1="${px.toFixed(1)}" y1="${MARGIN.top + plotH}" x2="${px.toFixed(1)}" y2="${(MARGIN.top + plotH + TICK_LEN).toFixed(1)}" stroke="#222" stroke-width="1"/>`,
      );
      parts.push(
        `<text x="${px.toFixed(1)}" y="${MARGIN.top + plotH + TICK_LEN + 16}" font-size="13" text-anchor="middle" fill="#222">${escapeXml(t.label)}</text>`,
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
        `<text x="${px.toFixed(1)}" y="${MARGIN.top + plotH + TICK_LEN + 16}" font-size="13" text-anchor="middle" fill="#222">${escapeXml(formatTick(t))}</text>`,
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
      `<text x="${(MARGIN.left - TICK_LEN - 6).toFixed(1)}" y="${(py + 4).toFixed(1)}" font-size="13" text-anchor="end" fill="#222">${escapeXml(formatTick(t))}</text>`,
    );
  }

  // Axis labels.
  if (spec.xLabel) {
    parts.push(
      `<text x="${(MARGIN.left + plotW / 2).toFixed(1)}" y="${(height - 10).toFixed(1)}" font-family="${FONT_AXIS}" font-size="14" text-anchor="middle" fill="#000">${escapeXml(spec.xLabel)}</text>`,
    );
  }
  if (spec.yLabel) {
    parts.push(
      `<text transform="translate(${16},${(MARGIN.top + plotH / 2).toFixed(1)}) rotate(-90)" font-family="${FONT_AXIS}" font-size="14" text-anchor="middle" fill="#000">${escapeXml(spec.yLabel)}</text>`,
    );
  }

  // Title.
  if (spec.title) {
    parts.push(
      `<text x="${(width / 2).toFixed(1)}" y="22" font-family="${FONT_TITLE}" font-size="16" text-anchor="middle" fill="#000">${escapeXml(spec.title)}</text>`,
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
          `<line x1="${legendX}" y1="${ly}" x2="${legendX + 18}" y2="${ly}" stroke="${s.color}" stroke-width="2"/>`,
        );
      } else {
        parts.push(`<rect x="${legendX}" y="${ly - 6}" width="14" height="12" fill="${s.color}"/>`);
      }
      parts.push(
        `<text x="${legendX + 24}" y="${ly + 4}" font-size="12" fill="#222">${escapeXml(s.name)}</text>`,
      );
    });
    void COL_W;
  }

  parts.push('</svg>');
  return parts.join('');
}
