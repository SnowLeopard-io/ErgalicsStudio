// ==========================================================================
// Ergalics Studio — axis scale & "nice" tick generation (pure TS)
//
// Produces publication-grade tick positions: round, human-friendly numbers
// with a sensible count, the way matplotlib / ggplot2 do. Both linear and
// log10 scales are supported.
// ==========================================================================

import type { ScaleKind } from './types';

export interface Scale {
  /** Map a data coordinate to a pixel coordinate. */
  toPixel(value: number): number;
  /** Map a pixel coordinate back to data space (inverse). */
  toData(pixel: number): number;
  domain: [number, number];
  range: [number, number];
  kind: ScaleKind;
}

function niceNum(range: number, round: boolean): number {
  if (range <= 0 || !Number.isFinite(range)) return 1;
  const exp = Math.floor(Math.log10(range));
  const frac = range / Math.pow(10, exp);
  let nice: number;
  if (round) {
    if (frac < 1.5) nice = 1;
    else if (frac < 3) nice = 2;
    else if (frac < 7) nice = 5;
    else nice = 10;
  } else {
    if (frac <= 1) nice = 1;
    else if (frac <= 2) nice = 2;
    else if (frac <= 5) nice = 5;
    else nice = 10;
  }
  return nice * Math.pow(10, exp);
}

/**
 * Compute nice tick values spanning [min, max].
 * Returns the adjusted [niceMin, niceMax] and the step.
 */
export function niceTicks(
  min: number,
  max: number,
  count = 5,
): { min: number; max: number; step: number; ticks: number[] } {
  if (min === max) {
    // Degenerate: expand symmetrically so a single point is visible.
    const pad = Math.abs(min) === 0 ? 1 : Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }
  const range = niceNum(max - min, false);
  const step = niceNum(range / Math.max(1, count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  // Guard against runaway loops from floating-point edge cases.
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) {
    ticks.push(Number(v.toFixed(10)));
    if (ticks.length > 1000) break;
  }
  return { min: niceMin, max: niceMax, step, ticks };
}

/** Build a linear or log scale mapping a data domain to a pixel range. */
export function makeScale(
  kind: ScaleKind,
  domain: [number, number],
  range: [number, number],
): Scale {
  if (kind === 'log') {
    const lo = domain[0] <= 0 ? 1e-12 : domain[0];
    const hi = domain[1] <= lo ? lo * 10 : domain[1];
    const l0 = Math.log10(lo);
    const l1 = Math.log10(hi);
    const [r0, r1] = range;
    return {
      kind,
      domain: [lo, hi],
      range,
      toPixel: (v) => r0 + ((Math.log10(Math.max(1e-12, v)) - l0) / (l1 - l0)) * (r1 - r0),
      toData: (p) => Math.pow(10, l0 + ((p - r0) / (r1 - r0)) * (l1 - l0)),
    };
  }
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return {
    kind,
    domain,
    range,
    toPixel: (v) => r0 + ((v - d0) / span) * (r1 - r0),
    toData: (p) => d0 + ((p - r0) / (r1 - r0 || 1)) * span,
  };
}

/** Format a tick label compactly (avoids 0.30000000000000004 noise). */
export function formatTick(v: number): string {
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1e4 || abs < 1e-3) return v.toExponential(1);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 1 : 2;
  return Number(v.toFixed(digits)).toString();
}
