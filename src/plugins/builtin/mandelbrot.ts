// ==========================================================================
// Fun plugin: Mandelbrot / Julia fractal explorer (分形浏览器)
//
// A lightweight escape-time fractal toy. Pure Canvas 2D, no data dependency.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';

export const mandelbrotManifest: PluginManifest = {
  id: 'fun.mandelbrot',
  name: 'Fractal Explorer',
  nameI18n: { 'zh-CN': '分形浏览器', 'en-US': 'Fractal Explorer' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Mandelbrot & Julia set explorer with color palettes.',
  descriptionI18n: {
    'zh-CN': '曼德博集与茱莉亚集浏览器，支持多种配色方案与缩放。',
    'en-US': 'Explore the Mandelbrot and Julia sets with several color palettes and zoom.',
  },
  license: 'MIT',
  entry: 'fun.mandelbrot',
  category: 'fun',
  icon: '◉',
};

type Palette = 'fire' | 'ice' | 'rainbow' | 'grayscale';

interface State {
  mode: 'mandelbrot' | 'julia';
  iterations: number;
  zoom: number;
  palette: Palette;
  juliaX: number;
  juliaY: number;
}

const MAX_W = 480;

function colorize(palette: Palette, t: number): [number, number, number] {
  const u = Math.max(0, Math.min(1, t));
  switch (palette) {
    case 'fire': {
      const r = Math.min(255, u * 3 * 255);
      const g = Math.min(255, Math.max(0, (u - 0.33) * 3 * 255));
      const b = Math.min(255, Math.max(0, (u - 0.66) * 3 * 255));
      return [r, g, b];
    }
    case 'ice': {
      const r = Math.min(255, Math.max(0, (u - 0.6) * 3 * 255));
      const g = Math.min(255, u * 2.2 * 255);
      const b = Math.min(255, (0.4 + u * 0.6) * 255);
      return [r, g, b];
    }
    case 'grayscale':
      return [u * 255, u * 255, u * 255];
    case 'rainbow':
    default: {
      const h = (1 - u) * 300;
      return hslToRgb(h, 0.85, 0.55);
    }
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export class MandelbrotPlugin implements Plugin {
  readonly manifest = mandelbrotManifest;
  private ctx: ContainerCapabilities | null = null;
  private state: State = {
    mode: 'mandelbrot',
    iterations: 200,
    zoom: 1,
    palette: 'rainbow',
    juliaX: -0.8,
    juliaY: 0.156,
  };

  async init(_api: PluginApi) {
  }

  async destroy() {
    this.ctx = null;
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
    let changed = false;
    if (params.mode === 'mandelbrot' || params.mode === 'julia') {
      if (params.mode !== this.state.mode) {
        this.state.mode = params.mode;
        changed = true;
      }
    }
    if (typeof params.iterations === 'number') {
      const v = Math.max(20, Math.min(800, Math.round(params.iterations)));
      if (v !== this.state.iterations) {
        this.state.iterations = v;
        changed = true;
      }
    }
    if (typeof params.zoom === 'number') {
      const v = Math.max(1, Math.min(60, params.zoom));
      if (v !== this.state.zoom) {
        this.state.zoom = v;
        changed = true;
      }
    }
    if (params.palette === 'fire' || params.palette === 'ice' || params.palette === 'rainbow' || params.palette === 'grayscale') {
      if (params.palette !== this.state.palette) {
        this.state.palette = params.palette;
        changed = true;
      }
    }
    if (typeof params.juliaX === 'number') this.state.juliaX = params.juliaX;
    if (typeof params.juliaY === 'number') this.state.juliaY = params.juliaY;
    if (changed) this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { 'zh-CN': '模式', 'en-US': 'Mode' },
        type: 'select',
        options: [
          { value: 'mandelbrot', label: 'Mandelbrot', labelI18n: { 'zh-CN': '曼德博集', 'en-US': 'Mandelbrot' } },
          { value: 'julia', label: 'Julia', labelI18n: { 'zh-CN': '茱莉亚集', 'en-US': 'Julia' } },
        ],
        value: this.state.mode,
      },
      {
        key: 'iterations',
        label: 'Iterations',
        labelI18n: { 'zh-CN': '迭代次数', 'en-US': 'Iterations' },
        type: 'range',
        min: 20,
        max: 800,
        step: 10,
        value: this.state.iterations,
      },
      {
        key: 'zoom',
        label: 'Zoom',
        labelI18n: { 'zh-CN': '缩放', 'en-US': 'Zoom' },
        type: 'range',
        min: 1,
        max: 60,
        step: 1,
        value: this.state.zoom,
      },
      {
        key: 'palette',
        label: 'Palette',
        labelI18n: { 'zh-CN': '配色', 'en-US': 'Palette' },
        type: 'select',
        options: [
          { value: 'rainbow', label: 'Rainbow' },
          { value: 'fire', label: 'Fire' },
          { value: 'ice', label: 'Ice' },
          { value: 'grayscale', label: 'Grayscale' },
        ],
        value: this.state.palette,
      },
      {
        key: 'juliaX',
        label: 'Julia c.re',
        labelI18n: { 'zh-CN': '茱莉亚 c.re', 'en-US': 'Julia c.re' },
        type: 'number',
        min: -2,
        max: 2,
        step: 0.01,
        value: this.state.juliaX,
      },
      {
        key: 'juliaY',
        label: 'Julia c.im',
        labelI18n: { 'zh-CN': '茱莉亚 c.im', 'en-US': 'Julia c.im' },
        type: 'number',
        min: -2,
        max: 2,
        step: 0.01,
        value: this.state.juliaY,
      },
    ];
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const w = canvas.width = Math.min(canvas.clientWidth || 480, 720);
    const h = canvas.height = canvas.clientHeight || 360;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = '#0a0e13';
    g.fillRect(0, 0, w, h);

    const cw = Math.min(w, MAX_W);
    const scale = cw / w;
    const ch = Math.round(h * scale);
    const img = g.createImageData(cw, ch);
    const data = img.data;

    const maxIter = this.state.iterations;
    const zoom = this.state.zoom;
    const cx0 = this.state.mode === 'mandelbrot' ? -0.5 : 0;
    const cy0 = 0;
    const spanY = 2.4 / zoom;
    const spanX = (spanY * cw) / ch;

    const juliaCx = this.state.juliaX;
    const juliaCy = this.state.juliaY;

    for (let py = 0; py < ch; py += 1) {
      for (let px = 0; px < cw; px += 1) {
        let zx: number;
        let zy: number;
        let cx: number;
        let cy: number;
        if (this.state.mode === 'mandelbrot') {
          cx = cx0 + (px / cw - 0.5) * spanX;
          cy = cy0 + (py / ch - 0.5) * spanY;
          zx = 0;
          zy = 0;
        } else {
          cx = juliaCx;
          cy = juliaCy;
          zx = cx0 + (px / cw - 0.5) * spanX;
          zy = cy0 + (py / ch - 0.5) * spanY;
        }
        let iter = 0;
        let zx2 = zx * zx;
        let zy2 = zy * zy;
        while (zx2 + zy2 <= 4 && iter < maxIter) {
          zy = 2 * zx * zy + cy;
          zx = zx2 - zy2 + cx;
          zx2 = zx * zx;
          zy2 = zy * zy;
          iter += 1;
        }
        const idx = (py * cw + px) * 4;
        if (iter >= maxIter) {
          data[idx] = 8;
          data[idx + 1] = 10;
          data[idx + 2] = 14;
          data[idx + 3] = 255;
        } else {
          const logZn = Math.log(zx2 + zy2) / 2;
          const nu = Math.log(logZn / Math.LN2) / Math.LN2;
          const t = (iter + 1 - nu) / maxIter;
          const [r, gg, b] = colorize(this.state.palette, t);
          data[idx] = r;
          data[idx + 1] = gg;
          data[idx + 2] = b;
          data[idx + 3] = 255;
        }
      }
    }

    // Draw the computed buffer scaled to the display canvas.
    const off = document.createElement('canvas');
    off.width = cw;
    off.height = ch;
    off.getContext('2d')?.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(off, 0, 0, w, h);
  }
}

export default function createMandelbrotPlugin(): Plugin {
  return new MandelbrotPlugin();
}
