// ==========================================================================
// Example plugin: Image Viewer
// Loads raster images (.png/.jpg/.jpeg/.webp/.gif) and renders them fitted
// to the viewport with selectable fit modes.
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

export const imageViewerManifest: PluginManifest = {
  id: 'example.image',
  name: 'Image Viewer',
  nameI18n: { 'zh-CN': '图像查看器', 'en-US': 'Image Viewer' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'View raster images with fit modes.',
  descriptionI18n: {
    'zh-CN': '加载并查看图片文件（PNG/JPEG/WebP/GIF）。',
    'en-US': 'View raster images (PNG/JPEG/WebP/GIF).',
  },
  license: 'MIT',
  entry: 'example.image',
  formats: [
    { extension: '.png', mimeTypes: ['image/png'], description: 'PNG' },
    { extension: '.jpg', mimeTypes: ['image/jpeg'], description: 'JPEG' },
    { extension: '.jpeg', mimeTypes: ['image/jpeg'], description: 'JPEG' },
    { extension: '.webp', mimeTypes: ['image/webp'], description: 'WebP' },
    { extension: '.gif', mimeTypes: ['image/gif'], description: 'GIF' },
  ],
};

interface State {
  image: HTMLImageElement | null;
  filename: string;
  mode: string;
  grid: boolean;
}

export class ImageViewerPlugin implements Plugin {
  readonly manifest = imageViewerManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { image: null, filename: '', mode: 'contain', grid: false };
  private objectUrl: string | null = null;
  /** Monotonic token so a slow decode can't clobber a newer loadData(). */
  private loadSeq = 0;

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.release();
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
    if (typeof params.mode === 'string') this.state.mode = params.mode;
    if (typeof params.grid === 'boolean') this.state.grid = params.grid;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'mode',
        label: 'Fit',
        type: 'select',
        value: this.state.mode,
        options: [
          { value: 'contain', label: 'Contain', labelI18n: { 'zh-CN': '适应', 'en-US': 'Contain' } },
          { value: 'cover', label: 'Cover', labelI18n: { 'zh-CN': '填充', 'en-US': 'Cover' } },
          { value: 'stretch', label: 'Stretch', labelI18n: { 'zh-CN': '拉伸', 'en-US': 'Stretch' } },
        ],
      },
      { key: 'grid', label: 'Gridlines', type: 'checkbox', value: this.state.grid },
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    if (!file.type.startsWith('image/')) {
      this.api.notify('warning', this.api.locale === 'zh-CN' ? '不是图片文件' : 'Not an image file');
      return;
    }
    const seq = ++this.loadSeq;
    // Each load owns its own object URL and only publishes state if it is
    // still the latest request. Previously a stale decode (or the shared
    // release()) could revoke the *newer* load's URL or overwrite its state.
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('decode failed'));
        image.src = objectUrl;
      });
    } catch {
      URL.revokeObjectURL(objectUrl);
      if (seq === this.loadSeq) {
        this.api.notify('error', this.api.locale === 'zh-CN' ? '图片解码失败' : 'Image decode failed');
        this.release();
      }
      return;
    }
    if (seq !== this.loadSeq) {
      // A newer load started while we were decoding — discard this one.
      URL.revokeObjectURL(objectUrl);
      return;
    }
    this.release();
    this.objectUrl = objectUrl;
    this.state.image = image;
    this.state.filename = file.name;
    this.api.reportDataScale(image.naturalWidth * image.naturalHeight);
    this.draw();
  }

  async compute(_input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult> {
    const total = 4;
    for (let i = 0; i < total; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      onProgress?.({ done: i + 1, total });
    }
    const img = this.state.image;
    return img
      ? { ok: true, output: { width: img.naturalWidth, height: img.naturalHeight, name: this.state.filename } }
      : { ok: false, error: 'no image' };
  }

  private release() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.state.image = null;
    this.state.filename = '';
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

    const img = this.state.image;
    if (!img) {
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      const msg =
        this.api.locale === 'zh-CN'
          ? '未加载图片 — 拖入图片文件或打开「示例数据」'
          : 'No image — drop an image file or load sample data';
      g.fillText(msg, canvas.width / 2, canvas.height / 2);
      return;
    }

    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const cw = canvas.width;
    const ch = canvas.height;
    const pad = 12;
    let dw = iw;
    let dh = ih;
    if (this.state.mode === 'contain') {
      const s = Math.min((cw - pad * 2) / iw, (ch - pad * 2) / ih);
      dw = iw * s;
      dh = ih * s;
    } else if (this.state.mode === 'cover') {
      const s = Math.max((cw - pad * 2) / iw, (ch - pad * 2) / ih);
      dw = iw * s;
      dh = ih * s;
    } else {
      dw = cw - pad * 2;
      dh = ch - pad * 2;
    }
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;

    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, dx, dy, dw, dh);

    if (this.state.grid) {
      g.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      g.lineWidth = 1;
      const step = 24;
      g.beginPath();
      for (let x = dx; x <= dx + dw; x += step) {
        g.moveTo(x, dy);
        g.lineTo(x, dy + dh);
      }
      for (let y = dy; y <= dy + dh; y += step) {
        g.moveTo(dx, y);
        g.lineTo(dx + dw, y);
      }
      g.stroke();
    }

    g.textAlign = 'left';
    g.font = `11px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(200, 214, 228, 0.8)';
    g.fillText(`${this.state.filename} · ${iw}×${ih}`, dx, dy + dh + 13);
  }
}

export default function createImageViewerPlugin(): Plugin {
  return new ImageViewerPlugin();
}