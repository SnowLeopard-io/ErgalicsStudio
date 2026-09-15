// ==========================================================================
// Ergalics Studio — Metropolis–Hastings MCMC (pure TS, data layer)
//
// Random-walk Metropolis with per-dimension Gaussian proposals. The chain
// runs in batches with `await` yields between them so a long burn-in never
// freezes the UI, and an optional `shouldCancel` callback makes runs
// abortable. Seeded via mulberry32 for reproducible posteriors.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

export interface McmcOptions {
  /** Total iterations including burn-in (clamped to [500, 500_000]). Default 10_000. */
  iters?: number;
  /** Discarded warm-up iterations (clamped to [0, iters-1]). Default iters / 2. */
  burnIn?: number;
  /** Per-dimension proposal standard deviations. Default 0.5 per dim. */
  stepSizes?: number[];
  /** Deterministic seed; null → non-reproducible. */
  seed?: number | null;
  /** Checked between batches; return true to abort early. */
  shouldCancel?: () => boolean;
  /** Batch size between yields. Default 2_000 iterations. */
  batchSize?: number;
}

export interface McmcResult {
  /** Post-burn-in samples, one array per dimension (truncated on cancel). */
  samples: Float64Array[];
  /** Fraction of proposals accepted over the whole chain. */
  acceptanceRate: number;
  iters: number;
  burnIn: number;
  /** True when the run aborted early through `shouldCancel`. */
  cancelled: boolean;
}

const ITERS_MIN = 500;
const ITERS_MAX = 500_000;
/** Yield cadence: the event loop gets a turn between batches. */
const BATCH_DEFAULT = 2_000;

/**
 * Sample `logPost(theta) -> number` (an unnormalized log-posterior) with a
 * random-walk Metropolis kernel.
 *
 * @param init initial state; must be finite
 */
export async function metropolisHastings(
  logPost: (theta: number[]) => number,
  init: number[],
  opts: McmcOptions = {},
): Promise<McmcResult> {
  if (init.length === 0) throw new Error('MCMC needs at least one parameter');
  if (!init.every(Number.isFinite)) throw new Error('MCMC initial state must be finite');

  const rawIters = Math.floor(opts.iters ?? 10_000);
  const iters = Number.isFinite(rawIters)
    ? Math.min(ITERS_MAX, Math.max(ITERS_MIN, rawIters))
    : 10_000;
  const rawBurn = Math.floor(opts.burnIn ?? iters / 2);
  const burnIn = Math.min(iters - 1, Math.max(0, rawBurn));
  const batchSize = Math.max(100, Math.floor(opts.batchSize ?? BATCH_DEFAULT));
  const steps =
    opts.stepSizes && opts.stepSizes.length === init.length && opts.stepSizes.every((s) => s > 0)
      ? opts.stepSizes.slice()
      : init.map(() => 0.5);

  const rand = opts.seed === null || opts.seed === undefined
    ? Math.random
    : mulberry32(opts.seed);
  const gauss = makeNormals(rand);

  const current = init.slice();
  let currentLp = logPost(current);
  if (!Number.isFinite(currentLp)) {
    throw new Error('logPosterior must be finite at the initial state');
  }

  const samples: Float64Array[] = current.map(() => new Float64Array(iters - burnIn));
  let accepted = 0;
  let keptWritten = 0;
  let cancelled = false;
  const proposal: number[] = new Array(current.length).fill(0);

  for (let i = 0; i < iters; i += 1) {
    // Per-dimension Gaussian random walk.
    for (let d = 0; d < current.length; d += 1) {
      proposal[d] = current[d]! + steps[d]! * gauss();
    }
    const lp = logPost(proposal);
    // Symmetric proposal → plain Metropolis acceptance. min(0, Δ) in the
    // exponent keeps the hot path free of overflow for huge log-jumps.
    if (Number.isFinite(lp)) {
      const delta = lp - currentLp;
      if (delta >= 0 || rand() < Math.exp(delta)) {
        for (let d = 0; d < current.length; d += 1) current[d] = proposal[d]!;
        currentLp = lp;
        accepted += 1;
      }
    }
    // Non-finite proposals are rejected outright (flat posterior tails).

    if (i >= burnIn) {
      const k = i - burnIn;
      for (let d = 0; d < current.length; d += 1) samples[d]![k] = current[d]!;
      keptWritten = k + 1;
    }

    if (i % batchSize === batchSize - 1) {
      if (opts.shouldCancel?.()) {
        cancelled = true;
        break;
      }
      // Give the event loop a turn so the UI stays responsive.
      await yieldToHost();
    }
  }

  // An aborted chain keeps its partial samples: they are still valid draws.
  if (cancelled && keptWritten < iters - burnIn) {
    for (let d = 0; d < samples.length; d += 1) {
      samples[d] = samples[d]!.slice(0, keptWritten);
    }
  }

  return { samples, acceptanceRate: accepted / iters, iters, burnIn, cancelled };
}

function yieldToHost(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Standard normals from a uniform stream (Box–Muller, per-stream cache). */
function makeNormals(rand: () => number): () => number {
  let cache: number | null = null;
  return function normal(): number {
    if (cache !== null) {
      const v = cache;
      cache = null;
      return v;
    }
    let u1 = rand();
    while (u1 <= 0) u1 = rand(); // log(0) = -Infinity guard
    const u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    cache = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}
