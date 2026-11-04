// ==========================================================================
// math-odefield — 2D autonomous ODE numerics (pure, dependency-free, testable)
//
// A recursive-descent parser compiling real expressions in (x, y) into
// closure trees, classic RK4 integration of autonomous vector fields
// (forward and backward along streamlines), Newton's method with a
// central-difference Jacobian for equilibrium localization, closed-form
// eigenvalues of the 2×2 Jacobian with the planar classification
// (saddle / node / spiral / center), and an invariant-manifold check that
// validates saddle eigenvector directions against integrated trajectories.
//
// All functions are pure so the kernel unit-tests without a canvas or DOM.
// The unified error metric throughout is |computed − analytic|/|analytic|.
// ==========================================================================

// ---- real expression parser (two variables, recursive descent) ----------------

type RNode = (x: number, y: number) => number;

interface Token {
  kind: 'num' | 'ident' | 'op' | 'lparen' | 'rparen';
  text: string;
  value?: number;
}

const R_FUNCTIONS: Record<string, (v: number) => number> = {
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  abs: Math.abs,
  atan: Math.atan,
};

const R_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

function rTokenize(src: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const match = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
      if (!match) return null;
      tokens.push({ kind: 'num', text: match[0], value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const match = /^[a-zA-Z_][a-zA-Z_0-9]*/.exec(src.slice(i))!;
      tokens.push({ kind: 'ident', text: match[0].toLowerCase() });
      i += match[0].length;
      continue;
    }
    if ('+-*/^'.includes(ch)) {
      tokens.push({ kind: 'op', text: ch });
      i += 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen', text: ch });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', text: ch });
      i += 1;
      continue;
    }
    return null;
  }
  return tokens;
}

/**
 * Compile a real-valued expression in `x` and `y` into an evaluation closure.
 * Grammar mirrors the complex parser (right-associative ^, unary ±, implicit
 * multiplication for `2x`, `x(x+1)`, `) (` forms); identifiers: x, y, pi, e
 * and the R_FUNCTIONS above.
 */
export function compileReal2(
  src: string,
): { ok: true; fn: (x: number, y: number) => number } | { ok: false; error: string } {
  const tokens = rTokenize(src);
  if (!tokens || tokens.length === 0) return { ok: false, error: 'invalid or empty expression' };
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token | undefined => tokens[pos++];

  const parseExpr = (): RNode | string => {
    let left = parseTerm();
    if (typeof left === 'string') return left;
    for (;;) {
      const t = peek();
      if (t && t.kind === 'op' && (t.text === '+' || t.text === '-')) {
        next();
        const right = parseTerm();
        if (typeof right === 'string') return right;
        const l: RNode = left;
        const r: RNode = right;
        left = t.text === '+' ? (x, y) => l(x, y) + r(x, y) : (x, y) => l(x, y) - r(x, y);
      } else {
        return left;
      }
    }
  };

  const startsPrimary = (t: Token | undefined): boolean =>
    !!t && (t.kind === 'num' || t.kind === 'ident' || t.kind === 'lparen');

  const parseTerm = (): RNode | string => {
    let left = parseUnary();
    if (typeof left === 'string') return left;
    for (;;) {
      const t = peek();
      if (t && t.kind === 'op' && (t.text === '*' || t.text === '/')) {
        next();
        const right = parseUnary();
        if (typeof right === 'string') return right;
        const l: RNode = left;
        const r: RNode = right;
        left = t.text === '*' ? (x, y) => l(x, y) * r(x, y) : (x, y) => l(x, y) / r(x, y);
      } else if (startsPrimary(t)) {
        // implicit multiplication: 2x, x y, x(x+1), (x+y)(x-y), 2pi …
        const right = parseUnary();
        if (typeof right === 'string') return right;
        const l: RNode = left;
        const r: RNode = right;
        left = (x, y) => l(x, y) * r(x, y);
      } else {
        return left;
      }
    }
  };

  const parseUnary = (): RNode | string => {
    const t = peek();
    if (t && t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      next();
      const operand = parseUnary();
      if (typeof operand === 'string') return operand;
      return t.text === '-' ? (x, y) => -operand(x, y) : operand;
    }
    return parsePower();
  };

  const parsePower = (): RNode | string => {
    const base = parsePrimary();
    if (typeof base === 'string') return base;
    const t = peek();
    if (t && t.kind === 'op' && t.text === '^') {
      next();
      const exp = parseUnary();
      if (typeof exp === 'string') return exp;
      return (x, y) => Math.pow(base(x, y), exp(x, y));
    }
    return base;
  };

  const parsePrimary = (): RNode | string => {
    const t = next();
    if (!t) return 'unexpected end of expression';
    if (t.kind === 'num') {
      const v = t.value ?? 0;
      return () => v;
    }
    if (t.kind === 'ident') {
      const name = t.text;
      if (name === 'x') return (x) => x;
      if (name === 'y') return (_x, y) => y;
      if (name in R_CONSTANTS) {
        const c = R_CONSTANTS[name]!;
        return () => c;
      }
      if (name in R_FUNCTIONS) {
        if (!peek() || peek()!.kind !== 'lparen') return `function '${name}' needs parentheses`;
        next();
        const arg = parseExpr();
        if (typeof arg === 'string') return arg;
        if (!peek() || peek()!.kind !== 'rparen') return `missing ')' after ${name}(…`;
        next();
        const f = R_FUNCTIONS[name]!;
        return (x, y) => f(arg(x, y));
      }
      return `unknown identifier '${t.text}'`;
    }
    if (t.kind === 'lparen') {
      const inner = parseExpr();
      if (typeof inner === 'string') return inner;
      if (!peek() || peek()!.kind !== 'rparen') return "missing ')'";
      next();
      return inner;
    }
    return `unexpected token '${t.text}'`;
  };

  const root = parseExpr();
  if (typeof root === 'string') return { ok: false, error: root };
  if (pos !== tokens.length) return { ok: false, error: `unexpected token '${tokens[pos]!.text}'` };
  return { ok: true, fn: root };
}

// ---- RK4 integration ------------------------------------------------------------

export type VectorField = (x: number, y: number) => [number, number];

/** One classic RK4 step of size h (h < 0 integrates backward in time). */
export function rk4Step(f: VectorField, x: number, y: number, h: number): [number, number] {
  const [a1, b1] = f(x, y);
  const [a2, b2] = f(x + (h / 2) * a1, y + (h / 2) * b1);
  const [a3, b3] = f(x + (h / 2) * a2, y + (h / 2) * b2);
  const [a4, b4] = f(x + h * a3, y + h * b3);
  return [
    x + (h / 6) * (a1 + 2 * a2 + 2 * a3 + a4),
    y + (h / 6) * (b1 + 2 * b2 + 2 * b3 + b4),
  ];
}

export interface StreamPoint {
  x: number;
  y: number;
  /** Field magnitude |f| at this point (for speed coloring). */
  speed: number;
}

/**
 * Integrate `steps` RK4 steps of size h from (x0, y0). Integration stops
 * early (returning fewer points) when the trajectory leaves the box
 * |x|,|y| ≤ bound or becomes non-finite. h < 0 integrates backward.
 */
export function integrateStream(
  f: VectorField,
  x0: number,
  y0: number,
  h: number,
  steps: number,
  bound = 1e6,
): StreamPoint[] {
  const [v0x, v0y] = f(x0, y0);
  const pts: StreamPoint[] = [{ x: x0, y: y0, speed: Math.hypot(v0x, v0y) }];
  let x = x0;
  let y = y0;
  for (let i = 0; i < steps; i += 1) {
    const [nx, ny] = rk4Step(f, x, y, h);
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || Math.abs(nx) > bound || Math.abs(ny) > bound) break;
    x = nx;
    y = ny;
    const [vx, vy] = f(x, y);
    pts.push({ x, y, speed: Math.hypot(vx, vy) });
  }
  return pts;
}

// ---- Newton equilibrium localization ----------------------------------------------

export interface Equilibrium {
  x: number;
  y: number;
  /** ‖f‖₂ at the final iterate. */
  residual: number;
  converged: boolean;
}

/**
 * Newton's method for f(x, y) = (0, 0) with a central-difference Jacobian
 * (step scaled to the iterate magnitude) and the 2×2 Cramer solve.
 */
export function newtonEquilibrium(f: VectorField, x0: number, y0: number, iters = 100): Equilibrium {
  let x = x0;
  let y = y0;
  for (let k = 0; k < iters; k += 1) {
    const [fx, fy] = f(x, y);
    const res = Math.hypot(fx, fy);
    if (!Number.isFinite(res)) return { x, y, residual: res, converged: false };
    if (res < 1e-12) return { x, y, residual: res, converged: true };
    const scale = Math.max(1, Math.abs(x), Math.abs(y));
    const eps = 1e-7 * scale;
    const [fpx, fpy] = f(x + eps, y);
    const [fmx, fmy] = f(x - eps, y);
    const [gpx, gpy] = f(x, y + eps);
    const [gmx, gmy] = f(x, y - eps);
    const j11 = (fpx - fmx) / (2 * eps); // ∂f/∂x
    const j21 = (fpy - fmy) / (2 * eps); // ∂g/∂x
    const j12 = (gpx - gmx) / (2 * eps); // ∂f/∂y
    const j22 = (gpy - gmy) / (2 * eps); // ∂g/∂y
    const det = j11 * j22 - j12 * j21;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-14) return { x, y, residual: res, converged: false };
    // Solve J·δ = −F by Cramer's rule.
    x += (-fx * j22 + fy * j12) / det;
    y += (-fy * j11 + fx * j21) / det;
  }
  const [fx, fy] = f(x, y);
  const res = Math.hypot(fx, fy);
  return { x, y, residual: res, converged: Number.isFinite(res) && res < 1e-8 };
}

/**
 * Central-difference Jacobian of the field at (x, y), row-major
 * [∂f/∂x, ∂f/∂y, ∂g/∂x, ∂g/∂y].
 */
export function numericJacobian(f: VectorField, x: number, y: number): [number, number, number, number] {
  const scale = Math.max(1, Math.abs(x), Math.abs(y));
  const eps = 1e-7 * scale;
  const [fpx, gpx] = f(x + eps, y);
  const [fmx, gmx] = f(x - eps, y);
  const [fpy, gpy] = f(x, y + eps);
  const [fmy, gmy] = f(x, y - eps);
  return [(fpx - fmx) / (2 * eps), (fpy - fmy) / (2 * eps), (gpx - gmx) / (2 * eps), (gpy - gmy) / (2 * eps)];
}

// ---- eigenvalues & planar classification -------------------------------------------

/** Minimal local complex type (plugins must not cross-import each other). */
export interface ComplexNum {
  re: number;
  im: number;
}

/** Closed-form eigenvalues of the real 2×2 matrix [[a, b], [c, d]]. */
export function eigenvalues2x2(a: number, b: number, c: number, d: number): [ComplexNum, ComplexNum] {
  const half = (a + d) / 2;
  const disc = half * half - (a * d - b * c);
  if (disc >= 0) {
    const s = Math.sqrt(disc);
    return [{ re: half + s, im: 0 }, { re: half - s, im: 0 }];
  }
  const s = Math.sqrt(-disc);
  return [{ re: half, im: s }, { re: half, im: -s }];
}

export type EquilibriumKind = 'saddle' | 'node' | 'spiral' | 'center' | 'degenerate';
export type Stability = 'source' | 'sink' | 'none';

export interface EquilibriumClass {
  kind: EquilibriumKind;
  stability: Stability;
  trace: number;
  det: number;
}

/** Planar classification from the Jacobian [[a, b], [c, d]] (scale-relative thresholds). */
export function classifyEquilibrium(a: number, b: number, c: number, d: number): EquilibriumClass {
  const trace = a + d;
  const det = a * d - b * c;
  const disc = (trace / 2) * (trace / 2) - det;
  // det and disc are quadratic in the entry scale, so their thresholds must
  // scale quadratically; trace is linear and keeps the linear threshold.
  const scale = Math.max(1, Math.abs(trace), Math.sqrt(Math.abs(det)));
  const eps = 1e-9 * scale;
  const epsQ = eps * scale;
  if (Math.abs(det) < epsQ) return { kind: 'degenerate', stability: 'none', trace, det };
  if (det < 0) return { kind: 'saddle', stability: 'none', trace, det };
  if (disc > epsQ) return { kind: 'node', stability: trace > 0 ? 'source' : 'sink', trace, det };
  if (disc < -epsQ) {
    if (Math.abs(trace) < eps) return { kind: 'center', stability: 'none', trace, det };
    return { kind: 'spiral', stability: trace > 0 ? 'source' : 'sink', trace, det };
  }
  // disc ≈ 0: star / degenerate node
  return { kind: 'degenerate', stability: trace > 0 ? 'source' : 'sink', trace, det };
}

/**
 * Invariant-manifold check for a saddle at the origin: seed a trajectory on
 * an eigenvector direction (offset eps from the fixed point) and integrate
 * RK4; on the linear manifold the displacement stays parallel to the
 * eigenvector. Returns the final |sin Δθ| (0 = perfectly on-manifold).
 */
export function saddleManifoldDeviation(
  a: number,
  b: number,
  c: number,
  d: number,
  which: 'stable' | 'unstable',
  h: number,
  steps: number,
): number {
  const [l1, l2] = eigenvalues2x2(a, b, c, d);
  const lam = which === 'unstable' ? (l1.re >= l2.re ? l1 : l2) : l1.re < l2.re ? l1 : l2;
  if (lam.im !== 0) return NaN;
  // Eigenvector of [[a, b], [c, d]] for λ: (b, λ − a) when b ≠ 0, else (λ − d, c).
  const rawX = b !== 0 ? b : lam.re - d;
  const rawY = b !== 0 ? lam.re - a : c;
  const n = Math.hypot(rawX, rawY);
  if (n === 0) return NaN;
  const vx = rawX / n;
  const vy = rawY / n;
  const eps = 1e-8;
  const pts = integrateStream((x, y) => [a * x + b * y, c * x + d * y], eps * vx, eps * vy, h, steps);
  const last = pts[pts.length - 1]!;
  const cross = last.x * vy - last.y * vx;
  const len = Math.hypot(last.x, last.y);
  return len === 0 ? 0 : Math.abs(cross) / len; // |sin Δθ| (v is unit length)
}

// ---- preset systems ------------------------------------------------------------------

export interface OdeSystemPreset {
  id: string;
  labelEn: string;
  labelZh: string;
  fx: string;
  fy: string;
  /** Suggested view half-span around the origin. */
  span: number;
}

export const ODE_PRESETS: OdeSystemPreset[] = [
  {
    id: 'lv',
    labelEn: 'Lotka–Volterra (α=1.1, β=0.4, γ=0.9, δ=0.3)',
    labelZh: 'Lotka–Volterra 捕食模型（α=1.1, β=0.4, γ=0.9, δ=0.3）',
    fx: 'x*(1.1 - 0.4*y)',
    fy: 'y*(0.3*x - 0.9)',
    span: 8,
  },
  {
    id: 'vanderpol',
    labelEn: 'Van der Pol oscillator (μ=1.5)',
    labelZh: 'Van der Pol 振子（μ=1.5）',
    fx: 'y',
    fy: '1.5*(1 - x^2)*y - x',
    span: 6,
  },
  {
    id: 'pendulum',
    labelEn: 'Damped pendulum',
    labelZh: '阻尼单摆',
    fx: 'y',
    fy: '-sin(x) - 0.25*y',
    span: 10,
  },
  {
    id: 'saddle',
    labelEn: 'Linear saddle [[1, 3], [2, −1]]',
    labelZh: '线性鞍点 [[1, 3], [2, −1]]',
    fx: 'x + 3*y',
    fy: '2*x - y',
    span: 5,
  },
  {
    id: 'sprott',
    labelEn: 'Sprott quadratic system',
    labelZh: 'Sprott 二次系统',
    fx: 'y',
    fy: '-x + y^2',
    span: 4,
  },
];

// ---- embedded validation benchmarks ------------------------------------------------

export const ODEFIELD_BENCHMARK_ID = 'odefield-benchmarks';

export interface OdefieldBenchmark {
  id: string;
  labelEn: string;
  labelZh: string;
  passed: boolean;
  /** Unified relative error |computed − analytic|/|analytic|. */
  relErr: number;
  measured: number;
  reference: number;
  detailEn: string;
  detailZh: string;
}

/**
 * Run the embedded validation suite: RK4 accuracy against the exponential,
 * Newton convergence to the closed-form Lotka–Volterra equilibrium,
 * closed-form eigenvalues against analytic references, and the saddle
 * invariant-manifold direction check. All checks use the unified metric
 * |computed − analytic|/|analytic|.
 */
export function runOdefieldBenchmarks(): OdefieldBenchmark[] {
  const out: OdefieldBenchmark[] = [];

  // ① y′ = y (with x′ = 0): RK4 orbit must track e^t. T = 2, h = 0.005.
  const g1 = compileReal2('0');
  const g2 = compileReal2('y');
  const lin: VectorField = g1.ok && g2.ok ? (x, y) => [g1.fn(x, y), g2.fn(x, y)] : () => [NaN, NaN];
  const pts = integrateStream(lin, 1, 1, 0.005, 400);
  const last = pts[pts.length - 1]!;
  const yNum = last.y;
  const ref = Math.exp(2);
  const e1 = Math.abs(yNum - ref) / ref;
  out.push({
    id: 'rk4-exponential',
    labelEn: 'RK4 orbit of y′ = y vs e^t (< 1e-3)',
    labelZh: 'y′ = y 的 RK4 轨道对照 e^t（< 1e-3）',
    passed: e1 < 1e-3 && last.x === 1,
    relErr: e1,
    measured: yNum,
    reference: ref,
    detailEn: `y(T=2) = ${yNum.toFixed(12)} vs e² = ${ref.toFixed(12)}; x stays exactly 1 (x′ = 0)`,
    detailZh: `y(T=2) = ${yNum.toFixed(12)} 对照 e² = ${ref.toFixed(12)}；x 严格保持 1（x′ = 0）`,
  });

  // ② Lotka–Volterra Newton equilibrium vs (γ/δ, α/β) = (3, 2.75).
  const lvFx = compileReal2('x*(1.1 - 0.4*y)');
  const lvFy = compileReal2('y*(0.3*x - 0.9)');
  const lv: VectorField = lvFx.ok && lvFy.ok ? (x, y) => [lvFx.fn(x, y), lvFy.fn(x, y)] : () => [NaN, NaN];
  const eq = newtonEquilibrium(lv, 2.5, 2.0);
  const ex = Math.abs(eq.x - 3) / 3;
  const ey = Math.abs(eq.y - 2.75) / 2.75;
  const e2 = Math.max(ex, ey);
  out.push({
    id: 'lv-equilibrium',
    labelEn: 'Newton LV equilibrium vs (γ/δ, α/β) = (3, 2.75) (< 1e-6)',
    labelZh: 'LV 牛顿平衡点对照 (γ/δ, α/β) = (3, 2.75)（< 1e-6）',
    passed: eq.converged && e2 < 1e-6,
    relErr: e2,
    measured: eq.x,
    reference: 3,
    detailEn: `Newton from (2.5, 2.0) → (${eq.x.toPrecision(12)}, ${eq.y.toPrecision(12)}), residual ${eq.residual.toExponential(2)}`,
    detailZh: `从 (2.5, 2.0) 出发的牛顿迭代 → (${eq.x.toPrecision(12)}, ${eq.y.toPrecision(12)})，残差 ${eq.residual.toExponential(2)}`,
  });

  // ③ Closed-form eigenvalues vs analytic references (saddle + spiral).
  const [s1, s2] = eigenvalues2x2(1, 3, 2, -1); // tr 0, det −7 → λ = ±√7
  const sq7 = Math.sqrt(7);
  const errS = Math.max(
    Math.abs(s1.re - sq7) / sq7,
    Math.abs(s2.re + sq7) / sq7,
    Math.abs(s1.im) / sq7,
    Math.abs(s2.im) / sq7,
  );
  const [p1, p2] = eigenvalues2x2(-0.1, 2, -2, -0.1); // λ = −0.1 ± 2i
  const modP = Math.sqrt(0.01 + 4);
  const errP = Math.max(
    Math.hypot(p1.re + 0.1, p1.im - 2) / modP,
    Math.hypot(p2.re + 0.1, p2.im + 2) / modP,
  );
  const e3 = Math.max(errS, errP);
  out.push({
    id: 'eigen-closed-form',
    labelEn: '2×2 eigenvalues vs analytic (±√7, −0.1±2i) (< 1e-9)',
    labelZh: '2×2 特征值对照解析值（±√7, −0.1±2i）（< 1e-9）',
    passed: e3 < 1e-9,
    relErr: e3,
    measured: s1.re,
    reference: sq7,
    detailEn: `saddle λ = (${s1.re.toPrecision(12)}, ${s2.re.toPrecision(12)}) vs ±√7; spiral λ = ${p1.re} ± ${p1.im}i vs −0.1 ± 2i`,
    detailZh: `鞍点 λ = (${s1.re.toPrecision(12)}, ${s2.re.toPrecision(12)}) 对照 ±√7；螺旋 λ = ${p1.re} ± ${p1.im}i 对照 −0.1 ± 2i`,
  });

  // ④ Saddle invariant manifolds: seed on the eigenvector, integrate, the
  // displacement must stay parallel to the eigenvector (|sin Δθ| < 1e-6).
  const devU = saddleManifoldDeviation(1, 3, 2, -1, 'unstable', 0.005, 300);
  const devS = saddleManifoldDeviation(1, 3, 2, -1, 'stable', -0.005, 300);
  const e4 = Math.max(devU, devS);
  out.push({
    id: 'saddle-manifold',
    labelEn: 'Saddle manifolds seeded on eigenvectors (|sin Δθ| < 1e-6)',
    labelZh: '鞍点流形沿特征向量播种（|sin Δθ| < 1e-6）',
    passed: Number.isFinite(e4) && e4 < 1e-6,
    relErr: e4,
    measured: devU,
    reference: 0,
    detailEn: `unstable |sin Δθ| = ${devU.toExponential(2)}, stable |sin Δθ| = ${devS.toExponential(2)} (T = 1.5)`,
    detailZh: `不稳定方向 |sin Δθ| = ${devU.toExponential(2)}，稳定方向 |sin Δθ| = ${devS.toExponential(2)}（T = 1.5）`,
  });

  return out;
}
