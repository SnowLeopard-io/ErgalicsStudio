// ==========================================================================
// physics-schrodinger — 1-D quantum mechanics laboratory (plugin shell)
//
// Stationary mode: draws V(x) with the analytic-reference energy levels and
// the selected eigenfunction (or its probability density), publishing the
// first three levels together with their relative error against the closed
// forms. Time mode: Crank-Nicolson evolution of a Gaussian packet with a
// requestAnimationFrame loop; footer tracks norm / <x> / sigma(t) against
// the analytic free-packet spreading law.
//
// All numerics live in kernel.ts (pure, unit-tested). This file is UI only.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { schrodingerManifest } from './manifest';
import { schrodingerFigurePanels } from './figure';
import {
  analyticLevels,
  buildGrid,
  buildPotential,
  cnStep,
  DEFAULT_POTENTIAL_PARAMS,
  dynamicsDomainFor,
  domainFor,
  freePacketCenter,
  freePacketWidth,
  gaussianPacket,
  makeCnWork,
  packetStats,
  relErr,
  solveStationary,
  type CnWork,
  type PotentialKind,
  type PotentialParams,
  type StationaryResult,
} from './kernel';

export { schrodingerManifest } from './manifest';

const KINDS: Array<{ value: PotentialKind; en: string; zh: string }> = [
  { value: 'well', en: 'Infinite square well', zh: '无限深方势阱' },
  { value: 'harmonic', en: 'Harmonic oscillator', zh: '谐振子势' },
  { value: 'finite-well', en: 'Finite square well', zh: '有限方势阱' },
  { value: 'double-well', en: 'Double well', zh: '双势阱' },
];

const PUBLISHED_LEVELS = 3;
const KEPT_LEVELS = 12;

interface State extends PotentialParams {
  kind: PotentialKind;
  mode: 'stationary' | 'time';
  gridN: number;
  level: number;
  showDensity: boolean;
  // wave-packet dynamics
  packetX0: number;
  sigma0: number;
  k0: number;
  dt: number;
  stepsPerFrame: number;
}

export class SchrodingerPlugin implements Plugin {
  readonly manifest = schrodingerManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private playing = false;
  private raf = 0;

  private state: State = {
    ...DEFAULT_POTENTIAL_PARAMS,
    kind: 'well',
    mode: 'stationary',
    gridN: 400,
    level: 0,
    showDensity: false,
    packetX0: -6,
    sigma0: 0.5,
    k0: 3,
    dt: 0.002,
    stepsPerFrame: 4,
  };

  private statSol: StationaryResult | null = null;
  private dynGrid: { x: Float64Array; dx: number; V: Float64Array } | null = null;
  private psiRe: Float64Array | null = null;
  private psiIm: Float64Array | null = null;
  private cnWork: CnWork | null = null;
  private simTime = 0;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    this.stopLoop();
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    this.draw();
  }

  async deactivate() {
    this.playing = false;
    this.stopLoop();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.ensureSolved();
    this.draw();
  }

  // ---- derived data ---------------------------------------------------------

  private potentialParams(): PotentialParams {
    return {
      width: this.state.width,
      omega: this.state.omega,
      depth: this.state.depth,
      halfWidth: this.state.halfWidth,
      barrierHeight: this.state.barrierHeight,
      barrierWidth: this.state.barrierWidth,
    };
  }

  private ensureSolved() {
    if (!this.statSol) this.resolveStationary();
    if (this.state.mode === 'time' && !this.psiRe) this.resetPacket();
  }

  private resolveStationary() {
    const p = this.potentialParams();
    const [x0, x1] = domainFor(this.state.kind, p);
    const grid = buildGrid(x0, x1, this.state.gridN);
    const V = buildPotential(this.state.kind, p, grid.x);
    const sol = solveStationary(V, grid.x, grid.dx);
    // Keep only the lowest levels for plotting/exports (memory-friendly).
    const psi = sol.psi.slice(0, Math.min(KEPT_LEVELS, sol.psi.length));
    this.statSol = { x: sol.x, dx: sol.dx, V: sol.V, energies: sol.energies, psi };
    this.publishStationary();
  }

  private resetPacket() {
    const p = this.potentialParams();
    const [x0, x1] = dynamicsDomainFor(this.state.kind, p);
    const grid = buildGrid(x0, x1, this.state.gridN);
    const V = buildPotential(this.state.kind, p, grid.x);
    const { re, im } = gaussianPacket(grid.x, grid.dx, this.state.packetX0, this.state.sigma0, this.state.k0);
    this.dynGrid = { x: grid.x, dx: grid.dx, V };
    this.psiRe = re;
    this.psiIm = im;
    this.cnWork = makeCnWork(grid.x.length);
    this.simTime = 0;
  }

  // ---- parameter panel ------------------------------------------------------

  getParams(): ParamDefinition[] {
    const s = this.state;
    const zh = this.zh;
    return [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { 'zh-CN': '模式', 'en-US': 'Mode' },
        type: 'select',
        options: [
          { value: 'stationary', label: zh ? '定态能级' : 'Stationary levels', labelI18n: { 'zh-CN': '定态能级', 'en-US': 'Stationary levels' } },
          { value: 'time', label: zh ? '时间演化' : 'Wave-packet dynamics', labelI18n: { 'zh-CN': '时间演化', 'en-US': 'Wave-packet dynamics' } },
        ],
        value: s.mode,
      },
      {
        key: 'kind',
        label: 'Potential',
        labelI18n: { 'zh-CN': '势场类型', 'en-US': 'Potential' },
        type: 'select',
        options: KINDS.map((k) => ({ value: k.value, label: zh ? k.zh : k.en, labelI18n: { 'zh-CN': k.zh, 'en-US': k.en } })),
        value: s.kind,
      },
      {
        key: 'gridN',
        label: 'Grid points',
        labelI18n: { 'zh-CN': '网格数', 'en-US': 'Grid points' },
        type: 'range',
        min: 100,
        max: 600,
        step: 50,
        value: Math.min(600, Math.max(100, s.gridN)),
        hint: zh ? '有限差分内部节点数' : 'interior finite-difference nodes',
      },
      {
        key: 'level',
        label: 'Level n',
        labelI18n: { 'zh-CN': '能级序号 n（从 0 起）', 'en-US': 'Level index n (0-based)' },
        type: 'range',
        min: 0,
        max: 9,
        step: 1,
        value: s.level,
      },
      {
        key: 'showDensity',
        label: 'Density |ψ|²',
        labelI18n: { 'zh-CN': '显示概率密度 |ψ|²', 'en-US': 'Show density |ψ|²' },
        type: 'checkbox',
        value: s.showDensity,
      },
      { key: 'width', label: 'L (well width)', labelI18n: { 'zh-CN': '阱宽 L', 'en-US': 'Well width L' }, type: 'range', min: 0.2, max: 3, step: 0.1, value: s.width, hint: zh ? '无限深方势阱' : 'infinite square well' },
      { key: 'omega', label: 'ω (curvature)', labelI18n: { 'zh-CN': '曲率 ω', 'en-US': 'Curvature ω' }, type: 'range', min: 0.5, max: 4, step: 0.1, value: s.omega, hint: zh ? '谐振子 / 双势阱' : 'harmonic / double well' },
      { key: 'depth', label: 'V0 (depth)', labelI18n: { 'zh-CN': '阱深 V0', 'en-US': 'Well depth V0' }, type: 'range', min: 5, max: 100, step: 1, value: s.depth, hint: zh ? '有限方势阱' : 'finite square well' },
      { key: 'halfWidth', label: 'a (half width)', labelI18n: { 'zh-CN': '半宽 a', 'en-US': 'Half width a' }, type: 'range', min: 0.3, max: 2, step: 0.05, value: s.halfWidth },
      { key: 'barrierHeight', label: 'Barrier Vb', labelI18n: { 'zh-CN': '垒高 Vb', 'en-US': 'Barrier height Vb' }, type: 'range', min: 0, max: 20, step: 0.5, value: s.barrierHeight, hint: zh ? '双势阱中央高斯垒' : 'double-well central Gaussian barrier' },
      { key: 'barrierWidth', label: 'Barrier σ', labelI18n: { 'zh-CN': '垒宽 σ', 'en-US': 'Barrier width σ' }, type: 'range', min: 0.2, max: 2, step: 0.05, value: s.barrierWidth },
      { key: 'packetX0', label: 'Packet x0', labelI18n: { 'zh-CN': '波包初始位置 x0', 'en-US': 'Packet centre x0' }, type: 'range', min: -10, max: 10, step: 0.5, value: s.packetX0 },
      { key: 'sigma0', label: 'Packet σ0', labelI18n: { 'zh-CN': '波包初始宽度 σ0', 'en-US': 'Packet width σ0' }, type: 'range', min: 0.2, max: 1.5, step: 0.05, value: s.sigma0 },
      { key: 'k0', label: 'Packet k0', labelI18n: { 'zh-CN': '波包动量 k0', 'en-US': 'Packet momentum k0' }, type: 'range', min: 0, max: 8, step: 0.1, value: s.k0 },
      { key: 'dt', label: 'Time step dt', labelI18n: { 'zh-CN': '时间步长 dt', 'en-US': 'Time step dt' }, type: 'range', min: 0.0005, max: 0.005, step: 0.0005, value: s.dt },
      { key: 'stepsPerFrame', label: 'Steps / frame', labelI18n: { 'zh-CN': '每帧步数', 'en-US': 'Steps per frame' }, type: 'range', min: 1, max: 10, step: 1, value: s.stepsPerFrame },
      actionButton('solve', 'Solve levels', '求解能级', 'primary'),
      actionButton('play', 'Play / pause evolution', '播放 / 暂停演化'),
      actionButton('resetPacket', 'Reset wave packet', '重置波包'),
      actionButton('exportLevels', 'Export levels CSV', '导出能级 CSV'),
      actionButton('exportPsi', 'Export ψ(x) CSV', '导出 ψ(x) CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.state;
    let potentialChanged = false;
    let dynNeedsReset = false;

    if (typeof params.mode === 'string' && (params.mode === 'stationary' || params.mode === 'time') && params.mode !== s.mode) {
      s.mode = params.mode;
      if (s.mode === 'time') this.resetPacket();
      this.publish();
      this.draw();
    }
    if (typeof params.kind === 'string' && KINDS.some((k) => k.value === params.kind) && params.kind !== s.kind) {
      s.kind = params.kind as PotentialKind;
      potentialChanged = true;
      dynNeedsReset = true;
    }

    const num = (k: keyof State, cb: (n: number) => void): void => {
      const v = params[k as string];
      if (typeof v === 'number' && Number.isFinite(v)) cb(v);
    };
    num('gridN', (n) => {
      // Round to the step (50), then clamp to [100, 600].
      const g = Math.min(600, Math.max(100, Math.round(n / 50) * 50));
      if (g === s.gridN) return;
      s.gridN = g;
      potentialChanged = true;
      dynNeedsReset = true;
    });
    num('level', (n) => {
      const lv = Math.min(9, Math.max(0, Math.round(n)));
      if (lv === s.level) return;
      s.level = lv;
      this.draw();
    });
    if (typeof params.showDensity === 'boolean' && params.showDensity !== s.showDensity) {
      s.showDensity = params.showDensity;
      this.draw();
    }
    num('width', (n) => {
      if (n === s.width) return;
      s.width = n;
      potentialChanged = true;
    });
    num('omega', (n) => {
      if (n === s.omega) return;
      s.omega = n;
      potentialChanged = true;
    });
    num('depth', (n) => {
      if (n === s.depth) return;
      s.depth = n;
      potentialChanged = true;
    });
    num('halfWidth', (n) => {
      if (n === s.halfWidth) return;
      s.halfWidth = n;
      potentialChanged = true;
    });
    num('barrierHeight', (n) => {
      if (n === s.barrierHeight) return;
      s.barrierHeight = n;
      potentialChanged = true;
    });
    num('barrierWidth', (n) => {
      if (n === s.barrierWidth) return;
      s.barrierWidth = n;
      potentialChanged = true;
    });
    num('packetX0', (n) => {
      if (n === s.packetX0) return;
      s.packetX0 = n;
      dynNeedsReset = true;
    });
    num('sigma0', (n) => {
      if (n === s.sigma0) return;
      s.sigma0 = n;
      dynNeedsReset = true;
    });
    num('k0', (n) => {
      if (n === s.k0) return;
      s.k0 = n;
      dynNeedsReset = true;
    });
    num('dt', (n) => {
      if (n === s.dt) return;
      s.dt = n;
    });
    num('stepsPerFrame', (n) => {
      const v = Math.round(Math.min(10, Math.max(1, n)));
      if (v === s.stepsPerFrame) return;
      s.stepsPerFrame = v;
    });

    if (potentialChanged) {
      this.resolveStationary();
      if (dynNeedsReset || s.mode === 'time') this.resetPacket();
      this.draw();
    } else if (dynNeedsReset) {
      this.resetPacket();
      this.draw();
    }

    if (actionFired(params, 'solve')) {
      this.resolveStationary();
      notify(this.api, 'success', `Levels recomputed (N=${s.gridN}).`, `能级已重算（N=${s.gridN}）。`);
      this.draw();
    }
    if (actionFired(params, 'play')) {
      if (s.mode !== 'time') {
        s.mode = 'time';
        this.resetPacket();
        this.publish();
      }
      this.playing = !this.playing;
      if (this.playing) this.startLoop();
      else this.stopLoop();
      this.draw();
    }
    if (actionFired(params, 'resetPacket')) {
      this.resetPacket();
      notify(this.api, 'info', 'Wave packet reset to t = 0.', '波包已重置到 t = 0。');
      this.draw();
    }
    if (actionFired(params, 'exportLevels')) this.exportLevels();
    if (actionFired(params, 'exportPsi')) this.exportPsi();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  // ---- scientific outputs ---------------------------------------------------

  private publish(): void {
    if (this.state.mode === 'stationary') this.publishStationary();
    else this.publishDynamics();
  }

  /** First three levels + relative error against the analytic reference. */
  private publishStationary() {
    const sol = this.statSol;
    if (!sol) return;
    const ref = analyticLevels(this.state.kind, this.potentialParams(), PUBLISHED_LEVELS);
    const metrics: ScienceMetric[] = [];
    for (let i = 0; i < PUBLISHED_LEVELS; i++) {
      const e = sol.energies[i];
      if (e === undefined) break;
      const r = ref[i];
      const err = r === null || r === undefined ? null : relErr(e, r);
      metrics.push({
        key: `E${i + 1}`,
        label: `E${i + 1}`,
        value: fmtMetric(e),
        unit: 'a.u.',
        severity: err === null ? 'info' : err < 1e-3 ? 'ok' : err < 1e-2 ? 'info' : 'warn',
        hint:
          err === null
            ? this.zh
              ? '双势阱无初等解析解，仅给出数值能级'
              : 'no elementary closed form for the double well — numeric level only'
            : this.zh
              ? `相对误差 ${(err * 100).toFixed(4)}%（解析值 ${fmtMetric(r!)}）`
              : `relative error ${(err * 100).toFixed(4)}% vs analytic ${fmtMetric(r!)}`,
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  private publishDynamics() {
    if (!this.psiRe || !this.psiIm || !this.dynGrid) return;
    const st = packetStats(this.psiRe, this.psiIm, this.dynGrid.x, this.dynGrid.dx);
    const metrics: ScienceMetric[] = [
      {
        key: 'norm',
        label: this.zh ? '归一化范数' : 'Norm',
        value: fmtMetric(st.norm),
        severity: Math.abs(st.norm - 1) < 1e-8 ? 'ok' : 'warn',
        hint: this.zh ? 'Crank-Nicolson 为幺正格式，范数漂移应 < 1e-10' : 'Crank-Nicolson is unitary; norm drift should stay < 1e-10',
      },
      { key: 't', label: 't', value: fmtMetric(this.simTime), unit: 'a.u.', severity: 'info' },
      { key: 'sigma', label: 'σ(t)', value: fmtMetric(st.sigmaX), unit: 'a.u.', severity: 'info' },
    ];
    if (this.dynGrid.V.every((v) => v === 0)) {
      const ref = freePacketWidth(this.state.sigma0, this.simTime);
      const err = relErr(st.sigmaX, ref);
      metrics.push({
        key: 'sigma-err',
        label: this.zh ? 'σ 相对误差' : 'σ rel err',
        value: fmtMetric(err * 100),
        unit: '%',
        severity: err < 0.02 ? 'ok' : 'warn',
        hint: this.zh
          ? `对照自由波包展宽公式 σ(t)=√(σ0²+t²/σ0²)=${fmtMetric(ref)}`
          : `vs free spreading law σ(t)=√(σ0²+t²/σ0²)=${fmtMetric(ref)}`,
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- exports --------------------------------------------------------------

  private exportLevels() {
    const sol = this.statSol;
    if (!sol) {
      notify(this.api, 'warning', 'Solve the levels first.', '请先求解能级。');
      return;
    }
    const ref = analyticLevels(this.state.kind, this.potentialParams(), 10);
    const rows: Array<Array<number | string>> = [];
    const count = Math.min(10, sol.energies.length);
    for (let i = 0; i < count; i++) {
      const r = ref[i] ?? '';
      const err = typeof r === 'number' ? Number(relErr(sol.energies[i]!, r).toExponential(4)) : '';
      rows.push([i + 1, Number(sol.energies[i]!.toFixed(6)), r, err]);
    }
    exportRowsCsv(this.api, 'schrodinger-levels', ['n', 'E_numeric', 'E_analytic', 'rel_error'], rows);
  }

  private exportPsi() {
    const rows: Array<Array<number | string>> = [];
    if (this.state.mode === 'stationary' && this.statSol) {
      const lv = Math.min(this.state.level, this.statSol.psi.length - 1);
      const psi = this.statSol.psi[lv];
      if (!psi) {
        notify(this.api, 'warning', 'Level not available.', '该能级不可用。');
        return;
      }
      for (let i = 0; i < this.statSol.x.length; i++) {
        rows.push([
          Number(this.statSol.x[i]!.toFixed(6)),
          Number(psi[i]!.toFixed(8)),
          Number((psi[i]! * psi[i]!).toFixed(8)),
        ]);
      }
      exportRowsCsv(this.api, `schrodinger-psi-level-${lv + 1}`, ['x', 'psi', 'psi_squared'], rows);
    } else if (this.psiRe && this.psiIm && this.dynGrid) {
      for (let i = 0; i < this.dynGrid.x.length; i++) {
        const dens = this.psiRe[i]! * this.psiRe[i]! + this.psiIm[i]! * this.psiIm[i]!;
        rows.push([
          Number(this.dynGrid.x[i]!.toFixed(6)),
          Number(this.psiRe[i]!.toFixed(8)),
          Number(this.psiIm[i]!.toFixed(8)),
          Number(dens.toFixed(8)),
        ]);
      }
      exportRowsCsv(this.api, `schrodinger-psi-t${this.simTime.toFixed(3)}`, ['x', 'psi_re', 'psi_im', 'density'], rows);
    } else {
      notify(this.api, 'warning', 'Nothing to export yet.', '暂无可导出的波函数。');
    }
  }

  // ---- figure studio push ---------------------------------------------------

  private async sendToFigure(): Promise<void> {
    this.ensureSolved();
    const sol = this.statSol;
    if (!sol) {
      notify(this.api, 'warning', 'No eigenstate solution yet — solve the levels first.', '暂无本征态解 — 请先求解能级。');
      return;
    }
    const ref = analyticLevels(this.state.kind, this.potentialParams(), PUBLISHED_LEVELS);
    const parts: string[] = [];
    for (let i = 0; i < PUBLISHED_LEVELS; i++) {
      const e = sol.energies[i];
      if (e === undefined) break;
      const r = ref[i];
      parts.push(`E${i + 1}=${e.toFixed(3)}${typeof r === 'number' ? ` (err ${(relErr(e, r) * 100).toFixed(3)}%)` : ''}`);
    }
    const kindLabel = KINDS.find((k) => k.value === this.state.kind);
    let packet: { t: number; x: Float64Array; density: number[] } | undefined;
    if (this.state.mode === 'time' && this.psiRe && this.psiIm && this.dynGrid) {
      const re = this.psiRe;
      const im = this.psiIm;
      packet = { t: this.simTime, x: this.dynGrid.x, density: Array.from(re, (v, k) => v * v + im[k]! * im[k]!) };
    }
    const caption: Bilingual = {
      zh: `一维薛定谔方程（${kindLabel?.zh ?? ''}）：${parts.join('，')} a.u.${packet ? `；波包快照 t=${this.simTime.toFixed(3)}` : ''}。`,
      en: `1-D Schrödinger equation (${kindLabel?.en ?? ''}): ${parts.join(', ')} a.u.${packet ? `; packet snapshot t=${this.simTime.toFixed(3)}` : ''}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '一维薛定谔求解器', en: '1-D Schrödinger Solver' },
      caption,
      schrodingerFigurePanels({
        sol,
        level: this.state.level,
        showDensity: this.state.showDensity,
        kind: this.state.kind,
        params: this.potentialParams(),
        packet,
      }),
    );
  }

  // ---- animation ------------------------------------------------------------

  private startLoop() {
    if (this.raf) return;
    const step = (): void => {
      this.raf = 0;
      if (!this.playing || this.state.mode !== 'time') return;
      if (this.api.isActive && !this.api.isActive()) {
        this.raf = requestAnimationFrame(step);
        return;
      }
      if (this.psiRe && this.psiIm && this.dynGrid && this.cnWork) {
        for (let k = 0; k < this.state.stepsPerFrame; k++) {
          cnStep(this.psiRe, this.psiIm, this.dynGrid.V, this.dynGrid.dx, this.state.dt, this.cnWork);
          this.simTime += this.state.dt;
        }
        this.publishDynamics();
        this.draw();
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private stopLoop() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  // ---- drawing --------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = this.zh;
    if (this.state.mode === 'stationary') this.drawStationary(g, canvas, zh);
    else this.drawTime(g, canvas, zh);
  }

  private drawStationary(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const sol = this.statSol;
    if (!sol) return;
    const padL = 58;
    const padR = 18;
    const padT = 44;
    const padB = 44;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    // Energy window: cover the shown level, keep tall walls visible but capped.
    let vMin = 0;
    let vMaxE = 0;
    for (let i = 0; i < sol.V.length; i++) {
      vMin = Math.min(vMin, sol.V[i]!);
      vMaxE = Math.max(vMaxE, sol.V[i]!);
    }
    const lv = Math.min(this.state.level, sol.psi.length - 1, sol.energies.length - 1);
    const eShow = sol.energies[Math.min(lv + 1, sol.energies.length - 1)] ?? sol.energies[lv]!;
    const yMax = Math.max(eShow * 1.35, vMaxE * 0.22, 1);
    const yMin = Math.min(0, vMin);
    const px = (x: number): number => x0 + (plotW * (x - sol.x[0]!)) / (sol.x[sol.x.length - 1]! - sol.x[0]!);
    const py = (e: number): number => y1 - (plotH * (e - yMin)) / (yMax - yMin);

    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    const kindLabel = KINDS.find((k) => k.value === this.state.kind);
    g.fillText(zh ? `一维定态薛定谔方程 · ${kindLabel?.zh ?? ''}` : `1-D stationary Schrödinger · ${kindLabel?.en ?? ''}`, canvas.width / 2, 20);

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // Energy ticks
    g.textAlign = 'right';
    g.font = '10px Consolas, monospace';
    for (let i = 0; i <= 5; i++) {
      const v = yMin + ((yMax - yMin) * i) / 5;
      const sy = py(v);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(v.toFixed(1), x0 - 6, sy + 3);
    }

    // Potential curve
    g.strokeStyle = 'rgba(250,205,120,0.9)';
    g.lineWidth = 2;
    g.beginPath();
    let pen = false;
    for (let i = 0; i < sol.x.length; i++) {
      const v = sol.V[i]!;
      if (v > yMax) {
        pen = false;
        continue;
      }
      const sx = px(sol.x[i]!);
      const sy = py(v);
      if (!pen) {
        g.moveTo(sx, sy);
        pen = true;
      } else g.lineTo(sx, sy);
    }
    g.stroke();

    // Lowest few analytic-referenced energy levels (dashed) + the selected ψ
    const nShow = Math.min(5, sol.psi.length);
    for (let j = 0; j < nShow; j++) {
      const e = sol.energies[j]!;
      if (e > yMax) break;
      const sy = py(e);
      g.strokeStyle = j === lv ? 'rgba(160,200,250,0.85)' : 'rgba(255,255,255,0.16)';
      g.lineWidth = 1;
      g.setLineDash(j === lv ? [] : [4, 4]);
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.setLineDash([]);
    }

    // Selected eigenfunction drawn on its own energy line
    const psi = sol.psi[lv]!;
    const eSel = sol.energies[lv]!;
    const nextE = sol.energies[Math.min(lv + 1, sol.energies.length - 1)] ?? eSel * 1.6;
    const amp = Math.max(0.12 * (nextE - eSel), 0.03 * (yMax - yMin));
    let psiMax = 1e-12;
    for (let i = 0; i < psi.length; i++) psiMax = Math.max(psiMax, Math.abs(psi[i]!));
    g.beginPath();
    for (let i = 0; i < psi.length; i++) {
      const val = this.state.showDensity ? (psi[i]! * psi[i]!) / psiMax : psi[i]! / psiMax;
      const sx = px(sol.x[i]!);
      const sy = py(eSel + amp * val);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.strokeStyle = 'rgba(120,220,190,0.95)';
    g.lineWidth = 2;
    g.stroke();
    if (this.state.showDensity) {
      g.lineTo(px(sol.x[sol.x.length - 1]!), py(eSel));
      g.lineTo(px(sol.x[0]!), py(eSel));
      g.closePath();
      g.fillStyle = 'rgba(120,220,190,0.18)';
      g.fill();
    }

    // x ticks
    g.font = '10px Consolas, monospace';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.textAlign = 'center';
    for (let i = 0; i <= 6; i++) {
      const xv = sol.x[0]! + ((sol.x[sol.x.length - 1]! - sol.x[0]!) * i) / 6;
      g.fillText(xv.toFixed(2), px(xv), y1 + 14);
    }

    // Legend + footer
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const ref = analyticLevels(this.state.kind, this.potentialParams(), PUBLISHED_LEVELS);
    const lines: string[] = [
      zh ? '—— V(x)    —— ψn（虚线为低能级 E）' : '— V(x)    — ψn (dashed: low levels E)',
    ];
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(lines[0]!, x0 + 4, y0 + 14);
    const footer: string[] = [];
    for (let i = 0; i < PUBLISHED_LEVELS; i++) {
      const e = sol.energies[i];
      if (e === undefined) break;
      const r = ref[i];
      const err = r === null || r === undefined ? null : relErr(e, r);
      footer.push(
        `E${i + 1}=${e.toFixed(4)}` +
          (r === null || r === undefined
            ? zh
              ? '(无解析)'
              : ' (no analytic)'
            : ` err=${((err ?? 0) * 100).toFixed(4)}%`),
      );
    }
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.fillText(footer.join('   '), x0, canvas.height - 14);
  }

  private drawTime(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    if (!this.psiRe || !this.psiIm || !this.dynGrid) return;
    const { x, V, dx } = this.dynGrid;
    const padL = 58;
    const padR = 18;
    const padT = 44;
    const padB = 44;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    let densMax = 1e-12;
    let vMax = 1e-12;
    for (let i = 0; i < x.length; i++) {
      densMax = Math.max(densMax, this.psiRe[i]! * this.psiRe[i]! + this.psiIm[i]! * this.psiIm[i]!);
      vMax = Math.max(vMax, V[i]!);
    }
    const px = (xv: number): number => x0 + (plotW * (xv - x[0]!)) / (x[x.length - 1]! - x[0]!);
    const py = (h: number): number => y1 - (plotH * h) / Math.max(densMax * 1.15, 1e-12);

    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.fillText(zh ? `Crank-Nicolson 波包演化  t = ${this.simTime.toFixed(3)}` : `Crank-Nicolson wave packet  t = ${this.simTime.toFixed(3)}`, canvas.width / 2, 20);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // |psi|^2 filled curve
    g.beginPath();
    for (let i = 0; i < x.length; i++) {
      const d = this.psiRe[i]! * this.psiRe[i]! + this.psiIm[i]! * this.psiIm[i]!;
      const sx = px(x[i]!);
      const sy = py(d);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.lineTo(px(x[x.length - 1]!), y1);
    g.lineTo(px(x[0]!), y1);
    g.closePath();
    g.fillStyle = 'rgba(120,220,190,0.25)';
    g.fill();
    g.strokeStyle = 'rgba(120,220,190,0.95)';
    g.lineWidth = 1.5;
    g.stroke();

    // Potential overlay (scaled to its own max)
    g.strokeStyle = 'rgba(250,205,120,0.85)';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < x.length; i++) {
      const sy = y1 - (plotH * V[i]!) / Math.max(vMax * 1.15, 1e-12);
      const sx = px(x[i]!);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.stroke();

    const st = packetStats(this.psiRe, this.psiIm, x, dx);
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const vZero = this.dynGrid.V.every((v) => v === 0);
    const line2 = vZero
      ? zh
        ? `σ=${st.sigmaX.toFixed(4)}（解析 ${freePacketWidth(this.state.sigma0, this.simTime).toFixed(4)}）  ⟨x⟩=${st.meanX.toFixed(3)}（解析 ${freePacketCenter(this.state.packetX0, this.state.k0, this.simTime).toFixed(3)}）  范数=${st.norm.toFixed(10)}`
        : `σ=${st.sigmaX.toFixed(4)} (analytic ${freePacketWidth(this.state.sigma0, this.simTime).toFixed(4)})  <x>=${st.meanX.toFixed(3)} (analytic ${freePacketCenter(this.state.packetX0, this.state.k0, this.simTime).toFixed(3)})  norm=${st.norm.toFixed(10)}`
      : zh
        ? `σ=${st.sigmaX.toFixed(4)}  ⟨x⟩=${st.meanX.toFixed(3)}  范数=${st.norm.toFixed(10)}`
        : `σ=${st.sigmaX.toFixed(4)}  <x>=${st.meanX.toFixed(3)}  norm=${st.norm.toFixed(10)}`;
    g.fillText(line2, x0, canvas.height - 14);
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(zh ? '绿：|ψ|²    黄：V(x)' : 'green: |ψ|²    yellow: V(x)', x0 + 4, y0 + 14);
  }
}

export default function createSchrodingerPlugin(): Plugin {
  return new SchrodingerPlugin();
}
