import { describe, expect, it } from 'vitest';
import {
  type CamParams,
  type FourBarLinks,
  accelerationPolygon,
  analyzeFourBarRow,
  camMotion,
  designCam,
  fixedTrain,
  fourBarKinematics,
  gearPair,
  grashofType,
  instantCenters,
  motionLaw,
  motionLawPeaks,
  parseFourBarInput,
  planetary,
  solveFourBar,
  sweepFourBar,
  velocityPolygon,
} from '../src/plugins/builtin/engineering/kinematics/kernel';

const TAU = Math.PI * 2;

/** |P − Q| for 2-D points. */
function dist(px: number, py: number, qx: number, qy: number): number {
  return Math.hypot(px - qx, py - qy);
}

/** Closure residual |A + r2·u(θ2) − (O4 + r3·u(θ3))| of a solved pose. */
function residual(l: FourBarLinks, pose: ReturnType<typeof solveFourBar>): number {
  return dist(
    pose.A[0] + l.r2 * Math.cos(pose.theta2),
    pose.A[1] + l.r2 * Math.sin(pose.theta2),
    l.r4 + l.r3 * Math.cos(pose.theta3),
    l.r3 * Math.sin(pose.theta3),
  );
}

describe('eng-kin four-bar: Grashof classification', () => {
  const l = (r1: number, r2: number, r3: number, r4: number): FourBarLinks => ({ r1, r2, r3, r4 });

  it('classifies all Grashof families by the position of the shortest link', () => {
    // s = crank (side link) → crank-rocker.
    expect(grashofType(l(1, 4, 3, 4))).toBe('crank-rocker');
    // s = ground → double-crank (drag link).
    expect(grashofType(l(3, 4, 4, 1))).toBe('double-crank');
    // s = coupler → double-rocker.
    expect(grashofType(l(4, 1, 4, 3))).toBe('double-rocker');
    // s = rocker (other side link) → still a crank-rocker chain.
    expect(grashofType(l(4, 3, 1, 4))).toBe('crank-rocker');
    // s + l > p + q → no crank at all (triple rocker).
    expect(grashofType(l(2, 7, 3, 5.5))).toBe('no-crank');
    // s + l = p + q → change-point special case.
    expect(grashofType(l(2, 7, 3, 6))).toBe('change-point');
  });

  it('crankRotates agrees with the classification', () => {
    expect(analyzeFourBarRow(1, 4, 3, 4).crankRotates).toBe(true);
    expect(analyzeFourBarRow(3, 4, 4, 1).crankRotates).toBe(true);
    expect(analyzeFourBarRow(4, 1, 4, 3).crankRotates).toBe(false);
    expect(analyzeFourBarRow(2, 7, 3, 5.5).crankRotates).toBe(false);
  });
});

describe('eng-kin four-bar: closed-loop assembly', () => {
  const cases: Array<{ links: FourBarLinks; branch: 'open' | 'crossed' }> = [
    { links: { r1: 1, r2: 4, r3: 3, r4: 4 }, branch: 'open' },
    { links: { r1: 1, r2: 4, r3: 3, r4: 4 }, branch: 'crossed' },
    { links: { r1: 2, r2: 7, r3: 9, r4: 6 }, branch: 'open' },
    { links: { r1: 3, r2: 4, r3: 4, r4: 1 }, branch: 'crossed' },
    { links: { r1: 1.5, r2: 5, r3: 4, r4: 4.5 }, branch: 'open' },
  ];

  it('satisfies the loop equation to < 1e-9 over a full revolution (both branches)', () => {
    for (const c of cases) {
      for (let i = 0; i <= 120; i += 1) {
        const t1 = (i / 120) * TAU;
        const pose = solveFourBar(c.links, t1, c.branch);
        expect(Number.isFinite(pose.theta2), `theta1=${t1}`).toBe(true);
        expect(residual(c.links, pose)).toBeLessThan(1e-9);
      }
    }
  });

  it(' parallelogram linkage: coupler translates (theta2 = 0, theta3 = theta1)', () => {
    const par: FourBarLinks = { r1: 1, r2: 3, r3: 1, r4: 3 };
    for (let i = 0; i <= 90; i += 1) {
      const t1 = (i / 90) * TAU;
      const pose = solveFourBar(par, t1, 'open');
      expect(residual(par, pose)).toBeLessThan(1e-9);
      expect(Math.abs(pose.theta2)).toBeLessThan(1e-9);
      expect(Math.abs(((pose.theta3 - t1 + Math.PI) % TAU) - Math.PI)).toBeLessThan(1e-9);
    }
  });

  it('both branches give the same |O4B| = r3 circle solution mirrored about O4A', () => {
    const l: FourBarLinks = { r1: 1, r2: 4, r3: 3, r4: 4 };
    const open = solveFourBar(l, 0.7, 'open');
    const crossed = solveFourBar(l, 0.7, 'crossed');
    // Mirror image: theta3_open + theta3_crossed = 2·phi (symmetric about O4A).
    const phi = Math.atan2(open.A[1], open.A[0] - l.r4);
    expect(Math.abs(open.theta3 + crossed.theta3 - 2 * phi)).toBeLessThan(1e-12);
  });

  it('analytic vector-loop velocities match numerical differentiation of the closure', () => {
    const l: FourBarLinks = { r1: 1, r2: 4, r3: 3, r4: 4 };
    const w1 = 2;
    const h = 1e-5;
    for (const t1 of [0.3, 1.1, 2.4, 4.0, 5.5]) {
      const k = fourBarKinematics(l, t1, w1, 'open');
      const a = solveFourBar(l, t1 + h, 'open');
      const b = solveFourBar(l, t1 - h, 'open');
      const w2num = ((a.theta2 - b.theta2) / (2 * h)) * w1;
      const w3num = ((a.theta3 - b.theta3) / (2 * h)) * w1;
      expect(Math.abs(k.w2 - w2num) / Math.max(1, Math.abs(k.w2))).toBeLessThan(1e-5);
      expect(Math.abs(k.w3 - w3num) / Math.max(1, Math.abs(k.w3))).toBeLessThan(1e-5);
    }
  });

  it('Kennedy I13 lies on both the crank line O2A and the rocker line O4B', () => {
    const l: FourBarLinks = { r1: 1, r2: 4, r3: 3, r4: 4 };
    const pose = solveFourBar(l, 1.9, 'open');
    const { i13 } = instantCenters(l, pose);
    expect(i13).not.toBeNull();
    const cross = (p: number[], a: number[], b: number[]): number =>
      (a[0] - p[0]) * (b[1] - p[1]) - (a[1] - p[1]) * (b[0] - p[0]);
    // Collinear: |(A−O2) × (I13−O2)| ≈ 0 and |(B−O4) × (I13−O4)| ≈ 0.
    expect(Math.abs(cross([0, 0], [pose.A[0], pose.A[1]], [i13![0], i13![1]]))).toBeLessThan(1e-9);
    expect(Math.abs(cross([l.r4, 0], [pose.B[0] - l.r4, pose.B[1]], [i13![0] - l.r4, i13![1]]))).toBeLessThan(1e-9);
  });
});

describe('eng-kin four-bar: coupler curve', () => {
  it('closes on itself (< 1e-6) and its sweep statistics are finite', () => {
    const l: FourBarLinks = { r1: 1, r2: 4, r3: 3, r4: 4 };
    const sweep = sweepFourBar(l, 'open', { c: 2, e: 0.5 }, 360);
    const n = sweep.couplerX.length - 1;
    const gap = dist(sweep.couplerX[0]!, sweep.couplerY[0]!, sweep.couplerX[n]!, sweep.couplerY[n]!);
    expect(gap).toBeLessThan(1e-6);
    expect(sweep.assemblable).toBe(true);
    expect(Number.isFinite(sweep.rockerSwingDeg)).toBe(true);
    expect(Number.isFinite(sweep.minTransmissionDeg)).toBe(true);
    expect(sweep.type).toBe('crank-rocker');
    expect(sweep.minTransmissionDeg).toBeGreaterThan(0);
    expect(sweep.maxTransmissionDeg).toBeLessThanOrEqual(90.0001);
  });

  it('rocker swing angle of the classic crank-rocker matches the analytic range', () => {
    // r1=1, r2=4, r3=3, r4=4: rocker extremes at the two crank/ground
    // collinear positions (toggle positions), θ3 ∈ [φ−α] evaluated there.
    const l: FourBarLinks = { r1: 1, r2: 4, r3: 3, r4: 4 };
    const swing = (t1: number): number => solveFourBar(l, t1, 'open').theta3;
    const t3a = swing(0); // crank extended
    const t3b = swing(Math.PI); // crank folded back
    const analytic = Math.abs(t3a - t3b) * (180 / Math.PI);
    const sweep = sweepFourBar(l, 'open', { c: l.r2 / 2, e: 0 }, 1440);
    expect(Math.abs(sweep.rockerSwingDeg - analytic)).toBeLessThan(0.5);
  });
});

describe('eng-kin cam: motion laws', () => {
  it('cycloidal / 3-4-5 / modified-trapezoid have v = a = 0 at both ends; SHM has v = 0 and finite a', () => {
    for (const law of ['cycloid', 'poly345', 'modtrap'] as const) {
      for (const tau of [0, 1]) {
        const m = motionLaw(law, tau);
        expect(Math.abs(m.s - (tau === 0 ? 0 : 1))).toBeLessThan(1e-12);
        expect(Math.abs(m.v)).toBeLessThan(1e-9);
        expect(Math.abs(m.a)).toBeLessThan(1e-9);
      }
    }
    // SHM (cosine acceleration): zero end velocity, finite end acceleration.
    const s0 = motionLaw('shm', 0);
    const s1 = motionLaw('shm', 1);
    expect(Math.abs(s0.v)).toBeLessThan(1e-12);
    expect(Math.abs(s1.v)).toBeLessThan(1e-12);
    expect(Math.abs(s0.a - Math.PI * Math.PI / 2)).toBeLessThan(1e-12);
    expect(Math.abs(s1.a + Math.PI * Math.PI / 2)).toBeLessThan(1e-12);
  });

  it('every law is a unit-stroke monotone rise with symmetric peaks', () => {
    for (const law of ['shm', 'cycloid', 'poly345', 'modtrap'] as const) {
      let prev = 0;
      for (let i = 1; i <= 100; i += 1) {
        const m = motionLaw(law, i / 100);
        expect(m.s).toBeGreaterThanOrEqual(prev - 1e-12);
        expect(m.s).toBeLessThanOrEqual(1 + 1e-12);
        prev = m.s;
      }
      const peaks = motionLawPeaks(law);
      expect(peaks.vMax).toBeGreaterThan(0);
      expect(peaks.aMax).toBeGreaterThan(0);
    }
  });

  it('cam displacement diagram follows rise/dwell/return/dwell with matching extremes', () => {
    const p: CamParams = {
      r0: 40, rollerR: 8, h: 20, riseB: 120, dwellB: 60, returnB: 120,
      offset: 0, lawRise: 'cycloid', lawReturn: 'cycloid', follower: 'roller',
    };
    const mid = camMotion(p, (60 * Math.PI) / 180);
    expect(mid.s).toBeCloseTo(10, 6); // half-way up the rise
    expect(camMotion(p, (150 * Math.PI) / 180).s).toBeCloseTo(20, 9); // full dwell
    expect(camMotion(p, (350 * Math.PI) / 180).s).toBeCloseTo(0, 9); // trailing dwell
    const cam = designCam(p);
    expect(cam.dwell2).toBe(60);
    expect(cam.vMax).toBeCloseTo((20 / ((120 * Math.PI) / 180)) * 2, 6); // cycloid peak v = 2
  });

  it('pressure angle follows tan(alpha) = |ds/dtheta| / (r0 + s) and shrinks with a larger base circle', () => {
    const p = (r0: number): CamParams => ({
      r0, rollerR: 8, h: 20, riseB: 120, dwellB: 60, returnB: 120,
      offset: 0, lawRise: 'cycloid', lawReturn: 'cycloid', follower: 'roller',
    });
    const cam = designCam(p(40));
    // Exact pointwise check at mid-rise (tau = 0.5 → s' = 2·h/riseB).
    const theta = (60 * Math.PI) / 180;
    const m = camMotion(p(40), theta);
    const expected = (Math.atan(Math.abs(m.ds) / (p(40).r0 + m.s)) * 180) / Math.PI;
    const sample = cam.samples.find((s) => Math.abs(s.theta - theta) < 1e-9);
    expect(sample).toBeDefined();
    expect(Math.abs(sample!.pressureDeg - expected)).toBeLessThan(1e-9);
    // Larger prime circle → strictly smaller peak pressure angle.
    const bigger = designCam(p(60));
    expect(bigger.maxPressureRiseDeg).toBeLessThan(cam.maxPressureRiseDeg);
    expect(bigger.maxPressureRiseDeg).toBeGreaterThan(0);
  });

  it('roller envelope insets the pitch curve by the roller radius; flat follower reports the face length', () => {
    const p: CamParams = {
      r0: 40, rollerR: 8, h: 20, riseB: 120, dwellB: 60, returnB: 120,
      offset: 0, lawRise: 'cycloid', lawReturn: 'cycloid', follower: 'roller',
    };
    const cam = designCam(p);
    // On the base circle (dwell at s=0) the actual profile radius = r0 − ...:
    // pitch radius r0, inset by rollerR along the normal → radius r0 − rollerR
    // only where the profile is locally circular; check the offset distance.
    let maxDev = 0;
    for (const smp of cam.samples) {
      maxDev = Math.max(maxDev, Math.abs(dist(smp.px, smp.py, smp.ax, smp.ay) - p.rollerR));
    }
    // Central-difference normals are accurate to O(h²); allow a small margin.
    expect(maxDev).toBeLessThan(0.5);
    expect(cam.undercut).toBe(false);
    const flat = designCam({ ...p, follower: 'flat' });
    // Flat face: required length = max|ds/dtheta| = 2·h/riseB.
    expect(flat.faceLength).toBeCloseTo((2 * 20) / ((120 * Math.PI) / 180), 6);
    expect(flat.maxPressureRiseDeg).toBe(0);
  });
});

describe('eng-kin gear trains', () => {
  it('fixed-axis train multiplies stage ratios; idler cancels the direction', () => {
    const simple = fixedTrain([{ za: 20, zb: 60 }]);
    expect(simple.ratio).toBeCloseTo(-1 / 3, 12);
    expect(simple.reversed).toBe(true);
    expect(simple.reduction).toBeCloseTo(3, 12);
    // 20:30 → 30:20: two external meshes → same direction, |i| = 1.
    const idler = fixedTrain([{ za: 20, zb: 30 }, { za: 30, zb: 20 }]);
    expect(idler.ratio).toBeCloseTo(1, 12);
    expect(idler.reversed).toBe(false);
    // Compound: 20:60 then 30:90 → |i| = 3·3 = 9.
    const compound = fixedTrain([{ za: 20, zb: 60 }, { za: 30, zb: 90 }]);
    expect(compound.reduction).toBeCloseTo(9, 12);
    expect(compound.reversed).toBe(true);
  });

  it('Willis equation: 2K-H planetary with ring fixed gives i = 1 + zr/zs', () => {
    // zs=20, zp=30 → zr=80; sun input, ring fixed: i_sH = 1 + 80/20 = 5.
    const r = planetary({ zs: 20, zp: 30, fixed: 'ring', input: 'sun', wIn: 10 });
    expect(r.zr).toBe(80);
    expect(r.wCarrier).toBeCloseTo(2, 9);
    expect(Math.abs(r.i - 5) / 5).toBeLessThan(1e-3);
    expect(r.wRing).toBe(0);
    // Same direction as the sun (positive carrier speed for positive input).
    expect(r.wCarrier * r.wSun).toBeGreaterThan(0);
  });

  it('Willis equation: sun fixed gives wR/wH = 1 + zs/zr; carrier input rotates the whole body', () => {
    const r = planetary({ zs: 20, zp: 30, fixed: 'sun', input: 'ring', wIn: 12 });
    expect(r.wCarrier).toBeCloseTo(12 / (1 + 20 / 80), 9);
    expect(r.wSun).toBe(0);
    const rigid = planetary({ zs: 20, zp: 30, fixed: 'ring', input: 'carrier', wIn: 4 });
    expect(rigid.wSun).toBeCloseTo(4, 9);
    expect(rigid.wRing).toBeCloseTo(4, 9);
    // Equally spaced planets: (zs + zr) = 100 divisible by 4, not by 3.
    expect(rigid.evenlySpacedPlanets(4)).toBe(true);
    expect(rigid.evenlySpacedPlanets(3)).toBe(false);
  });

  it('contact ratio of typical standard pairs lies in 1.2–2.2 and matches the reference value', () => {
    // z1=20, z2=40, m=2, alpha=20°: εα = 1.6337 (standard involute formula).
    const g = gearPair(20, 40, 2);
    expect(g.contactRatio).toBeGreaterThan(1.2);
    expect(g.contactRatio).toBeLessThan(2.2);
    expect(Math.abs(g.contactRatio - 1.6337)).toBeLessThan(0.01);
    expect(g.continuousDrive).toBe(true);
    expect(g.alphaWdeg).toBeCloseTo(20, 9);
    // A bigger pinion / larger addendum pushes εα up but stays below 2.2.
    const g2 = gearPair(25, 63, 2);
    expect(g2.contactRatio).toBeGreaterThan(g.contactRatio);
    expect(g2.contactRatio).toBeLessThan(2.2);
    // Profile shift increases the working pressure angle.
    const shifted = gearPair(20, 40, 2, 20, 0.3, 0.3);
    expect(shifted.alphaWdeg).toBeGreaterThan(20);
    expect(shifted.aw).toBeGreaterThan(shifted.a);
  });
});

describe('eng-kin polygons and batch input', () => {
  it('velocity polygon closes (p→a + a→b = p→b) and vB ⊥ O4B', () => {
    const l: FourBarLinks = { r1: 1, r2: 4, r3: 3, r4: 4 };
    const poly = velocityPolygon(l, 1.2, 2, 'open', { c: 2, e: 0 });
    const a = poly.nodes.find((n) => n.id === 'a')!;
    const b = poly.nodes.find((n) => n.id === 'b')!;
    const sAB = poly.segments.find((s) => s.from === 'a' && s.to === 'b')!;
    // vB − vA = vBA.
    expect(Math.abs(b.x - a.x - sAB.dx)).toBeLessThan(1e-12);
    expect(Math.abs(b.y - a.y - sAB.dy)).toBeLessThan(1e-12);
    // vB ⊥ O4B: O4B direction is (cos θ3, sin θ3).
    const pose = solveFourBar(l, 1.2, 'open');
    const dot = b.x * Math.cos(pose.theta3) + b.y * Math.sin(pose.theta3);
    expect(Math.abs(dot)).toBeLessThan(1e-9);
  });

  it('acceleration polygon: at theta1 = 90 deg, aA points along −x with |aA| = w1²·r1', () => {
    const l: FourBarLinks = { r1: 1, r2: 4, r3: 3, r4: 4 };
    const poly = accelerationPolygon(l, Math.PI / 2, 2, 'open', { c: 2, e: 0 });
    const a = poly.nodes.find((n) => n.id === 'a')!;
    expect(a.x).toBeCloseTo(-4, 12);
    expect(Math.abs(a.y)).toBeLessThan(1e-12);
  });

  it('parseFourBarInput accepts CSV with/without header and JSON, deterministically', () => {
    const csv = 'r1,r2,r3,r4\n1,4,3,4\n3,4,4,1\n';
    const rows = parseFourBarInput(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.type).toBe('crank-rocker');
    expect(rows[1]!.type).toBe('double-crank');
    const headerless = parseFourBarInput('2,7,3,6\n');
    expect(headerless[0]!.type).toBe('change-point');
    const json = parseFourBarInput(JSON.stringify({ r1: 4, r2: 1, r3: 4, r4: 3 }));
    expect(json[0]!.type).toBe('double-rocker');
    const jsonRows = parseFourBarInput(JSON.stringify({ rows: [{ r1: 2, r2: 7, r3: 3, r4: 5.5 }] }));
    expect(jsonRows[0]!.type).toBe('no-crank');
    // Deterministic across runs.
    expect(parseFourBarInput(csv)).toEqual(rows);
  });
});
