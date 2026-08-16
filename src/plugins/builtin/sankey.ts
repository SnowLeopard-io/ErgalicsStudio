// ==========================================================================
// Example plugin: Sankey Diagram (桑基图)
//
// Renders flow diagrams from source→target→value edge data. Nodes are
// arranged in columns; flows are curved bezier ribbons sized by value.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';

export const sankeyManifest: PluginManifest = {
  id: 'example.sankey',
  name: 'Sankey Diagram',
  nameI18n: { 'zh-CN': '桑基图', 'en-US': 'Sankey Diagram' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Flow diagram with proportional ribbons.',
  descriptionI18n: {
    'zh-CN': '从源→目标→值的边数据渲染桑基流图，带按比例缩放的流量带。',
    'en-US': 'Flow diagram from source→target→value edges; ribbons sized proportionally.',
  },
  license: 'MIT',
  entry: 'example.sankey',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV (source,target,value)' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Edge list' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text edge list' },
  ],
};

interface SNode {
  id: string;
  x: number;
  y: number;
  width: number;
  inflow: number;
  outflow: number;
  level: number;
}

interface SFlow {
  source: string;
  target: string;
  value: number;
}

interface State {
  nodeWidth: number;
  gap: number;
  hasData: boolean;
}

const MAX_NODES = 200;
const MAX_FLOWS = 500;
const COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#22d3ee', '#fb7185', '#f59e0b'];

export class SankeyPlugin implements Plugin {
  readonly manifest = sankeyManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private nodes: SNode[] = [];
  private flows: SFlow[] = [];
  private state: State = { nodeWidth: 12, gap: 8, hasData: false };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.nodes = [];
    this.flows = [];
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
    if (typeof params.nodeWidth === 'number') this.state.nodeWidth = params.nodeWidth;
    if (typeof params.gap === 'number') this.state.gap = params.gap;
    this.layout();
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'nodeWidth',
        label: 'Node Width',
        labelI18n: { 'zh-CN': '节点宽度', 'en-US': 'Node Width' },
        type: 'range',
        min: 4,
        max: 30,
        step: 1,
        value: this.state.nodeWidth,
      },
      {
        key: 'gap',
        label: 'Node Gap',
        labelI18n: { 'zh-CN': '节点间距', 'en-US': 'Node Gap' },
        type: 'range',
        min: 2,
        max: 30,
        step: 1,
        value: this.state.gap,
      },
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const { nodes, flows } = parseSankey(text);
    if (nodes.length < 2 || flows.length === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '未找到有效的流数据（格式：源,目标,值）'
          : 'No valid flow data (format: source,target,value)',
      );
      return;
    }
    this.nodes = nodes;
    this.flows = flows;
    this.state.hasData = true;
    this.assignLevels();
    this.layout();
    this.api.reportDataScale(nodes.length);
    this.draw();
  }

  /** Assign BFS levels (longest path from source). */
  private assignLevels() {
    const adj = new Map<string, string[]>();
    for (const n of this.nodes) adj.set(n.id, []);
    for (const f of this.flows) {
      adj.get(f.source)?.push(f.target);
    }
    // Find roots (no incoming)
    const hasIncoming = new Set<string>();
    for (const f of this.flows) hasIncoming.add(f.target);
    const roots = this.nodes.filter((n) => !hasIncoming.has(n.id));
    const queue = roots.length > 0 ? roots : this.nodes.slice(0, 1);
    for (const n of this.nodes) n.level = 0;
    const visited = new Set<string>();
    const q: string[] = [];
    for (const r of queue) { q.push(r.id); visited.add(r.id); r.level = 0; }
    while (q.length > 0) {
      const id = q.shift()!;
      const node = this.nodes.find((n) => n.id === id);
      if (!node) continue;
      for (const tgt of adj.get(id) ?? []) {
        if (!visited.has(tgt)) {
          const tNode = this.nodes.find((n) => n.id === tgt);
          if (tNode) {
            tNode.level = node.level + 1;
            visited.add(tgt);
            q.push(tgt);
          }
        }
      }
    }
  }

  private layout() {
    const canvas = this.ctx?.canvas2d;
    const w = canvas?.clientWidth ?? 400;
    const h = canvas?.clientHeight ?? 300;
    const maxLevel = Math.max(...this.nodes.map((n) => n.level), 0);
    const colW = maxLevel > 0 ? (w - 40) / maxLevel : w - 40;
    const margin = 20;

    // Group by level
    const byLevel = new Map<number, SNode[]>();
    for (const n of this.nodes) {
      if (!byLevel.has(n.level)) byLevel.set(n.level, []);
      byLevel.get(n.level)!.push(n);
    }

    // Compute in/out flows
    for (const n of this.nodes) {
      n.inflow = 0;
      n.outflow = 0;
    }
    for (const f of this.flows) {
      const s = this.nodes.find((n) => n.id === f.source);
      const t = this.nodes.find((n) => n.id === f.target);
      if (s) s.outflow += f.value;
      if (t) t.inflow += f.value;
    }

    // Layout each column
    for (const [level, groupNodes] of byLevel) {
      groupNodes.sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow));
      const totalH = h - margin * 2;
      const totalFlow = groupNodes.reduce((sum, n) => sum + Math.max(n.inflow, n.outflow, 1), 0);
      let y = margin;
      for (const n of groupNodes) {
        const nodeH = (Math.max(n.inflow, n.outflow, 1) / totalFlow) * totalH;
        n.x = margin + level * colW;
        n.y = y;
        n.width = Math.max(4, nodeH);
        y += nodeH + this.state.gap;
      }
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

    // Track vertical offsets for flow source/target
    const srcOffset = new Map<string, number>();
    const tgtOffset = new Map<string, number>();
    for (const n of this.nodes) {
      srcOffset.set(n.id, 0);
      tgtOffset.set(n.id, 0);
    }

    // Flows
    for (let i = 0; i < this.flows.length; i += 1) {
      const flow = this.flows[i]!;
      const s = nodeMap.get(flow.source);
      const t = nodeMap.get(flow.target);
      if (!s || !t) continue;
      const color = COLORS[i % COLORS.length]!;
      const sFlow = Math.max(s.outflow, 1);
      const tFlow = Math.max(t.inflow, 1);
      const sH = (flow.value / sFlow) * s.width;
      const tH = (flow.value / tFlow) * t.width;
      const sY = s.y + (srcOffset.get(s.id) ?? 0);
      const tY = t.y + (tgtOffset.get(t.id) ?? 0);
      srcOffset.set(s.id, (srcOffset.get(s.id) ?? 0) + sH);
      tgtOffset.set(t.id, (tgtOffset.get(t.id) ?? 0) + tH);

      const x1 = s.x + this.state.nodeWidth;
      const x2 = t.x;
      const cx = (x1 + x2) / 2;
      g.fillStyle = color + '50';
      g.beginPath();
      g.moveTo(x1, sY);
      g.bezierCurveTo(cx, sY, cx, tY, x2, tY);
      g.lineTo(x2, tY + tH);
      g.bezierCurveTo(cx, tY + tH, cx, sY + sH, x1, sY + sH);
      g.closePath();
      g.fill();
    }

    // Nodes
    for (let i = 0; i < this.nodes.length; i += 1) {
      const n = this.nodes[i]!;
      g.fillStyle = COLORS[i % COLORS.length]!;
      g.fillRect(n.x, n.y, this.state.nodeWidth, n.width);
      // Label
      g.fillStyle = 'rgba(200, 214, 228, 0.85)';
      g.font = font;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(n.id.slice(0, 12), n.x + this.state.nodeWidth + 4, n.y + n.width / 2);
    }
  }

  private drawEmpty(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    const msg =
      this.api.locale === 'zh-CN'
        ? '未加载流数据 — 拖入 .csv 文件（源,目标,值）'
        : 'No flow data — drop a .csv (source,target,value)';
    g.fillText(msg, canvas.width / 2, canvas.height / 2);
  }
}

/** Parse edge-list CSV or JSON for Sankey. */
export function parseSankey(text: string): { nodes: SNode[]; flows: SFlow[] } {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const rawNodes = (obj.nodes ?? []) as Record<string, unknown>[];
      const rawLinks = (obj.links ?? []) as Record<string, unknown>[];
      const nodeSet = new Set<string>();
      for (const n of rawNodes) {
        const id = String(n.id ?? n.name ?? '');
        if (id) nodeSet.add(id);
      }
      const flows: SFlow[] = [];
      for (const l of rawLinks) {
        const s = String(l.source ?? l.from ?? '');
        const t = String(l.target ?? l.to ?? '');
        const v = Number(l.value ?? l.weight ?? 1);
        if (s && t) {
          flows.push({ source: s, target: t, value: Number.isFinite(v) ? v : 1 });
          nodeSet.add(s);
          nodeSet.add(t);
        }
      }
      const nodes: SNode[] = Array.from(nodeSet).slice(0, MAX_NODES).map((id) => ({
        id, x: 0, y: 0, width: 0, inflow: 0, outflow: 0, level: 0,
      }));
      return { nodes, flows: flows.slice(0, MAX_FLOWS) };
    } catch {
      // fall through
    }
  }

  // CSV: source,target[,value]
  const lines = trimmed.split(/\r?\n/);
  const nodeSet = new Set<string>();
  const flows: SFlow[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.includes(',') ? t.split(',') : t.split(/\s+/);
    if (parts.length < 2) continue;
    const s = parts[0]!.trim();
    const tg = parts[1]!.trim();
    const v = parts.length > 2 ? parseFloat(parts[2]!) : 1;
    if (!s || !tg) continue;
    flows.push({ source: s, target: tg, value: Number.isFinite(v) ? Math.abs(v) : 1 });
    nodeSet.add(s);
    nodeSet.add(tg);
    if (flows.length >= MAX_FLOWS) break;
  }
  const nodes: SNode[] = Array.from(nodeSet).slice(0, MAX_NODES).map((id) => ({
    id, x: 0, y: 0, width: 0, inflow: 0, outflow: 0, level: 0,
  }));
  return { nodes, flows };
}

export default function createSankeyPlugin(): Plugin {
  return new SankeyPlugin();
}
