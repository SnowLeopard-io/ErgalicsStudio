// ==========================================================================
// data-imageproc — Figure Studio panels
//
// Turns the current original/processed image pair into publication-grade
// panels (pure, no DOM — pixel stats are computed from the same Float32
// buffers the canvas view draws):
//   a. Grayscale intensity histogram of the processed image (256 bins over
//      0..255).
//   b. Tone-metrics bar panel — mean and standard deviation (contrast) of the
//      original vs the processed image.
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { histogram, type GrayImage } from './kernel';

/** Mean and (population) standard deviation of the pixel intensities. */
function meanSigma(img: GrayImage): { mean: number; sigma: number } {
  const n = img.data.length;
  if (n === 0) return { mean: 0, sigma: 0 };
  let s = 0;
  for (let i = 0; i < n; i += 1) s += img.data[i]!;
  const mean = s / n;
  let acc = 0;
  for (let i = 0; i < n; i += 1) acc += (img.data[i]! - mean) ** 2;
  return { mean, sigma: Math.sqrt(acc / n) };
}

/** Build the full Figure Studio panel layout for one processed view. */
export function imageprocFigurePanels(input: { base: GrayImage; processed: GrayImage }): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: processed-image intensity histogram (256 bins) ---------------
  const hist = histogram(input.processed);
  {
    const bars: Array<{ x0: number; x1: number; y: number }> = [];
    for (let v = 0; v < 256; v += 1) {
      const c = hist[v] ?? 0;
      if (c > 0) bars.push({ x0: v, x1: v + 1, y: c });
    }
    if (bars.length > 0) {
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'Intensity histogram — processed',
          xLabel: 'grey level',
          yLabel: 'pixel count',
          xDomain: [0, 256],
          grid: true,
          ticks: 5,
          series: [{ name: 'count', kind: 'histogram', color: '#7ab8f0', bars }],
        } as PlotSpec,
      });
      i += 1;
    }
  }

  // --- panel b: tone metrics, original vs processed ----------------------------
  {
    const baseStats = meanSigma(input.base);
    const procStats = meanSigma(input.processed);
    const yMax = Math.max(baseStats.mean, baseStats.sigma, procStats.mean, procStats.sigma, 1) * 1.2;
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Tone metrics — original vs processed',
        xLabel: 'metric',
        yLabel: 'grey level',
        xDomain: [0.4, 2.6],
        yDomain: [0, yMax],
        grid: true,
        ticks: 4,
        legend: true,
        xTicksOverride: [
          { pos: 1, label: 'mean' },
          { pos: 2, label: 'σ' },
        ],
        series: [
          {
            name: 'original',
            kind: 'bar',
            color: '#8a97ab',
            bars: [
              { x0: 0.65, x1: 0.95, y: baseStats.mean },
              { x0: 1.65, x1: 1.95, y: baseStats.sigma },
            ],
          },
          {
            name: 'processed',
            kind: 'bar',
            color: '#5dd0a8',
            bars: [
              { x0: 1.05, x1: 1.35, y: procStats.mean },
              { x0: 2.05, x1: 2.35, y: procStats.sigma },
            ],
          },
        ],
      } as PlotSpec,
    });
  }

  return panels;
}
