// ==========================================================================
// Example plugin: Climatograph
//
// The classic classroom climate diagram: monthly precipitation as bars on
// the right axis, monthly mean temperature as a line on the left axis,
// drawn to the standard 30 °C : 2× precipitation scale convention so the
// "wet/dry season" reading works the way textbooks teach it. A summary row
// reports annual means/range and a compact Köppen-style seasonality note.
//
// Input: CSV with month,temp,precip rows (12 months). A leading `#`-comment
// can name the station: `# station: Beijing (39.9N)`.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, exportCanvasPng, actionFired, notify } from '../shared/enhance';
import { isZh, parseDelimited } from './geoCore';
import { pushPanelsToFigure, panelTag, panelPlace, GEO_PANEL_WIDTH, GEO_PANEL_HEIGHT } from './geoFigure';
import type { GeoFigurePanel, Bilingual } from './geoFigure';
import type { CategoricalTicks } from '@/core/plot';
import { climographManifest } from './climographManifest';

export { climographManifest } from './climographManifest';

// ---- Parsing & climate reading (exported for tests) ------------------------

export interface ClimateMonth {
  month: number; // 1-12
  temp: number; // °C
  precip: number; // mm
}

export interface ClimateStation {
  station: string;
  months: ClimateMonth[];
}

const MONTH_KEYS = /^(month|月份|m)$/i;
const TEMP_KEYS = /^(temp|temperature|气温|气温℃|temp_c|tavg|t)$/i;
const PRCP_KEYS = /^(precip|precipitation|降水|降水量|prcp|p|rain)$/i;

/** Parse a month/temp/precip CSV (header optional; `# station:` names it). */
export function parseClimateCsv(text: string): ClimateStation | null {
  // parseDelimited drops `#` comment lines, so pull the station name from
  // the raw text first.
  let station = '';
  const st = /^#\s*station\s*[:=]\s*(.+)$/im.exec(text);
  if (st) station = st[1]!.trim();

  const dataRows = parseDelimited(text);
  if (dataRows.length < 6) return null;

  // Detect a header row by looking for a known month/temp/precip keyword.
  let mCol = 0;
  let tCol = 1;
  let pCol = 2;
  let body = dataRows;
  const head = dataRows[0]!.map((c) => c.toLowerCase());
  const headerHit = head.some((c) => MONTH_KEYS.test(c) || TEMP_KEYS.test(c) || PRCP_KEYS.test(c));
  if (headerHit) {
    const findCol = (re: RegExp, fallback: number): number => {
      const i = head.findIndex((c) => re.test(c));
      return i >= 0 ? i : fallback;
    };
    mCol = findCol(MONTH_KEYS, 0);
    tCol = findCol(TEMP_KEYS, 1);
    pCol = findCol(PRCP_KEYS, 2);
    body = dataRows.slice(1);
  }

  const months: ClimateMonth[] = [];
  for (const row of body) {
    const month = Number(row[mCol]);
    const temp = Number(row[tCol]);
    const precip = Number(row[pCol]);
    if (!Number.isFinite(month) || !Number.isFinite(temp) || !Number.isFinite(precip)) continue;
    if (month < 1 || month > 12) continue;
    months.push({ month: Math.round(month), temp, precip: Math.max(0, precip) });
  }
  if (months.length < 6) return null;
  months.sort((a, b) => a.month - b.month);
  return { station, months };
}

export interface ClimateSummary {
  coldest: number;
  warmest: number;
  annualTemp: number;
  annualPrecip: number;
  range: number;
  /** Wet-season placement: 'summer' | 'winter' | 'year-round' | 'arid'. */
  regime: 'summer' | 'winter' | 'year-round' | 'arid';
  /** Köppen-style first guess from coldest-month / warmest-month temps. */
  group: 'A' | 'B' | 'C' | 'D' | 'E';
}

/**
 * Compact classroom Köppen-style reading. Group thresholds follow the
 * standard scheme (A >18 °C coldest month; B arid via precipitation;
 * E <10 °C warmest month; C vs D by the −3 °C coldest-month line).
 */
export function summarizeClimate(months: ClimateMonth[]): ClimateSummary {
  const temps = months.map((m) => m.temp);
  const precip = months.map((m) => m.precip);
  const coldest = Math.min(...temps);
  const warmest = Math.max(...temps);
  const annualTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
  const annualPrecip = precip.reduce((a, b) => a + b, 0);

  const total = Math.max(annualPrecip, 1e-9);
  const winter = precip[11]! + precip[0]! + precip[1]!; // DJF
  const summer = precip[5]! + precip[6]! + precip[7]!; // JJA
  let regime: ClimateSummary['regime'] = 'year-round';
  if (annualPrecip < 250) regime = 'arid';
  else if (summer / total > 0.4) regime = 'summer';
  else if (winter / total > 0.4) regime = 'winter';

  let group: ClimateSummary['group'];
  if (coldest >= 18) group = 'A';
  else if (warmest < 10) group = 'E';
  else if (annualPrecip < 250) group = 'B';
  else if (coldest < -3) group = 'D';
  else group = 'C';

  return { coldest, warmest, annualTemp, annualPrecip, range: warmest - coldest, regime, group };
}

// ---- Figure Studio panels (exported for tests) ------------------------------

const MONTH_TICKS: CategoricalTicks[] = Array.from({ length: 12 }, (_, i) => ({ pos: i + 1, label: String(i + 1) }));

/** Figure sheet for one station: temperature line + precipitation bars. */
export function climographFigurePanels(station: ClimateStation): GeoFigurePanel[] {
  const months = station.months;
  const tempPts = months.map((m) => ({ x: m.month, y: m.temp }));
  const bars = months.map((m) => ({ x0: m.month - 0.4, x1: m.month + 0.4, y: m.precip }));
  const pMax = Math.max(...months.map((m) => m.precip), 10);
  return [
    {
      ...panelPlace(0),
      tag: panelTag(0),
      spec: {
        width: GEO_PANEL_WIDTH,
        height: GEO_PANEL_HEIGHT,
        title: `Temperature — ${station.station || 'station'}`,
        xLabel: 'month',
        yLabel: '°C',
        xDomain: [0.5, 12.5],
        xTicksOverride: MONTH_TICKS,
        ticks: 5,
        grid: true,
        series: [{ name: 'mean temp', kind: 'line', color: '#FF9678', points: tempPts }],
      },
    },
    {
      ...panelPlace(1),
      tag: panelTag(1),
      spec: {
        width: GEO_PANEL_WIDTH,
        height: GEO_PANEL_HEIGHT,
        title: `Precipitation — ${station.station || 'station'}`,
        xLabel: 'month',
        yLabel: 'mm',
        xDomain: [0.5, 12.5],
        yDomain: [0, pMax],
        xTicksOverride: MONTH_TICKS,
        ticks: 5,
        grid: true,
        series: [{ name: 'precip', kind: 'bar', color: '#64A0F0', bars }],
      },
    },
  ];
}

// ---- Plugin ----------------------------------------------------------------

interface State {
  station: ClimateStation | null;
  showValues: boolean;
}

const T_MAX = 50;

export class ClimographPlugin implements Plugin {
  readonly manifest = climographManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { station: null, showValues: true };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.state.station = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    if (actionFired(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'geo-climograph');
      return;
    }
    if (actionFired(params, 'sendToFigure')) {
      void this.sendToFigure();
      return;
    }
    if (typeof params.showValues === 'boolean') {
      this.state.showValues = params.showValues;
      this.draw();
    }
  }

  /** Stream the temperature/precipitation sheet for the loaded station. */
  private async sendToFigure(): Promise<void> {
    const st = this.state.station;
    if (!st) return;
    const s = summarizeClimate(st.months);
    const name = st.station || (isZh(this.api.locale) ? '站点' : 'station');
    const caption: Bilingual = {
      zh: `${name} 气候直方图：年均温 ${s.annualTemp.toFixed(1)} °C，年降水 ${Math.round(s.annualPrecip)} mm，年较差 ${s.range.toFixed(1)} °C；最冷月 ${s.coldest.toFixed(1)} °C，最热月 ${s.warmest.toFixed(1)} °C（柯本组 ${s.group}）。`,
      en: `Climatograph of ${name}: mean ${s.annualTemp.toFixed(1)} °C, annual rain ${Math.round(s.annualPrecip)} mm, range ${s.range.toFixed(1)} °C; coldest ${s.coldest.toFixed(1)} °C, warmest ${s.warmest.toFixed(1)} °C (Köppen group ${s.group}).`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: `气候直方图 · ${name}`, en: `Climatograph · ${name}` },
      caption,
      climographFigurePanels(st),
    );
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'showValues',
        label: 'Label values on chart',
        labelI18n: { 'zh-CN': '在图上标注数值', 'en-US': 'Label values on chart' },
        type: 'checkbox',
        value: this.state.showValues,
      },
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const zh = isZh(this.api.locale);
    const parsed = parseClimateCsv(await file.text());
    if (!parsed) {
      notify(this.api, 'warning', 'No month/temp/precip rows found', '未找到 month/temp/precip 数据行');
      return;
    }
    this.state.station = parsed;
    this.api.reportDataScale(parsed.months.length);
    notify(
      this.api,
      'success',
      `Loaded ${parsed.station || 'station'} — ${parsed.months.length} months`,
      `已加载 ${parsed.station || '站点'} — ${parsed.months.length} 个月`,
    );
    void zh;
    this.draw();
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 640;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    const zh = isZh(this.api.locale);
    if (!this.state.station) {
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.font = "12px 'Microsoft YaHei', Consolas, monospace";
      g.textAlign = 'center';
      g.fillText(
        zh ? '未加载数据 — 拖入 month,temp,precip CSV 或打开「示例数据」' : 'No data — drop a month,temp,precip CSV or load a sample',
        canvas.width / 2,
        canvas.height / 2,
      );
      return;
    }

    const { station, months } = this.state.station;
    const s = summarizeClimate(months);

    const padL = 52;
    const padR = 56;
    const padT = 46;
    const padB = 56;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    const px = (m: number) => x0 + (plotW * (m - 0.5)) / 12;
    // Temperature scale (−20…T_MAX covers classroom climates).
    const tMin = -20;
    const py = (t: number) => y1 - (plotH * (t - tMin)) / (T_MAX - tMin);
    // Precipitation: bars share the same vertical span, scale to max.
    const pMax = Math.max(...months.map((m) => m.precip), 10);

    g.font = "11px 'Microsoft YaHei', Consolas, monospace";

    // Title.
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230, 238, 248, 0.95)';
    g.font = "13px 'Microsoft YaHei', Consolas, monospace";
    g.fillText(station || (zh ? '气候直方图' : 'Climatograph'), canvas.width / 2, 20);
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";

    // Frame.
    g.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // Left axis: temperature.
    g.textAlign = 'right';
    g.fillStyle = 'rgba(255, 150, 120, 0.95)';
    for (let t = -20; t <= T_MAX; t += 10) {
      const sy = py(t);
      g.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.fillText(String(t), x0 - 6, sy + 4);
    }

    // Right axis: precipitation.
    g.textAlign = 'left';
    g.fillStyle = 'rgba(120, 180, 255, 0.95)';
    const pTicks = 5;
    for (let i = 0; i <= pTicks; i += 1) {
      const v = (pMax / pTicks) * i;
      const sy = y1 - (plotH * v) / pMax;
      g.fillText(String(Math.round(v)), x1 + 6, sy + 4);
    }

    // Precipitation bars.
    const barW = (plotW / 12) * 0.62;
    for (const m of months) {
      const bx = px(m.month) - barW / 2;
      const bh = (plotH * m.precip) / pMax;
      g.fillStyle = 'rgba(100, 160, 240, 0.55)';
      g.fillRect(bx, y1 - bh, barW, bh);
      g.strokeStyle = 'rgba(120, 180, 255, 0.8)';
      g.strokeRect(bx, y1 - bh, barW, bh);
      if (this.state.showValues && pMax / 12 > 20) {
        g.fillStyle = 'rgba(160, 200, 250, 0.9)';
        g.textAlign = 'center';
        g.fillText(String(Math.round(m.precip)), bx + barW / 2, y1 - bh - 3);
      }
    }

    // Temperature line.
    g.strokeStyle = 'rgba(255, 150, 120, 0.95)';
    g.lineWidth = 2;
    g.beginPath();
    months.forEach((m, i) => {
      const sx = px(m.month);
      const sy = py(m.temp);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    });
    g.stroke();
    g.fillStyle = 'rgba(255, 170, 140, 1)';
    for (const m of months) {
      g.beginPath();
      g.arc(px(m.month), py(m.temp), 3, 0, Math.PI * 2);
      g.fill();
      if (this.state.showValues) {
        g.fillStyle = 'rgba(255, 190, 160, 0.95)';
        g.textAlign = 'center';
        g.fillText(m.temp.toFixed(0), px(m.month), py(m.temp) - 7);
        g.fillStyle = 'rgba(255, 170, 140, 1)';
      }
    }

    // Month labels.
    g.textAlign = 'center';
    g.fillStyle = 'rgba(150, 165, 185, 0.9)';
    for (let m = 1; m <= 12; m += 1) g.fillText(String(m), px(m), y1 + 14);

    // Summary row.
    const regimeZh = { summer: '夏雨型', winter: '冬雨型', 'year-round': '年雨型', arid: '干旱少雨' } as const;
    const regimeEn = { summer: 'summer-wet', winter: 'winter-wet', 'year-round': 'year-round rain', arid: 'arid' } as const;
    const groupNoteZh: Record<ClimateSummary['group'], string> = {
      A: '热带（最冷月 ≥ 18 °C）',
      B: '干旱/半干旱',
      C: '亚热带（最冷月 −3…18 °C）',
      D: '温带（最冷月 < −3 °C）',
      E: '寒带（最热月 < 10 °C）',
    };
    const groupNoteEn: Record<ClimateSummary['group'], string> = {
      A: 'Tropical (coldest ≥ 18 °C)',
      B: 'Arid / semi-arid',
      C: 'Subtropical (coldest −3…18 °C)',
      D: 'Continental (coldest < −3 °C)',
      E: 'Polar (warmest < 10 °C)',
    };
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170, 182, 200, 0.95)';
    const line1 = zh
      ? `年均温 ${s.annualTemp.toFixed(1)} °C\u3000年降水 ${Math.round(s.annualPrecip)} mm\u3000年较差 ${s.range.toFixed(1)} °C`
      : `Mean ${s.annualTemp.toFixed(1)} °C\u3000Annual rain ${Math.round(s.annualPrecip)} mm\u3000Range ${s.range.toFixed(1)} °C`;
    const line2 = zh
      ? `判读：${groupNoteZh[s.group]}，${regimeZh[s.regime]}（最冷月 ${s.coldest.toFixed(1)} °C，最热月 ${s.warmest.toFixed(1)} °C）`
      : `Reading: ${groupNoteEn[s.group]}, ${regimeEn[s.regime]} (coldest ${s.coldest.toFixed(1)} °C, warmest ${s.warmest.toFixed(1)} °C)`;
    g.fillText(line1, x0, canvas.height - 30);
    g.fillStyle = 'rgba(200, 210, 225, 0.95)';
    g.fillText(line2, x0, canvas.height - 14);

    // Axis captions.
    g.textAlign = 'right';
    g.fillStyle = 'rgba(255, 150, 120, 0.95)';
    g.fillText(zh ? '气温 °C' : 'Temp °C', x0 - 6, y0 - 8);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(120, 180, 255, 0.95)';
    g.fillText(zh ? '降水 mm' : 'Rain mm', x1 + 6, y0 - 8);
  }
}

export default function createClimographPlugin(): Plugin {
  return new ClimographPlugin();
}
