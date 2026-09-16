// ==========================================================================
// Ergalics Studio — parameter sweeps (F2)
// ==========================================================================

export type {
  SweepAxis,
  SweepPlan,
  SweepResult,
  SweepCell,
  SweepSource,
  SweepStatus,
  SweepMap,
  GridSpec,
  LhsSpec,
} from './types';
export {
  linspace,
  axisLevels,
  expandLhs,
  cartesian,
  expandPlan,
  cellKey,
  setPath,
  getPath,
  extractMetric,
} from './design';
export {
  runSweep,
  summarizePoints,
  mean as sweepMean,
  sd as sweepSd,
  type SweepExecution,
  type SweepExecutor,
  type SweepExecutorResult,
  type RunSweepOptions,
  type SweepPointSummary,
} from './runner';
