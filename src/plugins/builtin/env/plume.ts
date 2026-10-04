// ==========================================================================
// Example plugin: Pollutant dispersion (Gaussian plume, 2-D)
//
// Parameter-driven teaching scenario (chimney point source, fixed met):
// ground-level concentration C(x, y, 0) from the Gaussian plume equation
// with Pasquill–Gifford dispersion parameters and ground reflection, drawn
// as a heatmap. Sliders redraw instantly; the peak ground-level
// concentration and its downwind distance are annotated. u = 0 disables the
// model (calm winds violate Gaussian-plume assumptions).
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  maxGroundConcentration,
  plumeConcentration,
  envRampColor,
  numCell,
  sigmaYZ,
  type StabilityClass,
} from './envCore';
import { setScienceOutputs, clearScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { actionButton, actionFired, exportCanvasPng, notify } from '@/core/plugin-tools/enhance';
import { isZh } from '@/core/plugin-tools/locale';
import { parseDelimited } from '@/core/plugin-tools/table';
import { pushPanelsToFigure, panelTag, panelPlace, GEO_PANEL_WIDTH, GEO_PANEL_HEIGHT, type Bilingual, type GeoFigurePanel } from '../geo/geoFigure';
import { plumeManifest } from './plumeManifest';

const MAX_CELLS = 160; // per-axis cap: 160² = 25.6k cells stays interactive

// ---- Receptor CSV (exported for tests) --------------------------------------

export interface PlumeReceptor {
  /** Downwind distance (m, > 0). */
  x: number;
  /** Crosswind offset (m, default 0). */
  y: number;
  /** Observed concentration (any unit). */
  c: number;
}

/**
 * Parse receptor observations: a header row with an x, an optional y and a
 * concentration column (`c`/`conc`/`concentration`/`obs`/`measured`); only
 * downwind rows (x > 0, c ≥ 0) count. Requires ≥ 5 valid receptors.
 */
export function parseReceptorCsv(text: string): PlumeReceptor[] | null {
  const rows = parseDelimited(text);
  if (rows.length < 2) return null;
  const header = rows[0]!.map((c) => c.toLowerCase());
  const xi = header.findIndex((c) => /^(x|downwind_x|downwind)$/.test(c));
  const yi = header.findIndex((c) => /^(y|crosswind_y|crosswind)$/.test(c));
  const ci = header.findIndex((c) => /^(c|conc|concentration|obs|measured|c_obs)$/.test(c));
  if (xi < 0 || ci < 0) return null;
  const rec: PlumeReceptor[] = [];
  for (const row of rows.slice(1)) {
    const x = numCell(row[xi]);
    const c = numCell(row[ci]);
    if (x === null || c === null || x <= 0 || c < 0) continue;
    const y = yi >= 0 ? (numCell(row[yi]) ?? 0) : 0;
    rec.push({ x, y, c });
  }
  return rec.length >= 5 ? rec : null;
}

// ---- Figure Studio panels (exported for tests) ------------------------------

export function plumeFigurePanels(q: number, u: number, cls: StabilityClass, h: number, cells = 80): GeoFigurePanel[] {
  const nx = cells;
  const ny = Math.round(cells / 2);
  const xMaxM = 10000;
  const yMaxM = 2000;
  const values: number[] = [];
  let cMax = 0;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const x = ((i + 0.5) / nx) * xMaxM;
      const y = ((j + 0.5) / ny - 0.5) * 2 * yMaxM;
      const c = plumeConcentration(q, u, cls, h, x, y, 0);
      values.push(c);
      if (c > cMax) cMax = c;
    }
  }
  return [
    {
      ...panelPlace(0),
      tag: panelTag(0),
      spec: {
        width: GEO_PANEL_WIDTH,
        height: GEO_PANEL_HEIGHT,
        title: `Ground-level concentration (${cls} class)`,
        xLabel: 'downwind x (km)',
        yLabel: 'crosswind y (km)',
        xDomain: [0, xMaxM / 1000],
        yDomain: [-yMaxM / 1000, yMaxM / 1000],
        ticks: 5,
        grid: true,
        series: [
          {
            name: 'conc (μg/m³)',
            kind: 'field',
            color: '#64A0F0',
            field: { values, rows: ny, cols: nx, domain: [0, cMax] },
          },
        ],
      },
    },
    {
      ...panelPlace(1),
      tag: panelTag(1),
      spec: {
        width: GEO_PANEL_WIDTH,
        height: GEO_PANEL_HEIGHT,
        title: 'Centreline C(x, 0)',
        xLabel: 'downwind x (km)',
        yLabel: 'μg/m³',
        xDomain: [0, xMaxM / 1000],
        yDomain: [0, cMax * 1.05],
        ticks: 5,
        grid: true,
        series: [
          {
            name: 'C',
            kind: 'line',
            color: '#E8A33D',
            points: Array.from({ length: 100 }, (_, i) => {
              const x = ((i + 1) / 100) * xMaxM;
              return { x: x / 1000, y: plumeConcentration(q, u, cls, h, x, 0, 0) };
            }),
          },
        ],
      },
    },
  ];
}

// ---- Plugin ----------------------------------------------------------------

interface State {
  q: number; // g/s
  u: number; // m/s
  cls: StabilityClass;
  cells: number;
  stackH: number; // m (fixed teaching chimney at 50 m effective height)
  receptors: PlumeReceptor[] | null;
}

const DEFAULTS: State = { q: 100, u: 4, cls: 'C', cells: 60, stackH: 50, receptors: null };

export class PlumePlugin implements Plugin {
  readonly manifest = plumeManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { ...DEFAULTS };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    clearScienceOutputs(this.manifest.id);
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
        key: 'q',
        label: 'Source strength Q (g/s)',
        labelI18n: { 'zh-CN': '源强 Q（g/s）', 'en-US': 'Source strength Q (g/s)' },
        type: 'number',
        min: 1,
        max: 10000,
        step: 10,
        value: this.state.q,
      },
      {
        key: 'u',
        label: 'Wind speed u (m/s)',
        labelI18n: { 'zh-CN': '平均风速 u（m/s）', 'en-US': 'Wind speed u (m/s)' },
        type: 'range',
        min: 0,
        max: 12,
        step: 0.5,
        value: this.state.u,
        hint: zh ? '静风（u = 0）不适用高斯烟羽' : 'Calm wind (u = 0) invalidates the Gaussian plume',
      },
      {
        key: 'cls',
        label: 'Stability class',
        labelI18n: { 'zh-CN': '稳定度等级', 'en-US': 'Stability class' },
        type: 'select',
        value: this.state.cls,
        options: (['A', 'B', 'C', 'D', 'E', 'F'] as StabilityClass[]).map((c) => ({
          value: c,
          label: c,
          labelI18n: { 'zh-CN': c, 'en-US': c },
        })),
      },
      {
        key: 'cells',
        label: 'Grid cells',
        labelI18n: { 'zh-CN': '面元数', 'en-US': 'Grid cells' },
        type: 'number',
        min: 20,
        max: MAX_CELLS,
        step: 10,
        value: this.state.cells,
        hint: zh ? `上限 ${MAX_CELLS}` : `Capped at ${MAX_CELLS}`,
      },
      {
        key: 'receptors',
        label: 'Receptor CSV (x,y,c)',
        labelI18n: { 'zh-CN': '受体浓度 CSV（x,y,c）', 'en-US': 'Receptor CSV (x,y,c)' },
        type: 'file',
        accept: '.csv',
        value: null,
        hint: zh
          ? '≥5 行下风受体观测（x,y,c 表头），载入后发布 BIAS/RMSE 对拍'
          : '≥5 downwind receptor rows (x,y,c header); publishes BIAS/RMSE against the model',
      },
      {
        key: 'reset',
        label: 'Reset to defaults',
        labelI18n: { 'zh-CN': '回到初始参数', 'en-US': 'Reset to defaults' },
        type: 'button',
        action: 'reset',
      },
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
      actionButton('reloadPlugin', 'Reset Plugin', '重置插件'),
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  /** Receptor CSV dropped onto the plugin / loaded via the param file picker. */
  async loadData(file: File) {
    const rec = parseReceptorCsv(await file.text());
    if (!rec) {
      notify(this.api, 'warning', 'Expected x,y,c receptor rows (≥5)', '需要 x,y,c 受体数据行（≥5 行）');
      return;
    }
    this.state.receptors = rec;
    this.api.reportDataScale(rec.length);
    notify(this.api, 'success', `Loaded ${rec.length} receptor(s)`, `已加载 ${rec.length} 个受体`);
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    if (params.receptors instanceof File) {
      void this.loadData(params.receptors);
      return;
    }
    if (actionFired(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'env-plume');
      return;
    }
    if (actionFired(params, 'sendToFigure')) {
      void this.sendToFigure();
      return;
    }
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
    if (typeof params.q === 'number' && params.q >= 1 && params.q !== this.state.q) {
      this.state.q = params.q;
      redraw = true;
    }
    if (typeof params.u === 'number' && params.u !== this.state.u) {
      this.state.u = params.u;
      redraw = true;
    }
    if (typeof params.cls === 'string' && /^[A-F]$/.test(params.cls) && params.cls !== this.state.cls) {
      this.state.cls = params.cls as StabilityClass;
      redraw = true;
    }
    if (typeof params.cells === 'number' && params.cells !== this.state.cells) {
      this.state.cells = Math.min(MAX_CELLS, Math.max(20, Math.round(params.cells)));
      redraw = true;
    }
    if (redraw) this.draw();
  }

  private async sendToFigure(): Promise<void> {
    if (this.state.u <= 0) {
      notify(this.api, 'warning', 'Calm wind — the Gaussian plume does not apply.', '静风条件不适用高斯烟羽。');
      return;
    }
    const peak = maxGroundConcentration(this.state.q * 1e6, this.state.u, this.state.cls, this.state.stackH);
    const caption: Bilingual = {
      zh: `高斯烟羽（${this.state.cls} 类稳定度，u=${this.state.u} m/s，Q=${this.state.q} g/s）：最大落地浓度 ${peak.c.toFixed(1)} μg/m³ 位于下风向 ${(peak.x / 1000).toFixed(1)} km。`,
      en: `Gaussian plume (${this.state.cls}, u=${this.state.u} m/s, Q=${this.state.q} g/s): peak ground-level ${peak.c.toFixed(1)} μg/m³ at ${(peak.x / 1000).toFixed(1)} km downwind.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '污染物扩散模拟', en: 'Pollutant Dispersion' },
      caption,
      plumeFigurePanels(this.state.q * 1e6, this.state.u, this.state.cls, this.state.stackH),
    );
  }

  // ---- drawing -------------------------------------------------------------

  /**
   * Publish receptor-vs-model agreement (bias / RMSE / correlation, all
   * scale-free since receptor units are unknown) plus the analytic peak
   * ground-level concentration. Only meaningful with loaded receptor data
   * and non-calm wind; otherwise the previous outputs are cleared.
   */
  private publishScience() {
    const rec = this.state.receptors;
    if (!rec || rec.length < 5 || this.state.u <= 0) {
      clearScienceOutputs(this.manifest.id);
      return;
    }
    const qUgs = this.state.q * 1e6;
    const model: number[] = [];
    const obs: number[] = [];
    for (const r of rec) {
      const c = plumeConcentration(qUgs, this.state.u, this.state.cls, this.state.stackH, r.x, r.y, 0);
      model.push(c);
      obs.push(r.c);
    }
    const n = obs.length;
    const meanObs = obs.reduce((a, b) => a + b, 0) / n;
    const bias = model.reduce((a, c, i) => a + (c - obs[i]!), 0) / n;
    const rmse = Math.sqrt(model.reduce((a, c, i) => a + (c - obs[i]!) ** 2, 0) / n);
    // Pearson r between model and observations.
    const meanModel = model.reduce((a, b) => a + b, 0) / n;
    let cov = 0;
    let varM = 0;
    let varO = 0;
    for (let i = 0; i < n; i += 1) {
      const dm = model[i]! - meanModel;
      const dobs = obs[i]! - meanObs;
      cov += dm * dobs;
      varM += dm * dm;
      varO += dobs * dobs;
    }
    const r = varM > 0 && varO > 0 ? cov / Math.sqrt(varM * varO) : null;

    const metrics: ScienceMetric[] = [
      {
        key: 'n_receptors',
        label: 'n',
        value: String(n),
        severity: 'info',
        hint: isZh(this.api.locale) ? '参与对拍的受体数量。' : 'Receptors used in the comparison.',
      },
      {
        key: 'norm_bias',
        label: 'BIAS/mean',
        value: meanObs > 0 ? `${((bias / meanObs) * 100).toFixed(1)}%` : '—',
        severity: meanObs > 0 && Math.abs(bias / meanObs) < 0.5 ? 'ok' : 'warn',
        hint: isZh(this.api.locale)
          ? '归一化平均偏差 =（模型−观测）均值 / 观测均值。受体单位未知，故用无量纲比值。'
          : 'Normalized bias = mean(model−obs) / mean(obs). Scale-free because receptor units are unknown.',
      },
      {
        key: 'norm_rmse',
        label: 'RMSE/mean',
        value: meanObs > 0 ? `${((rmse / meanObs) * 100).toFixed(1)}%` : '—',
        severity: meanObs > 0 && rmse / meanObs < 1 ? 'ok' : 'warn',
        hint: isZh(this.api.locale)
          ? '归一化均方根误差 = RMSE / 观测均值。'
          : 'Normalized RMSE = RMSE / mean(obs).',
      },
    ];
    if (r !== null) {
      metrics.push({
        key: 'r',
        label: 'r',
        value: r.toFixed(3),
        severity: Math.abs(r) > 0.7 ? 'ok' : 'warn',
        hint: isZh(this.api.locale)
          ? '模型浓度与受体观测的 Pearson 相关系数。'
          : 'Pearson correlation between modelled and observed concentrations.',
      });
    }
    const peak = maxGroundConcentration(qUgs, this.state.u, this.state.cls, this.state.stackH);
    metrics.push({
      key: 'peak_c',
      label: 'C_max',
      value: peak.c.toFixed(1),
      unit: 'µg/m³',
      severity: 'info',
      hint: isZh(this.api.locale)
        ? `最大落地浓度位于下风向 ${(peak.x / 1000).toFixed(1)} km。`
        : `Peak ground-level concentration at ${(peak.x / 1000).toFixed(1)} km downwind.`,
    });
    setScienceOutputs(this.manifest.id, metrics);
  }

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
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    this.publishScience();

    if (this.state.u <= 0) {
      g.textAlign = 'center';
      g.fillStyle = 'rgba(224, 94, 75, 0.95)';
      g.font = "12px 'Microsoft YaHei', Consolas, monospace";
      g.fillText(
        zh ? '静风条件不适用高斯烟羽 — 请增大风速' : 'Calm wind: the Gaussian plume does not apply — raise u',
        canvas.width / 2,
        canvas.height / 2,
      );
      return;
    }

    const xMaxM = 10000;
    const yMaxM = 2000;
    const nx = Math.min(MAX_CELLS, Math.max(20, this.state.cells));
    const ny = Math.max(12, Math.round(nx / 2));

    const gx0 = 56;
    const gx1 = canvas.width - 24;
    const gy0 = 56;
    const gy1 = canvas.height - 76;
    const plotW = Math.max(gx1 - gx0, 10);
    const plotH = Math.max(gy1 - gy0, 10);

    // Compute the field once, tracking the max for the colour scale.
    const cellW = plotW / nx;
    const cellH = plotH / ny;
    let cMax = 0;
    const field = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const x = ((i + 0.5) / nx) * xMaxM;
        const y = ((j + 0.5) / ny - 0.5) * 2 * yMaxM;
        const c = plumeConcentration(this.state.q * 1e6, this.state.u, this.state.cls, this.state.stackH, x, y, 0);
        field[j * nx + i] = c;
        if (c > cMax) cMax = c;
      }
    }
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const c = field[j * nx + i]!;
        if (c <= cMax * 0.001) continue;
        g.fillStyle = envRampColor(c / cMax);
        g.fillRect(gx0 + i * cellW, gy0 + (ny - 1 - j) * cellH, Math.ceil(cellW), Math.ceil(cellH));
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.strokeRect(gx0, gy0, plotW, plotH);

    // Axis captions (km).
    g.fillStyle = 'rgba(150, 165, 185, 0.9)';
    g.textAlign = 'center';
    for (let k = 0; k <= 5; k += 1) {
      const px = gx0 + (plotW * k) / 5;
      g.fillText(`${((xMaxM / 5) * k * 0.001).toFixed(0)}`, px, gy1 + 16);
    }
    g.fillText(zh ? '下风向距离 x (km)' : 'downwind x (km)', (gx0 + gx1) / 2, gy1 + 32);
    g.textAlign = 'right';
    g.fillText(`${-yMaxM * 0.001}…${yMaxM * 0.001} km 横风向`, gx1, gy0 - 8);

    // Source marker.
    g.fillStyle = '#e05e4b';
    g.beginPath();
    g.arc(gx0 + 2, (gy0 + gy1) / 2, 4, 0, Math.PI * 2);
    g.fill();
    g.textAlign = 'left';
    g.fillText(zh ? '烟囱点源' : 'stack', gx0 + 8, (gy0 + gy1) / 2 - 6);

    // Peak annotation.
    const peak = maxGroundConcentration(this.state.q * 1e6, this.state.u, this.state.cls, this.state.stackH);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(230, 238, 248, 0.95)';
    g.font = "12px 'Microsoft YaHei', Consolas, monospace";
    g.fillText(
      zh
        ? `最大落地浓度 ${peak.c.toFixed(1)} μg/m³ @ 下风向 ${(peak.x / 1000).toFixed(1)} km（${this.state.cls} 类稳定度，u=${this.state.u} m/s，Q=${this.state.q} g/s，H=${this.state.stackH} m）`
        : `Peak ground-level ${peak.c.toFixed(1)} μg/m³ @ ${(peak.x / 1000).toFixed(1)} km downwind (${this.state.cls}, u=${this.state.u} m/s, Q=${this.state.q} g/s, H=${this.state.stackH} m)`,
      16,
      24,
    );

    // σ caption + colour legend bar.
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    const { sy, sz } = sigmaYZ(this.state.cls, peak.x);
    g.fillStyle = 'rgba(150, 165, 185, 0.9)';
    g.fillText(
      zh
        ? `峰值处 σy=${sy.toFixed(0)} m，σz=${sz.toFixed(0)} m（Pasquill–Gifford，Turner 1970）`
        : `At peak: σy=${sy.toFixed(0)} m, σz=${sz.toFixed(0)} m (Pasquill–Gifford, Turner 1970)`,
      16,
      40,
    );
    const lgW = 140;
    for (let i = 0; i < lgW; i += 1) {
      g.fillStyle = envRampColor(i / (lgW - 1));
      g.fillRect(gx1 - lgW + i, gy1 + 4, 1, 8);
    }
    g.textAlign = 'center';
    g.fillStyle = 'rgba(150, 165, 185, 0.9)';
    g.fillText('0', gx1 - lgW, gy1 + 24);
    g.fillText(`${peak.c !== 0 ? cMax.toFixed(0) : '0'} μg/m³`, gx1, gy1 + 24);
  }
}

export default function createPlumePlugin(): Plugin {
  return new PlumePlugin();
}
