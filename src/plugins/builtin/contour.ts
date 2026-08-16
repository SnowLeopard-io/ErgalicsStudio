// ==========================================================================
// Example plugin: Contour Plot (等值线图)
//
// Renders a 2-D scalar field (JSON grid, e.g. examples/data/field.json)
// as a viridis color ramp with marching-squares contour lines.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';

export const contourManifest: PluginManifest = {
  id: 'example.contour',
  name: 'Contour',
  nameI18n: { 'zh-CN': '等值线图', 'en-US': 'Contour' },
  version: '1.0.0',
  author: 'Ergalics',
  description: '2-D field contour plot with color ramp.',
  descriptionI18n: {
    'zh-CN': '渲染二维标量场（JSON 网格）为色带 + 等值线，适合涡旋场、地形等数据。',
    'en-US': '2-D scalar fields as color ramp + contour lines; great for vortex/topography data.',
  },
  license: 'MIT',
  entry: 'example.contour',
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: '2-D field grid' },
  ],
};

const MAX_GRID = 320;

interface State {
  levels: number;
  showGrid: boolean;
  hasData: boolean;
}

/** Standard viridis anchors (0..1). */
const VIRIDIS: [number, number, number][] = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 145, 140],
  [94, 201, 98],
  [253, 231, 37],
];

function viridis(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(x));
  const f = x - i;
  const a = VIRIDIS[i]!;
  const b = VIRIDIS[i + 1]!;
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export class ContourPlugin implements Plugin {
  readonly manifest = contourManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private grid: number[][] = [];
  private min = 0;
  private max = 1;
  private state: State = { levels: 10, showGrid: true, hasData: false };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.grid = [];
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.levels === 'number' && params.levels !== this.state.levels) {
      this.state.levels = Math.max(2, Math.min(40, Math.round(params.levels)));
      this.draw();
    }
    if (typeof params.showGrid === 'boolean' && params.showGrid !== this.state.showGrid) {
      this.state.showGrid = params.showGrid;
      this.draw();
    }
  }

  getParams(): ParamDefinition[] {
    return [
      { key: 'levels', label: 'Contour Levels', labelI18n: { 'zh-CN': '等值线数量', 'en-US': 'Contour Levels' }, type: 'range', min: 2, max: 30, step: 1, value: this.state.levels },
      { key: 'showGrid', label: 'Grid Lines', labelI18n: { 'zh-CN': '网格线', 'en-US': 'Grid Lines' }, type: 'checkbox', value: this.state.showGrid },
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      // Match the other data plugins: a malformed file must not produce an
      // unhandled rejection in the host's dispatchFile().
      this.api.notify('warning', this.api.locale === 'zh-CN' ? '无法解析网格文件（JSON）' : 'Could not parse grid file (JSON)');
      return;
    }
    const rows = normalizeGrid(parsed);
    if (rows.length < 2 || rows[0]!.length < 2) {
      this.api.notify('warning', this.api.locale === 'zh-CN' ? '需要二维数值网格' : 'Expected a 2-D numeric grid');
      return;
    }
    this.grid = rows;
    this.state.hasData = true;
    let min = Infinity;
    let max = -Infinity;
    for (const row of rows) {
      for (const v of row) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    this.min = min;
    this.max = max;
    this.api.reportDataScale(rows.length * (rows[0]?.length ?? 0));
    this.draw();
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 400;
    canvas.height = canvas.clientHeight || 300;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    if (!this.state.hasData || this.grid.length === 0) {
      this.drawEmpty(g, canvas);
      return;
    }

    this.drawRamp(g, canvas);
    this.drawContours(g, canvas);
    if (this.state.showGrid) this.drawGrid(g, canvas);
  }

  private drawEmpty(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    const msg =
      this.api.locale === 'zh-CN'
        ? '未加载场数据 — 从「示例数据」加载涡旋场'
        : 'No field data — load the vortex field from sample data';
    g.fillText(msg, canvas.width / 2, canvas.height / 2);
  }

  /** Per-pixel viridis ramp from the grid (bilinear sampling). */
  private drawRamp(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const rows = this.grid.length;
    const cols = this.grid[0]!.length;
    const w = canvas.width;
    const h = canvas.height;
    const img = g.createImageData(w, h);
    const span = Math.max(this.max - this.min, 1e-9);
    const sample = (fx: number, fy: number): number => {
      const x = fx * (cols - 1);
      const y = fy * (rows - 1);
      const x0 = Math.min(cols - 2, Math.floor(x));
      const y0 = Math.min(rows - 2, Math.floor(y));
      const tx = x - x0;
      const ty = y - y0;
      const v00 = this.grid[y0]![x0]!;
      const v10 = this.grid[y0]![x0 + 1]!;
      const v01 = this.grid[y0 + 1]![x0]!;
      const v11 = this.grid[y0 + 1]![x0 + 1]!;
      const a = v00 + (v10 - v00) * tx;
      const b = v01 + (v11 - v01) * tx;
      return a + (b - a) * ty;
    };
    for (let py = 0; py < h; py += 1) {
      for (let px = 0; px < w; px += 1) {
        // Sample row 0 at the top (py=0), matching the contour/row orientation
        // in drawContours — the old `1 - py/h` flipped the ramp vertically.
        const t = (sample(px / w, py / h) - this.min) / span;
        const c = viridis(t);
        const o = (py * w + px) * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }

  /** Marching-squares contour lines for each level. */
  private drawContours(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const rows = this.grid.length;
    const cols = this.grid[0]!.length;
    const w = canvas.width;
    const h = canvas.height;
    const pad = 0;
    const cellW = (w - pad * 2) / (cols - 1);
    const cellH = (h - pad * 2) / (rows - 1);
    const span = Math.max(this.max - this.min, 1e-9);
    const at = (i: number, j: number) => this.grid[j]![i]!;

    g.lineWidth = 1;
    g.strokeStyle = 'rgba(20, 26, 34, 0.75)';
    g.beginPath();
    for (let k = 1; k <= this.state.levels; k += 1) {
      const level = this.min + (span * k) / (this.state.levels + 1);
      for (let j = 0; j < rows - 1; j += 1) {
        for (let i = 0; i < cols - 1; i += 1) {
          const a = at(i, j);
          const b = at(i + 1, j);
          const c = at(i + 1, j + 1);
          const d = at(i, j + 1);
          // Crossing points on the four cell edges.
          const x0 = pad + i * cellW;
          const y0 = pad + j * cellH;
          const x1 = x0 + cellW;
          const y1 = y0 + cellH;
          const p: number[] = [];
          const interp = (va: number, vb: number, xa: number, ya: number, xb: number, yb: number) => {
            const t = (level - va) / (vb - va);
            p.push(xa + (xb - xa) * t, ya + (yb - ya) * t);
          };
          if ((a >= level) !== (b >= level)) interp(a, b, x0, y0, x1, y0);
          if ((b >= level) !== (c >= level)) interp(b, c, x1, y0, x1, y1);
          if ((c >= level) !== (d >= level)) interp(c, d, x1, y1, x0, y1);
          if ((d >= level) !== (a >= level)) interp(d, a, x0, y1, x0, y0);
          if (p.length === 4) {
            // Saddle: draw both crossing pairs.
            g.moveTo(p[0]!, p[1]!);
            g.lineTo(p[2]!, p[3]!);
            g.moveTo(p[4]!, p[5]!);
            g.lineTo(p[6]!, p[7]!);
          } else if (p.length === 2) {
            g.moveTo(p[0]!, p[1]!);
            g.lineTo(p[2]!, p[3]!);
          }
        }
      }
    }
    g.stroke();
  }

  private drawGrid(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const rows = this.grid.length;
    const cols = this.grid[0]!.length;
    const w = canvas.width;
    const h = canvas.height;
    g.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < cols; i += 1) {
      const x = (i / (cols - 1)) * w;
      g.moveTo(x, 0);
      g.lineTo(x, h);
    }
    for (let j = 0; j < rows; j += 1) {
      const y = (j / (rows - 1)) * h;
      g.moveTo(0, y);
      g.lineTo(w, y);
    }
    g.stroke();
  }
}

/**
 * Accept `number[][]`, `{ values: number[][] }` or `{ data: { values } }`.
 * Returns an empty array for anything that is not a finite numeric grid.
 */
export function normalizeGrid(parsed: unknown): number[][] {
  let node: unknown = parsed;
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.values)) node = obj.values;
    else if (obj.data && typeof obj.data === 'object') {
      const data = obj.data as Record<string, unknown>;
      if (Array.isArray(data.values)) node = data.values;
    }
  }
  if (!Array.isArray(node)) return [];
  const rows = node as unknown[][];
  const grid: number[][] = [];
  let width = -1;
  for (const row of rows.slice(0, MAX_GRID)) {
    if (!Array.isArray(row)) return [];
    const nums = row.slice(0, MAX_GRID).map((v) => Number(v));
    if (nums.some((v) => !Number.isFinite(v))) return [];
    if (width === -1) width = nums.length;
    if (nums.length !== width) return []; // ragged rows are not a valid grid
    grid.push(nums);
  }
  return grid;
}

export default function createContourPlugin(): Plugin {
  return new ContourPlugin();
}
