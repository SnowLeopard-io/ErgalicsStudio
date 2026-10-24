// ==========================================================================
// physics-ising — 2-D Ising model kernels (pure functions, no DOM)
//
// Hamiltonian (periodic square lattice, J > 0 ferromagnetic, k_B = 1):
//     E = -J * sum_<ij> s_i s_j - H * sum_i s_i ,   s_i = +-1
// Each geometric bond enters exactly once through the right/down neighbour
// convention (2 L^2 bond terms). For L = 2 this reproduces the textbook
// closed form Z = 2 e^{8K} + 12 + 2 e^{-8K} (K = beta J), which the tests
// cross-check against brute-force enumeration to machine precision.
//
// Observables (per spin):
//     chi      = beta N ( <m^2> - <|m|>^2 )
//     C        = beta^2 ( <E^2> - <E>^2 ) / N
//     Binder U = 1 - <m^4> / (3 <m^2>^2)
// ==========================================================================

/** Deterministic mulberry32 PRNG — fixed seed => reproducible runs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Onsager critical temperature for J = 1, k_B = 1: 2 / ln(1 + sqrt 2). */
export const ONSAGER_TC = 2 / Math.log(1 + Math.sqrt(2));

export type IsingAlgorithm = 'auto' | 'metropolis' | 'wolff';

export interface IsingParams {
  L: number;
  T: number;
  J: number;
  H: number;
  thermSweeps: number;
  measureSweeps: number;
  seed: number;
  algorithm: IsingAlgorithm;
}

export interface IsingResult {
  T: number;
  L: number;
  energyPerSpin: number;
  absM: number;
  m2: number;
  m4: number;
  chi: number;
  heatCapacity: number;
  binder: number;
  /** Final configuration, row-major, values +-1. */
  spins: Int8Array;
  algorithmUsed: 'metropolis' | 'wolff';
}

// --------------------------------------------------------------------------
// Metropolis + Wolff lattice
// --------------------------------------------------------------------------

export class IsingLattice {
  readonly L: number;
  readonly n: number;
  readonly J: number;
  readonly H: number;
  spins: Int8Array;
  /** Incrementally maintained total energy (float arithmetic on integers — exact). */
  energy: number;
  private beta = 1;
  private pAdd = 1 - Math.exp(-2);
  private readonly nbr: Int32Array;
  private readonly expT: Float64Array;
  private readonly rng: () => number;
  private readonly cbuf: Int32Array;
  private readonly cmark: Int32Array;
  private readonly bmark: Int32Array;
  private cstamp = 0;

  constructor(L: number, J: number, H: number, rng: () => number, spins?: Int8Array) {
    this.L = L;
    this.n = L * L;
    this.J = J;
    this.H = H;
    this.rng = rng;
    this.spins = spins ?? IsingLattice.randomSpins(this.n, rng);
    this.nbr = new Int32Array(this.n * 4);
    for (let y = 0; y < L; y++) {
      const row = y * L;
      const up = ((y - 1 + L) % L) * L;
      const dn = ((y + 1) % L) * L;
      for (let x = 0; x < L; x++) {
        const i = row + x;
        this.nbr[i * 4] = row + ((x + 1) % L);
        this.nbr[i * 4 + 1] = row + ((x - 1 + L) % L);
        this.nbr[i * 4 + 2] = dn + x;
        this.nbr[i * 4 + 3] = up + x;
      }
    }
    this.expT = new Float64Array(10);
    this.cbuf = new Int32Array(this.n);
    this.cmark = new Int32Array(this.n);
    this.bmark = new Int32Array(2 * this.n);
    this.setTemperature(1);
    this.energy = this.recomputeEnergy();
  }

  static randomSpins(n: number, rng: () => number): Int8Array {
    const s = new Int8Array(n);
    for (let i = 0; i < n; i++) s[i] = rng() < 0.5 ? -1 : 1;
    return s;
  }

  /** Rebuild the Metropolis acceptance table and the Wolff bond probability. */
  setTemperature(T: number): void {
    this.beta = 1 / T;
    for (let si = 0; si < 2; si++) {
      const s = si === 0 ? -1 : 1;
      for (let k = 0; k < 5; k++) {
        const nn = 2 * k - 4; // neighbour sum in {-4,-2,0,2,4}
        const dE = 2 * s * (this.J * nn + this.H);
        this.expT[si * 5 + k] = dE <= 0 ? 1 : Math.exp(-this.beta * dE);
      }
    }
    this.pAdd = 1 - Math.exp(-2 * this.beta * this.J);
  }

  /** One Metropolis sweep = N single-spin proposals (uniform random sites). */
  metropolisSweep(): void {
    const { spins, nbr, rng, expT } = this;
    for (let k = 0; k < this.n; k++) {
      const i = (rng() * this.n) | 0;
      const s = spins[i]!;
      const b = i * 4;
      const nnSum =
        spins[nbr[b]!]! + spins[nbr[b + 1]!]! + spins[nbr[b + 2]!]! + spins[nbr[b + 3]!]!;
      const p = expT[((s + 1) >> 1) * 5 + ((nnSum + 4) >> 1)]!;
      if (rng() < p) {
        spins[i] = -s;
        this.energy += 2 * s * (this.J * nnSum + this.H);
      }
    }
  }

  /** One Wolff cluster flip (H must be 0 for the bond probability to be exact). */
  wolffFlip(): number {
    const { spins, nbr, rng, cbuf, cmark, bmark } = this;
    const stamp = ++this.cstamp;
    const seedSite = (rng() * this.n) | 0;
    const s0 = spins[seedSite]!;
    cbuf[0] = seedSite;
    cmark[seedSite] = stamp;
    let head = 0;
    let tail = 1;
    while (head < tail) {
      const i = cbuf[head++]!;
      const b = i * 4;
      for (let d = 0; d < 4; d++) {
        const j = nbr[b + d]!;
        if (spins[j] !== s0) continue;
        // Canonical id of the energy term this directed reference stands for
        // (right/down bond of a site). Rolling once per *term* — including
        // terms whose both endpoints already sit in the cluster — keeps the
        // move probability independent of the traversal order, which the
        // usual "skip visited neighbours" shortcut violates (it silently
        // treats some internal bonds as closed). For L = 2 the two parallel
        // terms of a geometric pair are drawn separately, matching the
        // doubled-bond energy convention.
        const term =
          d === 0 ? i : d === 2 ? this.n + i : d === 1 ? nbr[b + 1]! : this.n + nbr[b + 3]!;
        if (bmark[term] === stamp) continue;
        bmark[term] = stamp;
        if (rng() < this.pAdd && cmark[j] !== stamp) {
          cmark[j] = stamp;
          cbuf[tail++] = j;
        }
      }
    }
    // Boundary energy change, settled only after the cluster is complete:
    // a same-spin neighbour may fail the bond draw from one member yet still
    // join the cluster through another, so per-bond dE cannot be accumulated
    // during growth. dE = 2 J s0 * (sum of outside neighbours over all
    // boundary bonds); for L = 2 a doubly-referenced bond is correctly
    // counted twice, matching the 2 L^2 bond-term energy convention.
    let dE = 0;
    for (let k = 0; k < tail; k++) {
      const i = cbuf[k]!;
      const b = i * 4;
      for (let d = 0; d < 4; d++) {
        const j = nbr[b + d]!;
        if (cmark[j] !== stamp) dE += 2 * s0 * this.J * spins[j]!;
      }
    }
    for (let k = 0; k < tail; k++) spins[cbuf[k]!] = -s0;
    this.energy += dE;
    return tail;
  }

  /** One Wolff sweep = flip clusters until at least N spins have been flipped. */
  wolffSweep(): void {
    let flipped = 0;
    while (flipped < this.n) flipped += this.wolffFlip();
  }

  magnetization(): number {
    let m = 0;
    for (let i = 0; i < this.n; i++) m += this.spins[i]!;
    return m;
  }

  /** Recompute the energy from scratch (validation helper / initial value). */
  recomputeEnergy(): number {
    const { L, spins, J, H } = this;
    let bond = 0;
    let mag = 0;
    for (let y = 0; y < L; y++) {
      const row = y * L;
      const dn = ((y + 1) % L) * L;
      for (let x = 0; x < L; x++) {
        const i = row + x;
        const s = spins[i]!;
        bond += s * spins[row + ((x + 1) % L)]!;
        bond += s * spins[dn + x]!;
        mag += s;
      }
    }
    return -J * bond - H * mag;
  }
}

// --------------------------------------------------------------------------
// Single-temperature Monte Carlo run
// --------------------------------------------------------------------------

/**
 * Equilibrate and measure at one temperature. Fresh lattice seeded from
 * `p.seed` so every call is reproducible. Wolff (cluster) updates are used
 * when available because they kill critical slowing down near Tc; the
 * algorithm falls back to Metropolis whenever H != 0 (Wolff's bond
 * probability is only exact in zero field) or when explicitly requested.
 */
export function runIsingPoint(p: IsingParams): IsingResult {
  const rng = mulberry32(p.seed);
  const lat = new IsingLattice(p.L, p.J, p.H, rng);
  const wolffAllowed = p.H === 0;
  const useWolff =
    p.algorithm === 'wolff'
      ? wolffAllowed
      : p.algorithm === 'auto'
        ? wolffAllowed && Math.abs(p.T - ONSAGER_TC * p.J) < 0.8
        : false;
  lat.setTemperature(p.T);

  // ---- thermalisation -------------------------------------------------------
  // No measurements are taken yet, so the "N spins flipped" sweep stopping
  // rule is harmless here: it only controls how much mixing happens before
  // the measurement phase, never when a sample is recorded.
  for (let s = 0; s < p.thermSweeps; s++) {
    if (useWolff) lat.wolffSweep();
    else lat.metropolisSweep();
  }

  // ---- measurement ------------------------------------------------------------
  // Measurement instants must be state-independent, otherwise the recorded
  // states deviate from pi (inspection paradox / waiting-time bias): stopping
  // a sweep at "N spins flipped" arrives early in ordered configurations
  // (large clusters), which oversamples them and visibly biases small-lattice
  // observables toward the ordered phase. We therefore measure after a *fixed*
  // number of individual cluster flips per sample (n/1024, at least 1) — a
  // fixed sampling schedule preserves the stationary distribution exactly,
  // because every single Wolff flip is pi-preserving on its own. Metropolis
  // sweeps visit a state-independent number of sites and stay unchanged.
  const n = lat.n;
  const flipsPerSample = useWolff ? Math.max(1, Math.round(n / 1024)) : 0;
  let sumE = 0;
  let sumE2 = 0;
  let sumAbsM = 0;
  let sumM2 = 0;
  let sumM4 = 0;
  for (let s = 0; s < p.measureSweeps; s++) {
    if (useWolff) {
      for (let f = 0; f < flipsPerSample; f++) lat.wolffFlip();
    } else {
      lat.metropolisSweep();
    }
    const E = lat.energy;
    const m = lat.magnetization() / n;
    sumE += E;
    sumE2 += E * E;
    sumAbsM += Math.abs(m);
    sumM2 += m * m;
    sumM4 += m * m * m * m;
  }
  const ms = Math.max(1, p.measureSweeps);
  const meanE = sumE / ms;
  const meanE2 = sumE2 / ms;
  const meanAbsM = sumAbsM / ms;
  const meanM2 = sumM2 / ms;
  const meanM4 = sumM4 / ms;
  // χ and C scale with β = 1/T; at T = 0 they are thermodynamically undefined
  // (exactEnumerate guards this path too) — clamp to avoid Infinity.
  const beta = p.T > 0 ? 1 / p.T : Number.MAX_VALUE;
  const varE = Math.max(0, meanE2 - meanE * meanE);
  const varM = Math.max(0, meanM2 - meanAbsM * meanAbsM);
  const binder = meanM2 > 1e-14 ? 1 - meanM4 / (3 * meanM2 * meanM2) : 1;
  return {
    T: p.T,
    L: p.L,
    energyPerSpin: meanE / n,
    absM: meanAbsM,
    m2: meanM2,
    m4: meanM4,
    chi: beta * n * varM,
    heatCapacity: (beta * beta * varE) / n,
    binder,
    spins: lat.spins,
    algorithmUsed: useWolff ? 'wolff' : 'metropolis',
  };
}

// --------------------------------------------------------------------------
// Exact references
// --------------------------------------------------------------------------

export interface ExactObservables {
  Z: number;
  energyPerSpin: number;
  absM: number;
  m2: number;
  m4: number;
  chi: number;
  heatCapacity: number;
  binder: number;
}

/**
 * Brute-force enumeration of the full 2^N state space (L <= 4). This is the
 * ground truth the closed forms and the Monte Carlo are checked against.
 */
export function exactEnumerate(L: number, T: number, J: number, H: number): ExactObservables {
  if (L < 1 || L > 4) throw new Error(`exactEnumerate supports L <= 4, got ${L}`);
  if (T <= 0) throw new Error('T must be positive');
  const n = L * L;
  const beta = 1 / T;
  // Bond pairs, each geometric bond once via the right/down convention.
  const bondA: number[] = [];
  const bondB: number[] = [];
  for (let y = 0; y < L; y++) {
    for (let x = 0; x < L; x++) {
      bondA.push(y * L + x);
      bondB.push(y * L + ((x + 1) % L));
      bondA.push(y * L + x);
      bondB.push(((y + 1) % L) * L + x);
    }
  }
  const spins = new Int8Array(n);
  const nCfg = 1 << n;
  const energies = new Float64Array(nCfg);
  const mags = new Float64Array(nCfg);
  let eMin = Infinity;
  for (let cfg = 0; cfg < nCfg; cfg++) {
    let B = 0;
    let M = 0;
    for (let i = 0; i < n; i++) spins[i] = ((cfg >> i) & 1) === 1 ? 1 : -1;
    for (let b = 0; b < bondA.length; b++) B += spins[bondA[b]!]! * spins[bondB[b]!]!;
    for (let i = 0; i < n; i++) M += spins[i]!;
    const E = -J * B - H * M;
    energies[cfg] = E;
    mags[cfg] = M;
    if (E < eMin) eMin = E;
  }
  // Shift the exponential by the ground-state energy so e^{beta*(E-eMin)} <= 1
  // (deep-cold inputs would otherwise overflow to Infinity).
  let Z = 0;
  let wE = 0;
  let wE2 = 0;
  let wAbsM = 0;
  let wM2 = 0;
  let wM4 = 0;
  for (let cfg = 0; cfg < nCfg; cfg++) {
    const E = energies[cfg]!;
    const m = mags[cfg]! / n;
    const w = Math.exp(-beta * (E - eMin));
    Z += w;
    wE += w * E;
    wE2 += w * E * E;
    wAbsM += w * Math.abs(m);
    wM2 += w * m * m;
    wM4 += w * m * m * m * m;
  }
  const meanE = wE / Z;
  const meanE2 = wE2 / Z;
  const meanAbsM = wAbsM / Z;
  const meanM2 = wM2 / Z;
  const meanM4 = wM4 / Z;
  return {
    // Undo the ground-state shift: Z_shifted = Z * e^{beta*eMin}. Weighted
    // averages are shift-invariant, the raw partition function is not. When T
    // is so low that Z itself exceeds the double range this honestly overflows
    // to Infinity while every average stays finite.
    Z: Z * Math.exp(-beta * eMin),
    energyPerSpin: meanE / n,
    absM: meanAbsM,
    m2: meanM2,
    m4: meanM4,
    chi: beta * n * (meanM2 - meanAbsM * meanAbsM),
    heatCapacity: (beta * beta * (meanE2 - meanE * meanE)) / n,
    binder: 1 - meanM4 / (3 * meanM2 * meanM2),
  };
}

/**
 * Closed-form 2x2 periodic-lattice solution at H = 0. With the right/down
 * bond convention the 2x2 system has 8 bond terms, so the Boltzmann weights
 * organise by bond sum: 2 states with E = -8J, 12 states with E = 0 and
 * 2 states with E = +8J, giving Z = 2 e^{8K} + 12 + 2 e^{-8K}.
 */
export function exact2x2(T: number, J: number): ExactObservables {
  const K = J / T;
  const beta = 1 / T;
  const e8 = Math.exp(8 * K);
  const e8m = Math.exp(-8 * K);
  const Z = 2 * e8 + 12 + 2 * e8m;
  const meanE = (-32 * J * Math.sinh(8 * K)) / Z;
  // <E^2> = 128 J^2 (e^{8K} + e^{-8K}) / Z  (weights 2e^{8K} at E=-8J, 2e^{-8K} at E=+8J)
  const meanE2 = (128 * J * J * (e8 + e8m)) / Z;
  const m2 = (2 * e8 + 2) / Z;
  const m4 = (2 * e8 + 0.5) / Z;
  const absM = (2 * e8 + 4) / Z;
  return {
    Z,
    energyPerSpin: meanE / 4,
    absM,
    m2,
    m4,
    chi: beta * 4 * (m2 - absM * absM),
    heatCapacity: (beta * beta * (meanE2 - meanE * meanE)) / 4,
    binder: 1 - m4 / (3 * m2 * m2),
  };
}

/**
 * Onsager's spontaneous magnetisation of the infinite 2-D Ising lattice,
 * m(T) = (1 - sinh^{-4}(2J/T))^{1/8} for T < Tc, 0 otherwise.
 * Reference: L. Onsager, Phys. Rev. 65, 117 (1944); Tc = 2J/ln(1+sqrt 2).
 */
export function onsagerMagnetization(T: number, J: number): number {
  if (T <= 0 || T >= ONSAGER_TC * J) return 0;
  const s = Math.sinh((2 * J) / T);
  return Math.pow(1 - Math.pow(s, -4), 0.125);
}

// --------------------------------------------------------------------------
// Tc estimation from a susceptibility curve
// --------------------------------------------------------------------------

export interface TcEstimate {
  tc: number;
  tcErr: number;
}

/**
 * Estimate the susceptibility-peak position. Interior maxima are refined by
 * a 3-point parabolic vertex; the uncertainty is derived from the half-maximum
 * width of the peak (tcErr = FWHM / 4, floored at half the point spacing) —
 * a conservative resolution-limited estimate, not a formal confidence bound.
 * Returns null when fewer than 3 finite points are supplied.
 */
export function estimateTcFromChi(points: Array<{ T: number; chi: number }>): TcEstimate | null {
  const pts = points
    .filter((q) => Number.isFinite(q.T) && Number.isFinite(q.chi) && q.T > 0)
    .sort((a, b) => a.T - b.T);
  if (pts.length < 3) return null;
  let imax = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i]!.chi > pts[imax]!.chi) imax = i;
  const spacing = Math.abs(pts[1]!.T - pts[0]!.T);
  if (imax === 0 || imax === pts.length - 1) {
    return { tc: pts[imax]!.T, tcErr: spacing };
  }
  const cl = pts[imax - 1]!;
  const cm = pts[imax]!;
  const cr = pts[imax + 1]!;

  // Least-squares parabola on up to 5 points centred on the discrete maximum
  // (3 points when the max sits one index from an edge). Coordinates are
  // centred on T[imax] for numerical conditioning; the vertex of the fitted
  // concave parabola is the Tc estimate.
  const hw = Math.min(2, Math.min(imax, pts.length - 1 - imax));
  const x0 = cm.T;
  let S0 = 0;
  let S1 = 0;
  let S2 = 0;
  let S3 = 0;
  let S4 = 0;
  let Y0 = 0;
  let Y1 = 0;
  let Y2 = 0;
  for (let i = imax - hw; i <= imax + hw; i++) {
    const u = pts[i]!.T - x0;
    const y = pts[i]!.chi;
    const u2 = u * u;
    S0 += 1;
    S1 += u;
    S2 += u2;
    S3 += u2 * u;
    S4 += u2 * u2;
    Y0 += y;
    Y1 += u * y;
    Y2 += u2 * y;
  }
  const det =
    S4 * (S2 * S0 - S1 * S1) - S3 * (S3 * S0 - S1 * S2) + S2 * (S3 * S1 - S2 * S2);
  const detA =
    Y2 * (S2 * S0 - S1 * S1) - S3 * (Y1 * S0 - S1 * Y0) + S2 * (Y1 * S1 - S2 * Y0);
  const detB =
    S4 * (Y1 * S0 - S1 * Y0) - Y2 * (S3 * S0 - S1 * S2) + S2 * (S3 * Y0 - Y1 * S2);
  let tc = cm.T;
  if (Number.isFinite(det) && Math.abs(det) > 1e-300) {
    const a = detA / det;
    const b = detB / det;
    if (a < -1e-300) tc = x0 - b / (2 * a);
  }
  tc = Math.min(Math.max(tc, cl.T), cr.T);

  // Half-maximum width -> uncertainty. On each flank the loop stops on the
  // first point *below* half, so the crossing sits between that point and the
  // last point at or above half; interpolate the crossing there.
  const half = cm.chi / 2;
  let i = imax;
  while (i > 0 && pts[i - 1]!.chi >= half) i--;
  let tLeft = pts[0]!.T;
  if (i > 0) {
    const lo = pts[i - 1]!; // chi < half
    const hi = pts[i]!; // chi >= half
    tLeft = lo.T + ((half - lo.chi) / Math.max(hi.chi - lo.chi, 1e-300)) * (hi.T - lo.T);
  }
  i = imax;
  while (i < pts.length - 1 && pts[i + 1]!.chi >= half) i++;
  let tRight = pts[pts.length - 1]!.T;
  if (i < pts.length - 1) {
    const hi = pts[i]!; // chi >= half
    const lo = pts[i + 1]!; // chi < half
    tRight = hi.T - ((hi.chi - half) / Math.max(hi.chi - lo.chi, 1e-300)) * (hi.T - lo.T);
  }
  const fwhm = Math.max(tRight - tLeft, 0);
  const tcErr = Math.max(fwhm / 4, spacing / 2);
  return { tc, tcErr };
}
