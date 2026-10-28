// ==========================================================================
// datastructures — Data Structure Lab
//
// BST / AVL / max-heap / separate-chaining hash table with operation history,
// rotation annotations, tree layout and per-step complexity notes.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import {
  CS,
  clamp,
  drawFootnote,
  drawHeader,
  drawTable,
  font,
  prepareCanvas,
  plotBox,
} from '../../shared/cs-utils';
import { dataStructureFigurePanels } from './figure';
import { dataStructuresManifest } from './manifest';
import {
  buildHeap,
  hashTable,
  layoutTree,
  parseTreeOps,
  runDataStructureBenchmarks,
  runTreeOps,
  type TreeOp,
  type TreeStep,
} from './kernel';

export { dataStructuresManifest } from './manifest';

type StructureId = 'bst' | 'avl' | 'heap' | 'hash';
type ViewId = 'structure' | 'history' | 'complexity';
type OpKind = 'insert' | 'delete' | 'search';

const DEFAULT_OPS: TreeOp[] = [
  { op: 'insert', value: 50 },
  { op: 'insert', value: 30 },
  { op: 'insert', value: 70 },
  { op: 'insert', value: 20 },
  { op: 'insert', value: 40 },
  { op: 'insert', value: 60 },
  { op: 'insert', value: 80 },
  { op: 'insert', value: 10 },
  { op: 'insert', value: 25 },
];

const COMPLEXITY: Record<StructureId, { en: string; zh: string; rows: Array<[string, string, string, string]> }> = {
  bst: {
    en: 'Binary search tree',
    zh: '二叉搜索树',
    rows: [
      ['search', 'O(log n)', 'O(n)', 'in-order successor for delete'],
      ['insert', 'O(log n)', 'O(n)', 'leaf insertion'],
      ['delete', 'O(log n)', 'O(n)', 'two children → successor'],
    ],
  },
  avl: {
    en: 'AVL tree',
    zh: 'AVL 树',
    rows: [
      ['search', 'O(log n)', 'O(log n)', 'height ≤ 1.4405 log₂(n+2) − 0.3277'],
      ['insert', 'O(log n)', 'O(log n)', 'at most one rotation pair'],
      ['delete', 'O(log n)', 'O(log n)', 'may rotate up the path'],
    ],
  },
  heap: {
    en: 'Binary max-heap',
    zh: '二叉大根堆',
    rows: [
      ['peek', 'O(1)', 'O(1)', 'root is the maximum'],
      ['insert', 'O(1)', 'O(log n)', 'sift up'],
      ['extract-max', 'O(log n)', 'O(log n)', 'sift down'],
    ],
  },
  hash: {
    en: 'Hash table (chaining)',
    zh: '哈希表（链地址）',
    rows: [
      ['search', 'O(1)', 'O(n)', 'expected vs worst-case chain'],
      ['insert', 'O(1)', 'O(n)', 'append to bucket chain'],
      ['delete', 'O(1)', 'O(n)', 'unlink from chain'],
    ],
  },
};

export class DataStructuresPlugin implements Plugin {
  readonly manifest = dataStructuresManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private ops: TreeOp[] = [...DEFAULT_OPS];
  private state = {
    structure: 'bst' as StructureId,
    view: 'structure' as ViewId,
    op: 'insert' as OpKind,
    value: 35,
    step: this.ops.length - 1,
    buckets: 7,
  };

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    clearScienceOutputs(this.manifest.id);
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

  getParams(): ParamDefinition[] {
    const s = this.state;
    const steps = this.steps();
    return [
      {
        key: 'structure',
        label: 'Data structure',
        labelI18n: { 'zh-CN': '数据结构', 'en-US': 'Data structure' },
        type: 'select',
        options: [
          { value: 'bst', label: this.zh ? '二叉搜索树' : 'BST' },
          { value: 'avl', label: this.zh ? 'AVL 树' : 'AVL tree' },
          { value: 'heap', label: this.zh ? '二叉大根堆' : 'Binary max-heap' },
          { value: 'hash', label: this.zh ? '链地址哈希表' : 'Hash table (chaining)' },
        ],
        value: s.structure,
      },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'structure', label: this.zh ? '结构图' : 'Structure' },
          { value: 'history', label: this.zh ? '操作历史' : 'Operation history' },
          { value: 'complexity', label: this.zh ? '复杂度注释' : 'Complexity notes' },
        ],
        value: s.view,
      },
      {
        key: 'op',
        label: 'Operation',
        labelI18n: { 'zh-CN': '操作', 'en-US': 'Operation' },
        type: 'select',
        options: [
          { value: 'insert', label: this.zh ? '插入' : 'Insert' },
          { value: 'delete', label: this.zh ? '删除' : 'Delete' },
          { value: 'search', label: this.zh ? '查找' : 'Search' },
        ],
        value: s.op,
        visibleWhen: { key: 'view', in: ['structure', 'history'] },
      },
      {
        key: 'value',
        label: 'Key',
        labelI18n: { 'zh-CN': '键值', 'en-US': 'Key' },
        type: 'number',
        step: 1,
        value: s.value,
        visibleWhen: { key: 'view', in: ['structure', 'history'] },
      },
      {
        key: 'step',
        label: 'History step',
        labelI18n: { 'zh-CN': '历史步骤', 'en-US': 'History step' },
        type: 'range',
        min: 0,
        max: Math.max(0, steps.length - 1),
        step: 1,
        value: clamp(s.step, 0, Math.max(0, steps.length - 1)),
        hint: steps.length ? `${this.state.step + 1} / ${steps.length}` : '—',
        visibleWhen: { key: 'structure', notIn: ['complexity'] },
      },
      actionButton('apply', 'Apply operation', '执行操作', 'primary'),
      actionButton('clear', 'Clear structure', '清空结构'),
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('exportCsv', 'Export operations CSV', '导出操作 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    if (typeof params.structure === 'string' && ['bst', 'avl', 'heap', 'hash'].includes(params.structure) && params.structure !== this.state.structure) {
      this.state.structure = params.structure as StructureId;
      this.state.step = Math.max(0, this.steps().length - 1);
      changed = true;
    }
    if (typeof params.view === 'string' && ['structure', 'history', 'complexity'].includes(params.view) && params.view !== this.state.view) {
      this.state.view = params.view as ViewId;
      changed = true;
    }
    if (params.op === 'insert' || params.op === 'delete' || params.op === 'search') {
      if (params.op !== this.state.op) {
        this.state.op = params.op;
        changed = true;
      }
    }
    if (typeof params.value === 'number' && Number.isFinite(params.value)) {
      this.state.value = Math.trunc(params.value);
    }
    if (typeof params.step === 'number' && Number.isFinite(params.step)) {
      const step = clamp(Math.round(params.step), 0, Math.max(0, this.steps().length - 1));
      if (step !== this.state.step) {
        this.state.step = step;
        changed = true;
      }
    }
    if (actionFired(params, 'apply')) {
      this.applyOperation();
      changed = false;
    }
    if (actionFired(params, 'clear')) {
      this.ops = [];
      this.state.step = 0;
      changed = true;
    }
    if (actionFired(params, 'benchmark')) {
      this.runBenchmark();
      return;
    }
    if (actionFired(params, 'exportCsv')) {
      this.exportCsv();
      return;
    }
    if (actionFired(params, 'sendToFigure')) {
      void this.sendToFigure();
      return;
    }
    if (changed) this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const ops = parseTreeOps(await file.text());
    if (ops.length === 0) {
      notify(this.api, 'warning', 'No insert/delete/search rows found.', '未找到 insert/delete/search 操作行。');
      return;
    }
    this.ops = ops.slice(0, 200);
    this.state.step = this.ops.length - 1;
    this.state.view = 'history';
    this.draw();
    notify(
      this.api,
      'success',
      `Loaded ${ops.length} operations from ${file.name}.`,
      `已从 ${file.name} 载入 ${ops.length} 个操作。`,
    );
  }

  compute(input: unknown) {
    const ops = Array.isArray(input) ? (input as TreeOp[]) : this.ops;
    const kind = this.state.structure === 'avl' ? 'avl' : 'bst';
    return Promise.resolve({ ok: true as const, output: runTreeOps(ops, kind) });
  }

  // ---- model -----------------------------------------------------------------

  private isTree() {
    return this.state.structure === 'bst' || this.state.structure === 'avl';
  }

  private steps(): TreeStep[] {
    if (this.isTree()) return runTreeOps(this.ops, this.state.structure === 'avl' ? 'avl' : 'bst');
    return [];
  }

  private currentStep(): TreeStep | null {
    const steps = this.steps();
    if (!steps.length) return null;
    return steps[clamp(this.state.step, 0, steps.length - 1)] ?? null;
  }

  private insertedValues(): number[] {
    return this.ops.filter((o) => o.op === 'insert').map((o) => o.value);
  }

  private applyOperation() {
    this.ops.push({ op: this.state.op, value: this.state.value });
    if (this.isTree()) this.state.step = this.steps().length - 1;
    this.draw();
    if (this.state.op === 'search' && this.isTree()) {
      const step = this.currentStep();
      notify(
        this.api,
        step?.found ? 'success' : 'info',
        step?.found ? `Key ${this.state.value} is present.` : `Key ${this.state.value} is not present.`,
        step?.found ? `键 ${this.state.value} 存在。` : `键 ${this.state.value} 不存在。`,
      );
    }
  }

  private runBenchmark() {
    const bench = runDataStructureBenchmarks();
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
      failed.length === 0 ? `All ${bench.length} data-structure benchmarks passed.` : `${failed.length}/${bench.length} benchmarks failed.`,
      failed.length === 0 ? `全部 ${bench.length} 项数据结构基准通过。` : `${failed.length}/${bench.length} 项基准未通过。`,
    );
  }

  private exportCsv() {
    if (this.isTree()) {
      const steps = this.steps();
      exportRowsCsv(
        this.api,
        `${this.state.structure}-operations`,
        ['step', 'op', 'value', 'found', 'rotations', 'height', 'in_order'],
        steps.map((s) => [s.index, s.op, s.value, s.found === null ? '' : String(s.found), s.rotations.join('; '), s.height, s.order.join(' ')]),
      );
      return;
    }
    const values = this.insertedValues();
    if (this.state.structure === 'heap') {
      const heap = buildHeap(values);
      exportRowsCsv(this.api, 'max-heap', ['index', 'value', 'children'], heap.array.map((v, i) => [i, v, `${2 * i + 1},${2 * i + 2}`]));
      return;
    }
    const hash = hashTable(values, this.state.buckets);
    exportRowsCsv(this.api, 'hash-table', ['bucket', 'chain'], hash.buckets.map((b, i) => [i, b.join(' ')]));
  }

  private async sendToFigure() {
    const steps = this.steps();
    const last = steps.at(-1) ?? null;
    const values = this.insertedValues();
    const caption: Bilingual = {
      zh: `数据结构实验室：${COMPLEXITY[this.state.structure].zh}，${this.ops.length} 次操作；${last ? `最终高度 ${last.height}，中序 ${last.order.join(', ')}` : '结构为空'}。`,
      en: `Data Structure Lab: ${COMPLEXITY[this.state.structure].en}, ${this.ops.length} operations; ${last ? `final height ${last.height}, in-order ${last.order.join(', ')}` : 'empty structure'}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '数据结构分析', en: 'Data Structure Analysis' },
      caption,
      dataStructureFigurePanels({
        kind: this.state.structure,
        steps,
        tree: last?.root ?? null,
        heap: buildHeap(values).array,
        hash: hashTable(values, this.state.buckets),
      }),
    );
  }

  // ---- drawing ---------------------------------------------------------------

  private draw() {
    const frame = prepareCanvas(this.ctx?.canvas2d);
    if (!frame) return;
    const { g, w, h } = frame;
    this.publish();
    drawHeader(
      g,
      w,
      this.zh ? '数据结构实验室' : 'Data Structure Lab',
      this.zh
        ? `${COMPLEXITY[this.state.structure].zh} · ${this.ops.length} 个操作`
        : `${COMPLEXITY[this.state.structure].en} · ${this.ops.length} operations`,
      this.zh,
    );
    if (this.state.view === 'history') this.drawHistory(g, w, h);
    else if (this.state.view === 'complexity') this.drawComplexity(g, w, h);
    else if (this.state.structure === 'heap') this.drawHeap(g, w, h);
    else if (this.state.structure === 'hash') this.drawHash(g, w, h);
    else this.drawTree(g, w, h);
  }

  private publish() {
    const metrics: ScienceMetric[] = [];
    if (this.isTree()) {
      const step = this.currentStep();
      metrics.push(
        {
          key: 'height',
          label: 'Tree height',
          value: fmtMetric(step?.height ?? 0),
          unit: 'level',
          severity: 'info',
          hint: `${this.state.structure.toUpperCase()} · n=${step?.order.length ?? 0}`,
        },
        {
          key: 'rotations',
          label: 'Rotations in step',
          value: fmtMetric(step?.rotations.length ?? 0),
          unit: 'count',
          severity: step?.rotations.length ? 'warn' : 'ok',
          hint: step?.rotations.join('; ') || '—',
        },
        {
          key: 'in-order',
          label: 'In-order sorted',
          value: step ? (step.order.every((v, i, a) => i === 0 || a[i - 1]! <= v) ? 'yes' : 'no') : '—',
          severity: step && step.order.every((v, i, a) => i === 0 || a[i - 1]! <= v) ? 'ok' : 'warn',
          hint: step?.order.join(' ') || 'empty',
        },
      );
    } else if (this.state.structure === 'heap') {
      const heap = buildHeap(this.insertedValues());
      metrics.push(
        { key: 'heap-max', label: 'Heap maximum', value: fmtMetric(heap.array[0] ?? 0), severity: 'ok', hint: 'root of the max-heap' },
        { key: 'heap-size', label: 'Heap size', value: fmtMetric(heap.array.length), unit: 'node', severity: 'info' },
        { key: 'heap-swaps', label: 'Heapify swaps', value: fmtMetric(heap.steps.at(-1)?.swaps ?? 0), unit: 'count', severity: 'info' },
      );
    } else {
      const hash = hashTable(this.insertedValues(), this.state.buckets);
      metrics.push(
        { key: 'load-factor', label: 'Load factor α', value: fmtMetric(hash.loadFactor), severity: hash.loadFactor <= 1 ? 'ok' : 'warn', hint: 'n / bucket count' },
        { key: 'max-chain', label: 'Longest chain', value: fmtMetric(hash.maxChain), unit: 'key', severity: hash.maxChain <= 3 ? 'ok' : 'warn' },
        { key: 'collisions', label: 'Collisions', value: fmtMetric(hash.collisions), unit: 'count', severity: 'info' },
      );
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  private drawTree(g: CanvasRenderingContext2D, w: number, h: number) {
    const step = this.currentStep();
    if (!step || !step.root) {
      drawFootnote(g, w, h, this.zh ? '空树：插入一个键开始。' : 'Empty tree — insert a key to begin.', this.zh);
      return;
    }
    const layout = layoutTree(step.root);
    const box = plotBox(w, h, 54, 60, 30, 62);
    const dx = layout.width > 1 ? box.w / (layout.width - 1) : 0;
    const dy = layout.depth > 1 ? box.h / (layout.depth - 1) : 0;
    const pos = layout.nodes.map((n) => ({
      x: layout.width > 1 ? box.x0 + n.x * dx : box.x0 + box.w / 2,
      y: layout.depth > 1 ? box.y0 + n.y * dy * 0.78 + 18 : box.y0 + box.h / 2,
    }));
    g.lineWidth = 1.3;
    for (const [parent, child] of layout.edges) {
      g.strokeStyle = 'rgba(120,200,255,0.36)';
      g.beginPath();
      g.moveTo(pos[parent]!.x, pos[parent]!.y);
      g.lineTo(pos[child]!.x, pos[child]!.y);
      g.stroke();
    }
    layout.nodes.forEach((node, i) => {
      const p = pos[i]!;
      const active = node.value === step.value;
      g.fillStyle = active ? 'rgba(255,209,102,0.95)' : 'rgba(26,36,50,0.98)';
      g.strokeStyle = active ? CS.amber : 'rgba(120,200,255,0.75)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(p.x, p.y, 18, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = active ? '#0b1017' : CS.text;
      g.font = font(false, 11, '700');
      g.textAlign = 'center';
      g.fillText(String(node.value), p.x, p.y + 4);
      g.fillStyle = CS.faint;
      g.font = font(false, 8);
      g.fillText(`h${node.height}`, p.x, p.y - 23);
    });
    const status = [
      `${this.state.structure.toUpperCase()}`,
      `height ${step.height}`,
      `n ${step.order.length}`,
      step.rotations.length ? step.rotations.join('; ') : this.zh ? '无旋转' : 'no rotations',
    ].join(' · ');
    drawFootnote(g, w, h, status, this.zh);
  }

  private drawHeap(g: CanvasRenderingContext2D, w: number, h: number) {
    const { array } = buildHeap(this.insertedValues());
    const box = plotBox(w, h, 54, 66, 30, 56);
    const n = array.length;
    if (n === 0) {
      drawFootnote(g, w, h, this.zh ? '空堆：插入一个键开始。' : 'Empty heap — insert a key to begin.', this.zh);
      return;
    }
    const levels = Math.floor(Math.log2(n)) + 1;
    const pos = array.map((_, i) => {
      const level = Math.floor(Math.log2(i + 1));
      const first = 2 ** level - 1;
      const count = 2 ** level;
      const index = i - first;
      return {
        x: box.x0 + (box.w * (index + 1)) / (count + 1),
        y: box.y0 + (box.h * (level + 0.6)) / Math.max(1, levels),
      };
    });
    array.forEach((_, i) => {
      if (i === 0) return;
      const parent = (i - 1) >> 1;
      g.strokeStyle = 'rgba(180,140,255,0.4)';
      g.beginPath();
      g.moveTo(pos[parent]!.x, pos[parent]!.y);
      g.lineTo(pos[i]!.x, pos[i]!.y);
      g.stroke();
    });
    array.forEach((value, i) => {
      const p = pos[i]!;
      g.fillStyle = i === 0 ? 'rgba(255,209,102,0.95)' : 'rgba(35,28,58,0.98)';
      g.strokeStyle = i === 0 ? CS.amber : CS.violet;
      g.beginPath();
      g.arc(p.x, p.y, 17, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = i === 0 ? '#0b1017' : CS.text;
      g.font = font(false, 11, '700');
      g.textAlign = 'center';
      g.fillText(String(value), p.x, p.y + 4);
      g.fillStyle = CS.faint;
      g.font = font(false, 8);
      g.fillText(`[${i}]`, p.x, p.y + 30);
    });
    drawFootnote(
      g,
      w,
      h,
      this.zh
        ? `大根堆数组：[${array.join(', ')}] · 父节点 ≥ 子节点，O(log n) 上浮/下沉。`
        : `Max-heap array: [${array.join(', ')}] · parent ≥ children, O(log n) sift up/down.`,
      this.zh,
    );
  }

  private drawHash(g: CanvasRenderingContext2D, w: number, h: number) {
    const hash = hashTable(this.insertedValues(), this.state.buckets);
    const box = plotBox(w, h, 54, 66, 32, 54);
    const rowH = Math.min(34, box.h / Math.max(1, hash.buckets.length));
    hash.buckets.forEach((bucket, i) => {
      const y = box.y0 + i * rowH + rowH / 2;
      g.fillStyle = 'rgba(35,28,58,0.95)';
      g.strokeStyle = 'rgba(180,140,255,0.55)';
      g.beginPath();
      g.roundRect(box.x0, y - 11, 46, 22, 4);
      g.fill();
      g.stroke();
      g.fillStyle = CS.text;
      g.font = font(false, 10, '700');
      g.textAlign = 'center';
      g.fillText(String(i), box.x0 + 23, y + 3.5);
      g.strokeStyle = 'rgba(255,209,102,0.4)';
      g.beginPath();
      g.moveTo(box.x0 + 46, y);
      g.lineTo(box.x0 + 72, y);
      g.stroke();
      bucket.forEach((value, j) => {
        const x = box.x0 + 82 + j * 78;
        g.fillStyle = 'rgba(255,209,102,0.88)';
        g.beginPath();
        g.roundRect(x, y - 11, 62, 22, 4);
        g.fill();
        g.fillStyle = '#0b1017';
        g.font = font(false, 10, '600');
        g.textAlign = 'center';
        g.fillText(String(value), x + 31, y + 3.5);
        if (j > 0) {
          g.strokeStyle = 'rgba(255,209,102,0.5)';
          g.beginPath();
          g.moveTo(x - 16, y);
          g.lineTo(x - 4, y);
          g.stroke();
        }
      });
      if (bucket.length === 0) {
        g.fillStyle = CS.faint;
        g.font = font(false, 9);
        g.textAlign = 'left';
        g.fillText('∅', box.x0 + 82, y + 3.5);
      }
    });
    drawFootnote(
      g,
      w,
      h,
      this.zh
        ? `α = ${hash.loadFactor.toFixed(2)} · 最长链 ${hash.maxChain} · 碰撞 ${hash.collisions} · 探测 ${hash.probes}`
        : `α = ${hash.loadFactor.toFixed(2)} · longest chain ${hash.maxChain} · collisions ${hash.collisions} · probes ${hash.probes}`,
      this.zh,
    );
  }

  private drawHistory(g: CanvasRenderingContext2D, w: number, h: number) {
    const steps = this.steps();
    if (!steps.length) {
      drawFootnote(g, w, h, this.zh ? '尚无树操作历史。' : 'No tree operation history yet.', this.zh);
      return;
    }
    drawTable(
      g,
      w,
      h,
      [this.zh ? '步' : 'step', this.zh ? '操作' : 'op', this.zh ? '值' : 'key', this.zh ? '结果' : 'result', this.zh ? '旋转' : 'rotations', this.zh ? '高度' : 'height', this.zh ? '中序' : 'in-order'],
      steps.map((s) => [
        s.index + 1,
        s.op,
        s.value,
        s.found === null ? '—' : s.found ? (this.zh ? '找到' : 'found') : this.zh ? '未找到' : 'missing',
        s.rotations.join('; ') || '—',
        s.height,
        s.order.join(' '),
      ]),
      { top: 64, highlight: clamp(this.state.step, 0, steps.length - 1), rowHeight: 20 },
    );
  }

  private drawComplexity(g: CanvasRenderingContext2D, w: number, h: number) {
    const info = COMPLEXITY[this.state.structure];
    drawTable(
      g,
      w,
      h,
      [this.zh ? '操作' : 'operation', this.zh ? '平均' : 'average', this.zh ? '最坏' : 'worst', this.zh ? '说明' : 'note'],
      info.rows,
      { top: 70, rowHeight: 30 },
    );
    drawFootnote(
      g,
      w,
      h,
      this.zh
        ? `${info.zh}：复杂度按基本比较/旋转计数，不含内存分配与缓存效应。`
        : `${info.en}: complexities count elementary comparisons/rotations, excluding allocation and cache effects.`,
      this.zh,
    );
  }
}

export default function createDataStructuresPlugin(): Plugin {
  return new DataStructuresPlugin();
}
