// ==========================================================================
// Example plugin: Air Quality (AQI)
//
// Data-driven AQI evaluation (HJ 633-2012 / GB 3095-2012): every CSV row is
// one monitoring sample (a day); the plugin computes per-pollutant IAQI via
// piecewise-linear interpolation, takes the max as the sample's AQI, flags
// the primary pollutant and prints the level + health advice. US EPA
// breakpoints (2024, unit-converted) are available as a comparison standard.
//
// The plugin opts out of built-in demo content: with no data loaded it shows
// the shared empty state pointing at the sample-data bar / Open File. A set
// of manual concentration inputs can define a single ad-hoc sample.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  AQI_BANDS,
  POLLUTANT_COLUMNS,
  POLLUTANT_LABELS,
  type AqiInput,
  type AqiPollutant,
  type AqiStandard,
  aqiBand,
  computeAqi,
  envRampColor,
  findColumn,
  numCell,
} from './envCore';
import { setScienceOutputs, clearScienceOutputs, fmtMetric, type ScienceMetric } from '@/core/research/scienceOutput';
import {
  actionButton,
  actionFired,
  drawEmptyCanvas,
  drawEmptyMessage,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
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
import { aqiManifest } from './aqiManifest';

// ---- Parsing (exported for tests) ------------------------------------------

export interface AqiSample {
  /** Row label when the sheet provides one (date / station), else `day N`. */
  label: string;
  values: AqiInput;
}

/** Parse an air-monitoring sheet: each row one sample, aliases accepted. */
export function parseAqiCsv(text: string): AqiSample[] | null {
  const rows = parseDelimited(text);
  if (rows.length === 0) return null;
  const header = rows[0]!.map((c) => c.toLowerCase());
  const hasHeader = (Object.values(POLLUTANT_COLUMNS) as RegExp[][]).some((aliases) => findColumn(header, aliases) >= 0);
  const body = hasHeader ? rows.slice(1) : rows;
  const cols: Partial<Record<AqiPollutant, number>> = {};
  if (hasHeader) {
    for (const [k, aliases] of Object.entries(POLLUTANT_COLUMNS)) {
      const i = findColumn(header, aliases);
      if (i >= 0) cols[k as AqiPollutant] = i;
    }
  } else {
    // Bare numeric sheets default to the canonical column order.
    const order: AqiPollutant[] = ['so2', 'no2', 'pm25', 'pm10', 'co', 'o3'];
    order.forEach((k, i) => {
      if (i < (rows[0]!.length ?? 0)) cols[k] = i;
    });
  }
  const labelCol = hasHeader ? header.findIndex((c) => /^(date|time|day|站点|日期|name|sample)$/i.test(c)) : -1;
  const samples: AqiSample[] = [];
  body.forEach((row, n) => {
    const values: AqiInput = {};
    let any = false;
    for (const k of Object.keys(cols) as AqiPollutant[]) {
      const v = numCell(row[cols[k]!]);
      if (v !== null) {
        values[k] = v;
        any = true;
      }
    }
    if (!any) return;
    const label = labelCol >= 0 ? (row[labelCol] ?? '') : '';
    samples.push({ label: label || `#${n + 1}`, values });
  });
  return samples.length > 0 ? samples : null;
}

// ---- Statistics (exported for tests) ----------------------------------------

export interface ConcSummary {
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  iqr: number;
}

/** Type-7 (linear-interpolation) quantile of an ascending-sorted array. */
export function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const f = pos - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * f;
}

/** min / median / max / IQR summary of a concentration series. */
export function concSummary(values: Array<number | null | undefined>): ConcSummary | null {
  const v = values.filter((x): x is number => x !== null && x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const q1 = quantileSorted(v, 0.25);
  const median = quantileSorted(v, 0.5);
  const q3 = quantileSorted(v, 0.75);
  return { n: v.length, min: v[0]!, q1, median, q3, max: v[v.length - 1]!, iqr: q3 - q1 };
}

export interface MissingStat {
  pollutant: AqiPollutant;
  present: number;
  missing: number;
  /** missing / total samples (0 when the sheet is empty). */
  rate: number;
}

/** Per-pollutant missing-record statistics over the sample sheet. */
export function missingStats(samples: AqiSample[]): MissingStat[] {
  const total = samples.length;
  return (Object.keys(POLLUTANT_COLUMNS) as AqiPollutant[]).map((k) => {
    const present = samples.filter((s) => {
      const v = s.values[k];
      return v !== null && v !== undefined && Number.isFinite(v);
    }).length;
    const missing = total - present;
    return { pollutant: k, present, missing, rate: total > 0 ? missing / total : 0 };
  });
}

export interface TrendStat {
  n: number;
  /** OLS slope per sample (x = sample index). */
  slope: number;
  intercept: number;
  /** Mann–Kendall S statistic (sum of pairwise signs). */
  mkS: number;
  /** Variance of S with the tie correction; no significance is claimed. */
  mkVarS: number;
}

/** OLS slope + Mann–Kendall S and its variance for an ordered series. */
export function trendStats(values: Array<number | null | undefined>): TrendStat | null {
  const y = values.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  const n = y.length;
  if (n < 2) return null;
  const xMean = (n - 1) / 2;
  let sx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += (i - xMean) ** 2;
    sxy += (i - xMean) * y[i]!;
  }
  const slope = sx > 0 ? sxy / sx : 0;
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const intercept = yMean - slope * xMean;
  let s = 0;
  for (let i = 0; i < n - 1; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const d = y[j]! - y[i]!;
      s += d > 0 ? 1 : d < 0 ? -1 : 0;
    }
  }
  const counts = new Map<number, number>();
  for (const v of y) counts.set(v, (counts.get(v) ?? 0) + 1);
  let tieTerm = 0;
  for (const t of counts.values()) if (t > 1) tieTerm += t * (t - 1) * (2 * t + 5);
  const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  return { n, slope, intercept, mkS: s, mkVarS: varS };
}

/** Most frequent primary pollutant across evaluated samples. */
export function primaryMode(samples: AqiSample[], standard: AqiStandard): AqiPollutant | null {
  const tally = new Map<AqiPollutant, number>();
  let best: AqiPollutant | null = null;
  let bestN = 0;
  for (const s of samples) {
    const p = computeAqi(s.values, standard).primary;
    if (!p) continue;
    const c = (tally.get(p) ?? 0) + 1;
    tally.set(p, c);
    if (c > bestN) {
      bestN = c;
      best = p;
    }
  }
  return best;
}

/** Counts of AQI values across the six bands (index 0 = 优 … 5 = 严重). */
export function bandDistribution(aqis: number[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const a of aqis) {
    if (!Number.isFinite(a)) continue;
    const idx = AQI_BANDS.findIndex((b) => a <= b.max);
    counts[idx === -1 ? AQI_BANDS.length - 1 : idx]! += 1;
  }
  return counts;
}

// ---- Figure Studio panels (exported for tests) ------------------------------

export function aqiFigurePanels(samples: AqiSample[], standard: AqiStandard): FigurePanelSpec[] {
  const evaluated = samples
    .map((s, i) => ({ label: s.label, index: i, res: computeAqi(s.values, standard) }))
    .filter((r) => r.res.aqi !== null);
  if (evaluated.length === 0) return [];
  const dailyPts = evaluated.map((r) => ({ x: r.index + 1, y: r.res.aqi! }));
  const peak = evaluated.reduce((a, b) => (b.res.aqi! > a.res.aqi! ? b : a));
  const iaqiBars = (Object.entries(peak.res.iaqis) as Array<[AqiPollutant, number]>).map(([k, v], i) => ({
    x0: i,
    x1: i + 0.8,
    y: v,
    key: k,
  }));
  return [
    {
      ...panelPlace(0),
      tag: panelTag(0),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: `Daily AQI (${standard === 'us' ? 'US EPA' : 'GB/HJ'})`,
        xLabel: 'sample',
        yLabel: 'AQI',
        xDomain: [0.5, evaluated.length + 0.5],
        yDomain: [0, Math.max(100, ...dailyPts.map((p) => p.y))],
        ticks: 5,
        grid: true,
        series: [{ name: 'AQI', kind: 'line', color: '#64A0F0', points: dailyPts }],
      },
    },
    {
      ...panelPlace(1),
      tag: panelTag(1),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: `IAQI breakdown — ${peak.label}`,
        xLabel: 'pollutant',
        yLabel: 'IAQI',
        xDomain: [0, iaqiBars.length],
        yDomain: [0, Math.max(100, ...iaqiBars.map((b) => b.y))],
        ticks: 5,
        grid: true,
        series: [
          { name: 'IAQI', kind: 'bar', color: '#64A0F0', bars: iaqiBars.map((b) => ({ x0: b.x0, x1: b.x1, y: b.y })) },
        ],
      },
    },
  ];
}

// ---- Plugin ----------------------------------------------------------------

interface State {
  samples: AqiSample[] | null;
  standard: AqiStandard;
  showPrimary: boolean;
  manual: { so2: number; no2: number; pm25: number; pm10: number; co: number; o3: number };
}

const MANUAL_KEYS: AqiPollutant[] = ['so2', 'no2', 'pm25', 'pm10', 'co', 'o3'];

export class AqiPlugin implements Plugin {
  readonly manifest = aqiManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = {
    samples: null,
    standard: 'cn',
    showPrimary: true,
    manual: { so2: 0, no2: 0, pm25: 0, pm10: 0, co: 0, o3: 0 },
  };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.state.samples = null;
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
    const manualEntries = MANUAL_KEYS.map((k) => ({
      key: k,
      value: this.state.manual[k],
    }));
    return [
      {
        key: 'standard',
        label: 'Standard',
        labelI18n: { 'zh-CN': '评价标准', 'en-US': 'Standard' },
        type: 'select',
        value: this.state.standard,
        options: [
          { value: 'cn', label: 'GB/HJ (中国)', labelI18n: { 'zh-CN': 'GB/HJ（中国）', 'en-US': 'GB/HJ (China)' } },
          { value: 'us', label: 'US EPA (对照)', labelI18n: { 'zh-CN': 'US EPA（对照）', 'en-US': 'US EPA (comparison)' } },
        ],
      },
      {
        key: 'showPrimary',
        label: 'Highlight primary pollutant',
        labelI18n: { 'zh-CN': '标注首要污染物', 'en-US': 'Highlight primary pollutant' },
        type: 'checkbox',
        value: this.state.showPrimary,
      },
      // Manual single-sample entry (data-driven alternative to CSV).
      ...manualEntries.map(({ key, value }) => ({
        key: `manual_${key}`,
        label: `Manual ${POLLUTANT_LABELS[key].en} (${key === 'co' ? 'mg/m³' : 'μg/m³'})`,
        labelI18n: {
          'zh-CN': `手动 ${POLLUTANT_LABELS[key].zh}（${key === 'co' ? 'mg/m³' : 'μg/m³'}，0 = 不填）`,
          'en-US': `Manual ${POLLUTANT_LABELS[key].en} (${key === 'co' ? 'mg/m³' : 'μg/m³'}, 0 = n/a)`,
        },
        type: 'number' as const,
        min: 0,
        max: 10000,
        step: 1,
        value,
        hint: zh ? '非负浓度；全部为 0 时不启用手动样例' : 'Non-negative; all zeros disable the manual sample',
      })),
      actionButton('exportStats', 'Export stats CSV', '导出统计 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
      actionButton('reloadPlugin', 'Reset Plugin', '重置插件'),
    ];
  }

  updateParams(params: Record<string, unknown>) {

    if (actionFired(params, 'exportStats')) {
      this.exportStatsCsv();
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
    let redraw = false;
    if (params.standard === 'cn' || params.standard === 'us') {
      if (params.standard !== this.state.standard) {
        this.state.standard = params.standard;
        redraw = true;
      }
    }
    if (typeof params.showPrimary === 'boolean') {
      this.state.showPrimary = params.showPrimary;
      redraw = true;
    }
    for (const k of MANUAL_KEYS) {
      const v = params[`manual_${k}`];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v !== this.state.manual[k]) {
        this.state.manual[k] = v;
        redraw = true;
      }
    }
    if (redraw) this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const parsed = parseAqiCsv(await file.text());
    if (!parsed) {
      notify(this.api, 'warning', 'No pollutant concentration rows found', '未找到污染物浓度数据行');
      return;
    }
    this.state.samples = parsed;
    this.api.reportDataScale(parsed.length);
    notify(
      this.api,
      'success',
      `Loaded ${parsed.length} sample${parsed.length > 1 ? 's' : ''} from ${file.name}`,
      `已从 ${file.name} 加载 ${parsed.length} 个样本`,
    );
    this.draw();
  }

  /** Effective sample list: loaded CSV plus the manual sample when non-zero. */
  private effectiveSamples(): AqiSample[] {
    const out: AqiSample[] = [...(this.state.samples ?? [])];
    const m = this.state.manual;
    const any = MANUAL_KEYS.some((k) => m[k] > 0);
    if (any) out.push({ label: isZh(this.api.locale) ? '手动输入' : 'manual', values: { ...m } });
    return out;
  }

  /** Pollutant concentration series (finite values) in sheet order. */
  private static seriesOf(samples: AqiSample[], k: AqiPollutant): number[] {
    return samples
      .map((s) => s.values[k])
      .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  }

  private static unitOf(k: AqiPollutant): string {
    return k === 'co' ? 'mg/m³' : 'µg/m³';
  }

  // ---- scientific outputs ---------------------------------------------------

  private publishScience(samples: AqiSample[]): void {
    if (samples.length === 0) {
      clearScienceOutputs(this.manifest.id);
      return;
    }
    const zh = isZh(this.api.locale);
    const standard = this.state.standard;
    const validAqis = samples
      .map((s) => computeAqi(s.values, standard).aqi)
      .filter((a): a is number => a !== null);
    const metrics: ScienceMetric[] = [
      {
        key: 'n',
        label: 'N samples',
        value: `${validAqis.length}/${samples.length}`,
        hint: zh ? '可评价样本数 / 载入样本数' : 'evaluable / loaded samples',
      },
    ];
    // (a) missing records per pollutant.
    for (const m of missingStats(samples)) {
      metrics.push({
        key: `miss_${m.pollutant}`,
        label: `MISS ${POLLUTANT_LABELS[m.pollutant].en}`,
        value: `${m.missing}/${m.present + m.missing} (${(m.rate * 100).toFixed(1)}%)`,
        severity: m.rate >= 0.2 ? 'warn' : 'info',
        hint: zh ? '缺测记录数 / 样本数（缺失率）' : 'missing records / samples (missing rate)',
      });
    }
    // (b) concentration median & IQR per pollutant (min/max in the CSV export).
    for (const k of Object.keys(POLLUTANT_COLUMNS) as AqiPollutant[]) {
      const summ = concSummary(AqiPlugin.seriesOf(samples, k));
      if (!summ) continue;
      metrics.push({
        key: `conc_${k}`,
        label: `MED·IQR ${POLLUTANT_LABELS[k].en}`,
        value: `${fmtMetric(summ.median)} [${fmtMetric(summ.q1)}–${fmtMetric(summ.q3)}]`,
        unit: AqiPlugin.unitOf(k),
        hint: zh
          ? `min ${fmtMetric(summ.min)} · max ${fmtMetric(summ.max)}；完整统计见统计 CSV 导出`
          : `min ${fmtMetric(summ.min)} · max ${fmtMetric(summ.max)}; full stats in the CSV export`,
      });
    }
    // (c) trend of the dominant primary pollutant: OLS slope + MK S / varS.
    const primary = primaryMode(samples, standard);
    if (primary) {
      const t = trendStats(AqiPlugin.seriesOf(samples, primary));
      if (t) {
        metrics.push({
          key: 'trend_slope',
          label: `SLOPE ${POLLUTANT_LABELS[primary].en}`,
          value: fmtMetric(t.slope),
          unit: `${AqiPlugin.unitOf(primary)}/sample`,
          hint: zh ? 'OLS 斜率，x = 样本序号（假设等间隔采样）' : 'OLS slope, x = sample index (assumes regular sampling)',
        });
        metrics.push({
          key: 'trend_mks',
          label: 'MK S',
          value: fmtMetric(t.mkS, 6),
          hint: zh ? 'Mann–Kendall 统计量 S（成对符号之和）' : 'Mann–Kendall S statistic (sum of pairwise signs)',
        });
        metrics.push({
          key: 'trend_mkvar',
          label: 'MK varS',
          value: fmtMetric(t.mkVarS, 6),
          hint: zh ? 'S 的方差（含结修正），未做显著性判定' : 'variance of S (tie-corrected); no significance claimed',
        });
      }
    }
    // (d) AQI level distribution.
    const bands = bandDistribution(validAqis);
    const bandTxt = AQI_BANDS.map((b, i) =>
      bands[i]! > 0 ? `${b.max === Infinity ? '>300' : `≤${b.max}`}:${bands[i]}` : '',
    )
      .filter(Boolean)
      .join(' · ');
    metrics.push({
      key: 'bands',
      label: 'AQI bands',
      value: bandTxt || '—',
      hint: zh ? '各等级样本数（优/良/轻度/中度/重度/严重污染）' : 'samples per level (Good … Hazardous)',
    });
    setScienceOutputs(this.manifest.id, metrics);
  }

  /** (e) Statistics table CSV: per-pollutant summary + trend + AQI bands. */
  private exportStatsCsv(): void {
    const samples = this.effectiveSamples();
    if (samples.length === 0) {
      notify(this.api, 'warning', 'No data to export yet.', '暂无可导出的数据。');
      return;
    }
    const header = [
      'pollutant', 'n', 'missing', 'missing_rate', 'min', 'q1', 'median', 'q3', 'max', 'iqr',
      'slope_per_sample', 'mk_S', 'mk_varS',
    ];
    const rows: Array<Array<string | number>> = [];
    const primary = primaryMode(samples, this.state.standard);
    for (const k of Object.keys(POLLUTANT_COLUMNS) as AqiPollutant[]) {
      const series = AqiPlugin.seriesOf(samples, k);
      const summ = concSummary(series);
      const miss = series.length;
      const t = k === primary ? trendStats(series) : null;
      rows.push([
        POLLUTANT_LABELS[k].en,
        summ?.n ?? 0,
        samples.length - miss,
        samples.length > 0 ? Number(((samples.length - miss) / samples.length).toFixed(4)) : 0,
        summ?.min.toFixed(4) ?? '',
        summ?.q1.toFixed(4) ?? '',
        summ?.median.toFixed(4) ?? '',
        summ?.q3.toFixed(4) ?? '',
        summ?.max.toFixed(4) ?? '',
        summ?.iqr.toFixed(4) ?? '',
        t ? t.slope.toPrecision(6) : '',
        t ? t.mkS : '',
        t ? t.mkVarS.toFixed(2) : '',
      ]);
    }
    const validAqis = samples
      .map((s) => computeAqi(s.values, this.state.standard).aqi)
      .filter((a): a is number => a !== null);
    const bands = bandDistribution(validAqis);
    rows.push([]);
    rows.push(['aqi_band', 'count', 'share']);
    AQI_BANDS.forEach((b, i) => {
      rows.push([b.max === Infinity ? '>300' : `<=${b.max}`, bands[i]!, validAqis.length > 0 ? Number((bands[i]! / validAqis.length).toFixed(4)) : 0]);
    });
    exportRowsCsv(this.api, 'env-aqi-stats', header, rows);
  }

  private async sendToFigure(): Promise<void> {
    const samples = this.effectiveSamples();
    if (samples.length === 0) {
      notify(this.api, 'warning', 'No data yet — load a CSV first.', '暂无数据 — 请先载入 CSV。');
      return;
    }
    const res = computeAqi(samples[0]!.values, this.state.standard);
    const band = aqiBand(res.aqi);
    const caption: Bilingual = {
      zh: `AQI 评价（${this.state.standard === 'us' ? 'US EPA' : 'GB/HJ'}）：${samples.length} 个样本，首个样本 AQI ${res.aqi?.toFixed(0) ?? '—'}（${band?.zh ?? '—'}），首要污染物 ${res.primary ? POLLUTANT_LABELS[res.primary].zh : '—'}。`,
      en: `AQI (${this.state.standard === 'us' ? 'US EPA' : 'GB/HJ'}): ${samples.length} sample(s); first sample AQI ${res.aqi?.toFixed(0) ?? '—'} (${band?.en ?? '—'}), primary pollutant ${res.primary ?? '—'}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '空气质量评价', en: 'Air Quality (AQI)' },
      caption,
      aqiFigurePanels(samples, this.state.standard),
    );
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const zh = isZh(this.api.locale);
    const samples = this.effectiveSamples();
    if (samples.length === 0) {
      clearScienceOutputs(this.manifest.id);
      drawEmptyCanvas(this.api, canvas, {
        title: zh ? '空气质量评价（AQI）' : 'Air Quality (AQI)',
        hintZh: '拖入或从「示例数据」载入空气监测 CSV（so2,no2,pm25,pm10,co,o3），或填写右侧手动浓度',
        hint: 'Drop a monitoring CSV (so2,no2,pm25,pm10,co,o3) via the sample bar, or fill the manual inputs.',
      });
      return;
    }
    this.publishScience(samples);
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 460;
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";

    const evaluated = samples.map((s, i) => ({ s, i, res: computeAqi(s.values, this.state.standard) }));
    const valid = evaluated.filter((r) => r.res.aqi !== null);
    if (valid.length === 0) {
      drawEmptyMessage(g, canvas, zh ? '所有污染物均超出评价范围' : 'All pollutants out of evaluation range');
      return;
    }
    const peak = valid.reduce((a, b) => (b.res.aqi! > a.res.aqi! ? b : a));
    const band = aqiBand(peak.res.aqi);

    // Header: big AQI + level badge + primary pollutant.
    g.textAlign = 'left';
    g.fillStyle = 'rgba(230, 238, 248, 0.95)';
    g.font = "13px 'Microsoft YaHei', Consolas, monospace";
    g.fillText(
      `${zh ? '最大 AQI 样本' : 'Peak sample'}: ${peak.s.label}  (${this.state.standard === 'us' ? 'US EPA' : 'GB/HJ'})`,
      16,
      22,
    );
    g.font = 'bold 30px Consolas, monospace';
    g.fillText(peak.res.aqi!.toFixed(0), 16, 58);
    const badgeX = 16 + g.measureText(peak.res.aqi!.toFixed(0)).width + 26;
    const badgeLabel = zh ? band!.zh : band!.en;
    // Measure with the badge font — long labels like "Unhealthy for Sensitive
    // Groups" overflow a fixed-width box on both sides.
    g.font = "bold 12px 'Microsoft YaHei', Consolas, monospace";
    const badgeW = Math.max(76, Math.ceil(g.measureText(badgeLabel).width) + 16);
    g.fillStyle = band!.color;
    g.fillRect(badgeX, 36, badgeW, 24);
    g.fillStyle = '#0a0e13';
    g.textAlign = 'center';
    g.fillText(badgeLabel, badgeX + badgeW / 2, 52);
    g.textAlign = 'left';

    // Health advice (wraps to two lines).
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(190, 202, 218, 0.95)';
    const advice = zh ? band!.adviceZh : band!.adviceEn;
    const wrap = (text: string, maxW: number): string[] => {
      const lines: string[] = [];
      let cur = '';
      for (const ch of text) {
        if (g.measureText(cur + ch).width > maxW) {
          lines.push(cur);
          cur = ch;
        } else cur += ch;
      }
      if (cur) lines.push(cur);
      return lines.slice(0, 2);
    };
    wrap(advice, canvas.width - 32).forEach((line, i) => g.fillText(line, 16, 78 + i * 15));

    // Daily AQI column chart (bottom half).
    const x0 = 40;
    const x1 = canvas.width - 20;
    const chartTop = 130;
    const chartBottom = canvas.height - 64;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(chartBottom - chartTop, 10);
    const aqiMax = Math.max(100, ...valid.map((r) => r.res.aqi!));
    g.textAlign = 'center';
    g.fillStyle = 'rgba(150, 165, 185, 0.9)';
    g.fillText(zh ? '各样本 AQI' : 'AQI per sample', canvas.width / 2, chartTop - 10);
    const bw = Math.min(34, (plotW / valid.length) * 0.6);
    valid.forEach((r, n) => {
      const cx = x0 + (plotW * (n + 0.5)) / valid.length;
      const bh = (plotH * r.res.aqi!) / aqiMax;
      const b = aqiBand(r.res.aqi);
      g.fillStyle = b!.color;
      g.globalAlpha = r === peak ? 1 : 0.62;
      g.fillRect(cx - bw / 2, chartBottom - bh, bw, bh);
      g.globalAlpha = 1;
      g.fillStyle = 'rgba(200, 210, 225, 0.9)';
      g.fillText(r.res.aqi!.toFixed(0), cx, chartBottom - bh - 4);
      g.fillStyle = 'rgba(150, 165, 185, 0.9)';
      g.save();
      g.translate(cx, chartBottom + 12);
      g.rotate(-0.5);
      g.fillText(r.s.label, 0, 0);
      g.restore();
    });

    // IAQI breakdown for the peak sample.
    const entries = Object.entries(peak.res.iaqis) as Array<[AqiPollutant, number]>;
    const rowH = 16;
    const listTop = chartBottom + 34;
    g.textAlign = 'left';
    g.fillStyle = 'rgba(230, 238, 248, 0.95)';
    g.fillText(
      zh
        ? `${peak.s.label} 的 IAQI 分解${this.state.showPrimary && peak.res.primary ? `（首要污染物：${POLLUTANT_LABELS[peak.res.primary].zh}）` : ''}`
        : `IAQI breakdown of ${peak.s.label}${this.state.showPrimary && peak.res.primary ? ` (primary: ${POLLUTANT_LABELS[peak.res.primary].en})` : ''}`,
      16,
      listTop,
    );
    const barMax = Math.max(100, ...entries.map(([, v]) => v));
    entries.slice(0, 6).forEach(([k, v], i) => {
      const y = listTop + 8 + i * rowH;
      if (y > canvas.height - 8) return;
      g.fillStyle = 'rgba(170, 182, 200, 0.95)';
      g.fillText(zh ? POLLUTANT_LABELS[k].zh : POLLUTANT_LABELS[k].en, 16, y + 10);
      const bx = 78;
      const bwid = Math.min(220, canvas.width * 0.28);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(bx, y + 2, bwid, 9);
      g.fillStyle = envRampColor(v / (barMax * 1.6));
      g.fillRect(bx, y + 2, (bwid * v) / barMax, 9);
      g.fillStyle = peak.res.primary === k && this.state.showPrimary ? '#e05e4b' : 'rgba(200, 210, 225, 0.9)';
      g.fillText(v.toFixed(0), bx + bwid + 8, y + 10);
    });

    // Footnotes: out-of-range / dropped pollutants.
    const oor = valid.flatMap((r) => r.res.outOfRange.map((k) => `${r.s.label}:${zh ? POLLUTANT_LABELS[k].zh : POLLUTANT_LABELS[k].en}`));
    const dropped = valid.flatMap((r) => r.res.dropped.map((k) => `${r.s.label}:${zh ? POLLUTANT_LABELS[k].zh : POLLUTANT_LABELS[k].en}`));
    if (oor.length > 0 || dropped.length > 0) {
      g.fillStyle = 'rgba(230, 180, 90, 0.95)';
      g.textAlign = 'right';
      const notes: string[] = [];
      if (oor.length > 0) notes.push(`${zh ? '超出评价范围' : 'out of range'}: ${oor.join(', ')}`);
      if (dropped.length > 0) notes.push(`${zh ? '无效值剔除' : 'dropped'}: ${dropped.join(', ')}`);
      g.fillText(notes.join('  |  '), canvas.width - 16, canvas.height - 8);
    }
  }
}

export default function createAqiPlugin(): Plugin {
  return new AqiPlugin();
}
