// ==========================================================================
// Ergalics Studio — PCG32 random numbers: CPU implementation + WGSL source
//
// The GPU uncertainty kernels (F1) generate their resampling draws on-device
// with PCG-XSH-RR (PCG32). The canonical generator keeps a 64-bit state, but
// neither JS bitops nor WGSL offer a cheap u64 type, so both sides emulate the
// 64-bit LCG with pairs of u32 (16-bit schoolbook multiplication). Keeping the
// two implementations in lockstep means the same seed draws the same stream
// on both engines.
//
// Reproducibility contract (spec FR1.2): a given seed produces the SAME
// sequence on a given engine, but the CPU legacy RNG (mulberry32) and GPU
// streams are only required to be statistically identical — not bit-equal.
// ==========================================================================

// 6364136223846793005 = 0x5851F42D_4C957F2D
const MUL_LO = 0x4c957f2d;
const MUL_HI = 0x5851f42d;

/** PCG32 state: 64-bit LCG state + 64-bit odd increment, split into u32. */
export interface Pcg32State {
  hi: number;
  lo: number;
  incHi: number;
  incLo: number;
}

/** Seed a PCG32 stream. `initseq` picks the stream, `initstate` the offset. */
export function pcg32Seed(initstate: number, initseq: number): Pcg32State {
  const s: Pcg32State = {
    hi: 0,
    lo: 0,
    incLo: ((initseq << 1) | 1) >>> 0,
    incHi: (initseq >>> 31) >>> 0,
  };
  pcg32Next(s);
  const newLo = (s.lo + (initstate >>> 0)) >>> 0;
  s.hi = (s.hi + (newLo < s.lo ? 1 : 0)) >>> 0;
  s.lo = newLo;
  pcg32Next(s);
  return s;
}

/** One 64-bit LCG step: state = state · M + inc (mod 2^64). */
function step64(s: Pcg32State): { hi: number; lo: number } {
  const aLo = s.lo >>> 0;
  const aHi = s.hi >>> 0;
  // Low half of the product: aLo * Mlo, 16-bit schoolbook.
  const a0 = aLo & 0xffff;
  const a1 = aLo >>> 16;
  const b0 = MUL_LO & 0xffff;
  const b1 = MUL_LO >>> 16;
  const p00 = a0 * b0;
  const p01 = a0 * b1;
  const p10 = a1 * b0;
  const p11 = a1 * b1;
  const t = ((p00 >>> 16) + (p01 & 0xffff) + (p10 & 0xffff)) >>> 0;
  const rLo = ((p00 & 0xffff) | ((t & 0xffff) << 16)) >>> 0;
  let rHi = (p11 + (p01 >>> 16) + (p10 >>> 16) + (t >>> 16)) >>> 0;
  // Cross terms contribute only to the high half.
  rHi = (rHi + Math.imul(aHi, MUL_LO) + Math.imul(aLo, MUL_HI)) >>> 0;
  // Add the odd increment.
  const newLo = (rLo + s.incLo) >>> 0;
  const newHi = (rHi + s.incHi + (newLo < rLo ? 1 : 0)) >>> 0;
  return { hi: newHi, lo: newLo };
}

/** XSH-RR output permutation from the old 64-bit state (split u32 pair). */
function xshRr(oldHi: number, oldLo: number): number {
  // 64-bit (state >> 18), split into u32 words with carry.
  const shiftedLow = (((oldHi << 14) >>> 0) + (oldLo >>> 18)) >>> 0;
  const shiftedHi = (oldHi >>> 18) + ((((oldHi << 14) >>> 0) + (oldLo >>> 18)) >= 0x100000000 ? 1 : 0);
  // xorshifted = low 32 bits of (((state >> 18) XOR state) >> 27)
  const xorshifted = (((shiftedLow ^ oldLo) >>> 27) | ((shiftedHi ^ oldHi) << 5)) >>> 0;
  const rot = (oldHi >>> 27) >>> 0;
  return ((xorshifted >>> rot) | (xorshifted << ((32 - rot) & 31))) >>> 0;
}

/** Next unsigned 32-bit integer. */
export function pcg32Next(s: Pcg32State): number {
  const oldHi = s.hi >>> 0;
  const oldLo = s.lo >>> 0;
  const next = step64(s);
  s.hi = next.hi;
  s.lo = next.lo;
  return xshRr(oldHi, oldLo);
}

/** Next uniform float in [0, 1). */
export function pcg32Float(s: Pcg32State): number {
  return pcg32Next(s) / 4294967296;
}

/** Next uniform integer in [0, n). */
export function pcg32Int(s: Pcg32State, n: number): number {
  return pcg32Next(s) % n;
}

/**
 * WGSL source for the generator. Provides a `Pcg` struct (64-bit state as two
 * u32 pairs), `pcgSeed(initstate, initseq) -> Pcg`, `pcgU32(s) -> u32` and
 * `pcgFloat(s) -> f32`. Pass the mutators a `ptr<function, Pcg>`.
 */
export const PCG32_WGSL = /* wgsl */ `
struct Pcg {
  hi: u32,
  lo: u32,
  incHi: u32,
  incLo: u32,
};

fn pcgStep(s: ptr<function, Pcg>) {
  let aLo = (*s).lo;
  let aHi = (*s).hi;
  let mLo = 0x4C957F2Du;
  let mHi = 0x5851F42Du;
  let a0 = aLo & 0xffffu;
  let a1 = aLo >> 16u;
  let b0 = mLo & 0xffffu;
  let b1 = mLo >> 16u;
  let p00 = a0 * b0;
  let p01 = a0 * b1;
  let p10 = a1 * b0;
  let p11 = a1 * b1;
  let t = (p00 >> 16u) + (p01 & 0xffffu) + (p10 & 0xffffu);
  let rLo = (p00 & 0xffffu) | ((t & 0xffffu) << 16u);
  var rHi = p11 + (p01 >> 16u) + (p10 >> 16u) + (t >> 16u);
  rHi = rHi + aHi * mLo + aLo * mHi;
  var newLo = rLo + (*s).incLo;
  let carry = select(0u, 1u, newLo < rLo);
  (*s).lo = newLo;
  (*s).hi = rHi + (*s).incHi + carry;
}

fn pcgU32(s: ptr<function, Pcg>) -> u32 {
  let oldHi = (*s).hi;
  let oldLo = (*s).lo;
  pcgStep(s);
  // 64-bit (state >> 18), split into u32 words with carry.
  let baseLow = (oldHi << 14u) + (oldLo >> 18u);
  let carry = select(0u, 1u, baseLow < (oldHi << 14u));
  let shiftedHi = (oldHi >> 18u) + carry;
  // xorshifted = low 32 bits of (((state >> 18) XOR state) >> 27)
  let xs = ((baseLow ^ oldLo) >> 27u) | ((shiftedHi ^ oldHi) << 5u);
  let rot = oldHi >> 27u;
  return (xs >> rot) | (xs << ((32u - rot) & 31u));
}

fn pcgFloat(s: ptr<function, Pcg>) -> f32 {
  return f32(pcgU32(s)) / 4294967296.0;
}

fn pcgSeed(initstate: u32, initseq: u32) -> Pcg {
  var s: Pcg;
  s.hi = 0u;
  s.lo = 0u;
  s.incLo = (initseq << 1u) | 1u;
  s.incHi = initseq >> 31u;
  _ = pcgU32(&s);
  let newLo = s.lo + initstate;
  let carry = select(0u, 1u, newLo < s.lo);
  s.lo = newLo;
  s.hi = s.hi + carry;
  _ = pcgU32(&s);
  return s;
}
`;
