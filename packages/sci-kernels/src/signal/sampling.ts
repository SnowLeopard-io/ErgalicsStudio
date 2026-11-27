// ==========================================================================
// Ergalics Studio — sampling-rate inference (pure, no DOM)
//
// Frequency axes are only meaningful once the sample rate is known. Two
// fallbacks keep a normalized spectrum from masquerading as hertz:
//   1. metadata in the file header (`# sampling_rate=2048`, `// fs: 500`, …)
//   2. the time column itself: fs = 1 / median(Δt)
// Both are deliberately conservative — a missing or non-uniform axis yields
// null so the caller can refuse to plot instead of mislabelling the x axis.
// ==========================================================================

/** Keys accepted in a comment header, case-insensitive. */
const RATE_KEY = /(?:sampling[ _-]?rate|sample[ _-]?rate|sampling[ _-]?frequency|\bfs\b)\s*[:=]\s*([0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)/i;

/**
 * Read a sampling rate from leading comment lines. Only the first 40 lines
 * are scanned so a stray `fs=` inside data text cannot hijack the axis.
 */
export function parseSamplingRateMetadata(text: string): number | null {
  const head = text.slice(0, 8192).split(/\r?\n/, 40);
  for (const line of head) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('#') && !trimmed.startsWith('//')) continue;
    const m = RATE_KEY.exec(trimmed);
    if (!m) continue;
    const value = Number(m[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

/**
 * Infer fs from a time axis via the median of positive intervals. The median
 * ignores dropped rows and duplicated timestamps; a non-monotonic or constant
 * axis returns null (only one distinct timestamp has no interval at all).
 */
export function inferSampleRate(times: ArrayLike<number>): number | null {
  const n = times.length;
  if (n < 2) return null;
  const deltas: number[] = [];
  for (let i = 1; i < n; i += 1) {
    const a = Number(times[i - 1]);
    const b = Number(times[i]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const dt = b - a;
    if (dt > 0) deltas.push(dt);
  }
  // A mostly-decreasing axis is not a time column; requiring half the steps
  // to advance keeps a mis-picked column from producing a plausible number.
  if (deltas.length * 2 < n - 1) return null;
  deltas.sort((a, b) => a - b);
  const mid = deltas.length >> 1;
  const median = deltas.length % 2 === 1
    ? deltas[mid]!
    : (deltas[mid - 1]! + deltas[mid]!) / 2;
  if (!(median > 0)) return null;
  return 1 / median;
}
