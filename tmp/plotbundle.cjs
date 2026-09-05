"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/core/plot/svg.ts
var svg_exports = {};
__export(svg_exports, {
  renderSVG: () => renderSVG
});
module.exports = __toCommonJS(svg_exports);

// src/core/plot/scale.ts
function niceNum(range, round) {
  if (range <= 0 || !Number.isFinite(range)) return 1;
  const exp = Math.floor(Math.log10(range));
  const frac = range / Math.pow(10, exp);
  let nice;
  if (round) {
    if (frac < 1.5) nice = 1;
    else if (frac < 3) nice = 2;
    else if (frac < 7) nice = 5;
    else nice = 10;
  } else {
    if (frac <= 1) nice = 1;
    else if (frac <= 2) nice = 2;
    else if (frac <= 5) nice = 5;
    else nice = 10;
  }
  return nice * Math.pow(10, exp);
}
function niceTicks(min, max, count = 5) {
  if (min === max) {
    const pad = Math.abs(min) === 0 ? 1 : Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }
  const range = niceNum(max - min, false);
  const step = niceNum(range / Math.max(1, count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) {
    ticks.push(Number(v.toFixed(10)));
    if (ticks.length > 1e3) break;
  }
  return { min: niceMin, max: niceMax, step, ticks };
}
function makeScale(kind, domain, range) {
  if (kind === "log") {
    const lo = domain[0] <= 0 ? 1e-12 : domain[0];
    const hi = domain[1] <= lo ? lo * 10 : domain[1];
    const l0 = Math.log10(lo);
    const l1 = Math.log10(hi);
    const [r02, r12] = range;
    return {
      kind,
      domain: [lo, hi],
      range,
      toPixel: (v) => r02 + (Math.log10(Math.max(1e-12, v)) - l0) / (l1 - l0) * (r12 - r02),
      toData: (p) => Math.pow(10, l0 + (p - r02) / (r12 - r02) * (l1 - l0))
    };
  }
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return {
    kind,
    domain,
    range,
    toPixel: (v) => r0 + (v - d0) / span * (r1 - r0),
    toData: (p) => d0 + (p - r0) / (r1 - r0 || 1) * span
  };
}
function formatTick(v) {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e4 || abs < 1e-3) return v.toExponential(1);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 1 : 2;
  return Number(v.toFixed(digits)).toString();
}

// src/core/plot/svg.ts
var FONT = "'Helvetica Neue', Arial, sans-serif";
var FONT_AXIS = "'Helvetica Neue', Arial, sans-serif";
var FONT_TITLE = "'Helvetica Neue', Arial, sans-serif";
var MARGIN = { top: 36, right: 20, bottom: 48, left: 60 };
var TICK_LEN = 6;
var COL_W = 150;
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/#/g, "%23");
}
function autoDomain(series, axis) {
  const vals = [];
  for (const s of series) {
    if (s.kind === "bar" || s.kind === "histogram") {
      if (axis === "x") {
        for (const b of s.bars ?? []) {
          vals.push(b.x0, b.x1);
        }
      } else {
        for (const b of s.bars ?? []) vals.push(b.y);
      }
    } else {
      for (const p of s.points ?? []) vals.push(axis === "x" ? p.x : p.y);
    }
  }
  const finite = vals.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return void 0;
  return [Math.min(...finite), Math.max(...finite)];
}
function renderSVG(spec) {
  const width = spec.width || 640;
  const height = spec.height || 420;
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const xScaleKind = spec.xScale ?? "linear";
  const yScaleKind = spec.yScale ?? "linear";
  const xDomain = spec.xDomain ?? autoDomain(spec.series, "x") ?? [0, 1];
  const yDomain = spec.yDomain ?? autoDomain(spec.series, "y") ?? [0, 1];
  const xTicksInfo = niceTicks(xDomain[0], xDomain[1], spec.ticks ?? 5);
  const yTicksInfo = niceTicks(yDomain[0], yDomain[1], spec.ticks ?? 5);
  const xDom = xScaleKind === "log" ? [Math.max(1e-12, xTicksInfo.min), Math.max(1e-11, xTicksInfo.max)] : [xTicksInfo.min, xTicksInfo.max];
  const yDom = yScaleKind === "log" ? [Math.max(1e-12, yTicksInfo.min), Math.max(1e-11, yTicksInfo.max)] : [yTicksInfo.min, yTicksInfo.max];
  const x = makeScale(xScaleKind, xDom, [MARGIN.left, MARGIN.left + plotW]);
  const y = makeScale(yScaleKind, yDom, [MARGIN.top + plotH, MARGIN.top]);
  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${FONT}">`
  );
  parts.push(
    `<rect x="${MARGIN.left}" y="${MARGIN.top}" width="${plotW}" height="${plotH}" fill="#ffffff" stroke="none"/>`
  );
  if (spec.grid) {
    for (const t of yTicksInfo.ticks) {
      const py = y.toPixel(t);
      if (py < MARGIN.top - 0.5 || py > MARGIN.top + plotH + 0.5) continue;
      parts.push(
        `<line x1="${MARGIN.left}" y1="${py.toFixed(1)}" x2="${MARGIN.left + plotW}" y2="${py.toFixed(1)}" stroke="#e6e6e6" stroke-width="1"/>`
      );
    }
    for (const t of xTicksInfo.ticks) {
      const px = x.toPixel(t);
      if (px < MARGIN.left - 0.5 || px > MARGIN.left + plotW + 0.5) continue;
      parts.push(
        `<line x1="${px.toFixed(1)}" y1="${MARGIN.top}" x2="${px.toFixed(1)}" y2="${MARGIN.top + plotH}" stroke="#e6e6e6" stroke-width="1"/>`
      );
    }
  }
  for (const s of spec.series) {
    if (s.kind === "bar" || s.kind === "histogram") {
      for (const b of s.bars ?? []) {
        const x0 = x.toPixel(b.x0);
        const x1 = x.toPixel(b.x1);
        const yTop = y.toPixel(b.y);
        const w = Math.max(0.5, Math.abs(x1 - x0) - 1);
        const h = Math.max(0, MARGIN.top + plotH - yTop);
        parts.push(
          `<rect x="${(Math.min(x0, x1) + 0.5).toFixed(1)}" y="${yTop.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${s.color}"/>`
        );
      }
    } else if (s.kind === "line") {
      const pts = (s.points ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      if (pts.length > 0) {
        const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x.toPixel(p.x).toFixed(1)} ${y.toPixel(p.y).toFixed(1)}`).join(" ");
        const dash = s.dash && s.dash.length ? ` stroke-dasharray="${s.dash.join(",")}"` : "";
        parts.push(
          `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.6"${dash} stroke-linejoin="round" stroke-linecap="round"/>`
        );
      }
    } else if (s.kind === "scatter") {
      for (const p of s.points ?? []) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        parts.push(
          `<circle cx="${x.toPixel(p.x).toFixed(1)}" cy="${y.toPixel(p.y).toFixed(1)}" r="3.2" fill="${s.color}" fill-opacity="0.75" stroke="none"/>`
        );
      }
    }
  }
  parts.push(
    `<line x1="${MARGIN.left}" y1="${MARGIN.top}" x2="${MARGIN.left}" y2="${MARGIN.top + plotH}" stroke="#222" stroke-width="1"/>`
  );
  parts.push(
    `<line x1="${MARGIN.left}" y1="${MARGIN.top + plotH}" x2="${MARGIN.left + plotW}" y2="${MARGIN.top + plotH}" stroke="#222" stroke-width="1"/>`
  );
  if (spec.xTicksOverride && spec.xTicksOverride.length > 0) {
    for (const t of spec.xTicksOverride) {
      const px = x.toPixel(t.pos);
      parts.push(
        `<line x1="${px.toFixed(1)}" y1="${MARGIN.top + plotH}" x2="${px.toFixed(1)}" y2="${(MARGIN.top + plotH + TICK_LEN).toFixed(1)}" stroke="#222" stroke-width="1"/>`
      );
      parts.push(
        `<text x="${px.toFixed(1)}" y="${MARGIN.top + plotH + TICK_LEN + 16}" font-size="13" text-anchor="middle" fill="#222">${escapeXml(t.label)}</text>`
      );
    }
  } else {
    for (const t of xTicksInfo.ticks) {
      const px = x.toPixel(t);
      if (px < MARGIN.left - 0.5 || px > MARGIN.left + plotW + 0.5) continue;
      parts.push(
        `<line x1="${px.toFixed(1)}" y1="${MARGIN.top + plotH}" x2="${px.toFixed(1)}" y2="${(MARGIN.top + plotH + TICK_LEN).toFixed(1)}" stroke="#222" stroke-width="1"/>`
      );
      parts.push(
        `<text x="${px.toFixed(1)}" y="${MARGIN.top + plotH + TICK_LEN + 16}" font-size="13" text-anchor="middle" fill="#222">${escapeXml(formatTick(t))}</text>`
      );
    }
  }
  for (const t of yTicksInfo.ticks) {
    const py = y.toPixel(t);
    if (py < MARGIN.top - 0.5 || py > MARGIN.top + plotH + 0.5) continue;
    parts.push(
      `<line x1="${MARGIN.left}" y1="${py.toFixed(1)}" x2="${(MARGIN.left - TICK_LEN).toFixed(1)}" y2="${py.toFixed(1)}" stroke="#222" stroke-width="1"/>`
    );
    parts.push(
      `<text x="${(MARGIN.left - TICK_LEN - 6).toFixed(1)}" y="${(py + 4).toFixed(1)}" font-size="13" text-anchor="end" fill="#222">${escapeXml(formatTick(t))}</text>`
    );
  }
  if (spec.xLabel) {
    parts.push(
      `<text x="${(MARGIN.left + plotW / 2).toFixed(1)}" y="${(height - 10).toFixed(1)}" font-family="${FONT_AXIS}" font-size="14" text-anchor="middle" fill="#000">${escapeXml(spec.xLabel)}</text>`
    );
  }
  if (spec.yLabel) {
    parts.push(
      `<text transform="translate(${16},${(MARGIN.top + plotH / 2).toFixed(1)}) rotate(-90)" font-family="${FONT_AXIS}" font-size="14" text-anchor="middle" fill="#000">${escapeXml(spec.yLabel)}</text>`
    );
  }
  if (spec.title) {
    parts.push(
      `<text x="${(width / 2).toFixed(1)}" y="22" font-family="${FONT_TITLE}" font-size="16" text-anchor="middle" fill="#000">${escapeXml(spec.title)}</text>`
    );
  }
  const showLegend = spec.legend ?? spec.series.length > 1;
  if (showLegend && spec.series.length > 0) {
    const legendX = MARGIN.left + plotW + 12;
    const itemH = 20;
    spec.series.forEach((s, i) => {
      const ly = MARGIN.top + i * itemH + 4;
      if (s.kind === "line") {
        parts.push(
          `<line x1="${legendX}" y1="${ly}" x2="${legendX + 18}" y2="${ly}" stroke="${s.color}" stroke-width="2"/>`
        );
      } else {
        parts.push(`<rect x="${legendX}" y="${ly - 6}" width="14" height="12" fill="${s.color}"/>`);
      }
      parts.push(
        `<text x="${legendX + 24}" y="${ly + 4}" font-size="12" fill="#222">${escapeXml(s.name)}</text>`
      );
    });
    void COL_W;
  }
  parts.push("</svg>");
  return parts.join("");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  renderSVG
});
