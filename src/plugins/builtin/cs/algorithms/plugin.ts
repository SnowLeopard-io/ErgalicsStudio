// ==========================================================================
// algorithms — Algorithm Visualizer
//
// Step-by-step sorting traces (bars), graph traversal on a fixed weighted
// example graph, and a side-by-side comparison of all sorts on the same
// input. CSV / whitespace numbers are the Block/Flow entry point.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
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
    const trace = this.trace();
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
        max: Math.max(0, trace.frames.length - 1),
        step: 1,
        value: clamp(s.frame, 0, Math.max(0, trace.frames.length - 1)),
        hint: `${s.frame + 1} / ${trace.frames.length}`,
        visibleWhen: { key: 'view', in: ['bars'] },
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
      actionButton('play', 'Play / pause animation', '播放 / 暂停动画', 'primary'),
      actionButton('step', 'Next frame', '下一帧'),
      actionButton('reset', 'Reset animation', '重置动画'),
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('exportCsv', 'Export trace CSV', '导出轨迹 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.view === 'string' && ['bars', 'graph', 'compare'].includes(params.view) && params.view !== this.state.view) {
      this.state.view = params.view as ViewId;
      this.stopAnimation();
      this.draw();
    }
    if (typeof params.algo === 'string' && SORT_IDS.includes(params.algo as SortId) && params.algo !== this.state.algo) {
      this.state.algo = params.algo as SortId;
      this.state.frame = 0;
      this.draw();
    }
    if (params.graph === 'bfs' || params.graph === 'dfs' || params.graph === 'dijkstra') {
      if (params.graph !== this.state.graph) {
        this.state.graph = params.graph;
        this.draw();
      }
    }
    if (typeof params.target === 'number' && Number.isFinite(params.target) && params.target !== this.state.target) {
      this.state.target = Math.trunc(params.target);
      this.draw();
    }
    if (typeof params.frame === 'number' && Number.isFinite(params.frame)) {
      const frame = clamp(Math.round(params.frame), 0, this.trace().frames.length - 1);
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

  private toggleAnimation() {
    if (this.timer) {
      this.stopAnimation();
      return;
    }
    const last = this.trace().frames.length - 1;
    if (this.state.frame >= last) this.state.frame = 0;
    this.timer = setInterval(() => {
      if (this.state.frame >= this.trace().frames.length - 1) {
        this.stopAnimation();
        return;
      }
      this.state.frame += 1;
      this.draw();
    }, 100);
    this.draw();
  }

  private step() {
    this.stopAnimation();
    const last = this.trace().frames.length - 1;
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
    drawHeader(
      g,
      w,
      zh ? '算法可视化器' : 'Algorithm Visualizer',
      zh
        ? `${SORT_META[this.state.algo].zh} · n=${this.data.length} · 第 ${this.state.frame + 1}/${trace.frames.length} 帧`
        : `${SORT_META[this.state.algo].en} · n=${this.data.length} · frame ${this.state.frame + 1}/${trace.frames.length}`,
      zh,
    );

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
    const f = trace.frames[clamp(this.state.frame, 0, trace.frames.length - 1)]!;
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
    const graph = graphTrace(this.state.graph);
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
    drawCard(g, box.x0, box.y0, box.w, box.h);
    for (const edge of EXAMPLE_GRAPH.edges) {
      const a = positions.get(edge.from)!;
      const b = positions.get(edge.to)!;
      g.strokeStyle = 'rgba(120,200,255,0.32)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(px(a.x), py(a.y));
      g.lineTo(px(b.x), py(b.y));
      g.stroke();
      g.fillStyle = CS.amber;
      g.font = font(false, 9);
      g.textAlign = 'center';
      g.fillText(String(edge.weight), (px(a.x) + px(b.x)) / 2, (py(a.y) + py(b.y)) / 2 - 4);
    }
    const orderIndex = new Map(graph.order.map((n, i) => [n, i]));
    for (const node of EXAMPLE_GRAPH.nodes) {
      const p = positions.get(node)!;
      const visited = orderIndex.has(node);
      g.fillStyle = visited ? 'rgba(94,230,208,0.92)' : 'rgba(30,40,54,0.95)';
      g.strokeStyle = visited ? CS.cyan : 'rgba(166,180,201,0.55)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(px(p.x), py(p.y), 17, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = visited ? '#081016' : CS.text;
      g.font = font(false, 12, '700');
      g.textAlign = 'center';
      g.fillText(node, px(p.x), py(p.y) + 4);
      const d = graph.distances[node];
      g.fillStyle = visited ? CS.dim : CS.faint;
      g.font = font(false, 9);
      g.fillText(Number.isFinite(d) ? (this.state.graph === 'dijkstra' ? `d=${d}` : `d=${d}`) : '∞', px(p.x), py(p.y) + 31);
      if (visited) {
        g.fillStyle = CS.amber;
        g.font = font(false, 8.5);
        g.fillText(`#${(orderIndex.get(node) ?? 0) + 1}`, px(p.x), py(p.y) - 23);
      }
    }
    drawFootnote(
      g,
      w,
      h,
      zh
        ? `${this.state.graph.toUpperCase()} 访问顺序：${graph.order.join(' → ')} · 松弛次数 ${graph.relaxations}`
        : `${this.state.graph.toUpperCase()} visit order: ${graph.order.join(' → ')} · ${graph.relaxations} relaxations`,
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
