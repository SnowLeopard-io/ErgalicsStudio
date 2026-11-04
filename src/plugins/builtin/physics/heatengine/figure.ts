// ==========================================================================
// physics-heatengine — Figure Studio panels
//
// Turns a completed ideal-gas cycle evaluation into publication-grade
// PlotSpec panels and streams them into the figure store's shared sheet via
// `pushPanelsToFigure` (see plugin.ts).
//
// Charts delivered:
//   a. p–V cycle loop on a log-V axis: a closed line through the corner
//      states plus per-branch lines coloured by heat exchange (warm = heat
//      in, cool = heat out, violet = adiabat).
//   b. Efficiency sweep η(%) — vs volume ratio r for Otto / Diesel, vs hot-end
//      temperature for Carnot / Stirling — evaluated by re-running the pure
//      kernel across the sweep, with the current operating point marked.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { computeCycle, sampleSegment, type EngineInput, type EngineResult, type SegmentKind } from './kernel';

/** Number of sweep evaluations in the efficiency panel. */
const SWEEP_POINTS = 32;

export interface HeatEngineFigureInput {
  input: EngineInput;
  result: EngineResult;
}

/**
 * Build the full Figure Studio panel layout for one cycle. Rows are filled
 * row-major; tag letters a, b, c, … label each panel.
 */
export function heatEngineFigurePanels(input: HeatEngineFigureInput): FigurePanelSpec[] {
  const { input: cfg, result } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: p–V cycle loop ------------------------------------------------
  if (result.segments.length > 0 && result.states.length >= 2) {
    const series: PlotSeries[] = [];
    for (const s of result.segments) {
      // Isochores collapse to a zero-length segment; the closed corner loop
      // already draws them.
      if (s.kind === 'isochoric' || s.Va === s.Vb) continue;
      const pts = sampleSegment(s, cfg.n, cfg.gamma, 120).map((q) => ({ x: q.V, y: q.p }));
      if (pts.length < 2) continue;
      series.push({ name: s.kind, kind: 'line', color: branchColor(s.kind, s.Q), points: pts });
    }
    const corners = result.states.map((p) => ({ x: p.V, y: p.p }));
    series.push({
      name: 'cycle loop',
      kind: 'line',
      color: '#e8f0fa',
      dash: [3, 3],
      points: [...corners, corners[0]!],
    });
    series.push({ name: 'corner states', kind: 'scatter', color: '#f0f6fc', points: corners });
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'p–V cycle loop',
        xLabel: 'V (m³)',
        yLabel: 'p (Pa)',
        xScale: 'log',
        grid: true,
        ticks: 5,
        series,
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: efficiency sweep ------------------------------------------------
  const sweep = efficiencySweep(cfg);
  if (sweep.points.length >= 2) {
    const series: PlotSeries[] = [
      { name: 'η (sweep)', kind: 'line', color: '#5dd0a8', points: sweep.points },
    ];
    if (Number.isFinite(result.eta)) {
      const curX = sweep.axis === 'ratio' ? cfg.ratio : cfg.Thot;
      series.push({
        name: 'operating point',
        kind: 'scatter',
        color: '#ffd166',
        points: [{ x: curX, y: result.eta * 100 }],
      });
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Efficiency sweep',
        xLabel: sweep.axis === 'ratio' ? 'ratio r' : 'Thot (K)',
        yLabel: 'η (%)',
        grid: true,
        ticks: 5,
        series,
      } as PlotSpec,
    });
  }

  return panels;
}

/** Branch stroke colour: warm for absorbed heat, cool for rejected, violet for adiabats. */
function branchColor(kind: SegmentKind, q: number): string {
  if (kind === 'adiabatic') return '#b48cff';
  return q > 0 ? '#ff7d6b' : '#6ba6ff';
}

/**
 * Efficiency sweep over the parameter that shapes η for the selected cycle:
 * volume ratio r for Otto / Diesel (η = 1 − r^(1−γ) family), hot-end
 * temperature for Carnot / Stirling (η = 1 − Tc/Th family). Invalid sweep
 * points (no valid cycle) are simply skipped.
 */
function efficiencySweep(cfg: EngineInput): { axis: 'ratio' | 'Thot'; points: Array<{ x: number; y: number }> } {
  const points: Array<{ x: number; y: number }> = [];
  if (cfg.cycle === 'otto' || cfg.cycle === 'diesel') {
    for (let k = 0; k < SWEEP_POINTS; k += 1) {
      const ratio = 2 + (20 - 2) * (k / (SWEEP_POINTS - 1));
      const r = computeCycle({ ...cfg, ratio });
      if (r && Number.isFinite(r.eta)) points.push({ x: ratio, y: r.eta * 100 });
    }
    return { axis: 'ratio', points };
  }
  for (let k = 0; k < SWEEP_POINTS; k += 1) {
    const Thot = 400 + (3000 - 400) * (k / (SWEEP_POINTS - 1));
    const r = computeCycle({ ...cfg, Thot });
    if (r && Number.isFinite(r.eta)) points.push({ x: Thot, y: r.eta * 100 });
  }
  return { axis: 'Thot', points };
}
