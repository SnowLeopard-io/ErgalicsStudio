// ==========================================================================
// Ergalics Studio — publication-grade plotting types (pure TS, no deps)
//
// The plot subsystem emits a *vector* SVG (no canvas, no WebGL) so the output
// can drop straight into a paper (LaTeX / Inkscape / Illustrator) or be
// packaged into a PDF. A `PlotSpec` is the intermediate, framework-agnostic
// description; `renderSVG` turns it into a string.
// ==========================================================================

export type ChartKind = 'line' | 'bar' | 'scatter' | 'histogram';
export type ScaleKind = 'linear' | 'log';

/** One drawable series in a plot. Coordinates are in *data* space. */
export interface PlotSeries {
  /** Legend label. */
  name: string;
  kind: ChartKind;
  /** Stroke / marker colour (CSS hex). */
  color: string;
  /** (x, y) points for line / scatter. */
  points?: Array<{ x: number; y: number }>;
  /**
   * Bars for bar / histogram. `x0`/`x1` are the bin edges (data space),
   * `y` the height. Bars ignore `points`.
   */
  bars?: Array<{ x0: number; x1: number; y: number }>;
  /** Line dash array (CSS) for line series, e.g. [4, 2] for dashed. */
  dash?: number[];
}

export interface PlotSpec {
  width: number;
  height: number;
  title?: string;
  xLabel?: string;
  yLabel?: string;
  xScale?: ScaleKind;
  yScale?: ScaleKind;
  /** Override the auto-computed data domain. */
  xDomain?: [number, number];
  yDomain?: [number, number];
  /** Approximate number of ticks on each axis. */
  ticks?: number;
  /** Override the x-axis ticks with categorical labels (used by bar charts). */
  xTicksOverride?: CategoricalTicks[];
  /** Draw light gridlines at ticks. */
  grid?: boolean;
  /** Draw a legend (only if more than one series, or forced). */
  legend?: boolean;
  series: PlotSeries[];
}

/** A plain-svg payload carried by a `plot.*` RenderedView. */
export interface SvgPlotPayload {
  /** Discriminator so the preview can route SVG plots vs plugin views. */
  readonly svg: true;
  readonly markup: string;
  readonly title?: string;
}

/** A fixed categorical tick, used when the x axis is not numeric (e.g. bar). */
export interface CategoricalTicks {
  pos: number;
  label: string;
}
