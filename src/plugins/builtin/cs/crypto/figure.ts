// ==========================================================================
// crypto — Figure Studio panels
//   a. SHA-256 avalanche effect: differing digest bits per flipped input bit.
//   b. short-Weierstrass curve points with the k·G multiples marked.
//   c. AES-128 final state bytes (or the RSA round-trip fallback).
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import { FIGURE_PANEL_HEIGHT, FIGURE_PANEL_WIDTH, panelPlace, panelTag, type FigurePanelSpec } from '@/core/figure/sheet';
import type { AvalancheSample, EcPoint } from './kernel';

export interface CryptoFigureInput {
  hash: { digest: string; samples: AvalancheSample[]; avg: number };
  ecc: { points: EcPoint[]; multiples: Array<EcPoint | null> };
  aes: { key: number[]; plain: number[]; cipher: number[] } | null;
}

export function cryptoFigurePanels(input: CryptoFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  panels.push({
    ...panelPlace(0),
    tag: panelTag(0),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `SHA-256 avalanche · avg ${input.hash.avg.toFixed(1)}/256`,
      xLabel: 'flipped input bit',
      yLabel: 'digest bits changed',
      grid: true,
      ticks: 6,
      series: [
        {
          name: 'differing bits',
          kind: 'bar',
          color: '#b48cff',
          bars: input.hash.samples.map((s, i) => ({ x0: i, x1: i + 0.8, y: s.differingBits })),
        },
      ],
    } as PlotSpec,
  });
  panels.push({
    ...panelPlace(1),
    tag: panelTag(1),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'ECC curve points (mod 97)',
      xLabel: 'x',
      yLabel: 'y',
      grid: true,
      ticks: 6,
      legend: true,
      series: [
        {
          name: 'curve',
          kind: 'scatter',
          color: '#78c8ff',
          points: input.ecc.points.map((p) => ({ x: Number(p.x), y: Number(p.y) })),
        },
        {
          name: 'k·G',
          kind: 'scatter',
          color: '#ffd166',
          points: input.ecc.multiples.filter((p): p is EcPoint => p !== null).map((p) => ({ x: Number(p.x), y: Number(p.y) })),
        },
      ],
    } as PlotSpec,
  });
  const cipher = input.aes?.cipher ?? [];
  panels.push({
    ...panelPlace(2),
    tag: panelTag(2),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: input.aes ? 'AES-128 ciphertext bytes' : 'SHA-256 digest bytes',
      xLabel: 'byte index',
      yLabel: 'value',
      grid: true,
      ticks: 6,
      series: [
        {
          name: 'byte',
          kind: 'bar',
          color: '#5ee6d0',
          bars: cipher.map((v, i) => ({ x0: i, x1: i + 0.8, y: v })),
        },
      ],
    } as PlotSpec,
  });
  return panels;
}
