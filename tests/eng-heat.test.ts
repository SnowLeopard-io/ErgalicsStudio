import { describe, expect, it } from 'vitest';
import {
  FLUID_PRESETS,
  G_ACC,
  PLANCK_C1,
  PLANCK_C2,
  STEFAN_BOLTZMANN,
  WIEN_CONSTANT,
  type ConductionParams,
  analyzeHeatRow,
  blackbodyEmission,
  churchillChuNu,
  dittusBoelterNu,
  effectivenessNtu,
  exchangerProfiles,
  lumpedCooling,
  marchingSquares,
  parseHeatInput,
  parseLayerSpec,
  planckSweep,
  solveConduction,
  solveConvection,
  solveExchanger,
  solveRadiation,
  solveResistance,
  viewFactorDisks,
  viewFactorRects,
  wienPeakWavelength,
} from '../src/plugins/builtin/engineering/heat-transfer/kernel';

/** Unified benchmark yardstick: |computed - reference| / |reference|. */
function relErr(computed: number, reference: number): number {
  return Math.abs(computed - reference) / Math.abs(reference);
}

const edge = (kind: ConductionParams['edges']['left']['kind'], value: number) => ({ kind, value });

describe('eng-heat benchmark: 1-D steady conduction (q = k*dT/L)', () => {
  // Plate W = 0.1 m with insulated top/bottom faces: the 2-D solver must
  // recover the 1-D linear field T(x) = 373 - 800 x and flux k*dT/W = 40 kW/m2.
  const p: ConductionParams = {
    W: 0.1, H: 0.02, nx: 41, ny: 11, alpha: 1.3e-5, k: 50,
    edges: { left: edge('dirichlet', 373), right: edge('dirichlet', 293), top: edge('insulated', 0), bottom: edge('insulated', 0) },
    hConv: 10, tInf: 300,
    source: { enabled: false, cx: 0.5, cy: 0.5, r: 0.1, q: 0 },
    scheme: 'adi', runMode: 'steady', tEnd: 1, dt: 0,
  };

  it('recovers the linear steady field and the exact FD flux', () => {
    const r = solveConduction(p);
    expect(r.converged).toBe(true);
    expect(r.residual).toBeLessThan(1e-3);
    const dx = p.W / (p.nx - 1);
    const jMid = Math.floor(p.ny / 2);
    for (let i = 0; i < p.nx; i += 1) {
      const xExact = 373 - (373 - 293) * ((i * dx) / p.W);
      expect(Math.abs(r.T[jMid * p.nx + i]! - xExact)).toBeLessThan(0.05);
    }
    // Central difference flux at the mid node (exact for a linear field).
    const c = jMid * p.nx + Math.floor(p.nx / 2);
    const qFd = (p.k * (r.T[c - 1]! - r.T[c + 1]!)) / (2 * dx);
    expect(relErr(qFd, (p.k * (373 - 293)) / p.W)).toBeLessThan(1e-3);
    expect(Math.abs(r.maxT - 373)).toBeLessThan(0.05);
    expect(Math.abs(r.minT - 293)).toBeLessThan(0.05);
  });

  it('is y-invariant with insulated top/bottom faces', () => {
    const r = solveConduction(p);
    for (let i = 1; i < p.nx - 1; i += 1) {
      for (let j = 1; j < p.ny - 1; j += 1) {
        expect(Math.abs(r.T[j * p.nx + i]! - r.T[i]!)).toBeLessThan(0.05);
      }
    }
  });
});

describe('eng-heat benchmark: lumped transient T/T0 = exp(-Bi*Fo)', () => {
  // Small-Bi cooling of an initially uniform plate, all faces convective:
  // W = H = 0.2 m, h = 20, T0 = 350 K, Tinf = 300 K, k = 50, alpha = 1.3e-5.
  // Lc = WH/(2(W+H)) = 0.05 m -> Bi = 0.02, Bi*Fo = 1.04e-4 * t.
  const p: ConductionParams = {
    W: 0.2, H: 0.2, nx: 21, ny: 21, alpha: 1.3e-5, k: 50,
    edges: {
      left: edge('convection', 0), right: edge('convection', 0),
      top: edge('convection', 0), bottom: edge('convection', 0),
    },
    hConv: 20, tInf: 300,
    source: { enabled: false, cx: 0.5, cy: 0.5, r: 0.1, q: 0 },
    scheme: 'adi', runMode: 'transient', tEnd: 6000, dt: 0, initT: 350,
  };
  const lc = (p.W * p.H) / (2 * (p.W + p.H));
  const bi = (p.hConv * lc) / p.k;
  const fo = (p.alpha * p.tEnd) / (lc * lc);

  it('matches the lumped-capacitance decay within the O(Bi) window', () => {
    const r = solveConduction(p);
    const thetaNum = (r.meanT - p.tInf) / (p.initT! - p.tInf);
    const thetaLumped = lumpedCooling(bi, fo);
    expect(relErr(thetaNum, thetaLumped)).toBeLessThan(0.02);
    // Bi = 0.02 -> the field stays nearly uniform during the transient.
    expect(r.maxT - r.minT).toBeLessThan(2);
    expect(r.time).toBeCloseTo(p.tEnd, 6);
  });

  it('lumpedCooling is the textbook exponential', () => {
    expect(lumpedCooling(0.02, 10)).toBeCloseTo(Math.exp(-0.2), 15);
  });
});

describe('eng-heat benchmark: convection correlations', () => {
  const air = FLUID_PRESETS.air;
  const water = FLUID_PRESETS.water;

  it('flat-plate laminar Nu = 0.664 Re^0.5 Pr^(1/3)', () => {
    const r = solveConvection({ geom: 'plate', fluid: air, u: 1, L: 0.05, tSurf: 320, tInf: 300 });
    const re = (1 * 0.05) / air.nu;
    expect(r.re).toBeCloseTo(re, 9);
    expect(r.regime).toBe('laminar');
    expect(r.nu).toBeCloseTo(0.664 * Math.sqrt(re) * Math.cbrt(air.pr), 12);
    expect(r.h).toBeCloseTo((r.nu * air.k) / 0.05, 12);
  });

  it('flat-plate mixed-turbulent Nu = (0.037 Re^0.8 - 871) Pr^(1/3)', () => {
    const r = solveConvection({ geom: 'plate', fluid: air, u: 30, L: 0.5, tSurf: 320, tInf: 300 });
    const re = (30 * 0.5) / air.nu;
    expect(re).toBeGreaterThan(5e5);
    expect(r.regime).toBe('mixed / turbulent');
    expect(r.nu).toBeCloseTo((0.037 * Math.pow(re, 0.8) - 871) * Math.cbrt(air.pr), 12);
  });

  it('internal laminar tube Nu = 3.66 and turbulent Dittus-Boelter', () => {
    const lam = solveConvection({ geom: 'tube', fluid: water, u: 0.01, L: 0.02, tSurf: 320, tInf: 300 });
    expect(lam.re).toBeLessThan(2300);
    expect(lam.nu).toBe(3.66);
    const turb = solveConvection({ geom: 'tube', fluid: water, u: 2, L: 0.02, tSurf: 330, tInf: 300 });
    const re = (2 * 0.02) / water.nu;
    expect(turb.regime).toBe('turbulent');
    expect(turb.nu).toBeCloseTo(dittusBoelterNu(re, water.pr, true), 12);
  });

  it('Churchill-Chu vs simplified Nu = 0.59 Ra^0.25 agrees within ~10 % mid-range', () => {
    // Air at ~300 K, vertical plate L = 0.3 m, two surface superheats.
    for (const dT of [20, 40]) {
      const r = solveConvection({ geom: 'vplate', fluid: air, u: 1, L: 0.3, tSurf: 300 + dT, tInf: 300 });
      const alphaDiff = air.nu / air.pr;
      const raRef = (G_ACC * air.beta * dT * 0.3 ** 3) / (air.nu * alphaDiff);
      expect(r.re).toBe(0);
      expect(relErr(r.ra, raRef)).toBeLessThan(1e-12);
      expect(r.ra).toBeGreaterThan(1e6); // mid-range: away from both asymptotes
      expect(r.ra).toBeLessThan(1e9);
      expect(r.regime).toBe('laminar');
      const cc = churchillChuNu(r.ra, air.pr);
      expect(r.nu).toBeCloseTo(cc, 12);
      const simplified = 0.59 * Math.pow(r.ra, 0.25);
      expect(relErr(cc, simplified)).toBeLessThan(0.10);
      expect(r.h).toBeCloseTo((cc * air.k) / 0.3, 12);
    }
  });
});

describe('eng-heat benchmark: Stefan-Boltzmann, Wien and Planck spectrum', () => {
  it('uses the CODATA 2018 sigma and exact T^4 scaling', () => {
    expect(STEFAN_BOLTZMANN).toBe(5.670374419e-8);
    expect(blackbodyEmission(5778)).toBeCloseTo(STEFAN_BOLTZMANN * 5778 ** 4, 6);
    expect(blackbodyEmission(1000) / blackbodyEmission(500)).toBeCloseTo(16, 12);
  });

  it('Wien peak satisfies lambda_max * T = b', () => {
    expect(WIEN_CONSTANT).toBeCloseTo(2.897771955e-3, 12);
    const lam = wienPeakWavelength(5778);
    expect(lam).toBeCloseTo(WIEN_CONSTANT / 5778, 18);
    expect(lam * 1e9).toBeCloseTo(501.5, 0); // solar spectrum peak ~ 500 nm
  });

  it('trapezoidal Planck integral reproduces sigma*T^4 within 0.5 %', () => {
    const t = 1000;
    const pts = planckSweep(t, 0.05e-6, 1000e-6, 2000);
    let integral = 0;
    for (let i = 1; i < pts.length; i += 1) {
      integral += 0.5 * (pts[i - 1]!.e + pts[i]!.e) * (pts[i]!.lambda - pts[i - 1]!.lambda);
    }
    expect(relErr(integral, STEFAN_BOLTZMANN * t ** 4)).toBeLessThan(0.005);
  });

  it('sampled spectrum peak matches the Wien displacement within 0.5 %', () => {
    const t = 1000;
    const pts = planckSweep(t, 0.05e-6, 1000e-6, 2000);
    let peak = pts[0]!;
    for (const pt of pts) if (pt.e > peak.e) peak = pt;
    const lamMax = wienPeakWavelength(t);
    expect(relErr(peak.lambda, lamMax)).toBeLessThan(0.005);
  });

  it('Planck law falls back to the Rayleigh-Jeans limit at long wavelengths', () => {
    // 2 c k_B T / lambda^4 = (C1/C2) * T / lambda^4 asymptote.
    // Deviation is O(C2 / (2 lambda T)); lambda*T = 30 m*K -> ~2.4e-4.
    const t = 300;
    const lam = 0.1;
    const planck = (PLANCK_C1 / (lam ** 5 * (Math.exp(PLANCK_C2 / (lam * t)) - 1)));
    const rayleigh = (3.741771e-16 / PLANCK_C2) * (t / lam ** 4);
    expect(relErr(planck, rayleigh)).toBeLessThan(1e-3);
  });
});

describe('eng-heat benchmark: view factors', () => {
  it('coaxial disks R_i = R_j = 1 give F12 = (3 - sqrt(5))/2 exactly', () => {
    expect(viewFactorDisks(1, 1, 1)).toBeCloseTo((3 - Math.sqrt(5)) / 2, 12);
  });

  it('disk view factor grows toward 1 as the gap closes and reciprocity holds', () => {
    const close = viewFactorDisks(0.1, 0.1, 0.005);
    const far = viewFactorDisks(0.1, 0.1, 1);
    expect(close).toBeGreaterThan(0.9);
    expect(far).toBeLessThan(close);
    expect(viewFactorDisks(0.2, 0.1, 0.1)).toBeLessThanOrEqual(1);
  });

  it('aligned parallel rectangles: F -> 1 as c -> 0 and the X = Y = 1 table value', () => {
    // Deficit 1 - F scales like ~ 2 c / a; c/a = 4e-4 -> F ~ 0.9992.
    expect(viewFactorRects(0.5, 0.5, 0.0002)).toBeGreaterThan(0.995);
    expect(viewFactorRects(0.5, 0.5, 0.005)).toBeGreaterThan(0.98); // ~ 0.980 at X = Y = 100
    const unit = viewFactorRects(1, 1, 1);
    expect(Math.abs(unit - 0.1998)).toBeLessThan(1e-3);
    expect(viewFactorRects(2, 1, 1)).toBeLessThanOrEqual(1);
  });

  it('gray two-surface network: blackbody limit and denominator identity', () => {
    const bb = solveRadiation({ t1: 800, t2: 300, eps1: 1, eps2: 1, geom: 'none', r1: 0.1, r2: 0.1, gap: 0.1, rectA: 0.5, rectB: 0.5, rectC: 0.2 });
    expect(bb.f12).toBe(1);
    expect(bb.qRad).toBeCloseTo(STEFAN_BOLTZMANN * (800 ** 4 - 300 ** 4), 6);
    const gray = solveRadiation({ t1: 800, t2: 300, eps1: 0.8, eps2: 0.9, geom: 'none', r1: 0.1, r2: 0.1, gap: 0.1, rectA: 0.5, rectB: 0.5, rectC: 0.2 });
    const denom = (1 - 0.8) / (0.8 * gray.a1) + 1 / (gray.a1 * gray.f12) + (1 - 0.9) / (0.9 * gray.a2);
    expect(gray.qRad).toBeCloseTo(STEFAN_BOLTZMANN * (800 ** 4 - 300 ** 4) / denom, 9);
    expect(gray.qRad).toBeLessThan(bb.qRad);
    expect(gray.lambdaMax).toBeCloseTo(WIEN_CONSTANT / 800, 18);
  });
});

describe('eng-heat benchmark: LMTD <-> eps-NTU consistency', () => {
  it('counterflow Cr = 1: eps = NTU/(1+NTU) and UA*LMTD = Q exactly', () => {
    const r = solveExchanger({ thIn: 380, tcIn: 300, ch: 1000, cc: 1000, ua: 800, arrangement: 'counter' });
    expect(r.ntu).toBeCloseTo(0.8, 12);
    expect(r.eps).toBeCloseTo(0.8 / 1.8, 12);
    expect(r.q).toBeCloseTo((0.8 / 1.8) * 1000 * 80, 9);
    expect(r.lmtdDeviation).toBeLessThan(1e-9);
  });

  it('counterflow Cr < 1: solved outlets satisfy UA*LMTD = Q', () => {
    const r = solveExchanger({ thIn: 400, tcIn: 300, ch: 2000, cc: 1000, ua: 900, arrangement: 'counter' });
    expect(r.cr).toBeCloseTo(0.5, 12);
    const e = Math.exp(-0.9 * 0.5);
    expect(r.eps).toBeCloseTo((1 - e) / (1 - 0.5 * e), 12);
    expect(r.lmtdDeviation).toBeLessThan(1e-9);
    // Q splits consistently between the two streams.
    expect(r.ch * (r.thIn - r.thOut)).toBeCloseTo(r.q, 6);
    expect(r.cc * (r.tcOut - r.tcIn)).toBeCloseTo(r.q, 6);
  });

  it('parallel flow matches the closed-form eps = (1 - exp(-NTU(1+Cr)))/(1+Cr)', () => {
    const r = solveExchanger({ thIn: 380, tcIn: 300, ch: 1000, cc: 1000, ua: 800, arrangement: 'parallel' });
    expect(r.eps).toBeCloseTo((1 - Math.exp(-0.8 * 2)) / 2, 12);
    expect(r.lmtdDeviation).toBeLessThan(1e-9);
    expect(r.thOut).toBeGreaterThan(r.tcOut); // parallel outlet cross is impossible
  });

  it('Cr -> 0 gives eps = 1 - exp(-NTU) and cross flow reports no LMTD', () => {
    expect(effectivenessNtu(2, 0, 'counter')).toBeCloseTo(1 - Math.exp(-2), 15);
    expect(effectivenessNtu(2, 0, 'parallel')).toBeCloseTo(1 - Math.exp(-2), 15);
    const cross = solveExchanger({ thIn: 400, tcIn: 300, ch: 1000, cc: 1000, ua: 800, arrangement: 'cross' });
    expect(Number.isFinite(cross.lmtd)).toBe(false);
    expect(Number.isFinite(cross.lmtdDeviation)).toBe(false);
    expect(cross.q).toBeGreaterThan(0);
  });

  it('closed-form counter-flow profiles hit the solved outlets at the ends', () => {
    const r = solveExchanger({ thIn: 400, tcIn: 300, ch: 2000, cc: 1000, ua: 900, arrangement: 'counter' });
    const prof = exchangerProfiles(r, 50);
    expect(prof.length).toBe(51);
    expect(prof[0]!.th).toBeCloseTo(r.thIn, 9);
    expect(prof[0]!.tc).toBeCloseTo(r.tcOut, 9);
    expect(prof[50]!.th).toBeCloseTo(r.thOut, 9);
    expect(prof[50]!.tc).toBeCloseTo(r.tcIn, 9);
    for (let i = 1; i < prof.length; i += 1) {
      expect(prof[i]!.th).toBeLessThan(prof[i - 1]!.th);
      expect(prof[i]!.tc).toBeLessThan(prof[i - 1]!.tc);
    }
  });

  it('temperature cross is rejected by the LMTD method', () => {
    // Cc >> Ch, huge UA: the cold stream approaches the hot inlet.
    expect(() => solveExchanger({ thIn: 320, tcIn: 300, ch: 100, cc: 5000, ua: 5000, arrangement: 'counter' })).toThrow(/cross|LMTD/);
  });
});

describe('eng-heat benchmark: series / parallel resistance network', () => {
  it('single wall layer reproduces q = k*A*dT/L to machine precision', () => {
    const r = solveResistance({ area: 1, dT: 40, hOut: 0, hIn: 0, layers: [{ thick: 0.02, k: 1.5 }], parallelK: 0, parallelFrac: 0 });
    expect(r.rTotal).toBeCloseTo(0.02 / 1.5, 15);
    expect(r.q).toBeCloseTo((1.5 * 1 * 40) / 0.02, 9);
    expect(r.qFlux).toBeCloseTo((1.5 * 40) / 0.02, 9);
    // Zero-resistance film slots duplicate the face nodes: [dT, dT, 0, 0].
    expect(r.nodeTs[0]).toBeCloseTo(40, 12);
    expect(r.nodeTs[r.nodeTs.length - 1]!).toBeCloseTo(0, 12);
  });

  it('series layers add, films add 1/(hA), nodes march monotonically', () => {
    const layers = parseLayerSpec('0.02:1.5,0.1:0.04,0.012:0.16');
    const r = solveResistance({ area: 2, dT: 40, hOut: 10, hIn: 5, layers, parallelK: 0, parallelFrac: 0 });
    const rRef = 1 / (10 * 2) + 0.02 / (1.5 * 2) + 0.1 / (0.04 * 2) + 0.012 / (0.16 * 2) + 1 / (5 * 2);
    expect(r.rTotal).toBeCloseTo(rRef, 15);
    expect(r.q).toBeCloseTo(40 / rRef, 9);
    expect(r.nodeTs[0]!).toBeCloseTo(40, 9);
    expect(r.nodeTs[r.nodeTs.length - 1]!).toBeCloseTo(0, 9);
    for (let i = 1; i < r.nodeTs.length; i += 1) expect(r.nodeTs[i]!).toBeLessThanOrEqual(r.nodeTs[i - 1]!);
    // Each node sits at dT minus the cumulative drop of the chain.
    const chain = [r.rOut, ...r.rLayers, r.rIn];
    let cum = 0;
    for (let i = 1; i < r.nodeTs.length; i += 1) {
      cum += chain[i - 1]!;
      expect(r.nodeTs[i]!).toBeCloseTo(40 - r.q * cum, 9);
    }
  });

  it('parallel stud path combines as 1/(1/Rmain + 1/Rpar)', () => {
    const layers = parseLayerSpec('0.1:0.04');
    const r = solveResistance({ area: 1, dT: 40, hOut: 0, hIn: 0, layers, parallelK: 1.5, parallelFrac: 0.2 });
    const rMain = 0.1 / (0.04 * 1 * 0.8);
    const rPar = 0.1 / (1.5 * 1 * 0.2);
    expect(r.rParallel).toBeCloseTo(rPar, 15);
    expect(r.rCore).toBeCloseTo(1 / (1 / rMain + 1 / rPar), 15);
    expect(r.rTotal).toBeCloseTo(r.rCore, 15);
    // The parallel path carries part of the flow: q exceeds the main-path-only value.
    expect(r.q).toBeGreaterThan(40 / rMain);
  });
});

describe('eng-heat benchmark: marching squares on a linear field', () => {
  it('level contours of T = 100 + 2x + 3y lie exactly on 2x + 3y = level - 100', () => {
    const nx = 21;
    const ny = 21;
    const T = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) T[j * nx + i] = 100 + 2 * i + 3 * j;
    }
    const level = 150;
    const segs = marchingSquares(T, nx, ny, level);
    expect(segs.length).toBeGreaterThan(0);
    for (const [x1, y1, x2, y2] of segs) {
      expect(Math.abs(2 * x1 + 3 * y1 - (level - 100))).toBeLessThan(1e-9);
      expect(Math.abs(2 * x2 + 3 * y2 - (level - 100))).toBeLessThan(1e-9);
    }
    // Levels outside the data range produce no contour.
    expect(marchingSquares(T, nx, ny, 50).length).toBe(0);
    expect(marchingSquares(T, nx, ny, 250).length).toBe(0);
  });
});

describe('eng-heat: explicit stability gate and solver errors', () => {
  const base: ConductionParams = {
    W: 0.1, H: 0.02, nx: 41, ny: 11, alpha: 1.3e-5, k: 50,
    edges: { left: edge('dirichlet', 373), right: edge('dirichlet', 293), top: edge('insulated', 0), bottom: edge('insulated', 0) },
    hConv: 10, tInf: 300,
    source: { enabled: false, cx: 0.5, cy: 0.5, r: 0.1, q: 0 },
    scheme: 'explicit', runMode: 'transient', tEnd: 2, dt: 0.2,
  };

  it('rejects FTCS steps with rx + ry > 0.5 but accepts ADI at the same dt', () => {
    // rx = 0.416, ry = 0.65 -> sum 1.066.
    expect(() => solveConduction(base)).toThrow(/rx\+ry|stability|dt/i);
    const adi = solveConduction({ ...base, scheme: 'adi' });
    expect(adi.time).toBeCloseTo(2, 9);
  });

  it('explicit at the auto (stability-limited) dt matches ADI statistics at large t', () => {
    const expl = solveConduction({ ...base, dt: 0, runMode: 'transient', tEnd: 2 });
    expect(expl.rx + expl.ry).toBeLessThanOrEqual(0.5);
    const adi = solveConduction({ ...base, scheme: 'adi', dt: 0, runMode: 'transient', tEnd: 2 });
    expect(relErr(expl.meanT, adi.meanT)).toBeLessThan(0.01);
    expect(relErr(expl.maxT, adi.maxT)).toBeLessThan(0.01);
  });

  it('validates physical bounds', () => {
    expect(() => solveConduction({ ...base, W: 0 })).toThrow(/W and H/);
    expect(() => solveConduction({ ...base, scheme: 'adi', alpha: 0 })).toThrow(/alpha/);
    expect(() => solveConduction({ ...base, scheme: 'adi', k: -1 })).toThrow(/k must be/);
  });

  it('deterministic: identical runs give bit-identical fields', () => {
    const a = solveConduction({ ...base, scheme: 'adi', runMode: 'steady', tEnd: 1 });
    const b = solveConduction({ ...base, scheme: 'adi', runMode: 'steady', tEnd: 1 });
    expect(a.iterations).toBe(b.iterations);
    expect(Array.from(a.T)).toEqual(Array.from(b.T));
  });
});

describe('eng-heat: Block/Flow row interface (CSV / JSON)', () => {
  it('analyzes CSV convection rows with the header schema', () => {
    const rows = parseHeatInput('convection', 'u,len,geom,fluid\n2,0.05,plate,air\n1,0.3,vplate,air');
    expect(rows).toHaveLength(2);
    const forced = rows[0]!;
    const re = (2 * 0.05) / FLUID_PRESETS.air.nu;
    expect(Number(forced.re)).toBeCloseTo(re, 9);
    expect(forced.regime).toBe('laminar');
    const nat = rows[1]!;
    expect(nat.re).toBe(0);
    expect(Number(nat.ra)).toBeGreaterThan(1e6);
  });

  it('analyzes JSON rows objects for exchanger and resistance modes', () => {
    const ex = parseHeatInput('exchanger', { rows: [{ thin: 400, tcin: 300, ch: 2000, cc: 1000, ua: 900, arrangement: 'counter' }, { thin: 380, tcin: 300, ch: 1000, cc: 1000, ua: 800, arrangement: 'parallel' }] });
    expect(ex).toHaveLength(2);
    expect(Number(ex[0]!.lmtdDeviation)).toBeLessThan(1e-9);
    const res = analyzeHeatRow('resistance', { dt: 40, area: 1, layers: '0.02:1.5' });
    expect(Number(res.rTotal)).toBeCloseTo(0.02 / 1.5, 15);
    expect(Number(res.q)).toBeCloseTo(3000, 6);
  });

  it('rejects malformed input', () => {
    expect(() => parseHeatInput('convection', 42)).toThrow(/unsupported input/);
    expect(() => parseHeatInput('resistance', 'dt,area,layers\n40,1,')).toThrow(/layer spec/);
    expect(() => parseLayerSpec('0.2:abc')).toThrow(/positive thickness and conductivity/);
  });
});
