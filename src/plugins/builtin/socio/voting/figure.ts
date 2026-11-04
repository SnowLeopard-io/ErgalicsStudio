// ==========================================================================
// socio-voting — Figure Studio panels
//
// Turns the current election state into publication-grade PlotSpec panels:
//   a. Per-candidate tally bars under the active rule.
//   b. Issue-space scatter (voters coloured by top choice, candidates dark).
//   c. Pairwise Condorcet matrix as a heatmap field.
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { ElectionResult, PreferenceProfile } from './kernel';

export interface VotingFigureInput {
  /** Current preference profile (voters x full rankings). */
  profile: PreferenceProfile;
  /** Election analysis of that profile under the active rule. */
  result: ElectionResult;
}

/** Low-saturation academic palette, shared with the plugin canvas. */
export const CANDIDATE_COLORS = [
  '#7d8fc9',
  '#c07a72',
  '#5fae97',
  '#a98d66',
  '#9a7fb8',
  '#6f9fbf',
  '#b8879b',
  '#8fa06a',
] as const;

const CANDIDATE_MARK_COLOR = '#3a4356';
const TALLY_COLOR = '#8a93a8';
const MATRIX_COLOR = '#7d8fc9';

/** Candidate colour by id (palette wraps past 8 candidates). */
export function candidateColor(id: number): string {
  return CANDIDATE_COLORS[id % CANDIDATE_COLORS.length]!;
}

/**
 * Build the Figure Studio panel layout for the current election state.
 * Rows are filled row-major; tag letters a, b, c label each panel.
 */
export function votingFigurePanels(input: VotingFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;
  const n = input.result.counts.length;

  // --- panel a: per-candidate tally bars under the active rule -----------------
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `Vote tally (${input.result.tallyLabel.en})`,
      xLabel: 'candidate',
      yLabel: input.result.tallyLabel.en,
      grid: true,
      ticks: Math.max(3, n),
      xDomain: [0, n],
      xTicksOverride: Array.from({ length: n }, (_, c) => ({ pos: c + 0.4, label: `C${c}` })),
      series: [
        {
          name: input.result.tallyLabel.en,
          kind: 'bar',
          color: TALLY_COLOR,
          bars: input.result.counts.map((c, k) => ({ x0: k, x1: k + 0.8, y: c })),
        },
      ],
    } as PlotSpec,
  });
  i += 1;

  // --- panel b: issue-space scatter (voters by top choice) ----------------------
  const { voterPos, candidatePos } = input.profile;
  if (voterPos && candidatePos) {
    const series: PlotSpec['series'] = [];
    for (let c = 0; c < n; c += 1) {
      const points = voterPos
        .map((p, v) => ({ p, top: input.profile.rankings[v]![0] }))
        .filter((e) => e.top === c)
        .map((e) => ({ x: e.p.x, y: e.p.y }));
      if (points.length > 0) {
        series.push({ name: `C${c}`, kind: 'scatter', color: candidateColor(c), points });
      }
    }
    series.push({
      name: 'candidates',
      kind: 'scatter',
      color: CANDIDATE_MARK_COLOR,
      points: candidatePos.map((p) => ({ x: p.x, y: p.y })),
    });
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Issue space (voters by top choice)',
        xLabel: 'issue 1',
        yLabel: 'issue 2',
        grid: true,
        ticks: 5,
        xDomain: [0, 1],
        yDomain: [0, 1],
        legend: n <= 6,
        series,
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel c: pairwise Condorcet matrix (heatmap field) -----------------------
  const matrix = input.result.condorcet.matrix;
  const maxCell = Math.max(1, ...matrix.flat());
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Pairwise Condorcet matrix',
      xLabel: 'candidate b',
      yLabel: 'candidate a',
      grid: true,
      ticks: n,
      series: [
        {
          name: 'voters ranking a above b',
          kind: 'field',
          color: MATRIX_COLOR,
          field: {
            values: matrix.flat(),
            rows: n,
            cols: n,
            domain: [0, maxCell],
          },
        },
      ],
    } as PlotSpec,
  });

  return panels;
}
