// Canvas 2D visualization. Every renderer draws inside an explicit rect so the
// plugin can stack the loss curve on top and the model-specific view below.

import type { EpochRecord, ScatterPoint, DecisionPoint } from './types';

const TEAL = '#5eead4';
const BLUE = '#38bdf8';
const AMBER = '#fbbf24';
const GREEN = '#4ade80';
const RED = '#f87171';
const TEXT = 'rgba(148,163,184,0.92)';
const AXIS = 'rgba(127,140,160,0.4)';
const GRID = 'rgba(127,140,160,0.12)';
const FONT = "11px 'Microsoft YaHei', Consolas, monospace";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function bg(canvas: HTMLCanvasElement): string {
  const c = getComputedStyle(canvas).backgroundColor;
  return c && c !== 'rgba(0, 0, 0, 0)' ? c : '#0a0e13';
}

function clear(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
  g.fillStyle = bg(canvas);
  g.fillRect(0, 0, canvas.width, canvas.height);
}

function drawAxes(g: CanvasRenderingContext2D, r: Rect, xLabel: string, yLabel: string): void {
  g.strokeStyle = AXIS;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(r.x + 0.5, r.y + 0.5);
  g.lineTo(r.x + 0.5, r.y + r.h - 0.5);
  g.lineTo(r.x + r.w - 0.5, r.y + r.h - 0.5);
  g.stroke();
  g.fillStyle = TEXT;
  g.font = FONT;
  g.textAlign = 'left';
  g.fillText(yLabel, r.x + 4, r.y + 12);
  g.textAlign = 'right';
  g.fillText(xLabel, r.x + r.w - 4, r.y + r.h - 4);
}

export function drawLossCurve(
  g: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  r: Rect,
  history: EpochRecord[],
  locale: string,
): void {
  clear(g, canvas);
  drawAxes(g, r, locale === 'zh-CN' ? '迭代次数' : 'Epoch', locale === 'zh-CN' ? '损失' : 'Loss');

  if (history.length < 1) {
    g.fillStyle = TEXT;
    g.font = FONT;
    g.textAlign = 'center';
    g.fillText(locale === 'zh-CN' ? '尚未开始训练' : 'No training yet', r.x + r.w / 2, r.y + r.h / 2);
    return;
  }

  let maxLoss = -Infinity;
  let minLoss = Infinity;
  for (const h of history) {
    if (h.loss > maxLoss) maxLoss = h.loss;
    if (h.loss < minLoss) minLoss = h.loss;
  }
  maxLoss = Math.max(maxLoss, 1e-6);
  minLoss = Math.min(minLoss, 0);
  const span = maxLoss - minLoss || 1;
  const maxEpoch = Math.max(1, history[history.length - 1]!.epoch);
  const padL = 6;
  const padB = 6;
  const plotW = r.w - padL - 4;
  const plotH = r.h - padB - 14;

  // gridlines
  g.strokeStyle = GRID;
  for (let k = 1; k < 4; k += 1) {
    const y = r.y + 14 + (plotH * k) / 4;
    g.beginPath();
    g.moveTo(r.x + padL, y);
    g.lineTo(r.x + r.w - 4, y);
    g.stroke();
  }

  g.strokeStyle = TEAL;
  g.lineWidth = 2;
  g.beginPath();
  history.forEach((h, i) => {
    const x = r.x + padL + (h.epoch / maxEpoch) * plotW;
    const y = r.y + 14 + (1 - (h.loss - minLoss) / span) * plotH;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.stroke();

  const last = history[history.length - 1]!;
  g.fillStyle = TEXT;
  g.font = FONT;
  g.textAlign = 'right';
  g.fillText(`loss ${last.loss.toFixed(4)}`, r.x + r.w - 6, r.y + 12);
  if (typeof last.accuracy === 'number') {
    g.fillText(`acc ${(last.accuracy * 100).toFixed(1)}%`, r.x + r.w - 6, r.y + 24);
  }
}

export function drawScatterFit(
  g: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  r: Rect,
  points: ScatterPoint[],
  line: { x: number[]; y: number[] } | null,
  locale: string,
): void {
  clear(g, canvas);
  drawAxes(g, r, 'x', 'y');
  if (points.length === 0) {
    g.fillStyle = TEXT;
    g.font = FONT;
    g.textAlign = 'center';
    g.fillText(locale === 'zh-CN' ? '无数据' : 'No data', r.x + r.w / 2, r.y + r.h / 2);
    return;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (line) {
    for (let i = 0; i < line.x.length; i += 1) {
      const v = line.y[i]!;
      if (v < minY) minY = v;
      if (v > maxY) maxY = v;
    }
  }
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const padL = 6;
  const padB = 6;
  const plotW = r.w - padL - 4;
  const plotH = r.h - padB - 14;
  const px = (v: number) => r.x + padL + ((v - minX) / rangeX) * plotW;
  const py = (v: number) => r.y + 14 + (1 - (v - minY) / rangeY) * plotH;

  g.fillStyle = BLUE;
  for (const p of points) {
    g.beginPath();
    g.arc(px(p.x), py(p.y), 2.5, 0, 2 * Math.PI);
    g.fill();
  }

  if (line && line.x.length > 1) {
    g.strokeStyle = AMBER;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < line.x.length; i += 1) {
      const x = px(line.x[i]!);
      const y = py(line.y[i]!);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
}

export function drawDecisionBoundary(
  g: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  r: Rect,
  points: DecisionPoint[],
  fn: (x: number, y: number) => number,
  locale: string,
): void {
  clear(g, canvas);
  if (points.length === 0) {
    g.fillStyle = TEXT;
    g.font = FONT;
    g.textAlign = 'center';
    g.fillText(locale === 'zh-CN' ? '无数据' : 'No data', r.x + r.w / 2, r.y + r.h / 2);
    return;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const padL = 6;
  const padB = 6;
  const plotW = r.w - padL - 4;
  const plotH = r.h - padB - 14;
  const px = (v: number) => r.x + padL + ((v - minX) / rangeX) * plotW;
  const py = (v: number) => r.y + 14 + (1 - (v - minY) / rangeY) * plotH;

  const grid = 48;
  const cw = plotW / grid;
  const ch = plotH / grid;
  for (let i = 0; i < grid; i += 1) {
    for (let j = 0; j < grid; j += 1) {
      const x = minX + (rangeX * i) / grid;
      const y = minY + (rangeY * (grid - 1 - j)) / grid;
      const prob = fn(x, y);
      g.fillStyle = prob > 0.5 ? 'rgba(251,191,36,0.18)' : 'rgba(56,189,248,0.18)';
      g.fillRect(r.x + padL + i * cw, r.y + 14 + j * ch, cw + 1, ch + 1);
    }
  }

  for (const p of points) {
    g.fillStyle = p.label === 1 ? GREEN : RED;
    g.beginPath();
    g.arc(px(p.x), py(p.y), 3, 0, 2 * Math.PI);
    g.fill();
  }

  g.fillStyle = TEXT;
  g.font = FONT;
  g.textAlign = 'left';
  g.fillText(locale === 'zh-CN' ? '决策边界 (蓝=0, 橙=1)' : 'Decision boundary', r.x + 6, r.y + 12);
}

let tempCanvas: HTMLCanvasElement | null = null;

export function drawMnistGrid(
  g: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  r: Rect,
  images: number[][][],
  preds: number[],
  trues: number[],
  locale: string,
): void {
  clear(g, canvas);
  if (images.length === 0) {
    g.fillStyle = TEXT;
    g.font = FONT;
    g.textAlign = 'center';
    g.fillText(locale === 'zh-CN' ? '无数据' : 'No data', r.x + r.w / 2, r.y + r.h / 2);
    return;
  }
  if (!tempCanvas) tempCanvas = document.createElement('canvas');
  tempCanvas.width = 28;
  tempCanvas.height = 28;
  const tg = tempCanvas.getContext('2d');
  if (!tg) return;

  const cols = Math.min(8, images.length);
  const rows = Math.ceil(images.length / cols);
  const cell = Math.max(28, Math.min((r.w - 12) / cols, (r.h - 12) / rows));
  const labelH = 14;

  for (let i = 0; i < images.length; i += 1) {
    const img = images[i]!;
    const x0 = r.x + 6 + (i % cols) * cell;
    const y0 = r.y + 6 + Math.floor(i / cols) * cell;

    const imgData = tg.createImageData(28, 28);
    for (let py = 0; py < 28; py += 1) {
      for (let px2 = 0; px2 < 28; px2 += 1) {
        const idx = (py * 28 + px2) * 4;
        const v = Math.round(img[py]![px2]! * 255);
        imgData.data[idx] = v;
        imgData.data[idx + 1] = v;
        imgData.data[idx + 2] = v;
        imgData.data[idx + 3] = 255;
      }
    }
    tg.putImageData(imgData, 0, 0);
    g.drawImage(tempCanvas, x0, y0, cell - 4, cell - 4 - labelH);

    const pred = preds[i]!;
    const truth = trues[i]!;
    g.fillStyle = pred === truth ? GREEN : RED;
    g.font = FONT;
    g.textAlign = 'left';
    g.fillText(`${pred}/${truth}`, x0, y0 + cell - 4);
  }
}

export function drawMessage(
  g: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  r: Rect,
  text: string,
): void {
  clear(g, canvas);
  g.fillStyle = TEXT;
  g.font = FONT;
  g.textAlign = 'center';
  g.fillText(text, r.x + r.w / 2, r.y + r.h / 2);
}

export function drawHud(g: CanvasRenderingContext2D, _canvas: HTMLCanvasElement, text: string): void {
  // HUD is drawn in device space, not clipped to a rect.
  g.fillStyle = 'rgba(148,163,184,0.95)';
  g.font = "12px 'Microsoft YaHei', Consolas, monospace";
  g.textAlign = 'left';
  g.fillText(text, 10, 18);
}
