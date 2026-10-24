// ==========================================================================
// Ergalics Studio — run manifest (pure TS)
//
// A run manifest records everything needed to reproduce a computation:
// the studio version, wall-clock time, the global seed, the data inputs
// (with content hashes), the block graph + parameters, and hashes of the
// produced outputs. Captured alongside a generated .py script, a third party
// can replay the analysis and confirm identical numbers.
// ==========================================================================

import { currentSeed, hashString } from './random';

export interface ManifestInput {
  /** Human label, e.g. file name or block id. */
  name: string;
  /** Raw bytes / text to fingerprint (hashed, never stored in full). */
  content: string;
}

export interface ManifestBlock {
  id: string;
  blockId: string;
  params: Record<string, unknown>;
  /** Upstream node ids in connection order. */
  inputs: string[];
}

export interface RunManifest {
  schema: 'ergalics.run-manifest';
  version: 1;
  id: string;
  studioVersion: string;
  createdAt: string;
  seed: number;
  inputs: Array<{ name: string; hash: string }>;
  graph: ManifestBlock[];
  outputs: Array<{ name: string; hash: string }>;
}

let manifestCounter = 0;

export interface CreateManifestArgs {
  studioVersion: string;
  inputs?: ManifestInput[];
  graph?: ManifestBlock[];
  outputs?: ManifestInput[];
  seed?: number;
  now?: Date;
}

/** Build a run manifest from the current run's artifacts. */
export function createManifest(args: CreateManifestArgs): RunManifest {
  const seed = args.seed ?? currentSeed();
  const now = args.now ?? new Date();
  manifestCounter += 1;
  return {
    schema: 'ergalics.run-manifest',
    version: 1,
    id: `run-${now.getTime().toString(36)}-${manifestCounter}`,
    studioVersion: args.studioVersion,
    createdAt: now.toISOString(),
    seed,
    inputs: (args.inputs ?? []).map((i) => ({ name: i.name, hash: hashString(i.content) })),
    graph: args.graph ?? [],
    outputs: (args.outputs ?? []).map((o) => ({ name: o.name, hash: hashString(o.content) })),
  };
}

/** Render a manifest as a human-readable, diff-friendly text blob. */
export function manifestToText(m: RunManifest): string {
  const lines: string[] = [];
  lines.push('# Ergalics Studio run manifest');
  lines.push(`run_id: ${m.id}`);
  lines.push(`studio_version: ${m.studioVersion}`);
  lines.push(`created_at: ${m.createdAt}`);
  lines.push(`seed: ${m.seed}`);
  lines.push(`inputs: ${m.inputs.length}`);
  for (const i of m.inputs) lines.push(`  - ${i.name} (sha: ${i.hash})`);
  lines.push(`graph: ${m.graph.length} blocks`);
  for (const b of m.graph) lines.push(`  - ${b.id} [${b.blockId}] <- [${b.inputs.join(', ')}]`);
  lines.push(`outputs: ${m.outputs.length}`);
  for (const o of m.outputs) lines.push(`  - ${o.name} (sha: ${o.hash})`);
  return lines.join('\n');
}
