// ==========================================================================
// Multivariate Analysis plugin
//
// Canvas: a PCA biplot of the first two components (scores coloured by the
// active clustering / group labels, loadings drawn as arrows) with an
// explained-variance scree on the right. A summary table reports the model
// diagnostics for the selected view.
// ==========================================================================

import type { ParamDefinition } from '@/types/plugin';
import type { ScienceMetric } from '@/core/research/scienceOutput';
import type { FigurePanelSpec } from '@/core/figure/sheet';
import { CS, drawCard, drawLegend, drawTable, font, plotBox } from '../../shared/cs-utils';
import { fmt, xScale, yScale } from '../../shared/stats-utils';
import { StatsPluginBase, type BenchRow, type CsvPayload } from '../shared/plugin-base';
import { statsMultivariateManifest } from './manifest';
import {
  canonicalCorrelation,
  dbscan,
  discriminant,
  factorAnalysis,
  hierarchicalCluster,
  kmeans,
  mahalanobisOutliers,
  parseMultivariate,
  pca,
  runMultivariateBenchmark,
  type CcaResult,
  type ClusterResult,
  type DiscriminantResult,
  type FactorResult,
  type MultiDataset,
  type OutlierResult,
  type PcaResult,
} from './kernel';
import { multivariateFigurePanels } from './figure';

type MvView = 'pca' | 'kmeans' | 'ward' | 'dbscan' | 'lda';

const MV_VIEWS: MvView[] = ['pca', 'kmeans', 'ward', 'dbscan', 'lda'];

interface MvState {
  view: MvView;
  clusters: number;
  eps: number;
  minPts: number;
  standardize: boolean;
}

export interface MvResult {
  data: MultiDataset;
  pca: PcaResult | null;
  factors: FactorResult | null;
  kmeans: ClusterResult | null;
  ward: ClusterResult | null;
  dbscanResult: ClusterResult | null;
  lda: DiscriminantResult | null;
  cca: CcaResult | null;
  outliers: OutlierResult | null;
}

export class StatsMultivariatePlugin extends StatsPluginBase<MvState, MvResult> {
  constructor() {
    // Data plugins start empty — no bundled sample. The canvas shows an
    // import hint until a dataset is loaded.
    super(statsMultivariateManifest, { view: 'pca', clusters: 3, eps: 1.2, minPts: 3, standardize: true }, '');
  }

  protected emptyStateHint(): string {
    return this.zh
      ? '请导入数值列 + 可选 id / group 列的 CSV / TSV 数据（至少 3 行 × 2 个数值变量）。\n可通过「数据」模式或项目文件列表将数据载入到本插件。'
      : 'Import a CSV / TSV dataset with numeric columns plus optional id / group (>= 3 rows × 2 variables).\nUse the Data mode or load a file into this plugin from the file list.';
  }

  protected stateParams(): ParamDefinition[] {
    return [
      this.select('view', 'View', '视图', this.state.view, [
        { value: 'pca', en: 'PCA biplot', zh: 'PCA 双标图' },
        { value: 'kmeans', en: 'k-means clusters', zh: 'k-means 聚类' },
        { value: 'ward', en: 'Ward clusters', zh: 'Ward 聚类' },
        { value: 'dbscan', en: 'DBSCAN clusters', zh: 'DBSCAN 聚类' },
        { value: 'lda', en: 'Discriminant (LDA)', zh: '判别分析（LDA）' },
      ]),
      {
        ...this.rangeParam('clusters', 'Clusters k', '聚类数 k', this.state.clusters, 2, 8, 1),
        visibleWhen: { key: 'view', in: ['kmeans', 'ward'] },
      },
      {
        ...this.rangeParam('eps', 'DBSCAN ε', 'DBSCAN 邻域 ε', this.state.eps, 0.2, 5, 0.1),
        visibleWhen: { key: 'view', in: ['dbscan'] },
      },
      {
        ...this.rangeParam('minPts', 'DBSCAN minPts', 'DBSCAN 最小点数', this.state.minPts, 2, 12, 1),
        visibleWhen: { key: 'view', in: ['dbscan'] },
      },
      {
        ...this.checkParam('standardize', 'Standardise variables', '变量标准化', this.state.standardize),
        hint: this.zh
          ? '仅影响 PCA 双标图的坐标与载荷'
          : 'Affects the PCA biplot coordinates and loadings only',
      },
    ];
  }

  protected updateState(params: Record<string, unknown>): boolean {
    let dirty = false;
    if (typeof params.view === 'string') {
      // Projects saved before the per-method views used `cluster`; migrate it
      // to k-means so restoring an old workspace does not blank the canvas.
      const view = (params.view === 'cluster' ? 'kmeans' : params.view) as MvView;
      if (MV_VIEWS.includes(view) && view !== this.state.view) {
        this.state.view = view;
        dirty = true;
      }
    }
    if (typeof params.clusters === 'number' && Number.isFinite(params.clusters)) {
      const k = Math.min(8, Math.max(2, Math.round(params.clusters)));
      if (k !== this.state.clusters) {
        this.state.clusters = k;
        dirty = true;
      }
    }
    if (typeof params.eps === 'number' && Number.isFinite(params.eps)) {
      const eps = Math.min(5, Math.max(0.1, params.eps));
      if (eps !== this.state.eps) {
        this.state.eps = eps;
        dirty = true;
      }
    }
    if (typeof params.minPts === 'number' && Number.isFinite(params.minPts)) {
      const minPts = Math.min(12, Math.max(2, Math.round(params.minPts)));
      if (minPts !== this.state.minPts) {
        this.state.minPts = minPts;
        dirty = true;
      }
    }
    if (typeof params.standardize === 'boolean' && params.standardize !== this.state.standardize) {
      this.state.standardize = params.standardize;
      dirty = true;
    }
    return dirty;
  }

  protected computeResult(): MvResult | null {
    const data = parseMultivariate(this.text);
    if (data.x.length < 3 || data.variables.length < 2) return null;
    const model = pca(data.x, this.state.standardize);
    const groups = data.groups;
    const y = groups ? groups : null;
    const p = data.variables.length;
    const cca = p >= 4
      ? canonicalCorrelation(
          data.x.map((row) => row.slice(0, Math.floor(p / 2))),
          data.x.map((row) => row.slice(Math.floor(p / 2))),
        )
      : null;
    return {
      data,
      pca: model,
      factors: factorAnalysis(data.x, Math.min(3, Math.max(2, this.state.clusters - 1))),
      kmeans: kmeans(data.x, this.state.clusters, 7),
      ward: hierarchicalCluster(data.x, this.state.clusters),
      dbscanResult: dbscan(data.x, this.state.eps, this.state.minPts),
      lda: y ? discriminant(data.x, y, 'lda') : null,
      cca,
      outliers: mahalanobisOutliers(data.x, 0.975),
    };
  }

  protected metrics(result: MvResult): ScienceMetric[] {
    const pcaRes = result.pca;
    const kmeansRes = result.kmeans;
    const lda = result.lda;
    const noiseCount = result.dbscanResult ? result.dbscanResult.labels.filter((l) => l < 0).length : 0;
    return [
      {
        key: 'pc1',
        label: this.zh ? 'PC1 方差占比' : 'PC1 variance',
        value: pcaRes ? `${fmt(pcaRes.explained[0]! * 100, 2)}%` : '—',
        severity: pcaRes && pcaRes.explained[0]! > 0.5 ? 'ok' : 'info',
        hint: pcaRes ? (this.zh ? `前两主成分累计 ${fmt(pcaRes.cumulative[1]! * 100, 2)}%` : `first two components ${fmt(pcaRes.cumulative[1]! * 100, 2)}%`) : '—',
      },
      {
        key: 'kmeans-silhouette',
        label: this.zh ? 'k-means 轮廓系数' : 'k-means silhouette',
        value: kmeansRes ? fmt(kmeansRes.silhouette, 4) : '—',
        severity: kmeansRes && kmeansRes.silhouette > 0.5 ? 'ok' : kmeansRes && kmeansRes.silhouette > 0.25 ? 'warn' : 'info',
        hint: kmeansRes ? `k=${kmeansRes.k} · WSS=${fmt(kmeansRes.wss, 2)}` : '—',
      },
      {
        key: 'ward-wss',
        label: this.zh ? 'Ward 簇内平方和' : 'Ward WSS',
        value: result.ward ? fmt(result.ward.wss, 2) : '—',
        hint: result.ward ? (this.zh ? `轮廓系数 ${fmt(result.ward.silhouette, 4)}` : `silhouette ${fmt(result.ward.silhouette, 4)}`) : '—',
      },
      {
        key: 'dbscan',
        label: this.zh ? 'DBSCAN 聚类数' : 'DBSCAN clusters',
        value: result.dbscanResult ? String(result.dbscanResult.k) : '—',
        hint: result.dbscanResult
          ? (this.zh
              ? `ε=${this.state.eps}，minPts=${this.state.minPts}，噪声 ${noiseCount} 点`
              : `ε=${this.state.eps}, minPts=${this.state.minPts}, ${noiseCount} noise points`)
          : '—',
      },
      {
        key: 'lda-accuracy',
        label: this.zh ? 'LDA 回代准确率' : 'LDA accuracy',
        value: lda ? `${fmt(lda.accuracy * 100, 2)}%` : '—',
        severity: lda && lda.accuracy > 0.9 ? 'ok' : 'info',
        hint: lda ? `Wilks λ=${fmt(lda.wilks, 4)} · p=${fmt(lda.p, 4)}` : (this.zh ? '需要 group 列' : 'needs a group column'),
      },
      {
        key: 'cca',
        label: this.zh ? '第一典型相关' : 'First canonical r',
        value: result.cca ? fmt(result.cca.correlations[0]!, 4) : '—',
        hint: result.cca ? (this.zh ? '前一半变量 vs 后一半变量' : 'first half vs second half of variables') : '—',
      },
      {
        key: 'outliers',
        label: this.zh ? '马氏距离异常点' : 'Mahalanobis outliers',
        value: result.outliers ? String(result.outliers.flagged.length) : '—',
        severity: result.outliers && result.outliers.flagged.length === 0 ? 'ok' : 'warn',
        hint: result.outliers ? `χ².975 = ${fmt(result.outliers.threshold, 3)}` : '—',
      },
    ];
  }

  protected benchmark(): BenchRow[] {
    return runMultivariateBenchmark().map((b) => ({
      id: b.id,
      labelEn: b.id === 'pca-pc1' ? 'PC1 variance share' : b.id === 'kmeans-separation' ? 'k-means separation' : 'LDA resubstitution',
      labelZh: b.id === 'pca-pc1' ? 'PC1 方差占比' : b.id === 'kmeans-separation' ? 'k-means 分离度' : 'LDA 回代准确率',
      passed: b.passed,
      value: fmt(b.relErr, 6),
      detail: b.detail,
    }));
  }

  protected csv(result: MvResult): CsvPayload {
    const pcaRes = result.pca;
    return {
      name: 'multivariate-pca',
      header: ['variable', 'PC1 loading', 'PC2 loading', 'communality'],
      rows: pcaRes
        ? result.data.variables.map((v, i) => [
            v,
            pcaRes.loadings[i]?.[0] ?? '',
            pcaRes.loadings[i]?.[1] ?? '',
            (pcaRes.loadings[i]?.[0] ?? 0) ** 2 + (pcaRes.loadings[i]?.[1] ?? 0) ** 2,
          ])
        : [],
    };
  }

  /** Clustering result currently visualised by the selected view. */
  private activeClusters(result: MvResult): ClusterResult | null {
    if (this.state.view === 'kmeans') return result.kmeans;
    if (this.state.view === 'ward') return result.ward;
    if (this.state.view === 'dbscan') return result.dbscanResult;
    return null;
  }

  protected figurePanels(result: MvResult): FigurePanelSpec[] {
    const kind = this.state.view === 'lda' ? 'lda' : this.activeClusters(result) ? 'cluster' : 'pca';
    return multivariateFigurePanels(result, kind, this.activeClusters(result)?.labels ?? null);
  }

  protected figureTitle() {
    return { zh: '多元统计 · PCA 与聚类', en: 'Multivariate Analysis · PCA & Clustering' };
  }

  protected figureCaption(result: MvResult) {
    return {
      zh: `多元分析（n=${result.data.x.length}，p=${result.data.variables.length}）：PC1=${fmt((result.pca?.explained[0] ?? 0) * 100, 2)}%，前两主成分 ${fmt((result.pca?.cumulative[1] ?? 0) * 100, 2)}%；k-means 轮廓系数 ${fmt(result.kmeans?.silhouette ?? NaN, 4)}；马氏距离异常点 ${result.outliers?.flagged.length ?? 0} 个。`,
      en: `Multivariate analysis (n=${result.data.x.length}, p=${result.data.variables.length}): PC1=${fmt((result.pca?.explained[0] ?? 0) * 100, 2)}%, first two components ${fmt((result.pca?.cumulative[1] ?? 0) * 100, 2)}%; k-means silhouette ${fmt(result.kmeans?.silhouette ?? NaN, 4)}; ${result.outliers?.flagged.length ?? 0} Mahalanobis outliers.`,
    };
  }

  protected title(): string {
    return this.zh ? '多元统计分析' : 'Multivariate Analysis';
  }

  private viewLabel(): string {
    const labels: Record<MvView, [string, string]> = {
      pca: ['PCA 双标图', 'PCA biplot'],
      kmeans: ['k-means 聚类', 'k-means clusters'],
      ward: ['Ward 聚类', 'Ward clusters'],
      dbscan: ['DBSCAN 聚类', 'DBSCAN clusters'],
      lda: ['判别分析（LDA）', 'Discriminant (LDA)'],
    };
    const pair = labels[this.state.view];
    return this.zh ? pair[0] : pair[1];
  }

  protected subtitle(): string {
    const data = parseMultivariate(this.text);
    const base = this.zh
      ? `${data.x.length} 个观测 · ${data.variables.length} 个数值变量${data.groupName ? ` · 分组 ${data.groupName}` : ''}`
      : `${data.x.length} observations · ${data.variables.length} numeric variables${data.groupName ? ` · group ${data.groupName}` : ''}`;
    return `${base} · ${this.viewLabel()}`;
  }

  protected footnote(): string {
    const hint = this.zh
      ? '左：PC1–PC2 得分双标图（箭头为载荷）；右：解释方差碎石图。'
      : 'Left: PC1–PC2 score biplot with loading arrows; right: explained-variance scree. ';
    return this.zh
      ? `${hint}当前按「${this.viewLabel()}」着色。`
      : `${hint}Points are coloured by ${this.viewLabel()}.`;
  }

  protected drawBody(g: CanvasRenderingContext2D, w: number, h: number, result: MvResult | null): void {
    if (!result || !result.pca) {
      g.fillStyle = CS.dim;
      g.font = font(this.zh, 12);
      g.textAlign = 'center';
      g.fillText(this.zh ? '至少需要 3 行 × 2 个数值变量。' : 'Need at least 3 rows × 2 numeric variables.', w / 2, h / 2);
      return;
    }
    const pcaRes = result.pca;
    // Stop the biplot just above the summary table and use the freed space:
    // the old bottom margin (0.54·h) ended the box at 0.46·h, squashing the
    // scores into a short band with a dead gap above the table.
    const tableTop = Math.round(h * 0.56);
    const scatter = plotBox(w * 0.68, h, 64, 78, 26, h - tableTop + 14);
    const scoreX = pcaRes.scores.map((s) => s[0] ?? 0);
    const scoreY = pcaRes.scores.map((s) => s[1] ?? 0);
    const maxScore = Math.max(1, ...scoreX.map(Math.abs), ...scoreY.map(Math.abs));
    // Widen the x domain by the box aspect so both axes carry the same
    // pixels-per-unit — a square PC space must not render stretched.
    const aspect = scatter.w / Math.max(1, scatter.h);
    const xs = xScale(scatter, -maxScore * aspect, maxScore * aspect);
    const ys = yScale(scatter, -maxScore, maxScore);

    g.strokeStyle = CS.axis;
    g.strokeRect(scatter.x0, scatter.y0, scatter.w, scatter.h);
    g.strokeStyle = CS.grid;
    g.beginPath();
    g.moveTo(scatter.x0, ys(0));
    g.lineTo(scatter.x1, ys(0));
    g.moveTo(xs(0), scatter.y0);
    g.lineTo(xs(0), scatter.y1);
    g.stroke();

    const active = this.activeClusters(result);
    const labels = active?.labels ?? [];
    const clusterView = active !== null;
    const groupLabels = result.data.groups;
    const palette: string[] = [CS.blue, CS.amber, CS.green, CS.violet, CS.pink, CS.cyan, CS.red];
    const classes = this.state.view === 'lda' && groupLabels ? [...new Set(groupLabels)].sort() : [];
    pcaRes.scores.forEach((_s, i) => {
      let color: string = CS.blue;
      if (clusterView) {
        const label = labels[i] ?? 0;
        // DBSCAN noise (-1) gets a muted colour so it is distinct from cluster 0.
        color = label < 0 ? CS.faint : palette[label % palette.length]!;
      }
      if (this.state.view === 'lda' && groupLabels) {
        const idx = classes.indexOf(groupLabels[i]!);
        color = palette[(idx < 0 ? 0 : idx) % palette.length]!;
      }
      g.fillStyle = color;
      g.beginPath();
      g.arc(xs(scoreX[i]!), ys(scoreY[i]!), 3.4, 0, Math.PI * 2);
      g.fill();
    });

    // Loading arrows: uniform radial pixel scale so the longest arrow reaches
    // R from the origin and every arrow keeps its true direction. Labels sit
    // just past the tip, are clamped inside the frame and nudged apart so
    // same-direction variables (e.g. two arrows into one corner) cannot
    // overlap.
    const cx = xs(0);
    const cy = ys(0);
    const arrowR = Math.min(scatter.w, scatter.h) * 0.42;
    const maxLen = Math.max(1e-9, ...pcaRes.loadings.map((l) => Math.hypot(l[0] ?? 0, l[1] ?? 0)));
    interface ArrowLabel {
      text: string;
      x: number;
      y: number;
      w: number;
      align: CanvasTextAlign;
    }
    const arrowLabels: ArrowLabel[] = [];
    g.font = font(this.zh, 9);
    pcaRes.loadings.forEach((l, i) => {
      const lx = (l[0] ?? 0) / maxLen;
      const ly = (l[1] ?? 0) / maxLen;
      const ax = cx + lx * arrowR;
      const ay = cy - ly * arrowR;
      g.strokeStyle = 'rgba(250,200,110,0.85)';
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(ax, ay);
      g.stroke();
      const text = result.data.variables[i] ?? '';
      const tw = g.measureText(text).width;
      const align: CanvasTextAlign = lx >= 0 ? 'left' : 'right';
      let tx = ax + (lx >= 0 ? 4 : -4);
      let ty = ay - ly * 8 + 3;
      if (align === 'left') tx = Math.min(tx, scatter.x1 - tw - 2);
      else tx = Math.max(tx, scatter.x0 + tw + 2);
      ty = Math.min(Math.max(ty, scatter.y0 + 9), scatter.y1 - 4);
      arrowLabels.push({ text, x: tx, y: ty, w: tw, align });
    });
    // Vertical relaxation so near-coincident tips no longer print on top of
    // each other.
    arrowLabels.sort((a, b) => a.y - b.y);
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = 1; i < arrowLabels.length; i += 1) {
        const prev = arrowLabels[i - 1]!;
        const cur = arrowLabels[i]!;
        const xOverlap = Math.abs(cur.x - prev.x) < Math.max(cur.w, prev.w);
        if (xOverlap && cur.y - prev.y < 11) {
          const push = (11 - (cur.y - prev.y)) / 2;
          cur.y += push;
          prev.y -= push;
        }
      }
    }
    arrowLabels.forEach((b) => {
      b.y = Math.min(Math.max(b.y, scatter.y0 + 9), scatter.y1 - 4);
      g.fillStyle = CS.amber;
      g.font = font(this.zh, 9);
      g.textAlign = b.align;
      g.fillText(b.text, b.x, b.y);
    });
    g.fillStyle = CS.dim;
    g.font = font(false, 10);
    g.textAlign = 'center';
    g.fillText(`PC1 (${fmt(pcaRes.explained[0]! * 100, 1)}%)`, (scatter.x0 + scatter.x1) / 2, scatter.y1 + 18);
    g.save();
    g.translate(16, (scatter.y0 + scatter.y1) / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(`PC2 (${fmt(pcaRes.explained[1]! * 100, 1)}%)`, 0, 0);
    g.restore();

    // Scree panel.
    const scree = { x0: Math.round(w * 0.72), y0: 78, x1: w - 30, y1: Math.round(h * 0.45) };
    scree.x1 = Math.max(scree.x0 + 40, scree.x1);
    const screeW = scree.x1 - scree.x0;
    const screeH = scree.y1 - scree.y0;
    g.strokeStyle = CS.axis;
    g.strokeRect(scree.x0, scree.y0, screeW, screeH);
    const count = Math.min(6, pcaRes.explained.length);
    const barW = screeW / Math.max(1, count);
    pcaRes.explained.slice(0, count).forEach((v, i) => {
      const bh = screeH * v;
      g.fillStyle = 'rgba(120,200,255,0.7)';
      g.fillRect(scree.x0 + i * barW + 2, scree.y1 - bh, barW - 4, bh);
      g.fillStyle = CS.faint;
      g.font = font(false, 8);
      g.textAlign = 'center';
      g.fillText(`${i + 1}`, scree.x0 + i * barW + barW / 2, scree.y1 + 11);
    });
    g.fillStyle = CS.dim;
    g.font = font(this.zh, 10, '600');
    g.textAlign = 'left';
    g.fillText(this.zh ? '解释方差' : 'explained variance', scree.x0, scree.y0 - 6);

    // Model summary table.
    drawCard(g, 24, tableTop - 14, w - 48, h - tableTop - 26);
    const rows: Array<Array<string | number>> = [
      ['PC1', `${fmt(pcaRes.explained[0]! * 100, 2)}%`, `${fmt(pcaRes.cumulative[0]! * 100, 2)}%`],
      ['PC2', `${fmt(pcaRes.explained[1]! * 100, 2)}%`, `${fmt(pcaRes.cumulative[1]! * 100, 2)}%`],
      ['k-means', `k=${result.kmeans?.k ?? 0}`, `silhouette ${fmt(result.kmeans?.silhouette ?? NaN, 3)}`],
      ['Ward', `k=${result.ward?.k ?? 0}`, `WSS ${fmt(result.ward?.wss ?? NaN, 2)}`],
      [
        'DBSCAN',
        `${result.dbscanResult?.k ?? 0} ${this.zh ? '簇' : 'clusters'}`,
        `${this.zh ? '噪声' : 'noise'} ${result.dbscanResult?.labels.filter((l) => l < 0).length ?? 0}`,
      ],
      ['LDA', result.lda ? `${fmt(result.lda.accuracy * 100, 1)}%` : '—', result.lda ? `λ=${fmt(result.lda.wilks, 4)}` : 'no group column'],
      ['Outliers', String(result.outliers?.flagged.length ?? 0), `χ².975=${fmt(result.outliers?.threshold ?? NaN, 2)}`],
    ];
    const highlight =
      this.state.view === 'kmeans' ? 2 : this.state.view === 'ward' ? 3 : this.state.view === 'dbscan' ? 4 : this.state.view === 'lda' ? 5 : 0;
    drawTable(g, w, h, [this.zh ? '模型' : 'model', this.zh ? '统计量' : 'statistic', this.zh ? '诊断' : 'diagnostic'], rows, {
      top: tableTop,
      rowHeight: 16,
      highlight,
    });
    void drawLegend;
  }
}

export default function createStatsMultivariatePlugin(): StatsMultivariatePlugin {
  return new StatsMultivariatePlugin();
}
