// ==========================================================================
// Ergalics Studio — publication-grade plotting (pure TS, vector output)
// ==========================================================================

export type {
  ChartKind,
  ScaleKind,
  PlotSeries,
  PlotSpec,
  FieldData,
  SvgPlotPayload,
  CategoricalTicks,
} from './types';
export { renderSVG, fieldColorCss } from './svg';
export {
  niceTicks,
  makeScale,
  formatTick,
  type Scale,
} from './scale';
export {
  dataTableToLine,
  dataTableToScatter,
  dataTableToHistogram,
  dataTableToBar,
  type ChartOptions,
} from './charts';
export { exportSVG, exportPDF, exportPNG, computeRasterSize, downloadText } from './export';
