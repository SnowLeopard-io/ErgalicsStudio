// ==========================================================================
// Example plugin: Point Cloud Viewer
// Renders .xyz point clouds onto a 2D canvas with basic params.
// Auto-fits the loaded point bounds, and shows a helpful empty state when
// no data has been loaded yet.
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

export const pointCloudManifest: PluginManifest = {
  id: 'example.point-cloud',
  name: 'Point Cloud',
  nameI18n: { 'zh-CN': '点云查看器', 'en-US': 'Point Cloud' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Render .xyz point clouds with adjustable point size.',
  descriptionI18n: {
    'zh-CN': '渲染 .xyz 点云文件，可调节点大小与颜色。',
    'en-US': 'Render .xyz point clouds with adjustable point size.',
  },
  license: 'MIT',
  entry: 'example.point-cloud',
  formats: [
    { extension: '.xyz', mimeTypes: ['text/plain', 'chemical/x-xyz'], description: 'Point cloud' },
  ],
};

interface Point {
  x: number;
  y: number;
}

interface State {
  points: Point[];
  size: number;
  color: string;
}

export class PointCloudPlugin implements Plugin {
  readonly manifest = pointCloudManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { points: [], size: 2, color: '#2563eb' };

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
    if (typeof params.size === 'number') this.state.size = params.size;
    if (typeof params.color === 'string') this.state.color = params.color;
    if (params.reset && (params.reset as { action?: string }).action === 'reset') {
      // auto-fit re-centers on every draw, so reset just re-renders.
    }
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      { key: 'size', label: 'Size', type: 'range', min: 1, max: 20, step: 1, value: this.state.size },
      { key: 'color', label: 'Color', type: 'text', value: this.state.color },
      { key: 'reset', label: 'Reset View', type: 'button', action: 'reset' },
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const points: Point[] = [];
    const lines = text.split(/\r?\n/).slice(0, 200_000);
    for (const line of lines) {
      const parts = line.trim().split(/[\s,]+/);
      if (parts.length >= 2) {
        const x = parseFloat(parts[0] ?? '');
        const y = parseFloat(parts[1] ?? '');
        if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
      }
    }
    this.state.points = points;
    this.api.reportDataScale(points.length);
    this.draw();
  }

  async compute(_input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult> {
    const total = 10;
    for (let i = 0; i < total; i += 1) {
      await new Promise((r) => setTimeout(r, 30));
      onProgress?.({ done: i + 1, total });
    }
    return { ok: true, output: { processed: this.state.points.length } };
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

    if (this.state.points.length === 0) {
      this.drawGrid(g, canvas);
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      const msg =
        this.api.locale === 'zh-CN'
          ? '未加载点云 — 拖入 .xyz 文件或从「示例数据」加载'
          : 'No point cloud — drop a .xyz file or load sample data';
      g.fillText(msg, canvas.width / 2, canvas.height / 2 - 8);
      return;
    }

    // Auto-fit the data bounds into the viewport.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of this.state.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const w = canvas.width;
    const h = canvas.height;
    const pad = 0.12;
    const scale = Math.min(w / (rangeX * (1 + pad * 2)), h / (rangeY * (1 + pad * 2)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const ox = w / 2 - cx * scale;
    const oy = h / 2 + cy * scale; // flip Y so +y points up

    g.fillStyle = this.state.color;
    const step = Math.max(1, Math.floor(this.state.points.length / 20_000));
    const size = Math.max(1, this.state.size);
    for (let i = 0; i < this.state.points.length; i += step) {
      const p = this.state.points[i];
      if (!p) continue;
      const sx = ox + p.x * scale;
      const sy = oy - p.y * scale;
      g.fillRect(sx - size / 2, sy - size / 2, size, size);
    }
  }

  private drawGrid(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    g.strokeStyle = 'rgba(127, 140, 160, 0.08)';
    g.lineWidth = 1;
    const step = 48;
    g.beginPath();
    for (let x = 0.5; x < canvas.width; x += step) {
      g.moveTo(x, 0);
      g.lineTo(x, canvas.height);
    }
    for (let y = 0.5; y < canvas.height; y += step) {
      g.moveTo(0, y);
      g.lineTo(canvas.width, y);
    }
    g.stroke();
  }
}

export default function createPointCloudPlugin(): Plugin {
  return new PointCloudPlugin();
}