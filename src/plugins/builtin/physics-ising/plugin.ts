// ==========================================================================
// physics-ising — 2-D Ising model laboratory (plugin shell)
//
// Left panel: spin-configuration heat map (nearest-neighbour upscale with
// smoothing disabled). Right panel: susceptibility curve from the chunked
// async temperature sweep, with the Onsager Tc reference line and the fitted
// chi-peak position. Single-temperature runs publish chi / C / U4 / <|m|> /
// E per spin (plus the exact 2x2 cross-check when L = 2, H = 0); sweeps
// publish the fitted Tc with an FWHM-derived uncertainty and its relative
// error against Onsager.
//
// All numerics live in kernel.ts (pure, unit-tested). This file is UI only.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { isingFigurePanels } from './figure';
import { isingManifest } from './manifest';
import {
  ONSAGER_TC,
  estimateTcFromChi,
  exact2x2,
  onsagerMagnetization,
  runIsingPoint,
  type IsingAlgorithm,
  type IsingResult,
  type TcEstimate,
} from './kernel';

export { isingManifest } from './manifest';

const relErr = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

const ALGORITHMS: Array<{ value: IsingAlgorithm; en: string; zh: string }> = [
  { value: 'auto', en: 'Auto (Wolff near Tc)', zh: '自动（近 Tc 用 Wolff 团簇）' },
  { value: 'wolff', en: 'Wolff single-cluster', zh: 'Wolff 单团簇' },
  { value: 'metropolis', en: 'Metropolis', zh: 'Metropolis 单自旋' },
];

/** One recorded sweep point (T ascending as generated). */
interface ScanPoint {
  T: number;
  chi: number;
  heat: number;
  binder: number;
  absM: number;
  energy: number;
  algorithm: 'metropolis' | 'wolff';
}

interface State {
  L: number;
  T: number;
  J: number;
  H: number;
  algorithm: IsingAlgorithm;
  thermSweeps: number;
  measureSweeps: number;
  seed: number;
  scanT1: number;
  scanT2: number;
  scanPoints: number;
}

export class IsingPlugin implements Plugin {
  readonly manifest = isingManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;

  private state: State = {
    L: 64,
    T: 2.27,
    J: 1,
    H: 0,
    algorithm: 'auto',
    thermSweeps: 150,
    measureSweeps: 400,
    seed: 42,
    scanT1: 1.5,
    scanT2: 3.5,
    scanPoints: 21,
  };

  private last: IsingResult | null = null;
  private scan: ScanPoint[] = [];
  private tc: TcEstimate | null = null;
  private scanning = false;
  private scanDone = 0;
  private scanTotal = 0;
  private scanToken = 0;
  private heatCanvas: HTMLCanvasElement | null = null;
  private heatL = 0;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    this.cancelScan();
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    this.ensureResult();
    this.draw();
  }

  async deactivate() {
    // The temperature sweep keeps computing in the background (results and a
    // completion notification are published regardless); drawing is suppressed
    // by the isActive guard inside draw().
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.ensureResult();
    this.draw();
  }

  // ---- derived data ---------------------------------------------------------

  private ensureResult() {
    if (!this.last && !this.scanning) this.runSingle(true);
  }

  // ---- parameter panel ------------------------------------------------------

  getParams(): ParamDefinition[] {
    const s = this.state;
    const zh = this.zh;
    return [
      {
        key: 'L',
        label: 'L (lattice size)',
        labelI18n: { 'zh-CN': '格子边长 L', 'en-US': 'L (lattice size)' },
        type: 'range',
        min: 2,
        max: 128,
        step: 2,
        value: s.L,
        hint: zh ? '偶数边长，上限 128' : 'even sizes up to 128',
      },
      {
        key: 'T',
        label: 'T (temperature)',
        labelI18n: { 'zh-CN': '温度 T（J/k_B）', 'en-US': 'T (temperature)' },
        type: 'range',
        min: 0.5,
        max: 5,
        step: 0.05,
        value: s.T,
        hint: zh ? 'k_B = 1，Onsager Tc = 2.269 J/k_B' : 'k_B = 1, Onsager Tc = 2.269 J/k_B',
      },
      {
        key: 'J',
        label: 'J (coupling)',
        labelI18n: { 'zh-CN': '耦合强度 J', 'en-US': 'J (coupling)' },
        type: 'range',
        min: 0.5,
        max: 2,
        step: 0.05,
        value: s.J,
      },
      {
        key: 'H',
        label: 'H (external field)',
        labelI18n: { 'zh-CN': '外场 H', 'en-US': 'H (external field)' },
        type: 'range',
        min: -1,
        max: 1,
        step: 0.05,
        value: s.H,
        hint: zh ? 'H ≠ 0 时自动退回 Metropolis' : 'H ≠ 0 falls back to Metropolis',
      },
      {
        key: 'algorithm',
        label: 'Algorithm',
        labelI18n: { 'zh-CN': '算法', 'en-US': 'Algorithm' },
        type: 'select',
        options: ALGORITHMS.map((a) => ({ value: a.value, label: zh ? a.zh : a.en, labelI18n: { 'zh-CN': a.zh, 'en-US': a.en } })),
        value: s.algorithm,
      },
      { key: 'thermSweeps', label: 'Thermalisation sweeps', labelI18n: { 'zh-CN': '热化扫数', 'en-US': 'Thermalisation sweeps' }, type: 'range', min: 0, max: 1000, step: 50, value: s.thermSweeps, group: 'mc' },
      { key: 'measureSweeps', label: 'Measurement samples', labelI18n: { 'zh-CN': '测量样本数', 'en-US': 'Measurement samples' }, type: 'range', min: 50, max: 4000, step: 50, value: s.measureSweeps, group: 'mc', hint: zh ? 'Wolff：每样本为固定次数团簇翻转' : 'Wolff: each sample is a fixed number of cluster flips' },
      { key: 'seed', label: 'RNG seed', labelI18n: { 'zh-CN': '随机种子', 'en-US': 'RNG seed' }, type: 'number', min: 0, step: 1, value: s.seed, group: 'mc' },
      { key: 'scanT1', label: 'Sweep T from', labelI18n: { 'zh-CN': '扫温起点 T', 'en-US': 'Sweep T from' }, type: 'range', min: 0.5, max: 5, step: 0.05, value: s.scanT1, group: 'scan' },
      { key: 'scanT2', label: 'Sweep T to', labelI18n: { 'zh-CN': '扫温终点 T', 'en-US': 'Sweep T to' }, type: 'range', min: 0.5, max: 5, step: 0.05, value: s.scanT2, group: 'scan' },
      { key: 'scanPoints', label: 'Sweep points', labelI18n: { 'zh-CN': '扫温点数', 'en-US': 'Sweep points' }, type: 'range', min: 5, max: 81, step: 2, value: s.scanPoints, group: 'scan' },
      actionButton('run', 'Run single point', '单点模拟', 'primary'),
      actionButton('scan', 'Run T sweep', '温度扫描', 'primary'),
      actionButton('stop', 'Stop sweep', '停止扫描'),
      actionButton('export', 'Export CSV', '导出 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.state;
    let latticeChanged = false; // L: invalidates the stored configuration
    let ensembleChanged = false; // J / algorithm: invalidates a sweep curve

    if (typeof params.algorithm === 'string' && ALGORITHMS.some((a) => a.value === params.algorithm) && params.algorithm !== s.algorithm) {
      s.algorithm = params.algorithm as IsingAlgorithm;
      ensembleChanged = true;
    }

    const num = (k: keyof State, cb: (n: number) => void): void => {
      const v = params[k as string];
      if (typeof v === 'number' && Number.isFinite(v)) cb(v);
    };
    num('L', (n) => {
      const v = Math.min(128, Math.max(2, Math.round(n / 2) * 2));
      if (v !== s.L) {
        s.L = v;
        latticeChanged = true;
      }
    });
    num('T', (n) => {
      const v = Math.min(5, Math.max(0.1, n));
      if (v !== s.T) s.T = v;
    });
    num('J', (n) => {
      if (n !== s.J) {
        s.J = n;
        ensembleChanged = true;
      }
    });
    num('H', (n) => {
      if (n !== s.H) s.H = n;
    });
    num('thermSweeps', (n) => {
      const v = Math.round(n);
      if (v !== s.thermSweeps) s.thermSweeps = v;
    });
    num('measureSweeps', (n) => {
      const v = Math.round(n);
      if (v !== s.measureSweeps) s.measureSweeps = v;
    });
    num('seed', (n) => {
      const v = Math.round(n);
      if (v !== s.seed) s.seed = v;
    });
    num('scanT1', (n) => {
      if (n !== s.scanT1) s.scanT1 = n;
    });
    num('scanT2', (n) => {
      if (n !== s.scanT2) s.scanT2 = n;
    });
    num('scanPoints', (n) => {
      const v = Math.round(n);
      if (v !== s.scanPoints) s.scanPoints = v;
    });

    if (latticeChanged) {
      this.last = null;
      this.scan = [];
      this.tc = null;
      this.heatCanvas = null;
      this.runSingle(true);
    } else if (ensembleChanged) {
      this.scan = [];
      this.tc = null;
      setScienceOutputs(this.manifest.id, []);
      this.draw();
    }

    if (actionFired(params, 'run')) this.runSingle();
    if (actionFired(params, 'scan')) {
      if (this.scanning) {
        notify(this.api, 'info', 'A sweep is already running.', '扫描已在进行中。');
      } else {
        this.startScan();
      }
    }
    if (actionFired(params, 'stop')) {
      if (this.scanning) {
        this.cancelScan();
        notify(this.api, 'warning', 'Sweep cancelled.', '扫描已取消。');
        this.draw();
      }
    }
    if (actionFired(params, 'export')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  // ---- simulations ----------------------------------------------------------

  private runSingle(silent = false): void {
    const s = this.state;
    const r = runIsingPoint({
      L: s.L,
      T: s.T,
      J: s.J,
      H: s.H,
      thermSweeps: s.thermSweeps,
      measureSweeps: s.measureSweeps,
      seed: s.seed,
      algorithm: s.algorithm,
    });
    this.last = r;
    this.publishSingle();
    if (!silent) {
      notify(
        this.api,
        'success',
        `Single point done: L=${r.L}, T=${r.T.toFixed(2)} (${r.algorithmUsed === 'wolff' ? 'Wolff' : 'Metropolis'}).`,
        `单点模拟完成：L=${r.L}，T=${r.T.toFixed(2)}（${r.algorithmUsed === 'wolff' ? 'Wolff' : 'Metropolis'}）。`,
      );
    }
    this.api.log('info', 'ising single point', { T: r.T, chi: r.chi, binder: r.binder, algorithm: r.algorithmUsed });
    this.draw();
  }

  /**
   * Chunked asynchronous temperature sweep. Each setTimeout tick spends at
   * most ~40 ms computing so the UI thread stays responsive; the token id
   * cancels stale chains, and draw() suppresses itself while backgrounded.
   */
  private startScan(): void {
    const s = this.state;
    const p = Math.max(3, Math.round(s.scanPoints));
    const T1 = Math.min(s.scanT1, s.scanT2);
    const T2 = Math.max(s.scanT1, s.scanT2);
    this.scan = [];
    this.tc = null;
    this.scanTotal = p;
    this.scanDone = 0;
    this.scanning = true;
    const token = ++this.scanToken;
    const step = p > 1 ? (T2 - T1) / (p - 1) : 0;
    this.api.log('info', 'ising sweep started', { points: p, T1, T2, L: s.L });
    const chunk = (): void => {
      if (token !== this.scanToken) return; // cancelled or superseded
      const t0 = Date.now();
      while (this.scanDone < p && Date.now() - t0 < 40) {
        const T = T1 + step * this.scanDone;
        const r = runIsingPoint({
          L: s.L,
          T,
          J: s.J,
          H: s.H,
          thermSweeps: s.thermSweeps,
          measureSweeps: s.measureSweeps,
          seed: s.seed + this.scanDone * 7919,
          algorithm: s.algorithm,
        });
        this.scan.push({
          T: r.T,
          chi: r.chi,
          heat: r.heatCapacity,
          binder: r.binder,
          absM: r.absM,
          energy: r.energyPerSpin,
          algorithm: r.algorithmUsed,
        });
        this.scanDone++;
      }
      this.draw(); // no-op while the plugin is backgrounded
      if (this.scanDone < p) {
        setTimeout(chunk, 0);
        return;
      }
      this.scanning = false;
      this.tc = estimateTcFromChi(this.scan.map((q) => ({ T: q.T, chi: q.chi })));
      this.publishScan();
      this.draw();
      this.api.log('info', 'ising sweep finished', { points: this.scanDone, tc: this.tc?.tc ?? null });
      const zh = this.zh;
      const msg = this.tc
        ? zh
          ? `扫温完成：Tc = ${this.tc.tc.toFixed(3)} ± ${this.tc.tcErr.toFixed(3)}（Onsager ${(ONSAGER_TC * s.J).toFixed(3)}）`
          : `Sweep finished: Tc = ${this.tc.tc.toFixed(3)} ± ${this.tc.tcErr.toFixed(3)} (Onsager ${(ONSAGER_TC * s.J).toFixed(3)})`
        : zh
          ? '扫温完成，但 χ 峰位无法拟合。'
          : 'Sweep finished, but the χ peak could not be fitted.';
      this.api.notify('success', msg, { label: zh ? '查看结果' : 'View results', run: () => this.draw() });
    };
    setTimeout(chunk, 0);
  }

  private cancelScan(): void {
    this.scanToken++;
    this.scanning = false;
  }

  // ---- scientific outputs ---------------------------------------------------

  private publishSingle(): void {
    const r = this.last;
    if (!r) return;
    const zh = this.zh;
    const metrics: ScienceMetric[] = [
      {
        key: 'chi',
        label: zh ? '磁化率 χ' : 'Susceptibility χ',
        value: fmtMetric(r.chi),
        severity: 'info',
        hint: 'χ = βN(⟨m²⟩ − ⟨|m|⟩²)',
      },
      {
        key: 'C',
        label: zh ? '比热 C' : 'Heat capacity C',
        value: fmtMetric(r.heatCapacity),
        severity: 'info',
        hint: 'C = β²(⟨E²⟩ − ⟨E⟩²)/N',
      },
      {
        key: 'U4',
        label: 'Binder U₄',
        value: fmtMetric(r.binder),
        severity: 'info',
        hint: zh
          ? 'U₄ = 1 − ⟨m⁴⟩/(3⟨m²⟩²)，2-D Ising 的 Tc 处 ≈ 0.61'
          : 'U₄ = 1 − ⟨m⁴⟩/(3⟨m²⟩²), ≈ 0.61 at the 2-D Ising Tc',
      },
      { key: 'absM', label: zh ? '平均磁化 ⟨|m|⟩' : 'Mean |m|', value: fmtMetric(r.absM), severity: 'info' },
      { key: 'E', label: zh ? '每自旋能量 E/N' : 'Energy per spin E/N', value: fmtMetric(r.energyPerSpin), severity: 'info' },
    ];
    if (r.L === 2 && this.state.H === 0) {
      const ex = exact2x2(r.T, this.state.J);
      const err = relErr(r.absM, ex.absM);
      metrics.push({
        key: 'exact2x2',
        label: zh ? '|m| 相对误差（2×2 精确解）' : '|m| rel err (exact 2×2)',
        value: fmtMetric(err * 100),
        unit: '%',
        severity: err < 0.02 ? 'ok' : 'warn',
        hint: zh
          ? `对照闭式解 <|m|> = (2e^{8K}+4)/Z = ${fmtMetric(ex.absM)}`
          : `vs closed form <|m|> = (2e^{8K}+4)/Z = ${fmtMetric(ex.absM)}`,
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  private publishScan(): void {
    if (this.scan.length === 0) return;
    const zh = this.zh;
    const metrics: ScienceMetric[] = [];
    if (this.tc) {
      const ref = ONSAGER_TC * this.state.J;
      const err = relErr(this.tc.tc, ref);
      const absDev = Math.abs(this.tc.tc - ref);
      metrics.push({
        key: 'tc',
        label: zh ? 'Tc（χ 峰拟合）' : 'Tc (χ-peak fit)',
        value: `${fmtMetric(this.tc.tc)} ± ${fmtMetric(this.tc.tcErr)}`,
        unit: 'J/k_B',
        severity: absDev < 0.05 ? 'ok' : absDev < 0.15 ? 'info' : 'warn',
        hint: zh
          ? `抛物线顶点拟合 ± FWHM/4；Onsager 精确值 ${ref.toFixed(4)}`
          : `parabolic-vertex fit ± FWHM/4; exact Onsager value ${ref.toFixed(4)}`,
      });
      metrics.push({
        key: 'tc-err',
        label: zh ? 'Tc 相对误差' : 'Tc rel err',
        value: fmtMetric(err * 100),
        unit: '%',
        severity: err < 0.03 ? 'ok' : err < 0.08 ? 'info' : 'warn',
        hint: zh ? '统一口径 |计算-解析|/|解析|，解析值取 Onsager Tc' : 'unified |calc-analytic|/|analytic| against the Onsager Tc',
      });
      let best = this.scan[0]!;
      let bd = Infinity;
      for (const q of this.scan) {
        const d = Math.abs(q.T - this.tc.tc);
        if (d < bd) {
          bd = d;
          best = q;
        }
      }
      metrics.push({
        key: 'binder-tc',
        label: 'U₄(Tc)',
        value: fmtMetric(best.binder),
        severity: best.binder > 0.55 && best.binder < 0.67 ? 'ok' : 'info',
        hint: zh
          ? '2-D Ising 普适窗口 (0.55, 0.67)（Binder 1981）'
          : 'universal 2-D Ising window (0.55, 0.67) (Binder 1981)',
      });
    }
    metrics.push({
      key: 'points',
      label: zh ? '扫温点数' : 'Sweep points',
      value: String(this.scan.length),
      severity: 'info',
    });
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- exports --------------------------------------------------------------

  private exportCsv(): void {
    if (this.scan.length > 0) {
      const rows = this.scan.map((q) => [
        Number(q.T.toFixed(4)),
        Number(q.chi.toPrecision(6)),
        Number(q.heat.toPrecision(6)),
        Number(q.binder.toPrecision(6)),
        Number(q.absM.toPrecision(6)),
        Number(q.energy.toPrecision(6)),
        q.algorithm,
      ]);
      exportRowsCsv(this.api, `ising-scan-L${this.state.L}`, ['T', 'chi', 'C', 'binder_U4', 'abs_m', 'E_per_spin', 'algorithm'], rows);
      return;
    }
    const r = this.last;
    if (!r) {
      notify(this.api, 'warning', 'Nothing to export yet — run a simulation first.', '暂无可导出的数据——请先运行模拟。');
      return;
    }
    exportRowsCsv(
      this.api,
      `ising-point-L${r.L}`,
      ['L', 'T', 'J', 'H', 'algorithm', 'chi', 'C', 'binder_U4', 'abs_m', 'E_per_spin'],
      [[
        r.L,
        Number(r.T.toFixed(4)),
        this.state.J,
        this.state.H,
        r.algorithmUsed,
        Number(r.chi.toPrecision(6)),
        Number(r.heatCapacity.toPrecision(6)),
        Number(r.binder.toPrecision(6)),
        Number(r.absM.toPrecision(6)),
        Number(r.energyPerSpin.toPrecision(6)),
      ]],
    );
  }

  /** Build the temperature-sweep panels and push them into Figure Studio. */
  private async sendToFigure(): Promise<void> {
    if (this.scan.length < 2) {
      notify(this.api, 'warning', 'No sweep data yet — run the T sweep first.', '暂无扫温数据——请先运行温度扫描。');
      return;
    }
    const ref = ONSAGER_TC * this.state.J;
    const tcTxt = this.tc ? `${this.tc.tc.toFixed(3)} ± ${this.tc.tcErr.toFixed(3)}` : '—';
    const caption: Bilingual = {
      zh: `二维伊辛模型扫温（L=${this.state.L}，J=${this.state.J}，H=${this.state.H}，${this.scan.length} 点）：Tc = ${tcTxt} J/k_B（Onsager ${ref.toFixed(3)}）。`,
      en: `2-D Ising temperature sweep (L=${this.state.L}, J=${this.state.J}, H=${this.state.H}, ${this.scan.length} pts): Tc = ${tcTxt} J/k_B (Onsager ${ref.toFixed(3)}).`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '伊辛模型扫温分析', en: 'Ising Temperature Sweep' },
      caption,
      isingFigurePanels({ scan: this.scan, J: this.state.J, H: this.state.H }),
    );
  }

  // ---- drawing --------------------------------------------------------------

  private draw(): void {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    if (this.api?.isActive && !this.api.isActive()) return; // background guard
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = this.zh;
    const W = canvas.width;
    const H = canvas.height;
    const padT = 40;
    const padB = 40;

    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.fillText(
      zh
        ? `二维伊辛模型 · ${this.state.L}×${this.state.L} 周期边界 · k_B = 1`
        : `2-D Ising model · ${this.state.L}×${this.state.L} periodic · k_B = 1`,
      W / 2,
      20,
    );

    const top = padT;
    const bottom = H - padB;
    const boxH = Math.max(bottom - top, 10);
    const heatSize = Math.min(boxH, Math.max(120, W * 0.36));
    const hx = 18;
    const hy = top + (boxH - heatSize) / 2;
    const plotX = hx + heatSize + 34;
    const plotW = Math.max(W - 22 - plotX, 10);

    // ---- spin heat map --------------------------------------------------------
    const r = this.last;
    if (r && r.spins.length === this.state.L * this.state.L) {
      const hc = this.updateHeatCanvas(r.spins, this.state.L);
      if (hc) {
        g.imageSmoothingEnabled = false;
        g.drawImage(hc, hx, hy, heatSize, heatSize);
        g.imageSmoothingEnabled = true;
      }
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.lineWidth = 1;
      g.strokeRect(hx, hy, heatSize, heatSize);
      g.font = '11px Consolas, monospace';
      g.fillStyle = 'rgba(170,182,200,0.95)';
      g.textAlign = 'center';
      g.fillText(`T=${r.T.toFixed(3)}  J=${this.state.J}  H=${this.state.H}`, hx + heatSize / 2, Math.min(hy + heatSize + 14, H - 26));
      const ons = this.state.H === 0 && r.T < ONSAGER_TC * this.state.J;
      const mLine =
        `|m|=${r.absM.toFixed(3)}` +
        (ons
          ? zh
            ? `（Onsager ${onsagerMagnetization(r.T, this.state.J).toFixed(3)}）`
            : ` (Onsager ${onsagerMagnetization(r.T, this.state.J).toFixed(3)})`
          : '') +
        `  E/N=${r.energyPerSpin.toFixed(3)}`;
      g.fillText(mLine, hx + heatSize / 2, Math.min(hy + heatSize + 28, H - 12));
    } else {
      g.fillStyle = 'rgba(150,165,185,0.9)';
      g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      g.fillText(
        zh ? '运行「单点模拟」生成自旋构型' : 'Run a single point to draw spins',
        hx + heatSize / 2,
        hy + heatSize / 2,
      );
    }

    // ---- chi(T) plot ----------------------------------------------------------
    this.drawChiPlot(g, plotX, top, plotW, boxH, zh);

    // ---- footer ---------------------------------------------------------------
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    if (this.scanning) {
      g.fillStyle = 'rgba(250,205,120,0.95)';
      g.fillText(zh ? `扫温中 ${this.scanDone}/${this.scanTotal} …` : `Scanning ${this.scanDone}/${this.scanTotal} …`, 18, H - 12);
    } else if (r) {
      g.fillStyle = 'rgba(200,214,232,0.95)';
      const alg = r.algorithmUsed === 'wolff' ? 'Wolff' : 'Metropolis';
      g.fillText(
        `chi=${fmtMetric(r.chi)}  C=${fmtMetric(r.heatCapacity)}  U4=${r.binder.toFixed(3)}  |m|=${r.absM.toFixed(3)}  E/N=${r.energyPerSpin.toFixed(3)}  [${alg} · seed ${this.state.seed}]`,
        18,
        H - 12,
      );
    }
  }

  private drawChiPlot(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, zh: boolean): void {
    const x1 = x0 + w;
    const y1 = y0 + h;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    g.strokeRect(x0, y0, w, h);
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;

    if (this.scan.length < 2) {
      g.fillStyle = 'rgba(150,165,185,0.9)';
      g.textAlign = 'center';
      g.fillText(
        zh ? '运行「温度扫描」绘制 χ(T) 并拟合 Tc' : 'Run a T sweep to plot χ(T) and fit Tc',
        x0 + w / 2,
        y0 + h / 2,
      );
      return;
    }

    let chiMax = 0;
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const q of this.scan) {
      if (Number.isFinite(q.chi)) chiMax = Math.max(chiMax, q.chi);
      tMin = Math.min(tMin, q.T);
      tMax = Math.max(tMax, q.T);
    }
    if (!(chiMax > 0)) chiMax = 1;
    const px = (T: number): number => x0 + (w * (T - tMin)) / Math.max(tMax - tMin, 1e-9);
    const py = (c: number): number => y1 - (h * 0.9 * c) / chiMax;

    // ticks
    g.font = '10px Consolas, monospace';
    g.textAlign = 'center';
    for (let i = 0; i <= 5; i++) {
      const T = tMin + ((tMax - tMin) * i) / 5;
      const sx = px(T);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(sx, y0);
      g.lineTo(sx, y1);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(T.toFixed(2), sx, y1 + 13);
    }
    g.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const c = (chiMax * i) / 4;
      const sy = py(c);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(fmtMetric(c), x0 - 5, sy + 3);
    }

    // chi curve (points were generated in ascending T order)
    g.strokeStyle = 'rgba(120,220,190,0.95)';
    g.lineWidth = 1.5;
    g.beginPath();
    this.scan.forEach((q, i) => {
      const sx = px(q.T);
      const sy = py(Number.isFinite(q.chi) ? Math.max(q.chi, 0) : 0);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    });
    g.stroke();

    // Onsager reference line
    const tcRef = ONSAGER_TC * this.state.J;
    if (tcRef >= tMin && tcRef <= tMax) {
      const sx = px(tcRef);
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.setLineDash([4, 4]);
      g.beginPath();
      g.moveTo(sx, y0);
      g.lineTo(sx, y1);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.textAlign = 'center';
      g.fillText(zh ? `Onsager Tc ${tcRef.toFixed(3)}` : `Onsager Tc ${tcRef.toFixed(3)}`, sx, y0 + 12);
    }

    // fitted peak position
    if (this.tc && this.tc.tc >= tMin && this.tc.tc <= tMax) {
      const sx = px(this.tc.tc);
      g.strokeStyle = 'rgba(250,205,120,0.9)';
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(sx, y0);
      g.lineTo(sx, y1);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(250,205,120,0.95)';
      g.textAlign = 'center';
      g.fillText(`fit ${this.tc.tc.toFixed(3)} ± ${this.tc.tcErr.toFixed(3)}`, Math.min(Math.max(sx, x0 + 46), x1 - 46), y0 + 26);
    }

    // legend
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(
      zh ? '— χ(T)    ┆ Onsager Tc    ┈ χ 峰拟合    T/(J/k_B)' : '— χ(T)    ┆ Onsager Tc    ┈ χ-peak fit    T/(J/k_B)',
      x0 + 6,
      y1 - 8,
    );
  }

  /** Rebuild the L×L offscreen spin image (warm = up, cool = down). */
  private updateHeatCanvas(spins: Int8Array, L: number): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;
    if (!this.heatCanvas || this.heatL !== L) {
      const c = document.createElement('canvas');
      c.width = L;
      c.height = L;
      this.heatCanvas = c;
      this.heatL = L;
    }
    const g = this.heatCanvas.getContext('2d');
    if (!g) return null;
    const img = g.createImageData(L, L);
    const d = img.data;
    for (let i = 0; i < L * L; i++) {
      const up = spins[i]! > 0;
      const b = i * 4;
      d[b] = up ? 255 : 64;
      d[b + 1] = up ? 205 : 118;
      d[b + 2] = up ? 120 : 216;
      d[b + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return this.heatCanvas;
  }
}

export default function createIsingPlugin(): Plugin {
  return new IsingPlugin();
}
