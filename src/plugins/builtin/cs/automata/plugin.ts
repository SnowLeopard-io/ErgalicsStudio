// ==========================================================================
// automata — Automata & Regular Expression Engine
//
// Regex → Thompson NFA → subset-construction DFA → minimised DFA, with a
// character-by-character match trace. The whole pipeline is synchronous and
// deterministic, so Block/Flow payloads behave exactly like the UI.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import {
  CS,
  drawCard,
  drawFootnote,
  drawHeader,
  drawTable,
  font,
  prepareCanvas,
  plotBox,
} from '../../shared/cs-utils';
import { automataFigurePanels } from './figure';
import { automataManifest } from './manifest';
import {
  OTHER_CHAR,
  buildAutomata,
  matchDfa,
  parseAutomataInput,
  runAutomataBenchmarks,
  type AutomataBuild,
  type Dfa,
  type Nfa,
} from './kernel';

export { automataManifest } from './manifest';

type ViewId = 'dfa' | 'nfa' | 'table' | 'match';

interface State {
  pattern: string;
  test: string;
  view: ViewId;
}

export class AutomataPlugin implements Plugin {
  readonly manifest = automataManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private error = '';
  private state: State = { pattern: '(a|b)*abb', test: 'ababb', view: 'dfa' };

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
    return [
      {
        key: 'pattern',
        label: 'Regular expression',
        labelI18n: { 'zh-CN': '正则表达式', 'en-US': 'Regular expression' },
        type: 'text',
        value: s.pattern,
        placeholder: '(a|b)*abb',
        hint: this.zh ? '支持 ., |, ?, *, +, 括号与 [a-z] 类' : 'supports ., |, ?, *, +, parentheses and [a-z]',
      },
      {
        key: 'test',
        label: 'Test string',
        labelI18n: { 'zh-CN': '测试字符串', 'en-US': 'Test string' },
        type: 'text',
        value: s.test,
      },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'dfa', label: this.zh ? 'DFA 状态图' : 'DFA diagram' },
          { value: 'nfa', label: this.zh ? 'Thompson NFA' : 'Thompson NFA' },
          { value: 'table', label: this.zh ? '转移表' : 'Transition table' },
          { value: 'match', label: this.zh ? '匹配轨迹' : 'Match trace' },
        ],
        value: s.view,
      },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准', 'primary'),
      actionButton('exportCsv', 'Export DFA table CSV', '导出 DFA 表 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.pattern === 'string' && params.pattern !== this.state.pattern) {
      this.state.pattern = params.pattern;
      this.draw();
    }
    if (typeof params.test === 'string' && params.test !== this.state.test) {
      this.state.test = params.test.slice(0, 120);
      this.draw();
    }
    if (typeof params.view === 'string' && ['dfa', 'nfa', 'table', 'match'].includes(params.view) && params.view !== this.state.view) {
      this.state.view = params.view as ViewId;
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
    const parsed = parseAutomataInput(await file.text());
    if (!parsed.regex) {
      notify(this.api, 'warning', 'No regex line found (expected “regex: …”).', '未找到正则行（需要 “regex: …”）。');
      return;
    }
    this.state.pattern = parsed.regex;
    if (parsed.tests.length > 0) this.state.test = parsed.tests[0]!;
    this.state.view = 'match';
    this.draw();
    notify(
      this.api,
      'success',
      `Loaded regex “${parsed.regex}” and ${parsed.tests.length} test strings.`,
      `已载入正则 “${parsed.regex}” 与 ${parsed.tests.length} 个测试字符串。`,
    );
  }

  compute(input: unknown) {
    const pattern = typeof input === 'string' ? input : this.state.pattern;
    try {
      return Promise.resolve({ ok: true as const, output: buildAutomata(pattern) });
    } catch (err) {
      return Promise.resolve({ ok: false as const, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ---- model -----------------------------------------------------------------

  private build(): AutomataBuild | null {
    try {
      this.error = '';
      return buildAutomata(this.state.pattern);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      return null;
    }
  }

  private runBenchmark() {
    const bench = runAutomataBenchmarks();
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
      failed.length === 0 ? `All ${bench.length} automata benchmarks passed.` : `${failed.length}/${bench.length} benchmarks failed.`,
      failed.length === 0 ? `全部 ${bench.length} 项自动机基准通过。` : `${failed.length}/${bench.length} 项基准未通过。`,
    );
  }

  private exportCsv() {
    const build = this.build();
    if (!build) {
      notify(this.api, 'warning', 'Fix the regular expression first.', '请先修正正则表达式。');
      return;
    }
    exportRowsCsv(
      this.api,
      'dfa-transition-table',
      ['state', 'accept', ...build.dfa.alphabet.map((c) => (c === OTHER_CHAR ? 'other' : c))],
      build.dfa.states.map((s) => [
        s.id,
        s.accept ? 1 : 0,
        ...build.dfa.alphabet.map((c) => s.trans[c] ?? ''),
      ]),
    );
  }

  private async sendToFigure() {
    const build = this.build();
    if (!build) {
      notify(this.api, 'warning', 'Fix the regular expression first.', '请先修正正则表达式。');
      return;
    }
    const caption: Bilingual = {
      zh: `自动机分析：正则 ${this.state.pattern} 生成 ${build.nfa.states.length} 状态 NFA、${build.dfa.states.length} 状态 DFA，最小化为 ${build.minDfa.states.length} 状态；测试串 “${this.state.test}” ${matches(build, this.state.test) ? '接受' : '拒绝'}。`,
      en: `Automata analysis: /${this.state.pattern}/ → ${build.nfa.states.length}-state NFA, ${build.dfa.states.length}-state DFA, minimised to ${build.minDfa.states.length}; “${this.state.test}” is ${matches(build, this.state.test) ? 'accepted' : 'rejected'}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '正则与自动机', en: 'Regex & Automata' },
      caption,
      automataFigurePanels({ build, test: this.state.test }),
    );
  }

  // ---- drawing ---------------------------------------------------------------

  private draw() {
    const frame = prepareCanvas(this.ctx?.canvas2d);
    if (!frame) return;
    const { g, w, h } = frame;
    const build = this.build();
    this.publish(build);
    drawHeader(
      g,
      w,
      this.zh ? '自动机与正则表达式引擎' : 'Automata & Regular Expression Engine',
      this.zh ? `正则 /${this.state.pattern}/ · 测试 “${this.state.test}”` : `regex /${this.state.pattern}/ · test “${this.state.test}”`,
      this.zh,
    );
    if (!build) {
      g.textAlign = 'center';
      g.fillStyle = CS.red;
      g.font = font(this.zh, 13);
      g.fillText(this.error, w / 2, h / 2);
      return;
    }
    if (this.state.view === 'nfa') this.drawNfa(g, w, h, build.nfa);
    else if (this.state.view === 'table') this.drawTable(g, w, h, build.dfa);
    else if (this.state.view === 'match') this.drawMatch(g, w, h, build);
    else this.drawDfa(g, w, h, build.minDfa, this.zh ? '最小 DFA' : 'minimal DFA');
  }

  private publish(build: AutomataBuild | null) {
    const metrics: ScienceMetric[] = [];
    if (build) {
      const match = matchDfa(build.dfa, this.state.test);
      metrics.push(
        { key: 'nfa-states', label: 'NFA states', value: fmtMetric(build.nfa.states.length), unit: 'state', severity: 'info', hint: 'Thompson construction' },
        { key: 'dfa-states', label: 'DFA states', value: fmtMetric(build.dfa.states.length), unit: 'state', severity: 'info', hint: 'subset construction' },
        { key: 'min-states', label: 'Minimal DFA', value: fmtMetric(build.minDfa.states.length), unit: 'state', severity: 'ok', hint: 'Moore partition refinement' },
        {
          key: 'verdict',
          label: 'Match result',
          value: match.accepted ? (this.zh ? '接受' : 'accept') : this.zh ? '拒绝' : 'reject',
          severity: match.accepted ? 'ok' : 'warn',
          hint: match.failAt >= 0 ? `fail @ ${match.failAt}` : `${this.state.test.length} chars`,
        },
        { key: 'transitions', label: 'DFA transitions', value: fmtMetric(build.dfa.states.reduce((s, st) => s + Object.keys(st.trans).length, 0)), unit: 'edge', severity: 'info' },
      );
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  private drawDfa(g: CanvasRenderingContext2D, w: number, h: number, dfa: Dfa, label: string) {
    const n = dfa.states.length;
    const box = plotBox(w, h, 48, 64, 30, 54);
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const rx = box.w * 0.34;
    const ry = box.h * 0.34;
    const pos = Array.from({ length: n }, (_, i) => {
      if (n === 1) return { x: cx, y: cy };
      const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
    });
    const edges = new Map<string, string[]>();
    for (const s of dfa.states) {
      for (const [symbol, to] of Object.entries(s.trans)) {
        const key = `${s.id}->${to}`;
        const sym = symbol === OTHER_CHAR ? '·' : symbol;
        if (!edges.has(key)) edges.set(key, []);
        edges.get(key)!.push(sym);
      }
    }
    g.lineWidth = 1.2;
    for (const [key, labels] of edges) {
      const [from, to] = key.split('->').map(Number);
      const a = pos[from!]!;
      const b = pos[to!]!;
      g.strokeStyle = 'rgba(120,200,255,0.44)';
      g.beginPath();
      g.moveTo(a.x, a.y);
      if (from === to) {
        g.bezierCurveTo(a.x + 30, a.y - 38, a.x + 50, a.y + 18, a.x + 16, a.y + 8);
      } else {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const nx = -(b.y - a.y);
        const ny = b.x - a.x;
        const norm = Math.hypot(nx, ny) || 1;
        g.quadraticCurveTo(mx + (nx / norm) * 16, my + (ny / norm) * 16, b.x, b.y);
      }
      g.stroke();
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      g.fillStyle = CS.amber;
      g.font = font(false, 9.5, '600');
      g.textAlign = 'center';
      g.fillText(labels.join(','), mid.x, mid.y - 5);
    }
    dfa.states.forEach((s, i) => {
      const p = pos[i]!;
      const accepting = dfa.accept.includes(s.id);
      g.fillStyle = accepting ? 'rgba(94,230,208,0.9)' : 'rgba(25,35,49,0.98)';
      g.strokeStyle = accepting ? CS.cyan : 'rgba(120,200,255,0.8)';
      g.lineWidth = 1.6;
      g.beginPath();
      g.arc(p.x, p.y, 20, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (accepting) {
        g.strokeStyle = CS.cyan;
        g.beginPath();
        g.arc(p.x, p.y, 15, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = accepting ? '#081016' : CS.text;
      g.font = font(false, 11, '700');
      g.textAlign = 'center';
      g.fillText(`q${s.id}`, p.x, p.y + 4);
      if (s.id === dfa.start) {
        g.strokeStyle = CS.amber;
        g.beginPath();
        g.moveTo(p.x - 44, p.y - 30);
        g.lineTo(p.x - 20, p.y - 9);
        g.stroke();
      }
    });
    drawFootnote(
      g,
      w,
      h,
      this.zh
        ? `${label} · ${n} 个状态 · 双圈为接受态 · “·”表示字母表外字符`
        : `${label} · ${n} states · double ring = accepting · “·” = outside the alphabet`,
      this.zh,
    );
  }

  private drawNfa(g: CanvasRenderingContext2D, w: number, h: number, nfa: Nfa) {
    const n = nfa.states.length;
    const box = plotBox(w, h, 54, 64, 34, 54);
    const cols = 6;
    const rows = Math.ceil(n / cols);
    const pos = Array.from({ length: n }, (_, i) => ({
      x: box.x0 + ((i % cols) + 0.5) * (box.w / cols),
      y: box.y0 + (Math.floor(i / cols) + 0.5) * (box.h / Math.max(1, rows)),
    }));
    for (let from = 0; from < n; from += 1) {
      for (const to of nfa.states[from]!.eps) {
        g.strokeStyle = 'rgba(180,140,255,0.42)';
        g.setLineDash([3, 3]);
        g.beginPath();
        g.moveTo(pos[from]!.x, pos[from]!.y);
        g.lineTo(pos[to]!.x, pos[to]!.y);
        g.stroke();
        g.setLineDash([]);
      }
      for (const t of nfa.states[from]!.out) {
        g.strokeStyle = 'rgba(120,200,255,0.5)';
        g.beginPath();
        g.moveTo(pos[from]!.x, pos[from]!.y);
        g.lineTo(pos[t.to]!.x, pos[t.to]!.y);
        g.stroke();
        const label = t.any ? '·' : t.chars.length > 3 ? `${t.chars[0]}…` : t.chars.join(',');
        g.fillStyle = CS.amber;
        g.font = font(false, 8.5);
        g.textAlign = 'center';
        g.fillText(label, (pos[from]!.x + pos[t.to]!.x) / 2, (pos[from]!.y + pos[t.to]!.y) / 2 - 3);
      }
    }
    nfa.states.forEach((_, i) => {
      const p = pos[i]!;
      const accepting = i === nfa.accept;
      g.fillStyle = accepting ? 'rgba(94,230,208,0.9)' : i === nfa.start ? 'rgba(255,209,102,0.9)' : 'rgba(31,25,48,0.98)';
      g.strokeStyle = accepting ? CS.cyan : i === nfa.start ? CS.amber : CS.violet;
      g.beginPath();
      g.arc(p.x, p.y, 13, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = i === nfa.start || accepting ? '#081016' : CS.text;
      g.font = font(false, 9.5, '700');
      g.textAlign = 'center';
      g.fillText(String(i), p.x, p.y + 3.5);
    });
    drawFootnote(
      g,
      w,
      h,
      this.zh
        ? `Thompson NFA：${n} 个状态 · 虚线为 ε 转移 · 黄=开始，青=接受`
        : `Thompson NFA: ${n} states · dashed = ε transitions · amber = start, cyan = accept`,
      this.zh,
    );
  }

  private drawTable(g: CanvasRenderingContext2D, w: number, h: number, dfa: Dfa) {
    const header = ['state', 'accept', ...dfa.alphabet.map((c) => (c === OTHER_CHAR ? 'other' : c))];
    drawTable(
      g,
      w,
      h,
      header,
      dfa.states.map((s) => [
        `q${s.id}`,
        s.accept ? '✓' : '',
        ...dfa.alphabet.map((c) => (s.trans[c] === undefined ? '—' : `q${s.trans[c]}`)),
      ]),
      { top: 66, rowHeight: Math.min(24, (h - 100) / Math.max(1, dfa.states.length)) },
    );
    drawFootnote(g, w, h, this.zh ? '部分 DFA：缺失转移表示进入死状态。' : 'Partial DFA: a missing transition is the dead state.', this.zh);
  }

  private drawMatch(g: CanvasRenderingContext2D, w: number, h: number, build: AutomataBuild) {
    const match = matchDfa(build.dfa, this.state.test);
    const box = plotBox(w, h, 58, 78, 30, 82);
    const chars = [...this.state.test];
    const stepW = Math.min(64, box.w / Math.max(1, chars.length));
    const y = box.y0 + box.h * 0.42;
    g.font = font(false, 17, '700');
    chars.forEach((ch, i) => {
      const x = box.x0 + (i + 0.5) * stepW;
      const step = match.steps[i];
      const ok = step && step.to >= 0;
      g.fillStyle = !ok ? 'rgba(255,139,134,0.9)' : i === chars.length - 1 && match.accepted ? 'rgba(94,230,208,0.9)' : 'rgba(38,50,66,0.98)';
      g.beginPath();
      g.roundRect(x - 18, y - 22, 36, 44, 5);
      g.fill();
      g.fillStyle = CS.text;
      g.textAlign = 'center';
      g.fillText(ch, x, y + 6);
      if (step) {
        g.fillStyle = CS.faint;
        g.font = font(false, 9);
        g.fillText(`q${step.from}→${step.to >= 0 ? `q${step.to}` : '∅'}`, x, y + 40);
        g.font = font(false, 17, '700');
      }
    });
    drawCard(g, box.x0, box.y1 - 36, box.w, 30);
    g.font = font(this.zh, 11, '600');
    g.fillStyle = match.accepted ? CS.green : CS.red;
    g.textAlign = 'center';
    g.fillText(
      match.accepted
        ? this.zh
          ? `接受 “${this.state.test}” — 完整 DFA 模拟在 ${chars.length} 个字符后到达接受态`
          : `Accepted “${this.state.test}” — full DFA simulation reaches an accepting state after ${chars.length} characters`
        : this.zh
          ? `拒绝 “${this.state.test}” — 在第 ${(match.failAt >= 0 ? match.failAt : chars.length) + 1} 个字符处失败`
          : `Rejected “${this.state.test}” — fails at character ${(match.failAt >= 0 ? match.failAt : chars.length) + 1}`,
      (box.x0 + box.x1) / 2,
      box.y1 - 16,
    );
  }
}

function matches(build: AutomataBuild, input: string): boolean {
  return matchDfa(build.dfa, input).accepted;
}

export default function createAutomataPlugin(): Plugin {
  return new AutomataPlugin();
}
