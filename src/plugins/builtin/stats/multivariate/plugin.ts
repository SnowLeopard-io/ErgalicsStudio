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

function defaultData(): string {
  let seed = 424242;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gauss = (): number => {
    const u = Math.max(1e-12, rand());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const rows = ['id,speed,height,width,mass,species'];
  const centres = [
    { c: [3.2, 4.1, 2.2, 3.7], name: 'setosa' },
    { c: [6.4, 2.3, 4.8, 6.1], name: 'versicolor' },
    { c: [8.1, 7.4, 6.3, 8.2], name: 'virginica' },
  ];
  let id = 1;
  for (const centre of centres) {
    for (let i = 0; i < 18; i += 1) {
      const vals = centre.c.map((m) => (m + 0.55 * gauss()).toFixed(3));
      rows.push(`${id++},${vals.join(',')},${centre.name}`);
    }
  }
  return rows.join('\n');
}

type MvView = 'pca' | 'cluster' | 'lda';

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
    super(statsMultivariateManifest, { view: 'pca', clusters: 3, eps: 1.2, minPts: 3, standardize: true }, defaultData());
  }

  protected stateParams(): ParamDefinition[] {
    return [
      this.select('view', 'View', '视图', this.state.view, [
        { value: 'pca', en: 'PCA biplot', zh: 'PCA 双标图' },
        { value: 'cluster', en: 'Clustering', zh: '聚类' },
        { value: 'lda', en: 'Discriminant', zh: '判别分析' },
      ]),
      this.rangeParam('clusters', 'Clusters k', '聚类数 k', this.state.clusters, 2, 8, 1),
      this.rangeParam('eps', 'DBSCAN ε', 'DBSCAN 邻域 ε', this.state.eps, 0.2, 5, 0.1),
      this.rangeParam('minPts', 'DBSCAN minPts', 'DBSCAN 最小点数', this.state.minPts, 2, 12, 1),
      this.checkParam('standardize', 'Standardise variables', '变量标准化', this.state.standardize),
    ];
  }

  protected updateState(params: Record<string, unknown>): boolean {
    let dirty = false;
    if ((params.view === 'pca' || params.view === 'cluster' || params.view === 'lda') && params.view !== this.state.view) {
      this.state.view = params.view;
      dirty = true;
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
        hint: result.dbscanResult ? (this.zh ? `ε=${this.state.eps}，minPts=${this.state.minPts}` : `ε=${this.state.eps}, minPts=${this.state.minPts}`) : '—',
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

  protected figurePanels(result: MvResult): FigurePanelSpec[] {
    return multivariateFigurePanels(result, this.state.view);
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

  protected subtitle(): string {
    const data = parseMultivariate(this.text);
    return this.zh
      ? `${data.x.length} 个观测 · ${data.variables.length} 个数值变量${data.groupName ? ` · 分组 ${data.groupName}` : ''}`
      : `${data.x.length} observations · ${data.variables.length} numeric variables${data.groupName ? ` · group ${data.groupName}` : ''}`;
  }

  protected footnote(): string {
    return this.zh
      ? '左：PC1–PC2 得分双标图（箭头为载荷）；右：解释方差碎石图。聚类视图按 k-means 标签着色。'
      : 'Left: PC1–PC2 score biplot with loading arrows; right: explained-variance scree. The clustering view colours points by k-means label.';
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
    const scatter = plotBox(w * 0.68, h, 64, 78, 26, 52);
    const scoreX = pcaRes.scores.map((s) => s[0] ?? 0);
    const scoreY = pcaRes.scores.map((s) => s[1] ?? 0);
    const arrowX = pcaRes.loadings.map((l) => l[0] ?? 0);
    const arrowY = pcaRes.loadings.map((l) => l[1] ?? 0);
    const maxScore = Math.max(1, ...scoreX.map(Math.abs), ...scoreY.map(Math.abs));
    const maxArrow = Math.max(0.5, ...arrowX.map(Math.abs), ...arrowY.map(Math.abs));
    const xs = xScale(scatter, -maxScore, maxScore);
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

    const labels = this.state.view === 'cluster' ? result.kmeans?.labels ?? [] : [];
    const groupLabels = result.data.groups;
    const palette: string[] = [CS.blue, CS.amber, CS.green, CS.violet, CS.pink, CS.cyan, CS.red];
    const classes = this.state.view === 'lda' && groupLabels ? [...new Set(groupLabels)].sort() : [];
    pcaRes.scores.forEach((_s, i) => {
      let color: string = CS.blue;
      if (this.state.view === 'cluster') color = palette[(labels[i] ?? 0) % palette.length]!;
      if (this.state.view === 'lda' && groupLabels) {
        const idx = classes.indexOf(groupLabels[i]!);
        color = palette[(idx < 0 ? 0 : idx) % palette.length]!;
      }
      g.fillStyle = color;
      g.beginPath();
      g.arc(xs(scoreX[i]!), ys(scoreY[i]!), 3.4, 0, Math.PI * 2);
      g.fill();
    });

    const scaleArrow = (scatter.w / 3.4) / maxArrow;
    pcaRes.loadings.forEach((l, i) => {
      const ax = xs(0) + (l[0] ?? 0) * scaleArrow * Math.sign(maxScore / maxArrow);
      const ay = ys(0) - (l[1] ?? 0) * scaleArrow * Math.sign(maxScore / maxArrow);
      g.strokeStyle = 'rgba(250,200,110,0.85)';
      g.beginPath();
      g.moveTo(xs(0), ys(0));
      g.lineTo(ax, ay);
      g.stroke();
      g.fillStyle = CS.amber;
      g.font = font(this.zh, 9);
      g.textAlign = 'left';
      g.fillText(result.data.variables[i] ?? '', ax + 3, ay);
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
    const tableTop = Math.round(h * 0.56);
    drawCard(g, 24, tableTop - 14, w - 48, h - tableTop - 26);
    const rows: Array<Array<string | number>> = [
      ['PC1', `${fmt(pcaRes.explained[0]! * 100, 2)}%`, `${fmt(pcaRes.cumulative[0]! * 100, 2)}%`],
      ['PC2', `${fmt(pcaRes.explained[1]! * 100, 2)}%`, `${fmt(pcaRes.cumulative[1]! * 100, 2)}%`],
      ['k-means', `k=${result.kmeans?.k ?? 0}`, `silhouette ${fmt(result.kmeans?.silhouette ?? NaN, 3)}`],
      ['Ward', `k=${result.ward?.k ?? 0}`, `WSS ${fmt(result.ward?.wss ?? NaN, 2)}`],
      ['DBSCAN', `${result.dbscanResult?.k ?? 0} clusters`, `ε=${this.state.eps}, minPts=${this.state.minPts}`],
      ['LDA', result.lda ? `${fmt(result.lda.accuracy * 100, 1)}%` : '—', result.lda ? `λ=${fmt(result.lda.wilks, 4)}` : 'no group column'],
      ['Outliers', String(result.outliers?.flagged.length ?? 0), `χ².975=${fmt(result.outliers?.threshold ?? NaN, 2)}`],
    ];
    drawTable(g, w, h, [this.zh ? '模型' : 'model', this.zh ? '统计量' : 'statistic', this.zh ? '诊断' : 'diagnostic'], rows, {
      top: tableTop,
      rowHeight: 16,
    });
    void drawLegend;
  }
}

export default function createStatsMultivariatePlugin(): StatsMultivariatePlugin {
  return new StatsMultivariatePlugin();
}
