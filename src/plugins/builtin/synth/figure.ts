// ==========================================================================
// synth — Figure Studio panels
//   a. rendered waveform (first 60 ms).
//   b. analytic filter magnitude response.
//   c. ADSR envelope.
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import {
  FIGURE_PANEL_HEIGHT,
  FIGURE_PANEL_WIDTH,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { adsrGain, biquadCoeffs, biquadResponse, type SynthPreset } from './kernel';

export interface SynthFigureInput {
  preset: SynthPreset;
  rendered: Float64Array;
  sampleRate: number;
}

export function synthFigurePanels(input: SynthFigureInput): FigurePanelSpec[] {
  const { preset, rendered, sampleRate } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  const windowSamples = Math.min(rendered.length, Math.round(sampleRate * 0.06));
  const step = Math.max(1, Math.floor(windowSamples / 700));
  const wave: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < windowSamples; k += step) {
    wave.push({ x: (k / sampleRate) * 1000, y: rendered[k]! });
  }
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `${preset.name} — waveform`,
      xLabel: 'time / ms',
      yLabel: 'amplitude',
      grid: true,
      ticks: 5,
      series: [{ name: 'output', kind: 'line', color: '#78c8ff', points: wave }],
    } as PlotSpec,
  });
  i += 1;

  const freqs: number[] = [];
  const count = 240;
  for (let k = 0; k <= count; k += 1) freqs.push(20 * (20000 / 20) ** (k / count));
  const coeffs = biquadCoeffs(preset.filter, sampleRate, preset.cutoff, preset.q);
  const resp = biquadResponse(coeffs, sampleRate, freqs);
  const respPts = freqs.map((f, k) => ({ x: f, y: Math.max(-60, resp[k]!) }));
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `${preset.filter} response (fc ${preset.cutoff} Hz, Q ${preset.q})`,
      xLabel: 'frequency / Hz',
      yLabel: 'gain / dB',
      xScale: 'log',
      grid: true,
      ticks: 5,
      series: [{ name: '|H|', kind: 'line', color: '#ffd166', points: respPts }],
    } as PlotSpec,
  });
  i += 1;

  const gate = Math.max(0.01, preset.duration - preset.adsr.release);
  const envPts: Array<{ x: number; y: number }> = [];
  const envSteps = 320;
  for (let k = 0; k <= envSteps; k += 1) {
    const t = (k / envSteps) * preset.duration;
    envPts.push({ x: t * 1000, y: adsrGain(t, preset.adsr, gate) });
  }
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'ADSR envelope',
      xLabel: 'time / ms',
      yLabel: 'gain',
      grid: true,
      ticks: 5,
      series: [{ name: 'envelope', kind: 'line', color: '#b48cff', points: envPts }],
    } as PlotSpec,
  });

  return panels;
}
