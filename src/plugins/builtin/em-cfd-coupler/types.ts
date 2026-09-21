// ==========================================================================
// EM-CFD Coupler plugin — shared types (plugin ⇄ client ⇄ worker protocol)
//
// Mirrors the JSON schema produced by the Python driver (em_cfd.driver):
//   - solve_json(payload)  -> EmCouplingResult
//   - verify_json()        -> EmVerifyResult
// ==========================================================================

/** One exchange-window audit row (mirrors CouplingWindowRecord.to_dict). */
export interface EmWindowRecord {
  t: number;                 // [s] end-of-window time (1-D clock)
  exchange_latency_s: number;
  md_1d: number;             // 1-D outlet mass flow [kg/s]
  t_1d: number;              // 1-D nozzle discharge temperature [K]
  p_back_3d: number;         // 3-D outlet-averaged back pressure [Pa]
  mass_in_3d: number;        // mass absorbed by the 3-D box [kg]
  enthalpy_in_3d: number;    // enthalpy absorbed [J]
  iface_error: number;       // bidirectional interface (reverse-coupling) error
  control_sync_ms: number;
  valve_opening: number;     // last applied opening fraction [0,1]
}

/** Coupler metrics (mirrors CouplingResult.metrics). */
export interface EmCplMetrics {
  n_windows: number;
  total_sim_time: number;
  time_ratio_1d_3d: number;
  exchange_period_ms: number;
  sub3d_per_window: number;
  mean_exchange_latency_ms: number;
  worst_exchange_latency_ms: number;
  wall_clock_s: number;
  mean_interface_error: number;
  worst_interface_error: number;
  final_back_pressure: number;
  final_plenum_pressure: number;
  final_flow_kg_s: number;
  control_sync_max_ms: number;
  control_sync_mean_ms: number;
}

/** A single coupling run (mirrors CouplingResult.to_dict). */
export interface EmCouplingResult {
  ok: boolean;
  config?: Record<string, unknown>;
  windows: EmWindowRecord[];
  metrics: EmCplMetrics;
  final_state_1d?: Record<string, unknown> | null;
  final_state_3d?: Record<string, unknown> | null;
  error: string;
}

/** Case A verification topline (analytic baseline comparison). */
export interface EmVerifyCaseA {
  case: string;
  ok: boolean;
  md_analytic_kg_s: number;
  md_solver_kg_s: number;
  flow_rel_error: number;
  p_blowdown_analytic: number;
  p_solver_final: number;
  pressure_rel_error: number;
  metrics: EmCplMetrics;
  windows: EmWindowRecord[];
}

/** Case B verification topline (ms valve control + reverse coupling). */
export interface EmVerifyCaseB {
  case: string;
  ok: boolean;
  back_pressure_final: number;
  plenum_pressure_final: number;
  flow_open_kg_s: number;
  flow_closed_kg_s: number;
  flow_reopen_kg_s: number;
  valve_throttle_ratio: number;
  control_sync_max_ms: number;
  control_sync_mean_ms: number;
  metrics: EmCplMetrics;
  windows: EmWindowRecord[];
}

/** One precision-vs-efficiency row (mirrors interface_tradeoff_curve). */
export interface EmTradeRow {
  exchange_period_ms: number;
  exchange_freq_hz: number;
  latency_ms: number;
  interface_error: number;
  composite_score: number;
}

/** Full verification suite (mirrors driver.verify_json). */
export interface EmVerifyResult {
  case_a: EmVerifyCaseA;
  case_b: EmVerifyCaseB;
  trade_off: EmTradeRow[];
}

/** Payload accepted by driver.solve_json. */
export type CouplingPayload =
  | { case: 'a' }
  | { case: 'b' }
  | {
      net?: Record<string, unknown>;
      dom?: Record<string, unknown>;
      cpl?: Record<string, unknown>;
    };

/** Per-window progress emitted by the coupler's progress callback. */
export interface EmProgressInfo {
  done: number;
  total: number;
}

/** Front-end configuration knobs. */
export interface EmCfdConfig {
  preset: 'case_a' | 'case_b' | 'custom';
  view: 'coupling' | 'verify' | '3d';
  // Custom couplings (SI-derived in the client):
  dt1dMs: number;
  dt3dUs: number;
  tEndS: number;
  /** 0 = exchange every 1-D step (tight); >0 = explicit period in ms. */
  exchangePeriodMs: number;
  volumeL: number;
  p0InitBar: number;
  throatAreaCm2: number;
}

/** host → worker messages. */
export type EmWorkerRequest =
  | { type: 'init'; indexURL: string }
  | { type: 'solve'; id: number; payload: CouplingPayload }
  | { type: 'verify'; id: number };

/** worker → host messages. */
export type EmWorkerEvent =
  | { type: 'ready'; version: string }
  | { type: 'init-failed'; error: string }
  | { type: 'stdout'; text: string }
  | { type: 'progress'; id: number; done: number; total: number }
  | {
      type: 'result';
      id: number;
      ok: boolean;
      payload?: EmCouplingResult;
      error?: string;
      durationMs: number;
    }
  | {
      type: 'verify-result';
      id: number;
      ok: boolean;
      payload?: EmVerifyResult;
      error?: string;
      durationMs: number;
    };