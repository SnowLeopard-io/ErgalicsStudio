// ==========================================================================
// Ergalics Studio — publication-grade plotting (pure TS, vector output)
// ==========================================================================

export type {
  ChartKind,
  ScaleKind,
  PlotSeries,
  PlotSpec,
  SvgPlotPayload,
  CategoricalTicks,
} from './types';
export { renderSVG } from './svg';
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
export { exportSVG, exportPDF, downloadText } from './export';
