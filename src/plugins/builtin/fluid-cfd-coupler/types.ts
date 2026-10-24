// ==========================================================================
// Fluid-CFD Coupler plugin — shared types (plugin ⇄ client ⇄ worker protocol)
//
// Mirrors the JSON schema produced by the Python driver (fluid_cfd.driver):
//   - solve_json(payload)  -> FluidCouplingResult
//   - verify_json()        -> FluidVerifyResult
// ==========================================================================

/** One exchange-window audit row (mirrors CouplingWindowRecord.to_dict). */
export interface FluidWindowRecord {
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
export interface FluidCplMetrics {
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

/** One dynamic-playback snapshot of the 3-D field (mirrors sample_snapshot). */
export interface FluidFrame3D {
  t: number;                 // [s] simulation time at this frame
  /** temperature field, z-major flat (len == nx*ny*nz) */
  field: number[];
  /** velocity-magnitude field, z-major flat (len == nx*ny*nz) */
  speed: number[];
  nx: number;
  ny: number;
  nz: number;
}

/** A single coupling run (mirrors CouplingResult.to_dict). */
export interface FluidCouplingResult {
  ok: boolean;
  config?: Record<string, unknown>;
  windows: FluidWindowRecord[];
  metrics: FluidCplMetrics;
  final_state_1d?: Record<string, unknown> | null;
  final_state_3d?: Record<string, unknown> | null;
  /** Time-stamped snapshots of the 3-D field across the run (dynamic playback). */
  frames_3d?: FluidFrame3D[];
  error: string;
  /** Set by the Python driver when any NaN/Inf was replaced with null. */
  nonfinite?: boolean;
}

/** One certification assertion (mirrors rel_error_check / bound_check). */
export interface FluidCertCheck {
  quantity: string;
  rel_error?: number;
  threshold?: number;
  value?: number;
  lower?: number | null;
  upper?: number | null;
  pass: boolean;
  basis: string;
}

/** Certification bundle attached to each verified case (CFD-05). */
export interface FluidCertification {
  all_pass: boolean;
  checks: FluidCertCheck[];
}

/** Case A verification topline (analytic baseline comparison). */
export interface FluidVerifyCaseA {
  case: string;
  ok: boolean;
  md_analytic_kg_s: number;
  md_solver_kg_s: number;
  flow_rel_error: number;
  p_blowdown_analytic: number;
  p_solver_final: number;
  pressure_rel_error: number;
  metrics: FluidCplMetrics;
  windows: FluidWindowRecord[];
  basis?: Record<string, string>;
  certification?: FluidCertification;
}

/** Case B verification topline (ms valve control + reverse coupling). */
export interface FluidVerifyCaseB {
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
  metrics: FluidCplMetrics;
  windows: FluidWindowRecord[];
}

/** Case C verification topline (energy-channel field variant, CFD-06). */
export interface FluidVerifyCaseC {
  case: string;
  ok: boolean;
  md_analytic_kg_s: number;
  md_solver_kg_s: number;
  flow_rel_error: number;
  back_pressure_rise_pa: number;
  reverse_coupling_engagement: 'active' | 'weak';
  metrics: FluidCplMetrics;
  windows: FluidWindowRecord[];
  basis: Record<string, string>;
  certification: FluidCertification;
}

/** Case D verification topline (subsonic / non-choked bidirectional coupling,
 * literature isentropic-subsonic baseline). */
export interface FluidVerifyCaseD {
  case: string;
  ok: boolean;
  pressure_ratio_actual: number;
  critical_pressure_ratio_lit: number;
  subsonic_engaged: boolean;
  md_solver_kg_s: number;
  md_literature_kg_s: number;
  flow_rel_error: number;
  back_pressure_pa: number;
  plenum_pressure_final_pa: number;
  reverse_coupling_engaged: boolean;
  mean_interface_error: number;
  metrics: FluidCplMetrics;
  windows: FluidWindowRecord[];
  basis: Record<string, string>;
  certification: FluidCertification;
}

/** One row of the subsonic-branch literature scan (verify_subsonic_curve). */
export interface FluidSubsonicCurveRow {
  pressure_ratio: number;
  subsonic: boolean;
  md_solver_kg_s: number;
  md_literature_kg_s: number;
  rel_error: number;
}

/** Subsonic-branch literature scan (mirrors verify_subsonic_curve). */
export interface FluidSubsonicCurve {
  case: string;
  critical_pressure_ratio_lit: number;
  max_rel_error: number;
  sensitivity_dln_md_over_dln_r: number;
  rows: FluidSubsonicCurveRow[];
  basis: Record<string, string>;
  certification: Record<string, boolean | string>;
}

/** One precision-vs-efficiency row (mirrors interface_tradeoff_curve). */
export interface FluidTradeRow {
  exchange_period_ms: number;
  exchange_freq_hz: number;
  latency_ms: number;
  interface_error: number;
  composite_score: number;
}

/** One exchange-cadence scan row (mirrors min_feasible_exchange_period). */
export interface FluidMinExchangeRow {
  requested_period_ms: number;
  effective_period_ms: number;
  latency_ms: number;
  interface_error: number;
  feasible: boolean;
}

/** Minimal feasible exchange period analysis (CFD-01). */
export interface FluidMinExchangeResult {
  latency_budget_ms: number;
  interface_tolerance: number;
  min_feasible_exchange_period_ms: number | null;
  criterion: string;
  rows: FluidMinExchangeRow[];
}

/** One parameter-sweep row of the Case-A attribution analysis (CFD-04). */
export type FluidSensitivitySweepRow =
  | { discharge_coeff: number; solver_final_pa: number; analytic_final_pa: number; deviation: number }
  | { horizon_s: number; solver_final_pa: number; analytic_final_pa: number; deviation: number };

/** Case-A pressure-deviation attribution (mirrors sensitivity_case_a). */
export interface FluidSensitivityResult {
  case: string;
  deviation_total: number;
  numerical_error_rel: number;
  coupling_contribution_rel: number;
  model_bias_rel: number;
  back_pressure_excursion_pa: number;
  uncoupled_final_pa: number;
  exact_ode_final_pa: number;
  analytic_final_pa: number;
  cd_sweep: FluidSensitivitySweepRow[];
  horizon_sweep: FluidSensitivitySweepRow[];
  conclusion: string;
}

/** Full verification suite (mirrors driver.verify_json). */
export interface FluidVerifyResult {
  case_a: FluidVerifyCaseA;
  case_b: FluidVerifyCaseB;
  case_c: FluidVerifyCaseC;
  case_d: FluidVerifyCaseD;
  subsonic_curve: FluidSubsonicCurve;
  trade_off: FluidTradeRow[];
  min_exchange: FluidMinExchangeResult;
  sensitivity: FluidSensitivityResult;
  /** Set by the Python driver when any NaN/Inf was replaced with null. */
  nonfinite?: boolean;
}

/** Payload accepted by driver.solve_json. */
export type CouplingPayload =
  | { case: 'a' }
  | { case: 'b' }
  | { case: 'c' }
  | { case: 'd' }
  | {
      net?: Record<string, unknown>;
      dom?: Record<string, unknown>;
      cpl?: Record<string, unknown>;
    };

/** Per-window progress emitted by the coupler's progress callback. */
export interface FluidProgressInfo {
  done: number;
  total: number;
}

/** Front-end configuration knobs. */
export interface FluidCfdConfig {
  preset: 'case_a' | 'case_b' | 'case_c' | 'case_d' | 'custom';
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
export type FluidWorkerRequest =
  | { type: 'init'; indexURL: string }
  | { type: 'solve'; id: number; payload: CouplingPayload }
  | { type: 'verify'; id: number };

/** worker → host messages. */
export type FluidWorkerEvent =
  | { type: 'ready'; version: string }
  | { type: 'init-failed'; error: string }
  | { type: 'stdout'; text: string }
  | { type: 'progress'; id: number; done: number; total: number }
  | {
      type: 'result';
      id: number;
      ok: boolean;
      payload?: FluidCouplingResult;
      error?: string;
      durationMs: number;
    }
  | {
      type: 'verify-result';
      id: number;
      ok: boolean;
      payload?: FluidVerifyResult;
      error?: string;
      durationMs: number;
    };