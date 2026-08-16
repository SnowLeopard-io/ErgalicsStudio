// ==========================================================================
// Ergalics Studio — IR content hashing
//
// The IR's `hash` field is a content fingerprint the sync engine uses to
// detect "which side changed" (block vs code) and to debounce redundant
// re-syncs. It is a *dedup* fingerprint, not a security digest — the design
// draft names SHA-1, but WebCrypto's SHA-1 is async and would force
// `makeProgram`/the sync engine to be async. FNV-1a is synchronous, stable
// and collision-resistant enough for fingerprinting in-memory ASTs, so it is
// used here with a deterministic (key-sorted) canonical serialization.
// ==========================================================================

import type { IRProgram } from './types';

/** FNV-1a 32-bit hash of a UTF-16 string, returned as 8 hex chars. */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Deterministic serialization: object keys are sorted and `undefined` values
 * are dropped, so two structurally-equal programs always produce the same
 * string regardless of how their nodes were constructed.
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const body = Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value);
}

/**
 * Content hash of a program, computed over its canonical shape (version,
 * body, functions, sourceLang) and deliberately *excluding* the `hash` field
 * itself, so re-hashing a program is idempotent.
 */
export function hashIR(program: IRProgram): string {
  const canonical = {
    version: program.version,
    body: program.body,
    functions: program.functions,
    sourceLang: program.sourceLang,
  };
  return hashString(stableStringify(canonical));
}
