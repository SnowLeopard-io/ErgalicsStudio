// ==========================================================================
// Canonical JSON — deterministic parameter snapshots (FR-1)
//
// Two runs with the same parameters must produce byte-identical snapshots
// regardless of insertion order, so object keys are sorted recursively before
// hashing or storing. Arrays keep their order (order is semantic there).
// ==========================================================================

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const v = canonicalize(source[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return value;
}

export function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
