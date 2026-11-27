// ==========================================================================
// physics-pinn — kernel (pure TS, no DOM)
//
// A minimal tanh MLP with hand-written reverse-mode backprop. The loss is the
// PDE residual of the heat / viscous Burgers equation, evaluated with
// second-order central differences in the (xi, tau) = (2x-1, 2t-1) domain,
// plus soft initial- and boundary-condition penalties.
//
// The residual derivatives are finite-differenced, so the gradient produced by
// backprop is the exact gradient of the *discretised* residual — the standard
// "FD-PINN" variant. Everything is seeded and deterministic.
// ==========================================================================

export type PdeKind = 'heat' | 'burgers';

export interface PinnConfig {
  pde: PdeKind;
  /** Hidden units per layer. */
  width: number;
  /** Number of hidden layers (>= 1). */
  depth: number;
  lr: number;
  /** Collocation points for the PDE residual. */
  collocation: number;
  epochs: number;
  seed: number;
  /** True diffusivity (heat: alpha) / viscosity (Burgers: nu). */
  coef: number;
  /** Learn log(coef) alongside the weights (inverse PINN, heat only). */
  discover: boolean;
}

export interface CurvePoint {
  x: number;
  y: number;
}

export interface Profile {
  t: number;
  pred: CurvePoint[];
  ref: CurvePoint[];
}

export interface PinnSnapshot {
  pde: PdeKind;
  epochsDone: number;
  loss: number[];
  lossPde: number;
  lossIc: number;
  lossBc: number;
  /** Interior sensor misfit (inverse mode only; 0 in forward mode). */
  lossSensor: number;
  /** Relative L2 error of u against the reference over the snapshot times. */
  relL2: number;
  /** RMS of the PDE residual over the plot grid. */
  residualRms: number;
  coefTrue: number;
  /** Recovered coefficient when `discover` is on, else null. */
  coefHat: number | null;
  profiles: Profile[];
  /** Residual heat-map rows: residual[iy][ix], x fastest. */
  residual: number[][];
  nParams: number;
  ms: number;
}

export interface PinnBenchmark {
  name: string;
  ok: boolean;
  detail: string;
}

// ---- deterministic RNG ----------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- network --------------------------------------------------------------

interface Layer {
  nin: number;
  nout: number;
  w: Float64Array;
  b: Float64Array;
}

export interface Mlp {
  layers: Layer[];
}

interface ForwardCache {
  acts: Float64Array[];
  out: number;
}

function makeMlp(width: number, depth: number, rng: () => number): Mlp {
  const sizes = [2, ...Array.from({ length: depth }, () => width), 1];
  const layers: Layer[] = [];
  for (let l = 0; l + 1 < sizes.length; l += 1) {
    const nin = sizes[l] as number;
    const nout = sizes[l + 1] as number;
    const limit = Math.sqrt(6 / (nin + nout));
    const w = new Float64Array(nin * nout);
    const b = new Float64Array(nout);
    for (let i = 0; i < w.length; i += 1) w[i] = (rng() * 2 - 1) * limit;
    layers.push({ nin, nout, w, b });
  }
  return { layers };
}

function countParams(net: Mlp): number {
  let n = 0;
  for (const l of net.layers) n += l.w.length + l.b.length;
  return n;
}

function forward(net: Mlp, x: number, t: number): ForwardCache {
  const acts: Float64Array[] = [Float64Array.of(x, t)];
  let cur = acts[0] as Float64Array;
  for (let l = 0; l < net.layers.length; l += 1) {
    const L = net.layers[l] as Layer;
    const out = new Float64Array(L.nout);
    const last = l === net.layers.length - 1;
    for (let j = 0; j < L.nout; j += 1) {
      let s = L.b[j] as number;
      const row = j * L.nin;
      for (let i = 0; i < L.nin; i += 1) s += (L.w[row + i] as number) * (cur[i] as number);
      out[j] = last ? s : Math.tanh(s);
    }
    acts.push(out);
    cur = out;
  }
  return { acts, out: cur[0] as number };
}

function backward(net: Mlp, cache: ForwardCache, gradOut: number, grads: Grads): void {
  let delta = Float64Array.of(gradOut);
  for (let l = net.layers.length - 1; l >= 0; l -= 1) {
    const L = net.layers[l] as Layer;
    const prev = cache.acts[l] as Float64Array;
    const gw = grads.w[l] as Float64Array;
    const gb = grads.b[l] as Float64Array;
    for (let j = 0; j < L.nout; j += 1) {
      const dj = delta[j] as number;
      gb[j] = (gb[j] as number) + dj;
      const row = j * L.nin;
      for (let i = 0; i < L.nin; i += 1) gw[row + i] = (gw[row + i] as number) + dj * (prev[i] as number);
    }
    if (l === 0) break;
    const da = new Float64Array(L.nin);
    for (let j = 0; j < L.nout; j += 1) {
      const dj = delta[j] as number;
      const row = j * L.nin;
      for (let i = 0; i < L.nin; i += 1) da[i] = (da[i] as number) + dj * (L.w[row + i] as number);
    }
    const aPrev = cache.acts[l] as Float64Array;
    for (let i = 0; i < L.nin; i += 1) {
      const a = aPrev[i] as number;
      da[i] = (da[i] as number) * (1 - a * a);
    }
    delta = da;
  }
}

interface Grads {
  w: Float64Array[];
  b: Float64Array[];
}

function zeroGrads(net: Mlp): Grads {
  return {
    w: net.layers.map((l) => new Float64Array(l.w.length)),
    b: net.layers.map((l) => new Float64Array(l.b.length)),
  };
}

/** Adam optimiser over every weight/bias plus the optional log-coefficient. */
class Adam {
  private m: number[];
  private v: number[];
  private t = 0;

  constructor(
    private readonly params: { get(i: number): number; set(i: number, value: number): void; size: number },
    private lr: number,
    private readonly b1 = 0.9,
    private readonly b2 = 0.999,
    private readonly eps = 1e-8,
  ) {
    this.m = new Array(params.size).fill(0);
    this.v = new Array(params.size).fill(0);
  }

  /** Cosine-free linear decay schedule support (called once per epoch). */
  setLr(lr: number): void {
    this.lr = lr;
  }

  step(grad: number[]): void {
    this.t += 1;
    const c1 = 1 - Math.pow(this.b1, this.t);
    const c2 = 1 - Math.pow(this.b2, this.t);
    for (let i = 0; i < this.params.size; i += 1) {
      const g = grad[i] as number;
      const m = this.b1 * (this.m[i] as number) + (1 - this.b1) * g;
      const v = this.b2 * (this.v[i] as number) + (1 - this.b2) * g * g;
      this.m[i] = m;
      this.v[i] = v;
      const mh = m / c1;
      const vh = v / c2;
      this.params.set(i, this.params.get(i) - (this.lr * mh) / (Math.sqrt(vh) + this.eps));
    }
  }
}

// ---- reference solutions --------------------------------------------------

export function heatExact(x: number, t: number, alpha: number): number {
  return Math.exp(-alpha * Math.PI * Math.PI * t) * Math.sin(Math.PI * x);
}

/**
 * Explicit finite-difference reference for the viscous Burgers equation
 * u_t + u u_x = nu u_xx on x in [0,1], t in [0,1], u(x,0) = -sin(pi x),
 * u(0,t) = u(1,t) = 0. Returns snapshots on the shared x grid.
 */
export function burgersReference(nu: number, xs: number[], times: number[]): number[][] {
  const nx = 101;
  const dx = 1 / (nx - 1);
  const u = new Float64Array(nx);
  for (let i = 0; i < nx; i += 1) u[i] = -Math.sin(Math.PI * (i * dx));
  const dt = Math.min(0.4 * (dx * dx) / Math.max(nu, 1e-6), 0.4 * dx, 1e-3);
  const steps = Math.ceil(1 / dt);
  const dtEff = 1 / steps;
  const next = new Float64Array(nx);
  const out: number[][] = [];
  let target = 0;
  for (let s = 1; s <= steps; s += 1) {
    const tNow = s * dtEff;
    for (let i = 1; i < nx - 1; i += 1) {
      const ui = u[i] as number;
      const uL = u[i - 1] as number;
      const uR = u[i + 1] as number;
      const advect = ui * (uR - uL) / (2 * dx);
      const diffuse = nu * (uR - 2 * ui + uL) / (dx * dx);
      next[i] = ui + dtEff * (-advect + diffuse);
    }
    next[0] = 0;
    next[nx - 1] = 0;
    u.set(next);
    while (target < times.length && tNow >= (times[target] as number) - 1e-12) {
      const xsRow: number[] = [];
      for (const x of xs) {
        const pos = Math.min(nx - 1, Math.max(0, x * (nx - 1)));
        const i0 = Math.floor(pos);
        const i1 = Math.min(nx - 1, i0 + 1);
        const f = pos - i0;
        xsRow.push((u[i0] as number) * (1 - f) + (u[i1] as number) * f);
      }
      out.push(xsRow);
      target += 1;
    }
  }
  while (out.length < times.length) out.push(new Array(xs.length).fill(0));
  return out;
}

// ---- trainer --------------------------------------------------------------

const SNAP_T = [0, 0.25, 0.5, 0.75, 1];
const X_POINTS = 81;
const FD = 0.03;

interface Sample {
  x: number;
  t: number;
}

interface ResidualTerm {
  cache: ForwardCache;
  weight: number;
}

interface ResidualEval {
  r: number;
  terms: ResidualTerm[];
  /** u_xi_xi at the centre point (needed for the inverse-alpha gradient). */
  uxx: number;
}

/**
 * Fourth-order central-difference evaluation of the PDE residual in the
 * normalized (xi, tau) frame. Returns the value plus the linear weights of
 * every network evaluation, so reverse-mode can be applied exactly to the
 * discretised residual.
 */
function evalResidual(
  net: Mlp,
  xi: number,
  tau: number,
  coef: number,
  pde: PdeKind,
  h = FD,
): ResidualEval {
  const c0 = forward(net, xi, tau);
  const xp1 = forward(net, xi + h, tau);
  const xm1 = forward(net, xi - h, tau);
  const xp2 = forward(net, xi + 2 * h, tau);
  const xm2 = forward(net, xi - 2 * h, tau);
  const tp1 = forward(net, xi, tau + h);
  const tm1 = forward(net, xi, tau - h);
  const tp2 = forward(net, xi, tau + 2 * h);
  const tm2 = forward(net, xi, tau - 2 * h);

  const u = c0.out;
  const h2 = 12 * h * h;
  const q = 12 * h;
  const ux = (xm2.out - 8 * xm1.out + 8 * xp1.out - xp2.out) / q;
  const uxx = (-xm2.out + 16 * xm1.out - 30 * u + 16 * xp1.out - xp2.out) / h2;
  const ut = (tm2.out - 8 * tm1.out + 8 * tp1.out - tp2.out) / q;

  const terms: ResidualTerm[] = [];
  let r: number;
  if (pde === 'heat') {
    r = ut - 2 * coef * uxx;
    terms.push(
      { cache: c0, weight: (60 * coef) / h2 },
      { cache: xp1, weight: (-32 * coef) / h2 },
      { cache: xm1, weight: (-32 * coef) / h2 },
      { cache: xp2, weight: (2 * coef) / h2 },
      { cache: xm2, weight: (2 * coef) / h2 },
      { cache: tp2, weight: -1 / q },
      { cache: tp1, weight: 8 / q },
      { cache: tm1, weight: -8 / q },
      { cache: tm2, weight: 1 / q },
    );
  } else {
    r = ut + u * ux - 2 * coef * uxx;
    terms.push(
      { cache: c0, weight: ux + (60 * coef) / h2 },
      { cache: xp1, weight: u * (8 / q) - (32 * coef) / h2 },
      { cache: xm1, weight: u * (-8 / q) - (32 * coef) / h2 },
      { cache: xp2, weight: u * (-1 / q) + (2 * coef) / h2 },
      { cache: xm2, weight: u * (1 / q) + (2 * coef) / h2 },
      { cache: tp2, weight: -1 / q },
      { cache: tp1, weight: 8 / q },
      { cache: tm1, weight: -8 / q },
      { cache: tm2, weight: 1 / q },
    );
  }
  return { r, terms, uxx };
}

export class PinnTrainer {
  private net: Mlp;
  private grads: Grads;
  private adam: Adam;
  private logCoef: number;
  private coefAdam: Adam | null;
  private rng: () => number;
  private coll: Sample[] = [];
  private ic: Sample[] = [];
  private bc: Sample[] = [];
  /** Sparse interior observations that make the inverse problem identifiable. */
  private sensors: Array<Sample & { y: number }> = [];
  private lossHistory: number[] = [];
  private lossPde = 0;
  private lossIc = 0;
  private lossBc = 0;
  private lossSensor = 0;
  private coefGradAcc = 0;
  private epochsDone = 0;
  private readonly t0 = performance.now();

  readonly cfg: PinnConfig;

  constructor(cfg: PinnConfig) {
    this.cfg = cfg;
    this.rng = mulberry32(cfg.seed);
    this.net = makeMlp(cfg.width, cfg.depth, this.rng);
    this.grads = zeroGrads(this.net);
    this.adam = new Adam(this.flatParams(), cfg.lr);
    this.logCoef = Math.log(cfg.coef);
    this.coefAdam = cfg.discover
      ? new Adam(
          {
            size: 1,
            get: () => this.logCoef,
            set: (_i, value) => {
              // Clamp the learned coefficient to a physically plausible band.
              this.logCoef = Math.min(Math.log(1), Math.max(Math.log(1e-3), value));
            },
          },
          cfg.lr * 0.5,
        )
      : null;

    const nCol = Math.max(32, Math.round(cfg.collocation));
    for (let i = 0; i < nCol; i += 1) {
      this.coll.push({ x: this.rng(), t: this.rng() });
    }
    const nIc = 48;
    for (let i = 0; i < nIc; i += 1) {
      this.ic.push({ x: (i + 0.5) / nIc, t: 0 });
    }
    const nBc = 48;
    for (let i = 0; i < nBc; i += 1) {
      this.bc.push({ x: 0, t: (i + 0.5) / nBc });
      this.bc.push({ x: 1, t: (i + 0.5) / nBc });
    }
    // Inverse mode: without interior measurements every diffusivity value
    // admits its own valid solution (the residual + IC/BC are alpha-blind), so
    // the coefficient would be unidentifiable. A handful of noisy-free sensor
    // readings is exactly the "inverse PINN" setup from the literature.
    if (cfg.discover && cfg.pde === 'heat') {
      for (let i = 0; i < 16; i += 1) {
        const x = 0.08 + 0.84 * this.rng();
        const t = 0.05 + 0.9 * this.rng();
        this.sensors.push({ x, t, y: heatExact(x, t, cfg.coef) });
      }
    }
  }

  private flatParams(): { get(i: number): number; set(i: number, v: number): void; size: number } {
    const sizes = this.net.layers.map((l) => l.w.length + l.b.length);
    const net = this.net;
    const offsets: number[] = [];
    let acc = 0;
    for (const s of sizes) {
      offsets.push(acc);
      acc += s;
    }
    return {
      size: acc,
      get: (i) => {
        for (let l = net.layers.length - 1; l >= 0; l -= 1) {
          const off = offsets[l] as number;
          if (i >= off) {
            const layer = net.layers[l] as Layer;
            const j = i - off;
            return j < layer.w.length ? (layer.w[j] as number) : (layer.b[j - layer.w.length] as number);
          }
        }
        return 0;
      },
      set: (i, v) => {
        for (let l = net.layers.length - 1; l >= 0; l -= 1) {
          const off = offsets[l] as number;
          if (i >= off) {
            const layer = net.layers[l] as Layer;
            const j = i - off;
            if (j < layer.w.length) layer.w[j] = v;
            else layer.b[j - layer.w.length] = v;
            return;
          }
        }
      },
    };
  }

  get done(): boolean {
    return this.epochsDone >= this.cfg.epochs;
  }

  get history(): number[] {
    return this.lossHistory;
  }

  /** Train one epoch; returns the mean total loss of that epoch. */
  step(): number {
    const net = this.net;
    const grads = this.grads;
    // Linear learning-rate decay to 10% of the initial value: the residual
    // landscape is stiff and a constant step leaves the final iterate noisy.
    const progress = Math.min(1, this.epochsDone / Math.max(1, this.cfg.epochs));
    this.adam.setLr(this.cfg.lr * (1 - 0.9 * progress));
    grads.w.forEach((g) => g.fill(0));
    grads.b.forEach((g) => g.fill(0));
    this.coefGradAcc = 0;

    const coef = Math.exp(this.logCoef);
    const nCol = this.coll.length;
    let pdeSum = 0;

    // --- PDE residual ---
    for (const p of this.coll) {
      const xi = 2 * p.x - 1;
      const tau = 2 * p.t - 1;
      const ev = evalResidual(net, xi, tau, coef, this.cfg.pde);
      pdeSum += ev.r * ev.r;
      if (this.cfg.pde === 'heat' && this.cfg.discover) {
        this.coefGradAcc += 2 * ev.r * (-2 * ev.uxx);
      }
      const g = 2 * ev.r;
      for (const term of ev.terms) backward(net, term.cache, g * term.weight, grads);
    }

    // --- initial / boundary conditions (soft constraints, weight 100) ---
    const dataWeight = 100;
    let icSum = 0;
    for (const p of this.ic) {
      const f = forward(net, 2 * p.x - 1, -1);
      const target = this.cfg.pde === 'heat' ? Math.sin(Math.PI * p.x) : -Math.sin(Math.PI * p.x);
      const d = f.out - target;
      icSum += d * d;
      backward(net, f, (2 * dataWeight * d) / this.ic.length, grads);
    }
    let bcSum = 0;
    for (const p of this.bc) {
      const f = forward(net, 2 * p.x - 1, 2 * p.t - 1);
      bcSum += f.out * f.out;
      backward(net, f, (2 * dataWeight * f.out) / this.bc.length, grads);
    }
    let sensorSum = 0;
    for (const p of this.sensors) {
      const f = forward(net, 2 * p.x - 1, 2 * p.t - 1);
      const d = f.out - p.y;
      sensorSum += d * d;
      backward(net, f, (2 * dataWeight * d) / this.sensors.length, grads);
    }

    const pdeLoss = pdeSum / nCol;
    const icLoss = icSum / this.ic.length;
    const bcLoss = bcSum / this.bc.length;
    const sensorLoss = this.sensors.length ? sensorSum / this.sensors.length : 0;
    const total = pdeLoss + dataWeight * (icLoss + bcLoss + sensorLoss);

    // --- Adam update ---
    const flatGrad: number[] = [];
    for (let l = 0; l < net.layers.length; l += 1) {
      const gw = grads.w[l] as Float64Array;
      const gb = grads.b[l] as Float64Array;
      for (let i = 0; i < gw.length; i += 1) flatGrad.push(gw[i] as number);
      for (let i = 0; i < gb.length; i += 1) flatGrad.push(gb[i] as number);
    }
    this.adam.step(flatGrad);
    if (this.coefAdam) {
      const dLog = Math.exp(this.logCoef) * this.coefGradAcc;
      this.coefAdam.step([dLog]);
    }

    this.lossPde = pdeLoss;
    this.lossIc = icLoss;
    this.lossBc = bcLoss;
    this.lossSensor = sensorLoss;
    this.lossHistory.push(total);
    this.epochsDone += 1;
    return total;
  }

  /** Evaluate the current network into a display-ready snapshot. */
  snapshot(): PinnSnapshot {
    const net = this.net;
    const xs = Array.from({ length: X_POINTS }, (_, i) => i / (X_POINTS - 1));
    const refRows =
      this.cfg.pde === 'heat'
        ? SNAP_T.map((t) => xs.map((x) => heatExact(x, t, this.cfg.coef)))
        : burgersReference(this.cfg.coef, xs, SNAP_T);

    const profiles: Profile[] = SNAP_T.map((t, k) => ({
      t,
      pred: xs.map((x) => ({ x, y: forward(net, 2 * x - 1, 2 * t - 1).out })),
      ref: xs.map((x, i) => ({ x, y: (refRows[k] as number[])[i] as number })),
    }));

    // Relative L2 across the snapshot grid.
    let num = 0;
    let den = 0;
    for (let k = 0; k < profiles.length; k += 1) {
      const p = profiles[k] as Profile;
      for (let i = 0; i < p.pred.length; i += 1) {
        const d = (p.pred[i] as CurvePoint).y - (p.ref[i] as CurvePoint).y;
        num += d * d;
        den += (p.ref[i] as CurvePoint).y * (p.ref[i] as CurvePoint).y;
      }
    }
    const relL2 = Math.sqrt(num / Math.max(den, 1e-12));

    // Residual map over the full (x, t) square.
    const nx = 49;
    const nt = 33;
    const residual: number[][] = [];
    let rsum = 0;
    let rcount = 0;
    const coef = Math.exp(this.logCoef);
    for (let j = 0; j < nt; j += 1) {
      const row: number[] = [];
      const t = j / (nt - 1);
      for (let i = 0; i < nx; i += 1) {
        const x = i / (nx - 1);
        const xi = 2 * x - 1;
        const tau = 2 * t - 1;
        const r = evalResidual(net, xi, tau, coef, this.cfg.pde).r;
        row.push(r);
        rsum += r * r;
        rcount += 1;
      }
      residual.push(row);
    }

    return {
      pde: this.cfg.pde,
      epochsDone: this.epochsDone,
      loss: this.lossHistory.slice(),
      lossPde: this.lossPde,
      lossIc: this.lossIc,
      lossBc: this.lossBc,
      lossSensor: this.lossSensor,
      relL2,
      residualRms: Math.sqrt(rsum / Math.max(1, rcount)),
      coefTrue: this.cfg.coef,
      coefHat: this.cfg.discover ? Math.exp(this.logCoef) : null,
      profiles,
      residual,
      nParams: countParams(this.net) + (this.cfg.discover ? 1 : 0),
      ms: performance.now() - this.t0,
    };
  }
}

// ---- self-check -----------------------------------------------------------

/** Analytic heat solution must satisfy the PDE and the network-free checks. */
export function runPinnBenchmarks(): PinnBenchmark[] {
  const out: PinnBenchmark[] = [];
  const alpha = 0.1;
  const x = 0.37;
  const t = 0.42;
  const u = heatExact(x, t, alpha);
  // Residual of the analytic solution via the same FD stencil the trainer uses.
  const h = 1e-3;
  const ut = (heatExact(x, t + h, alpha) - heatExact(x, t - h, alpha)) / (2 * h);
  const uxx = (heatExact(x + h, t, alpha) - 2 * u + heatExact(x - h, t, alpha)) / (h * h);
  const res = Math.abs(ut - alpha * uxx);
  out.push({
    name: 'heat analytic residual',
    ok: res < 1e-5,
    detail: `|u_t - alpha u_xx| = ${res.toExponential(2)} at (${x}, ${t})`,
  });

  const ref = burgersReference(0.05, [0, 0.25, 0.5, 0.75, 1], [0, 0.5, 1]);
  const bcOk = ref.every((row) => Math.abs(row[0] as number) < 1e-12 && Math.abs(row[4] as number) < 1e-12);
  const finite = ref.every((row) => row.every((v) => Number.isFinite(v)));
  out.push({
    name: 'Burgers reference sanity',
    ok: bcOk && finite,
    detail: bcOk && finite ? 'zero BCs preserved, all values finite' : 'boundary or finiteness check failed',
  });

  return out;
}
