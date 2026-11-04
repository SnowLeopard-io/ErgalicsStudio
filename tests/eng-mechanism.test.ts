// ==========================================================================
// Tests for the eng-mechanism plugin (mechanism kinematics).
// Pure kernel tests — no DOM, no plugin framework. The five research
// benchmarks declared in the manifest are covered here:
//   - four-bar closure residual            < 1e-9
//   - coupler velocity vs central diff     < 1e-4 relative
//   - cam motion laws (SHM closed form, cycloidal/3-4-5 zero end accel)
//   - cam pressure angle closed form
//   - Willis planetary closed form & compound ratio = product of stages
// ==========================================================================

import { describe, expect, it } from 'vitest';
import {
  type CouplerPointDef,
  type FourBarLinks,
  MECH_DEG,
  camState,
  couplerPointVelocity,
  couplerVelocityNumeric,
  designCam,
  fourBarVelocities,
  gearTrain,
  grashofClass,
  motionLaw,
  parseBatchInput,
  parseCamTiming,
  parseGearStages,
  solveFourBar,
  sweepFourBar,
  velocityView,
  willisSolve,
} from '../src/plugins/builtin/engineering/mechanism/kernel';

/** Classic well-conditioned Grashof crank-rocker: a=1, b=4, c=3, d=4. */
const L: FourBarLinks = { a: 1, b: 4, c: 3, d: 4 };
/** Offset coupler point (inside the coupler triangle-free definition). */
const CP: CouplerPointDef = { p: 2, q: 0.8 };

/** Angular velocities of the solved pose are ill-conditioned near singularity. */
function nearSingular(pose: ReturnType<typeof solveFourBar>): boolean {
  return Math.abs(Math.sin(pose.theta3 - pose.theta4)) < 0.05;
}

// ---------------------------------------------------------------------------
// 1. Grashof classification
// ---------------------------------------------------------------------------

describe('eng-mechanism four-bar: Grashof classification', () => {
  it('classifies all families by the position of the shortest link', () => {
    // s = crank (side link) -> crank-rocker.
    expect(grashofClass({ a: 2, b: 5, c: 4, d: 4 })).toBe('crank-rocker');
    // s = ground -> double-crank (drag link).
    expect(grashofClass({ a: 3, b: 4, c: 4, d: 1 })).toBe('double-crank');
    // s = coupler -> double-rocker.
    expect(grashofClass({ a: 4, b: 1, c: 4, d: 3 })).toBe('double-rocker');
    // s + l > p + q -> no crank (triple rocker).
    expect(grashofClass({ a: 2, b: 7, c: 3, d: 5.5 })).toBe('no-crank');
    // s + l = p + q -> change-point case.
    expect(grashofClass({ a: 2, b: 7, c: 3, d: 6 })).toBe('change-point');
  });

  it('crank rotation agrees with the classification', () => {
    const sweepOk = sweepFourBar({ a: 2, b: 5, c: 4, d: 4 }, 'open', CP, 1, 72);
    expect(sweepOk.grashof).toBe('crank-rocker');
    const sweepNo = sweepFourBar({ a: 4, b: 1, c: 4, d: 3 }, 'open', CP, 1, 72);
    expect(sweepNo.grashof).toBe('double-rocker');
    // A double-rocker cannot be assembled through the full crank cycle.
    expect(sweepNo.assemblable).toBe(false);
  });

  it('flags unassemblable poses with NaN geometry and assembles Grashof chains everywhere', () => {
    // 2 + 1 < 4 reached nowhere: circles |P-A|=1, |P-O4|=1 do not intersect.
    const bad = solveFourBar({ a: 2, b: 1, c: 1, d: 4 }, Math.PI / 2);
    expect(Number.isFinite(bad.theta3)).toBe(false);
    expect(Number.isFinite(bad.residual)).toBe(false);
    for (let k = 0; k < 12; k += 1) {
      const pose = solveFourBar(L, (k / 12) * Math.PI * 2, 'open');
      expect(Number.isFinite(pose.theta3)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Closure residual benchmark
// ---------------------------------------------------------------------------

describe('eng-mechanism four-bar: closure residual (benchmark < 1e-9)', () => {
  it('stays at machine precision over full-cycle sweeps on both branches', () => {
    for (const branch of ['open', 'crossed'] as const) {
      const sweep = sweepFourBar(L, branch, CP, 1, 360);
      expect(sweep.assemblable).toBe(true);
      expect(sweep.grashof).toBe('crank-rocker');
      // Benchmark bound is 1e-9; the circle-intersection solve lands ~1e-15.
      expect(sweep.maxResidual).toBeLessThan(1e-9);
      expect(sweep.maxResidual).toBeLessThan(1e-12);
    }
  });

  it('poses satisfy every loop-closure constraint independently', () => {
    const pose = solveFourBar(L, 1.0, 'open');
    expect(Math.hypot(pose.A[0], pose.A[1])).toBeCloseTo(L.a, 12);
    expect(Math.hypot(pose.B[0] - pose.O4[0], pose.B[1] - pose.O4[1])).toBeCloseTo(L.c, 12);
    expect(Math.hypot(pose.B[0] - pose.A[0], pose.B[1] - pose.A[1])).toBeCloseTo(L.b, 12);
    expect(pose.O4[0]).toBeCloseTo(L.d, 15);
    expect(pose.O4[1]).toBeCloseTo(0, 15);
  });

  it('rocker swing matches the analytic toggle-position formula', () => {
    // Toggles occur when crank and coupler are collinear (effective link
    // K = a + b and K = |a - b|); the rocker angle from the O4->O2 line is
    // psi with cos(psi) = (d^2 + c^2 - K^2) / (2 d c). Swing = psi1 - psi2.
    const psi1 = Math.acos((L.d ** 2 + L.c ** 2 - (L.a + L.b) ** 2) / (2 * L.d * L.c));
    const psi2 = Math.acos((L.d ** 2 + L.c ** 2 - Math.abs(L.a - L.b) ** 2) / (2 * L.d * L.c));
    const expected = (psi1 - psi2) / MECH_DEG;
    const sweep = sweepFourBar(L, 'open', CP, 1, 360);
    expect(Math.abs(sweep.rockerSwingDeg - expected)).toBeLessThan(0.1);
    expect(sweep.minTransmissionDeg).toBeGreaterThan(0);
    expect(sweep.maxTransmissionDeg).toBeLessThanOrEqual(90 + 1e-9);
  });
});

// ---------------------------------------------------------------------------
// 3. Velocity benchmark: analytic vs central differences
// ---------------------------------------------------------------------------

describe('eng-mechanism four-bar: coupler velocity vs numeric (benchmark < 1e-4 rel)', () => {
  it('analytic coupler-point velocity matches central differences of position', () => {
    let maxRel = 0;
    for (let k = 0; k < 24; k += 1) {
      const t2 = 0.05 + (k / 24) * (Math.PI * 2 - 0.1);
      const pose = solveFourBar(L, t2, 'open');
      if (nearSingular(pose)) continue;
      const vel = fourBarVelocities(L, pose, 1);
      if (vel.singular) continue;
      const vA = couplerPointVelocity(L, pose, CP, 1, vel.w3);
      const vN = couplerVelocityNumeric(L, t2, 1, 'open', CP);
      const mag = Math.hypot(vN[0], vN[1]);
      const rel = mag > 1e-6 ? Math.hypot(vA[0] - vN[0], vA[1] - vN[1]) / mag : Math.hypot(vA[0] - vN[0], vA[1] - vN[1]);
      if (rel > maxRel) maxRel = rel;
      expect(rel).toBeLessThan(1e-4);
    }
    expect(maxRel).toBeGreaterThan(0); // the comparison actually ran
  });

  it('w3 and w4 match numeric differentiation of the solved angles', () => {
    const h = 1e-6;
    for (let k = 0; k < 24; k += 1) {
      const t2 = 0.05 + (k / 24) * (Math.PI * 2 - 0.1);
      const pose = solveFourBar(L, t2, 'open');
      if (nearSingular(pose)) continue;
      const vel = fourBarVelocities(L, pose, 1);
      if (vel.singular) continue;
      const pP = solveFourBar(L, t2 + h, 'open');
      const pM = solveFourBar(L, t2 - h, 'open');
      // dA/dtheta2 = a * u'(theta2) at unit input speed.
      const dAvx = -L.a * Math.sin(t2);
      const dAvy = L.a * Math.cos(t2);
      // dB/dtheta2 and d(B-A)/dtheta2 by central difference.
      const dBx = (pP.B[0] - pM.B[0]) / (2 * h);
      const dBy = (pP.B[1] - pM.B[1]) / (2 * h);
      const dCx = dBx - dAvx;
      const dCy = dBy - dAvy;
      // Project onto u'(theta) to recover the angular rates.
      const w3num = (-dCx * Math.sin(pose.theta3) + dCy * Math.cos(pose.theta3)) / L.b;
      const w4num = (-dBx * Math.sin(pose.theta4) + dBy * Math.cos(pose.theta4)) / L.c;
      if (Math.abs(vel.w3) > 1e-2) {
        expect(Math.abs(vel.w3 - w3num) / Math.abs(vel.w3)).toBeLessThan(1e-4);
      }
      if (Math.abs(vel.w4) > 1e-2) {
        expect(Math.abs(vel.w4 - w4num) / Math.abs(vel.w4)).toBeLessThan(1e-4);
      }
    }
  });

  it('Kennedy instant centers lie on their defining lines and reproduce vB', () => {
    const view = velocityView(L, 1.2, 1, 'open', CP);
    const { pose, i13, i24, vB, vA, vel } = view;
    expect(i13).not.toBeNull();
    expect(i24).not.toBeNull();
    // I13 on line O2-A and on line O4-B (cross products vanish).
    const cr1 = (pose.A[0] - pose.O2[0]) * (i13![1] - pose.O2[1]) - (pose.A[1] - pose.O2[1]) * (i13![0] - pose.O2[0]);
    const cr2 = (pose.B[0] - pose.O4[0]) * (i13![1] - pose.O4[1]) - (pose.B[1] - pose.O4[1]) * (i13![0] - pose.O4[0]);
    expect(Math.abs(cr1)).toBeLessThan(1e-9);
    expect(Math.abs(cr2)).toBeLessThan(1e-9);
    // I24 on the ground line (y = 0) and on line A-B.
    expect(Math.abs(i24![1])).toBeLessThan(1e-9);
    const cr3 = (pose.B[0] - pose.A[0]) * (i24![1] - pose.A[1]) - (pose.B[1] - pose.A[1]) * (i24![0] - pose.A[0]);
    expect(Math.abs(cr3)).toBeLessThan(1e-9);
    // Coupler points rotate about I13 with w3: |v| = |w3| * dist(I13, P).
    const dB13 = Math.hypot(pose.B[0] - i13![0], pose.B[1] - i13![1]);
    const dA13 = Math.hypot(pose.A[0] - i13![0], pose.A[1] - i13![1]);
    expect(Math.abs(Math.hypot(vB[0], vB[1]) - Math.abs(vel.w3) * dB13)).toBeLessThan(1e-9);
    expect(Math.abs(Math.hypot(vA[0], vA[1]) - Math.abs(vel.w3) * dA13)).toBeLessThan(1e-9);
  });
});

// ---------------------------------------------------------------------------
// 4. Cam motion laws
// ---------------------------------------------------------------------------

describe('eng-mechanism cam: motion laws (benchmark)', () => {
  it('SHM matches its closed form pointwise (continuous within the rise)', () => {
    for (let i = 0; i <= 100; i += 1) {
      const tau = i / 100;
      const m = motionLaw('shm', tau);
      expect(m.s).toBeCloseTo(0.5 * (1 - Math.cos(Math.PI * tau)), 12);
      expect(m.v).toBeCloseTo(0.5 * Math.PI * Math.sin(Math.PI * tau), 12);
      expect(m.a).toBeCloseTo(0.5 * Math.PI * Math.PI * Math.cos(Math.PI * tau), 12);
    }
  });

  it('cycloidal and 3-4-5 laws have zero velocity and acceleration at both ends', () => {
    for (const law of ['cycloid', 'poly345'] as const) {
      const m0 = motionLaw(law, 0);
      const m1 = motionLaw(law, 1);
      expect(Math.abs(m0.v)).toBeLessThan(1e-12);
      expect(Math.abs(m0.a)).toBeLessThan(1e-12);
      expect(Math.abs(m1.v)).toBeLessThan(1e-12);
      expect(Math.abs(m1.a)).toBeLessThan(1e-12);
      expect(m1.s).toBeCloseTo(1, 12);
    }
    // SHM has zero end *velocity* but a non-zero end *acceleration*
    // (the documented soft-shock boundary jump).
    expect(Math.abs(motionLaw('shm', 0).v)).toBeLessThan(1e-12);
    expect(Math.abs(motionLaw('shm', 1).a)).toBeCloseTo(Math.PI * Math.PI * 0.5, 12);
  });

  it('parses timing text and validates the segment sum', () => {
    expect(parseCamTiming('120, 60;120')).toEqual({ riseDeg: 120, dwellDeg: 60, returnDeg: 120 });
    expect(() => parseCamTiming('120,60')).toThrow();
    expect(() => parseCamTiming('200,100,100')).toThrow(); // sum >= 360
    expect(() => parseCamTiming('0,60,120')).toThrow(); // rise must be > 0
  });

  it('camState hits exact segment values and cycloidal boundaries are continuous', () => {
    const p = {
      r0: 30,
      rollerR: 5,
      stroke: 10,
      timing: { riseDeg: 120, dwellDeg: 60, returnDeg: 120 },
      offset: 0,
      lawRise: 'cycloid' as const,
      lawReturn: 'cycloid' as const,
    };
    const d = Math.PI / 180;
    // Mid-rise (tau = 0.5): s = stroke/2, cycloidal a = 0.
    const midRise = camState(p, 60 * d);
    expect(midRise.s).toBeCloseTo(5, 12);
    expect(Math.abs(midRise.dds)).toBeLessThan(1e-12);
    // Top dwell.
    const top = camState(p, 150 * d);
    expect(top.s).toBeCloseTo(10, 12);
    expect(Math.abs(top.ds)).toBeLessThan(1e-12);
    // Mid-return: s = stroke/2, cycloidal a = 0.
    const midRet = camState(p, 240 * d);
    expect(midRet.s).toBeCloseTo(5, 12);
    expect(Math.abs(midRet.dds)).toBeLessThan(1e-12);
    // Trailing dwell.
    const low = camState(p, 330 * d);
    expect(low.s).toBeCloseTo(0, 12);
    // Rise -> dwell boundary is C2 for the cycloidal law.
    const justBefore = camState(p, (120 - 1e-7) * d);
    const justAfter = camState(p, (120 + 1e-7) * d);
    expect(Math.abs(justBefore.s - 10)).toBeLessThan(1e-5);
    expect(Math.abs(justAfter.s - 10)).toBeLessThan(1e-12);
    expect(Math.abs(justBefore.ds)).toBeLessThan(1e-4);
  });
});

// ---------------------------------------------------------------------------
// 5. Cam pressure angle & profile
// ---------------------------------------------------------------------------

describe('eng-mechanism cam: pressure angle & profile (benchmark)', () => {
  const cam = designCam(
    {
      r0: 30,
      rollerR: 6,
      stroke: 12,
      timing: { riseDeg: 120, dwellDeg: 60, returnDeg: 120 },
      offset: 4,
      lawRise: 'shm',
      lawReturn: 'shm',
    },
    720,
  );

  it('pressure angle matches tan(alpha) = |ds - e| / (s + s0) at every sample', () => {
    const s0 = Math.sqrt(30 * 30 - 4 * 4);
    for (let i = 0; i < cam.samples.length; i += 37) {
      const sm = cam.samples[i]!;
      const expected = Math.atan2(Math.abs(sm.ds - 4), sm.s + s0) / MECH_DEG;
      expect(sm.pressureDeg).toBeCloseTo(expected, 9);
    }
    expect(cam.maxPressureRiseDeg).toBeGreaterThan(0);
    expect(cam.maxPressureRiseDeg).toBeLessThan(90);
  });

  it('pitch point starts on the base circle and the roller inset equals rollerR', () => {
    const first = cam.samples[0]!;
    expect(Math.hypot(first.pitchX, first.pitchY)).toBeCloseTo(30, 9);
    for (let i = 0; i < cam.samples.length; i += 53) {
      const sm = cam.samples[i]!;
      const inset = Math.hypot(sm.actualX - sm.pitchX, sm.actualY - sm.pitchY);
      expect(inset).toBeCloseTo(6, 9);
    }
  });

  it('a larger base circle strictly reduces the maximum pressure angle', () => {
    const big = designCam(
      {
        r0: 60,
        rollerR: 6,
        stroke: 12,
        timing: { riseDeg: 120, dwellDeg: 60, returnDeg: 120 },
        offset: 4,
        lawRise: 'shm',
        lawReturn: 'shm',
      },
      720,
    );
    expect(big.maxPressureRiseDeg).toBeLessThan(cam.maxPressureRiseDeg);
  });

  it('undercut flags exactly when the roller exceeds the min convex curvature radius', () => {
    const gentle = designCam(
      {
        r0: 30,
        rollerR: 5,
        stroke: 10,
        timing: { riseDeg: 120, dwellDeg: 60, returnDeg: 120 },
        offset: 0,
        lawRise: 'shm',
        lawReturn: 'shm',
      },
      720,
    );
    expect(gentle.undercut).toBe(false);
    const hugeRoller = designCam(
      {
        r0: 30,
        rollerR: 40,
        stroke: 10,
        timing: { riseDeg: 120, dwellDeg: 60, returnDeg: 120 },
        offset: 0,
        lawRise: 'shm',
        lawReturn: 'shm',
      },
      720,
    );
    expect(hugeRoller.minConvexCurvatureR).toBeLessThan(40);
    expect(hugeRoller.undercut).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Gear trains
// ---------------------------------------------------------------------------

describe('eng-mechanism gears: fixed-axis trains', () => {
  it('a simple external mesh reverses and reduces by the tooth ratio', () => {
    const r = gearTrain([{ za: 20, zb: 60 }]);
    expect(r.ratio).toBeCloseTo(-1 / 3, 12);
    expect(r.reversed).toBe(true);
    expect(r.reduction).toBeCloseTo(3, 12);
  });

  it('an idler cancels the direction reversal', () => {
    const r = gearTrain([
      { za: 20, zb: 30 },
      { za: 30, zb: 20 },
    ]);
    expect(r.ratio).toBeCloseTo(1, 12);
    expect(r.reversed).toBe(false);
  });

  it('compound train ratio equals the product of stage ratios (benchmark)', () => {
    const r = gearTrain([
      { za: 20, zb: 60 },
      { za: 30, zb: 90 },
    ]);
    const product = r.stages.reduce((acc, st) => acc * st.ratio, 1);
    expect(r.ratio).toBe(product);
    expect(r.ratio).toBeCloseTo(1 / 9, 12);
    // Two external meshes -> same direction as input.
    expect(r.reversed).toBe(false);
  });

  it('internal meshes do not reverse direction', () => {
    const stages = parseGearStages('i:20/80');
    expect(stages[0]!.internal).toBe(true);
    expect(gearTrain(stages).ratio).toBeCloseTo(0.25, 12);
    expect(gearTrain(stages).reversed).toBe(false);
  });

  it('parses stage text and rejects malformed stages', () => {
    const stages = parseGearStages('20/60, 30/90');
    expect(stages).toHaveLength(2);
    expect(stages[0]).toEqual({ za: 20, zb: 60, internal: false });
    expect(() => parseGearStages('20')).toThrow();
    expect(() => parseGearStages('20/0')).toThrow();
    expect(() => gearTrain([])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 7. Willis planetary
// ---------------------------------------------------------------------------

describe('eng-mechanism gears: Willis planetary (benchmark)', () => {
  it('ring-fixed planetary gives i = 1 + zr/zs in closed form', () => {
    // zs = 20, zp = 30 -> zr = 80, rho = 4, ring fixed: i = wS/wH = 1 + 4 = 5.
    const r = willisSolve({ zs: 20, zp: 30, wSun: 10, wRing: 0, wCarrier: null });
    expect(r.zr).toBe(80);
    expect(r.rho).toBeCloseTo(4, 12);
    expect(r.wCarrier).toBeCloseTo(2, 12);
    expect(r.wSun / r.wCarrier).toBeCloseTo(5, 12);
    expect(Math.abs(r.residual)).toBeLessThan(1e-12);
  });

  it('two driven inputs give the differential carrier speed', () => {
    // wS + rho*wR - (1+rho)*wH = 0 -> wH = (10 + 4*(-2)) / 5 = 0.4.
    const r = willisSolve({ zs: 20, zp: 30, wSun: 10, wRing: -2, wCarrier: null });
    expect(r.wCarrier).toBeCloseTo(0.4, 12);
    expect(Math.abs(r.residual)).toBeLessThan(1e-12);
  });

  it('sun-fixed operation satisfies the Willis equation exactly', () => {
    const r = willisSolve({ zs: 20, zp: 30, wSun: 0, wRing: 5, wCarrier: null });
    expect(r.wCarrier).toBeCloseTo(4, 12);
    const check = r.wSun + r.rho * r.wRing - (1 + r.rho) * r.wCarrier;
    expect(Math.abs(check)).toBeLessThan(1e-12);
  });

  it('requires exactly two known member speeds', () => {
    expect(() => willisSolve({ zs: 20, zp: 30, wSun: null, wRing: null, wCarrier: null })).toThrow();
    expect(() => willisSolve({ zs: 20, zp: 30, wSun: 1, wRing: 2, wCarrier: 3 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 8. Headless batch input (CSV / JSON / DataTable-like)
// ---------------------------------------------------------------------------

describe('eng-mechanism headless batch input', () => {
  it('parses CSV with header, headerless rows and JSON objects', () => {
    const withHeader = parseBatchInput('a,b,c,d,branch\n1,4,3,4,open\n2,7,3,6,crossed');
    expect(withHeader).toHaveLength(2);
    expect(withHeader[0]!.grashof).toBe('crank-rocker');
    expect(withHeader[0]!.crankRotates).toBe(true);
    expect(withHeader[1]!.branch).toBe('crossed');
    expect(withHeader[1]!.grashof).toBe('change-point');

    const headerless = parseBatchInput('1,4,3,4,crossed');
    expect(headerless).toHaveLength(1);
    expect(headerless[0]!.branch).toBe('crossed');

    const json = parseBatchInput('{"a":1,"b":4,"c":3,"d":4}');
    expect(json[0]!.grashof).toBe('crank-rocker');
    const rows = parseBatchInput('{"rows":[{"a":2,"b":5,"c":4,"d":4}]}');
    expect(rows[0]!.grashof).toBe('crank-rocker');
  });

  it('consumes a DataTable-like columnar input', () => {
    const cols: Record<string, number[]> = { a: [1, 2], b: [4, 7], c: [3, 3], d: [4, 6] };
    const fakeTable = {
      length: 2,
      getColumn(name: string): unknown {
        return cols[name];
      },
    };
    const rows = parseBatchInput(fakeTable);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.grashof).toBe('crank-rocker');
    expect(rows[1]!.grashof).toBe('change-point');
  });

  it('is deterministic across repeated calls', () => {
    const csv = 'a,b,c,d\n1,4,3,4\n2,7,3,6';
    expect(JSON.stringify(parseBatchInput(csv))).toBe(JSON.stringify(parseBatchInput(csv)));
  });
});
