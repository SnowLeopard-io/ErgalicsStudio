// ==========================================================================
// eng-kin kernel — mechanism kinematics: planar four-bar linkage, cam
// profile design, gear-train ratios and velocity/acceleration polygons.
// Pure numeric core: no DOM, no plugin-framework imports.
//
// Notation (four-bar, 1-based to match the CSV columns r1..r4):
//   r1 crank O2->A (input, angle theta1 driven by the frame clock)
//   r2 coupler A->B,  r3 rocker B->O4,  r4 ground O2->O4 (along +x)
// Closed-form assembly by circle intersection (two branches: open / crossed);
// angular velocities and accelerations from the analytic vector-loop
// equations; coupler-curve sampling and the Kennedy instant center I13
// (ground-coupler) = line(O2,A) ∩ line(O4,B).
//
// Cam: disk cam with translating roller or flat-face follower. Motion laws
// (SHM, cycloidal, 3-4-5 polynomial, modified trapezoid) are normalized to
// unit stroke over the segment; theoretical (roller-center / pitch) and
// actual (envelope) profiles, pressure angle for roller followers, required
// flat-face length and undercut screening.
//
// Gear: fixed-axis trains (series of external/internal meshes, idlers fall
// out naturally) and the 2K-H planetary via the Willis equation
//   ws + rho*wr − (1+rho)*wH = 0,  rho = zr/zs.
// Involute profile contact ratio εα for standard & shifted spur pairs.
//
// References: standard theory of machines texts, e.g. R. L. Norton,
// "Design of Machinery"; G. Niemann, "Maschinenelemente" (gears).
// ==========================================================================

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Unit vector at angle t. */
function u(t: number): [number, number] {
  return [Math.cos(t), Math.sin(t)];
}

/** Clamped acos (returns NaN only if the argument is NaN). */
function acosClamp(x: number): number {
  return Math.acos(Math.min(1, Math.max(-1, x)));
}

/** Solve inv(alpha) = target for alpha ∈ [alpha0, 45°] by bisection. */
function invAlpha(alpha0: number, target: number): number {
  let lo = alpha0;
  let hi = (45 * Math.PI) / 180;
  for (let k = 0; k < 80; k += 1) {
    const mid = (lo + hi) / 2;
    if (Math.tan(mid) - mid < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export class KinematicsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KinematicsError';
  }
}

// ===========================================================================
// 1. FOUR-BAR LINKAGE
// ===========================================================================

export type GrashofType =
  | 'crank-rocker'
  | 'double-crank'
  | 'double-rocker'
  | 'change-point'
  | 'no-crank';

export type Branch = 'open' | 'crossed';

export interface FourBarLinks {
  /** Crank O2->A (input). */
  r1: number;
  /** Coupler A->B. */
  r2: number;
  /** Rocker B->O4. */
  r3: number;
  /** Ground O2->O4. */
  r4: number;
}

export interface FourBarPose {
  theta1: number;
  /** Coupler angle (global frame). */
  theta2: number;
  /** Rocker angle measured at O4. */
  theta3: number;
  O2: [number, number];
  O4: [number, number];
  A: [number, number];
  B: [number, number];
  /** |O4A|, the distance resolved by the circle intersection. */
  d: number;
  /** Closed-loop position residual |A + r2·u(θ2) − (O4 + r3·u(θ3))|. */
  residual: number;
}

/**
 * Grashof classification (r4 = ground). Grashof (s + l < p + q): a side link
 * adjacent to the ground is a crank → 'crank-rocker'; shortest ground link →
 * 'double-crank' (drag link); shortest coupler → 'double-rocker'. Equality
 * s + l = p + q is the 'change-point' case; s + l > p + q admits no crank.
 */
export function grashofType(l: FourBarLinks): GrashofType {
  const arr = [l.r1, l.r2, l.r3, l.r4];
  if (arr.some((v) => !(v > 0))) throw new KinematicsError('link lengths must be > 0');
  const s = Math.min(...arr);
  const len = Math.max(...arr);
  const pq = arr.reduce((a, b) => a + b, 0) - s - len;
  if (s + len > pq + 1e-12) return 'no-crank';
  if (Math.abs(s + len - pq) <= 1e-12) return 'change-point';
  if (s === l.r2) return 'double-rocker';
  if (s === l.r4) return 'double-crank';
  return 'crank-rocker';
}

/** True when the crank r1 can make full revolutions (assembled at all θ1). */
export function crankRotates(l: FourBarLinks): boolean {
  const t = grashofType(l);
  return t === 'crank-rocker' || t === 'double-crank';
}

/**
 * Solve the closed-loop assembly at crank angle theta1 for one branch
 * ('open' | 'crossed') by circle intersection of |P − A| = r2 around A and
 * |P − O4| = r3 around O4. residual is the closed-loop position error
 * (typically ~1e-15). Returns NaN geometry when the circles do not
 * intersect: the linkage cannot be assembled at this theta1.
 */
export function solveFourBar(l: FourBarLinks, theta1: number, branch: Branch = 'open'): FourBarPose {
  const O2: [number, number] = [0, 0];
  const O4: [number, number] = [l.r4, 0];
  const [c1, s1] = u(theta1);
  const A: [number, number] = [l.r1 * c1, l.r1 * s1];
  const dx = A[0] - O4[0];
  const dy = A[1] - O4[1];
  const d = Math.hypot(dx, dy);
  const phi = Math.atan2(dy, dx);
  const unassembled: FourBarPose = {
    theta1, theta2: NaN, theta3: NaN, O2, O4, A, B: [NaN, NaN], d, residual: NaN,
  };
  if (d > l.r2 + l.r3 || d < Math.abs(l.r2 - l.r3) || d === 0) return unassembled;

  // Triangle O4-A-B: sides d (O4A), r2 (AB), r3 (O4B).
  const alpha = acosClamp((d * d + l.r3 * l.r3 - l.r2 * l.r2) / (2 * d * l.r3)); // angle at O4
  const beta = acosClamp((d * d + l.r2 * l.r2 - l.r3 * l.r3) / (2 * d * l.r2)); // angle at A
  const sgn = branch === 'open' ? -1 : 1;
  const theta3 = phi + sgn * alpha;
  const psi = Math.atan2(-dy, -dx); // direction A -> O4
  const theta2 = psi - sgn * beta;
  const B: [number, number] = [O4[0] + l.r3 * Math.cos(theta3), O4[1] + l.r3 * Math.sin(theta3)];
  const residual = Math.hypot(A[0] + l.r2 * Math.cos(theta2) - B[0], A[1] + l.r2 * Math.sin(theta2) - B[1]);
  return { theta1, theta2, theta3, O2, O4, A, B, d, residual };
}

interface FourBarAngles {
  theta2: number;
  theta3: number;
}

/** Angles only (fast path used by sweeps). */
function fourBarAngles(l: FourBarLinks, theta1: number, branch: Branch): FourBarAngles | null {
  const dx = l.r1 * Math.cos(theta1) - l.r4;
  const dy = l.r1 * Math.sin(theta1);
  const d = Math.hypot(dx, dy);
  if (d > l.r2 + l.r3 || d < Math.abs(l.r2 - l.r3) || d === 0) return null;
  const phi = Math.atan2(dy, dx);
  const alpha = acosClamp((d * d + l.r3 * l.r3 - l.r2 * l.r2) / (2 * d * l.r3));
  const beta = acosClamp((d * d + l.r2 * l.r2 - l.r3 * l.r3) / (2 * d * l.r2));
  const sgn = branch === 'open' ? -1 : 1;
  return { theta2: Math.atan2(-dy, -dx) - sgn * beta, theta3: phi + sgn * alpha };
}

export interface FourBarKinematics {
  pose: FourBarPose;
  /** Angular velocity of coupler / rocker (rad/s) for the given w1. */
  w2: number;
  w3: number;
  /** Angular accelerations (rad/s²) at constant w1 (alpha1 = 0). */
  a2: number;
  a3: number;
  /** Transmission angle mu (deg): coupler-rocker angle folded to ≤ 90°. */
  transmissionAngleDeg: number;
  /** Kennedy instant centers I13 (ground-coupler) and I24 (crank-rocker). */
  i13: [number, number] | null;
  i24: [number, number] | null;
}

/**
 * Analytic vector-loop kinematics at theta1 with input speed w1 (rad/s).
 * Throws when the configuration cannot be assembled or is singular
 * (sin(theta3 − theta2) = 0: change points / parallelogram lock-ups).
 */
export function fourBarKinematics(l: FourBarLinks, theta1: number, w1: number, branch: Branch = 'open'): FourBarKinematics {
  const pose = solveFourBar(l, theta1, branch);
  if (!Number.isFinite(pose.theta2)) {
    throw new KinematicsError(`linkage cannot be assembled at theta1 = ${theta1}`);
  }
  const { theta2, theta3 } = pose;
  const s32 = Math.sin(theta3 - theta2);
  const s31 = Math.sin(theta3 - theta1);
  const s21 = Math.sin(theta2 - theta1);
  const denom = l.r2 * s32;
  if (Math.abs(denom) < 1e-12) {
    throw new KinematicsError('singular configuration (change point): velocities unbounded');
  }
  const w2 = (-l.r1 * w1 * s31) / denom;
  const w3 = (l.r1 * w1 * s21) / (l.r3 * Math.sin(theta2 - theta3));

  // Accelerations (alpha1 = 0): R = r1·w1²·u1 + r2·w2²·u2 − r3·w3²·u3,
  //   r2·a2·u(θ2+90°) − r3·a3·u(θ3+90°) = R.
  const Rx = l.r1 * w1 * w1 * Math.cos(theta1) + l.r2 * w2 * w2 * Math.cos(theta2) - l.r3 * w3 * w3 * Math.cos(theta3);
  const Ry = l.r1 * w1 * w1 * Math.sin(theta1) + l.r2 * w2 * w2 * Math.sin(theta2) - l.r3 * w3 * w3 * Math.sin(theta3);
  const a2 = (Rx * Math.cos(theta3) + Ry * Math.sin(theta3)) / denom;
  const a3 = -(Rx * Math.cos(theta2) + Ry * Math.sin(theta2)) / (l.r3 * Math.sin(theta2 - theta3));

  // Transmission angle between coupler and rocker, folded so 90° is ideal.
  let mu = Math.abs(theta3 - theta2);
  if (mu > Math.PI / 2) mu = Math.PI - mu;
  const ic = instantCenters(l, pose);
  return { pose, w2, w3, a2, a3, transmissionAngleDeg: (mu * 180) / Math.PI, i13: ic.i13, i24: ic.i24 };
}

/**
 * Kennedy instant centers. I13 (ground-coupler) is the intersection of the
 * crank line O2-A with the rocker line O4-B; I24 (crank-rocker) the
 * intersection of the ground line O2-O4 with the coupler line A-B.
 * Returns null for (near-)parallel lines (center at infinity).
 */
export function instantCenters(l: FourBarLinks, pose: FourBarPose): { i13: [number, number] | null; i24: [number, number] | null } {
  const intersect = (
    p1: [number, number], p2: [number, number], p3: [number, number], p4: [number, number],
  ): [number, number] | null => {
    const d1x = p2[0] - p1[0];
    const d1y = p2[1] - p1[1];
    const d2x = p4[0] - p3[0];
    const d2y = p4[1] - p3[1];
    const det = d1x * d2y - d1y * d2x;
    if (Math.abs(det) < 1e-9) return null;
    const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / det;
    return [p1[0] + t * d1x, p1[1] + t * d1y];
  };
  return {
    i13: intersect(pose.O2, pose.A, pose.O4, pose.B),
    i24: intersect(pose.O2, pose.O4, pose.A, pose.B),
  };
}

export interface CouplerPoint {
  /** Distance along the coupler from A (0..r2). */
  c: number;
  /** Perpendicular offset from the coupler axis (left normal). */
  e: number;
}

export interface FourBarSweep {
  theta1: number[];
  theta2: number[];
  theta3: number[];
  /** Coupler-point path (closed when the crank rotates fully). */
  couplerX: number[];
  couplerY: number[];
  /** Rocker swing (deg) and transmission-angle range over the cycle. */
  rockerSwingDeg: number;
  minTransmissionDeg: number;
  maxTransmissionDeg: number;
  type: GrashofType;
  assemblable: boolean;
}

/** Coupler-point position for a pose. */
export function couplerPoint(pose: FourBarPose, cp: CouplerPoint): [number, number] {
  const [c2, s2] = u(pose.theta2);
  return [pose.A[0] + cp.c * c2 - cp.e * s2, pose.A[1] + cp.c * s2 + cp.e * c2];
}

/**
 * Sweep the crank through one revolution (n samples) and collect angles,
 * the coupler-point path and the transmission-angle / swing statistics.
 * Non-assemblable positions are recorded as NaN and clear `assemblable`.
 */
export function sweepFourBar(
  l: FourBarLinks,
  branch: Branch,
  cp: CouplerPoint = { c: l.r2 / 2, e: 0 },
  n = 720,
): FourBarSweep {
  const type = grashofType(l);
  const theta1: number[] = [];
  const theta2: number[] = [];
  const theta3: number[] = [];
  const couplerX: number[] = [];
  const couplerY: number[] = [];
  let t3Min = Infinity;
  let t3Max = -Infinity;
  let muMin = Infinity;
  let muMax = -Infinity;
  let assemblable = true;
  for (let i = 0; i <= n; i += 1) {
    const t1 = (i / n) * TAU;
    theta1.push(t1);
    const ang = fourBarAngles(l, t1, branch);
    if (!ang) {
      assemblable = false;
      theta2.push(NaN);
      theta3.push(NaN);
      couplerX.push(NaN);
      couplerY.push(NaN);
      continue;
    }
    theta2.push(ang.theta2);
    theta3.push(ang.theta3);
    if (ang.theta3 < t3Min) t3Min = ang.theta3;
    if (ang.theta3 > t3Max) t3Max = ang.theta3;
    let mu = Math.abs(ang.theta3 - ang.theta2);
    if (mu > Math.PI / 2) mu = Math.PI - mu;
    if (mu < muMin) muMin = mu;
    if (mu > muMax) muMax = mu;
    const p = couplerPoint(solveFourBar(l, t1, branch), cp);
    couplerX.push(p[0]);
    couplerY.push(p[1]);
  }
  return {
    theta1, theta2, theta3, couplerX, couplerY,
    rockerSwingDeg: Number.isFinite(t3Min) ? ((t3Max - t3Min) * 180) / Math.PI : Number.NaN,
    minTransmissionDeg: Number.isFinite(muMin) ? (muMin * 180) / Math.PI : Number.NaN,
    maxTransmissionDeg: Number.isFinite(muMax) ? (muMax * 180) / Math.PI : Number.NaN,
    type,
    assemblable,
  };
}

// ===========================================================================
// 2. CAM — disk cam with translating follower
// ===========================================================================

export type CamLaw = 'shm' | 'cycloid' | 'poly345' | 'modtrap';

export interface MotionLawSample {
  /** Normalized displacement s ∈ [0, 1]. */
  s: number;
  /** ds/dτ (dimensionless velocity, τ = fraction of the segment). */
  v: number;
  /** d²s/dτ² (dimensionless acceleration). */
  a: number;
}

/**
 * Normalized motion-law library over τ ∈ [0, 1] (unit stroke):
 *  - shm:      simple harmonic (cosine acceleration) — v = 0 at both ends,
 *              finite non-zero end acceleration (soft shock).
 *  - cycloid:  cycloidal — v = 0 and a = 0 at both ends.
 *  - poly345:  3-4-5 polynomial — v = 0 and a = 0 at both ends.
 *  - modtrap:  modified trapezoid (cosine-ramped constant acceleration) —
 *              v = 0 and a = 0 at both ends.
 * τ outside [0, 1] clamps to the endpoints.
 */
export function motionLaw(law: CamLaw, tau: number): MotionLawSample {
  const x = Math.min(1, Math.max(0, tau));
  switch (law) {
    case 'shm': {
      return {
        s: 0.5 * (1 - Math.cos(Math.PI * x)),
        v: 0.5 * Math.PI * Math.sin(Math.PI * x),
        a: 0.5 * Math.PI * Math.PI * Math.cos(Math.PI * x),
      };
    }
    case 'cycloid': {
      return {
        s: x - Math.sin(TAU * x) / TAU,
        v: 1 - Math.cos(TAU * x),
        a: TAU * Math.sin(TAU * x),
      };
    }
    case 'poly345': {
      return {
        s: x * x * x * (10 - 15 * x + 6 * x * x),
        v: 30 * x * x * (1 - 2 * x + x * x),
        a: 60 * x * (1 - 3 * x + 2 * x * x),
      };
    }
    case 'modtrap': {
      // Acceleration peak a0 fixed by the unit-stroke condition (exact
      // piecewise integration of the cosine-ramped trapezoid, 16/3).
      const A0 = 16 / 3;
      const k = 8 * Math.PI;
      if (x > 0.5) {
        // Mirror: s(1−τ) complement, v symmetric, a antisymmetric.
        const m = modtrapHalf(1 - x, A0, k);
        return { s: 1 - m.s, v: m.v, a: -m.a };
      }
      return modtrapHalf(x, A0, k);
    }
  }
}

/** Modified-trapezoid v/a/s over the first half [0, 1/2] (analytic). */
function modtrapHalf(x: number, A0: number, k: number): MotionLawSample {
  const b1 = 1 / 8;
  const b2 = 3 / 8;
  // Segment 1 [0, 1/8]: a = A0(1 − cos kτ)/2, V = ∫f, S = ∫V.
  const V1 = (t: number): number => (t - Math.sin(k * t) / k) / 2;
  const S1 = (t: number): number => (t * t / 2 + (Math.cos(k * t) - 1) / (k * k)) / 2;
  if (x <= b1) return { s: A0 * S1(x), v: A0 * V1(x), a: A0 * (1 - Math.cos(k * x)) / 2 };
  // Segment endpoints of segment 1.
  const vB1 = V1(b1); // = 1/16 (sin(k·b1) = sin π = 0)
  const sB1 = S1(b1);
  // Segment 2 [1/8, 3/8]: a = A0, V(τ) = V(b1) + (τ − b1) = τ − 1/16.
  const S2 = (t: number): number => sB1 + (t * t / 2 - t / 16) - (b1 * b1 / 2 - b1 / 16);
  if (x <= b2) return { s: A0 * S2(x), v: A0 * (x - 1 / 16), a: A0 };
  // Segment 3 [3/8, 1/2]: a = A0(1 + cos k(τ − 3/8))/2.
  const v2b = b2 - 1 / 16; // V(b2)
  const S2b = S2(b2);
  const dt = x - b2;
  return {
    s: A0 * (S2b + v2b * dt + dt * dt / 4 + (1 - Math.cos(k * dt)) / (2 * k * k)),
    v: A0 * (v2b + (dt + Math.sin(k * dt) / k) / 2),
    a: A0 * (1 + Math.cos(k * dt)) / 2,
  };
}

/** Peak normalized velocity / acceleration of a law (dense scan). */
export function motionLawPeaks(law: CamLaw): { vMax: number; aMax: number } {
  let vMax = 0;
  let aMax = 0;
  for (let i = 0; i <= 4000; i += 1) {
    const m = motionLaw(law, i / 4000);
    vMax = Math.max(vMax, Math.abs(m.v));
    aMax = Math.max(aMax, Math.abs(m.a));
  }
  return { vMax, aMax };
}

export type FollowerType = 'roller' | 'flat';

export interface CamParams {
  /** Prime-circle radius (roller-center base circle), length units. */
  r0: number;
  /** Roller radius (roller follower only). */
  rollerR: number;
  /** Follower stroke (lift). */
  h: number;
  /** Rise / dwell / return angles (deg); final dwell = 360 − sum. */
  riseB: number;
  dwellB: number;
  returnB: number;
  /** Offset of the follower guide from the cam center (roller only). */
  offset: number;
  lawRise: CamLaw;
  lawReturn: CamLaw;
  follower: FollowerType;
}

export interface CamSample {
  theta: number;
  /** Follower displacement. */
  s: number;
  /** ds/dtheta. */
  ds: number;
  /** d²s/dtheta². */
  dds: number;
  /** Pressure angle (deg); 0 for flat followers. */
  pressureDeg: number;
  /** Theoretical (roller-center / pitch) profile point. */
  px: number;
  py: number;
  /** Actual cam profile (envelope) point. */
  ax: number;
  ay: number;
}

export interface CamResult {
  samples: CamSample[];
  /** Segment boundaries in radians (rise end, dwell end, return end). */
  riseEnd: number;
  dwellEnd: number;
  returnEnd: number;
  /** Peak |pressure angle| on rise / return (deg). */
  maxPressureRiseDeg: number;
  maxPressureReturnDeg: number;
  /** Minimum pitch-curve radius of curvature (undercut when < rollerR). */
  minCurvatureRadius: number;
  undercut: boolean;
  /** Required flat-face half-length about the guide axis (flat only). */
  faceLength: number;
  /** Peak follower speed / acceleration over the cycle. */
  vMax: number;
  aMax: number;
  /** Trailing dwell (deg). */
  dwell2: number;
}

/** Displacement diagram of the whole cycle at cam angle theta (rad). */
export function camMotion(p: CamParams, theta: number): { s: number; ds: number; dds: number } {
  const rise = p.riseB * DEG;
  const dwell = p.dwellB * DEG;
  const ret = p.returnB * DEG;
  const t = ((theta % TAU) + TAU) % TAU;
  if (t < rise) {
    const m = motionLaw(p.lawRise, t / rise);
    return { s: p.h * m.s, ds: (p.h / rise) * m.v, dds: (p.h / (rise * rise)) * m.a };
  }
  if (t < rise + dwell) return { s: p.h, ds: 0, dds: 0 };
  if (t < rise + dwell + ret) {
    const m = motionLaw(p.lawReturn, (t - rise - dwell) / ret);
    return { s: p.h * (1 - m.s), ds: -(p.h / ret) * m.v, dds: -(p.h / (ret * ret)) * m.a };
  }
  return { s: 0, ds: 0, dds: 0 };
}

/**
 * Full cam design: motion diagram, theoretical (pitch) and actual (envelope)
 * profiles, pressure angles, curvature screening and face length.
 * Roller follower (offset e): pitch radius ρ = s + √(r0² − e²), tan α =
 * |ds/dθ − e|/ρ; actual profile = pitch curve inset by the roller radius.
 * Flat-face follower: Q = (r0+s)·u + (ds/dθ)·u⊥, no pressure angle.
 */
export function designCam(p: CamParams, n = 720): CamResult {
  if (!(p.r0 > 0)) throw new KinematicsError('base circle radius must be > 0');
  if (!(p.h > 0)) throw new KinematicsError('stroke must be > 0');
  if (p.follower === 'roller' && !(p.rollerR > 0)) throw new KinematicsError('roller radius must be > 0');
  const sum = p.riseB + p.dwellB + p.returnB;
  if (!(sum > 0) || sum >= 360) throw new KinematicsError('rise+dwell+return must lie in (0, 360) deg');
  if (p.follower === 'roller' && Math.abs(p.offset) >= p.r0) {
    throw new KinematicsError('|offset| must be < base circle radius');
  }
  const rise = p.riseB * DEG;
  const dwell = p.dwellB * DEG;
  const ret = p.returnB * DEG;
  const e = p.follower === 'roller' ? p.offset : 0;
  const s0 = Math.sqrt(p.r0 * p.r0 - e * e);
  const samples: CamSample[] = [];
  let maxPRise = 0;
  let maxPRet = 0;
  let face = 0;
  let vMax = 0;
  let aMax = 0;

  for (let i = 0; i < n; i += 1) {
    const theta = (i / n) * TAU;
    const m = camMotion(p, theta);
    vMax = Math.max(vMax, Math.abs(m.ds));
    aMax = Math.max(aMax, Math.abs(m.dds));
    if (p.follower === 'roller') {
      const pressure = Math.atan2(Math.abs(m.ds - e), m.s + s0);
      if (theta < rise) maxPRise = Math.max(maxPRise, pressure);
      if (theta >= rise + dwell && theta < rise + dwell + ret) maxPRet = Math.max(maxPRet, pressure);
      const rad = m.s + s0;
      const px = rad * Math.cos(theta) - e * Math.sin(theta);
      const py = rad * Math.sin(theta) + e * Math.cos(theta);
      samples.push({ theta, s: m.s, ds: m.ds, dds: m.dds, pressureDeg: (pressure * 180) / Math.PI, px, py, ax: NaN, ay: NaN });
    } else {
      const px = (p.r0 + m.s) * Math.cos(theta) - m.ds * Math.sin(theta);
      const py = (p.r0 + m.s) * Math.sin(theta) + m.ds * Math.cos(theta);
      face = Math.max(face, Math.abs(m.ds));
      samples.push({ theta, s: m.s, ds: m.ds, dds: m.dds, pressureDeg: 0, px, py, ax: px, ay: py });
    }
  }

  let minCurv = Infinity;
  if (p.follower === 'roller') {
    // Actual profile = pitch curve inset by rollerR along the outward
    // normal ((ty, −tx)/|T| for a CCW-traced curve).
    for (let i = 0; i < n; i += 1) {
      const a = samples[i]!;
      const b = samples[(i + 1) % n]!;
      let tx = b.px - a.px;
      let ty = b.py - a.py;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      a.ax = a.px - p.rollerR * ty;
      a.ay = a.py + p.rollerR * tx;
    }
    // Curvature radius of the pitch curve (central differences) → undercut.
    for (let i = 0; i < n; i += 1) {
      const pm = samples[(i - 1 + n) % n]!;
      const p0 = samples[i]!;
      const pp = samples[(i + 1) % n]!;
      const x1 = pp.px - pm.px;
      const y1 = pp.py - pm.py;
      const x2 = pp.px - 2 * p0.px + pm.px;
      const y2 = pp.py - 2 * p0.py + pm.py;
      const speed = Math.hypot(x1, y1);
      const kappa = Math.abs(x1 * y2 - y1 * x2) / Math.pow(speed, 3);
      if (Number.isFinite(kappa) && kappa > 1e-12) minCurv = Math.min(minCurv, 1 / kappa);
    }
  }
  return {
    samples,
    riseEnd: rise,
    dwellEnd: rise + dwell,
    returnEnd: rise + dwell + ret,
    maxPressureRiseDeg: (maxPRise * 180) / Math.PI,
    maxPressureReturnDeg: (maxPRet * 180) / Math.PI,
    minCurvatureRadius: minCurv,
    undercut: p.follower === 'roller' && Number.isFinite(minCurv) && minCurv < p.rollerR,
    faceLength: face,
    vMax,
    aMax,
    dwell2: 360 - sum,
  };
}

// ===========================================================================
// 3. GEAR TRAINS
// ===========================================================================

export interface GearStage {
  /** Driver tooth count. */
  za: number;
  /** Driven tooth count. */
  zb: number;
  /** Internal mesh (ring gear) does not reverse the direction. */
  internal?: boolean;
}

export interface FixedTrainResult {
  /** ω_out / ω_in including sign (negative = reversed). */
  ratio: number;
  /** |ω_in / ω_out| — the speed reduction factor. */
  reduction: number;
  reversed: boolean;
  /** Per-stage ω_out/ω_in contributions. */
  stages: Array<{ za: number; zb: number; internal: boolean; ratio: number }>;
}

/**
 * Fixed-axis (ordinary) train: stages in series. Each external mesh flips
 * the sign, so an idler gear (two external meshes) cancels out and only
 * changes the direction twice = not at all.
 */
export function fixedTrain(stages: GearStage[]): FixedTrainResult {
  if (stages.length === 0) throw new KinematicsError('train needs at least one stage');
  let ratio = 1;
  const detail: FixedTrainResult['stages'] = [];
  for (const st of stages) {
    if (!(st.za > 0) || !(st.zb > 0)) throw new KinematicsError('tooth counts must be > 0');
    const r = (st.internal ? 1 : -1) * (st.za / st.zb);
    ratio *= r;
    detail.push({ za: st.za, zb: st.zb, internal: !!st.internal, ratio: r });
  }
  return { ratio, reduction: Math.abs(1 / ratio), reversed: ratio < 0, stages: detail };
}

export type PlanetMember = 'sun' | 'ring' | 'carrier';

export interface PlanetaryParams {
  /** Sun teeth. */
  zs: number;
  /** Planet teeth (ring derived: zr = zs + 2·zp, standard assembly). */
  zp: number;
  /** Fixed member. */
  fixed: PlanetMember;
  /** Input (driven) member; must differ from `fixed`. */
  input: PlanetMember;
  /** Input speed (rad/s, signed). */
  wIn: number;
}

export interface PlanetaryResult {
  zs: number;
  zp: number;
  zr: number;
  /** Member speeds (rad/s, signed). */
  wSun: number;
  wRing: number;
  wCarrier: number;
  /** ω_input / ω_output for the requested fixed/input pair. */
  i: number;
  /** Assembly check: (zs + zr) divisible by n → equally spaced planets. */
  evenlySpacedPlanets: (n: number) => boolean;
}

/**
 * 2K-H planetary (sun–planet–ring) from the Willis equation
 *   (ωs − ωH)/(ωr − ωH) = −zr/zs  ⇔  ωs + ρ·ωr − (1+ρ)·ωH = 0,
 * with one member fixed and one driven. Ring teeth from the standard
 * concentric assembly zr = zs + 2·zp.
 */
export function planetary(p: PlanetaryParams): PlanetaryResult {
  if (!(p.zs > 0) || !(p.zp > 0)) throw new KinematicsError('tooth counts must be > 0');
  if (p.fixed === p.input) throw new KinematicsError('fixed and input members must differ');
  const zr = p.zs + 2 * p.zp;
  const rho = zr / p.zs;
  const idx = (m: PlanetMember): number => (m === 'sun' ? 0 : m === 'ring' ? 1 : 2);
  const coeffs = [1, rho, -(1 + rho)];
  const w = [0, 0, 0];
  const free = (['sun', 'ring', 'carrier'] as PlanetMember[]).find((m) => m !== p.fixed && m !== p.input)!;
  w[idx(p.fixed)] = 0;
  w[idx(p.input)] = p.wIn;
  w[idx(free)] = (-coeffs[idx(p.input)] * p.wIn) / coeffs[idx(free)];
  const [wSun, wRing, wCarrier] = [w[0]!, w[1]!, w[2]!];
  return {
    zs: p.zs,
    zp: p.zp,
    zr,
    wSun,
    wRing,
    wCarrier,
    i: w[idx(p.input)] / w[idx(free)],
    evenlySpacedPlanets: (n: number): boolean => Number.isInteger((p.zs + zr) / n),
  };
}

export interface GearPairGeometry {
  z1: number;
  z2: number;
  module: number;
  alphaDeg: number;
  haStar: number;
  x1: number;
  x2: number;
  /** Reference center distance a = m(z1+z2)/2. */
  a: number;
  /** Actual (working) center distance aw. */
  aw: number;
  /** Working pressure angle (deg). */
  alphaWdeg: number;
  /** Profile contact ratio εα. */
  contactRatio: number;
  /** εα ≥ 1 required for continuous drive. */
  continuousDrive: boolean;
}

/**
 * External spur gear pair (standard involute, optional profile shift).
 * Working pressure angle from inv(α') = inv(α) + 2(x1+x2)·tanα/(z1+z2),
 * aw = a·cosα/cosα'; contact ratio
 *   εα = [√(ra1²−rb1²) + √(ra2²−rb2²) − aw·sinα'] / (π·m·cosα).
 */
export function gearPair(
  z1: number,
  z2: number,
  module = 1,
  alphaDeg = 20,
  x1 = 0,
  x2 = 0,
  haStar = 1,
): GearPairGeometry {
  if (!(z1 >= 5) || !(z2 >= 5)) throw new KinematicsError('tooth counts must be ≥ 5');
  if (!(module > 0)) throw new KinematicsError('module must be > 0');
  const alpha = alphaDeg * DEG;
  const a = (module * (z1 + z2)) / 2;
  let alphaW = alpha;
  if (x1 + x2 !== 0) {
    const invW = involuteFn(alpha) + (2 * (x1 + x2) * Math.tan(alpha)) / (z1 + z2);
    alphaW = invAlpha(alpha, invW);
  }
  const aw = (a * Math.cos(alpha)) / Math.cos(alphaW);
  const rb1 = (module * z1 * Math.cos(alpha)) / 2;
  const rb2 = (module * z2 * Math.cos(alpha)) / 2;
  const ra1 = module * (z1 / 2 + haStar + x1);
  const ra2 = module * (z2 / 2 + haStar + x2);
  const g1 = Math.sqrt(Math.max(ra1 * ra1 - rb1 * rb1, 0));
  const g2 = Math.sqrt(Math.max(ra2 * ra2 - rb2 * rb2, 0));
  const eps = (g1 + g2 - aw * Math.sin(alphaW)) / (Math.PI * module * Math.cos(alpha));
  return {
    z1, z2, module, alphaDeg, haStar, x1, x2,
    a,
    aw,
    alphaWdeg: (alphaW * 180) / Math.PI,
    contactRatio: eps,
    continuousDrive: eps >= 1,
  };
}

/** Involute function inv(α) = tan α − α (α in rad). */
function involuteFn(alpha: number): number {
  return Math.tan(alpha) - alpha;
}

// ===========================================================================
// 4. MOTION — velocity / acceleration polygon data (graphical method, datafied)
// ===========================================================================

export interface PolygonSegment {
  from: string;
  to: string;
  dx: number;
  dy: number;
  magnitude: number;
  label: string;
}

export interface PolygonData {
  nodes: Array<{ id: string; x: number; y: number }>;
  segments: PolygonSegment[];
  title: string;
}

/**
 * Velocity polygon for the four-bar at theta1 with input speed w1 (rad/s).
 * Nodes: p (pole), a (vA = w1·r1 ⊥ O2A), b (vB = vA + vBA, ⊥ O4B),
 * c (coupler point: vC = vA + w2 × AP).
 */
export function velocityPolygon(l: FourBarLinks, theta1: number, w1: number, branch: Branch, cp: CouplerPoint): PolygonData {
  const k = fourBarKinematics(l, theta1, w1, branch);
  const pose = k.pose;
  const vAx = -l.r1 * w1 * Math.sin(theta1);
  const vAy = l.r1 * w1 * Math.cos(theta1);
  // vBA = w2 × AB = w2·r2·u(θ2 + 90°).
  const vBAx = -l.r2 * k.w2 * Math.sin(pose.theta2);
  const vBAy = l.r2 * k.w2 * Math.cos(pose.theta2);
  const vBx = vAx + vBAx;
  const vBy = vAy + vBAy;
  const [cx0, cy0] = couplerPoint(pose, cp);
  const apx = cx0 - pose.A[0];
  const apy = cy0 - pose.A[1];
  const vCx = vAx - k.w2 * apy;
  const vCy = vAy + k.w2 * apx;
  return {
    nodes: [
      { id: 'p', x: 0, y: 0 },
      { id: 'a', x: vAx, y: vAy },
      { id: 'b', x: vBx, y: vBy },
      { id: 'c', x: vCx, y: vCy },
    ],
    segments: [
      { from: 'p', to: 'a', dx: vAx, dy: vAy, magnitude: Math.hypot(vAx, vAy), label: 'vA = w1·r1' },
      { from: 'a', to: 'b', dx: vBAx, dy: vBAy, magnitude: Math.hypot(vBAx, vBAy), label: 'vBA = w2·r2' },
      { from: 'p', to: 'b', dx: vBx, dy: vBy, magnitude: Math.hypot(vBx, vBy), label: 'vB = w3·r3' },
      { from: 'a', to: 'c', dx: vCx - vAx, dy: vCy - vAy, magnitude: Math.hypot(vCx - vAx, vCy - vAy), label: 'vCA = w2·AP' },
      { from: 'p', to: 'c', dx: vCx, dy: vCy, magnitude: Math.hypot(vCx, vCy), label: 'vC' },
    ],
    title: 'velocity polygon',
  };
}

/**
 * Acceleration polygon at constant input speed (alpha1 = 0).
 * aA = w1²·r1 (A→O2); aB = aA + aBA^n + aBA^t with aBA^n = w2²·r2 (B→A) and
 * aBA^t = alpha2·r2 (⊥AB); coupler point: aC = aA + α2×AP − w2²·AP.
 */
export function accelerationPolygon(l: FourBarLinks, theta1: number, w1: number, branch: Branch, cp: CouplerPoint): PolygonData {
  const k = fourBarKinematics(l, theta1, w1, branch);
  const pose = k.pose;
  const aAx = -l.r1 * w1 * w1 * Math.cos(theta1);
  const aAy = -l.r1 * w1 * w1 * Math.sin(theta1);
  const [c2, s2] = u(pose.theta2);
  // aBA^n = w2²·r2 directed B→A = −u(θ2); aBA^t = α2·r2·u(θ2 + 90°).
  const anX = -l.r2 * k.w2 * k.w2 * c2;
  const anY = -l.r2 * k.w2 * k.w2 * s2;
  const atX = -l.r2 * k.a2 * s2;
  const atY = l.r2 * k.a2 * c2;
  const aBx = aAx + anX + atX;
  const aBy = aAy + anY + atY;
  const [cx0, cy0] = couplerPoint(pose, cp);
  const apx = cx0 - pose.A[0];
  const apy = cy0 - pose.A[1];
  const aCx = aAx - k.a2 * apy - k.w2 * k.w2 * apx;
  const aCy = aAy + k.a2 * apx - k.w2 * k.w2 * apy;
  return {
    nodes: [
      { id: 'p', x: 0, y: 0 },
      { id: 'a', x: aAx, y: aAy },
      { id: 'b', x: aBx, y: aBy },
      { id: 'c', x: aCx, y: aCy },
    ],
    segments: [
      { from: 'p', to: 'a', dx: aAx, dy: aAy, magnitude: Math.hypot(aAx, aAy), label: 'aA^n = w1²·r1' },
      { from: 'a', to: 'b', dx: anX + atX, dy: anY + atY, magnitude: Math.hypot(anX + atX, anY + atY), label: 'aBA' },
      { from: 'p', to: 'b', dx: aBx, dy: aBy, magnitude: Math.hypot(aBx, aBy), label: 'aB' },
      { from: 'a', to: 'c', dx: aCx - aAx, dy: aCy - aAy, magnitude: Math.hypot(aCx - aAx, aCy - aAy), label: 'aCA' },
      { from: 'p', to: 'c', dx: aCx, dy: aCy, magnitude: Math.hypot(aCx, aCy), label: 'aC' },
    ],
    title: 'acceleration polygon',
  };
}

// ===========================================================================
// Batch compute (CSV / JSON): rows r1,r2,r3,r4 → Grashof + swing table
// ===========================================================================

export interface FourBarRow {
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  branch: Branch;
  type: GrashofType;
  crankRotates: boolean;
  rockerSwingDeg: number;
  minTransmissionDeg: number;
  maxTransmissionDeg: number;
  assemblable: boolean;
}

/** Analyze one four-bar row (pure, deterministic). */
export function analyzeFourBarRow(r1: number, r2: number, r3: number, r4: number, branch: Branch = 'open'): FourBarRow {
  const l = { r1, r2, r3, r4 };
  const sweep = sweepFourBar(l, branch, { c: r2 / 2, e: 0 }, 360);
  return {
    r1, r2, r3, r4, branch,
    type: sweep.type,
    crankRotates: crankRotates(l),
    rockerSwingDeg: sweep.rockerSwingDeg,
    minTransmissionDeg: sweep.minTransmissionDeg,
    maxTransmissionDeg: sweep.maxTransmissionDeg,
    assemblable: sweep.assemblable,
  };
}

/**
 * Parse CSV or JSON input into four-bar rows. Accepted shapes:
 *  - CSV with a header containing r1,r2,r3,r4 (extra columns ignored);
 *  - CSV without a header (≥ 4 numeric columns per line);
 *  - JSON { r1, r2, r3, r4, branch? } or { rows: [{ r1..r4, branch? }] }.
 */
export function parseFourBarInput(input: unknown): FourBarRow[] {
  const triples: Array<{ r1: number; r2: number; r3: number; r4: number; branch: Branch }> = [];
  const add = (v1: unknown, v2: unknown, v3: unknown, v4: unknown, branch: unknown): void => {
    const n = [v1, v2, v3, v4].map((v) => (typeof v === 'number' ? v : Number(String(v ?? '').trim())));
    if (n.some((v) => !Number.isFinite(v))) throw new KinematicsError('each row needs numeric r1,r2,r3,r4');
    triples.push({ r1: n[0]!, r2: n[1]!, r3: n[2]!, r4: n[3]!, branch: branch === 'crossed' ? 'crossed' : 'open' });
  };
  if (typeof input === 'string') {
    const text = input.trim();
    if (text.startsWith('{') || text.startsWith('[')) {
      return parseFourBarInput(JSON.parse(text) as unknown);
    }
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) throw new KinematicsError('empty input');
    const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
    const hasHeader = ['r1', 'r2', 'r3', 'r4'].every((c) => header.includes(c));
    for (const line of hasHeader ? lines.slice(1) : lines) {
      const cells = line.split(',').map((c) => c.trim());
      if (hasHeader) {
        const col = (name: string): unknown => {
          const i = header.indexOf(name);
          return i >= 0 ? cells[i] : undefined;
        };
        add(col('r1'), col('r2'), col('r3'), col('r4'), col('branch'));
      } else {
        add(cells[0], cells[1], cells[2], cells[3], undefined);
      }
    }
  } else if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.rows)) {
      for (const r of obj.rows) {
        const o = r as Record<string, unknown>;
        add(o.r1, o.r2, o.r3, o.r4, o.branch);
      }
    } else if ('r1' in obj) {
      add(obj.r1, obj.r2, obj.r3, obj.r4, obj.branch);
    } else {
      throw new KinematicsError('JSON input needs { r1, r2, r3, r4 } or { rows: [...] }');
    }
  } else {
    throw new KinematicsError('unsupported input type');
  }
  if (triples.length === 0) throw new KinematicsError('no data rows found');
  return triples.map((t) => analyzeFourBarRow(t.r1, t.r2, t.r3, t.r4, t.branch));
}
