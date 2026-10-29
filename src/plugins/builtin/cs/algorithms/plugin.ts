// ==========================================================================
// algorithms — Algorithm Visualizer
//
// Step-by-step sorting traces (bars), graph traversal on a fixed weighted
// example graph, and a side-by-side comparison of all sorts on the same
// input. CSV / whitespace numbers are the Block/Flow entry point.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { emit } from '@/core/events';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import {
  CS,
  clamp,
  drawCard,
  drawFootnote,
  drawHeader,
  drawLegend,
  drawTable,
  font,
  prepareCanvas,
  plotBox,
} from '../../shared/cs-utils';
import { algorithmsFigurePanels } from './figure';
import { algorithmsManifest } from './manifest';
import {
  EXAMPLE_GRAPH,
  SORT_IDS,
  SORT_META,
  graphTrace,
  parseArrayInput,
  runAlgorithmBenchmarks,
  searchTrace,
  sortTrace,
  type GraphId,
  type SortId,
  type SortTrace,
} from './kernel';

export { algorithmsManifest } from './manifest';

type ViewId = 'bars' | 'graph' | 'compare';

const DEFAULT_INPUT = [42, 7, 19, 88, 3, 56, 27, 71, 12, 64, 31, 9, 50, 23];

export class AlgorithmsPlugin implements Plugin {
  readonly manifest = algorithmsManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private data: number[] = [...DEFAULT_INPUT];
  private state = {
    view: 'bars' as ViewId,
    algo: 'bubble' as SortId,
    graph: 'dijkstra' as GraphId,
    target: 42,
    frame: 0,
  };
  private timer: ReturnType<typeof setInterval> | null = null;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    this.stopAnimation();
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
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
  }

  getParams(): ParamDefinition[] {
    const s = this.state;
    const frames = this.frameCount();
    const animationVisible = { key: 'view', in: ['bars', 'graph'] };
    return [
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'bars', label: this.zh ? '排序动画' : 'Sorting animation' },
          { value: 'graph', label: this.zh ? '图遍历' : 'Graph traversal' },
          { value: 'compare', label: this.zh ? '算法对比' : 'Algorithm comparison' },
        ],
        value: s.view,
      },
      {
        key: 'algo',
        label: 'Sorting algorithm',
        labelI18n: { 'zh-CN': '排序算法', 'en-US': 'Sorting algorithm' },
        type: 'select',
        options: SORT_IDS.map((id) => ({
          value: id,
          label: this.zh ? SORT_META[id].zh : SORT_META[id].en,
          labelI18n: { 'zh-CN': SORT_META[id].zh, 'en-US': SORT_META[id].en },
        })),
        value: s.algo,
        visibleWhen: { key: 'view', in: ['bars', 'compare'] },
      },
      {
        key: 'graph',
        label: 'Graph algorithm',
        labelI18n: { 'zh-CN': '图算法', 'en-US': 'Graph algorithm' },
        type: 'select',
        options: [
          { value: 'bfs', label: 'BFS' },
          { value: 'dfs', label: 'DFS' },
          { value: 'dijkstra', label: 'Dijkstra' },
        ],
        value: s.graph,
        visibleWhen: { key: 'view', in: ['graph'] },
      },
      {
        key: 'frame',
        label: 'Frame',
        labelI18n: { 'zh-CN': '帧', 'en-US': 'Frame' },
        type: 'range',
        min: 0,
        max: Math.max(0, frames - 1),
        step: 1,
        value: this.currentFrame(),
        hint: `${this.currentFrame() + 1} / ${frames}`,
        visibleWhen: animationVisible,
      },
      {
        key: 'target',
        label: 'Search target',
        labelI18n: { 'zh-CN': '查找目标', 'en-US': 'Search target' },
        type: 'number',
        value: s.target,
        step: 1,
        visibleWhen: { key: 'view', in: ['compare'] },
      },
      { ...actionButton('play', 'Play / pause animation', '播放 / 暂停动画', 'primary'), visibleWhen: animationVisible },
      { ...actionButton('step', 'Next frame', '下一帧'), visibleWhen: animationVisible },
      { ...actionButton('reset', 'Reset animation', '重置动画'), visibleWhen: animationVisible },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('exportCsv', 'Export trace CSV', '导出轨迹 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.view === 'string' && ['bars', 'graph', 'compare'].includes(params.view) && params.view !== this.state.view) {
      this.state.view = params.view as ViewId;
      this.stopAnimation();
      this.state.frame = 0;
      this.draw();
    }
    if (typeof params.algo === 'string' && SORT_IDS.includes(params.algo as SortId) && params.algo !== this.state.algo) {
      this.state.algo = params.algo as SortId;
      this.stopAnimation();
      this.state.frame = 0;
      this.draw();
    }
    if (params.graph === 'bfs' || params.graph === 'dfs' || params.graph === 'dijkstra') {
      if (params.graph !== this.state.graph) {
        this.state.graph = params.graph;
        this.stopAnimation();
        this.state.frame = 0;
        this.draw();
      }
    }
    if (typeof params.target === 'number' && Number.isFinite(params.target) && params.target !== this.state.target) {
      this.state.target = Math.trunc(params.target);
      this.draw();
    }
    if (typeof params.frame === 'number' && Number.isFinite(params.frame)) {
      const frame = clamp(Math.round(params.frame), 0, this.frameCount() - 1);
      if (frame !== this.state.frame) {
        this.state.frame = frame;
        this.draw();
      }
    }
    if (actionFired(params, 'play')) this.toggleAnimation();
    if (actionFired(params, 'step')) this.step();
    if (actionFired(params, 'reset')) {
      this.stopAnimation();
      this.state.frame = 0;
      this.draw();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const values = parseArrayInput(await file.text());
    if (values.length === 0) {
      notify(this.api, 'warning', 'No numeric values found in the input.', '输入中没有找到数值。');
      return;
    }
    this.data = values.slice(0, 120);
    this.state.frame = 0;
    this.state.view = 'bars';
    this.draw();
    notify(
      this.api,
      'success',
      `Loaded ${this.data.length} values from ${file.name}.`,
      `已从 ${file.name} 载入 ${this.data.length} 个数值。`,
    );
  }

  compute(input: unknown) {
    const values = Array.isArray(input) ? (input as number[]) : this.data;
    return Promise.resolve({ ok: true as const, output: sortTrace(this.state.algo, values) });
  }

  // ---- animation -------------------------------------------------------------

  private trace(): SortTrace {
    return sortTrace(this.state.algo, this.data);
  }

  /** Number of animation steps for the active view (1 when static). */
  private frameCount(): number {
    if (this.state.view === 'graph') return Math.max(1, graphTrace(this.state.graph).steps.length);
    if (this.state.view === 'compare') return 1;
    return Math.max(1, this.trace().frames.length);
  }

  private currentFrame(): number {
    return clamp(this.state.frame, 0, this.frameCount() - 1);
  }

  private toggleAnimation() {
    if (this.state.view === 'compare') return;
    if (this.timer) {
      this.stopAnimation();
      return;
    }
    const last = this.frameCount() - 1;
    if (this.state.frame >= last) this.state.frame = 0;
    const deadline = last;
    const interval = this.state.view === 'graph' ? 450 : 100;
    this.timer = setInterval(() => {
      if (this.state.frame >= deadline) {
        this.stopAnimation();
        return;
      }
      this.state.frame += 1;
      this.draw();
      emit('host:params:changed', { pluginId: this.manifest.id });
    }, interval);
    this.draw();
  }

  private step() {
    if (this.state.view === 'compare') return;
    this.stopAnimation();
    const last = this.frameCount() - 1;
    this.state.frame = this.state.frame >= last ? 0 : this.state.frame + 1;
    this.draw();
  }

  private stopAnimation() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ---- actions ---------------------------------------------------------------

  private runBenchmark() {
    const bench = runAlgorithmBenchmarks();
    const failed = bench.filter((b) => !b.passed);
    const metrics: ScienceMetric[] = bench.map((b) => ({
      key: `bench-${b.id}`,
      label: this.zh ? b.labelZh : b.labelEn,
      value: fmtMetric(b.relErr),
      severity: b.passed ? 'ok' : 'error',
      hint: `${b.measured} / ${b.expected}`,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      failed.length === 0 ? 'success' : 'warning',
      failed.length === 0
        ? `All ${bench.length} algorithm benchmarks passed.`
        : `${failed.length}/${bench.length} benchmarks failed: ${failed.map((b) => b.id).join(', ')}`,
      failed.length === 0 ? `全部 ${bench.length} 项算法基准通过。` : `${failed.length}/${bench.length} 项基准未通过。`,
    );
  }

  private exportCsv() {
    const trace = this.trace();
    exportRowsCsv(
      this.api,
      `algorithm-${this.state.algo}-trace`,
      ['frame', 'note', 'comparisons', 'swaps', 'index_a', 'index_b', 'array'],
      trace.frames.map((f, i) => [i, f.note, f.comparisons, f.swaps, f.a, f.b, f.array.join(' ')]),
    );
  }

  private async sendToFigure() {
    const trace = this.trace();
    const comparison = SORT_IDS.map((id) => {
      const t = sortTrace(id, this.data);
      return { id, comparisons: t.comparisons, swaps: t.swaps, label: this.zh ? SORT_META[id].zh : SORT_META[id].en };
    });
    const graph = graphTrace(this.state.graph);
    const caption: Bilingual = {
      zh: `算法可视化：${SORT_META[this.state.algo].zh} 在 n=${this.data.length} 上比较 ${trace.comparisons} 次、交换 ${trace.swaps} 次；图算法 ${this.state.graph.toUpperCase()} 访问 ${graph.order.length} 个节点。`,
      en: `${SORT_META[this.state.algo].en} on n=${this.data.length}: ${trace.comparisons} comparisons, ${trace.swaps} swaps; ${this.state.graph.toUpperCase()} visits ${graph.order.length} nodes.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '算法分析', en: 'Algorithm Analysis' },
      caption,
      algorithmsFigurePanels({
        input: this.data,
        comparison,
        graph,
        graphLabel: this.state.graph.toUpperCase(),
        graphNodes: EXAMPLE_GRAPH.nodes,
      }),
    );
  }

  // ---- drawing ---------------------------------------------------------------

  private draw() {
    const frame = prepareCanvas(this.ctx?.canvas2d);
    if (!frame) return;
    const { g, w, h } = frame;
    const zh = this.zh;
    this.publish();
    const trace = this.trace();
    const frames = this.frameCount();
    let subtitle: string;
    if (this.state.view === 'graph') {
      subtitle = zh
        ? `${this.state.graph.toUpperCase()} 图遍历 · 第 ${this.currentFrame() + 1}/${frames} 步`
        : `${this.state.graph.toUpperCase()} graph traversal · step ${this.currentFrame() + 1}/${frames}`;
    } else if (this.state.view === 'compare') {
      subtitle = zh
        ? `${SORT_META[this.state.algo].zh} · n=${this.data.length} · ${SORT_IDS.length} 种排序对比`
        : `${SORT_META[this.state.algo].en} · n=${this.data.length} · ${SORT_IDS.length} sorts compared`;
    } else {
      subtitle = zh
        ? `${SORT_META[this.state.algo].zh} · n=${this.data.length} · 第 ${this.currentFrame() + 1}/${frames} 帧`
        : `${SORT_META[this.state.algo].en} · n=${this.data.length} · frame ${this.currentFrame() + 1}/${frames}`;
    }
    drawHeader(g, w, zh ? '算法可视化器' : 'Algorithm Visualizer', subtitle, zh);

    if (this.state.view === 'graph') this.drawGraph(g, w, h, zh);
    else if (this.state.view === 'compare') this.drawCompare(g, w, h, zh);
    else this.drawBars(g, w, h, zh, trace);
  }

  private publish() {
    const trace = this.trace();
    const sorted = trace.frames.at(-1)?.array ?? [];
    const search = searchTrace('binary', sorted, this.state.target);
    const graph = graphTrace(this.state.graph);
    const metrics: ScienceMetric[] = [
      {
        key: 'comparisons',
        label: 'Comparisons',
        value: fmtMetric(trace.comparisons),
        unit: 'count',
        severity: 'info',
        hint: `${SORT_META[this.state.algo].en} · n=${this.data.length}`,
      },
      {
        key: 'swaps',
        label: 'Swaps / writes',
        value: fmtMetric(trace.swaps),
        unit: 'count',
        severity: 'info',
        hint: this.zh ? '交换或归并写回次数' : 'swaps or merge writes',
      },
      {
        key: 'binary-probes',
        label: 'Binary search probes',
        value: fmtMetric(search.probes),
        unit: 'probe',
        severity: search.index >= 0 ? 'ok' : 'warn',
        hint: `${this.zh ? '目标' : 'target'} ${this.state.target} ${search.index >= 0 ? (this.zh ? '已找到' : 'found') : this.zh ? '未找到' : 'missing'}`,
      },
      {
        key: 'graph-visited',
        label: 'Graph nodes visited',
        value: fmtMetric(graph.order.length),
        unit: 'node',
        severity: graph.order.length === EXAMPLE_GRAPH.nodes.length ? 'ok' : 'warn',
        hint: `${this.state.graph.toUpperCase()} · ${graph.order.join(' → ')}`,
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private drawBars(g: CanvasRenderingContext2D, w: number, h: number, zh: boolean, trace: SortTrace) {
    const f = trace.frames[this.currentFrame()]!;
    const box = plotBox(w, h, 60, 70, 28, 64);
    const max = Math.max(1, ...f.array);
    const min = Math.min(0, ...f.array);
    const barW = box.w / Math.max(1, f.array.length);
    const yOf = (v: number) => box.y1 - ((v - min) / Math.max(1, max - min)) * box.h;

    g.strokeStyle = CS.grid;
    g.strokeRect(box.x0, box.y0, box.w, box.h);
    g.fillStyle = CS.faint;
    g.font = font(false, 9.5);
    g.textAlign = 'right';
    for (let i = 0; i <= 4; i += 1) {
      const value = min + ((max - min) * i) / 4;
      const y = yOf(value);
      g.strokeStyle = CS.grid;
      g.beginPath();
      g.moveTo(box.x0, y);
      g.lineTo(box.x1, y);
      g.stroke();
      g.fillStyle = CS.faint;
      g.fillText(value.toFixed(0), box.x0 - 6, y + 3);
    }

    f.array.forEach((value, i) => {
      const x = box.x0 + i * barW;
      const isSorted = f.sorted.includes(i);
      const isA = i === f.a;
      const isB = i === f.b;
      g.fillStyle = isA ? CS.amber : isB ? CS.red : isSorted ? CS.cyan : CS.blue;
      const y = yOf(value);
      g.fillRect(x + Math.max(1, barW * 0.08), y, Math.max(1, barW * 0.84), box.y1 - y);
      if (barW > 16) {
        g.save();
        g.translate(x + barW / 2, box.y1 - 6);
        g.rotate(-Math.PI / 2);
        g.fillStyle = 'rgba(8,11,16,0.82)';
        g.font = font(false, 9, '600');
        g.textAlign = 'left';
        g.fillText(String(value), 0, 0);
        g.restore();
      }
    });

    drawLegend(g, box.x0, box.y0 - 10, [
      { label: zh ? '当前帧' : 'active', color: CS.amber },
      { label: zh ? '已就位' : 'settled', color: CS.cyan },
      { label: zh ? '未排序' : 'unsorted', color: CS.blue },
    ], zh);

    const cards = [
      [zh ? '比较' : 'comparisons', String(f.comparisons)],
      [zh ? '交换/写入' : 'swaps / writes', String(f.swaps)],
      [zh ? '操作' : 'operation', f.note],
      [zh ? '平均复杂度' : 'average', SORT_META[this.state.algo].average],
    ];
    const cw = (w - 56) / cards.length;
    cards.forEach(([label, value], i) => {
      const x = 28 + i * cw;
      drawCard(g, x, h - 52, cw - 8, 34);
      g.textAlign = 'left';
      g.font = font(zh, 8.5);
      g.fillStyle = CS.faint;
      g.fillText(label!, x + 9, h - 37);
      g.font = font(false, 11, '600');
      g.fillStyle = i === 2 ? CS.amber : CS.text;
      g.fillText(value!, x + 9, h - 24);
    });
  }

  private drawGraph(g: CanvasRenderingContext2D, w: number, h: number, zh: boolean) {
    const trace = graphTrace(this.state.graph);
    const stepIndex = this.currentFrame();
    const step = trace.steps[stepIndex] ?? trace.steps.at(-1)!;
    const box = plotBox(w, h, 48, 66, 26, 52);
    const positions = new Map<string, { x: number; y: number }>([
      ['A', { x: 0.12, y: 0.18 }],
      ['B', { x: 0.62, y: 0.12 }],
      ['C', { x: 0.28, y: 0.55 }],
      ['D', { x: 0.74, y: 0.48 }],
      ['E', { x: 0.5, y: 0.85 }],
      ['F', { x: 0.9, y: 0.78 }],
    ]);
    const px = (x: number) => box.x0 + x * box.w;
    const py = (y: number) => box.y0 + y * box.h;
    const visited = new Set(step.visited);
    const frontier = new Set(step.frontier);
    const orderIndex = new Map(step.visited.map((n, i) => [n, i]));

    drawCard(g, box.x0, box.y0, box.w, box.h);
    for (const edge of EXAMPLE_GRAPH.edges) {
      const a = positions.get(edge.from)!;
      const b = positions.get(edge.to)!;
      const active =
        step.edge !== null &&
        ((step.edge.from === edge.from && step.edge.to === edge.to) ||
          (step.edge.from === edge.to && step.edge.to === edge.from));
      g.strokeStyle = active ? CS.amber : 'rgba(120,200,255,0.28)';
      g.lineWidth = active ? 2.8 : 1.4;
      g.beginPath();
      g.moveTo(px(a.x), py(a.y));
      g.lineTo(px(b.x), py(b.y));
      g.stroke();
      g.fillStyle = active ? CS.amber : 'rgba(255,209,102,0.75)';
      g.font = font(false, 9);
      g.textAlign = 'center';
      g.fillText(String(edge.weight), (px(a.x) + px(b.x)) / 2, (py(a.y) + py(b.y)) / 2 - 4);
    }

    for (const node of EXAMPLE_GRAPH.nodes) {
      const p = positions.get(node)!;
      const isVisited = visited.has(node);
      const isCurrent = step.current === node;
      const isFrontier = frontier.has(node) && !isVisited;
      g.fillStyle = isCurrent
        ? 'rgba(255,209,102,0.95)'
        : isVisited
          ? 'rgba(94,230,208,0.92)'
          : isFrontier
            ? 'rgba(120,200,255,0.22)'
            : 'rgba(30,40,54,0.95)';
      g.strokeStyle = isCurrent ? CS.amber : isVisited ? CS.cyan : isFrontier ? CS.blue : 'rgba(166,180,201,0.55)';
      g.lineWidth = isCurrent ? 2.4 : 1.5;
      g.beginPath();
      g.arc(px(p.x), py(p.y), 17, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (isCurrent) {
        g.strokeStyle = 'rgba(255,209,102,0.45)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(px(p.x), py(p.y), 21, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = isCurrent ? '#101318' : isVisited ? '#081016' : CS.text;
      g.font = font(false, 12, '700');
      g.textAlign = 'center';
      g.fillText(node, px(p.x), py(p.y) + 4);
      const d = step.distances[node] ?? Infinity;
      g.fillStyle = isVisited || isFrontier ? CS.dim : CS.faint;
      g.font = font(false, 9);
      g.fillText(Number.isFinite(d) ? `d=${d}` : '∞', px(p.x), py(p.y) + 31);
      if (isVisited) {
        g.fillStyle = CS.amber;
        g.font = font(false, 8.5);
        g.fillText(`#${(orderIndex.get(node) ?? 0) + 1}`, px(p.x), py(p.y) - 23);
      }
    }

    drawLegend(
      g,
      box.x0,
      box.y0 - 10,
      [
        { label: zh ? '当前' : 'current', color: CS.amber },
        { label: zh ? '已访问' : 'visited', color: CS.cyan },
        { label: zh ? '待访问' : 'frontier', color: CS.blue },
      ],
      zh,
    );

    const frontierText = step.frontier.length > 0 ? step.frontier.join(', ') : zh ? '空' : 'empty';
    drawFootnote(
      g,
      w,
      h,
      zh
        ? `${this.state.graph.toUpperCase()} 第 ${stepIndex + 1}/${trace.steps.length} 步：${step.note} · 待访问 {${frontierText}} · 松弛 ${step.relaxations} 次`
        : `${this.state.graph.toUpperCase()} step ${stepIndex + 1}/${trace.steps.length}: ${step.note} · frontier {${frontierText}} · ${step.relaxations} relaxations`,
      zh,
    );
  }

  private drawCompare(g: CanvasRenderingContext2D, w: number, h: number, zh: boolean) {
    const rows = SORT_IDS.map((id) => {
      const t = sortTrace(id, this.data);
      return [
        zh ? SORT_META[id].zh : SORT_META[id].en,
        SORT_META[id].best,
        SORT_META[id].average,
        t.comparisons,
        t.swaps,
        SORT_META[id].stable ? (zh ? '是' : 'yes') : (zh ? '否' : 'no'),
      ];
    });
    drawTable(
      g,
      w,
      h,
      [
        zh ? '算法' : 'algorithm',
        zh ? '最好' : 'best',
        zh ? '平均' : 'average',
        zh ? '比较' : 'comparisons',
        zh ? '交换/写入' : 'swaps',
        zh ? '稳定' : 'stable',
      ],
      rows,
      { top: 68, highlight: SORT_IDS.indexOf(this.state.algo) },
    );
    const search = searchTrace('binary', sortTrace(this.state.algo, this.data).frames.at(-1)!.array, this.state.target);
    drawFootnote(
      g,
      w,
      h,
      zh
        ? `输入 n=${this.data.length}：${search.index >= 0 ? `二分查找在 ${search.probes} 次探测后于下标 ${search.index} 命中 ${this.state.target}` : `未找到 ${this.state.target}`}。比较/交换为确定性计数，而非墙钟时间。`
        : `n=${this.data.length}: binary search ${search.index >= 0 ? `found ${this.state.target} at index ${search.index} in ${search.probes} probes` : `did not find ${this.state.target}`}. Counts are deterministic, not wall-clock time.`,
      zh,
    );
  }
}

export default function createAlgorithmsPlugin(): Plugin {
  return new AlgorithmsPlugin();
}
