// ==========================================================================
// mats-xrd — powder XRD pattern analysis laboratory
//
// A 2-D scientific workbench: draws the loaded powder diffraction pattern
// (2θ–intensity) with the detected peaks annotated, lists each peak's
// d-spacing (Bragg's law), attempts cubic lattice-parameter refinement,
// and ranks reference phases by reflection match count. The peak list and
// d-spacing table export to CSV in one click.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  drawEmptyCanvas,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { matsXrdManifest } from './manifest';
import {
  ANODES,
  type LatticeRefinement,
  type PhaseMatch,
  type XrdAnode,
  type XrdPeak,
  type XrdPoint,
  findPeaks,
  matchReferencePhases,
  parseXrd,
  refineCubicLattice,
} from './kernel';

export { matsXrdManifest } from './manifest';

const ANODE_LIST = Object.keys(ANODES) as XrdAnode[];

interface State {
  anode: XrdAnode;
  prominenceFrac: number;
  min2Theta: number;
  max2Theta: number;
}

export class MatsXrdPlugin implements Plugin {
  readonly manifest = matsXrdManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private data: XrdPoint[] | null = null;
  private peaks: XrdPeak[] = [];
  private lattice: LatticeRefinement | null = null;
  private matches: PhaseMatch[] = [];
  private state: State = {
    anode: 'CuKa1',
    prominenceFrac: 0.04,
    min2Theta: 10,
    max2Theta: 90,
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
    return [
      {
        key: 'anode',
        label: 'Anode / λ',
        labelI18n: { 'zh-CN': '靶材 / 波长', 'en-US': 'Anode / λ' },
        type: 'select',
        options: ANODE_LIST.map((a) => ({
          value: a,
          label: this.zh ? ANODES[a].labelZh : ANODES[a].labelEn,
          labelI18n: { 'zh-CN': ANODES[a].labelZh, 'en-US': ANODES[a].labelEn },
        })),
        value: this.state.anode,
      },
      {
        key: 'prominenceFrac',
        label: 'Min prominence',
        labelI18n: { 'zh-CN': '最小突出度', 'en-US': 'Min prominence' },
        type: 'range',
        min: 0.005,
        max: 0.2,
        step: 0.005,
        value: this.state.prominenceFrac,
        hint: this.zh ? '占全谱强度范围的分数' : 'fraction of the global intensity span',
      },
      {
        key: 'min2Theta',
        label: '2θ min',
        labelI18n: { 'zh-CN': '2θ 下限', 'en-US': '2θ min' },
        type: 'range',
        min: 0,
        max: 60,
        step: 1,
        value: this.state.min2Theta,
      },
      {
        key: 'max2Theta',
        label: '2θ max',
        labelI18n: { 'zh-CN': '2θ 上限', 'en-US': '2θ max' },
        type: 'range',
        min: 30,
        max: 160,
        step: 1,
        value: this.state.max2Theta,
      },
      actionButton('exportCsv', 'Export peaks CSV', '导出峰表 CSV'),
      actionButton('exportSpectrum', 'Export spectrum CSV', '导出全谱 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string): boolean => {
      if (typeof params[k] !== 'number' || !Number.isFinite(params[k] as number)) return false;
      const n = params[k] as number;
      if ((k === 'prominenceFrac' && n === this.state.prominenceFrac) || n === (this.state as never)[k as keyof State]) {
        return false;
      }
      return true;
    };
    if (num('prominenceFrac')) this.state.prominenceFrac = Math.max(0.005, params.prominenceFrac as number);
    if (num('min2Theta')) this.state.min2Theta = Math.max(0, params.min2Theta as number);
    if (num('max2Theta')) this.state.max2Theta = Math.max(this.state.min2Theta + 10, params.max2Theta as number);
    if (typeof params.anode === 'string' && ANODE_LIST.includes(params.anode as XrdAnode) && params.anode !== this.state.anode) {
      this.state.anode = params.anode as XrdAnode;
    }
    if (num('prominenceFrac') || num('min2Theta') || num('max2Theta') || params.anode !== this.state.anode) {
      this.recompute();
      this.draw();
    }
    if (actionFired(params, 'exportCsv')) this.exportPeaksCsv();
    if (actionFired(params, 'exportSpectrum')) this.exportSpectrumCsv();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    const ok = ['.xy', '.xye', '.csv', '.dat', '.txt'].some((e) => low.endsWith(e));
    if (!ok) {
      notify(this.api, 'warning', 'XRD plugin accepts 2θ,I patterns (.xy/.xye/.csv/.dat/.txt).', 'XRD 插件接受 2θ,强度 衍射谱 (.xy/.xye/.csv/.dat/.txt)。');
      return;
    }
    const text = await file.text();
    const pts = parseXrd(text);
    if (pts.length < 5) {
      notify(this.api, 'warning', 'Could not parse ≥5 (2θ, intensity) rows.', '未能解析出 ≥5 行 (2θ, 强度) 数据。');
      return;
    }
    this.data = pts;
    this.recompute();
    const wl = ANODES[this.state.anode].wavelength;
    notify(
      this.api,
      'success',
      `Loaded ${pts.length} points; detected ${this.peaks.length} peaks (λ=${wl} Å).`,
      `已加载 ${pts.length} 个数据点；检出 ${this.peaks.length} 个峰（λ=${wl} Å）。`,
    );
    this.draw();
  }

  // ---- compute -------------------------------------------------------------

  private recompute() {
    if (!this.data) {
      this.peaks = [];
      this.lattice = null;
      this.matches = [];
      clearScienceOutputs(this.manifest.id);
      return;
    }
    const wl = ANODES[this.state.anode].wavelength;
    const filtered = this.data.filter((p) => p.twoTheta >= this.state.min2Theta && p.twoTheta <= this.state.max2Theta);
    this.peaks = findPeaks(filtered, wl, {
      minProminenceFrac: this.state.prominenceFrac,
      minSeparation: 0.25,
    });
    this.lattice = refineCubicLattice(this.peaks);
    this.matches = matchReferencePhases(this.peaks, wl);
    this.publishScience();
  }

  private publishScience() {
    const wl = ANODES[this.state.anode].wavelength;
    const metrics: ScienceMetric[] = [
      {
        key: 'peaks',
        label: this.zh ? '检出峰数' : 'Peaks',
        value: String(this.peaks.length),
        severity: 'info',
        hint: this.zh ? `突出度阈值 ${(this.state.prominenceFrac * 100).toFixed(1)}%` : `prominence threshold ${(this.state.prominenceFrac * 100).toFixed(1)}%`,
      },
      {
        key: 'wavelength',
        label: this.zh ? '波长 λ' : 'Wavelength λ',
        value: fmtMetric(wl, 5),
        unit: 'Å',
        severity: 'info',
      },
    ];
    if (this.lattice) {
      metrics.push(
        {
          key: 'lattice-a',
          label: this.zh ? '晶格常数 a' : 'Lattice a',
          value: fmtMetric(this.lattice.a, 5),
          unit: 'Å',
          severity: 'ok',
          hint: this.zh
            ? `${this.lattice.centring}-心立方，${this.lattice.indexed.length} 个衍射峰，平均相对偏差 ${fmtMetric(this.lattice.relDev * 100, 3)}%`
            : `${this.lattice.centring}-centred cubic, ${this.lattice.indexed.length} peaks, mean rel. dev ${fmtMetric(this.lattice.relDev * 100, 3)}%`,
        },
        {
          key: 'lattice-centring',
          label: this.zh ? '点阵类型' : 'Centring',
          value: this.lattice.centring,
          severity: 'info',
        },
      );
    }
    const top = this.matches.find((m) => m.matches >= 2);
    if (top) {
      metrics.push({
        key: 'top-phase',
        label: this.zh ? '最匹配物相' : 'Top phase',
        value: this.zh ? top.phase.nameZh : top.phase.name,
        severity: top.matches >= top.total * 0.5 ? 'ok' : 'warn',
        hint: this.zh
          ? `${top.matches}/${top.total} 个参考峰匹配，2θ RMS 偏差 ${fmtMetric(top.rmsDev2Theta, 3)}°`
          : `${top.matches}/${top.total} reference peaks matched, 2θ RMS ${fmtMetric(top.rmsDev2Theta, 3)}°`,
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- export --------------------------------------------------------------

  private exportPeaksCsv() {
    if (this.peaks.length === 0) {
      notify(this.api, 'warning', 'No peaks to export.', '暂无峰可导出。');
      return;
    }
    exportRowsCsv(
      this.api,
      'xrd-peaks',
      ['2theta_deg', 'intensity', 'd_spacing_A', 'prominence', 'hkl', 's'],
      this.peaks.map((p) => {
        const ix = this.lattice?.indexed.find((i) => Math.abs(i.twoTheta - p.twoTheta) < 1e-6);
        return [
          p.twoTheta.toFixed(4),
          p.intensity.toFixed(2),
          p.d.toFixed(5),
          p.prominence.toFixed(2),
          ix ? ix.hkl.join(' ') : '',
          ix ? String(ix.s) : '',
        ];
      }),
    );
  }

  private exportSpectrumCsv() {
    if (!this.data) {
      notify(this.api, 'warning', 'No spectrum to export.', '暂无谱图可导出。');
      return;
    }
    exportRowsCsv(
      this.api,
      'xrd-spectrum',
      ['2theta_deg', 'intensity'],
      this.data.map((p) => [p.twoTheta.toFixed(4), p.intensity.toFixed(2)]),
    );
  }

  // ---- rendering -----------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    if (!this.data || this.data.length < 5) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'No XRD pattern loaded',
        titleZh: '尚未载入衍射谱',
        hint: 'Load a 2θ-intensity pattern (.xy / .csv / .dat) via the sample bar or Open File.',
        hintZh: '通过顶部「示例数据」或「打开文件」载入 2θ–强度 衍射谱。',
      });
      return;
    }
    const W = canvas.clientWidth || 760;
    const H = canvas.clientHeight || 420;
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    if (!g) return;
    const zh = this.zh;

    // Layout
    const padL = 56;
    const padR = 16;
    const padT = 14;
    const padB = 56;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    // Range
    const tts = this.data.map((p) => p.twoTheta);
    let tMin = Math.min(this.state.min2Theta, Math.min(...tts));
    let tMax = Math.max(this.state.max2Theta, Math.max(...tts));
    if (tMax <= tMin) tMax = tMin + 10;
    const Is = this.data.map((p) => p.intensity);
    const iMin = 0;
    const iMax = Math.max(...Is) * 1.1;
    const sx = (t: number) => padL + ((t - tMin) / (tMax - tMin)) * plotW;
    const sy = (v: number) => padT + plotH - ((v - iMin) / (iMax - iMin || 1)) * plotH;

    // Background
    g.fillStyle = '#0a0e13';
    g.fillRect(0, 0, W, H);

    // Grid
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(150,165,185,0.9)';
    g.textAlign = 'center';
    const tStep = niceStep((tMax - tMin) / 8);
    for (let t = Math.ceil(tMin / tStep) * tStep; t <= tMax; t += tStep) {
      const x = sx(t);
      g.beginPath();
      g.moveTo(x, padT);
      g.lineTo(x, padT + plotH);
      g.stroke();
      g.fillText(t.toFixed(0), x, padT + plotH + 16);
    }
    g.textAlign = 'right';
    const iStep = niceStep(iMax / 6);
    for (let v = 0; v <= iMax; v += iStep) {
      const y = sy(v);
      g.beginPath();
      g.moveTo(padL, y);
      g.lineTo(padL + plotW, y);
      g.stroke();
      g.fillText(fmtShort(v), padL - 6, y + 4);
    }

    // Axes labels
    g.fillStyle = 'rgba(210,220,235,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillText(zh ? '2θ (°)' : '2θ (deg)', padL + plotW / 2, H - 12);
    g.save();
    g.translate(14, padT + plotH / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(zh ? '强度' : 'Intensity', 0, 0);
    g.restore();

    // Spectrum (polyline)
    g.strokeStyle = '#5dd0a8';
    g.lineWidth = 1.2;
    g.beginPath();
    let started = false;
    for (const p of this.data) {
      const x = sx(p.twoTheta);
      const y = sy(p.intensity);
      if (!started) {
        g.moveTo(x, y);
        started = true;
      } else {
        g.lineTo(x, y);
      }
    }
    g.stroke();

    // Peak markers
    const iMaxRaw = Math.max(...Is);
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = '#ffd166';
    g.strokeStyle = '#ffd166';
    for (const pk of this.peaks) {
      const x = sx(pk.twoTheta);
      const y = sy(pk.intensity);
      g.beginPath();
      g.moveTo(x, y - 4);
      g.lineTo(x, padT + plotH);
      g.setLineDash([2, 3]);
      g.stroke();
      g.setLineDash([]);
      // d-spacing label
      g.textAlign = 'center';
      g.fillText(`d=${pk.d.toFixed(3)}`, x, y - 8);
      void iMaxRaw;
    }

    // Reference phase tick marks (top match)
    const wl = ANODES[this.state.anode].wavelength;
    const topMatch = this.matches.find((m) => m.matches >= 1);
    if (topMatch) {
      g.strokeStyle = 'rgba(255, 209, 102, 0.5)';
      g.fillStyle = 'rgba(255, 209, 102, 0.8)';
      g.font = `9px Consolas, monospace`;
      for (const ref of topMatch.phase.reflections) {
        const s = ref.hkl[0] ** 2 + ref.hkl[1] ** 2 + ref.hkl[2] ** 2;
        const d = topMatch.phase.a / Math.sqrt(s);
        const t2 = (2 * Math.asin(wl / (2 * d)) * 180) / Math.PI;
        if (t2 < tMin || t2 > tMax) continue;
        const x = sx(t2);
        g.beginPath();
        g.moveTo(x, padT);
        g.lineTo(x, padT + 6);
        g.stroke();
        g.textAlign = 'center';
        g.fillText(ref.hkl.join(''), x, padT + 16);
      }
    }

    // Border
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    g.lineWidth = 1;
    g.strokeRect(padL, padT, plotW, plotH);

    // Annotation block (lattice + top phase)
    let ay = padT + 24;
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    if (this.lattice) {
      g.fillStyle = '#7ad7ff';
      g.fillText(
        zh
          ? `立方精修: a = ${this.lattice.a.toFixed(4)} Å  (${this.lattice.centring}-心, ${this.lattice.indexed.length} 峰, 相对偏差 ${this.lattice.relDev * 100 <= 0.0001 ? '<0.01' : (this.lattice.relDev * 100).toFixed(2)}%)`
          : `Cubic refine: a = ${this.lattice.a.toFixed(4)} Å  (${this.lattice.centring}-centred, ${this.lattice.indexed.length} peaks, rel. dev ${this.lattice.relDev * 100 <= 0.0001 ? '<0.01' : (this.lattice.relDev * 100).toFixed(2)}%)`,
        padL + 8,
        ay,
      );
      ay += 16;
    }
    if (topMatch) {
      g.fillStyle = '#ffd166';
      const name = zh ? topMatch.phase.nameZh : topMatch.phase.name;
      g.fillText(
        zh
          ? `最匹配: ${name}  ${topMatch.matches}/${topMatch.total} 峰`
          : `Best match: ${name}  ${topMatch.matches}/${topMatch.total} peaks`,
        padL + 8,
        ay,
      );
    }
  }
}

// ---- small helpers ---------------------------------------------------------

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const f = raw / 10 ** exp;
  let s: number;
  if (f < 1.5) s = 1;
  else if (f < 3) s = 2;
  else if (f < 7) s = 5;
  else s = 10;
  return s * 10 ** exp;
}

function fmtShort(v: number): string {
  if (Math.abs(v) >= 1000) return v.toExponential(2);
  if (Math.abs(v) >= 10) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

export default function (): Plugin {
  return new MatsXrdPlugin();
}
