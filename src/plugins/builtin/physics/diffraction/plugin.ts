// ==========================================================================
// physics-diffraction — Fresnel–Kirchhoff diffraction laboratory
//
// Renders the numerically integrated diffraction pattern of a programmable
// aperture (single slit / double slit / N-slit grating / circular hole): an
// aperture schematic plus the intensity profile with the Fraunhofer far-field
// reference overlaid, and a 2-D map of the pattern. The science strip carries
// the Fresnel number, the screen-energy fraction against the unitary total,
// and the aperture-appropriate validation metric (slit minima / fringe
// spacing / Airy ring). The benchmark action runs the four kernel
// validations; the profile exports to CSV.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi, RangeParam } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { diffractionFigurePanels } from './figure';
import { physicsDiffractionManifest } from './manifest';
import {
  AIRY_RING_FACTOR,
  apertureEnergy,
  benchmarkAiryRing,
  benchmarkDoubleSlitSpacing,
  benchmarkEnergyConservation,
  benchmarkSingleSlitMinima,
  dominantSpacing,
  findLocalMaxima,
  findLocalMinima,
  fraunhofer1d,
  fraunhoferAiry,
  fresnelNumber,
  sampleCircleIntensity,
  sampleSlitIntensity,
  slitSegments,
  screenEnergyCircle,
  screenEnergySlit,
  type ApertureKind,
  type DiffractionParams,
  type Profile1D,
} from './kernel';

export { physicsDiffractionManifest } from './manifest';

const APERTURES: Array<{ value: ApertureKind; zh: string; en: string }> = [
  { value: 'slit', zh: '单缝', en: 'Single slit' },
  { value: 'double', zh: '双缝', en: 'Double slit' },
  { value: 'grating', zh: 'N 缝光栅', en: 'N-slit grating' },
  { value: 'circle', zh: '圆孔', en: 'Circular hole' },
];

interface State {
  aperture: ApertureKind;
  a: number;
  d: number;
  nSlits: number;
  radius: number;
  L: number;
  screenHalf: number;
  overlay: boolean;
}

/** Static range-slider definitions (current value injected per aperture). */
const ALL_RANGES: Record<'a' | 'd' | 'nSlits' | 'radius' | 'L' | 'screenHalf', RangeParam> = {
  a: { key: 'a', label: 'Slit width a', labelI18n: { 'zh-CN': '缝宽 a', 'en-US': 'Slit width a' }, type: 'range', min: 2, max: 30, step: 0.5, value: 8 },
  d: { key: 'd', label: 'Slit separation d', labelI18n: { 'zh-CN': '缝间距 d', 'en-US': 'Slit separation d' }, type: 'range', min: 10, max: 80, step: 1, value: 40 },
  nSlits: { key: 'nSlits', label: 'Number of slits N', labelI18n: { 'zh-CN': '缝数 N', 'en-US': 'Number of slits N' }, type: 'range', min: 2, max: 8, step: 1, value: 4 },
  radius: { key: 'radius', label: 'Hole radius R', labelI18n: { 'zh-CN': '圆孔半径 R', 'en-US': 'Hole radius R' }, type: 'range', min: 1, max: 20, step: 0.5, value: 5 },
  L: { key: 'L', label: 'Distance L', labelI18n: { 'zh-CN': '传播距离 L', 'en-US': 'Distance L' }, type: 'range', min: 100, max: 2000000, step: 100, value: 2e5 },
  screenHalf: { key: 'screenHalf', label: 'Screen half-width', labelI18n: { 'zh-CN': '屏幕半宽', 'en-US': 'Screen half-width' }, type: 'range', min: 1000, max: 400000, step: 1000, value: 4e4 },
};

export class PhysicsDiffractionPlugin implements Plugin {
  readonly manifest = physicsDiffractionManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private profile: Profile1D | null = null;
  private state: State = {
    aperture: 'slit',
    a: 8,
    d: 40,
    nSlits: 4,
    radius: 5,
    L: 2e5,
    screenHalf: 4e4,
    overlay: true,
  };

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.recompute();
      this.draw();
    });
  }

  async destroy() {
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
    this.profile = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    this.recompute();
    this.draw();
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.recompute();
    this.draw();
  }

  private params(): DiffractionParams {
    return {
      aperture: this.state.aperture,
      a: this.state.a,
      d: this.state.d,
      nSlits: Math.round(this.state.nSlits),
      radius: this.state.radius,
      L: this.state.L,
      lambda: 1,
      screenHalf: this.state.screenHalf,
    };
  }

  getParams(): ParamDefinition[] {
    const opt = (items: Array<{ value: string; zh: string; en: string }>) =>
      items.map((it) => ({
        value: it.value,
        label: this.zh ? it.zh : it.en,
        labelI18n: { 'zh-CN': it.zh, 'en-US': it.en },
      }));
    // Only expose the sliders the active aperture actually consumes — a slider
    // that feeds unused state reads as "no response" when dragged.
    const ap = this.state.aperture;
    const ranges: RangeParam[] = [];
    const pushRange = (key: 'a' | 'd' | 'nSlits' | 'radius' | 'L' | 'screenHalf') => ranges.push(ALL_RANGES[key]);
    if (ap === 'slit') {
      pushRange('a');
    } else if (ap === 'double') {
      pushRange('a');
      pushRange('d');
    } else if (ap === 'grating') {
      pushRange('a');
      pushRange('d');
      pushRange('nSlits');
    } else {
      pushRange('radius');
    }
    pushRange('L');
    pushRange('screenHalf');
    return [
      {
        key: 'aperture',
        label: 'Aperture',
        labelI18n: { 'zh-CN': '孔径类型', 'en-US': 'Aperture' },
        type: 'select',
        options: opt(APERTURES),
        value: this.state.aperture,
      },
      ...ranges.map((def) => ({ ...def, value: this.state[def.key as keyof State] as number })),
      {
        key: 'overlay',
        label: 'Overlay Fraunhofer reference',
        labelI18n: { 'zh-CN': '叠加夫琅禾费远场参考', 'en-US': 'Overlay Fraunhofer reference' },
        type: 'checkbox',
        value: this.state.overlay,
      },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('exportProfile', 'Export profile CSV', '导出剖面 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    const num = (k: 'a' | 'd' | 'nSlits' | 'radius' | 'L' | 'screenHalf', cb?: (v: number) => number): void => {
      const v = params[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        const next = cb ? cb(v) : v;
        if (next !== this.state[k]) {
          (this.state as unknown as Record<string, number>)[k] = next;
          changed = true;
        }
      }
    };
    const pick = (v: unknown): void => {
      if (typeof v === 'string' && APERTURES.some((it) => it.value === v) && v !== this.state.aperture) {
        this.state.aperture = v as ApertureKind;
        changed = true;
      }
    };
    const flag = (v: unknown): void => {
      if (typeof v === 'boolean' && v !== this.state.overlay) {
        this.state.overlay = v;
        changed = true;
      }
    };

    pick(params.aperture);
    num('a', (v) => Math.min(30, Math.max(2, v)));
    num('d', (v) => Math.min(80, Math.max(10, v)));
    num('nSlits', (v) => Math.round(Math.min(8, Math.max(2, v))));
    num('radius', (v) => Math.min(20, Math.max(1, v)));
    num('L', (v) => Math.min(2000000, Math.max(100, v)));
    num('screenHalf', (v) => Math.min(400000, Math.max(1000, v)));
    flag(params.overlay);

    if (changed) {
      this.recompute();
      this.draw();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmarks();
    if (actionFired(params, 'exportProfile')) this.exportProfile();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  // ---- compute ----------------------------------------------------------------

  private recompute() {
    const p = this.params();
    // Adaptive density: keep ≥ ~500 samples across the finest expected feature
    // (fringe spacing λL/d for slit families, λL/D for the circle).
    const feature = p.aperture === 'circle' ? (p.lambda * p.L) / (2 * p.radius) : (p.lambda * p.L) / p.d;
    const n = Math.min(1601, Math.max(601, Math.round((2 * p.screenHalf) / Math.max(feature / 400, 1))));
    this.profile = p.aperture === 'circle' ? sampleCircleIntensity(p, n) : sampleSlitIntensity(p, n);
    this.publishLive();
  }

  // ---- science outputs ----------------------------------------------------------

  private publishLive() {
    const p = this.params();
    const zh = this.zh;
    const F = fresnelNumber(p);
    const metrics: ScienceMetric[] = [
      {
        key: 'fresnel',
        label: zh ? '菲涅尔数 F' : 'Fresnel number',
        value: fmtMetric(F),
        severity: F < 0.05 ? 'ok' : F < 0.5 ? 'info' : 'warn',
        hint:
          zh
            ? 'F = (孔径半宽)²/(λL)；F≪1 为夫琅禾费远场区，远场参考在该区精确'
            : 'F = (aperture half-size)²/(λL); F≪1 is the Fraunhofer regime where far-field references are exact',
      },
    ];

    const energy = p.aperture === 'circle' ? screenEnergyCircle(p, 1201) : screenEnergySlit(p, 1201);
    const total = apertureEnergy(p);
    const frac = energy / total;
    metrics.push({
      key: 'energy-frac',
      label: zh ? '屏内能量占比' : 'Screen energy fraction',
      value: fmtMetric(frac * 100),
      unit: '%',
      severity: Math.abs(frac - 1) < 0.05 ? 'ok' : 'info',
      hint:
        zh
          ? `∫I = ${fmtMetric(energy)} vs 幺正总能量 ${fmtMetric(total)}；占比不足说明屏幕窗口太窄`
          : `∫I = ${fmtMetric(energy)} vs unitary total ${fmtMetric(total)}; a low fraction means the screen window is too narrow`,
    });

    const gate = this.primaryValidation(p);
    if (gate) metrics.push(gate);
    setScienceOutputs(this.manifest.id, metrics);
  }

  /** Aperture-specific validation metric against the far-field theory. */
  private primaryValidation(p: DiffractionParams): ScienceMetric | null {
    const zh = this.zh;
    if (!this.profile) return null;
    if (p.aperture === 'slit') {
      const minima = findLocalMinima(this.profile.xs, this.profile.ys).filter((m) => m.x > 0);
      let worst: { m: number; rel: number } | null = null;
      for (let m = 1; m <= 3; m++) {
        const xm = (m * p.lambda * p.L) / p.a;
        let best: number | null = null;
        let dist = Number.POSITIVE_INFINITY;
        for (const d of minima) {
          const dd = Math.abs(d.x - xm);
          if (dd < dist) {
            dist = dd;
            best = d.x;
          }
        }
        if (best === null) continue;
        const rel = Math.abs(best - xm) / xm;
        if (!worst || rel > worst.rel) worst = { m, rel };
      }
      if (!worst) return null;
      return {
        key: 'minima-err',
        label: zh ? '极小位置最大相对误差' : 'Max minima-position rel err',
        value: fmtMetric(worst.rel * 100),
        unit: '%',
        severity: fresnelNumber(p) < 0.05 ? (worst.rel < 1e-3 ? 'ok' : 'warn') : 'info',
        hint:
          zh
            ? `第 ${worst.m} 级极小 vs x_m = m·λL/a；远场（F≪1）门槛 <0.1%${fresnelNumber(p) >= 0.05 ? '；当前 F 偏大，理论值为远场近似' : ''}`
            : `order m=${worst.m} vs x_m = m·λL/a; far-field (F≪1) gate <0.1%${fresnelNumber(p) >= 0.05 ? ' — current F is large, theory is the far-field limit' : ''}`,
      };
    }
    if (p.aperture === 'double' || p.aperture === 'grating') {
      const theory = (p.lambda * p.L) / p.d;
      const diffs: number[] = [];
      if (p.aperture === 'double') {
        // Minima of the two-beam factor sit exactly at (k+½)λL/d — unbiased
        // by the envelope tilt that displaces the maxima.
        const mins = findLocalMinima(this.profile.xs, this.profile.ys).filter((m) => m.x > 0);
        for (let i = 1; i < mins.length; i++) diffs.push(mins[i]!.x - mins[i - 1]!.x);
      } else {
        // Principal maxima (structure-factor peaks ≥ 25 % of the brightest
        // one); secondary maxima and missing-order gaps are rejected by the
        // amplitude filter and the dominant-spacing clustering.
        const maxima = findLocalMaxima(this.profile.xs, this.profile.ys);
        let peak = 0;
        for (const mm of maxima) peak = Math.max(peak, mm.value);
        const principal = maxima.filter((m) => m.x > 0 && m.value >= 0.25 * peak);
        for (let i = 1; i < principal.length; i++) diffs.push(principal[i]!.x - principal[i - 1]!.x);
      }
      if (diffs.length < 3) return null;
      const measured = dominantSpacing(diffs);
      const rel = Math.abs(measured - theory) / theory;
      return {
        key: 'fringe-err',
        label: zh ? '条纹间距相对误差' : 'Fringe-spacing rel err',
        value: fmtMetric(rel * 100),
        unit: '%',
        severity: fresnelNumber(p) < 0.05 ? (rel < 1e-2 ? 'ok' : 'warn') : 'info',
        hint:
          zh
            ? `主导间距 ${fmtMetric(measured)} vs Δx = λL/d = ${fmtMetric(theory)}；远场门槛 <1%${fresnelNumber(p) >= 0.05 ? '；当前 F 偏大，理论值为远场近似' : ''}`
            : `dominant spacing ${fmtMetric(measured)} vs Δx = λL/d = ${fmtMetric(theory)}; far-field gate <1%${fresnelNumber(p) >= 0.05 ? ' — current F is large, theory is the far-field limit' : ''}`,
      };
    }
    // circle
    const minima = findLocalMinima(this.profile.xs, this.profile.ys);
    if (minima.length === 0) return null;
    const measured = minima[0]!.x;
    const theory = (AIRY_RING_FACTOR * p.lambda * p.L) / (2 * p.radius);
    const rel = Math.abs(measured - theory) / theory;
    return {
      key: 'airy-err',
      label: zh ? 'Airy 暗环相对误差' : 'Airy dark-ring rel err',
      value: fmtMetric(rel * 100),
      unit: '%',
      severity: fresnelNumber(p) < 0.05 ? (rel < 1e-3 ? 'ok' : 'warn') : 'info',
      hint:
        zh
          ? `首暗环 r=${fmtMetric(measured)} vs r₁ = 1.21967·λL/D = ${fmtMetric(theory)}；远场门槛 <0.1%${fresnelNumber(p) >= 0.05 ? '；当前 F 偏大，理论值为远场近似' : ''}`
          : `first ring r=${fmtMetric(measured)} vs r₁ = 1.21967·λL/D = ${fmtMetric(theory)}; far-field gate <0.1%${fresnelNumber(p) >= 0.05 ? ' — current F is large, theory is the far-field limit' : ''}`,
    };
  }

  private runBenchmarks() {
    const zh = this.zh;
    const minima = benchmarkSingleSlitMinima();
    const fringes = benchmarkDoubleSlitSpacing();
    const energy = benchmarkEnergyConservation();
    const airy = benchmarkAiryRing();
    const okMin = minima.maxRelErr < 1e-3;
    const okFringe = fringes.relErr < 1e-2;
    const okEnergy = energy.relErr < 5e-2;
    const okAiry = airy.relErr < 1e-3;
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-slit-minima',
        label: zh ? '基准① 单缝极小位置' : 'Bench ① slit minima',
        value: fmtMetric(minima.maxRelErr * 100),
        unit: '%',
        severity: okMin ? 'ok' : 'warn',
        hint: zh
          ? `x_m = m·λL/a（a=8λ, L=2·10⁵λ），门槛 <0.1%；实测 [${minima.positions.map((v) => fmtMetric(v)).join(', ')}]`
          : `x_m = m·λL/a (a=8λ, L=2·10⁵λ); gate <0.1%; measured [${minima.positions.map((v) => fmtMetric(v)).join(', ')}]`,
      },
      {
        key: 'bench-fringes',
        label: zh ? '基准② 双缝条纹间距' : 'Bench ② fringe spacing',
        value: fmtMetric(fringes.relErr * 100),
        unit: '%',
        severity: okFringe ? 'ok' : 'warn',
        hint: zh
          ? `Δx = λL/d = ${fmtMetric(fringes.theory)}（a=8λ, d=40λ, L=10⁵λ），门槛 <1%；实测 ${fmtMetric(fringes.measured)}`
          : `Δx = λL/d = ${fmtMetric(fringes.theory)} (a=8λ, d=40λ, L=10⁵λ); gate <1%; measured ${fmtMetric(fringes.measured)}`,
      },
      {
        key: 'bench-energy',
        label: zh ? '基准③ 能量守恒（近场）' : 'Bench ③ energy conservation',
        value: fmtMetric(energy.relErr * 100),
        unit: '%',
        severity: okEnergy ? 'ok' : 'warn',
        hint: zh
          ? `∫I dx = ${fmtMetric(energy.numeric)} vs N·a = ${fmtMetric(energy.theory)}（a=20λ, L=500λ, F=0.2），门槛 <5%`
          : `∫I dx = ${fmtMetric(energy.numeric)} vs N·a = ${fmtMetric(energy.theory)} (a=20λ, L=500λ, F=0.2); gate <5%`,
      },
      {
        key: 'bench-airy',
        label: zh ? '基准④ Airy 第一暗环' : 'Bench ④ Airy first ring',
        value: fmtMetric(airy.relErr * 100),
        unit: '%',
        severity: okAiry ? 'ok' : 'warn',
        hint: zh
          ? `r₁ = 1.21967·λL/D = ${fmtMetric(airy.theory)}（R=5λ, L=10⁶λ），门槛 <0.1%；实测 ${fmtMetric(airy.measured)}`
          : `r₁ = 1.21967·λL/D = ${fmtMetric(airy.theory)} (R=5λ, L=10⁶λ); gate <0.1%; measured ${fmtMetric(airy.measured)}`,
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    const allOk = okMin && okFringe && okEnergy && okAiry;
    notify(
      this.api,
      allOk ? 'success' : 'warning',
      `Benchmarks: minima ${(minima.maxRelErr * 100).toFixed(4)}%, fringes ${(fringes.relErr * 100).toFixed(3)}%, energy ${(energy.relErr * 100).toFixed(3)}%, Airy ${(airy.relErr * 100).toFixed(4)}%`,
      `基准验证：单缝极小 ${(minima.maxRelErr * 100).toFixed(4)}%，条纹间距 ${(fringes.relErr * 100).toFixed(3)}%，能量守恒 ${(energy.relErr * 100).toFixed(3)}%，Airy 暗环 ${(airy.relErr * 100).toFixed(4)}%`,
    );
  }

  private exportProfile() {
    if (!this.profile) {
      notify(this.api, 'warning', 'Nothing to export yet.', '暂无可导出数据。');
      return;
    }
    const p = this.params();
    const rows: Array<Array<number | string>> = [];
    for (let i = 0; i < this.profile.xs.length; i++) {
      const x = this.profile.xs[i]!;
      const ref = p.aperture === 'circle' ? fraunhoferAiry(x, p) : fraunhofer1d(x, p);
      rows.push([Number(x.toFixed(4)), Number(this.profile.ys[i]!.toExponential(6)), ref === null ? '—' : Number(ref.toExponential(6))]);
    }
    const label = p.aperture === 'circle' ? 'r' : 'x';
    exportRowsCsv(this.api, `diffraction-${p.aperture}-profile`, [label, 'I_fresnel_kirchhoff', 'I_fraunhofer_ref'], rows);
  }

  /** Build the two diffraction panels and push them into Figure Studio. */
  private async sendToFigure(): Promise<void> {
    if (!this.profile) {
      notify(this.api, 'warning', 'No profile yet — adjust the aperture first.', '暂无强度剖面——请先调整孔径参数。');
      return;
    }
    const p = this.params();
    const apName = APERTURES.find((it) => it.value === p.aperture);
    const ap = apName ? (this.zh ? apName.zh : apName.en) : p.aperture;
    const energy = p.aperture === 'circle' ? screenEnergyCircle(p, 1201) : screenEnergySlit(p, 1201);
    const frac = energy / apertureEnergy(p);
    let peak = 0;
    for (let k = 0; k < this.profile.ys.length; k++) peak = Math.max(peak, this.profile.ys[k]!);
    const caption: Bilingual = {
      zh: `菲涅尔-基尔霍夫衍射（${ap}）：菲涅尔数 F=${fmtMetric(fresnelNumber(p))}，屏内能量占比 ${(frac * 100).toFixed(1)}%，峰值强度 ${fmtMetric(peak)}。`,
      en: `Fresnel–Kirchhoff diffraction (${ap}): Fresnel number F=${fmtMetric(fresnelNumber(p))}, screen energy fraction ${(frac * 100).toFixed(1)}%, peak intensity ${fmtMetric(peak)}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '衍射强度分布', en: 'Diffraction Intensity Pattern' },
      caption,
      diffractionFigurePanels({ params: p, profile: this.profile, overlay: this.state.overlay }),
    );
  }

  // ---- drawing ------------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 460;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (!this.profile) this.recompute();
    const p = this.params();
    const zh = this.zh;
    const font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const apName = APERTURES.find((it) => it.value === p.aperture);
    g.fillText(
      zh
        ? `菲涅尔-基尔霍夫衍射 · ${apName ? apName.zh : p.aperture} · L=${fmtMetric(p.L)}λ · F=${fmtMetric(fresnelNumber(p))}`
        : `Fresnel–Kirchhoff diffraction · ${apName ? apName.en : p.aperture} · L=${fmtMetric(p.L)}λ · F=${fmtMetric(fresnelNumber(p))}`,
      canvas.width / 2,
      18,
    );

    if (!this.profile) return;
    const curveH = Math.round(canvas.height * 0.42);
    this.drawProfile(g, canvas, p, 26, curveH, font);
    this.drawMap(g, canvas, p, curveH + 22, font);
  }

  private drawProfile(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, p: DiffractionParams, padT: number, plotH: number, font: string) {
    const zh = this.zh;
    const prof = this.profile!;
    const padL = 56;
    const padR = 18;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = padT + plotH;
    const plotW = Math.max(x1 - x0, 10);

    let vMax = 1e-12;
    for (let i = 0; i < prof.ys.length; i++) vMax = Math.max(vMax, prof.ys[i]!);
    vMax *= 1.06;
    const px = (x: number) => x0 + (plotW * (x + p.screenHalf)) / (2 * p.screenHalf);
    const py = (v: number) => y1 - (plotH * v) / vMax;

    // Display points spanning the full [-screenHalf, +screenHalf] axis. The
    // circle profile is radial I(r), r ∈ [0, screenHalf] — mirror it so the
    // curve covers the same axis as the 2-D map below.
    const isCircle = p.aperture === 'circle';
    const pts: Array<{ x: number; y: number }> = [];
    if (isCircle) {
      for (let i = prof.xs.length - 1; i >= 0; i--) pts.push({ x: -prof.xs[i]!, y: prof.ys[i]! });
      for (let i = 0; i < prof.xs.length; i++) pts.push({ x: prof.xs[i]!, y: prof.ys[i]! });
    } else {
      for (let i = 0; i < prof.xs.length; i++) pts.push({ x: prof.xs[i]!, y: prof.ys[i]! });
    }

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);
    g.font = font;

    // aperture schematic on the baseline: grey bars = opaque mask, gaps = slits
    const segs = p.aperture === 'circle' ? [] : slitSegments(p);
    if (segs.length > 0) {
      g.fillStyle = 'rgba(150,165,190,0.55)';
      const sc = plotW / (2 * p.screenHalf);
      const cx = px(0);
      const barH = 6;
      const ext = Math.min(p.d > 0 ? p.d : p.a, p.screenHalf * 0.01);
      g.fillRect(cx + (segs[0]!.x0 - ext) * sc, y1 - barH, ext * sc, barH);
      g.fillRect(cx + segs[segs.length - 1]!.x1 * sc, y1 - barH, ext * sc, barH);
      for (let s = 0; s < segs.length - 1; s++) {
        const xa = cx + segs[s]!.x1 * sc;
        const xb = cx + segs[s + 1]!.x0 * sc;
        if (xb > xa) g.fillRect(xa, y1 - barH, xb - xa, barH);
      }
    }

    // Fraunhofer overlay (dashed)
    const refAt = (x: number): number | null =>
      p.aperture === 'circle' ? fraunhoferAiry(x, p) : fraunhofer1d(x, p);
    if (this.state.overlay && refAt(0) !== null) {
      g.strokeStyle = 'rgba(235,240,247,0.5)';
      g.lineWidth = 1.2;
      g.setLineDash([5, 4]);
      g.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const ref = refAt(pts[i]!.x) ?? 0;
        const sx = px(pts[i]!.x);
        const sy = py(ref);
        if (i === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      }
      g.stroke();
      g.setLineDash([]);
    }

    // numeric profile (filled + line)
    g.beginPath();
    g.moveTo(px(pts[0]!.x), py(0));
    for (let i = 0; i < pts.length; i++) g.lineTo(px(pts[i]!.x), py(pts[i]!.y));
    g.lineTo(px(pts[pts.length - 1]!.x), py(0));
    g.closePath();
    g.fillStyle = 'rgba(90,160,250,0.20)';
    g.fill();
    g.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const sx = px(pts[i]!.x);
      const sy = py(pts[i]!.y);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.strokeStyle = 'rgba(110,180,255,0.95)';
    g.lineWidth = 1.8;
    g.stroke();

    // ticks + labels
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.textAlign = 'right';
    for (let k = 0; k <= 4; k++) {
      g.fillText(fmtMetric((vMax * k) / 4), x0 - 6, py((vMax * k) / 4) + 4);
    }
    g.textAlign = 'center';
    const lo = -p.screenHalf;
    const hi = p.screenHalf;
    for (let k = 0; k <= 4; k++) {
      const v = lo + ((hi - lo) * k) / 4;
      g.fillText(fmtMetric(v), px(v), y1 + 14);
    }
    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText('x', x1 - 8, y1 + 28);
    g.textAlign = 'right';
    g.fillText('I', x0 - 8, y0 + 2);
    if (this.state.overlay && refAt(0) !== null) {
      g.textAlign = 'left';
      g.fillStyle = 'rgba(235,240,247,0.75)';
      g.fillRect(x1 - 150, y0 + 8, 14, 2);
      g.fillText(zh ? '夫琅禾费参考' : 'Fraunhofer ref', x1 - 130, y0 + 13);
    }
  }

  private drawMap(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, p: DiffractionParams, top: number, font: string) {
    const zh = this.zh;
    const prof = this.profile!;
    const padL = 56;
    const padR = 18;
    const padB = 34;
    const w = Math.max(10, canvas.width - padL - padR);
    const h = Math.max(10, canvas.height - top - padB);
    const isCircle = p.aperture === 'circle';

    let vMax = 1e-12;
    for (let i = 0; i < prof.ys.length; i++) vMax = Math.max(vMax, prof.ys[i]!);

    // 1-D lookup table normalised to vMax
    const lut = new Float64Array(prof.ys.length);
    for (let i = 0; i < prof.ys.length; i++) lut[i] = prof.ys[i]! / vMax;
    const lookup = (coord: number): number => {
      // Map a screen coordinate to a profile array index. Slit-family profiles
      // span [-screenHalf, +screenHalf]; the circle profile spans [0, +screenHalf].
      const norm = isCircle ? coord / p.screenHalf : (coord + p.screenHalf) / (2 * p.screenHalf);
      const frac = norm * (prof.xs.length - 1);
      const i = Math.min(prof.xs.length - 2, Math.max(0, Math.floor(frac)));
      const f = Math.min(1, Math.max(0, frac - i));
      return lut[i]! * (1 - f) + lut[i + 1]! * f;
    };

    const mw = Math.min(480, Math.max(200, Math.round(w)));
    const mh = Math.min(220, Math.max(80, Math.round(h)));
    const off = document.createElement('canvas');
    off.width = mw;
    off.height = mh;
    const octx = off.getContext('2d');
    if (octx) {
      const img = octx.createImageData(mw, mh);
      for (let iy = 0; iy < mh; iy++) {
        for (let ix = 0; ix < mw; ix++) {
          let v: number;
          if (isCircle) {
            const dx = ((2 * ix) / (mw - 1) - 1) * p.screenHalf;
            const dy = ((2 * iy) / (mh - 1) - 1) * p.screenHalf;
            v = lookup(Math.sqrt(dx * dx + dy * dy));
          } else {
            // slit family: pattern is uniform along y
            const x = -p.screenHalf + (2 * p.screenHalf * ix) / (mw - 1);
            v = lookup(x);
          }
          const idx = (iy * mw + ix) * 4;
          const [r, gg, b] = heatColor(v);
          img.data[idx] = r;
          img.data[idx + 1] = gg;
          img.data[idx + 2] = b;
          img.data[idx + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(off, padL, top, w, h);
    }
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.strokeRect(padL, top, w, h);

    g.font = font;
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.textAlign = 'center';
    const lo = isCircle ? -p.screenHalf : -p.screenHalf;
    for (let k = 0; k <= 4; k++) {
      const v = lo + (2 * p.screenHalf * k) / 4;
      g.fillText(fmtMetric(v), padL + (w * k) / 4, top + h + 14);
    }
    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText(isCircle ? 'x' : 'x', padL + w + 6, top + h - 4);
    g.fillText(zh ? '二维图样（相对强度）' : '2-D pattern (relative intensity)', padL, top - 4);
  }
}

/** Inferno-like color ramp for the diffraction map. */
function heatColor(v: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, v));
  const stops: Array<[number, number, number, number]> = [
    [0.0, 6, 7, 22],
    [0.2, 40, 14, 84],
    [0.45, 130, 38, 96],
    [0.7, 216, 87, 50],
    [0.9, 245, 170, 60],
    [1.0, 252, 245, 190],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i]![0]) {
      const a = stops[i - 1]!;
      const b = stops[i]!;
      const f = (t - a[0]) / (b[0] - a[0]);
      return [
        Math.round(a[1] + f * (b[1] - a[1])),
        Math.round(a[2] + f * (b[2] - a[2])),
        Math.round(a[3] + f * (b[3] - a[3])),
      ];
    }
  }
  return [252, 245, 190];
}

export default function createPhysicsDiffractionPlugin(): Plugin {
  return new PhysicsDiffractionPlugin();
}
