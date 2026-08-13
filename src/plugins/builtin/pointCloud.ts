// ==========================================================================
// Example plugin: Point Cloud Viewer
// Renders .xyz point clouds onto a 2D canvas with basic params.
// Demonstrates: manifest, formats, params, render, compute lifecycle.
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

interface State {
  points: { x: number; y: number }[];
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
    const points: { x: number; y: number }[] = [];
    const lines = text.split(/\r?\n/).slice(0, 50_000);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        points.push({ x: parseFloat(parts[0] ?? ''), y: parseFloat(parts[1] ?? '') });
      }
    }
    this.state.points = points;
    this.api.reportDataScale(points.length);
    this.draw();
  }

  async compute(_input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult> {
    // Simulated compute pass to demonstrate progress reporting.
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
    const bg = getComputedStyle(canvas).backgroundColor || '#0c0e11';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = this.state.color;
    const step = Math.max(1, Math.floor(this.state.points.length / 20_000));
    for (let i = 0; i < this.state.points.length; i += step) {
      const p = this.state.points[i];
      if (!p) continue;
      const x = ((p.x + 10) / 20) * canvas.width;
      const y = ((p.y + 10) / 20) * canvas.height;
      g.fillRect(x, y, this.state.size, this.state.size);
    }
  }
}

export default function createPointCloudPlugin(): Plugin {
  return new PointCloudPlugin();
}
