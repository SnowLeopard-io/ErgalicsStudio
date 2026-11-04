// ==========================================================================
// color-science — Figure Studio panels
//   a. CIE 1931 xy chromaticity locus with the sRGB triangle.
//   b. Palette in CIELAB (L* vs chroma) with ΔE to the reference colour.
//   c. WCAG contrast of each swatch against black and white.
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import {
  FIGURE_PANEL_HEIGHT,
  FIGURE_PANEL_WIDTH,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import {
  contrastRatio,
  rgbToLab,
  labToLch,
  spectralLocus,
  xyzToXy,
  rgbToXyz,
  type PaletteEntry,
  type RGB,
} from './kernel';

export interface ColorFigureInput {
  palette: PaletteEntry[];
  reference: RGB;
}

export function colorFigurePanels(input: ColorFigureInput): FigurePanelSpec[] {
  const { palette, reference } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  const locus = spectralLocus(380, 700, 5);
  const locusPts = locus.map((p) => ({ x: p.x, y: p.y }));
  locusPts.push({ x: locus[0]!.x, y: locus[0]!.y });
  const [rx, ry] = xyzToXy(rgbToXyz(reference));
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'CIE 1931 xy chromaticity',
      xLabel: "x",
      yLabel: "y",
      xDomain: [0, 0.8],
      yDomain: [0, 0.9],
      grid: true,
      ticks: 5,
      series: [
        { name: 'spectral locus', kind: 'line', color: '#f0f4fa', points: locusPts },
        {
          name: 'sRGB gamut',
          kind: 'line',
          color: '#78c8ff',
          dash: [4, 3],
          points: [
            { x: 0.64, y: 0.33 },
            { x: 0.3, y: 0.6 },
            { x: 0.15, y: 0.06 },
            { x: 0.64, y: 0.33 },
          ],
        },
        { name: 'reference', kind: 'scatter', color: '#ffd166', points: [{ x: rx, y: ry }] },
      ],
    } as PlotSpec,
  });
  i += 1;

  const labPts = palette.map((p) => {
    const lch = labToLch(rgbToLab(p.rgb));
    return { x: lch[0], y: lch[1] };
  });
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Palette in CIELAB (L* vs C*)',
      xLabel: 'L*',
      yLabel: 'C*',
      grid: true,
      ticks: 5,
      series: [{ name: 'swatches', kind: 'scatter', color: '#b48cff', points: labPts }],
    } as PlotSpec,
  });
  i += 1;

  const names = palette.map((p, k) => p.name || `#${k + 1}`);
  const blackBars = palette.map((p, k) => ({
    x0: k - 0.35,
    x1: k + 0.35,
    y: contrastRatio(p.rgb, [0, 0, 0]),
  }));
  const whiteBars = palette.map((p, k) => ({
    x0: k - 0.35,
    x1: k + 0.35,
    y: contrastRatio(p.rgb, [1, 1, 1]),
  }));
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'WCAG contrast vs black / white',
      xLabel: 'swatch',
      yLabel: 'ratio',
      xTicksOverride: names.map((label, k) => ({ pos: k, label })),
      grid: true,
      ticks: 5,
      series: [
        { name: 'vs black', kind: 'bar', color: '#78c8ff', bars: blackBars },
        { name: 'vs white', kind: 'bar', color: '#ffd166', bars: whiteBars },
      ],
    } as PlotSpec,
  });
  i += 1;

  return panels;
}
