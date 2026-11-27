// ==========================================================================
// eng-truss kernel — finite element analysis of plane (2-D) trusses.
// Pure numeric core: no DOM, no plugin-framework imports, so it can be
// validated directly by vitest against method-of-joints solutions.
//
// Model JSON shape:
//   {
//     "E": 2.0e11, "A": 3.0e-3,                      // default material
//     "nodes":   [{ "x": 0, "y": 0 }, ...],           // metres, index = id
//     "elements":[{ "a": 0, "b": 1, "E": 2e11, "A": 1e-3 }, ...], // E/A optional
//     "constraints": [{ "node": 0, "dx": true, "dy": true }, ...], // fixed DOFs
//     "loads":   [{ "node": 2, "fx": 0, "fy": -5e4 }, ...]         // newtons
//   }
//
// Method: 2-node bar elements (2 DOF per node), standard axial stiffness
// k_e = (EA/L)·t·tᵀ with t the direction-cosine column, assembled into the
// global stiffness matrix. Constrained DOFs are eliminated (row/column
// deletion, "划行法") — with zero prescribed displacements this is exact —
// and the reduced system K_ff·u_f = f_f is solved by Gaussian elimination
// with partial pivoting. Post-processing recovers axial forces
// N = (EA/L)·δ (δ = elongation, positive = tension), stresses σ = N/A and
// support reactions R = K·u − f (evaluated at the constrained DOFs).
//
// Reference: any standard FEM text, e.g. K.-J. Bathe, "Finite Element
// Procedures", 2nd ed., 2014, §4.2 (truss elements) — the plane bar element
// and the partitioned (condensed) solve used here.
// ==========================================================================

export interface TrussNode {
  x: number;
  y: number;
}

export interface TrussElement {
  /** Node index of the first end. */
  a: number;
  /** Node index of the second end. */
  b: number;
  /** Young's modulus (Pa); falls back to the model-level default. */
  E?: number;
  /** Cross-section area (m²); falls back to the model-level default. */
  A?: number;
}

export interface TrussConstraint {
  node: number;
  /** Fix the x displacement when true. */
  dx?: boolean;
  /** Fix the y displacement when true. */
  dy?: boolean;
}

export interface TrussLoad {
  node: number;
  fx?: number;
  fy?: number;
}

export interface TrussModel {
  /** Default Young's modulus (Pa). */
  E: number;
  /** Default cross-section area (m²). */
  A: number;
  nodes: TrussNode[];
  elements: TrussElement[];
  constraints: TrussConstraint[];
  loads: TrussLoad[];
}

export interface ElementResult {
  index: number;
  a: number;
  b: number;
  /** Undeformed length (m). */
  length: number;
  /** Axial force (N), positive = tension. */
  axialForce: number;
  /** Axial stress (Pa), positive = tension. */
  stress: number;
}

export interface ReactionResult {
  node: number;
  dof: 'x' | 'y';
  /** Support reaction (N); equals the force the support applies to the truss. */
  force: number;
}

export interface TrussResult {
  /** Nodal displacement vector (m), one entry per node. */
  displacements: Array<{ x: number; y: number }>;
  elements: ElementResult[];
  reactions: ReactionResult[];
  /** max |u| over all nodes (m). */
  maxDisplacement: number;
  /** Largest tensile stress (Pa, ≥ 0; 0 when nothing is in tension). */
  maxTensionStress: number;
  /** Largest compressive stress (Pa, ≤ 0; 0 when nothing is in compression). */
  maxCompressionStress: number;
  /** ΣR + ΣF per axis; ≈ 0 for a consistent solve (self-check). */
  equilibriumResidual: { fx: number; fy: number };
}

/** Raised for malformed models and singular (mechanism) stiffness matrices. */
export class TrussError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrussError';
  }
}

// ---- model parsing ---------------------------------------------------------

function finite(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Parse a JSON truss model with full validation. Throws TrussError (or a
 * SyntaxError from JSON.parse) with a precise message on any defect.
 */
export function parseTrussModel(text: string): TrussModel {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new TrussError(`model is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new TrussError('model must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;

  const E = finite(obj.E) ?? 2.0e11;
  const A = finite(obj.A) ?? 1.0e-3;
  if (E <= 0) throw new TrussError('"E" must be > 0 Pa');
  if (A <= 0) throw new TrussError('"A" must be > 0 m²');

  const nodesRaw = obj.nodes;
  if (!Array.isArray(nodesRaw) || nodesRaw.length < 2) {
    throw new TrussError('"nodes" must be an array of at least two {x,y} entries');
  }
  const nodes: TrussNode[] = nodesRaw.map((n, i) => {
    if (typeof n !== 'object' || n === null) throw new TrussError(`node #${i} must be an object`);
    const x = finite((n as Record<string, unknown>).x);
    const y = finite((n as Record<string, unknown>).y);
    if (x === null || y === null) throw new TrussError(`node #${i}: x/y must be finite numbers`);
    return { x, y };
  });

  const elementsRaw = obj.elements;
  if (!Array.isArray(elementsRaw) || elementsRaw.length === 0) {
    throw new TrussError('"elements" must be a non-empty array');
  }
  const elements: TrussElement[] = elementsRaw.map((el, i) => {
    if (typeof el !== 'object' || el === null) throw new TrussError(`element #${i} must be an object`);
    const e = el as Record<string, unknown>;
    const a = finite(e.a);
    const b = finite(e.b);
    if (a === null || b === null || !Number.isInteger(a) || !Number.isInteger(b)) {
      throw new TrussError(`element #${i}: integer node indices "a"/"b" required`);
    }
    if (a < 0 || b < 0 || a >= nodes.length || b >= nodes.length) {
      throw new TrussError(`element #${i}: node index out of range (0..${nodes.length - 1})`);
    }
    if (a === b) throw new TrussError(`element #${i}: both ends on node ${a}`);
    const eE = finite(e.E);
    const eA = finite(e.A);
    if (eE !== null && eE <= 0) throw new TrussError(`element #${i}: "E" must be > 0`);
    if (eA !== null && eA <= 0) throw new TrussError(`element #${i}: "A" must be > 0`);
    return { a, b, ...(eE !== null ? { E: eE } : {}), ...(eA !== null ? { A: eA } : {}) };
  });

  const constraintsRaw = Array.isArray(obj.constraints) ? obj.constraints : [];
  const constraints: TrussConstraint[] = constraintsRaw.map((c, i) => {
    if (typeof c !== 'object' || c === null) throw new TrussError(`constraint #${i} must be an object`);
    const node = finite((c as Record<string, unknown>).node);
    if (node === null || !Number.isInteger(node) || node < 0 || node >= nodes.length) {
      throw new TrussError(`constraint #${i}: node index out of range`);
    }
    const cc = c as Record<string, unknown>;
    return { node, dx: cc.dx === true, dy: cc.dy === true };
  });

  const loadsRaw = Array.isArray(obj.loads) ? obj.loads : [];
  const loads: TrussLoad[] = loadsRaw.map((l, i) => {
    if (typeof l !== 'object' || l === null) throw new TrussError(`load #${i} must be an object`);
    const node = finite((l as Record<string, unknown>).node);
    if (node === null || !Number.isInteger(node) || node < 0 || node >= nodes.length) {
      throw new TrussError(`load #${i}: node index out of range`);
    }
    const ll = l as Record<string, unknown>;
    const fx = finite(ll.fx) ?? 0;
    const fy = finite(ll.fy) ?? 0;
    return { node, fx, fy };
  });

  return { E, A, nodes, elements, constraints, loads };
}

// ---- linear solver (self-contained; plugins must not cross-import) ----------

/**
 * Solve A·x = b by Gaussian elimination with partial pivoting.
 * Throws TrussError when the matrix is (near-)singular.
 */
export function solveGaussPartialPivot(A: number[][], b: number[]): number[] {
  const n = b.length;
  if (A.length !== n || A.some((row) => row.length !== n)) {
    throw new TrussError('linear system is not square');
  }
  const a: number[][] = A.map((row) => row.slice());
  const y: number[] = b.slice();

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    let pivotVal = Math.abs(a[col]![col]!);
    for (let row = col + 1; row < n; row += 1) {
      const mag = Math.abs(a[row]![col]!);
      if (mag > pivotVal) {
        pivotVal = mag;
        pivotRow = row;
      }
    }
    if (pivotVal <= 1e-12) {
      throw new TrussError('singular stiffness matrix: the truss is a mechanism or lacks constraints');
    }
    if (pivotRow !== col) {
      const tmp = a[pivotRow]!;
      a[pivotRow] = a[col]!;
      a[col] = tmp;
      const ty = y[pivotRow]!;
      y[pivotRow] = y[col]!;
      y[col] = ty;
    }
    const pivot = a[col]![col]!;
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row]![col]! / pivot;
      if (factor === 0) continue;
      for (let k = col; k < n; k += 1) a[row]![k]! -= factor * a[col]![k]!;
      y[row]! -= factor * y[col]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = y[row]!;
    for (let k = row + 1; k < n; k += 1) sum -= a[row]![k]! * x[k]!;
    x[row] = sum / a[row]![row]!;
  }
  return x;
}

// ---- FEM solve -------------------------------------------------------------

/**
 * Assemble and solve the plane truss. Constrained DOFs are eliminated
 * (划行法); displacements, member axial forces/stresses and support
 * reactions are recovered in post-processing.
 */
export function solveTruss(model: TrussModel): TrussResult {
  const nNodes = model.nodes.length;
  const nDof = 2 * nNodes;

  // Loads and constraint flags on the full DOF vector.
  const f = new Array<number>(nDof).fill(0);
  for (const load of model.loads) {
    f[2 * load.node]! += load.fx ?? 0;
    f[2 * load.node + 1]! += load.fy ?? 0;
  }
  const fixed = new Array<boolean>(nDof).fill(false);
  for (const c of model.constraints) {
    if (c.dx) fixed[2 * c.node] = true;
    if (c.dy) fixed[2 * c.node + 1] = true;
  }
  if (!fixed.some(Boolean)) {
    throw new TrussError('no constraints: fix at least one DOF to remove rigid-body motion');
  }

  // Global stiffness assembly (full 2n × 2n; reactions are recovered from it).
  const K: number[][] = Array.from({ length: nDof }, () => new Array<number>(nDof).fill(0));
  const geom = model.elements.map((el) => {
    const na = model.nodes[el.a]!;
    const nb = model.nodes[el.b]!;
    const dx = nb.x - na.x;
    const dy = nb.y - na.y;
    const L = Math.hypot(dx, dy);
    if (L <= 0) throw new TrussError(`element ${el.a}-${el.b} has zero length`);
    const E = el.E ?? model.E;
    const A = el.A ?? model.A;
    const c = dx / L;
    const s = dy / L;
    const k = (E * A) / L;
    const t = [c, s, -c, -s];
    // k_e = k · t·tᵀ in (ua_x, ua_y, ub_x, ub_y) local ordering.
    const dofs = [2 * el.a, 2 * el.a + 1, 2 * el.b, 2 * el.b + 1];
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        K[dofs[i]!]![dofs[j]!]! += k * t[i]! * t[j]!;
      }
    }
    return { el, L, E, A, c, s, k };
  });

  // Condensation: K_ff·u_f = f_f (zero prescribed displacements).
  const free: number[] = [];
  for (let d = 0; d < nDof; d += 1) if (!fixed[d]) free.push(d);
  const Kff: number[][] = free.map((r) => free.map((c) => K[r]![c]!));
  const ff: number[] = free.map((r) => f[r]!);
  const uf = solveGaussPartialPivot(Kff, ff);

  const u = new Array<number>(nDof).fill(0);
  free.forEach((d, i) => {
    u[d] = uf[i]!;
  });

  // Post-processing: member forces and stresses.
  const elements: ElementResult[] = geom.map(({ el, L, A, c, s, k }, i) => {
    const ua = [u[2 * el.a]!, u[2 * el.a + 1]!];
    const ub = [u[2 * el.b]!, u[2 * el.b + 1]!];
    // Elongation δ = (u_b − u_a)·e, e the a→b unit vector.
    const delta = (ub[0]! - ua[0]!) * c + (ub[1]! - ua[1]!) * s;
    const axialForce = k * delta;
    return {
      index: i,
      a: el.a,
      b: el.b,
      length: L,
      axialForce,
      stress: axialForce / A,
    };
  });

  // Support reactions R = (K·u − f) evaluated at the constrained DOFs.
  const reactions: ReactionResult[] = [];
  for (let d = 0; d < nDof; d += 1) {
    if (!fixed[d]) continue;
    let ru = 0;
    for (let j = 0; j < nDof; j += 1) ru += K[d]![j]! * u[j]!;
    reactions.push({ node: Math.floor(d / 2), dof: d % 2 === 0 ? 'x' : 'y', force: ru - f[d]! });
  }

  const displacements: Array<{ x: number; y: number }> = [];
  let maxDisplacement = 0;
  for (let i = 0; i < nNodes; i += 1) {
    const ux = u[2 * i]!;
    const uy = u[2 * i + 1]!;
    displacements.push({ x: ux, y: uy });
    maxDisplacement = Math.max(maxDisplacement, Math.hypot(ux, uy));
  }

  let maxTensionStress = 0;
  let maxCompressionStress = 0;
  for (const el of elements) {
    if (el.stress > maxTensionStress) maxTensionStress = el.stress;
    if (el.stress < maxCompressionStress) maxCompressionStress = el.stress;
  }

  const equilibriumResidual = { fx: 0, fy: 0 };
  for (const r of reactions) {
    if (r.dof === 'x') equilibriumResidual.fx += r.force;
    else equilibriumResidual.fy += r.force;
  }
  for (const load of model.loads) {
    equilibriumResidual.fx += load.fx ?? 0;
    equilibriumResidual.fy += load.fy ?? 0;
  }

  return {
    displacements,
    elements,
    reactions,
    maxDisplacement,
    maxTensionStress,
    maxCompressionStress,
    equilibriumResidual,
  };
}
