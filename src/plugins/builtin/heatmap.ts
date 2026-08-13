// ==========================================================================
// Example plugin: Heatmap
// Loads a 2-D numeric grid from JSON (array of rows) and renders it as a
// heatmap with selectable color ramps, using ImageData for speed.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
  ComputeProgress,
  ComputeResult,
} from '@/types/plugin';

export const heatmapManifest: PluginManifest = {
  id: 'example.heatmap',
  name: 'Heatmap',
  nameI18n: { 'zh-CN': '热力图', 'en-US': 'Heatmap' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Visualize a 2-D numeric field as a heatmap.',
  descriptionI18n: {
    'zh-CN': '将二维数值网格（JSON 矩阵）渲染为热力图。',
    'en-US': 'Visualize a 2-D numeric field as a heatmap.',
  },
  license: 'MIT',
  entry: 'example.heatmap',
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: '2-D numeric grid' },
  ],
};

interface State {
  grid: number[][];
  palette: string;
  gridlines: boolean;
}

const COLORMAPS: Record<string, (t: number) => [number, number, number]> = {
  teal: (t) => {
    // dark -> teal -> white-hot
    if (t < 0.5) {
      const k = t * 2;
      return [Math.round(6 + k * 39), Math.round(10 + k * 180), Math.round(14 + k * 159)];
    }
    const k = (t - 0.5) * 2;
    return [Math.round(45 + k * 210), Math.round(212 + k * 43), Math.round(191 + k * 64)];
  },
  viridis: (t) => {
    const stops: [number, [number, number, number]][] = [
      [0, [68, 1, 84]],
      [0.25, [59, 82, 139]],
      [0.5, [33, 145, 140]],
      [0.75, [94, 201, 98]],
      [1, [253, 231, 37]],
    ];
    for (let i = 0; i < stops.length - 1; i += 1) {
      const [t0, c0] = stops[i]!;
      const [t1, c1] = stops[i + 1]!;
      if (t >= t0 && t <= t1) {
        const k = (t - t0) / (t1 - t0 || 1);
        return [
          Math.round(c0[0] + (c1[0] - c0[0]) * k),
          Math.round(c0[1] + (c1[1] - c0[1]) * k),
          Math.round(c0[2] + (c1[2] - c0[2]) * k),
        ];
      }
    }
    return stops[stops.length - 1]![1];
  },
  thermal: (t) => {
    const k = Math.max(0, Math.min(1, t));
    return [Math.round(255 * k), Math.round(120 * k * k), Math.round(40 * k * k * k)];
  },
  gray: (t) => {
    const v = Math.round(t * 255);
    return [v, v, v];
  },
};

export class HeatmapPlugin implements Plugin {
  readonly manifest = heatmapManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { grid: [], palette: 'viridis', gridlines: false };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.ctx = null;
  }

  async render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.palette === 'string') this.state.palette = params.palette;
    if (typeof params.gridlines === 'boolean') this.state.gridlines = params.gridlines;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'palette',
        label: 'Palette',
        type: 'select',
        value: this.state.palette,
        options: [
          { value: 'viridis', label: 'Viridis' },
          { value: 'teal', label: 'Teal', labelI18n: { 'zh-CN': '青绿', 'en-US': 'Teal' } },
          { value: 'thermal', label: 'Thermal', labelI18n: { 'zh-CN': '热感', 'en-US': 'Thermal' } },
          { value: 'gray', label: 'Gray', labelI18n: { 'zh-CN': '灰度', 'en-US': 'Gray' } },
        ],
      },
      { key: 'gridlines', label: 'Gridlines', type: 'checkbox', value: this.state.gridlines },
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.api.notify('error', this.api.locale === 'zh-CN' ? '不是有效的 JSON' : 'Invalid JSON');
      return;
    }
    if (!Array.isArray(parsed) || parsed.length === 0 || !Array.isArray(parsed[0])) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN' ? 'JSON 应为二维数值数组' : 'JSON should be a 2-D numeric array',
      );
      return;
    }
    const grid: number[][] = [];
    let rows = 0;
    for (const row of parsed) {
      if (!Array.isArray(row)) continue;
      const nums = row
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v));
      if (nums.length > 0) {
        grid.push(nums);
        rows += 1;
      }
    }
    if (rows < 2 || grid[0]!.length < 2) {
      this.api.notify('warning', this.api.locale === 'zh-CN' ? '网格至少需要 2×2' : 'Grid must be at least 2x2');
      return;
    }
    this.state.grid = grid;
    this.api.reportDataScale(grid.length * grid[0]!.length);
    this.draw();
  }

  async compute(_input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult> {
    const total = 8;
    for (let i = 0; i < total; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      onProgress?.({ done: i + 1, total });
    }
    if (this.state.grid.length === 0) return { ok: false, error: 'no data' };
    let min = Infinity;
    let max = -Infinity;
    for (const row of this.state.grid) {
      for (const v of row) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    return {
      ok: true,
      output: {
        rows: this.state.grid.length,
        cols: this.state.grid[0]!.length,
        min,
        max,
      },
    };
  }

  private draw() {
    if (!this.ctx?.canvas2d) return;
    const canvas = this.ctx.canvas2d;
    canvas.width = canvas.clientWidth || 400;
    canvas.height = canvas.clientHeight || 300;
    const g = canvas.getContext('2d');
    if (!g) return;
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);

    const grid = this.state.grid;
    if (grid.length === 0) {
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      const msg =
        this.api.locale === 'zh-CN'
          ? '未加载数据 — 拖入 JSON 矩阵或打开「示例数据」'
          : 'No data — drop a JSON matrix or load sample data';
      g.fillText(msg, canvas.width / 2, canvas.height / 2);
      return;
    }

    const rows = grid.length;
    const cols = grid[0]!.length;
    let min = Infinity;
    let max = -Infinity;
    for (const row of grid) {
      for (const v of row) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const span = max - min || 1;
    const map = COLORMAPS[this.state.palette] ?? COLORMAPS.viridis;

    const pad = 8;

    const img = g.createImageData(cols, rows);
    let pi = 0;
    for (let y = 0; y < rows; y += 1) {
      const row = grid[y]!;
      for (let x = 0; x < cols; x += 1) {
        const v = row[x] ?? min;
        const [r, gg, b] = (map as (t: number) => [number, number, number])((v - min) / span);
        img.data[pi] = r;
        img.data[pi + 1] = gg;
        img.data[pi + 2] = b;
        img.data[pi + 3] = 255;
        pi += 4;
      }
    }

    g.imageSmoothingEnabled = false;
    g.putImageData(img, 0, 0, 0, 0, cols, rows);
    // scale the low-res heatmap up to the full canvas
    const scaled = document.createElement('canvas');
    scaled.width = cols;
    scaled.height = rows;
    const sg = scaled.getContext('2d')!;
    sg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(scaled, 0, 0, cols, rows, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2);

    if (this.state.gridlines) {
      g.strokeStyle = 'rgba(0, 0, 0, 0.25)';
      g.lineWidth = 1;
      const sx = (canvas.width - pad * 2) / cols;
      const sy = (canvas.height - pad * 2) / rows;
      g.beginPath();
      for (let x = 0; x <= cols; x += 1) {
        g.moveTo(pad + x * sx, pad);
        g.lineTo(pad + x * sx, canvas.height - pad);
      }
      for (let y = 0; y <= rows; y += 1) {
        g.moveTo(pad, pad + y * sy);
        g.lineTo(canvas.width - pad, pad + y * sy);
      }
      g.stroke();
    }
  }
}

export default function createHeatmapPlugin(): Plugin {
  return new HeatmapPlugin();
}