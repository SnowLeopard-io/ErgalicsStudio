import { describe, expect, it } from 'vitest';
import {
  G,
  RE_LAMINAR_MAX,
  RE_TRANSITIONAL_MAX,
  blasiusThicknesses,
  cylinderCl,
  cylinderStagnationAngles,
  classifyRegime,
  colebrookWhite,
  darcyFrictionFactor,
  darcyWeisbachHeadLoss,
  ductConservation,
  ductDiameter,
  ductStations,
  haalandFriction,
  laminarFriction,
  moodyTurbulentCurve,
  pipeBlasiusFriction,
  pipeFlow,
  pohlhausenProfile,
  pohlhausenShape,
  potentialFlowVelocity,
  reynoldsNumber,
  solveBlasius,
  sphereCdSchillerNaumann,
  sphereCdStokes,
  sphereDragForce,
} from '../src/plugins/builtin/engineering/fluid-mech/kernel';
import { EngFluidPlugin } from '../src/plugins/builtin/engineering/fluid-mech/plugin';
import { createDataTable, type DataTable } from '../src/types/datatable';

/** Unified relative-error yardstick: |computed − analytic| / |analytic|. */
function relErr(computed: number, analytic: number): number {
  return Math.abs(computed - analytic) / Math.abs(analytic);
}

/** Residual of the Colebrook equation at x = 1/√f (should vanish at the root). */
function colebrookResidual(re: number, epsOverD: number, f: number): number {
  const x = 1 / Math.sqrt(f);
  return x + 2 * Math.log10(epsOverD / 3.7 + 2.51 / (re * Math.sqrt(f)));
}

describe('eng-fluid pipe flow (Darcy–Weisbach / Colebrook–White)', () => {
  it('laminar branch is exactly f = 64/Re and the regime bands follow the classical bounds', () => {
    for (const re of [500, 1000, 2000, RE_LAMINAR_MAX - 1]) {
      expect(darcyFrictionFactor(re, 0.01)).toBe(laminarFriction(re));
      expect(relErr(darcyFrictionFactor(re, 0.01), 64 / re)).toBeLessThan(1e-12);
      expect(classifyRegime(re)).toBe('laminar');
    }
    expect(classifyRegime(RE_LAMINAR_MAX)).toBe('transitional');
    expect(classifyRegime(3000)).toBe('transitional');
    expect(classifyRegime(RE_TRANSITIONAL_MAX)).toBe('turbulent');
    expect(classifyRegime(1e5)).toBe('turbulent');
  });

  it('Colebrook–White Newton solution satisfies its own equation (|residual| < 1e-10)', () => {
    for (const re of [4e3, 1e4, 1e5, 1e6, 1e7]) {
      for (const epsOverD of [0, 1e-4, 1e-3, 1e-2, 0.05]) {
        const f = colebrookWhite(re, epsOverD);
        expect(Math.abs(colebrookResidual(re, epsOverD, f))).toBeLessThan(1e-10);
      }
    }
  });

  it('Colebrook–White vs Haaland agree within 2% across the turbulent overlap', () => {
    let worst = 0;
    for (const re of [4e3, 1e4, 1e5, 1e6, 1e7]) {
      for (const epsOverD of [0, 1e-4, 1e-3, 1e-2, 0.05]) {
        const fc = colebrookWhite(re, epsOverD);
        const fh = haalandFriction(re, epsOverD);
        worst = Math.max(worst, relErr(fc, fh));
      }
    }
    expect(worst).toBeLessThan(0.02);
  });

  it('smooth-pipe Colebrook–White matches the Blasius correlation 0.3164/Re^0.25 within 3% on its range', () => {
    for (const re of [4e3, 1e4, 4e4, 1e5]) {
      const rel = relErr(colebrookWhite(re, 0), pipeBlasiusFriction(re));
      expect(rel).toBeLessThan(0.03);
    }
  });

  it('transitional blend is continuous and monotone between the laminar value and Colebrook at Re = 4000', () => {
    const fLam = laminarFriction(RE_LAMINAR_MAX);
    const fTurb = colebrookWhite(RE_TRANSITIONAL_MAX, 0.003);
    const fMid = darcyFrictionFactor(3000, 0.003);
    expect(darcyFrictionFactor(RE_LAMINAR_MAX, 0.003)).toBeCloseTo(fLam, 15);
    expect(darcyFrictionFactor(RE_TRANSITIONAL_MAX, 0.003)).toBeCloseTo(fTurb, 15);
    expect(fMid).toBeGreaterThan(fLam);
    expect(fMid).toBeLessThan(fTurb);
    expect(fMid).toBeCloseTo(fLam + 0.5 * (fTurb - fLam), 15);
  });

  it('pipeFlow end-to-end matches the manual closed-form reduction (Re, f, h_f, Δp, τw)', () => {
    const p = { d: 0.05, v: 1.5, rho: 998, mu: 0.001, L: 10, eps: 0.00015 };
    const r = pipeFlow(p);
    const reManual = reynoldsNumber(998, 1.5, 0.05, 0.001);
    expect(r.re).toBeCloseTo(74850, 6);
    expect(r.re).toBe(reManual);
    expect(r.regime).toBe('turbulent');
    expect(r.epsOverD).toBeCloseTo(0.003, 15);
    const fManual = colebrookWhite(74850, 0.003);
    expect(r.f).toBe(fManual);
    expect(r.hf).toBe(darcyWeisbachHeadLoss(fManual, 10, 0.05, 1.5));
    expect(r.dp).toBeCloseTo(998 * G * r.hf, 9);
    expect(r.tauW).toBeCloseTo((fManual * 998 * 1.5 * 1.5) / 8, 12);
  });

  it('Moody turbulent curves satisfy Colebrook and contain the operating point', () => {
    const pts = moodyTurbulentCurve(0.003);
    expect(pts.length).toBeGreaterThan(10);
    for (const pt of pts) {
      expect(Math.abs(colebrookResidual(pt.re, 0.003, pt.f))).toBeLessThan(1e-9);
    }
    const r = pipeFlow({ d: 0.05, v: 1.5, rho: 998, mu: 0.001, L: 10, eps: 0.00015 });
    expect(r.f).toBe(colebrookWhite(r.re, r.epsOverD));
  });

  it('rejects invalid pipe parameters', () => {
    expect(() => pipeFlow({ d: 0, v: 1, rho: 998, mu: 0.001, L: 10, eps: 0 })).toThrow(/d/);
    expect(() => pipeFlow({ d: 0.05, v: -1, rho: 998, mu: 0.001, L: 10, eps: 0 })).toThrow(/v/);
    expect(() => pipeFlow({ d: 0.05, v: 1, rho: 998, mu: 0.001, L: 10, eps: 0.01 })).toThrow(/eps\/d/);
  });
});

describe('eng-fluid Bernoulli ducts (continuity + energy)', () => {
  const params = { shape: 'venturi' as const, d1: 0.2, d2: 0.1, v1: 2, p1: 0, len: 2, rho: 998 };

  it('diameter profile hits d1/d2 at the ends and the venturi throat at mid-length', () => {
    expect(ductDiameter('venturi', 0.2, 0.1, 2, 0)).toBeCloseTo(0.2, 12);
    expect(ductDiameter('venturi', 0.2, 0.1, 2, 1)).toBeCloseTo(0.1, 12);
    expect(ductDiameter('venturi', 0.2, 0.1, 2, 2)).toBeCloseTo(0.2, 12);
    expect(ductDiameter('converging', 0.2, 0.1, 2, 2)).toBeCloseTo(0.1, 12);
    expect(ductDiameter('diverging', 0.1, 0.2, 2, 2)).toBeCloseTo(0.2, 12);
  });

  it('continuity A·v = Q0 and the Bernoulli invariant p + ½ρv² hold along the duct (< 1e-12)', () => {
    const c = ductConservation(params, 400);
    expect(c.continuityErr).toBeLessThan(1e-12);
    expect(c.energyErrHead).toBeLessThan(1e-12);
  });

  it('station velocities follow v = v1·(d1/d)² exactly, incl. the analytic throat value', () => {
    const st = ductStations(params, 40);
    for (const s of st) {
      const vExact = params.v1 * (params.d1 / s.d) ** 2;
      expect(s.v).toBeCloseTo(vExact, 12);
      const pExact = params.p1 + 0.5 * params.rho * (params.v1 ** 2 - vExact ** 2);
      expect(s.p).toBeCloseTo(pExact, 9);
    }
    const throat = params.v1 * (0.2 / 0.1) ** 2;
    expect(Math.max(...st.map((s) => s.v))).toBeCloseTo(throat, 12);
    // EGL is constant by construction (ideal flow).
    expect(new Set(st.map((s) => s.egl)).size).toBe(1);
  });
});

describe('eng-fluid Blasius boundary layer (shooting solution)', () => {
  const sol = solveBlasius();

  it('shooting recovers f″(0) = 0.3320573 (rel. err < 1e-4) and f′(η→∞) = 1', () => {
    expect(relErr(sol.fpp0, 0.3320573362)).toBeLessThan(1e-4);
    const fpEnd = sol.fp[sol.fp.length - 1]!;
    expect(Math.abs(fpEnd - 1)).toBeLessThan(1e-8);
    // Wall conditions f(0) = f'(0) = 0.
    expect(sol.f[0]).toBe(0);
    expect(sol.fp[0]).toBe(0);
  });

  it('η99 ≈ 5.0 reproduces the closed-form δ/x = 5/√Rex rule (within 2%)', () => {
    expect(relErr(sol.eta99, 5.0)).toBeLessThan(0.02);
  });

  it('displacement and momentum thickness coefficients match 1.7208 / 0.6641 (rel. err < 1e-3)', () => {
    expect(relErr(sol.deltaStar, 1.7208)).toBeLessThan(1e-3);
    expect(relErr(sol.theta, 0.6641)).toBeLessThan(1e-3);
    expect(relErr(sol.deltaStar / sol.theta, 2.5911)).toBeLessThan(1e-3);
  });

  it('blasiusThicknesses scales as √(νx/U) and cf = 2f″(0)/√Rex ≈ 0.664/√Rex', () => {
    const nu = 1e-6;
    const uInf = 1;
    for (const x of [0.05, 0.2, 0.5]) {
      const t = blasiusThicknesses(x, nu, uInf);
      const root = Math.sqrt(nu * x / uInf);
      expect(t.delta).toBeCloseTo(sol.eta99 * root, 12);
      expect(t.deltaStar).toBeCloseTo(sol.deltaStar * root, 12);
      expect(t.theta).toBeCloseTo(sol.theta * root, 12);
      const reX = (uInf * x) / nu;
      expect(t.reX).toBe(reX);
      expect(relErr(t.cf, 0.664 / Math.sqrt(reX))).toBeLessThan(0.002);
    }
  });

  it('solver is deterministic (cached solution identical across calls)', () => {
    const again = solveBlasius();
    expect(again.fpp0).toBe(sol.fpp0);
    expect(again.eta99).toBe(sol.eta99);
    expect(again.fp.slice(0, 8)).toEqual(sol.fp.slice(0, 8));
  });
});

describe('eng-fluid Pohlhausen separation indicator', () => {
  it('profile satisfies its boundary conditions: u(0)=0, u(1)=1, u′(1)=0, wall shear 2+λ/6', () => {
    for (const lambda of [-12, -6, 0, 6, 12]) {
      expect(pohlhausenProfile(lambda, 0)).toBeCloseTo(0, 12);
      expect(pohlhausenProfile(lambda, 1)).toBeCloseTo(1, 12);
      const h = 1e-5;
      const shearFd = (pohlhausenProfile(lambda, h) - pohlhausenProfile(lambda, 0)) / h;
      expect(shearFd).toBeCloseTo(2 + lambda / 6, 4);
      const edgeFd = (pohlhausenProfile(lambda, 1) - pohlhausenProfile(lambda, 1 - h)) / h;
      expect(Math.abs(edgeFd)).toBeLessThan(1e-4);
    }
  });

  it('integral moments match the closed forms: δ*(0)=0.3, θ(0)=0.11746, H(0)=2.554', () => {
    const s0 = pohlhausenShape(0);
    expect(s0.deltaStarOverDelta).toBeCloseTo(0.3, 10);
    expect(s0.thetaOverDelta).toBeCloseTo(0.117460317, 5);
    expect(s0.H).toBeCloseTo(2.554, 3);
    expect(s0.separated).toBe(false);
  });

  it('separation at λ = −12: H = 3.5, vanishing wall shear; attached for λ > −12', () => {
    const sSep = pohlhausenShape(-12);
    expect(sSep.wallShear).toBeCloseTo(0, 12);
    expect(sSep.separated).toBe(true);
    expect(sSep.H).toBeCloseTo(3.5, 3);
    expect(pohlhausenShape(-11.5).separated).toBe(false);
    expect(pohlhausenShape(-6).separated).toBe(false);
    // Closed-form moments: δ* = 0.3 − λ/120, θ = θ0 + c·∫h − 2c·∫f₀h − c²·∫h².
    const iH = 0.05;
    const iF0h = 0.028174603;
    const iH2 = 1 / 252;
    const th0 = 0.117460317;
    for (const lambda of [-12, -6, 0, 6]) {
      const c = lambda / 6;
      const ds = 0.3 - lambda / 120;
      const th = th0 + c * iH - 2 * c * iF0h - c * c * iH2;
      const s = pohlhausenShape(lambda);
      expect(s.deltaStarOverDelta).toBeCloseTo(ds, 6);
      expect(s.thetaOverDelta).toBeCloseTo(th, 6);
    }
  });
});

describe('eng-fluid potential flow (sphere / cylinder, drag & lift)', () => {
  it('sphere: stagnation points on the axis and 1.5U equatorial speed (closed form)', () => {
    const [ux1, uy1, uz1] = potentialFlowVelocity('sphere', 1, 1, 0, 1, 0, 0);
    expect(Math.hypot(ux1, uy1, uz1)).toBeLessThan(1e-12);
    const [ux2, uy2, uz2] = potentialFlowVelocity('sphere', 1, 1, 0, -1, 0, 0);
    expect(Math.hypot(ux2, uy2, uz2)).toBeLessThan(1e-12);
    const [ux3, uy3, uz3] = potentialFlowVelocity('sphere', 1, 1, 0, 0, 1, 0);
    expect(ux3).toBeCloseTo(1.5, 12);
    expect(uy3).toBeCloseTo(0, 12);
    expect(uz3).toBeCloseTo(0, 12);
  });

  it('cylinder without circulation: 2U|sinθ| surface speed and zero drag (d\'Alembert)', () => {
    const [uxTop] = potentialFlowVelocity('cylinder', 1, 1, 0, 0, 1, 0);
    expect(uxTop).toBeCloseTo(2, 12);
    const [uxStag] = potentialFlowVelocity('cylinder', 1, 1, 0, 1, 0, 0);
    expect(Math.abs(uxStag)).toBeLessThan(1e-12);
  });

  it('cylinder with circulation: surface velocity and stagnation points match the closed forms', () => {
    const U = 2;
    const a = 0.5;
    const gamma = Math.PI;
    // Top of the cylinder: |v| = |−2U·sinθ + Γ/(2πa)| with θ = 90°.
    const [uxTop, uyTop] = potentialFlowVelocity('cylinder', U, a, gamma, 0, a, 0);
    expect(Math.hypot(uxTop, uyTop)).toBeCloseTo(Math.abs(-2 * U + gamma / (2 * Math.PI * a)), 10);
    // Stagnation points at sinθ = Γ/(4πUa) = 0.25.
    const st = cylinderStagnationAngles(U, a, gamma);
    expect(st).not.toBeNull();
    const [t1, t2] = st!;
    expect(t1).toBeCloseTo(Math.asin(0.25), 12);
    expect(t2).toBeCloseTo(Math.PI - Math.asin(0.25), 12);
    for (const th of [t1, t2]) {
      const [vx, vy, vz] = potentialFlowVelocity('cylinder', U, a, gamma, a * Math.cos(th), a * Math.sin(th), 0);
      expect(Math.hypot(vx, vy, vz)).toBeLessThan(1e-9);
    }
    // Detached when |Γ| ≥ 4πUa.
    expect(cylinderStagnationAngles(U, a, 4 * Math.PI * U * a * 1.01)).toBeNull();
  });

  it('Kutta–Joukowski lift Cl = Γ/(U·a) and Magnus force per span ρUΓ', () => {
    expect(cylinderCl(2, 0.5, Math.PI)).toBeCloseTo(Math.PI / 1, 12);
    const aero = aeroReduction('cylinder', 998, 0.001, 2, 0.5, Math.PI);
    expect(aero.cl).toBeCloseTo(cylinderCl(2, 0.5, Math.PI), 15);
    expect(aero.liftPerSpan).toBeCloseTo(998 * 2 * Math.PI, 9);
    expect(aero.cdPotential).toBe(0);
  });

  it('Stokes drag: Cd = 24/Re reproduces the closed form F = 6πμaU exactly', () => {
    const rho = 998;
    const mu = 0.001;
    const U = 0.01;
    const a = 0.001;
    const re = (rho * U * 2 * a) / mu;
    const cd = sphereCdStokes(re);
    expect(cd).toBe((24 * mu) / (rho * U * 2 * a));
    const fd = sphereDragForce(rho, mu, U, a, cd);
    const stokes = 6 * Math.PI * mu * a * U;
    expect(relErr(fd, stokes)).toBeLessThan(1e-12);
  });

  it('Schiller–Naumann: Cd(Re→0) → Stokes law and Cd(1000) ≈ 0.438', () => {
    const re = 0.1;
    expect(relErr(sphereCdSchillerNaumann(re), sphereCdStokes(re))).toBeLessThan(0.04);
    expect(sphereCdSchillerNaumann(1000)).toBeCloseTo(0.4383, 2);
  });

  it('aeroReduction publishes a consistent Re/Cd/Cl set', () => {
    const aero = aeroReduction('sphere', 998, 0.001, 1, 0.4, 1.5); // Γ ignored by the sphere
    expect(aero.re).toBeCloseTo((998 * 1 * 0.8) / 0.001, 6);
    expect(aero.cl).toBe(0);
    expect(aero.cdStokes).toBeCloseTo(24 / aero.re, 15);
    expect(aero.stagnation).toBeNull();
  });
});

describe('eng-fluid headless compute (Block/Flow entry)', () => {
  const CSV = 'd,v,rho,mu,L,eps\n0.05,1.5,998,0.001,10,0.00015';

  it('CSV input with d,v,rho,mu,L,eps returns a DataTable + metrics with the closed-form Re/f/hf', async () => {
    const plugin = new EngFluidPlugin();
    const res = await plugin.compute(CSV);
    expect(res.ok).toBe(true);
    const out = res.output as { table: DataTable; metrics: Record<string, unknown> };
    expect(out.table.length).toBe(1);
    const reCol = out.table.getColumn('re') as Float64Array;
    const fCol = out.table.getColumn('f') as Float64Array;
    const regimeCol = out.table.getColumn('regime') as string[];
    const hfCol = out.table.getColumn('hf') as Float64Array;
    expect(reCol[0]).toBeCloseTo(74850, 6);
    expect(fCol[0]).toBe(colebrookWhite(74850, 0.003));
    expect(regimeCol[0]).toBe('turbulent');
    expect(hfCol[0]).toBeCloseTo(darcyWeisbachHeadLoss(fCol[0]!, 10, 0.05, 1.5), 12);
    expect(out.metrics.re).toBeCloseTo(74850, 6);
    expect(out.metrics.regime).toBe('turbulent');
  });

  it('DataTable input works with optional columns falling back to the plugin state', async () => {
    const plugin = new EngFluidPlugin();
    const table = createDataTable('pipes', [
      { name: 'd', type: 'f64', data: Float64Array.from([0.05, 0.1]) },
      { name: 'v', type: 'f64', data: Float64Array.from([1.5, 2]) },
    ]);
    const res = await plugin.compute(table);
    expect(res.ok).toBe(true);
    const out = res.output as { table: DataTable; metrics: Record<string, unknown> };
    expect(out.table.length).toBe(2);
    const reCol = out.table.getColumn('re') as Float64Array;
    // Row 2 uses the state defaults rho = 998, mu = 0.001: Re = 998·2·0.1/0.001.
    expect(reCol[1]).toBeCloseTo(199600, 6);
    expect(out.metrics.count).toBe(2);
  });

  it('null input serializes the current mode reduction deterministically', async () => {
    const a = new EngFluidPlugin();
    const b = new EngFluidPlugin();
    const ra = await a.compute(null);
    const rb = await b.compute(null);
    expect(ra.ok).toBe(true);
    const outA = ra.output as { metrics: Record<string, unknown> };
    const outB = rb.output as { metrics: Record<string, unknown> };
    expect(outA.metrics.mode).toBe('pipe');
    expect(outA.metrics).toEqual(outB.metrics);
  });

  it('bad input is reported as a failed result, not a throw', async () => {
    const plugin = new EngFluidPlugin();
    const res = await plugin.compute('nonsense,text\n1,2');
    expect(res.ok).toBe(false);
    expect(String(res.error)).toMatch(/d|columns/i);
  });
});
