// ==========================================================================
// reactmd — shared payload/result types crossing the Pyodide boundary.
// Everything travels as JSON (postMessage cannot clone PyProxy), exactly as
// the Python driver emits / consumes it.
// ==========================================================================

export interface PhysAtom {
  symbol: string;
  x: number;
  y: number;
  z: number;
}

export type BondKind = 'keep' | 'break' | 'form';

export interface PhysBond {
  /** global reactant atom indices. */
  a: number;
  b: number;
  kind: BondKind;
  order: number;
  /** activation energy to break, kJ/mol (host-engine value). */
  ea: number;
  /** equilibrium bond length, Å (from real geometry). */
  r0: number;
}

export interface PhysicsPayload {
  /** reactant atoms, global flattened layout (left side). */
  atoms: PhysAtom[];
  mass: number[];
  radius: number[];
  bonds: PhysBond[];
  /** per reactant atom: product site to glide to, or null. */
  target: (PhysAtom | null)[];
  seed: number;
}

export interface ReactionRunOptions {
  temperature: number;
  steps?: number;
  frames?: number;
  seed?: number;
}

export interface DynEvent {
  a: number;
  b: number;
  /** frame index (0-based) at which it happened. */
  t: number;
}

export interface SimulationResult {
  ok: boolean;
  n_atoms: number;
  n_frames: number;
  /** [frame][atom][x,y,z]. */
  positions: number[][][];
  progress: number[];
  break_events: DynEvent[];
  form_events: DynEvent[];
  break_counts: boolean[];
  form_flags: boolean[];
  durationMs?: number;
}

// ---- worker protocol ------------------------------------------------------

export type ReactMDWorkerRequest =
  | { type: 'init'; indexURL: string }
  | { type: 'run'; id: number; payload: PhysicsPayload & ReactionRunOptions };

export type ReactMDWorkerEvent =
  | { type: 'ready' }
  | { type: 'init-failed'; error: string }
  | { type: 'stdout'; text: string }
  | { type: 'result'; id: number; ok: boolean; payload?: SimulationResult; error?: string; durationMs?: number };