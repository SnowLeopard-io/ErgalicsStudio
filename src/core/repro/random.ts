// ==========================================================================
// Ergalics Studio — reproducible RNG (pure TS)
//
// A small, deterministic PRNG (mulberry32) plus a process-wide seed so that
// any block wanting randomness can pull from a single, recorded source. The
// seed is captured in the run manifest, making a run replayable.
// ==========================================================================

/** mulberry32 — fast, deterministic 32-bit PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate a fresh, non-deterministic seed (for "new run" button). */
export function randomSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
}

/**
 * Process-wide reproducible seed holder. Blocks read through `currentSeed()`
 * so a single seed governs an entire run and can be written into the manifest.
 */
let activeSeed = randomSeed();

export function setSeed(seed: number): void {
  activeSeed = seed >>> 0;
}

export function currentSeed(): number {
  return activeSeed;
}

/** A seeded RNG bound to the current process seed. */
export function seededRandom(): () => number {
  return mulberry32(activeSeed);
}

/** FNV-1a 32-bit hash of a string (used to fingerprint inputs/outputs). */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
