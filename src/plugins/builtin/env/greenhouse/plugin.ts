// ==========================================================================
// Example plugin: Greenhouse effect (0-D energy balance)
//
// Parameter-driven teaching model (no file input): CO₂ / albedo / cloud
// sliders feed a zero-dimensional radiative balance — effective blackbody
// temperature from (S₀/4)(1−α), then Myhre (1998) radiative forcing
// ΔF = 5.35·ln(C/280) plus a cloud pivot, scaled to surface warming by a
// fixed climate-sensitivity λ = 0.8 K/(W/m²). The panel shows the effective
// temperature, the new equilibrium surface temperature and ΔT against the
// pre-industrial reference state, with the formula displayed on request.
//
// Out-of-range CO₂ (180–1200 ppm) or albedo (>0.8) disables the calculation
// with an explicit note; the result is labelled teaching-only.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  GREENHOUSE_LIMITS,
  CLIMATE_SENSITIVITY,
  FORCING_COEFF,
  CO2_REFERENCE,
  greenhouseModel,
} from '../shared/envCore';
import {
  actionButton,
  actionFired,
  notify,
} from '@/core/plugin-tools/enhance';
import { isZh } from '@/core/plugin-tools/locale';
import { greenhouseManifest } from './manifest';

// ---- Plugin ----------------------------------------------------------------

interface State {
  co2: number;
  albedo: number;
  cloud: number;
  showFormula: boolean;
}

const DEFAULTS: State = { co2: 420, albedo: 0.3, cloud: 0.5, showFormula: true };

export class GreenhousePlugin implements Plugin {
  readonly manifest = greenhouseManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { ...DEFAULTS };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    this.draw();
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    const zh = isZh(this.api.locale);
    return [
      {
        key: 'co2',
        label: 'CO₂ concentration (ppm)',
        labelI18n: { 'zh-CN': 'CO₂ 浓度（ppm）', 'en-US': 'CO₂ concentration (ppm)' },
        type: 'range',
        min: 180,
        max: 1200,
        step: 5,
        value: this.state.co2,
        hint: zh
          ? `适用范围 ${GREENHOUSE_LIMITS.co2Min}–${GREENHOUSE_LIMITS.co2Max} ppm`
          : `Valid range ${GREENHOUSE_LIMITS.co2Min}–${GREENHOUSE_LIMITS.co2Max} ppm`,
      },
      {
        key: 'albedo',
        label: 'Surface albedo',
        labelI18n: { 'zh-CN': '地表反照率', 'en-US': 'Surface albedo' },
        type: 'range',
        min: 0.05,
        max: 0.8,
        step: 0.01,
        value: this.state.albedo,
      },
      {
        key: 'cloud',
        label: 'Cloud fraction',
        labelI18n: { 'zh-CN': '云量', 'en-US': 'Cloud fraction' },
        type: 'range',
        min: 0,
        max: 1,
        step: 0.05,
        value: this.state.cloud,
      },
      {
        key: 'showFormula',
        label: 'Show formula',
        labelI18n: { 'zh-CN': '显示公式', 'en-US': 'Show formula' },
        type: 'checkbox',
        value: this.state.showFormula,
      },
      {
        key: 'reset',
        label: 'Reset to defaults',
        labelI18n: { 'zh-CN': '回到初始参数', 'en-US': 'Reset to defaults' },
        type: 'button',
        variant: 'default',
        action: 'reset',
      },
      actionButton('reloadPlugin', 'Reset Plugin', '重置插件'),
    ];
  }

  updateParams(params: Record<string, unknown>) {

    if (actionFired(params, 'reloadPlugin')) {
      notify(this.api, 'info', 'Resetting plugin…', '正在重置插件…');
      void this.api.reload?.();
      return;
    }
    if (actionFired(params, 'reset')) {
      this.state = { ...DEFAULTS };
      this.draw();
      return;
    }
    let redraw = false;
    if (typeof params.co2 === 'number' && params.co2 !== this.state.co2) {
      this.state.co2 = params.co2;
      redraw = true;
    }
    if (typeof params.albedo === 'number' && params.albedo !== this.state.albedo) {
      this.state.albedo = params.albedo;
      redraw = true;
    }
    if (typeof params.cloud === 'number' && params.cloud !== this.state.cloud) {
      this.state.cloud = params.cloud;
      redraw = true;
    }
    if (typeof params.showFormula === 'boolean' && params.showFormula !== this.state.showFormula) {
      this.state.showFormula = params.showFormula;
      redraw = true;
    }
    if (redraw) this.draw();
  }

  /** CO₂ / albedo outside the model's stated validity window. */
  private outOfRange(): boolean {
    return (
      this.state.co2 < GREENHOUSE_LIMITS.co2Min ||
      this.state.co2 > GREENHOUSE_LIMITS.co2Max ||
      this.state.albedo > GREENHOUSE_LIMITS.albedoMax
    );
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 460;
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = isZh(this.api.locale);
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230, 238, 248, 0.95)';
    g.font = "13px 'Microsoft YaHei', Consolas, monospace";
    g.fillText(zh ? '温室效应：零维辐射收支模型' : 'Greenhouse effect: 0-D energy balance', canvas.width / 2, 24);
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";

    if (this.outOfRange()) {
      g.fillStyle = 'rgba(224, 94, 75, 0.95)';
      g.font = "12px 'Microsoft YaHei', Consolas, monospace";
      g.fillText(
        zh
          ? `参数越界：CO₂ 需在 ${GREENHOUSE_LIMITS.co2Min}–${GREENHOUSE_LIMITS.co2Max} ppm、反照率 ≤ ${GREENHOUSE_LIMITS.albedoMax}`
          : `Out of range: CO₂ ${GREENHOUSE_LIMITS.co2Min}–${GREENHOUSE_LIMITS.co2Max} ppm, albedo ≤ ${GREENHOUSE_LIMITS.albedoMax}`,
        canvas.width / 2,
        canvas.height / 2 - 8,
      );
      g.fillStyle = 'rgba(150, 165, 185, 0.9)';
      g.font = "11px 'Microsoft YaHei', Consolas, monospace";
      g.fillText(zh ? '已禁用计算 — 请调整滑块' : 'Calculation disabled — adjust the sliders', canvas.width / 2, canvas.height / 2 + 14);
      return;
    }

    const r = greenhouseModel({ co2ppm: this.state.co2, albedo: this.state.albedo, cloud: this.state.cloud });

    // Two-column layout: current equilibrium temperature vs ΔT.
    const colW = canvas.width / 2;
    const cy = canvas.height * 0.32;
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(150, 165, 185, 0.95)';
    g.fillText(zh ? '平衡地表温度 Ts' : 'Equilibrium surface temperature', colW / 2, cy - 46);
    g.fillStyle = 'rgba(255, 170, 120, 1)';
    g.font = 'bold 34px Consolas, monospace';
    g.fillText(`${r.surfaceTempC.toFixed(1)} °C`, colW / 2, cy - 6);

    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(150, 165, 185, 0.95)';
    g.fillText(zh ? '相对工业前参考态的温升 ΔT' : 'Warming vs pre-industrial ΔT', colW * 1.5, cy - 46);
    g.fillStyle = r.deltaT > 0.4 ? '#e05e4b' : r.deltaT > 0 ? '#e8a33d' : '#40c463';
    g.font = 'bold 34px Consolas, monospace';
    g.fillText(`${r.deltaT >= 0 ? '+' : ''}${r.deltaT.toFixed(2)} K`, colW * 1.5, cy - 6);

    // Secondary readouts.
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(190, 202, 218, 0.95)';
    const line1 = zh
      ? `有效黑体温度 Te = ${r.effectiveTempK.toFixed(1)} K（−18.6 ℃ 尺度）\u3000吸收通量 F = ${r.absorbedFlux.toFixed(1)} W/m²`
      : `Effective blackbody Te = ${r.effectiveTempK.toFixed(1)} K\u3000Absorbed flux F = ${r.absorbedFlux.toFixed(1)} W/m²`;
    const line2 = zh
      ? `辐射强迫 ΔF = ${r.forcing.toFixed(2)} W/m²（相对 280 ppm / 云量 0.5）`
      : `Radiative forcing ΔF = ${r.forcing.toFixed(2)} W/m² (vs 280 ppm / cloud 0.5)`;
    g.fillText(line1, canvas.width / 2, cy + 42);
    g.fillText(line2, canvas.width / 2, cy + 62);

    // ΔT vs CO₂ mini-curve (the monotonic teaching takeaway). The y-window
    // follows the swept data so the curve stays inside the panel at any albedo.
    const gx0 = canvas.width * 0.18;
    const gx1 = canvas.width * 0.82;
    const gy0 = canvas.height - 150;
    const gy1 = canvas.height - 42;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 60; i += 1) {
      const c = GREENHOUSE_LIMITS.co2Min + ((GREENHOUSE_LIMITS.co2Max - GREENHOUSE_LIMITS.co2Min) * i) / 60;
      pts.push([c, greenhouseModel({ co2ppm: c, albedo: this.state.albedo, cloud: this.state.cloud }).deltaT]);
    }
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const [, t] of pts) {
      tMin = Math.min(tMin, t);
      tMax = Math.max(tMax, t);
    }
    if (tMax - tMin < 1e-6) {
      tMin -= 1;
      tMax += 1;
    }
    const tPad = (tMax - tMin) * 0.12;
    tMin -= tPad;
    tMax += tPad;
    const xOf = (c: number) =>
      gx0 + ((gx1 - gx0) * (c - GREENHOUSE_LIMITS.co2Min)) / (GREENHOUSE_LIMITS.co2Max - GREENHOUSE_LIMITS.co2Min);
    const yOf = (t: number) => gy1 - ((gy1 - gy0) * (t - tMin)) / (tMax - tMin);
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.strokeRect(gx0, gy0, gx1 - gx0, gy1 - gy0);
    g.strokeStyle = 'rgba(255, 150, 120, 0.95)';
    g.lineWidth = 2;
    g.beginPath();
    pts.forEach(([c, t], i) => {
      const px = xOf(c);
      const py = yOf(t);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.stroke();
    g.lineWidth = 1;
    // Y-axis range ticks — data-driven, so they track the albedo sweep.
    g.fillStyle = 'rgba(150, 165, 185, 0.9)';
    g.textAlign = 'right';
    g.fillText(`${tMax >= 0 ? '+' : ''}${tMax.toFixed(1)}`, gx0 - 6, gy0 + 4);
    g.fillText(`${tMin >= 0 ? '+' : ''}${tMin.toFixed(1)}`, gx0 - 6, gy1);
    g.fillText('ΔT (K)', gx0 - 6, (gy0 + gy1) / 2);
    const markerX = xOf(this.state.co2);
    g.strokeStyle = 'rgba(230, 238, 248, 0.5)';
    g.beginPath();
    g.moveTo(markerX, gy0);
    g.lineTo(markerX, gy1);
    g.stroke();
    g.fillStyle = 'rgba(150, 165, 185, 0.9)';
    g.textAlign = 'left';
    g.fillText(zh ? `ΔT–CO₂ 曲线（当前 ${Math.round(this.state.co2)} ppm）` : `ΔT vs CO₂ (now ${Math.round(this.state.co2)} ppm)`, gx0, gy0 - 8);

    // Formula & assumptions.
    if (this.state.showFormula) {
      g.textAlign = 'center';
      g.fillStyle = 'rgba(150, 165, 185, 0.95)';
      g.fillText(
        `Te = [(S₀/4)(1−α)/σ]^¼\u3000ΔF = ${FORCING_COEFF}·ln(C/${CO2_REFERENCE})\u3000ΔT = λ·ΔF, λ = ${CLIMATE_SENSITIVITY} K·m²/W`,
        canvas.width / 2,
        canvas.height - 12,
      );
    }
  }
}

export default function createGreenhousePlugin(): Plugin {
  return new GreenhousePlugin();
}
