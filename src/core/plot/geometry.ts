// Plot geometry for interactive readouts.
//
// renderSVG computes its canvas layout inline; this module independently
// reproduces that same geometry (margins, domains, scales) so an interactive
// overlay can map pointer positions back to data coordinates without touching
// the tested SVG renderer. Keep the two in sync when the renderer's layout
// rules change.
import type { PlotSpec, PlotSeries, FieldData } from './types';
import {
  MARGIN,
  TICK_LEN,
  COLORBAR_SPACE,
  estTickWidth,
  wrapTitle,
  autoDomain,
} from './svg';
import { makeScale, niceTicks, formatTick, type Scale } from './scale';

export interface PlotGeometry {
  width: number;
  height: number;
  left: number;
  topV: number;
  plotW: number;
  plotH: number;
  xDom: [number, number];
  yDom: [number, number];
  x: Scale;
  y: Scale;
  xScaleKind: string;
  yScaleKind: string;
  firstField?: PlotSeries & { field: FieldData };
  hasColorbar: boolean;
}

/** Same numbers renderSVG derives, in one object for overlay math. */
export function plotGeometry(spec: PlotSpec): PlotGeometry {
  const width = spec.width || 640;
  const height = spec.height || 420;
  const TITLE_INSET = 18;
  const titleLines = spec.title ? wrapTitle(spec.title, Math.max(width - TITLE_INSET * 2, 60)) : [];
  const topV = MARGIN.top + Math.max(0, (titleLines.length - 1) * 16);
  const firstField = spec.series.find(
    (s): s is PlotSeries & { field: FieldData } => s.kind === 'field' && !!s.field,
  );
  const plotH = height - topV - MARGIN.bottom;
  const xScaleKind = spec.xScale ?? 'linear';
  const yScaleKind = spec.yScale ?? 'linear';

  const xDomain =
    spec.xDomain ?? (firstField ? [0, firstField.field.cols] : autoDomain(spec.series, 'x')) ?? [0, 1];
  const yDomain =
    spec.yDomain ?? (firstField ? [0, firstField.field.rows] : autoDomain(spec.series, 'y')) ?? [0, 1];
  const xTicksInfo = niceTicks(xDomain[0], xDomain[1], spec.ticks ?? 5);
  const yTicksInfo = niceTicks(yDomain[0], yDomain[1], spec.ticks ?? 5);
  const yTickMaxW = Math.max(0, ...yTicksInfo.ticks.map((t) => estTickWidth(formatTick(t))));
  const left = Math.max(MARGIN.LEFT_FLOOR, Math.ceil(yTickMaxW + TICK_LEN + 40));
  const plotW = width - left - MARGIN.right - (firstField ? COLORBAR_SPACE : 0);

  const xDom: [number, number] = firstField
    ? [xDomain[0], xDomain[1]]
    : xScaleKind === 'log'
      ? [Math.max(1e-12, xTicksInfo.min), Math.max(1e-11, xTicksInfo.max)]
      : [xTicksInfo.min, xTicksInfo.max];
  const yDom: [number, number] = firstField
    ? [yDomain[0], yDomain[1]]
    : yScaleKind === 'log'
      ? [Math.max(1e-12, yTicksInfo.min), Math.max(1e-11, yTicksInfo.max)]
      : [yTicksInfo.min, yTicksInfo.max];

  const x: Scale = makeScale(xScaleKind, xDom, [left, left + plotW]);
  const y: Scale = makeScale(yScaleKind, yDom, [topV + plotH, topV]);

  return {
    width,
    height,
    left,
    topV,
    plotW,
    plotH,
    xDom,
    yDom,
    x,
    y,
    xScaleKind,
    yScaleKind,
    firstField,
    hasColorbar: !!firstField,
  };
}

/** Inverse of Scale.toPixel for a linear or log axis. */
export function fromPixel(
  scaleKind: string,
  dom: [number, number],
  range: [number, number],
  pixel: number,
): number {
  const [d0, d1] = dom;
  const [r0, r1] = range;
  if (scaleKind === 'log') {
    const l0 = Math.log10(Math.max(1e-12, d0));
    const l1 = Math.log10(Math.max(1e-12, d1));
    return Math.pow(10, l0 + ((pixel - r0) / (r1 - r0)) * (l1 - l0));
  }
  return d0 + ((pixel - r0) / (r1 - r0)) * (d1 - d0);
}
