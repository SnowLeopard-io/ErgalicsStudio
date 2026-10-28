// ==========================================================================
// cs-utils — tiny shared canvas helpers for the computer-science plugins
//
// The seven CS plugins each own their domain drawing code, but share the
// chrome: canvas sizing, a bilingual header, axes, legends and tabular
// output. Keeping it here avoids seven slightly divergent copies.
// ==========================================================================

export const CS = {
  bg: '#080b10',
  panel: 'rgba(255,255,255,0.035)',
  grid: 'rgba(255,255,255,0.075)',
  axis: 'rgba(255,255,255,0.22)',
  text: 'rgba(233,240,250,0.96)',
  dim: 'rgba(166,180,201,0.92)',
  faint: 'rgba(166,180,201,0.55)',
  blue: '#78c8ff',
  cyan: '#5ee6d0',
  amber: '#ffd166',
  red: '#ff8b86',
  violet: '#b48cff',
  green: '#7ee787',
  pink: '#ff9ecd',
} as const;

export interface CanvasFrame {
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
}

export interface PlotBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  h: number;
}

export function prepareCanvas(canvas: HTMLCanvasElement | undefined | null): CanvasFrame | null {
  if (!canvas) return null;
  canvas.width = canvas.clientWidth || 880;
  canvas.height = canvas.clientHeight || 500;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = CS.bg;
  g.fillRect(0, 0, canvas.width, canvas.height);
  return { g, w: canvas.width, h: canvas.height };
}

export function font(zh: boolean, size = 11, weight = ''): string {
  const family = zh ? "'Microsoft YaHei', 'Noto Sans SC'" : 'Consolas, monospace';
  return `${weight ? `${weight} ` : ''}${size}px ${family}`;
}

export function drawHeader(
  g: CanvasRenderingContext2D,
  w: number,
  title: string,
  subtitle: string,
  zh: boolean,
): void {
  g.textAlign = 'center';
  g.font = font(zh, 15);
  g.fillStyle = CS.text;
  g.fillText(title, w / 2, 22);
  g.font = font(zh, 10.5);
  g.fillStyle = CS.dim;
  g.fillText(subtitle, w / 2, 40);
}

export function plotBox(
  w: number,
  h: number,
  left = 62,
  top = 66,
  right = 28,
  bottom = 56,
): PlotBox {
  const x0 = left;
  const y0 = top;
  const x1 = Math.max(x0 + 30, w - right);
  const y1 = Math.max(y0 + 30, h - bottom);
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

export function drawAxes(
  g: CanvasRenderingContext2D,
  box: PlotBox,
  xTicks: Array<{ value: number; label: string }>,
  yTicks: Array<{ value: number; label: string }>,
  xLabel: string,
  yLabel: string,
  zh: boolean,
): void {
  g.strokeStyle = CS.axis;
  g.lineWidth = 1;
  g.strokeRect(box.x0, box.y0, box.w, box.h);
  g.font = font(false, 9.5);
  g.fillStyle = CS.faint;
  g.textAlign = 'right';
  for (const t of yTicks) {
    const y = box.y0 + box.h * (1 - t.value);
    if (y < box.y0 - 1 || y > box.y1 + 1) continue;
    g.strokeStyle = CS.grid;
    g.beginPath();
    g.moveTo(box.x0, y);
    g.lineTo(box.x1, y);
    g.stroke();
    g.fillStyle = CS.faint;
    g.fillText(t.label, box.x0 - 6, y + 3);
  }
  g.textAlign = 'center';
  for (const t of xTicks) {
    const x = box.x0 + box.w * t.value;
    if (x < box.x0 - 1 || x > box.x1 + 1) continue;
    g.strokeStyle = CS.grid;
    g.beginPath();
    g.moveTo(x, box.y0);
    g.lineTo(x, box.y1);
    g.stroke();
    g.fillStyle = CS.faint;
    g.fillText(t.label, x, box.y1 + 14);
  }
  g.fillStyle = CS.dim;
  g.font = font(zh, 10);
  g.textAlign = 'center';
  g.fillText(xLabel, (box.x0 + box.x1) / 2, box.y1 + 34);
  g.save();
  g.translate(15, (box.y0 + box.y1) / 2);
  g.rotate(-Math.PI / 2);
  g.fillText(yLabel, 0, 0);
  g.restore();
}

export interface LegendItem {
  label: string;
  color: string;
  dash?: boolean;
}

export function drawLegend(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  items: LegendItem[],
  zh: boolean,
): void {
  g.font = font(zh, 10);
  g.textAlign = 'left';
  let cursor = x;
  for (const item of items) {
    g.strokeStyle = item.color;
    g.lineWidth = 2;
    g.setLineDash(item.dash ? [4, 3] : []);
    g.beginPath();
    g.moveTo(cursor, y);
    g.lineTo(cursor + 16, y);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = CS.dim;
    g.fillText(item.label, cursor + 21, y + 3.5);
    cursor += 27 + g.measureText(item.label).width;
  }
}

export function drawTable(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  header: string[],
  rows: Array<Array<string | number>>,
  opts: { top?: number; rowHeight?: number; left?: number; right?: number; highlight?: number } = {},
): void {
  const left = opts.left ?? 40;
  const right = opts.right ?? 28;
  const top = opts.top ?? 66;
  const rowH = opts.rowHeight ?? Math.max(14, Math.min(22, (h - top - 44) / Math.max(1, rows.length + 1)));
  const cw = (w - left - right) / Math.max(1, header.length);
  g.font = font(false, 10.5, '600');
  g.textAlign = 'left';
  g.fillStyle = CS.dim;
  header.forEach((cell, j) => g.fillText(cell, left + j * cw, top));
  g.strokeStyle = CS.axis;
  g.beginPath();
  g.moveTo(left, top + 8);
  g.lineTo(w - right, top + 8);
  g.stroke();
  g.font = font(false, 10.5);
  rows.forEach((row, i) => {
    const y = top + 22 + i * rowH;
    if (y > h - 20) return;
    if (i === opts.highlight) {
      g.fillStyle = 'rgba(120,200,255,0.14)';
      g.fillRect(left - 4, y - rowH + 4, w - left - right + 8, rowH);
    } else if (i % 2 === 0) {
      g.fillStyle = 'rgba(255,255,255,0.018)';
      g.fillRect(left - 4, y - rowH + 4, w - left - right + 8, rowH);
    }
    g.fillStyle = i === opts.highlight ? CS.text : CS.dim;
    row.forEach((cell, j) => {
      const text = String(cell);
      g.fillText(text.length > 26 ? `${text.slice(0, 24)}…` : text, left + j * cw, y);
    });
  });
}

export function drawFootnote(
  g: CanvasRenderingContext2D,
  _w: number,
  h: number,
  text: string,
  zh: boolean,
): void {
  g.font = font(zh, 9.5);
  g.fillStyle = CS.faint;
  g.textAlign = 'left';
  g.fillText(text, 24, h - 12);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function mix(a: string, b: string, t: number): string {
  const parse = (hex: string): [number, number, number] => {
    const clean = hex.replace('#', '');
    const n = Number.parseInt(clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const k = clamp(t, 0, 1);
  return `rgb(${Math.round(r1 + (r2 - r1) * k)}, ${Math.round(g1 + (g2 - g1) * k)}, ${Math.round(b1 + (b2 - b1) * k)})`;
}

/** Draw a rounded card with the panel background. */
export function drawCard(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  stroke: string = CS.grid,
): void {
  g.fillStyle = CS.panel;
  g.strokeStyle = stroke;
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(x, y, w, h, 6);
  g.fill();
  g.stroke();
}
