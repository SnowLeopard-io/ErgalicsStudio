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
import { actionButton, actionFired, drawEmptyCanvas, drawEmptyMessage, exportCanvasPng, notify } from '@/core/plugin-tools/enhance';
import { isZh } from '@/core/plugin-tools/locale';
import { parseDelimited } from '@/core/plugin-tools/table';
import {
  pushPanelsToFigure,
  panelTag,
  panelPlace,
  GEO_PANEL_WIDTH,
  GEO_PANEL_HEIGHT,
  type Bilingual,
  type GeoFigurePanel,
} from '../geo/geoFigure';
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

// ---- Figure Studio panels (exported for tests) ------------------------------

export function aqiFigurePanels(samples: AqiSample[], standard: AqiStandard): GeoFigurePanel[] {
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
        width: GEO_PANEL_WIDTH,
        height: GEO_PANEL_HEIGHT,
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
        width: GEO_PANEL_WIDTH,
        height: GEO_PANEL_HEIGHT,
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
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
      actionButton('reloadPlugin', 'Reset Plugin', '重置插件'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (actionFired(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'env-aqi');
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
      drawEmptyCanvas(this.api, canvas, {
        title: zh ? '空气质量评价（AQI）' : 'Air Quality (AQI)',
        hintZh: '拖入或从「示例数据」载入空气监测 CSV（so2,no2,pm25,pm10,co,o3），或填写右侧手动浓度',
        hint: 'Drop a monitoring CSV (so2,no2,pm25,pm10,co,o3) via the sample bar, or fill the manual inputs.',
      });
      return;
    }
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
    g.fillStyle = band!.color;
    g.fillRect(badgeX, 36, 76, 24);
    g.fillStyle = '#0a0e13';
    g.font = "bold 12px 'Microsoft YaHei', Consolas, monospace";
    g.textAlign = 'center';
    g.fillText(zh ? band!.zh : band!.en, badgeX + 38, 52);
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
      g.fillText(POLLUTANT_LABELS[k].zh, 16, y + 10);
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
    const oor = valid.flatMap((r) => r.res.outOfRange.map((k) => `${r.s.label}:${POLLUTANT_LABELS[k].zh}`));
    const dropped = valid.flatMap((r) => r.res.dropped.map((k) => `${r.s.label}:${POLLUTANT_LABELS[k].zh}`));
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
