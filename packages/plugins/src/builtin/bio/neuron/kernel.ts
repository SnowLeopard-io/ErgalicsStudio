// ==========================================================================
// bio-neuron — Hodgkin & Huxley (1952) giant-axon model, pure numerics.
//
// Original published constants: gNa = 120, gK = 36, gL = 0.3 mS/cm²;
// ENa = 50, EK = −77, EL = −54.4 mV; Cm = 1 µF/cm². Rate expressions are the
// 1952 originals on the absolute V scale (rest ≈ −65 mV) with a Q10 = 3
// temperature factor referenced to 6.3 °C. Integrated by classical RK4.
// ==========================================================================

export const CM = 1; // membrane capacitance, µF/cm²
export const REST_V = -65; // mV — fixed point of the 1952 system

export interface HHParams {
  gNa: number; // mS/cm²
  gK: number; // mS/cm²
  gL: number; // mS/cm²
  eNa: number; // mV
  eK: number; // mV
  eL: number; // mV
  tempC: number; // °C
}

export const DEFAULT_HH_PARAMS: HHParams = {
  gNa: 120,
  gK: 36,
  gL: 0.3,
  eNa: 50,
  eK: -77,
  eL: -54.4,
  tempC: 6.3,
};

export interface HHStim {
  hold: number; // sustained injected current, µA/cm²
  pulseAmp: number; // brief pulse amplitude, µA/cm²
  pulseStart: number; // ms
  pulseDur: number; // ms
}

export const DEFAULT_STIM: HHStim = { hold: 0, pulseAmp: 10, pulseStart: 5, pulseDur: 2 };

/** x/(1−e^(−x/y)) with the removable singularity at x→0 handled by series. */
export function vtrap(x: number, y: number): number {
  const u = x / y;
  if (Math.abs(u) < 1e-6) return y * (1 + u / 2);
  return x / (1 - Math.exp(-u));
}

export const alphaN = (V: number): number => 0.01 * vtrap(V + 55, 10);
export const betaN = (V: number): number => 0.125 * Math.exp(-(V + 65) / 80);
export const alphaM = (V: number): number => 0.1 * vtrap(V + 40, 10);
export const betaM = (V: number): number => 4 * Math.exp(-(V + 65) / 18);
export const alphaH = (V: number): number => 0.07 * Math.exp(-(V + 65) / 20);
export const betaH = (V: number): number => 1 / (1 + Math.exp(-(V + 35) / 10));

/** Steady-state activations and gate time constants at membrane potential V. */
export function gatingAt(V: number): {
  mInf: number;
  hInf: number;
  nInf: number;
  tauM: number;
  tauH: number;
  tauN: number;
} {
  const am = alphaM(V);
  const bm = betaM(V);
  const ah = alphaH(V);
  const bh = betaH(V);
  const an = alphaN(V);
  const bn = betaN(V);
  return {
    mInf: am / (am + bm),
    hInf: ah / (ah + bh),
    nInf: an / (an + bn),
    tauM: 1 / (am + bm),
    tauH: 1 / (ah + bh),
    tauN: 1 / (an + bn),
  };
}

/** Q10 = 3 rate scaling referenced to 6.3 °C (Hodgkin & Huxley 1952). */
export function phiFactor(tempC: number): number {
  return Math.pow(3, (tempC - 6.3) / 10);
}

/** [V, m, h, n] — membrane potential (mV) and the three gating variables. */
export type HHState = [number, number, number, number];

/** Injected current (µA/cm²) at time t: sustained hold plus optional pulse. */
export function stimCurrent(s: HHStim, t: number): number {
  const inPulse = t >= s.pulseStart && t < s.pulseStart + s.pulseDur;
  return s.hold + (inPulse ? s.pulseAmp : 0);
}

/** d[V,m,h,n]/dt at state y under injected current I (µA/cm²). */
export function hhDeriv(y: HHState, p: HHParams, iStim: number, phi: number): HHState {
  const V = y[0];
  const m = y[1];
  const h = y[2];
  const n = y[3];
  const iNa = p.gNa * m * m * m * h * (V - p.eNa);
  const iK = p.gK * n * n * n * n * (V - p.eK);
  const iL = p.gL * (V - p.eL);
  const dV = (iStim - iNa - iK - iL) / CM;
  const dm = phi * (alphaM(V) * (1 - m) - betaM(V) * m);
  const dh = phi * (alphaH(V) * (1 - h) - betaH(V) * h);
  const dn = phi * (alphaN(V) * (1 - n) - betaN(V) * n);
  return [dV, dm, dh, dn];
}

export interface HHSeries {
  times: number[]; // ms
  v: number[]; // mV
  m: number[];
  h: number[];
  n: number[];
  i: number[]; // injected current at each sample, µA/cm²
}

/** Classical RK4 integration of the HH system from rest at V = −65 mV. */
export function simulateHH(p: HHParams, stim: HHStim, tMaxMs: number, dt = 0.01): HHSeries {
  const steps = Math.max(2, Math.round(tMaxMs / dt));
  const n = steps + 1;
  const times = new Array<number>(n);
  const vs = new Array<number>(n);
  const ms = new Array<number>(n);
  const hs = new Array<number>(n);
  const ns = new Array<number>(n);
  const is = new Array<number>(n);
  const phi = phiFactor(p.tempC);
  const g = gatingAt(REST_V);
  let y: HHState = [REST_V, g.mInf, g.hInf, g.nInf];
  times[0] = 0;
  vs[0] = y[0];
  ms[0] = y[1];
  hs[0] = y[2];
  ns[0] = y[3];
  is[0] = stimCurrent(stim, 0);
  const add = (a: HHState, b: HHState, f: number): HHState => [
    a[0] + b[0] * f,
    a[1] + b[1] * f,
    a[2] + b[2] * f,
    a[3] + b[3] * f,
  ];
  for (let i = 0; i < steps; i += 1) {
    const t = i * dt;
    const k1 = hhDeriv(y, p, stimCurrent(stim, t), phi);
    const k2 = hhDeriv(add(y, k1, dt / 2), p, stimCurrent(stim, t + dt / 2), phi);
    const k3 = hhDeriv(add(y, k2, dt / 2), p, stimCurrent(stim, t + dt / 2), phi);
    const k4 = hhDeriv(add(y, k3, dt), p, stimCurrent(stim, t + dt), phi);
    y = [
      y[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
      y[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
      y[2] + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
      y[3] + (dt / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]),
    ];
    times[i + 1] = (i + 1) * dt;
    vs[i + 1] = y[0];
    ms[i + 1] = y[1];
    hs[i + 1] = y[2];
    ns[i + 1] = y[3];
    is[i + 1] = stimCurrent(stim, (i + 1) * dt);
  }
  return { times, v: vs, m: ms, h: hs, n: ns, i: is };
}

/** Count action potentials as upward crossings of 0 mV. */
export function countSpikes(v: ArrayLike<number>): number {
  let c = 0;
  for (let i = 1; i < v.length; i += 1) {
    if (v[i - 1]! < 0 && v[i]! >= 0) c += 1;
  }
  return c;
}

/** Repetitive firing rate (Hz) under a sustained current. */
export function firingRate(p: HHParams, hold: number, tMaxMs = 200, dt = 0.01): number {
  const s = simulateHH(p, { hold, pulseAmp: 0, pulseStart: 0, pulseDur: 0 }, tMaxMs, dt);
  return countSpikes(s.v) / (tMaxMs / 1000);
}

// ---- embedded validation benchmarks ---------------------------------------------

export interface HhBenchmark {
  key: string;
  label: string;
  display: string;
  pass: boolean;
  hint: string;
}

/**
 * Validation battery against analytic/structural facts of the 1952 system:
 *  1. V = −65 mV is a fixed point (hold = 0 → stays within 0.5 mV over 100 ms)
 *  2. 10 µA/cm², 2 ms pulse → suprathreshold spike (peak > 0 mV)
 *  3. 2 µA/cm², 2 ms pulse → subthreshold response (peak < 0 mV) that
 *     relaxes back to rest within 1 mV
 *  4. Firing rate increases monotonically for sustained 10/20/40 µA/cm²
 */
export function runHhBenchmarks(dt = 0.01): HhBenchmark[] {
  const p = DEFAULT_HH_PARAMS;
  const noStim: HHStim = { hold: 0, pulseAmp: 0, pulseStart: 0, pulseDur: 0 };
  const rest = simulateHH(p, noStim, 100, dt);
  const restErr = Math.abs(rest.v[rest.v.length - 1]! - REST_V);
  const spike = simulateHH(p, { hold: 0, pulseAmp: 10, pulseStart: 5, pulseDur: 2 }, 30, dt);
  const peak = Math.max(...spike.v);
  const sub = simulateHH(p, { hold: 0, pulseAmp: 2, pulseStart: 5, pulseDur: 2 }, 60, dt);
  const subPeak = Math.max(...sub.v);
  const subReturn = Math.abs(sub.v[sub.v.length - 1]! - REST_V);
  const r10 = firingRate(p, 10, 200, dt);
  const r20 = firingRate(p, 20, 200, dt);
  const r40 = firingRate(p, 40, 200, dt);
  return [
    {
      key: 'rest',
      label: '|V_rest − (−65)| < 0.5 mV',
      display: `${restErr.toFixed(4)} mV`,
      pass: restErr < 0.5,
      hint: 'hold = 0, 100 ms — V = −65 mV is a fixed point of the 1952 rates',
    },
    {
      key: 'spike',
      label: '10 µA·2 ms pulse → peak > 0 mV',
      display: `${peak.toFixed(1)} mV`,
      pass: peak > 0,
      hint: 'suprathreshold single action potential',
    },
    {
      key: 'sub-peak',
      label: '2 µA·2 ms pulse → peak < 0 mV',
      display: `${subPeak.toFixed(1)} mV`,
      pass: subPeak < 0,
      hint: 'subthreshold response — no spike',
    },
    {
      key: 'sub-return',
      label: 'subthreshold returns to rest (|ΔV| < 1 mV)',
      display: `${subReturn.toFixed(4)} mV`,
      pass: subReturn < 1,
      hint: 'membrane relaxes back to −65 mV after a failed trigger',
    },
    {
      key: 'fi-monotonic',
      label: 'rate monotonic in I (10/20/40 µA)',
      display: `${r10.toFixed(0)}/${r20.toFixed(0)}/${r40.toFixed(0)} Hz`,
      pass: r10 > 0 && r20 > r10 && r40 > r20,
      hint: 'sustained-current F–I ordering',
    },
  ];
}
