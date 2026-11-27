// ==========================================================================
// eng-mechanism kernel — planar mechanism kinematics: four-bar linkage,
// disk-cam profile synthesis and gear-train ratios.
// Pure numeric core: no DOM, no plugin-framework imports. Every quantity is
// closed-form or a bounded deterministic scan, so results are reproducible.
//
// Four-bar conventions (Norton-style link numbering):
//   link 1 ground O2->O4 (length d, along +x), link 2 crank O2->A (length a,
//   input angle theta2), link 3 coupler A->B (b), link 4 rocker O4->B (c).
//   Angles theta2/theta3/theta4 measured from +x. Branch 'open' | 'crossed'
//   selects the two circle-intersection assembly modes.
// Position: exact circle intersection of |P-A| = b around A and |P-O4| = c
// around O4 (residual ~1e-16). Velocities: differentiated vector loop
//   w3 = (a·w2/b)·sin(theta4 - theta2)/sin(theta3 - theta4)
//   w4 = (a·w2/c)·sin(theta2 - theta3)/sin(theta4 - theta3)
// Coupler-point velocity vP = vA + w3 x AP (cross-checked against central
// differences of the position in tests/eng-mechanism.test.ts).
//
// Cam: translating roller follower with offset e, prime-circle radius r0.
// Motion laws on tau in [0,1] (unit stroke): SHM (cosine acceleration),
// cycloidal and 3-4-5 polynomial (zero end acceleration). Pitch curve
// rho(theta) = s(theta) + sqrt(r0^2 - e^2); pressure angle
// tan(alpha) = |ds/dtheta - e| / (s + sqrt(r0^2 - e^2)); actual profile =
// pitch curve inset by the roller radius; undercut = convex pitch-curve
// radius of curvature < roller radius.
//
// Gears: fixed-axis trains (stage ratios multiply, external meshes flip the
// sign) and the 2K-H planetary via the Willis equation
//   w_sun + rho·w_ring - (1 + rho)·w_carrier = 0,  rho = z_ring/z_sun.
//
// References: standard theory-of-machines texts, e.g. R. L. Norton,
// "Design of Machinery"; H. H. Mabie & F. W. Ocvirk, "Mechanisms and
// Dynamics of Machinery".
// ==========================================================================

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Unit vector at angle t. */
function u(t: number): [number, number] {
  return [Math.cos(t), Math.sin(t)];
}

/** Clamped acos (never returns NaN for a finite argument in [-1-eps, 1+eps]). */
function acosClamp(x: number): number {
  return Math.acos(Math.min(1, Math.max(-1, x)));
}

/** Raised for invalid parameters or unassemblable configurations. */
export class MechanismError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MechanismError';
  }
}

// ===========================================================================
// 1. FOUR-BAR LINKAGE
// ===========================================================================

export interface FourBarLinks {
  /** Crank O2->A (input). */
  a: number;
  /** Coupler A->B. */
  b: number;
  /** Rocker O4->B. */
  c: number;
  /** Ground O2->O4. */
  d: number;
}

export type GrashofClass =
  | 'crank-rocker'
  | 'double-crank'
  | 'double-rocker'
  | 'change-point'
  | 'no-crank';

export type Branch = 'open' | 'crossed';

/**
 * Grashof classification with the ground link fixed (d). Grashof
 * (s + l < p + q): the shortest side link adjacent to the ground gives a
 * crank-rocker, the shortest ground link a double-crank (drag link), the
 * shortest coupler a double-rocker. s + l = p + q is the change-point case;
 * s + l > p + q admits no crank (triple rocker).
 */
export function grashofClass(l: FourBarLinks): GrashofClass {
  const arr = [l.a, l.b, l.c, l.d];
  if (arr.some((v) => !(v > 0))) throw new MechanismError('link lengths must be > 0');
  const s = Math.min(...arr);
  const len = Math.max(...arr);
  const pq = arr.reduce((acc, v) => acc + v, 0) - s - len;
  if (s + len > pq + 1e-12) return 'no-crank';
  if (Math.abs(s + len - pq) <= 1e-12) return 'change-point';
  if (s === l.b) return 'double-rocker';
  if (s === l.d) return 'double-crank';
  // Shortest is a side link (crank or rocker): both adjacent to the ground.
  return 'crank-rocker';
}

/** True when the input crank can make full revolutions (assembled at all theta2). */
export function crankRotates(l: FourBarLinks): boolean {
  const t = grashofClass(l);
  return t === 'crank-rocker' || t === 'double-crank';
}

export interface FourBarPose {
  theta2: number;
  theta3: number;
  theta4: number;
  O2: [number, number];
  O4: [number, number];
  A: [number, number];
  B: [number, number];
  /** Closed-loop position residual |A + b·u(theta3) - B|. */
  residual: number;
}

function unassemblablePose(theta2: number): FourBarPose {
  const nan = Number.NaN;
  return {
    theta2,
    theta3: nan,
    theta4: nan,
    O2: [0, 0],
    O4: [nan, nan],
    A: [nan, nan],
    B: [nan, nan],
    residual: nan,
  };
}

/**
 * Closed-loop assembly at crank angle theta2 by circle intersection of the
 * coupler circle (A, b) and the rocker circle (O4, c). Returns a pose with
 * NaN geometry when the circles do not intersect (linkage cannot be
 * assembled at this theta2). The residual is the closed-loop position error
 * (floating-point level, ~1e-16).
 */
export function solveFourBar(l: FourBarLinks, theta2: number, branch: Branch = 'open'): FourBarPose {
  const A: [number, number] = [l.a * Math.cos(theta2), l.a * Math.sin(theta2)];
  const O4: [number, number] = [l.d, 0];
  const dx = A[0] - O4[0];
  const dy = A[1] - O4[1];
  const dist = Math.hypot(dx, dy);
  if (dist > l.b + l.c || dist < Math.abs(l.b - l.c) || dist === 0) return unassemblablePose(theta2);
  // Triangle O4-A-B: sides dist (O4A), b (AB), c (O4B). alpha is the angle
  // at O4 between O4->A and O4->B; sgn picks the assembly branch.
  const phi = Math.atan2(dy, dx);
  const alpha = acosClamp((dist * dist + l.c * l.c - l.b * l.b) / (2 * dist * l.c));
  const sgn = branch === 'open' ? 1 : -1;
  const theta4 = phi + sgn * alpha;
  const B: [number, number] = [O4[0] + l.c * Math.cos(theta4), O4[1] + l.c * Math.sin(theta4)];
  const theta3 = Math.atan2(B[1] - A[1], B[0] - A[0]);
  const residual = Math.hypot(A[0] + l.b * Math.cos(theta3) - B[0], A[1] + l.b * Math.sin(theta3) - B[1]);
  return { theta2, theta3, theta4, O2: [0, 0], O4, A, B, residual };
}

export interface FourBarVelocity {
  /** Coupler / rocker angular velocities (rad/s) for input speed w2. */
  w3: number;
  w4: number;
  /** True when coupler and rocker are collinear (change point): NaN results. */
  singular: boolean;
}

/**
 * Analytic vector-loop angular velocities at a pose. NaN when the pose is
 * unassemblable or singular (sin(theta3 - theta4) = 0).
 */
export function fourBarVelocities(l: FourBarLinks, pose: FourBarPose, w2: number): FourBarVelocity {
  const { theta2, theta3, theta4 } = pose;
  if (!Number.isFinite(theta3)) return { w3: Number.NaN, w4: Number.NaN, singular: false };
  const sin34 = Math.sin(theta3 - theta4);
  if (Math.abs(sin34) < 1e-12) return { w3: Number.NaN, w4: Number.NaN, singular: true };
  const w3 = ((l.a * w2) / l.b) * (Math.sin(theta4 - theta2) / sin34);
  const w4 = ((l.a * w2) / l.c) * (Math.sin(theta2 - theta3) / Math.sin(theta4 - theta3));
  return { w3, w4, singular: false };
}

export interface CouplerPointDef {
  /** Distance along the coupler from A (0..b). */
  p: number;
  /** Perpendicular offset from the coupler axis (left normal). */
  q: number;
}

/** Coupler-point position P = A + p·u(theta3) + q·u(theta3 + 90 deg). */
export function couplerPoint(pose: FourBarPose, cp: CouplerPointDef): [number, number] {
  const [c3, s3] = u(pose.theta3);
  return [pose.A[0] + cp.p * c3 - cp.q * s3, pose.A[1] + cp.p * s3 + cp.q * c3];
}

/** Pin-joint A velocity vA = w2 x O2A = a·w2·u(theta2 + 90 deg). */
function vAComponents(l: FourBarLinks, theta2: number, w2: number): [number, number] {
  return [-l.a * w2 * Math.sin(theta2), l.a * w2 * Math.cos(theta2)];
}

/**
 * Coupler-point velocity vP = vA + w3 x AP, the single analytic
 * implementation used by sweeps, views and the numeric-difference benchmark.
 */
export function couplerPointVelocity(
  l: FourBarLinks,
  pose: FourBarPose,
  cp: CouplerPointDef,
  w2: number,
  w3: number,
): [number, number] {
  const vA = vAComponents(l, pose.theta2, w2);
  const P = couplerPoint(pose, cp);
  const apx = P[0] - pose.A[0];
  const apy = P[1] - pose.A[1];
  return [vA[0] - w3 * apy, vA[1] + w3 * apx];
}

/** Transmission angle mu: coupler-rocker angle folded so 90 deg is ideal. */
export function transmissionAngleDeg(theta3: number, theta4: number): number {
  // Wrap the raw difference into [0, pi) first: atan2 angles may differ by
  // more than pi (e.g. 311 deg), which is the same line direction as 48 deg.
  let mu = Math.abs(theta4 - theta3) % TAU;
  if (mu > Math.PI) mu = TAU - mu;
  if (mu > Math.PI / 2) mu = Math.PI - mu;
  return mu / DEG;
}

/**
 * Kennedy instant centers: I13 (ground-coupler) = line(O2,A) intersected
 * with line(O4,B); I24 (crank-rocker) = line(O2,O4) intersected with
 * line(A,B). Null for (near-)parallel lines (center at infinity).
 */
export function instantCenters(pose: FourBarPose): {
  i13: [number, number] | null;
  i24: [number, number] | null;
} {
  const intersect = (
    p1: [number, number],
    p2: [number, number],
    p3: [number, number],
    p4: [number, number],
  ): [number, number] | null => {
    const d1x = p2[0] - p1[0];
    const d1y = p2[1] - p1[1];
    const d2x = p4[0] - p3[0];
    const d2y = p4[1] - p3[1];
    const det = d1x * d2y - d1y * d2x;
    if (Math.abs(det) < 1e-12) return null;
    const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / det;
    return [p1[0] + t * d1x, p1[1] + t * d1y];
  };
  return {
    i13: intersect(pose.O2, pose.A, pose.O4, pose.B),
    i24: intersect(pose.O2, pose.O4, pose.A, pose.B),
  };
}

export interface FourBarSweep {
  theta2Deg: number[];
  theta3Deg: number[];
  theta4Deg: number[];
  couplerX: number[];
  couplerY: number[];
  /** Coupler-point velocity components / magnitude for input speed w2. */
  vPx: number[];
  vPy: number[];
  vPmag: number[];
  /** Rocker angular velocity w4 (rad/s). */
  w4: number[];
  /** Transmission angle (deg, folded to <= 90). */
  muDeg: number[];
  grashof: GrashofClass;
  assemblable: boolean;
  /** Max closed-loop residual over the sweep. */
  maxResidual: number;
  minTransmissionDeg: number;
  maxTransmissionDeg: number;
  /** Rocker swing angle over the cycle (deg, unwrapped). */
  rockerSwingDeg: number;
  maxVp: number;
  maxW4: number;
}

/**
 * Sweep the crank through one revolution (n samples) collecting angles, the
 * coupler-point path, velocities and the transmission angle. Non-assemblable
 * or singular positions are recorded as NaN and clear `assemblable`.
 */
export function sweepFourBar(
  l: FourBarLinks,
  branch: Branch,
  cp: CouplerPointDef,
  w2 = 1,
  n = 360,
): FourBarSweep {
  const grashof = grashofClass(l);
  const theta2Deg: number[] = [];
  const theta3Deg: number[] = [];
  const theta4Deg: number[] = [];
  const couplerX: number[] = [];
  const couplerY: number[] = [];
  const vPx: number[] = [];
  const vPy: number[] = [];
  const vPmag: number[] = [];
  const w4: number[] = [];
  const muDeg: number[] = [];
  let maxResidual = 0;
  let muMin = Infinity;
  let muMax = -Infinity;
  let assemblable = true;
  let maxVp = 0;
  let maxW4 = 0;
  // Unwrapped rocker angle for the swing statistics.
  let t4u = Number.NaN;
  let t4uMin = Infinity;
  let t4uMax = -Infinity;
  for (let i = 0; i <= n; i += 1) {
    const t2 = (i / n) * TAU;
    const pose = solveFourBar(l, t2, branch);
    theta2Deg.push(t2 / DEG);
    if (!Number.isFinite(pose.theta3)) {
      assemblable = false;
      theta3Deg.push(Number.NaN);
      theta4Deg.push(Number.NaN);
      couplerX.push(Number.NaN);
      couplerY.push(Number.NaN);
      vPx.push(Number.NaN);
      vPy.push(Number.NaN);
      vPmag.push(Number.NaN);
      w4.push(Number.NaN);
      muDeg.push(Number.NaN);
      continue;
    }
    maxResidual = Math.max(maxResidual, pose.residual);
    // Unwrap theta4 (jumps larger than pi are branch wraps, not motion).
    if (Number.isFinite(t4u)) {
      let dt4 = pose.theta4 - (t4u % TAU);
      if (dt4 > Math.PI) dt4 -= TAU;
      if (dt4 < -Math.PI) dt4 += TAU;
      t4u += dt4;
    } else {
      t4u = pose.theta4;
    }
    if (t4u < t4uMin) t4uMin = t4u;
    if (t4u > t4uMax) t4uMax = t4u;
    theta3Deg.push(pose.theta3 / DEG);
    theta4Deg.push(pose.theta4 / DEG);
    const p = couplerPoint(pose, cp);
    couplerX.push(p[0]);
    couplerY.push(p[1]);
    const vel = fourBarVelocities(l, pose, w2);
    if (vel.singular || !Number.isFinite(vel.w3)) {
      vPx.push(Number.NaN);
      vPy.push(Number.NaN);
      vPmag.push(Number.NaN);
      w4.push(Number.NaN);
    } else {
      const v = couplerPointVelocity(l, pose, cp, w2, vel.w3);
      vPx.push(v[0]);
      vPy.push(v[1]);
      vPmag.push(Math.hypot(v[0], v[1]));
      w4.push(vel.w4);
      maxVp = Math.max(maxVp, Math.hypot(v[0], v[1]));
      maxW4 = Math.max(maxW4, Math.abs(vel.w4));
    }
    const mu = transmissionAngleDeg(pose.theta3, pose.theta4);
    muDeg.push(mu);
    if (mu < muMin) muMin = mu;
    if (mu > muMax) muMax = mu;
  }
  return {
    theta2Deg,
    theta3Deg,
    theta4Deg,
    couplerX,
    couplerY,
    vPx,
    vPy,
    vPmag,
    w4,
    muDeg,
    grashof,
    assemblable,
    maxResidual,
    minTransmissionDeg: Number.isFinite(muMin) ? muMin : Number.NaN,
    maxTransmissionDeg: Number.isFinite(muMax) ? muMax : Number.NaN,
    rockerSwingDeg: Number.isFinite(t4uMin) ? (t4uMax - t4uMin) / DEG : Number.NaN,
    maxVp,
    maxW4,
  };
}

/**
 * Coupler-point velocity by central finite difference of the position
 * (dP/dtheta2 · w2) — the numeric reference for the analytic vP.
 */
export function couplerVelocityNumeric(
  l: FourBarLinks,
  theta2: number,
  w2: number,
  branch: Branch,
  cp: CouplerPointDef,
  h = 1e-6,
): [number, number] {
  const plus = couplerPoint(solveFourBar(l, theta2 + h, branch), cp);
  const minus = couplerPoint(solveFourBar(l, theta2 - h, branch), cp);
  const k = w2 / (2 * h);
  return [(plus[0] - minus[0]) * k, (plus[1] - minus[1]) * k];
}

export interface VelocityView {
  pose: FourBarPose;
  vel: FourBarVelocity;
  /** Coupler-point position and velocity. */
  P: [number, number];
  vP: [number, number];
  /** Velocity of the pin joints A / B. */
  vA: [number, number];
  vB: [number, number];
  i13: [number, number] | null;
  i24: [number, number] | null;
  /** Relative-velocity polygon (pole at origin, node positions are vectors). */
  polygon: Array<{ label: string; dx: number; dy: number }>;
}

/**
 * Full instantaneous velocity picture: pin-joint velocities, coupler-point
 * velocity, Kennedy instant centers and the relative-velocity polygon
 * (p->a: vA, a->b: vBA, p->b: vB, a->c: vCA, p->c: vP).
 */
export function velocityView(
  l: FourBarLinks,
  theta2: number,
  w2: number,
  branch: Branch,
  cp: CouplerPointDef,
): VelocityView {
  const pose = solveFourBar(l, theta2, branch);
  if (!Number.isFinite(pose.theta3)) throw new MechanismError('linkage cannot be assembled at this crank angle');
  const vel = fourBarVelocities(l, pose, w2);
  if (vel.singular) throw new MechanismError('singular configuration (change point): velocities unbounded');
  const P = couplerPoint(pose, cp);
  const vA = vAComponents(l, theta2, w2);
  const vP = couplerPointVelocity(l, pose, cp, w2, vel.w3);
  const vB: [number, number] = [-l.c * vel.w4 * Math.sin(pose.theta4), l.c * vel.w4 * Math.cos(pose.theta4)];
  const ic = instantCenters(pose);
  return {
    pose,
    vel,
    P,
    vP,
    vA,
    vB,
    i13: ic.i13,
    i24: ic.i24,
    polygon: [
      { label: 'vA', dx: vA[0], dy: vA[1] },
      { label: 'vBA', dx: vB[0] - vA[0], dy: vB[1] - vA[1] },
      { label: 'vB', dx: vB[0], dy: vB[1] },
      { label: 'vCA', dx: vP[0] - vA[0], dy: vP[1] - vA[1] },
      { label: 'vP', dx: vP[0], dy: vP[1] },
    ],
  };
}

// ===========================================================================
// 2. CAM — disk cam with translating roller follower
// ===========================================================================

export type CamLaw = 'shm' | 'cycloid' | 'poly345';

export interface MotionSample {
  /** Normalized displacement s in [0, 1]. */
  s: number;
  /** ds/dtau (dimensionless). */
  v: number;
  /** d2s/dtau2 (dimensionless). */
  a: number;
}

/**
 * Normalized motion laws over tau in [0, 1] (unit stroke):
 *  - shm:     simple harmonic, v = 0 at both ends, continuous but non-zero
 *             end acceleration (soft shock).
 *  - cycloid: cycloidal, v = 0 and a = 0 at both ends.
 *  - poly345: 3-4-5 polynomial, v = 0 and a = 0 at both ends.
 * tau outside [0, 1] is clamped.
 */
export function motionLaw(law: CamLaw, tau: number): MotionSample {
  const x = Math.min(1, Math.max(0, tau));
  switch (law) {
    case 'shm':
      return {
        s: 0.5 * (1 - Math.cos(Math.PI * x)),
        v: 0.5 * Math.PI * Math.sin(Math.PI * x),
        a: 0.5 * Math.PI * Math.PI * Math.cos(Math.PI * x),
      };
    case 'cycloid':
      return {
        s: x - Math.sin(TAU * x) / TAU,
        v: 1 - Math.cos(TAU * x),
        a: TAU * Math.sin(TAU * x),
      };
    case 'poly345':
      return {
        s: x * x * x * (10 - 15 * x + 6 * x * x),
        v: 30 * x * x * (1 - 2 * x + x * x),
        a: 60 * x * (1 - 3 * x + 2 * x * x),
      };
  }
}

export interface CamTiming {
  /** Rise / dwell / return segment angles (deg); trailing dwell = 360 - sum. */
  riseDeg: number;
  dwellDeg: number;
  returnDeg: number;
}

/**
 * Parse user-editable timing text: "120,60,120" (also spaces, slashes or
 * semicolons as separators). Validates that the sum lies in (0, 360).
 */
export function parseCamTiming(text: string): CamTiming {
  const parts = text
    .split(/[,;/\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => Number(t));
  if (parts.length !== 3 || parts.some((v) => !Number.isFinite(v))) {
    throw new MechanismError('cam timing must be three numbers: rise,dwell,return (deg)');
  }
  const [rise, dwell, ret] = parts as [number, number, number];
  if (rise <= 0 || dwell < 0 || ret <= 0) throw new MechanismError('rise/return must be > 0 deg and dwell >= 0 deg');
  if (rise + dwell + ret >= 360) throw new MechanismError('rise+dwell+return must leave a trailing dwell (< 360 deg)');
  return { riseDeg: rise, dwellDeg: dwell, returnDeg: ret };
}

export interface CamParams {
  /** Prime-circle (base-circle) radius of the roller center. */
  r0: number;
  /** Roller radius. */
  rollerR: number;
  /** Follower stroke (lift). */
  stroke: number;
  timing: CamTiming;
  /** Follower-guide offset from the cam center (|e| < r0). */
  offset: number;
  lawRise: CamLaw;
  lawReturn: CamLaw;
}

export interface CamState {
  /** Follower displacement. */
  s: number;
  /** ds/dtheta (theta in rad). */
  ds: number;
  /** d2s/dtheta2. */
  dds: number;
}

/** Whole-cycle displacement diagram at cam angle theta (rad). */
export function camState(p: CamParams, theta: number): CamState {
  const rise = p.timing.riseDeg * DEG;
  const dwell = p.timing.dwellDeg * DEG;
  const ret = p.timing.returnDeg * DEG;
  const t = ((theta % TAU) + TAU) % TAU;
  if (t < rise) {
    const m = motionLaw(p.lawRise, t / rise);
    return { s: p.stroke * m.s, ds: (p.stroke / rise) * m.v, dds: (p.stroke / (rise * rise)) * m.a };
  }
  if (t < rise + dwell) return { s: p.stroke, ds: 0, dds: 0 };
  if (t < rise + dwell + ret) {
    const m = motionLaw(p.lawReturn, (t - rise - dwell) / ret);
    return { s: p.stroke * (1 - m.s), ds: -(p.stroke / ret) * m.v, dds: -(p.stroke / (ret * ret)) * m.a };
  }
  return { s: 0, ds: 0, dds: 0 };
}

export interface CamSample {
  thetaDeg: number;
  theta: number;
  s: number;
  ds: number;
  dds: number;
  pressureDeg: number;
  /** Theoretical (pitch / roller-center) profile point, cam body frame. */
  pitchX: number;
  pitchY: number;
  /** Actual cam profile (roller envelope) point, cam body frame. */
  actualX: number;
  actualY: number;
  /** Signed radius of curvature of the pitch curve (> 0 = convex). */
  curvatureR: number;
}

export interface CamResult {
  samples: CamSample[];
  riseEndDeg: number;
  dwellEndDeg: number;
  returnEndDeg: number;
  /** Trailing dwell (deg). */
  dwell2Deg: number;
  maxPressureRiseDeg: number;
  maxPressureReturnDeg: number;
  /** Minimum CONVEX pitch-curve radius of curvature (undercut criterion). */
  minConvexCurvatureR: number;
  undercut: boolean;
  vMax: number;
  aMax: number;
}

/**
 * Disk-cam synthesis for a translating offset roller follower. Pitch curve
 * rho = s + sqrt(r0^2 - e^2), pitch point
 * (rho·cos(theta) - e·sin(theta), rho·sin(theta) + e·cos(theta)); pressure
 * angle tan(alpha) = |ds/dtheta - e| / (s + sqrt(r0^2 - e^2)); the actual
 * profile is the pitch curve inset by the roller radius along the inward
 * normal; undercut when a CONVEX pitch segment has radius of curvature
 * below the roller radius.
 */
export function designCam(p: CamParams, n = 720): CamResult {
  if (!(p.r0 > 0)) throw new MechanismError('base circle radius must be > 0');
  if (!(p.stroke > 0)) throw new MechanismError('stroke must be > 0');
  if (!(p.rollerR > 0)) throw new MechanismError('roller radius must be > 0');
  if (Math.abs(p.offset) >= p.r0) throw new MechanismError('|offset| must be < base circle radius');
  const s0 = Math.sqrt(p.r0 * p.r0 - p.offset * p.offset);
  const samples: CamSample[] = [];
  let maxPRise = 0;
  let maxPRet = 0;
  let vMax = 0;
  let aMax = 0;
  const riseEnd = p.timing.riseDeg;
  const dwellEnd = riseEnd + p.timing.dwellDeg;
  const returnEnd = dwellEnd + p.timing.returnDeg;

  for (let i = 0; i < n; i += 1) {
    const theta = (i / n) * TAU;
    const st = camState(p, theta);
    vMax = Math.max(vMax, Math.abs(st.ds));
    aMax = Math.max(aMax, Math.abs(st.dds));
    const pressure = Math.atan2(Math.abs(st.ds - p.offset), st.s + s0);
    const thetaDeg = theta / DEG;
    if (thetaDeg < riseEnd) maxPRise = Math.max(maxPRise, pressure);
    else if (thetaDeg >= dwellEnd && thetaDeg < returnEnd) maxPRet = Math.max(maxPRet, pressure);
    const rho = st.s + s0;
    const px = rho * Math.cos(theta) - p.offset * Math.sin(theta);
    const py = rho * Math.sin(theta) + p.offset * Math.cos(theta);
    samples.push({
      thetaDeg,
      theta,
      s: st.s,
      ds: st.ds,
      dds: st.dds,
      pressureDeg: pressure / DEG,
      pitchX: px,
      pitchY: py,
      actualX: Number.NaN,
      actualY: Number.NaN,
      curvatureR: Number.NaN,
    });
  }

  // Actual profile: inset the pitch curve by rollerR along the inward normal.
  // The pitch curve is traced CCW, so the inward normal of the unit tangent
  // (tx, ty) is (-ty, tx)... it is the LEFT normal; for a CCW curve the left
  // normal points to the inside, which is where the cam material lies.
  for (let i = 0; i < n; i += 1) {
    const a = samples[i]!;
    const b = samples[(i + 1) % n]!;
    let tx = b.pitchX - a.pitchX;
    let ty = b.pitchY - a.pitchY;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    a.actualX = a.pitchX - p.rollerR * ty;
    a.actualY = a.pitchY + p.rollerR * tx;
  }

  // Signed curvature radius of the pitch curve (discrete, circular index).
  // Positive = center of curvature inside the curve (convex toward the
  // roller) — only convex segments with radius < rollerR undercut.
  let minConvex = Infinity;
  for (let i = 0; i < n; i += 1) {
    const pm = samples[(i - 1 + n) % n]!;
    const p0 = samples[i]!;
    const pp = samples[(i + 1) % n]!;
    const x1 = pp.pitchX - pm.pitchX;
    const y1 = pp.pitchY - pm.pitchY;
    const x2 = pp.pitchX - 2 * p0.pitchX + pm.pitchX;
    const y2 = pp.pitchY - 2 * p0.pitchY + pm.pitchY;
    const speed = Math.hypot(x1, y1);
    const cross = x1 * y2 - y1 * x2;
    // kappa = |x' x x''| / |x'|^3 with x' = (pp-pm)/(2h) and
    // x'' = (pp-2p0+pm)/h^2, which contributes the factor 4 below.
    const kappa = (4 * cross) / (speed * speed * speed); // signed 1/R
    p0.curvatureR = kappa !== 0 ? 1 / kappa : Number.POSITIVE_INFINITY;
    if (kappa > 1e-9) minConvex = Math.min(minConvex, 1 / kappa);
  }
  return {
    samples,
    riseEndDeg: riseEnd,
    dwellEndDeg: dwellEnd,
    returnEndDeg: returnEnd,
    dwell2Deg: 360 - returnEnd,
    maxPressureRiseDeg: maxPRise / DEG,
    maxPressureReturnDeg: maxPRet / DEG,
    minConvexCurvatureR: Number.isFinite(minConvex) ? minConvex : Number.POSITIVE_INFINITY,
    undercut: Number.isFinite(minConvex) && minConvex < p.rollerR,
    vMax,
    aMax,
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
  /** Internal (ring) mesh does not reverse the direction. */
  internal?: boolean;
}

export interface TrainResult {
  /** omega_out / omega_in including sign (negative = reversed). */
  ratio: number;
  /** |omega_in / omega_out| speed reduction factor. */
  reduction: number;
  reversed: boolean;
  stages: Array<{ za: number; zb: number; internal: boolean; ratio: number }>;
}

/**
 * Fixed-axis train: stages in series, overall ratio = product of the stage
 * ratios (each external mesh flips the sign, so an idler cancels out).
 */
export function gearTrain(stages: GearStage[]): TrainResult {
  if (stages.length === 0) throw new MechanismError('train needs at least one stage');
  let ratio = 1;
  const detail: TrainResult['stages'] = [];
  for (const st of stages) {
    if (!(st.za > 0) || !(st.zb > 0)) throw new MechanismError('tooth counts must be > 0');
    const r = (st.internal ? 1 : -1) * (st.za / st.zb);
    ratio *= r;
    detail.push({ za: st.za, zb: st.zb, internal: !!st.internal, ratio: r });
  }
  return { ratio, reduction: Math.abs(1 / ratio), reversed: ratio < 0, stages: detail };
}

/**
 * Parse user-editable stage text: "20/60, 30/90" (driver/driven per stage;
 * prefix "i:" marks an internal mesh, e.g. "i:20/80"). Semicolons and
 * spaces also work as separators.
 */
export function parseGearStages(text: string): GearStage[] {
  const stages: GearStage[] = [];
  const chunks = text.split(/[,;\s]+/).map((c) => c.trim()).filter((c) => c.length > 0);
  for (const chunk of chunks) {
    const m = /^(i:)?(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(chunk);
    if (!m) throw new MechanismError(`bad gear stage "${chunk}" (expected za/zb, e.g. 20/60)`);
    const za = Number(m[2]);
    const zb = Number(m[3]);
    if (!(za > 0) || !(zb > 0)) throw new MechanismError(`bad gear stage "${chunk}" (tooth counts must be > 0)`);
    stages.push({ za, zb, internal: !!m[1] });
  }
  if (stages.length === 0) throw new MechanismError('no gear stages given');
  return stages;
}

export type PlanetMember = 'sun' | 'ring' | 'carrier';

export interface WillisInput {
  /** Sun / planet tooth counts (ring derived: zr = zs + 2·zp). */
  zs: number;
  zp: number;
  /** Known member speeds (rad/s, signed); exactly two must be finite. */
  wSun: number | null;
  wRing: number | null;
  wCarrier: number | null;
}

export interface WillisResult {
  zs: number;
  zp: number;
  zr: number;
  rho: number;
  wSun: number;
  wRing: number;
  wCarrier: number;
  /** Residual of the Willis equation (sanity, ~1e-15). */
  residual: number;
}

/**
 * 2K-H planetary (sun-planet-ring) from the Willis equation
 *   (w_s - w_H)/(w_r - w_H) = -zr/zs  <=>  w_s + rho·w_r - (1+rho)·w_H = 0.
 * Given two member speeds the third follows in closed form ("differential"
 * operation with two inputs); fixing one member gives the classic
 * single-input ratios (e.g. ring fixed: i = w_s/w_H = 1 + zr/zs).
 */
export function willisSolve(input: WillisInput): WillisResult {
  if (!(input.zs > 0) || !(input.zp > 0)) throw new MechanismError('tooth counts must be > 0');
  const known = [input.wSun, input.wRing, input.wCarrier].filter((v) => v !== null && Number.isFinite(v));
  if (known.length !== 2) throw new MechanismError('exactly two member speeds must be given (third is solved)');
  const zr = input.zs + 2 * input.zp;
  const rho = zr / input.zs;
  // Willis row: [1, rho, -(1+rho)] · [w_s, w_r, w_H] = 0.
  const coef = [1, rho, -(1 + rho)];
  const w = [input.wSun ?? Number.NaN, input.wRing ?? Number.NaN, input.wCarrier ?? Number.NaN];
  const free = w.findIndex((v) => !Number.isFinite(v));
  let acc = 0;
  for (let i = 0; i < 3; i += 1) {
    if (i !== free) acc += coef[i]! * w[i]!;
  }
  w[free] = -acc / coef[free]!;
  const [wSun, wRing, wCarrier] = w as [number, number, number];
  return {
    zs: input.zs,
    zp: input.zp,
    zr,
    rho,
    wSun,
    wRing,
    wCarrier,
    residual: wSun + rho * wRing - (1 + rho) * wCarrier,
  };
}

// ===========================================================================
// 4. BATCH INPUT (CSV / JSON / DataTable) — four-bar link-set analysis
// ===========================================================================

export interface FourBarBatchRow {
  a: number;
  b: number;
  c: number;
  d: number;
  branch: Branch;
  grashof: GrashofClass;
  crankRotates: boolean;
  rockerSwingDeg: number;
  minTransmissionDeg: number;
  maxTransmissionDeg: number;
  assemblable: boolean;
}

/** Analyze one four-bar link set (pure, deterministic). */
export function analyzeFourBarRow(a: number, b: number, c: number, d: number, branch: Branch = 'open'): FourBarBatchRow {
  const l: FourBarLinks = { a, b, c, d };
  const sweep = sweepFourBar(l, branch, { p: b / 2, q: 0 }, 1, 360);
  return {
    a,
    b,
    c,
    d,
    branch,
    grashof: sweep.grashof,
    crankRotates: crankRotates(l),
    rockerSwingDeg: sweep.rockerSwingDeg,
    minTransmissionDeg: sweep.minTransmissionDeg,
    maxTransmissionDeg: sweep.maxTransmissionDeg,
    assemblable: sweep.assemblable,
  };
}

/** Minimal structural view of a DataTable (avoids a type-level coupling). */
interface TableLike {
  length: number;
  getColumn(name: string): unknown;
}

function isTableLike(v: unknown): v is TableLike {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { getColumn?: unknown }).getColumn === 'function' &&
    typeof (v as { length?: unknown }).length === 'number'
  );
}

/** Column aliases accepted for the four link lengths. */
const LINK_COLUMNS: Array<[keyof FourBarLinks, string[]]> = [
  ['a', ['a', 'r1', 'crank']],
  ['b', ['b', 'r2', 'coupler']],
  ['c', ['c', 'r3', 'rocker']],
  ['d', ['d', 'r4', 'ground']],
];

function readNumeric(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  if (!Number.isFinite(n)) throw new MechanismError('numeric link lengths required');
  return n;
}

/**
 * Parse batch four-bar input. Accepted shapes:
 *  - DataTable-like object with link-length columns (a/r1, b/r2, c/r3, d/r4);
 *  - CSV text with a header containing those names, or 4 headerless numeric
 *    columns per line (optional 5th column: branch);
 *  - JSON { a, b, c, d, branch? } or { rows: [{ a..d, branch? }] }.
 */
export function parseBatchInput(input: unknown): FourBarBatchRow[] {
  const raw: Array<{ a: number; b: number; c: number; d: number; branch: Branch }> = [];
  const add = (v1: unknown, v2: unknown, v3: unknown, v4: unknown, branch: unknown): void => {
    const n = [v1, v2, v3, v4].map(readNumeric);
    raw.push({ a: n[0]!, b: n[1]!, c: n[2]!, d: n[3]!, branch: branch === 'crossed' ? 'crossed' : 'open' });
  };

  if (isTableLike(input)) {
    const table = input;
    if (table.length === 0) throw new MechanismError('input table has no rows');
    for (let i = 0; i < table.length; i += 1) {
      const vals: number[] = [];
      let branch: Branch = 'open';
      for (const [, aliases] of LINK_COLUMNS) {
        let found = false;
        for (const name of aliases) {
          const col = table.getColumn(name) as ArrayLike<unknown> | undefined;
          if (col && i < col.length) {
            vals.push(readNumeric(col[i]));
            found = true;
            break;
          }
        }
        if (!found) throw new MechanismError('input table needs link-length columns (a/r1, b/r2, c/r3, d/r4)');
      }
      const bc = table.getColumn('branch') as ArrayLike<unknown> | undefined;
      if (bc && i < bc.length && String(bc[i]).trim() === 'crossed') branch = 'crossed';
      raw.push({ a: vals[0]!, b: vals[1]!, c: vals[2]!, d: vals[3]!, branch });
    }
  } else if (typeof input === 'string') {
    const text = input.trim();
    if (text.startsWith('{') || text.startsWith('[')) return parseBatchInput(JSON.parse(text) as unknown);
    const lines = text.split(/\r?\n/).map((ln) => ln.trim()).filter((ln) => ln.length > 0);
    if (lines.length === 0) throw new MechanismError('empty input');
    const header = lines[0]!.split(',').map((h) => h.trim().toLowerCase());
    const hasHeader = LINK_COLUMNS.every(([, aliases]) => aliases.some((nm) => header.includes(nm)));
    const colIndex = (aliases: string[]): number => {
      for (const nm of aliases) {
        const i = header.indexOf(nm);
        if (i >= 0) return i;
      }
      return -1;
    };
    for (const line of hasHeader ? lines.slice(1) : lines) {
      const cells = line.split(',').map((cc) => cc.trim());
      if (hasHeader) {
        const pick = (aliases: string[]): unknown => {
          const i = colIndex(aliases);
          return i >= 0 ? cells[i] : undefined;
        };
        add(pick(LINK_COLUMNS[0]![1]), pick(LINK_COLUMNS[1]![1]), pick(LINK_COLUMNS[2]![1]), pick(LINK_COLUMNS[3]![1]), cells[4]);
      } else {
        add(cells[0], cells[1], cells[2], cells[3], cells[4]);
      }
    }
  } else if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.rows)) {
      for (const r of obj.rows) {
        const o = r as Record<string, unknown>;
        add(o.a ?? o.r1, o.b ?? o.r2, o.c ?? o.r3, o.d ?? o.r4, o.branch);
      }
    } else if ('a' in obj || 'r1' in obj) {
      add(obj.a ?? obj.r1, obj.b ?? obj.r2, obj.c ?? obj.r3, obj.d ?? obj.r4, obj.branch);
    } else {
      throw new MechanismError('JSON input needs { a, b, c, d } or { rows: [...] }');
    }
  } else {
    throw new MechanismError('unsupported input type');
  }
  if (raw.length === 0) throw new MechanismError('no data rows found');
  return raw.map((r) => analyzeFourBarRow(r.a, r.b, r.c, r.d, r.branch));
}

export const MECH_TAU = TAU;
export const MECH_DEG = DEG;
