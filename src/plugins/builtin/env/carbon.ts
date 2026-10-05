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
  CARBON_K,
  CARBON_POOL_LABELS,
  CARBON_SCENARIOS,
  type CarbonPool,
  type CarbonScenario,
  type CarbonState,
  carbonRun,
  numCell,
} from './envCore';
import { setScienceOutputs, clearScienceOutputs, fmtMetric, type ScienceMetric } from '@/core/research/scienceOutput';
import { mulberry32, currentSeed } from '@/core/repro/random';
import { actionButton, actionFired, exportCanvasPng, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { isZh } from '@/core/plugin-tools/locale';
import { parseDelimited } from '@/core/plugin-tools/table';
import {
  pushPanelsToFigure,
  panelTag,
  panelPlace,
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  type Bilingual,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { carbonManifest } from './carbonManifest';

const MAX_YEARS = 500;
/** Monte-Carlo draws for the uncertainty band (seeded mulberry32). */
const MC_DRAWS = 200;
/** All six rate-constant keys (from>to), perturbed ±10% per draw. */
const K_KEYS = [
  'atmosphere>vegetation',
  'vegetation>atmosphere',
  'vegetation>soil',
  'soil>atmosphere',
  'atmosphere>ocean',
  'ocean>atmosphere',
] as const;
const MC_POOLS: CarbonPool[] = ['atmosphere', 'vegetation', 'soil', 'ocean'];

/** Percentile of a sorted array (linear interpolation, type-7). */
function pctl(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

// ---- Monte-Carlo uncertainty (exported for tests) ---------------------------

export interface CarbonMcYear {
  /** Base-run pool values (GtC) at this year. */
  base: Record<CarbonPool, number>;
  /** 95% percentile interval over the draws. */
  ci: Record<CarbonPool, { low: number; high: number }>;
}

export interface CarbonMcResult {
  /** Key years (horizon/2 and horizon). */
  years: number[];
  /** Base + 95% CI per pool at each key year. */
  at: Record<number, CarbonMcYear>;
  /** Mass-balance deviation |Σpools(T) − Σpools(0) − inputs·T| across draws, GtC. */
  consBias: { mean: number; max: number };
  draws: number;
}

/**
 * Monte-Carlo uncertainty for the box model: each draw multiplicatively
 * perturbs every rate constant and the emission by ±10% (uniform, seeded
 * rng), reruns the trajectory and collects per-pool 95% intervals at
 * horizon/2 and horizon. The per-draw conservation deviation doubles as a
 * clamping diagnostics (mass lost when a pool is drained to zero).
 */
export function carbonMonteCarlo(
  initial: CarbonState,
  emission: number,
  external: Partial<Record<CarbonPool, number>> | undefined,
  years: number,
  opts: { draws?: number; rng: () => number },
): CarbonMcResult {
  const draws = Math.max(2, opts.draws ?? MC_DRAWS);
  const h1 = Math.max(1, Math.round(years / 2));
  const keyYears = h1 === years ? [years] : [h1, years];
  const samples = new Map<number, Map<CarbonPool, number[]>>();
  for (const y of keyYears) {
    const m = new Map<CarbonPool, number[]>();
    for (const p of MC_POOLS) m.set(p, []);
    samples.set(y, m);
  }
  const extNet = (Object.values(external ?? {}) as number[]).reduce((a, b) => a + b, 0);
  const sum0 = (Object.values(initial) as number[]).reduce((a, b) => a + b, 0);
  let biasSum = 0;
  let biasMax = 0;
  for (let d = 0; d < draws; d += 1) {
    const kOverrides: Record<string, number> = {};
    for (const key of K_KEYS) kOverrides[key] = CARBON_K[key]! * (1 + (opts.rng() * 2 - 1) * 0.1);
    const e = emission * (1 + (opts.rng() * 2 - 1) * 0.1);
    const pts = carbonRun(initial, e, years, external, kOverrides);
    for (const y of keyYears) {
      const poolsAtY = pts[y]!.pools;
      const m = samples.get(y)!;
      for (const p of MC_POOLS) m.get(p)!.push(poolsAtY[p]);
    }
    const last = pts[pts.length - 1]!.pools;
    const sumN = (Object.values(last) as number[]).reduce((a, b) => a + b, 0);
    const bias = Math.abs(sumN - sum0 - (e + extNet) * years);
    biasSum += bias;
    biasMax = Math.max(biasMax, bias);
  }
  const base = carbonRun(initial, emission, years, external);
  const at: Record<number, CarbonMcYear> = {};
  for (const y of keyYears) {
    const m = samples.get(y)!;
    const ci = {} as Record<CarbonPool, { low: number; high: number }>;
    for (const p of MC_POOLS) {
      const arr = m.get(p)!.sort((a, b) => a - b);
      ci[p] = { low: pctl(arr, 0.025), high: pctl(arr, 0.975) };
    }
    at[y] = { base: { ...base[y]!.pools }, ci };
  }
  return { years: keyYears, at, consBias: { mean: biasSum / draws, max: biasMax }, draws };
}


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

export function carbonFigurePanels(points: ReturnType<typeof carbonRun>): FigurePanelSpec[] {
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
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
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
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
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
      actionButton('exportScenario', 'Export scenario CSV (+MC)', '导出情景 CSV（含 MC）'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
      actionButton('reloadPlugin', 'Reset Plugin', '重置插件'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (actionFired(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'env-carbon');
      return;
    }
    if (actionFired(params, 'exportScenario')) {
      this.exportScenarioCsv();
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

  /** Seeded rng for the MC (bound to the process seed, distinct stream). */
  private mcRng(): () => number {
    return mulberry32((currentSeed() ^ 0xca1b0c) >>> 0);
  }

  // ---- scientific outputs -----------------------------------------------------

  private publishScience(): void {
    const zh = isZh(this.api.locale);
    const initial: CarbonState = this.state.initial ?? { ...CARBON_INITIAL };
    const external = this.state.external ?? undefined;
    const mc = carbonMonteCarlo(initial, this.state.emission, external, this.state.years, {
      draws: MC_DRAWS,
      rng: this.mcRng(),
    });
    const poolTag: Record<CarbonPool, string> = { atmosphere: 'ATM', vegetation: 'VEG', soil: 'SOIL', ocean: 'OCN' };
    const metrics: ScienceMetric[] = [
      {
        key: 'mc',
        label: 'MC draws',
        value: `${mc.draws} × ±10% k,E`,
        hint: zh
          ? `Monte-Carlo 不确定度：6 个速率常数与排放各 ±10% 均匀扰动，${mc.draws} 次（种子化 mulberry32）`
          : `Monte-Carlo uncertainty: all 6 rate constants and the emission perturbed ±10% uniformly, ${mc.draws} draws (seeded mulberry32)`,
      },
    ];
    for (const y of mc.years) {
      const { base, ci } = mc.at[y]!;
      metrics.push({
        key: `ci_atm_${y}`,
        label: `ATM 95CI @${y}yr`,
        value: `[${fmtMetric(ci.atmosphere!.low, 1)}, ${fmtMetric(ci.atmosphere!.high, 1)}]`,
        hint: zh
          ? `大气碳库 95% 区间（GtC；基准 ${fmtMetric(base.atmosphere, 1)} GtC）`
          : `atmospheric-pool 95% interval (GtC; base run ${fmtMetric(base.atmosphere, 1)} GtC)`,
      });
    }
    const yFinal = mc.years[mc.years.length - 1]!;
    const finalCi = mc.at[yFinal]!.ci;
    for (const p of MC_POOLS) {
      if (p === 'atmosphere') continue; // already published per key year
      metrics.push({
        key: `ci_${p}_${yFinal}`,
        label: `${poolTag[p]} 95CI @${yFinal}yr`,
        value: `[${fmtMetric(finalCi[p]!.low, 1)}, ${fmtMetric(finalCi[p]!.high, 1)}]`,
        hint: zh
          ? `${yFinal} 年时该碳库的 95% 区间（GtC）`
          : `95% interval of this pool at year ${yFinal} (GtC)`,
      });
    }
    metrics.push({
      key: 'cons',
      label: 'CONS BIAS',
      value: `${fmtMetric(mc.consBias.mean, 2)} GtC (max ${fmtMetric(mc.consBias.max, 2)})`,
      severity: mc.consBias.max < 1 ? 'ok' : mc.consBias.max < 10 ? 'info' : 'warn',
      hint: zh
        ? '质量守恒偏差 |Σ库(T) − Σ库(0) − 输入×T| 的均值/最大值；偏差大通常意味着某库被抽干触发截零（模型超出适用范围）'
        : 'mass-balance deviation |Σpools(T) − Σpools(0) − inputs·T|, mean/max; a large bias usually means a pool was drained into the zero-clamp (model out of range)',
    });
    setScienceOutputs(this.manifest.id, metrics);
  }

  /** Scenario CSV: base trajectory, MC 95% intervals at key years, conservation bias. */
  private exportScenarioCsv(): void {
    const { points } = this.simulate();
    const initial: CarbonState = this.state.initial ?? { ...CARBON_INITIAL };
    const external = this.state.external ?? undefined;
    const mc = carbonMonteCarlo(initial, this.state.emission, external, this.state.years, {
      draws: MC_DRAWS,
      rng: this.mcRng(),
    });
    const rows: string[][] = points.map((p) => [
      String(p.year),
      p.pools.atmosphere.toFixed(2),
      p.pools.vegetation.toFixed(2),
      p.pools.soil.toFixed(2),
      p.pools.ocean.toFixed(2),
      p.atmChange.toFixed(3),
    ]);
    rows.push([]);
    rows.push(['monte_carlo_95ci', 'year', 'pool', 'base_gtc', 'p2_5_gtc', 'p97_5_gtc']);
    for (const y of mc.years) {
      const { base, ci } = mc.at[y]!;
      for (const p of MC_POOLS) {
        rows.push(['', String(y), p, base[p].toFixed(2), ci[p]!.low.toFixed(2), ci[p]!.high.toFixed(2)]);
      }
    }
    rows.push([]);
    rows.push(['conservation_bias_gtc', 'mean', 'max', mc.consBias.mean.toFixed(3), mc.consBias.max.toFixed(3)]);
    exportRowsCsv(this.api, 'env-carbon-scenario', ['year', 'atmosphere', 'vegetation', 'soil', 'ocean', 'atm_change'], rows);
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
    this.publishScience();
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
