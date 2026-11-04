// ==========================================================================
// Example plugin: Water quality (GB 3838-2002)
//
// Data-driven surface-water classification: every CSV row is one site. Each
// indicator is binned into classes Ⅰ–Ⅴ against the GB 3838-2002 river
// limits; the single-factor (worst class) method yields the site verdict, an
// optional weighted-arithmetic WQI supports cross-site comparison, and a
// radar chart plots each measurement relative to its class-Ⅲ limit.
//
// Data-driven: no built-in demo content — empty state until a CSV loads.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  GB3838_LIMITS,
  WATER_COLUMNS,
  WATER_INDICATORS,
  WATER_LABELS,
  type WaterIndicator,
  evaluateWaterSite,
  findColumn,
  numCell,
  type WaterSiteInput,
  type WaterSiteResult,
  computeWqi,
  wqiSubindices,
  wqiRating,
} from '../shared/envCore';
import { setScienceOutputs, clearScienceOutputs, fmtMetric, type ScienceMetric } from '@/core/research/scienceOutput';
import {
  actionButton,
  actionFired,
  drawEmptyCanvas,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { isZh } from '@/core/plugin-tools/locale';
import { parseDelimited } from '@/core/plugin-tools/table';
import { pushPanelsToFigure, panelTag, panelPlace, FIGURE_PANEL_WIDTH, FIGURE_PANEL_HEIGHT, type Bilingual, type FigurePanelSpec } from '@/core/figure/sheet';
import { waterManifest } from './manifest';

// ---- Parsing (exported for tests) ------------------------------------------

export interface WaterSheet {
  sites: WaterSiteInput[];
}

export function parseWaterCsv(text: string): WaterSheet | null {
  const rows = parseDelimited(text);
  if (rows.length === 0) return null;
  const header = rows[0]!.map((c) => c.toLowerCase());
  const hasHeader = WATER_INDICATORS.some((ind) => findColumn(header, WATER_COLUMNS[ind]) >= 0);
  let body = rows;
  const cols: Partial<Record<WaterIndicator, number>> = {};
  let nameCol = -1;
  if (hasHeader) {
    body = rows.slice(1);
    for (const ind of WATER_INDICATORS) {
      const i = findColumn(header, WATER_COLUMNS[ind]);
      if (i >= 0) cols[ind] = i;
    }
    nameCol = header.findIndex((c) => /^(site|name|station|断面|站点|样点|sample|id)$/i.test(c));
  } else {
    // Bare numeric sheet: site,ph,do,cod,bod,nh3_n,tp canonical order.
    const order: WaterIndicator[] = ['ph', 'do', 'cod', 'bod', 'nh3n', 'tp'];
    order.forEach((k, i) => {
      if (i + 1 < (rows[0]!.length ?? 0)) cols[k] = i + 1;
    });
    nameCol = 0;
  }
  if (Object.keys(cols).length === 0) return null;
  const sites: WaterSiteInput[] = [];
  body.forEach((row, n) => {
    const values: Partial<Record<WaterIndicator, number>> = {};
    for (const ind of Object.keys(cols) as WaterIndicator[]) {
      const v = numCell(row[cols[ind]!]);
      if (v !== null) values[ind] = v;
    }
    if (Object.keys(values).length === 0) return;
    sites.push({ name: nameCol >= 0 ? (row[nameCol] ?? '') || `#${n + 1}` : `#${n + 1}`, values });
  });
  return sites.length > 0 ? { sites } : null;
}

// ---- Weight sensitivity & missing stats (exported for tests) ----------------

export interface WqiSensitivity {
  /** Equal-weight (base) WQI. */
  base: number | null;
  /** Envelope of WQI under ±10% single-indicator weight perturbations. */
  low: number;
  high: number;
  /** Per-indicator [w×0.9, w×1.1] WQI interval (weights renormalised). */
  perIndicator: Array<{ ind: WaterIndicator; low: number; high: number }>;
}

/**
 * Weight-sensitivity of the weighted-arithmetic WQI: each indicator's
 * implicit weight is perturbed by ±10% (one at a time), weights renormalised,
 * and the WQI recomputed from the same sub-indices. With n indicators and
 * sub-indices q_i: WQI' = (Σq ± 0.1·q_i) / (n ± 0.1). Pure.
 */
export function wqiWeightSensitivity(values: Partial<Record<WaterIndicator, number>>): WqiSensitivity | null {
  const sub = wqiSubindices(values);
  const entries = Object.entries(sub) as Array<[WaterIndicator, number]>;
  const n = entries.length;
  if (n === 0) return null;
  const sum = entries.reduce((a, [, q]) => a + q, 0);
  const perIndicator = entries.map(([ind, q]) => ({
    ind,
    low: (sum - 0.1 * q) / (n - 0.1),
    high: (sum + 0.1 * q) / (n + 0.1),
  }));
  const low = Math.min(...perIndicator.map((p) => p.low));
  const high = Math.max(...perIndicator.map((p) => p.high));
  return { base: computeWqi(values), low, high, perIndicator };
}

export interface WaterMissingStat {
  ind: WaterIndicator;
  present: number;
  missing: number;
  rate: number;
}

/** Per-indicator missing-record statistics across the loaded sites. */
export function waterMissingStats(sites: WaterSiteInput[]): WaterMissingStat[] {
  const total = sites.length;
  return WATER_INDICATORS.map((ind) => {
    const present = sites.filter((s) => {
      const v = s.values[ind];
      return v !== undefined && Number.isFinite(v);
    }).length;
    const missing = total - present;
    return { ind, present, missing, rate: total > 0 ? missing / total : 0 };
  });
}

// ---- Figure Studio panels (exported for tests) ------------------------------

export function waterFigurePanels(sheet: WaterSheet): FigurePanelSpec[] {
  const results = sheet.sites.map((s) => evaluateWaterSite(s));
  const radarAxes = WATER_INDICATORS;
  const limitOf = (ind: WaterIndicator) => GB3838_LIMITS[ind]!.limits[2] ?? 1; // Class Ⅲ limit as reference
  const firstSite = sheet.sites[0];
  if (!firstSite) return [];
  const relPts = radarAxes.map((ind, i) => {
    const v = firstSite.values[ind];
    const lim = limitOf(ind);
    const ratio = v === undefined ? 0 : ind === 'do' ? (lim === 0 ? 0 : v / lim) : lim === 0 ? 0 : v / lim;
    return { x: i, y: ratio };
  });
  const wqiPts = results.map((r, i) => ({ x: i + 1, y: r.wqi ?? 0 }));
  return [
    {
      ...panelPlace(0),
      tag: panelTag(0),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: `${firstSite.name || 'site'} — value / Class-Ⅲ limit`,
        xLabel: 'indicator',
        yLabel: 'ratio',
        xDomain: [-0.2, radarAxes.length - 0.8],
        yDomain: [0, Math.max(1.5, ...relPts.map((p) => p.y))],
        xTicksOverride: radarAxes.map((ind, i) => ({ pos: i, label: WATER_LABELS[ind]?.en ?? ind })),
        ticks: 5,
        grid: true,
        series: [{ name: 'measured/limit', kind: 'line', color: '#64A0F0', points: relPts }],
      },
    },
    {
      ...panelPlace(1),
      tag: panelTag(1),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'WQI per site',
        xLabel: 'site',
        yLabel: 'WQI',
        xDomain: [0.5, results.length + 0.5],
        yDomain: [0, Math.max(50, ...wqiPts.map((p) => p.y))],
        ticks: 5,
        grid: true,
        series: [{ name: 'WQI', kind: 'bar', color: '#40C463', bars: wqiPts.map((p, i) => ({ x0: i + 0.8, x1: i + 1.2, y: p.y })) }],
      },
    },
  ];
}

// ---- Plugin ----------------------------------------------------------------

interface State {
  sheet: WaterSheet | null;
  includeBod: boolean;
  showWqi: boolean;
}

export class WaterPlugin implements Plugin {
  readonly manifest = waterManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { sheet: null, includeBod: true, showWqi: true };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.state.sheet = null;
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
    return [
      {
        key: 'includeBod',
        label: 'Include BOD₅ in evaluation',
        labelI18n: { 'zh-CN': '纳入 BOD₅ 评价', 'en-US': 'Include BOD₅' },
        hint: { 'zh-CN': '数据缺 BOD₅ 时可关闭', 'en-US': 'Turn off when BOD₅ is unavailable' }[isZh(this.api.locale) ? 'zh-CN' : 'en-US'],
        type: 'checkbox',
        value: this.state.includeBod,
      },
      {
        key: 'showWqi',
        label: 'Show weighted-arithmetic WQI',
        labelI18n: { 'zh-CN': '显示 WQI 综合指数', 'en-US': 'Show WQI' },
        hint: isZh(this.api.locale)
          ? '加权算术水质指数（等权），用于横向比较，非合规指标'
          : 'Weighted-arithmetic WQI (equal weights) for comparison, not a compliance metric',
        type: 'checkbox',
        value: this.state.showWqi,
      },
      actionButton('exportCsv', 'Export CSV', '导出 CSV'),
      actionButton('exportSub', 'Export sub-index CSV', '导出子指数 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
      actionButton('reloadPlugin', 'Reset Plugin', '重置插件'),
    ];
  }

  updateParams(params: Record<string, unknown>) {

    if (actionFired(params, 'exportCsv')) {
      this.exportCsv();
      return;
    }
    if (actionFired(params, 'exportSub')) {
      this.exportSubindicesCsv();
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
    if (typeof params.includeBod === 'boolean' && params.includeBod !== this.state.includeBod) {
      this.state.includeBod = params.includeBod;
      redraw = true;
    }
    if (typeof params.showWqi === 'boolean' && params.showWqi !== this.state.showWqi) {
      this.state.showWqi = params.showWqi;
      redraw = true;
    }
    if (redraw) this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const parsed = parseWaterCsv(await file.text());
    if (!parsed) {
      notify(this.api, 'warning', 'No water-quality rows found', '未找到水质指标数据行');
      return;
    }
    this.state.sheet = parsed;
    this.api.reportDataScale(parsed.sites.length);
    notify(this.api, 'success', `Loaded ${parsed.sites.length} site(s)`, `已加载 ${parsed.sites.length} 个样点`);
    this.draw();
  }

  /** Evaluate a site, honouring the includeBod switch. */
  private evaluate(site: WaterSiteInput): WaterSiteResult {
    const values = { ...site.values };
    if (!this.state.includeBod) delete values.bod;
    return evaluateWaterSite({ name: site.name, values });
  }

  // ---- scientific outputs ---------------------------------------------------

  private publishScience(): void {
    const sheet = this.state.sheet;
    if (!sheet || sheet.sites.length === 0) {
      clearScienceOutputs(this.manifest.id);
      return;
    }
    const zh = isZh(this.api.locale);
    const sites = sheet.sites;
    const results = sites.map((s) => this.evaluate(s));
    const wqis = results.map((r) => r.wqi).filter((w): w is number => w !== null);
    const metrics: ScienceMetric[] = [
      {
        key: 'n',
        label: 'N sites',
        value: String(sites.length),
        hint: zh ? '载入样点数' : 'loaded sites',
      },
    ];
    if (wqis.length > 0) {
      const wMin = Math.min(...wqis);
      const wMax = Math.max(...wqis);
      const wMed = wqis.slice().sort((a, b) => a - b);
      const med = wMed.length % 2 === 1 ? wMed[(wMed.length - 1) / 2]! : (wMed[wMed.length / 2 - 1]! + wMed[wMed.length / 2]!) / 2;
      metrics.push({
        key: 'wqi_range',
        label: 'WQI min–max',
        value: `${fmtMetric(wMin)}–${fmtMetric(wMax)} (med ${fmtMetric(med)})`,
        hint: zh ? '各样点加权算术 WQI（等权）范围与中位数' : 'per-site weighted-arithmetic WQI range and median',
      });
      // (a) weight sensitivity: ±10% per-indicator weight perturbation.
      let lo = Infinity;
      let hi = -Infinity;
      let hit = 0;
      for (const s of sites) {
        const sens = wqiWeightSensitivity(s.values);
        if (!sens) continue;
        lo = Math.min(lo, sens.low);
        hi = Math.max(hi, sens.high);
        hit += 1;
      }
      if (hit > 0) {
        metrics.push({
          key: 'wqi_sens',
          label: 'WQI ±10%w',
          value: `[${fmtMetric(lo)} – ${fmtMetric(hi)}]`,
          hint: zh
            ? '各指标权重 ±10% 扰动（归一化）后 WQI 的全样点包络区间'
            : 'envelope of WQI over all sites with each weight perturbed ±10% (renormalised)',
        });
      }
    }
    // (b) missing records per indicator.
    for (const m of waterMissingStats(sites)) {
      metrics.push({
        key: `miss_${m.ind}`,
        label: `MISS ${WATER_LABELS[m.ind].en}`,
        value: `${m.missing}/${m.present + m.missing} (${(m.rate * 100).toFixed(1)}%)`,
        severity: m.rate >= 0.2 ? 'warn' : 'info',
        hint: zh ? '缺测记录数 / 样点数（缺失率）' : 'missing records / sites (missing rate)',
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  /** (c) Sub-index table CSV: q_i per site plus the WQI sensitivity interval. */
  private exportSubindicesCsv(): void {
    const sheet = this.state.sheet;
    if (!sheet) {
      notify(this.api, 'warning', 'No data to export yet.', '暂无可导出的数据。');
      return;
    }
    const header = ['site', ...WATER_INDICATORS.map((i) => `q_${i}`), 'wqi', 'wqi_sens_low', 'wqi_sens_high'];
    const rows = sheet.sites.map((s) => {
      const values = { ...s.values };
      if (!this.state.includeBod) delete values.bod;
      const sub = wqiSubindices(values);
      const sens = wqiWeightSensitivity(values);
      return [
        s.name,
        ...WATER_INDICATORS.map((ind) => sub[ind]?.toFixed(2) ?? ''),
        computeWqi(values)?.toFixed(2) ?? '',
        sens ? sens.low.toFixed(2) : '',
        sens ? sens.high.toFixed(2) : '',
      ];
    });
    exportRowsCsv(this.api, 'env-water-subindices', header, rows);
  }

  private exportCsv() {
    const sheet = this.state.sheet;
    if (!sheet) {
      notify(this.api, 'warning', 'No data to export yet.', '暂无可导出的数据。');
      return;
    }
    const zh = isZh(this.api.locale);
    const header = ['site', ...WATER_INDICATORS.map((i) => `class_${i}`), 'worst_class', 'wqi'];
    const rows = sheet.sites.map((s) => {
      const r = this.evaluate(s);
      return [
        r.name,
        ...WATER_INDICATORS.map((ind) => r.classes[ind]?.toFixed(0) ?? (r.exceeded.includes(ind) ? '>-V' : '')),
        r.worstClass?.toFixed(0) ?? '',
        r.wqi?.toFixed(1) ?? '',
      ];
    });
    exportRowsCsv(this.api, 'env-water', header, rows);
    notify(this.api, 'success', zh ? '已导出 CSV' : 'CSV exported', zh ? '已导出 CSV' : 'CSV exported');
  }

  private async sendToFigure(): Promise<void> {
    if (!this.state.sheet) {
      notify(this.api, 'warning', 'No data yet — load a CSV first.', '暂无数据 — 请先载入 CSV。');
      return;
    }
    const results = this.state.sheet.sites.map((s) => this.evaluate(s));
    const worst = results.reduce<WaterSiteResult | null>(
      (a, b) => (a === null || (b.worstClass ?? -1) > (a.worstClass ?? -1) ? b : a),
      null,
    );
    const caption: Bilingual = {
      zh: `水质评价（GB 3838-2002，单因子法）：${results.length} 个样点；最差样点 ${worst?.name ?? '—'} 综合类别 ${worst?.worstClass ? ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'][worst.worstClass - 1] : '劣Ⅴ'}，超标项 ${worst ? worst.exceeded.length : 0} 个。`,
      en: `Water quality (GB 3838-2002, single-factor): ${results.length} site(s); worst site ${worst?.name ?? '—'} at class ${worst?.worstClass ?? '>V'}, ${worst ? worst.exceeded.length : 0} exceeded indicator(s).`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '水质评价', en: 'Water Quality' },
      caption,
      waterFigurePanels(this.state.sheet),
    );
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const zh = isZh(this.api.locale);
    if (!this.state.sheet) {
      clearScienceOutputs(this.manifest.id);
      drawEmptyCanvas(this.api, canvas, {
        title: zh ? '水质评价（GB 3838-2002）' : 'Water Quality (GB 3838-2002)',
        hintZh: '拖入或从「示例数据」载入水样 CSV（site,ph,do,cod,bod,nh3_n,tp）',
        hint: 'Drop a water-sample CSV (site,ph,do,cod,bod,nh3_n,tp) via the sample bar.',
      });
      return;
    }
    this.publishScience();
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 460;
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";

    const results = this.state.sheet.sites.map((s) => this.evaluate(s));
    const classColors = ['#3fbf7f', '#8fd06a', '#d4c447', '#e8a33d', '#e05e4b'];

    // ---- Radar (first site, or the worst site) -----------------------------
    const focusIndex = results.reduce(
      (a, b, i) => ((b.worstClass ?? -1) > (results[a]!.worstClass ?? -1) ? i : a),
      0,
    );
    const focus = results[focusIndex]!;
    const focusSite = this.state.sheet.sites[focusIndex]!;
    const cx = canvas.width * 0.3;
    const cy = canvas.height * 0.52;
    const R = Math.min(canvas.width * 0.24, canvas.height * 0.34);
    const axes = WATER_INDICATORS;
    const n = axes.length;
    const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let ring = 1; ring <= 3; ring += 1) {
      g.beginPath();
      for (let i = 0; i <= n; i += 1) {
        const a = angle(i % n);
        const r = (R * ring) / 3;
        const px = cx + r * Math.cos(a);
        const py = cy + r * Math.sin(a);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }
    for (let i = 0; i < n; i += 1) {
      const a = angle(i);
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
      g.stroke();
      g.fillStyle = 'rgba(170, 182, 200, 0.95)';
      g.textAlign = 'center';
      g.fillText(zh ? WATER_LABELS[axes[i]!].zh : WATER_LABELS[axes[i]!].en, cx + (R + 18) * Math.cos(a), cy + (R + 18) * Math.sin(a) + 4);
    }
    // Normalized polygon: ratio of measured to class-Ⅲ limit (DO inverted so
    // farther out is always worse; capped at 2 for readability).
    g.beginPath();
    axes.forEach((ind, i) => {
      const v = focusSite.values[ind];
      const lim = GB3838_LIMITS[ind]!.limits[2]!;
      let ratio: number;
      if (v === undefined) ratio = 0;
      else if (ind === 'ph') ratio = v >= 6 && v <= 9 ? 0.5 : 2;
      else if (GB3838_LIMITS[ind]!.higherBetter) ratio = Math.min(2, lim / Math.max(v, 1e-6));
      else ratio = Math.min(2, v / lim);
      const a = angle(i);
      const r = (R * Math.min(ratio, 2)) / 2;
      const px = cx + r * Math.cos(a);
      const py = cy + r * Math.sin(a);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    });
    g.closePath();
    g.fillStyle = 'rgba(100, 160, 240, 0.25)';
    g.fill();
    g.strokeStyle = 'rgba(120, 180, 255, 0.9)';
    g.stroke();

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230, 238, 248, 0.95)';
    g.fillText(zh ? `实测值 / Ⅲ类限值（${focus.name}）` : `measured / Class-Ⅲ limit (${focus.name})`, cx, 24);

    // ---- Per-site verdict table --------------------------------------------
    const tx = Math.max(canvas.width * 0.58, 400);
    let ty = 40;
    g.textAlign = 'left';
    g.fillStyle = 'rgba(150, 165, 185, 0.9)';
    g.fillText(zh ? '样点' : 'site', tx, ty);
    g.fillText(zh ? '综合类别' : 'class', tx + 120, ty);
    if (this.state.showWqi) g.fillText('WQI', tx + 200, ty);
    ty += 8;
    results.forEach((r, i) => {
      ty += 18;
      if (ty > canvas.height - 60) return;
      g.fillStyle = 'rgba(200, 210, 225, 0.95)';
      g.fillText(`${i + 1}. ${r.name || `#${i + 1}`}`, tx, ty);
      const wc = r.worstClass;
      if (wc !== null) {
        g.fillStyle = classColors[Math.min(wc - 1, 4)]!;
        g.fillText(zh ? ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ'][wc - 1]! : ['I', 'II', 'III', 'IV', 'V'][wc - 1]!, tx + 128, ty);
      } else {
        g.fillStyle = '#e05e4b';
        g.fillText(zh ? '数据不足' : 'insufficient', tx + 120, ty);
      }
      if (this.state.showWqi && r.wqi !== null) {
        g.fillStyle = 'rgba(170, 182, 200, 0.95)';
        g.fillText(`${r.wqi.toFixed(0)} ${wqiRating(r.wqi, zh)}`, tx + 196, ty);
      }
    });

    // ---- Exceeded indicators for the focus site ----------------------------
    ty += 28;
    g.fillStyle = 'rgba(230, 238, 248, 0.95)';
    const exc = focus.exceeded.map((ind) => (zh ? WATER_LABELS[ind].zh : WATER_LABELS[ind].en));
    g.fillText(
      exc.length > 0
        ? zh
          ? `超标指标：${exc.join('、')}`
          : `Exceeded: ${exc.join(', ')}`
        : zh
          ? `${focus.name}：所有纳入指标均在评价范围内`
          : `${focus.name}: all evaluated indicators within range`,
      tx,
      Math.min(ty, canvas.height - 40),
    );
    const missed = focus.missing.map((ind) => (zh ? WATER_LABELS[ind].zh : WATER_LABELS[ind].en));
    if (missed.length > 0) {
      g.fillStyle = 'rgba(230, 180, 90, 0.95)';
      g.fillText(
        zh ? `未纳入评价：${missed.join('、')}` : `Not evaluated: ${missed.join(', ')}`,
        tx,
        Math.min(ty + 16, canvas.height - 24),
      );
    }

    // Footer: method note.
    g.fillStyle = 'rgba(150, 165, 185, 0.9)';
    g.textAlign = 'left';
    g.fillText(
      zh
        ? '综合判定 = 单因子法（最差类别）；类别限值见 GB 3838-2002 表 1（河流值）'
        : 'Overall = single-factor (worst class); limits per GB 3838-2002 Table 1 (rivers)',
      16,
      canvas.height - 10,
    );
  }
}

export default function createWaterPlugin(): Plugin {
  return new WaterPlugin();
}
