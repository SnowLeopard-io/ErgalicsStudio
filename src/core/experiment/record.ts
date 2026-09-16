// ==========================================================================
// Experiment tracking — run record model (pure TS, data layer)
//
// A RunRecord is the durable snapshot of one execution (Flow pipeline run,
// Block program run, Code run, or Notebook cell execution). Records live in
// the IndexedDB `runs` store (NOT inside the `.clproj`) so project files stay
// small; they are keyed by projectId and cleaned up when the project is
// deleted. Content hashing reuses the repro kernel's FNV-1a `hashString`.
// ==========================================================================

/** Which workbench surface produced the run. */
export type RunSource = 'flow' | 'block' | 'code' | 'notebook' | 'sweep' | 'model' | 'uncertainty' | 'sql';

export interface RunRecord {
  id: string;
  projectId: string;
  source: RunSource;
  /** Optional human label (defaults to `${source} run`). */
  label?: string;
  /** Parameter snapshot at run time (JSON-serializable values only). */
  params: Record<string, unknown>;
  /** Project file ids consumed by the run (lineage edges file → run). */
  inputFileIds: string[];
  /** Fingerprint of the input data (FNV-1a via repro.hashString). */
  inputsHash?: string;
  /** Fingerprint of the primary output payload. */
  outputsHash?: string;
  /** Artifact ids produced by the run, e.g. figure sheet ids (run → figure). */
  outputFileIds: string[];
  /** When the run is a Sweep Studio sub-run, the parent sweep plan id. */
  parentSweepId?: string;
  /** Scalar metrics extracted from the run (loss, p-value, R², …). */
  metrics: Record<string, number>;
  /** Reproducibility seed (null when the run is not seeded). */
  seed: number | null;
  /** True when the run ended in an error — failed runs are kept on purpose
   *  (they are part of the experiment's history) but flagged. */
  failed?: boolean;
  createdAt: number;
  durationMs: number;
}

export interface CreateRunRecordArgs {
  projectId: string;
  source: RunSource;
  label?: string;
  params?: Record<string, unknown>;
  inputFileIds?: string[];
  inputsHash?: string;
  outputsHash?: string;
  outputFileIds?: string[];
  parentSweepId?: string;
  metrics?: Record<string, number>;
  seed?: number | null;
  failed?: boolean;
  durationMs?: number;
  createdAt?: number;
}

/** Build a durable run record, filling identity/timestamps. */
export function createRunRecord(args: CreateRunRecordArgs): RunRecord {
  return {
    id: crypto.randomUUID(),
    projectId: args.projectId,
    source: args.source,
    label: args.label ?? `${args.source} run`,
    params: args.params ?? {},
    inputFileIds: args.inputFileIds ?? [],
    inputsHash: args.inputsHash,
    outputsHash: args.outputsHash,
    outputFileIds: args.outputFileIds ?? [],
    parentSweepId: args.parentSweepId,
    metrics: args.metrics ?? {},
    seed: args.seed ?? null,
    failed: args.failed ?? false,
    createdAt: args.createdAt ?? Date.now(),
    durationMs: args.durationMs ?? 0,
  };
}
