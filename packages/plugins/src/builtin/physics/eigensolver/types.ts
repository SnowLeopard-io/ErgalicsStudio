// ==========================================================================
// EM Eigensolver plugin — shared types (plugin ⇄ client ⇄ worker protocol)
// ==========================================================================

/** Solver configuration mirroring the Python ``SolverConfig`` facade. */
export interface EmSolverConfig {
  /** auto | lanczos | lobpcg | jacobi-davidson */
  method: 'auto' | 'lanczos' | 'lobpcg' | 'jacobi-davidson';
  /** Number of eigenpairs. */
  k: number;
  /** Target shift; `null` selects extremal eigenvalues by `which`. */
  sigma: number | null;
  /** Extremal selection when sigma is null: LM | LA | SA. */
  which: 'LM' | 'LA' | 'SA';
  /** Relative residual tolerance. */
  tol: number;
  maxCycles: number;
  maxIter: number;
  /** Krylov / search-space width (memory knob). */
  basisDim: number;
  seed: number;
  /** Direct LAPACK path for tiny problems. */
  denseThreshold: number;
}

/** Where the matrix comes from. */
export type EmSolveSource =
  | { source: 'sample'; sample: string }
  | { source: 'file'; filename: string; name: string; data: ArrayBuffer };

/** host → worker messages. */
export type EmWorkerRequest =
  | { type: 'init'; indexURL: string }
  | { type: 'solve'; id: number; request: EmSolveSource; config: EmSolverConfig }
  | { type: 'export'; id: number };

/** Per-cycle progress emitted by the kernels (JSON-safe subset).
 *  Lanczos emits `cycle`+`residuals[]`; LOBPCG emits `iter`+`rel_residuals[]`;
 *  Jacobi-Davidson emits `iter`+`rel` (scalar). All carry `matvecs`. */
export interface EmProgressInfo {
  cycle?: number;
  residuals?: number[];
  ritz?: number[];
  matvecs?: number;
  inner?: number;
  sigma?: number | null;
  iter?: number;
  rel?: number;
  locked?: number;
  rel_residuals?: number[];
}

/** One downsampled mode field for the 3D visualisation (from driver.mode_fields). */
export interface EmModeField {
  /** Eigenvector index within the returned block. */
  index: number;
  /** Associated eigenvalue (real part). */
  eigenvalue: number;
  /** Field grid rows × cols (row-major `values`). */
  rows: number;
  cols: number;
  /** Normalised field values, max |value| = 1. Complex modes are magnitudes. */
  values: number[];
  /** True when rows×cols is a nearest-factor layout, not the true mesh. */
  approx: boolean;
}

/**
 * Reproducible-solve credential (`ergalics.em-repro`, PRD REQ-F) attached to
 * every solve report by driver.build_repro — matrix fingerprint, parameter
 * hash, seed, code snapshot and result digest. Downloaded verbatim as
 * `repro.json` via the "Export Repro Credential" action.
 */
export interface EmReproCredential {
  schema: string;
  version: number;
  created_at: string;
  source: string;
  matrix: {
    representation: string;
    shape: [number, number];
    nnz: number;
    complex: boolean;
    hash: string;
  };
  params: Record<string, unknown>;
  params_hash: string;
  seed: number;
  code: {
    package: string;
    version: string;
    python: string;
    numpy: string;
    backend: string;
    files: Record<string, string | null>;
    aggregate: string;
  };
  result: {
    method: string;
    backend: string;
    converged: boolean;
    iterations: number;
    matvecs: number;
    eigenvalues: number[];
    eigenvalues_hash: string;
    max_residual: number;
  };
}

/** Solve report (EigenResult without eigenvectors). */
export interface EmResultPayload {
  eigenvalues: number[];
  residuals: number[];
  converged: boolean;
  iterations: number;
  matvecs: number;
  method: string;
  backend: string;
  diagnostics: Record<string, unknown>;
  meta: {
    name: string;
    description: string;
    shape: [number, number];
    nnz: number;
    complex: boolean;
  };
  /** Downsampled mode fields for the 3D view (≤6 modes, ≤64×64 cells). */
  modeFields?: EmModeField[];
  /** Reproducible-solve credential (ergalics.em-repro, REQ-F). */
  repro?: EmReproCredential;
  /** True when the report contained NaN/Inf (diverged) — driver nulled them;
   *  the payload must not be rendered, surface a readable error instead. */
  nonfinite?: boolean;
}

/** worker → host messages. */
export type EmWorkerEvent =
  | { type: 'ready'; version: string }
  | { type: 'init-failed'; error: string }
  | { type: 'stdout'; text: string }
  | { type: 'progress'; id: number; info: EmProgressInfo }
  | { type: 'result'; id: number; ok: boolean; payload?: EmResultPayload; error?: string; durationMs: number }
  | { type: 'export-result'; id: number; ok: boolean; bytes?: ArrayBuffer; error?: string };

/** Sample matrix ids offered by the plugin UI (see python/em_eigensolver/samples.py). */
export const EM_SAMPLES = [
  'cavity_small',
  'cluster_zero',
  'degenerate_pair',
  'cavity_complex',
  'cavity_large',
] as const;
