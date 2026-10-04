// ==========================================================================
// Example plugin: Biodiversity indices
//
// Data-driven community ecology: a species-abundance matrix (rows = species,
// columns = sites) yields richness S, Shannon H′, Gini–Simpson 1−Σp² and
// Pielou evenness J per site, with dominant-species flags and a cross-site
// reading. Results export to CSV; selected indices are drawn as stacked
// relative-abundance bars per site.
//
// Data-driven: no built-in demo content — empty state until a CSV loads.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { diversityIndex, isZh, numCell, parseDelimited, type DiversityIndex } from './envCore';
import { actionButton, actionFired, drawEmptyCanvas, exportCanvasPng, exportRowsCsv, notify } from '../shared/enhance';
import { pushPanelsToFigure, panelTag, panelPlace, GEO_PANEL_WIDTH, GEO_PANEL_HEIGHT, type Bilingual, type GeoFigurePanel } from '../geo/geoFigure';
import { biodiversityManifest } from './biodiversityManifest';

export { biodiversityManifest } from './biodiversityManifest';

// ---- Parsing (exported for tests) ------------------------------------------

export interface AbundanceMatrix {
  species: string[];
  /** Column names (sites), e.g. site_1…site_n. */
  sites: string[];
  /** counts[siteIndex][speciesIndex]. */
  counts: number[][];
  /** Columns skipped because another column shrank the common width. */
  droppedSites: string[];
}

/** Parse the abundance matrix; columns = sites, rows = species. */
export function parseAbundanceCsv(text: string): AbundanceMatrix | null {
  const rows = parseDelimited(text);
  if (rows.length < 2) return null;
  const header = rows[0]!.map((c) => c.toLowerCase());
  const firstCol = /^(species|物种|taxon|name)$/i;
  let nameCol = header.findIndex((c) => firstCol.test(c));
  let siteStart = 1;
  if (nameCol < 0) {
    // Bare matrix without a species column: assume column 0 is species.
    nameCol = 0;
    siteStart = 1;
  }
  const sites = header.slice(siteStart).map((c, i) => c || `site_${i + 1}`);
  if (sites.length === 0) return null;
  const species: string[] = [];
  const rowsData: number[][] = [];
  for (const row of rows.slice(1)) {
    const name = row[nameCol] ?? '';
    const cells = row.slice(siteStart).map((c) => numCell(c));
    if (!name || cells.every((c) => c === null)) continue;
    species.push(name);
    rowsData.push(cells.map((c) => c ?? 0));
  }
  if (species.length === 0) return null;
  const width = Math.min(...rowsData.map((r) => r.length), sites.length);
  // Transpose: counts[site][species], truncated to the common width.
  const counts: number[][] = [];
  for (let s = 0; s < width; s += 1) counts.push(rowsData.map((r) => r[s] ?? 0));
  const droppedSites = width < sites.length ? sites.slice(width) : [];
  return { species, sites: sites.slice(0, width), counts, droppedSites };
}

// ---- Figure Studio panels (exported for tests) ------------------------------

export function biodiversityFigurePanels(matrix: AbundanceMatrix): GeoFigurePanel[] {
  const perSite = matrix.counts.map((c) => diversityIndex(c, matrix.species));
  const shannonPts = perSite.map((d, i) => ({ x: i + 1, y: d.shannon ?? 0 }));
  const simpsonPts = perSite.map((d, i) => ({ x: i + 1, y: d.simpson ?? 0 }));
  return [
    {
      ...panelPlace(0),
      tag: panelTag(0),
      spec: {
        width: GEO_PANEL_WIDTH,
        height: GEO_PANEL_HEIGHT,
        title: 'Shannon H′ per site',
        xLabel: 'site',
        yLabel: "H′ (nats)",
        xDomain: [0.5, perSite.length + 0.5],
        yDomain: [0, Math.max(0.5, ...shannonPts.map((p) => p.y)) * 1.1],
        ticks: 5,
        grid: true,
        series: [{ name: "H′", kind: 'bar', color: '#64A0F0', bars: shannonPts.map((p, i) => ({ x0: i + 0.8, x1: i + 1.2, y: p.y })) }],
      },
    },
    {
      ...panelPlace(1),
      tag: panelTag(1),
      spec: {
        width: GEO_PANEL_WIDTH,
        height: GEO_PANEL_HEIGHT,
        title: 'Gini–Simpson per site',
        xLabel: 'site',
        yLabel: '1−Σp²',
        xDomain: [0.5, perSite.length + 0.5],
        yDomain: [0, 1],
        ticks: 5,
        grid: true,
        series: [{ name: 'Simpson', kind: 'bar', color: '#40C463', bars: simpsonPts.map((p, i) => ({ x0: i + 0.8, x1: i + 1.2, y: p.y })) }],
      },
    },
  ];
}

// ---- Plugin ----------------------------------------------------------------

interface State {
  matrix: AbundanceMatrix | null;
  useShannon: boolean;
  useSimpson: boolean;
  useEvenness: boolean;
}

export class BiodiversityPlugin implements Plugin {
  readonly manifest = biodiversityManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { matrix: null, useShannon: true, useSimpson: true, useEvenness: true };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.state.matrix = null;
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
        key: 'useShannon',
        label: "Shannon H′",
        labelI18n: { 'zh-CN': 'Shannon 指数 H′', 'en-US': "Shannon H′" },
        type: 'checkbox',
        value: this.state.useShannon,
      },
      {
        key: 'useSimpson',
        label: 'Gini–Simpson',
        labelI18n: { 'zh-CN': 'Simpson 指数', 'en-US': 'Gini–Simpson' },
        type: 'checkbox',
        value: this.state.useSimpson,
      },
      {
        key: 'useEvenness',
        label: 'Pielou evenness',
        labelI18n: { 'zh-CN': 'Pielou 均匀度', 'en-US': 'Pielou evenness' },
        type: 'checkbox',
        value: this.state.useEvenness,
      },
      actionButton('exportCsv', 'Export CSV', '导出 CSV'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
      actionButton('reloadPlugin', 'Reset Plugin', '重置插件'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (actionFired(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'env-biodiversity');
      return;
    }
    if (actionFired(params, 'exportCsv')) {
      this.exportCsv();
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
    for (const k of ['useShannon', 'useSimpson', 'useEvenness'] as const) {
      if (typeof params[k] === 'boolean' && params[k] !== this.state[k]) {
        this.state[k] = params[k] as boolean;
        redraw = true;
      }
    }
    if (redraw) this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const parsed = parseAbundanceCsv(await file.text());
    if (!parsed) {
      notify(this.api, 'warning', 'Expected a species × site abundance matrix', '需要「物种 × 样地」丰度矩阵');
      return;
    }
    this.state.matrix = parsed;
    this.api.reportDataScale(parsed.species.length * parsed.sites.length);
    notify(
      this.api,
      'success',
      `Loaded ${parsed.species.length} species × ${parsed.sites.length} sites`,
      `已加载 ${parsed.species.length} 个物种 × ${parsed.sites.length} 个样地`,
    );
    if (parsed.droppedSites.length > 0) {
      notify(
        this.api,
        'warning',
        `Dropped trailing columns with no common rows: ${parsed.droppedSites.join(', ')}`,
        `按最小公共列处理，已舍弃：${parsed.droppedSites.join('、')}`,
      );
    }
    this.draw();
  }

  private exportCsv() {
    const m = this.state.matrix;
    if (!m) {
      notify(this.api, 'warning', 'No data to export yet.', '暂无可导出的数据。');
      return;
    }
    const perSite = m.counts.map((c) => diversityIndex(c, m.species));
    const header = ['site', 'richness', 'N', 'shannon_H', 'simpson', 'pielou_J', 'dominant', 'dominant_share'];
    const rows = m.sites.map((s, i) => {
      const d = perSite[i]!;
      return [
        s,
        d.richness,
        d.total,
        d.shannon?.toFixed(4) ?? '',
        d.simpson?.toFixed(4) ?? '',
        d.evenness?.toFixed(4) ?? '',
        d.dominant ?? '',
        d.dominantShare?.toFixed(3) ?? '',
      ];
    });
    exportRowsCsv(this.api, 'env-biodiversity', header, rows);
  }

  private async sendToFigure(): Promise<void> {
    const m = this.state.matrix;
    if (!m) {
      notify(this.api, 'warning', 'No data yet — load a CSV first.', '暂无数据 — 请先载入 CSV。');
      return;
    }
    const perSite = m.counts.map((c) => diversityIndex(c, m.species));
    const ranked = m.sites
      .map((s, i) => ({ site: s, h: perSite[i]!.shannon }))
      .filter((r) => r.h !== null)
      .sort((a, b) => b.h! - a.h!);
    const caption: Bilingual = {
      zh: `生物多样性对比：${ranked[0] ? `${ranked[0].site} 多样性最高（H′=${ranked[0].h!.toFixed(3)}）` : ''}${ranked[1] ? `，其次 ${ranked[1].site}（H′=${ranked[1].h!.toFixed(3)}）` : ''}。`,
      en: `Biodiversity ranking: ${ranked[0] ? `${ranked[0].site} highest (H′=${ranked[0].h!.toFixed(3)})` : ''}${ranked[1] ? `, then ${ranked[1].site} (H′=${ranked[1].h!.toFixed(3)})` : ''}.`,
    };
    await pushPanelsToFigure(this.api, { zh: '生物多样性指数', en: 'Biodiversity Indices' }, caption, biodiversityFigurePanels(m));
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const zh = isZh(this.api.locale);
    if (!this.state.matrix) {
      drawEmptyCanvas(this.api, canvas, {
        title: zh ? '生物多样性指数' : 'Biodiversity Indices',
        hintZh: '拖入或从「示例数据」载入丰度矩阵 CSV（species,site_1,…,site_n）',
        hint: 'Drop an abundance matrix CSV (species,site_1,…,site_n) via the sample bar.',
      });
      return;
    }
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 460;
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";

    const m = this.state.matrix;
    const perSite = m.counts.map((c) => diversityIndex(c, m.species));

    // ---- Table --------------------------------------------------------------
    g.textAlign = 'left';
    g.fillStyle = 'rgba(230, 238, 248, 0.95)';
    g.font = "12px 'Microsoft YaHei', Consolas, monospace";
    g.fillText(zh ? '各样地多样性指数' : 'Diversity indices per site', 16, 22);
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    const cols: Array<{ label: string; w: number; get: (d: DiversityIndex) => string }> = [
      { label: zh ? '样地' : 'site', w: 110, get: () => '' },
      { label: 'S', w: 44, get: (d) => String(d.richness) },
      { label: 'N', w: 52, get: (d) => String(d.total) },
      ...(this.state.useShannon ? [{ label: "H′", w: 76, get: (d: DiversityIndex) => d.shannon?.toFixed(3) ?? '—' }] : []),
      ...(this.state.useSimpson ? [{ label: zh ? 'Simpson' : 'Simpson', w: 76, get: (d: DiversityIndex) => d.simpson?.toFixed(3) ?? '—' }] : []),
      ...(this.state.useEvenness ? [{ label: 'J', w: 66, get: (d: DiversityIndex) => d.evenness?.toFixed(3) ?? '—' }] : []),
      { label: zh ? '优势种' : 'dominant', w: 130, get: (d) => (d.dominant ? `${d.dominant} ${(100 * (d.dominantShare ?? 0)).toFixed(0)}%` : '—') },
    ];
    let cx = 16;
    g.fillStyle = 'rgba(150, 165, 185, 0.9)';
    for (const c of cols) {
      g.fillText(c.label, cx, 44);
      cx += c.w;
    }
    const hMax = Math.max(0.001, ...perSite.map((d) => d.shannon ?? 0));
    m.sites.forEach((site, i) => {
      const d = perSite[i]!;
      const y = 64 + i * 22;
      if (y > canvas.height - 60) return;
      let x = 16;
      g.fillStyle = 'rgba(200, 210, 225, 0.95)';
      for (const c of cols) {
        const text = c.label === (zh ? '样地' : 'site') ? site : c.get(d);
        g.fillText(text, x, y);
        x += c.w;
      }
      // H′ bar for quick visual ranking.
      if (d.shannon !== null) {
        g.fillStyle = 'rgba(100, 160, 240, 0.35)';
        g.fillRect(x + 8, y - 9, 70 * (d.shannon / hMax), 12);
      }
    });

    // ---- Stacked abundance bars per site ------------------------------------
    const barTop = canvas.height - 150;
    const barBottom = canvas.height - 44;
    const barX0 = 60;
    const barX1 = canvas.width - 24;
    const plotW = Math.max(barX1 - barX0, 10);
    g.textAlign = 'center';
    g.fillStyle = 'rgba(150, 165, 185, 0.9)';
    g.fillText(zh ? '各样地物种丰度占比（堆叠）' : 'Relative abundance per site (stacked)', canvas.width / 2, barTop - 10);
    const palette = ['#64a0f0', '#40c463', '#e8a33d', '#e05e4b', '#a4764e', '#8fd06a', '#d4c447', '#7ec8e3', '#b08be8', '#e88bb0'];
    const nSites = m.sites.length;
    const bw = Math.min(64, (plotW / nSites) * 0.62);
    m.sites.forEach((site, i) => {
      const total = m.counts[i]!.reduce((a, b) => a + b, 0);
      const bx = barX0 + (plotW * (i + 0.5)) / nSites - bw / 2;
      if (total <= 0) {
        g.fillStyle = 'rgba(150, 165, 185, 0.6)';
        g.fillText(site, bx + bw / 2, barBottom + 14);
        g.fillText('—', bx + bw / 2, (barTop + barBottom) / 2);
        return;
      }
      let yAcc = 0;
      m.counts[i]!.forEach((c, s) => {
        if (c <= 0) return;
        const frac = c / total;
        const segH = (barBottom - barTop) * frac;
        g.fillStyle = palette[s % palette.length]!;
        g.fillRect(bx, barBottom - yAcc - segH, bw, Math.max(segH - 0.5, 0.5));
        yAcc += segH;
      });
      g.fillStyle = 'rgba(150, 165, 185, 0.9)';
      g.fillText(site, bx + bw / 2, barBottom + 14);
    });

    // ---- Cross-site reading --------------------------------------------------
    const ranked = m.sites
      .map((s, i) => ({ site: s, h: perSite[i]!.shannon }))
      .filter((r) => r.h !== null)
      .sort((a, b) => b.h! - a.h!);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(190, 202, 218, 0.95)';
    if (ranked.length >= 2) {
      g.fillText(
        zh
          ? `判读：${ranked[0]!.site} 多样性最高（H′=${ranked[0]!.h!.toFixed(3)}），高于 ${ranked[1]!.site}（H′=${ranked[1]!.h!.toFixed(3)}）`
          : `Reading: ${ranked[0]!.site} has the highest diversity (H′=${ranked[0]!.h!.toFixed(3)}), above ${ranked[1]!.site} (H′=${ranked[1]!.h!.toFixed(3)})`,
        16,
        canvas.height - 10,
      );
    } else if (ranked.length === 1) {
      g.fillText(
        zh ? `仅 ${ranked[0]!.site} 可计算指数（其余样地无个体）` : `Only ${ranked[0]!.site} evaluable (others have no individuals)`,
        16,
        canvas.height - 10,
      );
    }
  }
}

export default function createBiodiversityPlugin(): Plugin {
  return new BiodiversityPlugin();
}
