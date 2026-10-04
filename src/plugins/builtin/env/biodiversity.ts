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
import { diversityIndex, numCell, type DiversityIndex } from './envCore';
import { setScienceOutputs, clearScienceOutputs, fmtMetric, type ScienceMetric } from '@/core/research/scienceOutput';
import { mulberry32, currentSeed } from '@/core/repro/random';
import { actionButton, actionFired, drawEmptyCanvas, exportCanvasPng, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { isZh } from '@/core/plugin-tools/locale';
import { parseDelimited } from '@/core/plugin-tools/table';
import { pushPanelsToFigure, panelTag, panelPlace, GEO_PANEL_WIDTH, GEO_PANEL_HEIGHT, type Bilingual, type GeoFigurePanel } from '../geo/geoFigure';
import { biodiversityManifest } from './biodiversityManifest';

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

// ---- Rarefaction / bootstrap / Chao1 (exported for tests) -------------------

/** Percentile of a sorted array (linear interpolation, type-7). */
function pctlSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * Bias-corrected Chao1 richness estimator: S_obs + f1(f1−1)/(2(f2+1)) with
 * f1/f2 the singleton/doubleton counts. Falls back to S_obs when f1 = 0.
 */
export function chao1(counts: number[]): number | null {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const sObs = counts.filter((c) => c > 0).length;
  const f1 = counts.filter((c) => c === 1).length;
  const f2 = counts.filter((c) => c === 2).length;
  if (f1 === 0) return sObs;
  return sObs + (f1 * (f1 - 1)) / (2 * (f2 + 1));
}

export interface CiInterval {
  low: number;
  high: number;
}

/**
 * Nonparametric bootstrap 95% CI for Shannon H′: resample N individuals
 * with replacement from the empirical relative abundances (multinomial via
 * cumulative-probability search) and take the percentile interval of the
 * resampled H′ values. Deterministic given the seeded rng.
 */
export function shannonBootstrapCi(
  counts: number[],
  opts: { draws?: number; rng: () => number },
): CiInterval | null {
  const total = counts.reduce((a, b) => a + b, 0);
  const sObs = counts.filter((c) => c > 0).length;
  if (total <= 0 || sObs === 0) return null;
  const draws = Math.max(1, opts.draws ?? 200);
  const cum: number[] = [];
  let acc = 0;
  for (const c of counts) {
    acc += c;
    cum.push(acc / total);
  }
  const nSpecies = counts.length;
  const hVals: number[] = [];
  for (let d = 0; d < draws; d += 1) {
    const resampled = new Array<number>(nSpecies).fill(0);
    for (let i = 0; i < total; i += 1) {
      const u = opts.rng();
      let lo = 0;
      let hi = nSpecies - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (u <= cum[mid]!) hi = mid;
        else lo = mid + 1;
      }
      resampled[lo] = (resampled[lo] ?? 0) + 1;
    }
    let h = 0;
    for (const c of resampled) {
      if (c <= 0) continue;
      const p = c / total;
      h -= p * Math.log(p);
    }
    hVals.push(h);
  }
  hVals.sort((a, b) => a - b);
  return { low: pctlSorted(hVals, 0.025), high: pctlSorted(hVals, 0.975) };
}

export interface RarefactionPoint {
  /** Subsample size (individuals). */
  n: number;
  /** Expected distinct species count at n. */
  mean: number;
  /** SD across draws. */
  sd: number;
}

/**
 * Individual-based rarefaction: expected species richness S(n) for random
 * subsamples of n individuals, mean ± SD over `draws` permutations. Each draw
 * performs one full Fisher–Yates shuffle of the individual-level species
 * labels, then a prefix walk counts distinct species at every n at once.
 * Sample sizes are `steps` evenly spaced points from 1 to N (N included).
 */
export function rarefactionCurve(
  counts: number[],
  opts: { draws?: number; steps?: number; rng: () => number },
): RarefactionPoint[] | null {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const draws = Math.max(1, opts.draws ?? 100);
  const labels: number[] = [];
  counts.forEach((c, s) => {
    for (let i = 0; i < c; i += 1) labels.push(s);
  });
  const n = labels.length;
  const nSteps = Math.max(2, Math.min(opts.steps ?? 10, n));
  const stepAt = new Set<number>();
  for (let k = 0; k < nSteps; k += 1) stepAt.add(Math.round(1 + ((n - 1) * k) / (nSteps - 1)));
  stepAt.add(n);
  const sums = new Map<number, { sum: number; sumSq: number }>();
  for (let d = 0; d < draws; d += 1) {
    for (let i = n - 1; i > 0; i -= 1) {
      const j = Math.floor(opts.rng() * (i + 1));
      const t = labels[i]!;
      labels[i] = labels[j]!;
      labels[j] = t;
    }
    const seen = new Set<number>();
    for (let k = 1; k <= n; k += 1) {
      seen.add(labels[k - 1]!);
      if (!stepAt.has(k)) continue;
      const acc2 = sums.get(k) ?? { sum: 0, sumSq: 0 };
      acc2.sum += seen.size;
      acc2.sumSq += seen.size * seen.size;
      sums.set(k, acc2);
    }
  }
  const points: RarefactionPoint[] = [...sums.keys()].sort((a, b) => a - b).map((k) => {
    const acc2 = sums.get(k)!;
    const mean = acc2.sum / draws;
    const variance = Math.max(0, acc2.sumSq / draws - mean * mean);
    return { n: k, mean, sd: Math.sqrt(variance) };
  });
  return points;
}

/** Seeded rng variants bound to the process seed (distinct streams per use). */
function statsRng(salt: number): () => number {
  return mulberry32((currentSeed() ^ salt) >>> 0);
}

const RAREFACTION_DRAWS = 100;
const BOOTSTRAP_DRAWS = 200;

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
      actionButton('exportStats', 'Export stats CSV (Chao1/CI/rarefaction)', '导出统计 CSV（Chao1/CI/稀疏化）'),
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

  // ---- scientific outputs ---------------------------------------------------

  private publishScience(): void {
    const m = this.state.matrix;
    if (!m || m.sites.length === 0) {
      clearScienceOutputs(this.manifest.id);
      return;
    }
    const zh = isZh(this.api.locale);
    const metrics: ScienceMetric[] = [
      {
        key: 'n',
        label: 'N sites × species',
        value: `${m.sites.length} × ${m.species.length}`,
        hint: zh ? '载入样地数 × 物种数' : 'loaded sites × species',
      },
    ];
    for (let i = 0; i < m.sites.length; i += 1) {
      const site = m.sites[i]!;
      const counts = m.counts[i]!;
      const d = diversityIndex(counts, m.species);
      if (d.total <= 0 || d.richness === 0) continue;
      // Chao1 estimated richness vs observed.
      const ch = chao1(counts);
      if (ch !== null) {
        metrics.push({
          key: `chao1_${i}`,
          label: `CHAO1 ${site}`,
          value: fmtMetric(ch),
          hint: zh
            ? `偏差修正 Chao1 丰富度估计（观测 S=${d.richness}）`
            : `bias-corrected Chao1 richness estimate (observed S=${d.richness})`,
        });
      }
      // Shannon bootstrap 95% CI.
      if (d.shannon !== null) {
        const ci = shannonBootstrapCi(counts, { draws: BOOTSTRAP_DRAWS, rng: statsRng(0x5eed0001) });
        if (ci) {
          metrics.push({
            key: `hci_${i}`,
            label: `H'95CI ${site}`,
            value: `[${fmtMetric(ci.low, 3)}, ${fmtMetric(ci.high, 3)}]`,
            hint: zh
              ? `Shannon H′ 的 bootstrap 95% 置信区间（${BOOTSTRAP_DRAWS} 次有放回重抽样）`
              : `bootstrap 95% CI of Shannon H′ (${BOOTSTRAP_DRAWS} resamples with replacement)`,
          });
        }
      }
      // Rarefaction: expected richness at half sampling, mean ± SD.
      const rare = rarefactionCurve(counts, { draws: RAREFACTION_DRAWS, rng: statsRng(0x5eed0002) });
      if (rare && rare.length >= 2) {
        const half = rare[Math.floor(rare.length / 2) - 1]!;
        metrics.push({
          key: `rare_${i}`,
          label: `RAREF ${site}`,
          value: `${fmtMetric(half.mean, 2)}±${fmtMetric(half.sd, 2)} @n=${half.n}`,
          hint: zh
            ? `个体稀疏化：抽取 ${half.n} 个个体的期望物种数（${RAREFACTION_DRAWS} 次均值±SD）`
            : `individual rarefaction: expected species at n=${half.n} individuals (mean±SD over ${RAREFACTION_DRAWS} draws)`,
        });
      }
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  /** Statistics CSV: per-site Chao1, Shannon CI and the full rarefaction curve. */
  private exportStatsCsv(): void {
    const m = this.state.matrix;
    if (!m) {
      notify(this.api, 'warning', 'No data to export yet.', '暂无可导出的数据。');
      return;
    }
    const header = ['site', 'S_observed', 'N_individuals', 'chao1', 'shannon_ci_low', 'shannon_ci_high', 'rare_n_half', 'rare_mean', 'rare_sd'];
    const rows: string[][] = [];
    for (let i = 0; i < m.sites.length; i += 1) {
      const site = m.sites[i]!;
      const counts = m.counts[i]!;
      const d = diversityIndex(counts, m.species);
      if (d.total <= 0 || d.richness === 0) continue;
      const ch = chao1(counts);
      const ci = d.shannon !== null ? shannonBootstrapCi(counts, { draws: BOOTSTRAP_DRAWS, rng: statsRng(0x5eed0001) }) : null;
      const rare = rarefactionCurve(counts, { draws: RAREFACTION_DRAWS, rng: statsRng(0x5eed0002) });
      const half = rare && rare.length >= 2 ? rare[Math.floor(rare.length / 2) - 1]! : null;
      rows.push([
        site,
        String(d.richness),
        String(d.total),
        ch?.toFixed(3) ?? '',
        ci ? ci.low.toFixed(4) : '',
        ci ? ci.high.toFixed(4) : '',
        half ? String(half.n) : '',
        half ? half.mean.toFixed(3) : '',
        half ? half.sd.toFixed(3) : '',
      ]);
    }
    // Rarefaction curve of the first evaluable site as a second block.
    const first = m.counts.findIndex((c) => diversityIndex(c, m.species).total > 0);
    if (first >= 0) {
      const rare = rarefactionCurve(m.counts[first]!, { draws: RAREFACTION_DRAWS, rng: statsRng(0x5eed0002) });
      if (rare) {
        rows.push([]);
        rows.push([`rarefaction_curve:${m.sites[first]!}`, 'n', 'mean_S', 'sd']);
        for (const p of rare) rows.push(['', String(p.n), p.mean.toFixed(3), p.sd.toFixed(3)]);
      }
    }
    exportRowsCsv(this.api, 'env-biodiversity-stats', header, rows);
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const zh = isZh(this.api.locale);
    if (!this.state.matrix) {
      clearScienceOutputs(this.manifest.id);
      drawEmptyCanvas(this.api, canvas, {
        title: zh ? '生物多样性指数' : 'Biodiversity Indices',
        hintZh: '拖入或从「示例数据」载入丰度矩阵 CSV（species,site_1,…,site_n）',
        hint: 'Drop an abundance matrix CSV (species,site_1,…,site_n) via the sample bar.',
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
    // The band claims the vertical span between the table and the footnote
    // (capped, then centered in that span) so tall viewports don't leave a
    // dead void in the middle of the canvas.
    const nSites = m.sites.length;
    const tableBottom = 64 + nSites * 22;
    const footnoteTop = canvas.height - 40;
    const bandH = Math.min(360, Math.max(90, footnoteTop - tableBottom - 70));
    const bandCenter = (tableBottom + 34 + footnoteTop) / 2;
    const barTop = bandCenter - bandH / 2;
    const barBottom = bandCenter + bandH / 2;
    const barX0 = 60;
    const barX1 = canvas.width - 24;
    const plotW = Math.max(barX1 - barX0, 10);
    g.textAlign = 'center';
    g.fillStyle = 'rgba(150, 165, 185, 0.9)';
    g.fillText(zh ? '各样地物种丰度占比（堆叠）' : 'Relative abundance per site (stacked)', canvas.width / 2, barTop - 12);
    const palette = ['#64a0f0', '#40c463', '#e8a33d', '#e05e4b', '#a4764e', '#8fd06a', '#d4c447', '#7ec8e3', '#b08be8', '#e88bb0'];
    const bw = Math.max(40, Math.min(120, (plotW / nSites) * 0.5));
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
        // In-bar share label fills the taller band with readable content.
        if (bw >= 48 && segH >= 16 && frac >= 0.06) {
          g.fillStyle = 'rgba(10, 14, 19, 0.82)';
          g.fillText(`${Math.round(frac * 100)}%`, bx + bw / 2, barBottom - yAcc - segH / 2 + 4);
        }
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
