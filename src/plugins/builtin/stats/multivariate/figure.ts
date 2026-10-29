// Multivariate — Figure Studio panels: PCA biplot and explained-variance
// scree, with the loading arrows drawn as line series from the origin.
import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_HEIGHT,
  FIGURE_PANEL_WIDTH,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { MultiDataset, PcaResult } from './kernel';

const PALETTE = ['#78c8ff', '#ffd166', '#5ee6d0', '#b48cff', '#ff9ecd', '#ff8b86', '#6ee7ff'];

function biplotPanel(data: MultiDataset, pca: PcaResult, view: 'pca' | 'cluster' | 'lda', clusterLabels: number[] | null): FigurePanelSpec {
  const groups = view === 'cluster' && clusterLabels ? clusterLabels.map(String) : data.groups;
  const classes = groups ? [...new Set(groups)].sort() : ['all'];
  const scoreSeries: PlotSeries[] = classes.map((cls, idx) => ({
    name: cls,
    kind: 'scatter',
    color: PALETTE[idx % PALETTE.length]!,
    points: pca.scores
      .map((s, i) => ({ x: s[0] ?? 0, y: s[1] ?? 0, i }))
      .filter((p) => !groups || groups[p.i] === cls)
      .map((p) => ({ x: p.x, y: p.y })),
  }));
  const scale = Math.max(1e-9, ...pca.scores.flatMap((s) => [Math.abs(s[0] ?? 0), Math.abs(s[1] ?? 0)])) / 3;
  const arrowSeries: PlotSeries[] = pca.loadings.map((l, i) => ({
    name: data.variables[i] ?? `v${i + 1}`,
    kind: 'line',
    color: 'rgba(250,200,110,0.85)',
    points: [
      { x: 0, y: 0 },
      { x: (l[0] ?? 0) * scale, y: (l[1] ?? 0) * scale },
    ],
  }));
  return {
    ...panelPlace(0),
    tag: panelTag(0),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `PCA biplot (PC1 ${(pca.explained[0]! * 100).toFixed(1)}%)`,
      xLabel: `PC1 (${(pca.explained[0]! * 100).toFixed(1)}%)`,
      yLabel: `PC2 (${(pca.explained[1]! * 100).toFixed(1)}%)`,
      grid: true,
      ticks: 4,
      legend: true,
      series: [...scoreSeries, ...arrowSeries],
    } as PlotSpec,
  };
}

function screePanel(pca: PcaResult): FigurePanelSpec {
  const count = Math.min(8, pca.explained.length);
  const bars = pca.explained.slice(0, count).map((v, i) => ({ x0: i + 0.15, x1: i + 0.85, y: v * 100 }));
  const cumulative: PlotSeries = {
    name: 'cumulative %',
    kind: 'line',
    color: '#ffd166',
    points: pca.cumulative.slice(0, count).map((v, i) => ({ x: i + 0.5, y: v * 100 })),
  };
  return {
    ...panelPlace(1),
    tag: panelTag(1),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Explained variance (scree)',
      xLabel: 'component',
      yLabel: '% variance',
      grid: true,
      ticks: 4,
      legend: true,
      yDomain: [0, 100],
      xDomain: [0, count],
      series: [{ name: 'individual %', kind: 'bar', color: '#5ee6d0', bars }, cumulative],
    } as PlotSpec,
  };
}

/** All figure panels for a fitted multivariate model. */
export function multivariateFigurePanels(result: {
  data: MultiDataset;
  pca: PcaResult | null;
  kmeans: { labels: number[] } | null;
}, view: 'pca' | 'cluster' | 'lda' = 'pca'): FigurePanelSpec[] {
  if (!result.pca) return [];
  return [biplotPanel(result.data, result.pca, view, result.kmeans?.labels ?? null), screePanel(result.pca)];
}
