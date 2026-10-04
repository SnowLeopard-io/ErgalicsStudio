// ==========================================================================
// Example plugin: Carbon cycle box model
//
// Four pools (atmosphere / vegetation / soil / ocean, GtC) coupled by
// donor-controlled linear fluxes calibrated to a pre-industrial steady
// state. The scenario select presets the anthropogenic emission; the
// emission slider (or a custom `pool,initial_gtc,flux_in,flux_out` CSV)
// overrides it. Explicit Euler stepping with a hard year cap; per-pool
// balance curves plus a net source/sink readout. The pool sum changes only
// by emissions (internal fluxes cancel), and a residual check is reported.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  CARBON_INITIAL,
  CARBON_POOL_LABELS,
  CARBON_SCENARIOS,
  type CarbonPool,
  type CarbonScenario,
  type CarbonState,
  carbonRun,
  isZh,
  numCell,
  parseDelimited,
} from './envCore';
import { actionButton, actionFired, exportCanvasPng, notify } from '../shared/enhance';
import {
  pushPanelsToFigure,
  panelTag,
  panelPlace,
  GEO_PANEL_WIDTH,
  GEO_PANEL_HEIGHT,
  type Bilingual,
  type GeoFigurePanel,
} from '../geo/geoFigure';
import { carbonManifest } from './carbonManifest';

export { carbonManifest } from './carbonManifest';

const MAX_YEARS = 500;

// ---- Custom scenario parsing (exported for tests) ---------------------------

export interface CarbonCustom {
  pools: Partial<Record<CarbonPool, number>>;
  /** Net external flux into each pool, GtC/yr (e.g. emissions into air). */
  external: Partial<Record<CarbonPool, number>>;
}

/** Parse `pool,initial_gtc,flux_in,flux_out` rows (flux_net = in − out). */
export function parseCarbonCsv(text: string): CarbonCustom | null {
  const rows = parseDelimited(text);
  if (rows.length === 0) return null;
  const header = rows[0]!.map((c) => c.toLowerCase());
  let body = rows;
  let poolCol = 0;
  let initCol = 1;
  let inCol = 2;
  let outCol = 3;
  const isHeader = header.some((c) => /^pool$/.test(c));
  if (isHeader) {
    poolCol = header.findIndex((c) => /^pool$/.test(c));
    initCol = header.findIndex((c) => /^initial_?gtc$/.test(c));
    inCol = header.findIndex((c) => /^flux_?in$/.test(c));
    outCol = header.findIndex((c) => /^flux_?out$/.test(c));
    body = rows.slice(1);
  }
  const aliases: Record<string, CarbonPool> = {
    atmosphere: 'atmosphere',
    atm: 'atmosphere',
    air: 'atmosphere',
    大气: 'atmosphere',
    vegetation: 'vegetation',
    veg: 'vegetation',
    plants: 'vegetation',
    植被: 'vegetation',
    soil: 'soil',
    土壤: 'soil',
    ocean: 'ocean',
    sea: 'ocean',
    海洋: 'ocean',
  };
  const custom: CarbonCustom = { pools: {}, external: {} };
  let hit = false;
  for (const row of body) {
    const key = aliases[(row[poolCol] ?? '').toLowerCase()] ?? aliases[(row[poolCol] ?? '')] ?? null;
    if (!key) continue;
    const init = numCell(row[initCol]);
    const fin = numCell(row[inCol]);
    const fout = numCell(row[outCol]);
    if (init !== null) {
      custom.pools[key] = Math.max(0, init);
      hit = true;
    }
    if (fin !== null || fout !== null) {
      custom.external[key] = (fin ?? 0) - (fout ?? 0);
      hit = true;
    }
  }
  return hit ? custom : null;
}

// ---- Figure Studio panels (exported for tests) ------------------------------

export function carbonFigurePanels(points: ReturnType<typeof carbonRun>): GeoFigurePanel[] {
  const colors: Record<CarbonPool, string> = {
    atmosphere: '#e8a33d',
    vegetation: '#40c463',
    soil: '#a4764e',
    ocean: '#64a0f0',
  };
  const pools = Object.keys(colors) as CarbonPool[];
  return [
    {
      ...panelPlace(0),
      tag: panelTag(0),
      spec: {
        width: GEO_PANEL_WIDTH,
        height: GEO_PANEL_HEIGHT,
        title: 'Atmospheric carbon',
        xLabel: 'year',
        yLabel: 'GtC',
        xDomain: [0, points.length - 1],
        yDomain: [Math.min(...points.map((p) => p.pools.atmosphere)) * 0.95, Math.max(...points.map((p) => p.pools.atmosphere)) * 1.05],
        ticks: 5,
        grid: true,
        series: [
          {
            name: 'atmosphere',
            kind: 'line',
            color: colors.atmosphere,
            points: points.map((p) => ({ x: p.year, y: p.pools.atmosphere })),
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
        title: 'Land & ocean pools',
        xLabel: 'year',
        yLabel: 'GtC',
        xDomain: [0, points.length - 1],
        ticks: 5,
        grid: true,
        series: pools
          .filter((p) => p !== 'atmosphere')
          .map((p) => ({
            name: p,
            kind: 'line' as const,
            color: colors[p],
            points: points.map((pt) => ({ x: pt.year, y: pt.pools[p] })),
          })),
      },
    },
  ];
}

// ---- Plugin ----------------------------------------------------------------

interface State {
  scenario: CarbonScenario;
  emission: number;
  years: number;
  initial: CarbonState | null; // CSV override
  external: Partial<Record<CarbonPool, number>> | null;
}

const DEFAULTS: State = { scenario: 'current', emission: CARBON_SCENARIOS.current, years: 100, initial: null, external: null };

export class CarbonPlugin implements Plugin {
  readonly manifest = carbonManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { ...DEFAULTS };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.state = { ...DEFAULTS, initial: null, external: null };
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
        key: 'scenario',
        label: 'Scenario',
        labelI18n: { 'zh-CN': '情景', 'en-US': 'Scenario' },
        type: 'select',
        value: this.state.scenario,
        options: (Object.keys(CARBON_SCENARIOS) as CarbonScenario[]).map((s) => ({
          value: s,
          label: { industrial: zh ? '工业时代（3 GtC/yr）' : 'Industrial era (3 GtC/yr)', current: zh ? '当前（9 GtC/yr）' : 'Current (9 GtC/yr)', mitigation: zh ? '减排（2 GtC/yr）' : 'Mitigation (2 GtC/yr)' }[s],
          labelI18n: {
            'zh-CN': { industrial: '工业时代（3 GtC/yr）', current: '当前（9 GtC/yr）', mitigation: '减排（2 GtC/yr）' }[s],
            'en-US': { industrial: 'Industrial era (3 GtC/yr)', current: 'Current (9 GtC/yr)', mitigation: 'Mitigation (2 GtC/yr)' }[s],
          },
        })),
      },
      {
        key: 'emission',
        label: 'Human emission (GtC/yr)',
        labelI18n: { 'zh-CN': '人为排放（GtC/yr）', 'en-US': 'Human emission (GtC/yr)' },
        type: 'number',
        min: 0,
        max: 50,
        step: 0.5,
        value: this.state.emission,
      },
      {
        key: 'years',
        label: 'Simulation years',
        labelI18n: { 'zh-CN': '模拟年数', 'en-US': 'Simulation years' },
        type: 'number',
        min: 10,
        max: MAX_YEARS,
        step: 10,
        value: this.state.years,
        hint: zh ? `上限 ${MAX_YEARS} 年` : `Capped at ${MAX_YEARS} years`,
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

  updateParams(params: Record<string, unknown>) {
    if (actionFired(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'env-carbon');
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
      this.state = { ...DEFAULTS, initial: this.state.initial, external: this.state.external };
      this.draw();
      return;
    }
    let redraw = false;
    if (
      params.scenario === 'industrial' ||
      params.scenario === 'current' ||
      params.scenario === 'mitigation'
    ) {
      if (params.scenario !== this.state.scenario) {
        this.state.scenario = params.scenario;
        this.state.emission = CARBON_SCENARIOS[params.scenario];
        redraw = true;
      }
    }
    if (typeof params.emission === 'number' && params.emission !== this.state.emission) {
      this.state.emission = Math.min(50, Math.max(0, params.emission));
      redraw = true;
    }
    if (typeof params.years === 'number' && params.years !== this.state.years) {
      this.state.years = Math.min(MAX_YEARS, Math.max(10, Math.round(params.years)));
      redraw = true;
    }
    if (redraw) this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const custom = parseCarbonCsv(await file.text());
    if (!custom) {
      notify(this.api, 'warning', 'Expected pool,initial_gtc,flux_in,flux_out rows', '需要 pool,initial_gtc,flux_in,flux_out 数据行');
      return;
    }
    this.state.initial = { ...CARBON_INITIAL, ...custom.pools } as CarbonState;
    // The emission slider is the single atmosphere driver: a CSV atmosphere
    // flux row IS the emission (it presets the slider); every other pool's
    // net flux joins the external forcing applied each step.
    const { atmosphere: atmFlux, ...rest } = custom.external;
    this.state.external = rest;
    if (atmFlux !== undefined) this.state.emission = Math.min(50, Math.max(0, atmFlux));
    this.api.reportDataScale(Object.keys(custom.pools).length);
    notify(this.api, 'success', 'Custom carbon scenario loaded', '自定义碳循环情景已加载');
    this.draw();
  }

  /** Run the model; returns yearly points + conservation residual. */
  private simulate(): { points: ReturnType<typeof carbonRun>; residual: number; anyNegative: boolean } {
    const initial: CarbonState = this.state.initial ?? { ...CARBON_INITIAL };
    const external = this.state.external ?? undefined;
    const points = carbonRun(initial, this.state.emission, this.state.years, external);
    // Conservation: Σ pools(t) − Σ pools(0) ≈ (emission + Σ external) × t.
    // Internal fluxes cancel exactly by construction; report the numeric
    // residual anyway.
    const sum0 = (Object.values(initial) as number[]).reduce((a, b) => a + b, 0);
    const last = points[points.length - 1]!.pools;
    const sumN = (Object.values(last) as number[]).reduce((a, b) => a + b, 0);
    const extNet = (Object.values(this.state.external ?? {}) as number[]).reduce((a, b) => a + b, 0);
    const expected = sum0 + (this.state.emission + extNet) * this.state.years;
    const residual = Math.abs(sumN - expected);
    const anyNegative = (Object.values(last) as number[]).some((v) => v < 0);
    return { points, residual, anyNegative };
  }

  private async sendToFigure(): Promise<void> {
    const { points } = this.simulate();
    const last = points[points.length - 1]!.pools;
    const sink = last.atmosphere - points[0]!.pools.atmosphere;
    const caption: Bilingual = {
      zh: `碳循环推演（${this.state.years} 年，人为排放 ${this.state.emission} GtC/yr）：大气碳库 ${points[0]!.pools.atmosphere.toFixed(0)} → ${last.atmosphere.toFixed(0)} GtC（净增 ${sink.toFixed(0)} GtC），大气为净${sink > 0 ? '源（增加）' : '汇（减少）'}。`,
      en: `Carbon cycle (${this.state.years} yr at ${this.state.emission} GtC/yr): atmosphere ${points[0]!.pools.atmosphere.toFixed(0)} → ${last.atmosphere.toFixed(0)} GtC (net ${sink >= 0 ? '+' : ''}${sink.toFixed(0)} GtC) — a net ${sink > 0 ? 'source' : 'sink'}.`,
    };
    await pushPanelsToFigure(this.api, { zh: '碳循环推演', en: 'Carbon Cycle' }, caption, carbonFigurePanels(points));
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
    g.fillText(
      zh
        ? `碳循环 box 模型 — ${this.state.scenario === 'industrial' ? '工业时代' : this.state.scenario === 'current' ? '当前' : '减排'}情景（${this.state.years} 年）`
        : `Carbon box model — ${this.state.scenario} scenario (${this.state.years} yr)`,
      canvas.width / 2,
      22,
    );

    const { points, residual, anyNegative } = this.simulate();
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";

    if (anyNegative) {
      g.fillStyle = 'rgba(224, 94, 75, 0.95)';
      g.fillText(
        zh ? '出现负库存 — 模型已超出适用范围（库存被抽干）' : 'Negative pool — model pushed beyond its valid range',
        canvas.width / 2,
        40,
      );
    } else if (residual > 1) {
      g.fillStyle = 'rgba(230, 180, 90, 0.95)';
      g.fillText(
        zh ? `守恒校验残差 ${residual.toFixed(1)} GtC — 结果仅供参考` : `Conservation residual ${residual.toFixed(1)} GtC — treat with care`,
        canvas.width / 2,
        40,
      );
    }

    // ---- Curves -------------------------------------------------------------
    const x0 = 54;
    const x1 = canvas.width - 20;
    const y0 = 58;
    const y1 = canvas.height - 92;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);
    const pools: CarbonPool[] = ['atmosphere', 'vegetation', 'soil', 'ocean'];
    const colors: Record<CarbonPool, string> = {
      atmosphere: '#e8a33d',
      vegetation: '#40c463',
      soil: '#a4764e',
      ocean: '#64a0f0',
    };
    // Ocean dwarfs the others; plot the three small pools on the main axis and
    // draw the ocean separately scaled (teaching clarity over one true axis).
    const small = ['atmosphere', 'vegetation', 'soil'] as CarbonPool[];
    const smallVals = points.flatMap((p) => small.map((k) => p.pools[k]));
    const vMax = Math.max(...smallVals) * 1.15;
    const yOf = (v: number) => y1 - (plotH * v) / vMax;
    const xOf = (yr: number) => x0 + (plotW * yr) / this.state.years;

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);
    g.textAlign = 'right';
    for (let i = 0; i <= 4; i += 1) {
      const v = (vMax * i) / 4;
      g.fillStyle = 'rgba(150, 165, 185, 0.9)';
      g.fillText(v.toFixed(0), x0 - 6, yOf(v) + 4);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, yOf(v));
      g.lineTo(x1, yOf(v));
      g.stroke();
    }
    for (const k of small) {
      g.strokeStyle = colors[k];
      g.lineWidth = 2;
      g.beginPath();
      points.forEach((p, i) => {
        const px = xOf(p.year);
        const py = yOf(p.pools[k]);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      });
      g.stroke();
    }
    // Ocean as a dashed band offset to its own scale on the right.
    const oceanVals = points.map((p) => p.pools.ocean);
    const ocMin = Math.min(...oceanVals);
    const ocMax = Math.max(...oceanVals);
    const ocSpan = Math.max(ocMax - ocMin, 1);
    g.strokeStyle = colors.ocean;
    g.setLineDash([5, 4]);
    g.lineWidth = 1.5;
    g.beginPath();
    points.forEach((p, i) => {
      const px = xOf(p.year);
      const py = y1 - (plotH * (p.pools.ocean - ocMin + ocSpan * 0.1)) / (ocSpan * 1.2);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.stroke();
    g.setLineDash([]);
    g.lineWidth = 1;

    // ---- Legend + net source/sink readout -----------------------------------
    g.textAlign = 'left';
    const last = points[points.length - 1]!.pools;
    const first = points[0]!.pools;
    let ly = 76;
    for (const k of pools) {
      g.fillStyle = colors[k];
      g.fillRect(x1 - 190, ly - 8, 10, 10);
      g.fillStyle = 'rgba(200, 210, 225, 0.95)';
      const delta = last[k] - first[k];
      g.fillText(
        `${CARBON_POOL_LABELS[k].zh}: ${last[k].toFixed(0)} GtC（${delta >= 0 ? '+' : ''}${delta.toFixed(0)}）`,
        x1 - 174,
        ly + 1,
      );
      ly += 16;
    }
    g.fillStyle = 'rgba(230, 238, 248, 0.95)';
    g.fillText(
      zh
        ? `大气为净${last.atmosphere > first.atmosphere ? '源（库存上升）' : '汇（库存下降）'}`
        : `Atmosphere is a net ${last.atmosphere > first.atmosphere ? 'source' : 'sink'}`,
      x1 - 190,
      ly + 6,
    );

    // Footer: assumptions.
    g.fillStyle = 'rgba(150, 165, 185, 0.9)';
    g.fillText(
      zh
        ? `虚线为海洋（独立量程 ${ocMin.toFixed(0)}–${ocMax.toFixed(0)} GtC）；donor-controlled 线性通量，显式欧拉步进，人为排放 ${this.state.emission} GtC/yr`
        : `Dashed = ocean (own scale ${ocMin.toFixed(0)}–${ocMax.toFixed(0)} GtC); donor-controlled linear fluxes, explicit Euler, emission ${this.state.emission} GtC/yr`,
      16,
      canvas.height - 12,
    );
  }
}

export default function createCarbonPlugin(): Plugin {
  return new CarbonPlugin();
}
