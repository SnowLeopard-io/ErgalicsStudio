// ==========================================================================
// acoustics — Figure Studio panels
//   a. waveform overview (peak-preserving buckets).
//   b. one-sided magnitude spectrum (log) with the fundamental marked.
//   c. room eigenfrequencies (axial/tangential/oblique).
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import {
  FIGURE_PANEL_HEIGHT,
  FIGURE_PANEL_WIDTH,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { waveformOverview, type AcousticSpectrum, type RoomMode, type SampleTable } from './kernel';

export interface AcousticFigureInput {
  table: SampleTable;
  spectrum: AcousticSpectrum;
  fundamental: number;
  modes: RoomMode[];
}

export function acousticFigurePanels(input: AcousticFigureInput): FigurePanelSpec[] {
  const { table, spectrum, fundamental, modes } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  const buckets = waveformOverview(table.samples, 280).map((b, k) => ({
    x: (k / 280) * table.samples.length / table.sampleRate,
    y: (b.max + b.min) / 2,
  }));
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Waveform',
      xLabel: 'time / s',
      yLabel: 'amplitude',
      grid: true,
      ticks: 5,
      series: [{ name: 'waveform', kind: 'line', color: '#78c8ff', points: buckets }],
    } as PlotSpec,
  });
  i += 1;

  const step = Math.max(1, Math.floor(spectrum.freqs.length / 900));
  const floor = Math.max(1e-9, Math.max(...spectrum.magnitude) * 1e-8);
  const specPts: Array<{ x: number; y: number }> = [];
  for (let k = 1; k < spectrum.freqs.length; k += step) {
    specPts.push({ x: spectrum.freqs[k]!, y: Math.max(floor, spectrum.magnitude[k]!) });
  }
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `Spectrum${fundamental > 0 ? ` (f₀ ≈ ${fundamental.toFixed(1)} Hz)` : ''}`,
      xLabel: 'frequency / Hz',
      yLabel: 'magnitude',
      yScale: 'log',
      grid: true,
      ticks: 5,
      series: [{ name: '|X(f)|', kind: 'line', color: '#b48cff', points: specPts }],
    } as PlotSpec,
  });
  i += 1;

  const axial = modes.filter((m) => m.type === 'axial');
  const tangential = modes.filter((m) => m.type === 'tangential');
  const oblique = modes.filter((m) => m.type === 'oblique');
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Room eigenfrequencies',
      xLabel: 'frequency / Hz',
      yLabel: 'mode',
      grid: true,
      ticks: 5,
      series: [
        { name: 'axial', kind: 'scatter', color: '#ffd166', points: axial.map((m) => ({ x: m.freq, y: 3 })) },
        { name: 'tangential', kind: 'scatter', color: '#78c8ff', points: tangential.map((m) => ({ x: m.freq, y: 2 })) },
        { name: 'oblique', kind: 'scatter', color: '#b48cff', points: oblique.map((m) => ({ x: m.freq, y: 1 })) },
      ],
    } as PlotSpec,
  });

  return panels;
}
