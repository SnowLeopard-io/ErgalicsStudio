// ==========================================================================
// Ergalics Studio — IR JSON serialization
//
// The IR is the persisted form (`.clproj` stores IR, not code text — see
// block-code-modes.md §3.1 invariant #1). Serialization is a thin, versioned
// wrapper over JSON.stringify/parse that validates on read and back-fills the
// content hash when it is missing (e.g. projects saved by an older build).
// ==========================================================================

import type { IRProgram } from './types';
import { validateIR } from './validate';
import { hashIR } from './hash';

/** Serialize an IR program to a deterministic JSON string (2-space indent). */
export function serializeIR(program: IRProgram): string {
  return JSON.stringify(program, null, 2);
}

/**
 * Parse and validate a serialized IR program. Throws on malformed JSON or
 * structural validation failure. Back-fills the `hash` field when absent so
 * older/foreign payloads are normalized on load.
 */
export function deserializeIR(raw: string): IRProgram {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid IR JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || !('body' in parsed)) {
    throw new Error('invalid IR program: missing body');
  }
  const program = parsed as IRProgram;

  const diagnostics = validateIR(program, {
    // Verify the stored hash when present so a tampered or corrupted payload
    // is rejected instead of silently accepted (the hash is also used by the
    // sync engine to decide which side changed).
    checkHash: typeof program.hash === 'string' && program.hash.length > 0,
  });
  if (diagnostics.length > 0) {
    const detail = diagnostics
      .slice(0, 5)
      .map((d) => `${d.path}: ${d.message}`)
      .join('; ');
    throw new Error(`invalid IR program: ${detail}`);
  }

  if (typeof program.hash !== 'string' || program.hash.length === 0) {
    program.hash = hashIR(program);
  }
  return program;
}
