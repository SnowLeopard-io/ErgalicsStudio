// ==========================================================================
// Example plugin: Treemap (矩形树图)
//
// Renders a squarified-style treemap from CSV:
//   label,size          (flat — one tile per row)
//   label,parent,size   (hierarchical — empty parent = root)
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';

export const treemapManifest: PluginManifest = {
  id: 'example.treemap',
  name: 'Treemap',
  nameI18n: { 'zh-CN': '矩形树图', 'en-US': 'Treemap' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Hierarchical rectangle layout sized by value.',
  descriptionI18n: {
    'zh-CN': '用嵌套矩形展示层级数据，矩形面积与数值成正比。',
    'en-US': 'Nested rectangles whose area is proportional to value; hierarchical data.',
  },
  license: 'MIT',
  entry: 'example.treemap',
  category: 'scientific',
  icon: '▦',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV (label,size | label,parent,size)' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text' },
  ],
};

interface TNode {
  name: string;
  size: number;
  depth: number;
  children: TNode[];
  index: number;
}

interface State {
  showLabels: boolean;
  hasData: boolean;
}

const MAX_NODES = 4_000;

export class TreemapPlugin implements Plugin {
  readonly manifest = treemapManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private root: TNode | null = null;
  private leafCount = 0;
  private state: State = { showLabels: true, hasData: false };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.root = null;
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
    if (typeof params.showLabels === 'boolean') this.state.showLabels = params.showLabels;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'showLabels',
        label: 'Labels',
        labelI18n: { 'zh-CN': '显示标签', 'en-US': 'Labels' },
        type: 'checkbox',
        value: this.state.showLabels,
      },
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const root = parseTreemapData(text);
    if (!root) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '未找到有效的 label,size 数据'
          : 'No valid label,size data found',
      );
      return;
    }
    this.root = root;
    this.state.hasData = true;
    this.leafCount = countLeaves(root);
    this.api.reportDataScale(this.leafCount);
    this.draw();
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const w = canvas.width = canvas.clientWidth || 480;
    const h = canvas.height = canvas.clientHeight || 360;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, w, h);

    if (!this.state.hasData || !this.root) {
      this.drawEmpty(g, w, h);
      return;
    }

    // Colors by depth, alternating hue families.
    const depthColors = ['#1e293b', '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#22d3ee'];
    const layout: Array<{ node: TNode; x: number; y: number; w: number; h: number }> = [];
    collectLayout(this.root, 0, 0, w, h, layout, 0);

    for (const r of layout) {
      const d = Math.min(r.node.depth, depthColors.length - 1);
      const base = depthColors[d]!;
      // Vary lightness slightly per sibling index so adjacent tiles differ.
      const light = 82 + (r.node.index % 5) * 6;
      g.fillStyle = shade(base, light);
      g.fillRect(r.x, r.y, r.w, r.h);
      g.strokeStyle = 'rgba(10, 14, 19, 0.9)';
      g.lineWidth = 1;
      g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }

    if (this.state.showLabels) {
      g.font = `10px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      for (const r of layout) {
        if (r.w < 46 || r.h < 18) continue;
        g.fillStyle = 'rgba(240, 246, 252, 0.92)';
        const label = r.node.name.slice(0, Math.max(1, Math.floor(r.w / 7)));
        g.fillText(label, r.x + 5, r.y + 5, r.w - 10);
      }
      g.textBaseline = 'alphabetic';
    }
  }

  private drawEmpty(g: CanvasRenderingContext2D, w: number, h: number) {
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    const msg =
      this.api.locale === 'zh-CN'
        ? '未加载树图数据 — 拖入 .csv (label,size) 文件'
        : 'No treemap data — drop a .csv (label,size) file';
    g.fillText(msg, w / 2, h / 2);
  }
}

/** Parse CSV into a hierarchy; flat `label,size` becomes a single root layer. */
export function parseTreemapData(text: string): TNode | null {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const sep = lines[0]!.includes(',') ? ',' : /\s+/;
  const firstTokens = lines[0]!.split(sep).map((t) => t.trim());
  const firstNumeric = Number.isFinite(Number(firstTokens[0]));
  const start = firstNumeric ? 0 : 1;
  const hasParent = lines[start]!.split(sep).length >= 3;

  const byName = new Map<string, TNode>();
  let count = 0;
  const root: TNode = { name: 'root', size: 0, depth: 0, children: [], index: 0 };

  const ensure = (name: string): TNode => {
    let n = byName.get(name);
    if (!n) {
      n = { name, size: 0, depth: 0, children: [], index: 0 };
      byName.set(name, n);
    }
    return n;
  };

  for (let i = start; i < lines.length; i += 1) {
    if (count >= MAX_NODES) break;
    const parts = lines[i]!.split(sep).map((p) => p.trim());
    if (parts.length < 2) continue;
    const size = Number(parts[parts.length - 1]!);

    if (hasParent) {
      const label = parts[0]!;
      const parent = parts[1]!;
      const node = ensure(label);
      // Directory rows may carry no own value (size 0) — still link them so
      // their children render; only add area when a positive size exists.
      if (Number.isFinite(size) && size > 0) node.size += size;
      const p = parent ? ensure(parent) : root;
      if (node !== p && !p.children.includes(node)) p.children.push(node);
      count += 1;
    } else {
      const label = parts[0]!;
      if (label && label !== 'label' && Number.isFinite(size) && size > 0) {
        const node = ensure(label);
        node.size += size;
        if (!root.children.includes(node)) root.children.push(node);
        count += 1;
      }
    }
  }

  // Build the real tree: only nodes reachable from root keep depth > 0.
  const depthOf = new Map<TNode, number>();
  const assign = (n: TNode, d: number) => {
    n.depth = d;
    depthOf.set(n, d);
    for (const c of n.children) assign(c, d + 1);
  };
  assign(root, 0);

  const realRoot = root.children.length > 0 ? root : null;
  if (!realRoot || realRoot.children.length === 0) return null;

  // Roll up: a parent's area is at least the sum of its children's, so
  // size-0 directory rows still give their subtrees visible area.
  const rollup = (n: TNode): number => {
    if (n.children.length === 0) return n.size;
    const sum = n.children.reduce((s, c) => s + rollup(c), 0);
    n.size = Math.max(n.size, sum);
    return n.size;
  };
  rollup(realRoot);

  // Normalize child indices.
  let idx = 0;
  const indexAll = (n: TNode) => {
    n.index = idx++;
    for (const c of n.children) indexAll(c);
  };
  indexAll(realRoot);
  return realRoot;
}

function countLeaves(n: TNode): number {
  if (n.children.length === 0) return 1;
  let c = 0;
  for (const ch of n.children) c += countLeaves(ch);
  return c;
}

/**
 * Slice-and-dice layout: split the longer side of the remaining box, tiles
 * sized by subtree weight. Simple, deterministic, good enough for a demo.
 */
function collectLayout(
  node: TNode,
  x: number,
  y: number,
  w: number,
  h: number,
  out: Array<{ node: TNode; x: number; y: number; w: number; h: number }>,
  level: number,
) {
  if (node.children.length === 0) {
    out.push({ node, x, y, w, h });
    return;
  }
  const total = node.children.reduce((s, c) => s + c.size, 0);
  if (total <= 0) {
    for (const c of node.children) collectLayout(c, x, y, w, h, out, level + 1);
    return;
  }
  const horizontal = w >= h;
  let acc = 0;
  for (const c of node.children) {
    const frac = c.size / total;
    if (horizontal) {
      const cw = w * frac;
      collectLayout(c, x + acc, y, cw, h, out, level + 1);
      acc += cw;
    } else {
      const ch = h * frac;
      collectLayout(c, x, y + acc, w, ch, out, level + 1);
      acc += ch;
    }
  }
}

/** Tint a hex color toward white by `amount` (0-100). */
function shade(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1]!, 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  const f = amount / 100;
  const mix = (c: number) => Math.round(c + (255 - c) * f);
  const hh = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${hh(mix(r))}${hh(mix(g))}${hh(mix(b))}`;
}

export default function createTreemapPlugin(): Plugin {
  return new TreemapPlugin();
}
