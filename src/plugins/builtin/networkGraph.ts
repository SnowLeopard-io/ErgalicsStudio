// ==========================================================================
// Example plugin: Network Graph (网络图)
//
// Force-directed graph from edge-list data. Accepts .csv/.dat/.json with
// "source,target,weight" or JSON {nodes:[], links:[]} format. Renders an
// animated force layout on Canvas 2D.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';

export const networkGraphManifest: PluginManifest = {
  id: 'example.network',
  name: 'Network Graph',
  nameI18n: { 'zh-CN': '网络图', 'en-US': 'Network Graph' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Force-directed network graph from edge lists.',
  descriptionI18n: {
    'zh-CN': '从边列表数据渲染力导向网络图，支持节点大小、颜色与动画。',
    'en-US': 'Force-directed network graph from edge lists; animated layout with node sizing.',
  },
  license: 'MIT',
  entry: 'example.network',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV (source,target,weight)' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Edge list' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON graph' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text edge list' },
  ],
};

interface GNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
}

interface GEdge {
  source: string;
  target: string;
  weight: number;
}

interface State {
  linkDistance: number;
  showLabels: boolean;
  charge: number;
  hasData: boolean;
}

const MAX_NODES = 500;
const MAX_EDGES = 2000;

export class NetworkGraphPlugin implements Plugin {
  readonly manifest = networkGraphManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private nodes: GNode[] = [];
  private edges: GEdge[] = [];
  private state: State = { linkDistance: 60, showLabels: true, charge: 200, hasData: false };
  private raf = 0;

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.stopAnimation();
    this.ctx = null;
    this.nodes = [];
    this.edges = [];
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.stopAnimation();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
    if (this.state.hasData) this.startAnimation();
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.linkDistance === 'number') this.state.linkDistance = params.linkDistance;
    if (typeof params.showLabels === 'boolean') this.state.showLabels = params.showLabels;
    if (typeof params.charge === 'number') this.state.charge = params.charge;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'linkDistance',
        label: 'Link Distance',
        labelI18n: { 'zh-CN': '连线距离', 'en-US': 'Link Distance' },
        type: 'range',
        min: 20,
        max: 150,
        step: 1,
        value: this.state.linkDistance,
      },
      {
        key: 'charge',
        label: 'Repulsion',
        labelI18n: { 'zh-CN': '排斥力', 'en-US': 'Repulsion' },
        type: 'range',
        min: 50,
        max: 500,
        step: 10,
        value: this.state.charge,
      },
      {
        key: 'showLabels',
        label: 'Show Labels',
        labelI18n: { 'zh-CN': '显示标签', 'en-US': 'Show Labels' },
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
    const { nodes, edges } = parseNetwork(text);
    if (nodes.length < 2) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '未找到有效的网络数据（至少 2 个节点）'
          : 'No valid network data found (need at least 2 nodes)',
      );
      return;
    }
    this.nodes = nodes;
    this.edges = edges;
    this.state.hasData = true;
    this.api.reportDataScale(nodes.length);
    this.initPositions();
    this.draw();
    this.startAnimation();
  }

  private initPositions() {
    const canvas = this.ctx?.canvas2d;
    const w = canvas?.clientWidth ?? 400;
    const h = canvas?.clientHeight ?? 300;
    for (const node of this.nodes) {
      node.x = w / 2 + (Math.random() - 0.5) * w * 0.6;
      node.y = h / 2 + (Math.random() - 0.5) * h * 0.6;
      node.vx = 0;
      node.vy = 0;
    }
  }

  private tick() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const w = canvas.clientWidth || 400;
    const h = canvas.clientHeight || 300;
    const cx = w / 2;
    const cy = h / 2;
    const { linkDistance, charge } = this.state;

    // Repulsion (O(n^2), capped by MAX_NODES)
    for (let i = 0; i < this.nodes.length; i += 1) {
      const a = this.nodes[i]!;
      for (let j = i + 1; j < this.nodes.length; j += 1) {
        const b = this.nodes[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) dist = 1;
        const force = charge / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Attraction (springs along edges)
    const nodeMap = new Map(this.nodes.map((n) => [n.id, n]));
    for (const edge of this.edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) dist = 1;
      const force = (dist - linkDistance) * 0.05 * edge.weight;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Gravity to center
    for (const node of this.nodes) {
      node.vx += (cx - node.x) * 0.01;
      node.vy += (cy - node.y) * 0.01;
      node.vx *= 0.85;
      node.vy *= 0.85;
      node.x += node.vx;
      node.y += node.vy;
      // Bounds
      node.x = Math.max(10, Math.min(w - 10, node.x));
      node.y = Math.max(10, Math.min(h - 10, node.y));
    }

    this.draw();
    this.raf = requestAnimationFrame(() => this.tick());
  }

  private startAnimation() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => this.tick());
  }

  private stopAnimation() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
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

    if (!this.state.hasData || this.nodes.length === 0) {
      this.drawEmpty(g, canvas);
      return;
    }

    const nodeMap = new Map(this.nodes.map((n) => [n.id, n]));
    const font = `9px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;

    // Edges
    g.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    g.lineWidth = 1;
    for (const edge of this.edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }

    // Nodes
    let maxDeg = 1;
    for (const n of this.nodes) if (n.degree > maxDeg) maxDeg = n.degree;
    for (const node of this.nodes) {
      const r = 3 + (node.degree / maxDeg) * 8;
      const t = node.degree / maxDeg;
      // teal → amber by degree
      const cr = Math.round(45 + (251 - 45) * t);
      const cg = Math.round(212 + (191 - 212) * t);
      const cb = Math.round(191 + (36 - 191) * t);
      g.fillStyle = `rgb(${cr},${cg},${cb})`;
      g.beginPath();
      g.arc(node.x, node.y, r, 0, Math.PI * 2);
      g.fill();

      if (this.state.showLabels && r >= 5) {
        g.fillStyle = 'rgba(200, 214, 228, 0.8)';
        g.font = font;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(node.id.slice(0, 8), node.x, node.y - r - 6);
      }
    }
  }

  private drawEmpty(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    const msg =
      this.api.locale === 'zh-CN'
        ? '未加载网络数据 — 拖入 .csv 边列表或 JSON 图'
        : 'No network data — drop a .csv edge list or JSON graph';
    g.fillText(msg, canvas.width / 2, canvas.height / 2);
  }
}

/** Parse edge-list CSV or JSON graph. */
export function parseNetwork(text: string): { nodes: GNode[]; edges: GEdge[] } {
  const trimmed = text.trim();
  // JSON format: { nodes: [{id}], links: [{source, target, weight?}] }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const rawNodes = (obj.nodes ?? obj.vertices ?? []) as Record<string, unknown>[];
      const rawLinks = (obj.links ?? obj.edges ?? []) as Record<string, unknown>[];
      const nodeSet = new Set<string>();
      for (const n of rawNodes) {
        const id = String(n.id ?? n.name ?? n.label ?? '');
        if (id) nodeSet.add(id);
      }
      const edges: GEdge[] = [];
      for (const l of rawLinks) {
        const s = String(l.source ?? l.from ?? '');
        const t = String(l.target ?? l.to ?? '');
        const w = Number(l.weight ?? l.value ?? 1);
        if (s && t) {
          edges.push({ source: s, target: t, weight: Number.isFinite(w) ? w : 1 });
          nodeSet.add(s);
          nodeSet.add(t);
        }
      }
      const degreeMap = new Map<string, number>();
      for (const e of edges) {
        degreeMap.set(e.source, (degreeMap.get(e.source) ?? 0) + 1);
        degreeMap.set(e.target, (degreeMap.get(e.target) ?? 0) + 1);
      }
      const nodes: GNode[] = Array.from(nodeSet).slice(0, MAX_NODES).map((id) => ({
        id,
        x: 0, y: 0, vx: 0, vy: 0,
        degree: degreeMap.get(id) ?? 0,
      }));
      return { nodes, edges: edges.slice(0, MAX_EDGES) };
    } catch {
      // Fall through to CSV parsing
    }
  }

  // CSV: source,target[,weight]
  const lines = trimmed.split(/\r?\n/);
  const degreeMap = new Map<string, number>();
  const nodeSet = new Set<string>();
  const edges: GEdge[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.includes(',') ? t.split(',') : t.split(/\s+/);
    if (parts.length < 2) continue;
    const s = parts[0]!.trim();
    const tg = parts[1]!.trim();
    const w = parts.length > 2 ? parseFloat(parts[2]!) : 1;
    if (!s || !tg) continue;
    edges.push({ source: s, target: tg, weight: Number.isFinite(w) ? w : 1 });
    nodeSet.add(s);
    nodeSet.add(tg);
    degreeMap.set(s, (degreeMap.get(s) ?? 0) + 1);
    degreeMap.set(tg, (degreeMap.get(tg) ?? 0) + 1);
    if (edges.length >= MAX_EDGES) break;
  }
  const nodes: GNode[] = Array.from(nodeSet).slice(0, MAX_NODES).map((id) => ({
    id, x: 0, y: 0, vx: 0, vy: 0, degree: degreeMap.get(id) ?? 0,
  }));
  return { nodes, edges };
}

export default function createNetworkGraphPlugin(): Plugin {
  return new NetworkGraphPlugin();
}
