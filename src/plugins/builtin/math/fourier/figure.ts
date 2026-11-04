// ==========================================================================
// math-fourier — Figure Studio panels
//
// Pure builder: turns the waveform + Fourier coefficient table into
// publication-grade PlotSpec panels (no DOM, no store access).
//
// Charts delivered:
//   a. The preset waveform f(x) (dashed) with the N-term partial sum
//      S_N (or the Fejér mean σ_N).
//   b. Log-scale harmonic magnitude spectrum |cₙ| = √(aₙ² + bₙ²) (n = 0
//      holds the DC term a₀/2) with the analytic coefficient magnitudes
//      overlaid as a scatter reference.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { analyticCoeff, evalFourierSum, type FourierCoeffs, type SumMode, type WaveformDef } from './kernel';

export interface FourierFigureInput {
  coeffs: FourierCoeffs;
  wave: WaveformDef;
  mode: SumMode;
}

export function fourierFigurePanels(input: FourierFigureInput): FigurePanelSpec[] {
  const { coeffs: c, wave, mode } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: waveform vs partial sum -------------------------------------------
  const M = 600;
  const fPts: Array<{ x: number; y: number }> = [];
  const sPts: Array<{ x: number; y: number }> = [];
  for (let k = 0; k <= M; k += 1) {
    const x = -c.L + (2 * c.L * k) / M;
    fPts.push({ x, y: wave.fn((Math.PI * x) / c.L) });
    sPts.push({ x, y: evalFourierSum(c, x, mode) });
  }
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `Waveform vs ${mode === 'fejer' ? 'Fejér mean σ_N' : 'partial sum S_N'} (N=${c.N})`,
      xLabel: 'x',
      yLabel: 'f(x)',
      grid: true,
      ticks: 5,
      series: [
        { name: 'f(x)', kind: 'line', color: '#f0f4fa', dash: [5, 4], points: fPts },
        { name: mode === 'fejer' ? 'σ_N (Fejér)' : 'S_N', kind: 'line', color: '#78c8ff', points: sPts },
      ],
    } as PlotSpec,
  });
  i += 1;

  // --- panel b: log-scale magnitude spectrum ---------------------------------------
  // Zeros are clamped to a display floor just above the renderer's 1e-12 log
  // clamp so genuine zeros (e.g. sine-series aₙ) survive the log axis.
  let ampMax = 1e-12;
  const amps: Array<{ x: number; y: number }> = [];
  amps.push({ x: 0, y: Math.abs(c.a0 / 2) });
  for (let n = 1; n <= c.N; n += 1) {
    amps.push({ x: n, y: Math.hypot(c.a[n - 1]!, c.b[n - 1]!) });
  }
  for (const q of amps) ampMax = Math.max(ampMax, q.y);
  const floor = ampMax * 1e-9;
  const clamp = (v: number): number => (v < floor ? floor : v);
  const specPts = amps.map((q) => ({ x: q.x, y: clamp(q.y) }));

  const specSeries: PlotSeries[] = [
    { name: '|cₙ| (quadrature)', kind: 'line', color: '#b48cff', points: specPts },
  ];
  const refPts: Array<{ x: number; y: number }> = [];
  for (let n = 1; n <= c.N; n += 1) {
    const ref = analyticCoeff(wave.id, n);
    if (ref) refPts.push({ x: n, y: clamp(Math.hypot(ref.a, ref.b)) });
  }
  if (refPts.length > 0) {
    specSeries.push({ name: 'analytic', kind: 'scatter', color: '#ffd166', points: refPts });
  }
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Harmonic magnitude spectrum',
      xLabel: 'n',
      yLabel: '|cₙ|',
      yScale: 'log',
      grid: true,
      ticks: 5,
      series: specSeries,
    } as PlotSpec,
  });
  i += 1;

  return panels;
}
