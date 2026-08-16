// ==========================================================================
// Example plugin: Protein Interaction Network
//
// Medical / systems-biology flavoured compute demo. Loads a protein-protein
// interaction (PPI) network (proteins + weighted edges) and computes a
// force-directed layout (Fruchterman-Reingold spring-electrical model). The
// layout is genuinely heavy: every iteration is O(V²) repulsion plus O(E)
// attraction over `iterations` steps. As a by-product it reports biology-
// relevant metrics — node degree, number of connected components (putative
// complexes/modules), and the largest component size — which are standard
// first-pass analyses for interaction networks.
// ==========================================================================

import type {
  ComputeProgress,
  ComputeResult,
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
} from '@/types/plugin';

export const proteinManifest: PluginManifest = {
  id: 'example.protein',
  name: 'Protein Interactions',
  nameI18n: { 'zh-CN': '蛋白质交互网络', 'en-US': 'Protein Interactions' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Protein-protein interaction network + force-directed layout.',
  descriptionI18n: {
    'zh-CN': '蛋白质-蛋白质交互网络与力导向布局计算，输出度分布与连通分量等生物学指标。',
    'en-US': 'PPI network with force-directed layout; reports degree, components, modules.',
  },
  license: 'MIT',
  entry: 'example.protein',
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: 'Protein interaction network' },
  ],
};

const MAX_PROTEINS = 2000;
const CPU_PROTEIN_CAP = 1500;

interface ProteinNode {
  id: string;
  name: string;
  x: number;
  y: number;
  degree: number;
  module: number;
}

interface ProteinEdge {
  a: number; // index into nodes
  b: number;
  weight: number;
}

interface State {
  count: number;
  iterations: number;
  repulsion: number;
  running: boolean;
  hasData: boolean;
}

export class ProteinPlugin implements Plugin {
  readonly manifest = proteinManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = {
    count: 300,
    iterations: 300,
    repulsion: 0.08,
    running: false,
    hasData: false,
  };
  private nodes: ProteinNode[] = [];
  private edges: ProteinEdge[] = [];
  /** Original loaded network, never mutated. The count slider resamples from
   *  here, so lowering then raising it restores the full network — resampling
   *  from the working set previously destroyed the loaded data permanently. */
  private rawNodes: ProteinNode[] = [];
  private rawEdges: ProteinEdge[] = [];
  private rafId = 0;
  private temp = 0.18;

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.stop();
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.stop();
  }

  async render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.count === 'number' && params.count !== this.state.count) {
      this.state.count = Math.max(20, Math.min(MAX_PROTEINS, Math.floor(params.count)));
      // The Proteins slider was previously a no-op: resample the loaded
      // network down to the requested size so the param actually does work.
      if (this.state.hasData) this.resampleTo(this.state.count);
    }
    if (typeof params.iterations === 'number') {
      this.state.iterations = Math.max(10, Math.floor(params.iterations));
    }
    if (typeof params.repulsion === 'number') this.state.repulsion = params.repulsion;
    if (typeof params.start === 'boolean') {
      if (params.start) this.start();
      else this.stop();
    }
    // The button param is emitted under `params.compute.action` (see
    // ParamPanel) — checking params.action directly was always undefined,
    // so the "Compute Layout" button never ran.
    if ((params as { compute?: { action?: string } })?.compute?.action === 'layout-compute') {
      void this.runCompute();
    }
  }

  getParams(): ParamDefinition[] {
    return [
      { key: 'count', label: 'Proteins', type: 'range', min: 20, max: MAX_PROTEINS, step: 20, value: this.state.count },
      { key: 'iterations', label: 'Iterations', type: 'range', min: 20, max: 1000, step: 20, value: this.state.iterations },
      { key: 'repulsion', label: 'Repulsion (k)', type: 'range', min: 0.03, max: 0.3, step: 0.005, value: this.state.repulsion },
      {
        key: 'start',
        label: 'Run',
        type: 'toggle',
        value: this.state.running,
        offLabelI18n: { 'zh-CN': '▶ 开始布局', 'en-US': '▶ Relax' },
        onLabelI18n: { 'zh-CN': '■ 停止布局', 'en-US': '■ Stop' },
      },
      {
        key: 'compute',
        label: 'Compute Layout',
        type: 'button',
        variant: 'primary',
        action: 'layout-compute',
        labelI18n: { 'zh-CN': '⚡ 计算力导向布局', 'en-US': '⚡ Compute layout' },
      },
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const parsed = this.parseData(text);
    if (!parsed || parsed.nodes.length < 2) {
      this.api.notify('warning', this.api.locale === 'zh-CN' ? '无法解析网络文件' : 'Could not parse network file');
      return;
    }
    this.nodes = parsed.nodes;
    this.edges = parsed.edges;
    // Pristine copies for non-destructive resampling (layout mutates node
    // positions in place).
    this.rawNodes = parsed.nodes.map((n) => ({ ...n }));
    this.rawEdges = parsed.edges.slice();
    this.state.count = this.nodes.length;
    this.state.hasData = true;
    this.computeDegrees();
    this.api.reportDataScale(this.nodes.length);
    this.draw();
  }

  /**
   * Compute the force-directed layout over `iterations` steps. Pure CPU
   * (the O(V²) repulsion does not parallelise as cleanly as the N-body sum),
   * but it is a real, heavy computation — progress is reported per iteration
   * and the elapsed time to the perf panel.
   */
  async compute(_input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult> {
    if (this.nodes.length === 0) {
      return { ok: false, error: this.api.locale === 'zh-CN' ? '未加载数据 — 请先拖入 .json 文件或打开「示例数据」' : 'no data — load a .json file or sample data first' };
    }
    const cap = Math.min(this.nodes.length, CPU_PROTEIN_CAP);
    if (cap < this.nodes.length) {
      this.api.notify(
        'info',
        this.api.locale === 'zh-CN'
          ? `CPU 布局使用前 ${cap} / ${this.nodes.length} 个节点`
          : `CPU layout uses first ${cap} / ${this.nodes.length} nodes`,
      );
    }
    const nodes = this.nodes.slice(0, cap);
    const edges = this.edges.filter((e) => e.a < cap && e.b < cap);

    const t0 = performance.now();
    const k = this.state.repulsion;
    let temp = 0.18;
    for (let it = 0; it < this.state.iterations; it += 1) {
      this.layoutStep(nodes, edges, k, temp);
      temp *= 0.97; // simulated annealing cools the layout
      onProgress?.({ done: it + 1, total: this.state.iterations });
    }

    // Write back relaxed positions.
    for (let i = 0; i < cap; i += 1) {
      const src = nodes[i] as ProteinNode;
      const dst = this.nodes[i] as ProteinNode;
      dst.x = src.x;
      dst.y = src.y;
    }
    this.computeDegrees();
    this.draw();

    const ms = performance.now() - t0;
    this.api.reportGpuTime(ms);
    const metrics2 = this.networkMetrics(cap);
    return {
      ok: true,
      // Report the sub-network actually laid out, matching the metrics.
      output: { nodes: cap, edges: edges.length, ...metrics2 },
      metrics: { gpuMs: ms, bytes: cap * 16 + edges.length * 12 },
    };
  }

  /** Trigger the layout compute from the params button. */
  private async runCompute() {
    if (this.nodes.length === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '请先加载数据 — 拖入 .json 文件或打开「示例数据」'
          : 'Load data first — drop a .json file or open sample data',
      );
      return;
    }
    const result = await this.compute(null, (p) => {
      this.api.notify('info', `${p.done}/${p.total}`);
    });
    if (result.ok) {
      const o = result.output as { components?: number; maxComponent?: number };
      const ms = result.metrics?.gpuMs?.toFixed(1) ?? '?';
      this.api.notify(
        'success',
        this.api.locale === 'zh-CN'
          ? `布局完成 — ${o.components ?? '?'} 个连通分量，最大 ${o.maxComponent ?? '?'} 节点（${ms} ms）`
          : `Layout done — ${o.components ?? '?'} components, largest ${o.maxComponent ?? '?'} (${ms} ms)`,
      );
    } else {
      this.api.notify('error', result.error ?? 'compute failed');
    }
  }

  // ---- force-directed internals ----

  private layoutStep(
    nodes: ProteinNode[],
    edges: ProteinEdge[],
    k: number,
    temperature: number,
  ): void {
    const n = nodes.length;
    const fx = new Float64Array(n);
    const fy = new Float64Array(n);

    // Repulsion: O(V²) all-pairs.
    const k2 = k * k;
    for (let i = 0; i < n; i += 1) {
      const ni = nodes[i] as ProteinNode;
      for (let j = i + 1; j < n; j += 1) {
        const nj = nodes[j] as ProteinNode;
        let dx = ni.x - nj.x;
        let dy = ni.y - nj.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 1e-4) {
          // Deterministic de-collision (no random): push apart along a fixed
          // per-pair direction so overlapping nodes separate without jitter.
          dx = (j - i) * 1e-4;
          dy = (i + j + 1) * 1e-4;
          dist = Math.hypot(dx, dy);
        }
        const f = k2 / dist;
        const ux = dx / dist;
        const uy = dy / dist;
        fx[i] = (fx[i] ?? 0) + ux * f;
        fy[i] = (fy[i] ?? 0) + uy * f;
        fx[j] = (fx[j] ?? 0) - ux * f;
        fy[j] = (fy[j] ?? 0) - uy * f;
      }
    }

    // Attraction along edges.
    for (const e of edges) {
      const a = nodes[e.a] as ProteinNode;
      const b = nodes[e.b] as ProteinNode;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.hypot(dx, dy) || 1e-4;
      const f = (dist * dist) / k;
      const ux = dx / dist;
      const uy = dy / dist;
      fx[e.a] = (fx[e.a] ?? 0) - ux * f;
      fy[e.a] = (fy[e.a] ?? 0) - uy * f;
      fx[e.b] = (fx[e.b] ?? 0) + ux * f;
      fy[e.b] = (fy[e.b] ?? 0) + uy * f;
    }

    // Integrate with temperature-limited displacement.
    const lim = Math.max(temperature, 1e-4);
    for (let i = 0; i < n; i += 1) {
      const ni = nodes[i] as ProteinNode;
      const d = Math.hypot(fx[i] as number, fy[i] as number) || 1e-4;
      const scale = Math.min(lim, d) / d;
      ni.x += (fx[i] as number) * scale;
      ni.y += (fy[i] as number) * scale;
    }
  }

  private computeDegrees(): void {
    const deg = new Array(this.nodes.length).fill(0);
    for (const e of this.edges) {
      if (e.a < deg.length) deg[e.a] += 1;
      if (e.b < deg.length) deg[e.b] += 1;
    }
    let maxDeg = 1;
    for (let i = 0; i < this.nodes.length; i += 1) {
      (this.nodes[i] as ProteinNode).degree = deg[i] as number;
      maxDeg = Math.max(maxDeg, deg[i] as number);
    }
    this.maxDegree = maxDeg;
  }

  private maxDegree = 1;

  /** Deterministically downsample the loaded network to `count` nodes
   *  (from the pristine copy, so the operation is non-destructive). */
  private resampleTo(count: number): void {
    const n = this.rawNodes.length;
    const target = Math.min(Math.max(2, count), n);
    const next: ProteinNode[] = [];
    const indexMap = new Map<number, number>();
    for (let i = 0; i < target; i += 1) {
      const idx = Math.min(Math.floor((i * n) / target), n - 1);
      indexMap.set(idx, i);
      next.push({ ...(this.rawNodes[idx] as ProteinNode) });
    }
    this.nodes = next;
    this.edges = this.rawEdges
      .filter((e) => indexMap.has(e.a) && indexMap.has(e.b))
      .map((e) => ({ a: indexMap.get(e.a) as number, b: indexMap.get(e.b) as number, weight: e.weight }));
    this.state.count = this.nodes.length;
    this.computeDegrees();
    this.api.reportDataScale(this.nodes.length);
    this.draw();
  }

  /** Connected-component analysis (union-find) → modules + largest component. */
  private networkMetrics(cap: number): { components: number; maxComponent: number } {
    const parent = new Array(cap).fill(0).map((_, i) => i);
    const find = (x: number): number => {
      while (parent[x] !== x) {
        const p = parent[x]!;
        parent[x] = parent[p]!;
        x = parent[x]!;
      }
      return x;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    for (const e of this.edges) {
      if (e.a < cap && e.b < cap) union(e.a, e.b);
    }
    const comps = new Map<number, number>();
    for (let i = 0; i < cap; i += 1) {
      const r = find(i);
      comps.set(r, (comps.get(r) ?? 0) + 1);
    }
    let maxComp = 0;
    for (const v of comps.values()) maxComp = Math.max(maxComp, v);
    return { components: comps.size, maxComponent: maxComp };
  }

  /** Parse a PPI JSON: { proteins:[{id,name}], interactions:[{a,b,weight}|{source,target,weight}|[i,j,w]] }. */
  private parseData(text: string): { nodes: ProteinNode[]; edges: ProteinEdge[] } | null {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return null;
    }
    if (!json || typeof json !== 'object') return null;
    const j = json as Record<string, unknown>;
    const rawProteins = (j.proteins ?? j.nodes) as unknown[] | undefined;
    const rawEdges = (j.interactions ?? j.edges ?? j.links) as unknown[] | undefined;
    if (!Array.isArray(rawProteins) || !Array.isArray(rawEdges)) return null;

    const nodes: ProteinNode[] = [];
    const idToIndex = new Map<string, number>();
    for (let i = 0; i < rawProteins.length; i += 1) {
      const p = rawProteins[i] as Record<string, unknown>;
      const id = String(p.id ?? p.name ?? i);
      idToIndex.set(id, i);
      nodes.push({ id, name: String(p.name ?? id), x: 0, y: 0, degree: 0, module: 0 });
    }

    const edges: ProteinEdge[] = [];
    const resolve = (v: unknown): number => {
      if (typeof v === 'number') return v >= 0 && v < nodes.length ? v : -1;
      if (typeof v === 'string') return idToIndex.get(v) ?? -1;
      return -1;
    };
    for (const e of rawEdges) {
      if (Array.isArray(e)) {
        const a = resolve(e[0]);
        const b = resolve(e[1]);
        if (a >= 0 && b >= 0 && a !== b) {
          edges.push({ a, b, weight: typeof e[2] === 'number' ? (e[2] as number) : 1 });
        }
      } else if (e && typeof e === 'object') {
        const o = e as Record<string, unknown>;
        const a = resolve(o.source ?? o.a ?? o.u ?? o.s);
        const b = resolve(o.target ?? o.b ?? o.v ?? o.t);
        if (a >= 0 && b >= 0 && a !== b) {
          edges.push({ a, b, weight: typeof o.weight === 'number' ? (o.weight as number) : 1 });
        }
      }
    }
    if (nodes.length < 2) return null;
    return { nodes, edges };
  }

  private start() {
    if (this.state.running) return;
    if (this.nodes.length === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '请先加载数据 — 拖入 .json 文件或打开「示例数据」'
          : 'Load data first — drop a .json file or open sample data',
      );
      return;
    }
    this.state.running = true;
    this.temp = 0.18;
    this.api.setStatus('computing');
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stop() {
    this.state.running = false;
    cancelAnimationFrame(this.rafId);
    this.api.setStatus('ready');
  }

  private tick = () => {
    if (!this.state.running) return;
    // Apply the same CPU cap as the one-shot compute path — the interactive
    // loop must not relax the full network at MAX_PROTEINS (O(V²) per frame
    // freezes the main thread).
    const cap = Math.min(this.nodes.length, CPU_PROTEIN_CAP);
    const nodes = cap < this.nodes.length ? this.nodes.slice(0, cap) : this.nodes;
    const edges = cap < this.nodes.length
      ? this.edges.filter((e) => e.a < cap && e.b < cap)
      : this.edges;
    // Anneal the temperature so the layout settles and stops jittering.
    this.layoutStep(nodes, edges, this.state.repulsion, this.temp);
    this.temp *= 0.985;
    this.draw();
    if (this.temp < 0.004) {
      this.stop();
      return;
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  private draw() {
    if (!this.ctx?.canvas2d) return;
    const canvas = this.ctx.canvas2d;
    canvas.width = canvas.clientWidth || 400;
    canvas.height = canvas.clientHeight || 300;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const scale = Math.min(canvas.width, canvas.height) / 2.4;

    // Edges first (under nodes).
    for (const e of this.edges) {
      const a = this.nodes[e.a] as ProteinNode | undefined;
      const b = this.nodes[e.b] as ProteinNode | undefined;
      if (!a || !b) continue;
      // Clamp alpha/width: a weight ≥ 3 previously produced alpha > 1 (an
      // invalid rgba() the canvas silently ignores) and absurd line widths.
      const alpha = Math.min(0.95, 0.08 + e.weight * 0.35).toFixed(3);
      g.strokeStyle = `rgba(120,160,200,${alpha})`;
      g.lineWidth = Math.min(6, 0.3 + e.weight * 1.1);
      g.beginPath();
      g.moveTo(cx + a.x * scale, cy + a.y * scale);
      g.lineTo(cx + b.x * scale, cy + b.y * scale);
      g.stroke();
    }

    // Nodes colored by degree.
    const maxD = Math.max(1, this.maxDegree);
    for (const n of this.nodes) {
      const sx = cx + n.x * scale;
      const sy = cy + n.y * scale;
      const t = Math.min(1, n.degree / maxD);
      g.fillStyle = degreeColor(t);
      const r = 1.5 + Math.sqrt(n.degree) * 1.1;
      g.beginPath();
      g.arc(sx, sy, r, 0, Math.PI * 2);
      g.fill();
    }

    if (this.nodes.length === 0) {
      g.fillStyle = 'rgba(150,165,185,0.85)';
      g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      const msg =
        this.api.locale === 'zh-CN'
          ? '拖入 .json 网络或打开「示例数据」'
          : 'Drop a .json network or load sample data';
      g.fillText(msg, canvas.width / 2, canvas.height / 2);
    }
  }
}

/** Viridis-ish ramp for node degree (dark blue → teal → yellow → red). */
function degreeColor(t: number): string {
  const stops = [
    [30, 58, 138],
    [13, 148, 136],
    [132, 204, 22],
    [250, 204, 21],
  ];
  const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  const local = t * (stops.length - 1) - seg;
  const a = stops[seg] as number[];
  const b = stops[seg + 1] as number[];
  const r = Math.round(a[0]! + (b[0]! - a[0]!) * local);
  const gg = Math.round(a[1]! + (b[1]! - a[1]!) * local);
  const bl = Math.round(a[2]! + (b[2]! - a[2]!) * local);
  return `rgb(${r}, ${gg}, ${bl})`;
}

export default function createProteinPlugin(): Plugin {
  return new ProteinPlugin();
}
