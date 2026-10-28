// ==========================================================================
// eng-circuit kernel — Modified Nodal Analysis (MNA) for DC resistive
// circuits. Pure numeric core: no DOM, no plugin-framework imports, so it
// can be validated directly by vitest against hand-derived solutions.
//
// Netlist JSON shape:
//   {
//     "nodes": ["gnd", "vcc", "mid", "out"],
//     "elements": [
//       { "type": "V", "from": "vcc", "to": "gnd", "value": 12, "name": "Vs" },
//       { "type": "R", "from": "vcc", "to": "mid", "value": 1000, "name": "R1" },
//       { "type": "I", "from": "mid", "to": "gnd", "value": 0.001, "name": "I1" }
//     ]
//   }
//
// Conventions:
//   - The node named "gnd" (case-insensitive) or "0" is the datum (0 V).
//   - `V` source: `from` is the "+" terminal → v(from) − v(to) = value.
//     Its auxiliary MNA unknown is the branch current flowing from the
//     `from` terminal through the source to the `to` terminal (so a source
//     delivering current to the circuit carries a negative branch current).
//   - `I` source: `value` amperes flow from `from` through the source to
//     `to` (extracted at `from`, injected at `to`).
//   - Unknown vector: [free node voltages | V-source branch currents].
//
// Reference: Chung-Wen Ho, A. E. Ruehli, P. A. Brennan, "The Modified Nodal
// Approach to Network Analysis", IEEE Transactions on Circuits and Systems,
// vol. CAS-22, no. 6, 1975. Linear system solved by Gaussian elimination
// with partial pivoting; a pivot below the singularity threshold raises
// CircuitError (floating voltage source / isolated subcircuit / no ground).
// ==========================================================================

export type ElementType = 'R' | 'V' | 'I';

export interface NetlistElement {
  type: ElementType;
  /** "+" terminal for V, current-exit terminal for I. */
  from: string;
  /** "−" terminal for V, current-injection terminal for I. */
  to: string;
  /** Ω for R, V for V, A for I. */
  value: number;
  /** Optional display name. */
  name?: string;
}

export interface Netlist {
  nodes: string[];
  elements: NetlistElement[];
}

export interface MnaNodeResult {
  node: string;
  voltage: number;
}

export interface MnaSourceResult {
  /** Element display name (or `V#<index>` fallback). */
  name: string;
  /** Branch current (A), positive = flowing from `from` to `to` inside the source. */
  current: number;
}

export interface MnaResult {
  nodeVoltages: MnaNodeResult[];
  sourceCurrents: MnaSourceResult[];
  /** Σ (Δv)²/R over resistors (W). */
  totalDissipatedPower: number;
  /** Σ generated − Σ dissipated; ≈ 0 (Tellegen) for a consistent solve. */
  powerBalance: number;
}

/** Raised for malformed netlists and singular (ill-posed) systems. */
export class CircuitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitError';
  }
}

const GROUND_ALIASES = new Set(['gnd', 'ground', '0']);
/** Pivots smaller than this (absolute) are treated as singular. */
const SINGULAR_EPS = 1e-12;

export function isGroundNode(name: string): boolean {
  return GROUND_ALIASES.has(name.trim().toLowerCase());
}

// ---- netlist parsing -------------------------------------------------------

function asFinite(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Parse a JSON netlist with full validation. Throws CircuitError (or a
 * SyntaxError from JSON.parse) with a precise message on any defect.
 */
export function parseNetlist(text: string): Netlist {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new CircuitError(`netlist is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new CircuitError('netlist must be a JSON object with "nodes" and "elements"');
  }
  const obj = raw as Record<string, unknown>;

  const nodesRaw = obj.nodes;
  if (!Array.isArray(nodesRaw) || nodesRaw.length === 0) {
    throw new CircuitError('"nodes" must be a non-empty array of node names');
  }
  const nodes: string[] = [];
  const seen = new Set<string>();
  for (const n of nodesRaw) {
    const name = String(n).trim();
    if (name === '') throw new CircuitError('node names must be non-empty strings');
    if (seen.has(name)) throw new CircuitError(`duplicate node "${name}"`);
    seen.add(name);
    nodes.push(name);
  }

  const elementsRaw = obj.elements;
  if (!Array.isArray(elementsRaw) || elementsRaw.length === 0) {
    throw new CircuitError('"elements" must be a non-empty array');
  }
  const elements: NetlistElement[] = elementsRaw.map((el, idx) => {
    if (typeof el !== 'object' || el === null) {
      throw new CircuitError(`element #${idx} must be an object`);
    }
    const e = el as Record<string, unknown>;
    const type = String(e.type ?? '').trim().toUpperCase();
    if (type !== 'R' && type !== 'V' && type !== 'I') {
      throw new CircuitError(`element #${idx}: unsupported type "${String(e.type)}" (expected R, V or I)`);
    }
    const from = String(e.from ?? '').trim();
    const to = String(e.to ?? '').trim();
    if (!seen.has(from)) throw new CircuitError(`element #${idx}: unknown node "${from}"`);
    if (!seen.has(to)) throw new CircuitError(`element #${idx}: unknown node "${to}"`);
    if (from === to) throw new CircuitError(`element #${idx}: both terminals on node "${from}"`);
    const value = asFinite(e.value);
    if (value === null) throw new CircuitError(`element #${idx}: "value" must be a finite number`);
    if (type === 'R' && value <= 0) throw new CircuitError(`element #${idx}: resistance must be > 0 Ω`);
    const name = typeof e.name === 'string' && e.name.trim() !== '' ? e.name.trim() : `${type}${idx + 1}`;
    return { type: type as ElementType, from, to, value, name };
  });

  return { nodes, elements };
}

// ---- linear solver ---------------------------------------------------------

/**
 * Solve A·x = b by Gaussian elimination with partial pivoting.
 * Throws CircuitError when the matrix is (near-)singular.
 */
export function solveGaussPartialPivot(A: number[][], b: number[]): number[] {
  const n = b.length;
  if (A.length !== n || A.some((row) => row.length !== n)) {
    throw new CircuitError('linear system is not square');
  }
  // Work on augmented copies (callers own their arrays).
  const a: number[][] = A.map((row) => row.slice());
  const y: number[] = b.slice();

  for (let col = 0; col < n; col += 1) {
    // Partial pivoting: largest |a[row][col]| for row >= col.
    let pivotRow = col;
    let pivotVal = Math.abs(a[col]![col]!);
    for (let row = col + 1; row < n; row += 1) {
      const mag = Math.abs(a[row]![col]!);
      if (mag > pivotVal) {
        pivotVal = mag;
        pivotRow = row;
      }
    }
    if (pivotVal <= SINGULAR_EPS) {
      throw new CircuitError(
        'singular system: floating voltage source, isolated subcircuit or missing ground reference',
      );
    }
    if (pivotRow !== col) {
      const tmp = a[pivotRow]!;
      a[pivotRow] = a[col]!;
      a[col] = tmp;
      const ty = y[pivotRow]!;
      y[pivotRow] = y[col]!;
      y[col] = ty;
    }
    // Eliminate below the pivot.
    const pivot = a[col]![col]!;
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row]![col]! / pivot;
      if (factor === 0) continue;
      for (let k = col; k < n; k += 1) a[row]![k]! -= factor * a[col]![k]!;
      y[row]! -= factor * y[col]!;
    }
  }
  // Back substitution.
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = y[row]!;
    for (let k = row + 1; k < n; k += 1) sum -= a[row]![k]! * x[k]!;
    x[row] = sum / a[row]![row]!;
  }
  return x;
}

// ---- MNA assembly & solve --------------------------------------------------

interface Grounding {
  /** Node name → unknown index; ground maps to −1. */
  indexOf: Map<string, number>;
  ground: string;
}

function resolveGround(netlist: Netlist): Grounding {
  const hit = netlist.nodes.find((n) => isGroundNode(n));
  if (hit === undefined) {
    throw new CircuitError('no ground node: add a node named "gnd" (or "0") as the 0 V reference');
  }
  const indexOf = new Map<string, number>();
  let next = 0;
  for (const n of netlist.nodes) {
    if (n === hit) indexOf.set(n, -1);
    else indexOf.set(n, next++);
  }
  return { indexOf, ground: hit };
}

/**
 * Solve the DC operating point by MNA. Returns every non-ground node voltage,
 * the branch currents of the V sources, the total resistor dissipation and a
 * Tellegen power-balance residual (≈ 0 when the solve is consistent).
 */
export function solveMna(netlist: Netlist): MnaResult {
  const { indexOf } = resolveGround(netlist);
  const n = netlist.nodes.length - 1; // free node voltages
  const vSources = netlist.elements.filter((e) => e.type === 'V');
  const m = vSources.length;
  const size = n + m;

  const G: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const rhs = new Array<number>(size).fill(0);

  const nodeIndex = (name: string): number => indexOf.get(name) ?? -1;

  for (const el of netlist.elements) {
    const a = nodeIndex(el.from);
    const b = nodeIndex(el.to);
    if (el.type === 'R') {
      const g = 1 / el.value;
      if (a >= 0) G[a]![a]! += g;
      if (b >= 0) G[b]![b]! += g;
      if (a >= 0 && b >= 0) {
        G[a]![b]! -= g;
        G[b]![a]! -= g;
      }
    } else if (el.type === 'V') {
      const k = n + vSources.indexOf(el);
      if (a >= 0) {
        G[k]![a]! += 1;
        G[a]![k]! += 1;
      }
      if (b >= 0) {
        G[k]![b]! -= 1;
        G[b]![k]! -= 1;
      }
      rhs[k] = el.value;
    } else {
      // Independent current source: value flows from `from` to `to` through
      // the source → injects at `to`, extracts at `from`.
      if (a >= 0) rhs[a]! -= el.value;
      if (b >= 0) rhs[b]! += el.value;
    }
  }

  const x = solveGaussPartialPivot(G, rhs);

  const nodeVoltages: MnaNodeResult[] = [];
  for (const node of netlist.nodes) {
    const idx = indexOf.get(node) ?? -1;
    if (idx >= 0) nodeVoltages.push({ node, voltage: x[idx]! });
  }
  const vMap = new Map<string, number>();
  for (const nv of nodeVoltages) vMap.set(nv.node, nv.voltage);
  const voltageOf = (name: string): number => (isGroundNode(name) ? 0 : vMap.get(name) ?? 0);

  const sourceCurrents: MnaSourceResult[] = vSources.map((el, k) => ({
    name: el.name ?? `V${k + 1}`,
    current: x[n + k]!,
  }));

  // Power bookkeeping (Tellegen): dissipated in resistors + absorbed in
  // sources = 0, i.e. generated − dissipated ≈ 0.
  let dissipated = 0;
  let generated = 0;
  for (const el of netlist.elements) {
    const va = voltageOf(el.from);
    const vb = voltageOf(el.to);
    if (el.type === 'R') {
      dissipated += ((va - vb) * (va - vb)) / el.value;
    } else if (el.type === 'V') {
      const k = vSources.indexOf(el);
      generated += -el.value * x[n + k]!; // positive i_k = charging direction
    } else {
      generated += -el.value * (va - vb);
    }
  }

  return {
    nodeVoltages,
    sourceCurrents,
    totalDissipatedPower: dissipated,
    powerBalance: generated - dissipated,
  };
}
