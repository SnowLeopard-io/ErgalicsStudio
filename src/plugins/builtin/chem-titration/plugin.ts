// ==========================================================================
// chem-titration — acid–base titration curve laboratory (2-D workbench)
//
// Parameter-driven (no file input): the full ionic-balance solver is
// re-evaluated on every parameter change, the pH(V) curve is drawn on the
// canvas with the equivalence point, buffer zone and optional indicator
// transition ranges, and the numeric-vs-analytic agreement is published on
// the scientific output bus. A one-click benchmark replays the embedded
// textbook oracles (strong/strong pH 7.00, weak-acid hydrolysis formula,
// dilution-law initial pH).
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { chemTitrationManifest } from './manifest';
import {
  ACID_PRESETS,
  equivalencePhAnalytic,
  equivalenceVolume,
  INDICATORS,
  initialPhAnalytic,
  phAt,
  pKaOf,
  relErr,
  titrationCurve,
  type AcidSpec,
  type TitrationPoint,
} from './kernel';

export { chemTitrationManifest } from './manifest';

const TOLERANCES = [
  { value: '1e-8', labelEn: 'Normal (1e-8)', labelZh: '常规（1e-8）', tol: 1e-8 },
  { value: '1e-11', labelEn: 'High (1e-11)', labelZh: '高精度（1e-11）', tol: 1e-11 },
  { value: '1e-13', labelEn: 'Ultra (1e-13)', labelZh: '超高（1e-13）', tol: 1e-13 },
];

interface State {
  acid: string;
  kaCustom: number;
  acidConc: number;
  acidVolume: number;
  baseConc: number;
  tolKey: string;
  showIndicators: boolean;
}

export class ChemTitrationPlugin implements Plugin {
  readonly manifest = chemTitrationManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private curve: TitrationPoint[] | null = null;
  private vEq = 0;
  private state: State = {
    acid: 'strong',
    kaCustom: 1.8e-5,
    acidConc: 0.1,
    acidVolume: 25,
    baseConc: 0.1,
    tolKey: '1e-11',
    showIndicators: true,
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
    this.curve = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  private acidSpec(): AcidSpec {
    const preset = ACID_PRESETS.find((p) => p.key === this.state.acid);
    const custom = this.state.acid === 'custom';
    return {
      kind: this.state.acid === 'strong' ? 'strong' : 'weak',
      conc: this.state.acidConc,
      volume: this.state.acidVolume,
      baseConc: this.state.baseConc,
      ka: custom ? this.state.kaCustom : (preset?.ka ?? 1.8e-5),
    };
  }

  private tolerance(): number {
    return TOLERANCES.find((t) => t.value === this.state.tolKey)?.tol ?? 1e-11;
  }

  getParams(): ParamDefinition[] {
    const zh = this.zh;
    return [
      {
        key: 'acid',
        label: 'Acid',
        labelI18n: { 'zh-CN': '酸的种类', 'en-US': 'Acid' },
        type: 'select',
        options: [
          ...ACID_PRESETS.map((p) => ({
            value: p.key,
            label: zh ? p.zh : p.en,
            labelI18n: { 'zh-CN': p.zh, 'en-US': p.en },
          })),
          {
            value: 'custom',
            label: zh ? '自定义 Ka' : 'Custom Ka',
            labelI18n: { 'zh-CN': '自定义 Ka', 'en-US': 'Custom Ka' },
          },
        ],
        value: this.state.acid,
      },
      {
        key: 'kaCustom',
        label: 'Ka (custom)',
        labelI18n: { 'zh-CN': 'Ka（自定义酸）', 'en-US': 'Ka (custom acid)' },
        type: 'number',
        min: 1e-11,
        max: 1,
        step: 1e-5,
        value: this.state.kaCustom,
        hint: zh ? '仅「自定义 Ka」时生效' : 'used only when Acid = Custom Ka',
      },
      {
        key: 'acidConc',
        label: 'c(HCl/HAc)',
        labelI18n: { 'zh-CN': '酸的浓度 cₐ', 'en-US': 'Acid concentration cₐ' },
        type: 'range',
        min: 0.005,
        max: 2,
        step: 0.005,
        value: this.state.acidConc,
        hint: zh ? '酸样初始浓度（mol/L）' : 'initial acid concentration (mol/L)',
      },
      {
        key: 'acidVolume',
        label: 'V(acid)',
        labelI18n: { 'zh-CN': '酸的体积 Vₐ', 'en-US': 'Acid volume Vₐ' },
        type: 'range',
        min: 5,
        max: 100,
        step: 1,
        value: this.state.acidVolume,
        hint: zh ? '锥形瓶中酸样体积（mL）' : 'acid sample volume in the flask (mL)',
      },
      {
        key: 'baseConc',
        label: 'c(NaOH)',
        labelI18n: { 'zh-CN': '碱的浓度 c_b', 'en-US': 'Base concentration c_b' },
        type: 'range',
        min: 0.005,
        max: 2,
        step: 0.005,
        value: this.state.baseConc,
        hint: zh ? '滴定用 NaOH 浓度（mol/L）' : 'NaOH titrant concentration (mol/L)',
      },
      {
        key: 'tol',
        label: 'Solver tol',
        labelI18n: { 'zh-CN': '迭代容差', 'en-US': 'Solver tolerance' },
        type: 'select',
        options: TOLERANCES.map((t) => ({
          value: t.value,
          label: zh ? t.labelZh : t.labelEn,
          labelI18n: { 'zh-CN': t.labelZh, 'en-US': t.labelEn },
        })),
        value: this.state.tolKey,
        hint: zh ? 'Newton 迭代 [H+] 相对收敛容差' : 'relative convergence tolerance on [H+]',
      },
      {
        key: 'showIndicators',
        label: 'Indicators',
        labelI18n: { 'zh-CN': '叠加指示剂变色区间', 'en-US': 'Overlay indicator ranges' },
        type: 'checkbox',
        value: this.state.showIndicators,
        hint: zh ? '甲基橙 3.1–4.4 / 酚酞 8.2–10.0' : 'methyl orange 3.1–4.4 / phenolphthalein 8.2–10.0',
      },
      actionButton('recompute', 'Recompute curve', '重新计算曲线', 'primary'),
      actionButton('benchmark', 'Run analytic benchmarks', '运行解析基准对拍'),
      actionButton('exportCsv', 'Export curve CSV', '导出曲线 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    const num = (k: string, cb: (n: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        if (cb(params[k] as number)) changed = true;
      }
    };
    if (typeof params.acid === 'string' && (ACID_PRESETS.some((p) => p.key === params.acid) || params.acid === 'custom')) {
      if (params.acid !== this.state.acid) {
        this.state.acid = params.acid;
        changed = true;
      }
    }
    num('kaCustom', (n) => {
      const v = Math.min(1, Math.max(1e-11, n));
      if (v === this.state.kaCustom) return false;
      this.state.kaCustom = v;
      return true;
    });
    num('acidConc', (n) => {
      const v = Math.min(2, Math.max(0.005, n));
      if (v === this.state.acidConc) return false;
      this.state.acidConc = v;
      return true;
    });
    num('acidVolume', (n) => {
      const v = Math.min(100, Math.max(5, Math.round(n)));
      if (v === this.state.acidVolume) return false;
      this.state.acidVolume = v;
      return true;
    });
    num('baseConc', (n) => {
      const v = Math.min(2, Math.max(0.005, n));
      if (v === this.state.baseConc) return false;
      this.state.baseConc = v;
      return true;
    });
    if (typeof params.tol === 'string' && TOLERANCES.some((t) => t.value === params.tol)) {
      if (params.tol !== this.state.tolKey) {
        this.state.tolKey = params.tol;
        changed = true;
      }
    }
    if (typeof params.showIndicators === 'boolean' && params.showIndicators !== this.state.showIndicators) {
      this.state.showIndicators = params.showIndicators;
      changed = true;
    }
    if (actionFired(params, 'recompute')) changed = true;
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (changed) this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- scientific outputs ---------------------------------------------------

  /**
   * Publish the equivalence-point conclusions: numeric pH at Ve, the
   * equivalence volume, the relative error against the analytic oracle
   * (neutral pH 7.00 for strong/strong, the hydrolysis formula for weak
   * acids) and — for weak acids — the Henderson–Hasselbalch anchor at
   * half equivalence (pH ≈ pKa).
   */
  private publish(spec: AcidSpec, pHeq: number) {
    const vEq = equivalenceVolume(spec);
    const analytic = equivalencePhAnalytic(spec);
    const err = relErr(pHeq, analytic);
    const phInit = phAt(spec, 0, this.tolerance());
    const errInit = relErr(phInit, initialPhAnalytic(spec));
    const isWeak = spec.kind === 'weak';
    const pKa = pKaOf(spec);
    const phHalf = isWeak ? phAt(spec, vEq / 2, this.tolerance()) : Number.NaN;
    const metrics: ScienceMetric[] = [
      {
        key: 'eq-ph',
        label: this.zh ? '等当点 pH' : 'Equivalence pH',
        value: fmtMetric(pHeq),
        severity: 'ok',
        hint:
          this.zh
            ? '全离子平衡 Newton 解（含 Kw）'
            : 'full ionic-balance Newton solution (Kw included)',
      },
      {
        key: 'eq-volume',
        label: this.zh ? '等当点体积 Ve' : 'Equivalence volume Ve',
        value: fmtMetric(vEq),
        unit: 'mL',
        severity: 'info',
        hint: this.zh ? 'Ve = cₐVₐ / c_b（一元酸 + 一元碱）' : 'Ve = cₐVₐ / c_b (monoprotic acid + base)',
      },
      {
        key: 'eq-rel-err',
        label: this.zh ? '等当点 pH 相对误差' : 'Equivalence pH rel. error',
        value: fmtMetric(err * 100),
        unit: '%',
        severity: err < 0.005 ? 'ok' : 'warn',
        hint:
          this.zh
            ? `对照解析式 ${fmtMetric(analytic)}（${isWeak ? '½(pKw+pKa+lg c盐)' : '强酸强碱 pH=7.00'}）`
            : `vs analytic ${fmtMetric(analytic)} (${isWeak ? '½(pKw+pKa+lg c_salt)' : 'strong/strong pH=7.00'})`,
      },
      {
        key: 'init-ph',
        label: this.zh ? '初始 pH（V=0）' : 'Initial pH (V=0)',
        value: fmtMetric(phInit),
        severity: 'info',
        hint:
          this.zh
            ? `稀释定律解析值 ${fmtMetric(initialPhAnalytic(spec))}，相对误差 ${fmtMetric(errInit * 100)}%`
            : `dilution-law analytic ${fmtMetric(initialPhAnalytic(spec))}, rel. error ${fmtMetric(errInit * 100)}%`,
      },
    ];
    if (isWeak) {
      metrics.push({
        key: 'hh-check',
        label: this.zh ? '半等当点 pH ≈ pKa' : 'Half-equivalence pH ≈ pKa',
        value: `${fmtMetric(phHalf)} (pKa=${fmtMetric(pKa)})`,
        severity: Math.abs(phHalf - pKa) < 0.01 ? 'ok' : 'warn',
        hint: this.zh ? 'Henderson–Hasselbalch 锚点：[A⁻]=[HA] 时 pH≈pKa' : 'Henderson–Hasselbalch anchor: pH ≈ pKa at [A⁻]=[HA]',
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  /** Embedded benchmark: the three textbook oracles on the current acid set. */
  private runBenchmark() {
    const tol = this.tolerance();
    // 1. 0.1 M NaOH vs 25 mL 0.1 M HCl → equivalence pH = 7.00 ± 0.02.
    const strong: AcidSpec = { kind: 'strong', conc: 0.1, volume: 25, baseConc: 0.1, ka: Number.POSITIVE_INFINITY };
    const phStrong = phAt(strong, equivalenceVolume(strong), tol);
    const okStrong = Math.abs(phStrong - 7) <= 0.02;
    // 2. 0.1 M NaOH vs 0.1 M HAc (Ka = 1.8e-5) → hydrolysis formula oracle.
    const weak: AcidSpec = { kind: 'weak', conc: 0.1, volume: 25, baseConc: 0.1, ka: 1.8e-5 };
    const phWeak = phAt(weak, equivalenceVolume(weak), tol);
    const errWeak = relErr(phWeak, equivalencePhAnalytic(weak));
    // 3. Initial pH vs the exact dilution-law quadratic (weak acid).
    const errInit = relErr(phAt(weak, 0, tol), initialPhAnalytic(weak));
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-strong-eq',
        label: this.zh ? '基准 · 强酸等当点 pH' : 'Bench · strong-acid eq. pH',
        value: fmtMetric(phStrong),
        severity: okStrong ? 'ok' : 'warn',
        hint: this.zh ? '0.1 M NaOH 滴 25 mL 0.1 M HCl，容差 ±0.02' : '0.1 M NaOH vs 25 mL 0.1 M HCl, tolerance ±0.02',
      },
      {
        key: 'bench-weak-eq-err',
        label: this.zh ? '基准 · 弱酸水解公式误差' : 'Bench · weak-acid oracle err',
        value: fmtMetric(errWeak * 100),
        unit: '%',
        severity: errWeak < 0.005 ? 'ok' : 'warn',
        hint: this.zh ? '对照 pH=½(pKw+pKa+lg c盐)，阈值 0.5%' : 'vs pH=½(pKw+pKa+lg c_salt), threshold 0.5%',
      },
      {
        key: 'bench-dilution-err',
        label: this.zh ? '基准 · 初始 pH 误差' : 'Bench · initial-pH err',
        value: fmtMetric(errInit * 100),
        unit: '%',
        severity: errInit < 0.005 ? 'ok' : 'warn',
        hint: this.zh ? '对照稀释定律精确二次式，阈值 0.5%' : 'vs exact dilution-law quadratic, threshold 0.5%',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      okStrong && errWeak < 0.005 && errInit < 0.005 ? 'success' : 'warning',
      `Benchmarks: strong eq pH=${phStrong.toFixed(3)} (|Δ|≤0.02: ${okStrong ? 'pass' : 'fail'}), weak oracle err ${(errWeak * 100).toFixed(3)}%, initial-pH err ${(errInit * 100).toFixed(3)}%`,
      `基准对拍：强酸等当点 pH=${phStrong.toFixed(3)}（±0.02 ${okStrong ? '通过' : '未过'}），弱酸公式误差 ${(errWeak * 100).toFixed(3)}%，初始 pH 误差 ${(errInit * 100).toFixed(3)}%`,
    );
  }

  private exportCsv() {
    if (!this.curve || this.curve.length === 0) {
      notify(this.api, 'warning', 'Compute the curve first.', '请先计算滴定曲线。');
      return;
    }
    const rows: Array<Array<number | string>> = this.curve.map((p) => [
      Number(p.vBase.toFixed(4)),
      Number(p.ph.toFixed(6)),
    ]);
    exportRowsCsv(this.api, 'titration-curve', ['V_base_mL', 'pH'], rows);
  }

  // ---- drawing ---------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    const spec = this.acidSpec();
    const tol = this.tolerance();
    this.vEq = equivalenceVolume(spec);
    this.curve = titrationCurve(spec, { tol, steps: 400 });
    const pHeq = phAt(spec, this.vEq, tol);
    this.publish(spec, pHeq);

    const zh = this.zh;
    const padL = 56;
    const padR = 16;
    const padT = 46;
    const padB = 46;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);
    const vMax = 2 * this.vEq;
    const px = (v: number) => x0 + (plotW * v) / vMax;
    const py = (ph: number) => y1 - (plotH * ph) / 14;

    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.fillText(
      zh ? '酸碱滴定曲线  pH = f(V_NaOH)' : 'Acid–base titration  pH = f(V_NaOH)',
      canvas.width / 2,
      20,
    );
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // axes ticks (pH 0–14 grid every 2 units, volume grid every 0.1·vMax)
    g.font = `10px Consolas, monospace`;
    for (let phv = 0; phv <= 14; phv += 2) {
      const sy = py(phv);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.textAlign = 'right';
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(String(phv), x0 - 6, sy + 4);
    }
    for (let i = 0; i <= 5; i += 1) {
      const vv = (vMax * i) / 5;
      const sx = px(vv);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(sx, y0);
      g.lineTo(sx, y1);
      g.stroke();
      g.textAlign = 'center';
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(vv.toFixed(1), sx, y1 + 14);
    }

    // buffer zone (weak acid): the 10%–90% neutralisation band
    if (spec.kind === 'weak') {
      const bx0 = px(0.1 * this.vEq);
      const bx1 = px(0.9 * this.vEq);
      g.fillStyle = 'rgba(120,220,170,0.08)';
      g.fillRect(bx0, y0, Math.max(bx1 - bx0, 1), plotH);
      g.fillStyle = 'rgba(120,220,170,0.75)';
      g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      g.fillText(zh ? '缓冲区' : 'buffer zone', (bx0 + bx1) / 2, y0 + 14);
    }

    // indicator transition ranges as horizontal bands
    if (this.state.showIndicators) {
      g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      for (const ind of INDICATORS) {
        const by0 = py(Math.min(ind.high, 14));
        const by1 = py(Math.max(ind.low, 0));
        g.fillStyle = ind.color;
        g.fillRect(x0, by0, plotW, Math.max(by1 - by0, 1));
        g.fillStyle = 'rgba(220,228,240,0.85)';
        g.textAlign = 'right';
        g.fillText(zh ? ind.zh : ind.en, x1 - 6, py((ind.low + ind.high) / 2) - 4);
      }
    }

    // the titration curve
    g.strokeStyle = 'rgba(120,190,255,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    this.curve.forEach((p, i) => {
      const sy = py(Math.min(Math.max(p.ph, 0), 14));
      if (i === 0) g.moveTo(px(p.vBase), sy);
      else g.lineTo(px(p.vBase), sy);
    });
    g.stroke();
    g.lineWidth = 1;

    // equivalence point: dashed vertical + marker
    const ex = px(this.vEq);
    const ey = py(Math.min(Math.max(pHeq, 0), 14));
    g.strokeStyle = 'rgba(255,210,110,0.8)';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(ex, y0);
    g.lineTo(ex, y1);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(255,210,110,0.95)';
    g.beginPath();
    g.arc(ex, ey, 4, 0, Math.PI * 2);
    g.fill();
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillText(
      `${zh ? '等当点' : 'eq.'} (${this.vEq.toFixed(2)} mL, pH ${pHeq.toFixed(2)})`,
      Math.min(ex + 8, x1 - 150),
      Math.min(ey - 8, y1 - 6),
    );

    g.textAlign = 'right';
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.fillText('pH', x0 - 6, y0 - 8);
    g.textAlign = 'right';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText(zh ? 'V(NaOH) / mL' : 'V(NaOH) / mL', x1, y1 + 28);

    // footer
    const acidName = this.state.acid === 'custom' ? (zh ? '自定义 Ka' : 'custom Ka') : (ACID_PRESETS.find((p) => p.key === this.state.acid)?.[zh ? 'zh' : 'en'] ?? '');
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const l1 = zh
      ? `${spec.kind === 'strong' ? '强酸' : '弱酸'} ${acidName}  cₐ=${spec.conc.toFixed(3)} M  Vₐ=${spec.volume} mL  c_b=${spec.baseConc.toFixed(3)} M  Ka=${Number.isFinite(spec.ka) ? spec.ka.toExponential(2) : '∞'}`
      : `${spec.kind === 'strong' ? 'Strong' : 'Weak'} acid ${acidName}  cₐ=${spec.conc.toFixed(3)} M  Vₐ=${spec.volume} mL  c_b=${spec.baseConc.toFixed(3)} M  Ka=${Number.isFinite(spec.ka) ? spec.ka.toExponential(2) : '∞'}`;
    g.fillText(l1, 56, canvas.height - 28);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const l2 = zh
      ? '全离子平衡（电荷+物料+Ka+Kw）· 带二分保护 Newton 迭代 · 容差 ' + tol.toExponential(0)
      : 'Full ionic balance (charge + mass + Ka + Kw) · safeguarded Newton · tol ' + tol.toExponential(0);
    g.fillText(l2, 56, canvas.height - 12);
  }
}

export default function createChemTitrationPlugin(): Plugin {
  return new ChemTitrationPlugin();
}
