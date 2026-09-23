// ==========================================================================
// Example plugin: Protein Interaction Network
//
// Medical / systems-biology flavoured compute demo. Loads a protein-protein
// interaction (PPI) network (proteins + weighted edges) and computes a
// force-directed layout (Fruchterman-Reingold spring-electrical model). The
// layout is genuinely heavy: every iteration is O(V²) repulsion plus O(E)
// attraction over `iterations` steps.
//
// On top of the layout it runs a systems-biology analysis over the loaded
// network (see proteinAnalytics.ts): Louvain community detection (functional
// modules/complexes), degree-z hub ranking, local clustering coefficient,
// degree assortativity, and the connected-component size distribution. Nodes
// are optionally coloured by community and hubs get a ring highlight; the
// metrics are drawn as an on-canvas stats strip.
// ==========================================================================

import type {
  ComputeProgress,
  ComputeResult,
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
} from '@/types/plugin';
import { actionButton, actionFired, exportCanvasPng, exportRowsCsv } from './shared/enhance';
import { analyzeNetwork } from './proteinAnalytics';
import type { NetworkMetrics, WEdge } from './proteinAnalytics';

export { proteinManifest } from './proteinManifest';
import { proteinManifest } from './proteinManifest';

const MAX_PROTEINS = 2000;
const CPU_PROTEIN_CAP = 1500;
/** Slider granularity for the Proteins count (also its lower bound). */
const PROTEIN_COUNT_STEP = 20;

/** Node fill mode. "community" colours by Louvain module, "degree" by degree. */
type ColorBy = 'community' | 'degree';

interface ProteinNode {
  id: string;
  name: string;
  x: number;
  y: number;
  degree: number;
  /** Louvain community id (filled by runAnalytics). */
  module: number;
  /** Whether the node is a degree-z hub. */
  hub: boolean;
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
  colorBy: ColorBy;
  showHubs: boolean;
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
    colorBy: 'degree',
    showHubs: true,
  };
  private nodes: ProteinNode[] = [];
  private edges: ProteinEdge[] = [];
  /** Systems-biology metrics over the current working network (see
   *  proteinAnalytics.ts). Recomputed on load, on resample and on demand. */
  private analytics: NetworkMetrics | null = null;
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
    // Export buttons accept both the host's `{ key: { action } }` emission and
    // a plain `{ key: true }` call. They never touch the running state.
    const fired = (key: string): boolean => {
      const v = params[key];
      return v === true || (typeof v === 'object' && v !== null && (v as { action?: string }).action === key);
    };
    if (fired('exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'protein');
      return;
    }
    if (fired('exportCsv')) {
      this.exportNodesCsv();
      return;
    }
    if (typeof params.count === 'number' && params.count !== this.state.count) {
      this.state.count = Math.max(
        PROTEIN_COUNT_STEP,
        Math.min(this.countMax, Math.floor(params.count)),
      );
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
    if (typeof params.colorBy === 'string') {
      const cb = params.colorBy === 'community' ? 'community' : 'degree';
      if (cb !== this.state.colorBy) {
        this.state.colorBy = cb;
        this.draw();
      }
    }
    if (typeof params.showHubs === 'boolean' && params.showHubs !== this.state.showHubs) {
      this.state.showHubs = params.showHubs;
      this.draw();
    }
    // The button param is emitted under `params.compute.action` (see
    // ParamPanel) — checking params.action directly was always undefined,
    // so the "Compute Layout" button never ran.
    if (actionFired(params, 'runAnalytics')) {
      this.runAnalytics();
      this.api.notify(
        'success',
        this.api.locale === 'zh-CN'
          ? `已重算社区 — ${this.analytics?.numCommunities ?? '?'} 个模块，Q=${this.analytics?.modularity.toFixed(3) ?? '?'}`
          : `Communities recomputed — ${this.analytics?.numCommunities ?? '?'} modules, Q=${this.analytics?.modularity.toFixed(3) ?? '?'}`,
      );
    }
    if ((params as { compute?: { action?: string } })?.compute?.action === 'layout-compute') {
      void this.runCompute();
    }
  }

  /**
   * Upper bound of the Proteins slider.
   *
   * Resampling can only draw from the loaded network, so a fixed
   * `MAX_PROTEINS` ceiling let the slider travel past the end of the data —
   * the request was clamped, `state.count` snapped back to the loaded size
   * and the thumb jumped backwards, i.e. the slider could never be filled.
   * Reported bounds now match what the resampler can actually deliver.
   */
  private get countMax(): number {
    if (!this.state.hasData) return MAX_PROTEINS;
    const step = PROTEIN_COUNT_STEP;
    const n = this.rawNodes.length;
    return Math.max(step, Math.min(MAX_PROTEINS, Math.ceil(n / step) * step));
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'count',
        label: 'Proteins',
        type: 'range',
        min: PROTEIN_COUNT_STEP,
        max: this.countMax,
        step: PROTEIN_COUNT_STEP,
        value: this.state.count,
      },
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
      {
        key: 'colorBy',
        label: 'Colour by',
        type: 'select',
        value: this.state.colorBy,
        options: [
          { value: 'degree', label: 'Degree', labelI18n: { 'zh-CN': '节点度', 'en-US': 'Degree' } },
          { value: 'community', label: 'Module', labelI18n: { 'zh-CN': '社区模块', 'en-US': 'Module' } },
        ],
      },
      {
        key: 'showHubs',
        label: 'Highlight hubs',
        type: 'toggle',
        value: this.state.showHubs,
        offLabelI18n: { 'zh-CN': '隐藏 hub 圈标', 'en-US': 'Hide hub rings' },
        onLabelI18n: { 'zh-CN': '显示 hub 圈标', 'en-US': 'Show hub rings' },
      },
      actionButton('runAnalytics', 'Recompute modules', '重算社区 (Louvain)', 'primary'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
      actionButton('exportCsv', 'Export Nodes CSV', '导出节点 CSV'),
    ];
  }

  /** Export the node table (id, name, degree, community, hub, x, y) as CSV. */
  private exportNodesCsv() {
    const rows: Array<number | string>[] = this.nodes.map((n) => [
      n.id,
      n.name,
      n.degree,
      n.module,
      n.hub ? 'hub' : '',
      n.x,
      n.y,
    ]);
    exportRowsCsv(
      this.api,
      'protein-nodes',
      ['id', 'name', 'degree', 'module', 'hub', 'x', 'y'],
      rows,
    );
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
    // A new network invalidates a *running* layout: halt it first so the
    // freshly imported network is not immediately relaxed by the still-running
    // frame loop. The user restarts explicitly with Start.
    if (this.state.running) this.stop();
    this.nodes = parsed.nodes;
    this.edges = parsed.edges;
    // Pristine copies for non-destructive resampling (layout mutates node
    // positions in place).
    this.rawNodes = parsed.nodes.map((n) => ({ ...n }));
    this.rawEdges = parsed.edges.slice();
    this.state.hasData = true;
    // Keep the working set inside the slider's ceiling so the reported
    // count and the drawn network never disagree.
    if (this.nodes.length > MAX_PROTEINS) {
      this.resampleTo(MAX_PROTEINS);
    } else {
      this.state.count = Math.max(PROTEIN_COUNT_STEP, this.nodes.length);
      this.computeDegrees();
      this.runAnalytics();
      this.api.reportDataScale(this.nodes.length);
      this.draw();
    }
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
    this.runAnalytics();
    this.draw();

    const ms = performance.now() - t0;
    this.api.reportGpuTime(ms);
    const metrics2 = this.networkMetrics(cap);
    const a = this.analytics;
    return {
      ok: true,
      // Report the sub-network actually laid out, matching the metrics.
      output: {
        nodes: cap,
        edges: edges.length,
        ...metrics2,
        communities: a?.numCommunities ?? 0,
        modularity: a?.modularity ?? 0,
        meanClustering: a?.meanClustering ?? 0,
        assortativity: a?.assortativity ?? 0,
        hubs: a?.hubs.length ?? 0,
      },
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
    this.runAnalytics();
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

  /** Run the systems-biology analysis over the current working network and
   *  stamp communities + hub flags onto the nodes. Deterministic and O(N+E). */
  private runAnalytics(): void {
    if (this.nodes.length === 0) {
      this.analytics = null;
      return;
    }
    const nodes: { id: string; name: string }[] = this.nodes.map((n) => ({ id: n.id, name: n.name }));
    const edges: WEdge[] = this.edges.map((e) => ({ a: e.a, b: e.b, weight: e.weight }));
    this.analytics = analyzeNetwork(nodes, edges);

    const community = this.analytics.community;
    for (let i = 0; i < this.nodes.length; i += 1) {
      const node = this.nodes[i] as ProteinNode;
      if (i < community.length) node.module = community[i] as number;
      node.hub = false;
    }
    const hubIds = new Set(this.analytics.hubs.map((h) => h.id));
    for (const node of this.nodes) {
      if (hubIds.has(node.id)) node.hub = true;
    }
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
    const total = Math.max(1, rawProteins.length);
    for (let i = 0; i < rawProteins.length; i += 1) {
      const p = rawProteins[i] as Record<string, unknown>;
      const id = String(p.id ?? p.name ?? i);
      idToIndex.set(id, i);
      // Sunflower (Vogel) spiral start: every node gets a distinct position
      // inside the unit disc. Starting them all at the origin made every
      // pair take the de-collision branch on the first iterations and the
      // network exploded outward instead of relaxing.
      const angle = i * 2.399963229728653;
      const radius = 0.9 * Math.sqrt((i + 0.5) / total);
      nodes.push({
        id,
        name: String(p.name ?? id),
        x: radius * Math.cos(angle),
        y: radius * Math.sin(angle),
        degree: 0,
        module: 0,
        hub: false,
      });
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

    // Nodes — filled by community (categorical palette) or degree (viridis
    // ramp). Hubs get a gold ring.
    const colorByCommunity = this.state.colorBy === 'community';
    const maxD = Math.max(1, this.maxDegree);
    for (const n of this.nodes) {
      const sx = cx + n.x * scale;
      const sy = cy + n.y * scale;
      g.fillStyle = colorByCommunity
        ? catColor(n.module)
        : degreeColor(Math.min(1, n.degree / maxD));
      const r = 1.5 + Math.sqrt(n.degree) * 1.1;
      g.beginPath();
      g.arc(sx, sy, r, 0, Math.PI * 2);
      g.fill();
      if (this.state.showHubs && n.hub) {
        g.strokeStyle = 'rgba(248,231,120,0.95)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(sx, sy, r + 3, 0, Math.PI * 2);
        g.stroke();
      }
    }

    if (this.analytics) {
      if (colorByCommunity) this.drawLegend(g, canvas, this.analytics);
      this.drawStats(g, this.analytics);
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

  /** On-canvas stats strip (top-left): size, modularity, assortativity, etc. */
  private drawStats(g: CanvasRenderingContext2D, a: NetworkMetrics): void {
    const zh = this.api.locale === 'zh-CN';
    const font = zh ? "'Microsoft YaHei'" : 'Consolas';
    const bits = [
      `${a.n} N`,
      `${Math.round(a.m)} E`,
      `k̄ ${a.meanDegree.toFixed(2)}`,
      `Q ${a.modularity.toFixed(3)}`,
      `${a.numCommunities} ${zh ? '模块' : 'mod'}`,
      `α ${a.assortativity.toFixed(2)}`,
      `C̄ ${a.meanClustering.toFixed(2)}`,
      `${a.hubs.length} hub`,
    ].join('  ·  ');
    g.font = `11px ${font}, monospace`;
    const w = g.measureText(bits).width + 16;
    g.fillStyle = 'rgba(10,14,19,0.74)';
    g.fillRect(8, 8, w, 22);
    g.fillStyle = 'rgba(214,225,238,0.96)';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(bits, 16, 8 + 11);
  }

  /** Bottom-left categorical legend for community colouring (largest modules). */
  private drawLegend(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, a: NetworkMetrics): void {
    const zh = this.api.locale === 'zh-CN';
    const font = zh ? "'Microsoft YaHei'" : 'Consolas';
    g.font = `10px ${font}, monospace`;
    const cols = a.communities.slice(0, 8);
    let x = 10;
    let y = canvas.height - 12;
    for (const c of cols) {
      const label = `${zh ? '模块' : 'C'}${c.id}(${c.count})`;
      const sw = 10;
      const gap = 8;
      g.fillStyle = catColor(c.id);
      g.fillRect(x, y - 8, sw, sw);
      g.fillStyle = 'rgba(214,225,238,0.9)';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(label, x + sw + 4, y - 3);
      x += sw + 4 + g.measureText(label).width + gap;
      if (x > canvas.width - 40) {
        x = 10;
        y -= 16;
      }
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

/** Categorical palette for Louvain communities (distinct, colour-blind aware
 *  hues); wraps by index for networks with many modules. */
const CATEGORICAL: Array<[number, number, number]> = [
  [231, 104, 115],
  [64, 158, 226],
  [121, 203, 122],
  [245, 158, 64],
  [158, 143, 222],
  [76, 201, 191],
  [250, 100, 62],
  [236, 172, 215],
  [108, 199, 99],
  [255, 213, 79],
  [150, 166, 90],
  [117, 136, 149],
];

function catColor(id: number): string {
  const c = CATEGORICAL[((id % CATEGORICAL.length) + CATEGORICAL.length) % CATEGORICAL.length]!;
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export default function createProteinPlugin(): Plugin {
  return new ProteinPlugin();
}
