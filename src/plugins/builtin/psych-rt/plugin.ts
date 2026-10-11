// ==========================================================================
// psych-rt — in-browser simple reaction-time experiment & statistics
//
// "Run" starts a session: a fixation prompt appears and, after a uniform
// foreperiod (1.5–4 s by default), the circle turns green — press Space as
// fast as possible. Pressing before green voids the trial (false start) but
// consumes the slot, so sessions always terminate. In two-condition mode
// trials alternate A/B so Welch's t test has something to compare. Results:
// sequence dot plot, histogram with normal overlay, box plots, full
// descriptives with exact 95% t CIs, Welch t + Cohen's d. The statistical
// engine lives in kernel.ts (pure, unit-tested); this file owns the session
// state machine and drawing only.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { rtManifest } from './manifest';
import {
  cohensD,
  filterOutliers,
  parseRtData,
  runRtBenchmark,
  summarize,
  welchTest,
} from './kernel';

export { rtManifest } from './manifest';

type Phase = 'idle' | 'wait' | 'go' | 'blank';
type Mode = 'single' | 'two';

interface TrialPoint {
  cond: string;
  rt: number;
}

const FONT = (zh: boolean, px: number) => `${px}px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
const COND_COLOR = (cond: string) =>
  cond === 'B' ? 'rgba(250,180,110,0.95)' : cond === 'C' ? 'rgba(150,220,190,0.95)' : 'rgba(96,168,255,0.95)';

/** Linear-interpolation percentile of an ascending-sorted array. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export class RtPlugin implements Plugin {
  readonly manifest = rtManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;

  // settings
  private mode: Mode = 'two';
  private trialCount = 15;
  private waitMinMs = 1500;
  private waitMaxMs = 4000;
  private outlierMin = 100;
  private outlierMax = 2000;

  // session state
  private phase: Phase = 'idle';
  private totalTrials = 0;
  private falseStarts = 0;
  private trials = new Map<string, number[]>();
  private sequence: TrialPoint[] = [];
  private currentCondition = 'A';
  private goAt = 0;
  private timers: number[] = [];
  private listening = false;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
  }

  async destroy() {
    this.stopSession(false);
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.stopSession(false);
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'mode',
        label: 'Conditions',
        labelI18n: { 'zh-CN': '条件模式', 'en-US': 'Conditions' },
        type: 'select',
        options: [
          { value: 'single', label: this.zh ? '单条件' : 'single', labelI18n: { 'zh-CN': '单条件', 'en-US': 'single' } },
          { value: 'two', label: this.zh ? '双条件（交替 A/B）' : 'two (alternating A/B)', labelI18n: { 'zh-CN': '双条件（交替 A/B）', 'en-US': 'two (alternating A/B)' } },
        ],
        value: this.mode,
      },
      {
        key: 'trialCount',
        label: 'Trials / condition',
        labelI18n: { 'zh-CN': '每条件试次数', 'en-US': 'Trials / condition' },
        type: 'range',
        min: 4,
        max: 50,
        step: 1,
        value: this.trialCount,
      },
      {
        key: 'waitMinMs',
        label: 'Foreperiod min (ms)',
        labelI18n: { 'zh-CN': '等待期下限 (ms)', 'en-US': 'Foreperiod min (ms)' },
        type: 'range',
        min: 500,
        max: 3000,
        step: 100,
        value: this.waitMinMs,
      },
      {
        key: 'waitMaxMs',
        label: 'Foreperiod max (ms)',
        labelI18n: { 'zh-CN': '等待期上限 (ms)', 'en-US': 'Foreperiod max (ms)' },
        type: 'range',
        min: 1000,
        max: 5000,
        step: 100,
        value: this.waitMaxMs,
        hint: this.zh ? '等待期在 [min, max] 均匀随机，防止预期' : 'foreperiod uniform on [min, max] to prevent anticipation',
      },
      {
        key: 'outlierMin',
        label: 'Outlier min (ms)',
        labelI18n: { 'zh-CN': '离群下限 (ms)', 'en-US': 'Outlier min (ms)' },
        type: 'range',
        min: 50,
        max: 300,
        step: 5,
        value: this.outlierMin,
      },
      {
        key: 'outlierMax',
        label: 'Outlier max (ms)',
        labelI18n: { 'zh-CN': '离群上限 (ms)', 'en-US': 'Outlier max (ms)' },
        type: 'range',
        min: 1000,
        max: 3000,
        step: 50,
        value: this.outlierMax,
      },
      actionButton('start', 'Run experiment', '开始实验', 'primary'),
      actionButton('stop', 'Stop', '停止'),
      actionButton('clearData', 'Clear data', '清除数据'),
      actionButton('benchmark', 'Run benchmark', '运行基准验证'),
      actionButton('exportCsv', 'Export trials CSV', '导出试次 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, apply: (n: number) => void): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) apply(params[k] as number);
    };
    num('trialCount', (n) => {
      this.trialCount = Math.min(50, Math.max(4, Math.round(n)));
    });
    num('waitMinMs', (n) => {
      this.waitMinMs = Math.min(3000, Math.max(500, n));
      this.waitMaxMs = Math.max(this.waitMaxMs, this.waitMinMs + 500);
    });
    num('waitMaxMs', (n) => {
      this.waitMaxMs = Math.min(5000, Math.max(1000, n));
      if (this.waitMaxMs < this.waitMinMs + 500) this.waitMaxMs = this.waitMinMs + 500;
    });
    num('outlierMin', (n) => {
      this.outlierMin = Math.min(300, Math.max(50, n));
      this.outlierMax = Math.max(this.outlierMax, this.outlierMin + 100);
    });
    num('outlierMax', (n) => {
      this.outlierMax = Math.min(3000, Math.max(1000, n));
      if (this.outlierMax < this.outlierMin + 100) this.outlierMax = this.outlierMin + 100;
    });
    if (typeof params.mode === 'string' && (params.mode === 'single' || params.mode === 'two') && params.mode !== this.mode) {
      this.stopSession(false);
      this.mode = params.mode as Mode;
    }
    if (actionFired(params, 'start')) this.startExperiment();
    if (actionFired(params, 'stop')) this.stopSession(true);
    if (actionFired(params, 'clearData')) this.clearData();
    if (actionFired(params, 'benchmark')) this.runBenchmarkAction();
    if (actionFired(params, 'exportCsv')) this.exportTrials();
    this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    if (!low.endsWith('.csv') && !low.endsWith('.tsv') && !low.endsWith('.txt')) {
      notify(this.api, 'warning', 'RT plugin accepts CSV/TSV/TXT (condition,rt).', 'RT 插件接受 CSV/TSV/TXT（condition,rt）。');
      return;
    }
    const text = await file.text();
    const ds = parseRtData(text);
    if (!ds) {
      notify(this.api, 'warning', 'No usable RT rows found (need condition,rt columns or a single RT column).', '未找到可用 RT 数据（需 condition,rt 两列或单列 RT）。');
      return;
    }
    this.stopSession(false);
    this.trials.clear();
    this.sequence = [];
    this.falseStarts = 0;
    this.totalTrials = 0;
    for (const grp of ds.groups) {
      this.trials.set(grp.name, [...grp.rts]);
      for (const rt of grp.rts) this.sequence.push({ cond: grp.name, rt });
    }
    notify(
      this.api,
      'success',
      `Loaded ${ds.n} trials in ${ds.groups.length} group(s).`,
      `已载入 ${ds.n} 个试次（${ds.groups.length} 组）。`,
    );
    this.draw();
  }

  // ---- session control ---------------------------------------------------------

  private recordedTotal(): number {
    let n = 0;
    for (const list of this.trials.values()) n += list.length;
    return n;
  }

  private nextCondition(): string {
    if (this.mode === 'single') return 'RT';
    const a = this.trials.get('A')?.length ?? 0;
    const b = this.trials.get('B')?.length ?? 0;
    return a <= b ? 'A' : 'B';
  }

  private pushTimer(id: number) {
    this.timers.push(id);
  }

  private clearTimers() {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
  }

  private startExperiment() {
    if (this.phase !== 'idle') {
      notify(this.api, 'info', 'Session already running — press Stop first.', '实验进行中——请先停止。');
      return;
    }
    this.trials.clear();
    this.sequence = [];
    this.falseStarts = 0;
    this.totalTrials = this.trialCount * (this.mode === 'two' ? 2 : 1);
    this.listening = true;
    window.addEventListener('keydown', this.onKeyDown);
    this.nextTrial();
    this.draw();
  }

  private stopSession(interactive: boolean) {
    this.clearTimers();
    if (this.listening) {
      window.removeEventListener('keydown', this.onKeyDown);
      this.listening = false;
    }
    const wasRunning = this.phase !== 'idle';
    this.phase = 'idle';
    if (interactive && wasRunning) {
      notify(this.api, 'info', 'Session stopped.', '实验已停止。');
      this.draw();
    }
  }

  private finishSession() {
    this.clearTimers();
    if (this.listening) {
      window.removeEventListener('keydown', this.onKeyDown);
      this.listening = false;
    }
    this.phase = 'idle';
    const total = this.recordedTotal();
    notify(
      this.api,
      'success',
      `Session complete: ${total} valid RT(s), ${this.falseStarts} false start(s).`,
      `实验完成：${total} 个有效 RT，${this.falseStarts} 次抢按作废。`,
    );
    this.draw();
  }

  private clearData() {
    this.stopSession(false);
    this.trials.clear();
    this.sequence = [];
    this.falseStarts = 0;
    this.totalTrials = 0;
    notify(this.api, 'info', 'All RT data cleared.', '已清除全部 RT 数据。');
  }

  private nextTrial() {
    if (this.recordedTotal() + this.falseStarts >= this.totalTrials) {
      this.finishSession();
      return;
    }
    this.currentCondition = this.nextCondition();
    this.phase = 'wait';
    const min = this.waitMinMs;
    const max = Math.max(this.waitMaxMs, min + 100);
    const delay = min + Math.random() * (max - min);
    this.pushTimer(window.setTimeout(() => {
      if (this.phase !== 'wait') return;
      this.phase = 'go';
      this.goAt = performance.now();
      this.draw();
    }, delay));
    this.draw();
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || !this.listening) return;
    e.preventDefault();
    if (this.phase === 'wait') {
      // False start: void the trial but consume the slot so the session ends.
      this.clearTimers();
      this.falseStarts += 1;
      this.phase = 'blank';
      this.pushTimer(window.setTimeout(() => {
        if (this.phase === 'blank') this.nextTrial();
      }, 900));
      this.draw();
    } else if (this.phase === 'go') {
      const rt = performance.now() - this.goAt;
      const list = this.trials.get(this.currentCondition) ?? [];
      list.push(rt);
      this.trials.set(this.currentCondition, list);
      this.sequence.push({ cond: this.currentCondition, rt });
      this.phase = 'blank';
      this.pushTimer(window.setTimeout(() => {
        if (this.phase === 'blank') this.nextTrial();
      }, 650));
      this.draw();
    }
  };

  // ---- scientific outputs --------------------------------------------------------

  private publishOutputs() {
    const metrics: ScienceMetric[] = [];
    const done = this.recordedTotal() + this.falseStarts;
    const phaseText =
      this.phase === 'wait' ? (this.zh ? '等待提示' : 'waiting')
      : this.phase === 'go' ? 'GO'
      : this.phase === 'blank' ? (this.zh ? '试次间隔' : 'inter-trial interval')
      : this.zh ? '待机' : 'idle';
    metrics.push({
      key: 'session',
      label: this.zh ? '实验状态' : 'Session',
      value: this.totalTrials > 0 ? `${done}/${this.totalTrials} · ${phaseText}` : phaseText,
      severity: 'info',
      hint: this.zh ? '已消耗试次/总试次（抢按消耗槽位但作废）' : 'consumed/total trials (false starts consume a slot but are voided)',
    });

    const keptLists: Array<{ name: string; kept: number[] }> = [];
    for (const [name, rts] of this.trials) {
      if (rts.length === 0) continue;
      const screen = filterOutliers(rts, this.outlierMin, this.outlierMax);
      const s = summarize(screen.kept);
      if (!s) {
        metrics.push({
          key: `rt-${name}`,
          label: `RT ${name}`,
          value: this.zh ? '有效样本 < 2' : 'n valid < 2',
          severity: 'warn',
        });
        continue;
      }
      keptLists.push({ name, kept: screen.kept });
      metrics.push({
        key: `rt-${name}`,
        label: `RT ${name}`,
        value: `${s.mean.toFixed(1)} ± ${s.ciHalf.toFixed(1)} ms`,
        severity: 'info',
        hint: this.zh
          ? `均值 ± 95% t CI；保留 n=${s.n}/${rts.length}，中位数 ${s.median.toFixed(1)} ms，SD ${s.sd.toFixed(1)} ms`
          : `mean ± 95% t CI; n=${s.n}/${rts.length} kept, median ${s.median.toFixed(1)} ms, SD ${s.sd.toFixed(1)} ms`,
      });
    }

    if (keptLists.length >= 2) {
      const a = keptLists[0]!;
      const b = keptLists[1]!;
      const w = welchTest(a.kept, b.kept);
      if (w) {
        metrics.push({
          key: 'welch-t',
          label: 'Welch t',
          value: fmtMetric(w.t),
          severity: 'info',
          hint: `${this.zh ? 'Satterthwaite 自由度' : 'Satterthwaite df'} = ${w.df.toFixed(1)}`,
        });
        metrics.push({
          key: 'welch-p',
          label: 'p (two-tailed)',
          value: fmtMetric(w.p),
          severity: w.p < 0.05 ? 'ok' : 'info',
          hint: this.zh ? 'p < 0.05 视为两组差异显著' : 'p < 0.05 marked significant',
        });
        const d = cohensD(a.kept, b.kept);
        if (d !== null) {
          metrics.push({
            key: 'cohens-d',
            label: "Cohen's d",
            value: fmtMetric(d),
            severity: 'info',
            hint: this.zh ? '合并 SD 口径；|d| ≥ 0.8 为大效应' : 'pooled-SD convention; |d| ≥ 0.8 is a large effect',
          });
        }
      }
    }

    if (this.falseStarts > 0) {
      metrics.push({
        key: 'false-starts',
        label: this.zh ? '抢按作废' : 'False starts',
        value: String(this.falseStarts),
        severity: 'warn',
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  private runBenchmarkAction() {
    const b = runRtBenchmark();
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-status',
        label: 'Benchmark',
        value: b.pass ? (this.zh ? '全部通过' : 'ALL PASS') : this.zh ? '未通过' : 'FAIL',
        severity: b.pass ? 'ok' : 'error',
        hint: this.zh ? '内嵌 RT 统计基准（非用户数据）' : 'embedded RT statistics battery (not user data)',
      },
      {
        key: 'bench-welch',
        label: this.zh ? 'Welch t 手工算例' : 'Welch t hand example',
        value: `${b.manualT.toFixed(7)} (err ${fmtMetric(b.manualTErr)})`,
        severity: b.manualTErr < 1e-9 ? 'ok' : 'warn',
        hint: this.zh
          ? '[1,2,3,4] vs [5,6,7,8]，解析值 −4·√(6/5) = −4.3817805，判据 < 1e-9'
          : '[1,2,3,4] vs [5,6,7,8], analytic −4·√(6/5) = −4.3817805, criterion < 1e-9',
      },
      {
        key: 'bench-pcrit',
        label: 'p(t=2.447, df=6)',
        value: `|err| ${fmtMetric(b.pCriticalErr)}`,
        severity: b.pCriticalErr < 1e-3 ? 'ok' : 'warn',
        hint: this.zh ? '基准 p = 0.05（精确值 0.049907），判据 < 1e-3' : 'reference p = 0.05 (exact 0.049907), criterion < 1e-3',
      },
      {
        key: 'bench-tq6',
        label: 't₀.₉₇₅,₆',
        value: `${b.tQ6.toFixed(7)} (err ${fmtMetric(b.tQ6Err)})`,
        severity: b.tQ6Err < 1e-6 ? 'ok' : 'warn',
        hint: this.zh ? '基准 2.446911846，判据 < 1e-6' : 'reference 2.446911846, criterion < 1e-6',
      },
      {
        key: 'bench-ci',
        label: '95% CI self-consistency',
        value: b.ciSelfConsistent ? 'PASS' : 'FAIL',
        severity: b.ciSelfConsistent ? 'ok' : 'error',
        hint: '[2,4,4,4,5,5,7,9]: mean=5, sample SD=√(32/7)≈2.1381, median=4.5, CI symmetric',
      },
      {
        key: 'bench-outliers',
        label: 'Outlier screen [100, 2000] ms',
        value: `kept ${b.outlierKept.join(',')} | removed ${b.outlierRemoved.join(',')}`,
        severity: 'info',
        hint: this.zh ? '输入 [50, 250, 300, 5000, 90]' : 'input [50, 250, 300, 5000, 90]',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      b.pass ? 'success' : 'warning',
      `Benchmark ${b.pass ? 'passed' : 'FAILED'}: Welch t err ${fmtMetric(b.manualTErr)}, t₀.₉₇₅,₆ err ${fmtMetric(b.tQ6Err)}`,
      `基准验证${b.pass ? '通过' : '未通过'}：Welch t 误差 ${fmtMetric(b.manualTErr)}，t₀.₉₇₅,₆ 误差 ${fmtMetric(b.tQ6Err)}`,
    );
  }

  private exportTrials() {
    exportRowsCsv(
      this.api,
      'psych-rt-trials',
      ['condition', 'rt_ms'],
      this.sequence.map((p) => [p.cond, Number(p.rt.toFixed(1))]),
    );
  }

  // ---- drawing ----------------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (this.phase !== 'idle') this.drawPrompt(g, canvas);
    else if (this.sequence.length > 0) this.drawResults(g, canvas);
    else this.drawIdle(g, canvas);
    this.publishOutputs();
  }

  private drawPrompt(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const zh = this.zh;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2 - 20;
    const r = Math.min(canvas.width, canvas.height) * 0.14;
    g.textAlign = 'center';
    if (this.phase === 'wait') {
      g.fillStyle = 'rgba(250,180,110,0.9)';
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(230,238,248,0.95)';
      g.font = FONT(zh, 16);
      g.fillText(zh ? '等待变绿……（提前按 = 作废）' : 'Wait for green… (early press voids the trial)', cx, cy + r + 40);
    } else if (this.phase === 'go') {
      g.fillStyle = 'rgba(110,220,140,0.95)';
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#08110c';
      g.font = FONT(zh, 20);
      g.fillText('GO!', cx, cy + 7);
      g.fillStyle = 'rgba(230,238,248,0.95)';
      g.fillText(zh ? '按空格！' : 'Press SPACE!', cx, cy + r + 40);
    } else {
      g.fillStyle = 'rgba(150,165,185,0.9)';
      g.font = FONT(zh, 14);
      g.fillText('…', cx, cy);
    }
    const done = this.recordedTotal() + this.falseStarts;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.font = FONT(zh, 12);
    const total = this.totalTrials;
    g.fillText(
      total > 0
        ? zh
          ? `试次 ${Math.min(done + 1, total)}/${total} · 抢按 ${this.falseStarts}`
          : `trial ${Math.min(done + 1, total)}/${total} · false starts ${this.falseStarts}`
        : '',
      cx,
      canvas.height - 24,
    );
  }

  private drawIdle(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const zh = this.zh;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = FONT(zh, 16);
    g.fillText(zh ? '简单反应时实验' : 'Simple reaction-time experiment', cx, cy - 52);
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.font = FONT(zh, 12);
    g.fillText(
      zh ? '点击「开始实验」后注视圆点，圆点变绿的瞬间按空格键' : 'Click "Run experiment", fixate the dot, press Space the moment it turns green',
      cx,
      cy - 16,
    );
    g.fillText(
      zh ? '变绿前按键记为抢按（试次作废）；统计自动给出 95% CI、Welch t 检验与离群筛查' : 'Pressing before green voids the trial; results include 95% CIs, Welch t and the outlier screen',
      cx,
      cy + 8,
    );
    g.fillText(
      zh ? '也可通过「打开文件」导入 condition,rt 数据直接分析' : 'You can also import condition,rt data via Open File for analysis',
      cx,
      cy + 32,
    );
  }

  private drawResults(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const zh = this.zh;
    const keptPoints = this.sequence.filter((p) => Number.isFinite(p.rt) && p.rt >= this.outlierMin && p.rt <= this.outlierMax);
    const pooled = keptPoints.map((p) => p.rt);
    const perCond = new Map<string, number[]>();
    for (const p of keptPoints) {
      const list = perCond.get(p.cond) ?? [];
      list.push(p.rt);
      perCond.set(p.cond, list);
    }

    g.textAlign = 'left';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = FONT(zh, 13);
    const removed = this.sequence.length - keptPoints.length;
    g.fillText(
      zh
        ? `RT 结果（有效 n=${keptPoints.length}，离群剔除 ${removed}，抢按 ${this.falseStarts}）`
        : `RT results (n=${keptPoints.length} valid, ${removed} outliers removed, ${this.falseStarts} false starts)`,
      44,
      26,
    );

    const top = 44;
    const bottom = canvas.height - 66;
    const hgt = Math.max(80, bottom - top);
    const seqW = Math.max(160, canvas.width * 0.46);
    this.drawSequencePanel(g, 44, top, seqW, hgt, keptPoints);

    const rightX = 44 + seqW + 28;
    const rightW = Math.max(120, canvas.width - rightX - 24);
    const histH = Math.max(70, hgt * 0.55);
    this.drawHistogramPanel(g, rightX, top, rightW, histH, pooled);
    this.drawBoxPanel(g, rightX, top + histH + 18, rightW, Math.max(50, hgt - histH - 18), perCond);
    this.drawStatsFooter(g, canvas, perCond);
  }

  private drawSequencePanel(g: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number, pts: TrialPoint[]) {
    const zh = this.zh;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.9)';
    g.font = FONT(zh, 12);
    g.fillText(zh ? 'RT 序列（试次顺序）' : 'RT sequence (trial order)', ox + w / 2, oy - 6);

    let maxRt = 200;
    for (const p of pts) if (p.rt > maxRt) maxRt = p.rt;
    const yMax = maxRt * 1.06;
    const px = (i: number) => ox + (w * i) / Math.max(1, pts.length - 1);
    const py = (rt: number) => oy + h - (h * rt) / yMax;

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(ox, oy, w, h);

    g.textAlign = 'right';
    g.font = '9px Consolas, monospace';
    const step = yMax <= 1200 ? 250 : 500;
    for (let v = 0; v <= yMax; v += step) {
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.beginPath();
      g.moveTo(ox, py(v));
      g.lineTo(ox + w, py(v));
      g.stroke();
      g.fillStyle = 'rgba(140,152,170,0.85)';
      g.fillText(String(v), ox - 4, py(v) + 3);
    }

    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i]!;
      g.fillStyle = COND_COLOR(p.cond);
      g.beginPath();
      g.arc(px(i), py(p.rt), 2.6, 0, Math.PI * 2);
      g.fill();
    }
    const s = summarize(pts.map((p) => p.rt));
    if (s) {
      g.strokeStyle = 'rgba(120,220,190,0.8)';
      g.setLineDash([5, 4]);
      g.beginPath();
      g.moveTo(ox, py(s.mean));
      g.lineTo(ox + w, py(s.mean));
      g.stroke();
      g.setLineDash([]);
    }
    g.textAlign = 'left';
    g.fillStyle = 'rgba(140,152,170,0.85)';
    g.font = '9px Consolas, monospace';
    g.fillText('ms', ox + 4, oy + 10);
  }

  private drawHistogramPanel(g: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number, pooled: number[]) {
    const zh = this.zh;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.9)';
    g.font = FONT(zh, 12);
    g.fillText(zh ? 'RT 直方图 + 正态叠加' : 'RT histogram + normal overlay', ox + w / 2, oy - 6);

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(ox, oy, w, h);
    if (pooled.length < 3) return;

    let lo = Math.min(...pooled);
    let hi = Math.max(...pooled);
    if (hi - lo < 10) {
      lo -= 25;
      hi += 25;
    }
    const bins = 14;
    const bw = (hi - lo) / bins;
    const counts = new Array<number>(bins).fill(0);
    for (const rt of pooled) {
      let b = Math.floor((rt - lo) / bw);
      if (b < 0) b = 0;
      if (b >= bins) b = bins - 1;
      counts[b] = (counts[b] ?? 0) + 1;
    }
    const maxCount = Math.max(...counts, 1);
    const barW = w / bins;
    for (let b = 0; b < bins; b += 1) {
      const c = counts[b] ?? 0;
      if (c === 0) continue;
      const bh = h * (c / maxCount) * 0.92;
      g.fillStyle = 'rgba(96,168,255,0.35)';
      g.fillRect(ox + b * barW + 1, oy + h - bh, barW - 2, bh);
      g.strokeStyle = 'rgba(96,168,255,0.8)';
      g.strokeRect(ox + b * barW + 1, oy + h - bh, barW - 2, bh);
    }
    // Normal overlay scaled to expected per-bin counts: n · binWidth · pdf(x).
    const s = summarize(pooled);
    if (s) {
      g.strokeStyle = 'rgba(250,180,110,0.95)';
      g.lineWidth = 1.8;
      g.beginPath();
      const n = 120;
      for (let i = 0; i <= n; i += 1) {
        const x = lo + ((hi - lo) * i) / n;
        const z = (x - s.mean) / s.sd;
        const dens = Math.exp(-0.5 * z * z) / (s.sd * Math.sqrt(2 * Math.PI));
        const y = Math.min(oy + 2, oy + h - (h * (pooled.length * bw * dens)) / maxCount * 0.92);
        if (i === 0) g.moveTo(ox + (w * i) / n, y);
        else g.lineTo(ox + (w * i) / n, y);
      }
      g.stroke();
      g.lineWidth = 1;
    }
    g.textAlign = 'left';
    g.font = '9px Consolas, monospace';
    g.fillStyle = 'rgba(140,152,170,0.85)';
    g.fillText(`${Math.round(lo)}–${Math.round(hi)} ms`, ox + 4, oy + h + 12);
  }

  private drawBoxPanel(g: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number, perCond: Map<string, number[]>) {
    const zh = this.zh;
    const groups = [...perCond.entries()].filter(([, rts]) => rts.length >= 2).slice(0, 4);
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.9)';
    g.font = FONT(zh, 12);
    g.fillText(zh ? '条件箱线图（须 = 极值）' : 'Box plots (whiskers = min/max)', ox + w / 2, oy - 6);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(ox, oy, w, h);
    if (groups.length === 0) return;

    let lo = Infinity;
    let hi = -Infinity;
    for (const [, rts] of groups) {
      for (const v of rts) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const pad = Math.max(10, (hi - lo) * 0.06);
    const xLo = lo - pad;
    const xHi = hi + pad;
    const px = (v: number) => ox + (w * (v - xLo)) / (xHi - xLo);
    const rowH = h / groups.length;
    for (let gi = 0; gi < groups.length; gi += 1) {
      const [name, rts] = groups[gi]!;
      const sorted = [...rts].sort((a, b) => a - b);
      const q1 = quantile(sorted, 0.25);
      const med = quantile(sorted, 0.5);
      const q3 = quantile(sorted, 0.75);
      const min = sorted[0]!;
      const max = sorted[sorted.length - 1]!;
      const cy = oy + rowH * gi + rowH / 2;
      const color = COND_COLOR(name);
      g.strokeStyle = color;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(px(min), cy);
      g.lineTo(px(max), cy);
      g.stroke();
      const bx1 = px(q1);
      const bx2 = px(q3);
      g.fillStyle = color.replace('0.95', '0.30');
      g.fillRect(bx1, cy - rowH * 0.26, Math.max(2, bx2 - bx1), rowH * 0.52);
      g.strokeRect(bx1, cy - rowH * 0.26, Math.max(2, bx2 - bx1), rowH * 0.52);
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.moveTo(px(med), cy - rowH * 0.26);
      g.lineTo(px(med), cy + rowH * 0.26);
      g.stroke();
      g.lineWidth = 1;
      g.textAlign = 'right';
      g.fillStyle = 'rgba(200,210,225,0.95)';
      g.font = '10px Consolas, monospace';
      g.fillText(`${name} (n=${rts.length})`, ox + w - 4, cy + 3);
    }
  }

  private drawStatsFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, perCond: Map<string, number[]>) {
    const zh = this.zh;
    g.textAlign = 'left';
    g.font = FONT(zh, 11);
    const parts: string[] = [];
    const keptLists: Array<{ name: string; kept: number[] }> = [];
    for (const [name, rts] of perCond) {
      const s = summarize(rts);
      if (!s) continue;
      keptLists.push({ name, kept: rts });
      parts.push(`${name}: ${s.mean.toFixed(1)}±${s.ciHalf.toFixed(1)} ms (med ${s.median.toFixed(0)}, n=${s.n})`);
    }
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(parts.join('   '), 44, canvas.height - 46);
    let line2: string;
    if (keptLists.length >= 2) {
      const a = keptLists[0]!;
      const b = keptLists[1]!;
      const w = welchTest(a.kept, b.kept);
      const d = cohensD(a.kept, b.kept);
      line2 = w
        ? `Welch t=${w.t.toFixed(3)}, df=${w.df.toFixed(1)}, p=${w.p < 0.0001 ? w.p.toExponential(2) : w.p.toFixed(4)}${d !== null ? `, d=${d.toFixed(3)}` : ''}`
        : zh ? 'Welch 检验不可用（每组需 ≥ 2 个有效 RT）' : 'Welch test unavailable (need ≥ 2 valid RTs per condition)';
    } else {
      line2 = zh ? '两组各 ≥ 2 个有效 RT 后给出 Welch t 检验' : 'Welch t appears once two conditions hold ≥ 2 valid RTs each';
    }
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.fillText(line2, 44, canvas.height - 26);
  }
}

export default function createRtPlugin(): Plugin {
  return new RtPlugin();
}
