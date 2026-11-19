// ==========================================================================
// FEM core — load vector assembly: element (volume) sources and boundary
// flux/traction integrals for P1 elements.
// ==========================================================================

import { EdgeElement, PlanarMesh, TriElement, nodeCount } from '../mesh/types';

/** Volume source term f evaluated per element (constant over the element). */
export type SourceFn = (x: number, y: number, tag: number) => number;

/**
 * Assemble the P1 load vector for −∇·(k∇u) = f with f constant per element:
 * each node of the element receives f(xc, yc)·A/3 (the exact consistent load
 * for a constant f).
 */
export function assembleSourceVector(mesh: PlanarMesh, f: SourceFn): Float64Array {
  const n = nodeCount(mesh);
  const load = new Float64Array(n);
  const nodes = mesh.nodes;
  for (const el of mesh.elements) {
    const ax = nodes[el.a * 2]!;
    const ay = nodes[el.a * 2 + 1]!;
    const bx = nodes[el.b * 2]!;
    const by = nodes[el.b * 2 + 1]!;
    const cx = nodes[el.c * 2]!;
    const cy = nodes[el.c * 2 + 1]!;
    const area = Math.abs(0.5 * ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)));
    const fe = f((ax + bx + cx) / 3, (ay + by + cy) / 3, el.tag);
    const share = (fe * area) / 3;
    load[el.a] = load[el.a]! + share;
    load[el.b] = load[el.b]! + share;
    load[el.c] = load[el.c]! + share;
  }
  return load;
}

/** Boundary data g evaluated at a point of an edge. */
export type EdgeDataFn = (x: number, y: number) => number;

/**
 * Boundary-edge selector: either a list of physical edge tags, the string
 * `'all'`, or an explicit list of edges (as returned by custom selections).
 */
export type EdgeSelector = 'all' | number[] | EdgeElement[];

export function selectBoundaryEdges(mesh: PlanarMesh, selector: EdgeSelector): EdgeElement[] {
  if (selector === 'all') return mesh.boundaryEdges.slice();
  if (selector.length === 0) return [];
  if (typeof selector[0] === 'number') {
    const wanted = new Set(selector as number[]);
    return mesh.boundaryEdges.filter((e) => wanted.has(e.tag));
  }
  return selector as EdgeElement[];
}

/**
 * Assemble a boundary integral load ∫_Γ g·v ds over the selected edges with
 * P1 test functions and g interpolated linearly between the endpoints
 * (2-point-exact treatment of a linear g). This is the load side of both
 * Neumann flux conditions and elastic surface tractions.
 *
 * With `stride`/`offset` the same routine feeds a block (multi-DOF) vector:
 * component `offset + stride * i` receives the scalar edge load of node i.
 * `scale` multiplies the integrated edge measure — plane-stress/plane-strain
 * solids pass their out-of-plane thickness so ∫ g·t ds matches the t-scaled
 * stiffness.
 */
export function assembleEdgeLoad(
  mesh: PlanarMesh,
  edges: Array<{ a: number; b: number }>,
  g: number | EdgeDataFn,
  stride = 1,
  offset = 0,
  scale = 1,
): Float64Array {
  const n = nodeCount(mesh) * stride;
  const load = new Float64Array(n);
  const nodes = mesh.nodes;
  const valueAt = (x: number, y: number): number => (typeof g === 'number' ? g : g(x, y));
  for (const e of edges) {
    const ax = nodes[e.a * 2]!;
    const ay = nodes[e.a * 2 + 1]!;
    const bx = nodes[e.b * 2]!;
    const by = nodes[e.b * 2 + 1]!;
    const len = Math.hypot(bx - ax, by - ay) * scale;
    if (len === 0) continue;
    const ga = valueAt(ax, ay);
    const gb = valueAt(bx, by);
    // ∫ (ga λa + gb λb) λa ds = L (ga/3 + gb/6), symmetric for node b.
    load[offset + stride * e.a] = load[offset + stride * e.a]! + len * ((ga / 3) + (gb / 6));
    load[offset + stride * e.b] = load[offset + stride * e.b]! + len * ((ga / 6) + (gb / 3));
  }
  return load;
}

/**
 * Assemble a constant normal-pressure load ∫_Γ p·n·N ds·t over boundary
 * edges. The result is an interleaved 2-DOF vector [fx0, fy0, fx1, fy1, …].
 *
 * Boundary edges are stored undirected (`a < b`), so the outward side comes
 * from the adjacent triangle's CCW ordering: for a CCW-directed edge p→q the
 * outward normal is (qy−py, −(qx−px))/|pq| (the edge rotated by −90°).
 */
export function assemblePressureLoad(
  mesh: PlanarMesh,
  edges: EdgeElement[],
  pressure: number,
  thickness = 1,
): Float64Array {
  const load = new Float64Array(nodeCount(mesh) * 2);
  if (edges.length === 0) return load;
  const keyOf = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const wanted = new Set(edges.map((e) => keyOf(e.a, e.b)));
  // Boundary edge → its (single) adjacent triangle.
  const owner = new Map<string, TriElement>();
  for (const el of mesh.elements) {
    for (const [p, q] of [
      [el.a, el.b],
      [el.b, el.c],
      [el.c, el.a],
    ] as const) {
      const key = keyOf(p, q);
      if (wanted.has(key) && !owner.has(key)) owner.set(key, el);
    }
  }
  const nodes = mesh.nodes;
  for (const e of edges) {
    const ax = nodes[e.a * 2]!;
    const ay = nodes[e.a * 2 + 1]!;
    const bx = nodes[e.b * 2]!;
    const by = nodes[e.b * 2 + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const el = owner.get(keyOf(e.a, e.b));
    // Does the owning triangle traverse a→b in its CCW edge order?
    const ccwAtoB = el !== undefined && (
      (el.a === e.a && el.b === e.b) ||
      (el.b === e.a && el.c === e.b) ||
      (el.c === e.a && el.a === e.b)
    );
    const nx = ccwAtoB ? dy / len : -dy / len;
    const ny = ccwAtoB ? -dx / len : dx / len;
    // Consistent nodal load of a constant edge traction: half to each node.
    const nodal = (pressure * thickness * len) / 2;
    load[e.a * 2] = load[e.a * 2]! + nodal * nx;
    load[e.a * 2 + 1] = load[e.a * 2 + 1]! + nodal * ny;
    load[e.b * 2] = load[e.b * 2]! + nodal * nx;
    load[e.b * 2 + 1] = load[e.b * 2 + 1]! + nodal * ny;
  }
  return load;
}

/** Accumulate a point load into a (possibly blocked) load vector. */
export function addPointLoad(
  load: Float64Array,
  node: number,
  value: number,
  stride = 1,
  offset = 0,
): void {
  load[offset + stride * node] = load[offset + stride * node]! + value;
}
