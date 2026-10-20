// ==========================================================================
// FEM core — post-processing: strain/stress recovery for elasticity and a
// gradient-jump a posteriori error indicator for scalar problems.
// ==========================================================================

import { p1Basis } from '../assemble/basis';
import { PlanarMesh, edgeKey } from '../mesh/types';
import { PlaneState, constitutiveMatrix } from '../physics/elasticity';
import { Coefficient, coefficientAt } from '../assemble/stiffness';

/**
 * Per-element strain [εx, εy, γxy] from nodal displacements (flat length
 * 3·nElem). Constant over each P1 element.
 */
export function recoverElementStrain(mesh: PlanarMesh, displacement: ArrayLike<number>): Float64Array {
  const nE = mesh.elements.length;
  const strain = new Float64Array(nE * 3);
  const nodes = mesh.nodes;
  for (let e = 0; e < nE; e += 1) {
    const el = mesh.elements[e]!;
    const basis = p1Basis(
      nodes[el.a * 2]!, nodes[el.a * 2 + 1]!,
      nodes[el.b * 2]!, nodes[el.b * 2 + 1]!,
      nodes[el.c * 2]!, nodes[el.c * 2 + 1]!,
    );
    const g = basis.grad;
    const u = [
      displacement[2 * el.a]!, displacement[2 * el.a + 1]!,
      displacement[2 * el.b]!, displacement[2 * el.b + 1]!,
      displacement[2 * el.c]!, displacement[2 * el.c + 1]!,
    ];
    // εx = Σ ui ∂λi/∂x, εy = Σ vi ∂λi/∂y, γxy = Σ (ui ∂λi/∂y + vi ∂λi/∂x).
    let ex = 0;
    let ey = 0;
    let gxy = 0;
    for (let i = 0; i < 3; i += 1) {
      ex += u[i * 2]! * g[i * 2]!;
      ey += u[i * 2 + 1]! * g[i * 2 + 1]!;
      gxy += u[i * 2]! * g[i * 2 + 1]! + u[i * 2 + 1]! * g[i * 2]!;
    }
    strain[e * 3] = ex;
    strain[e * 3 + 1] = ey;
    strain[e * 3 + 2] = gxy;
  }
  return strain;
}

/**
 * Per-element stress [σxx, σyy, τxy] = D·ε (flat length 3·nElem).
 */
export function recoverElementStress(
  mesh: PlanarMesh,
  elementStrain: ArrayLike<number>,
  E: Coefficient,
  nu: Coefficient,
  state: PlaneState,
): Float64Array {
  const nE = mesh.elements.length;
  const stress = new Float64Array(nE * 3);
  for (let e = 0; e < nE; e += 1) {
    const tag = mesh.elements[e]!.tag;
    const D = constitutiveMatrix(coefficientAt(E, tag), coefficientAt(nu, tag), state);
    const ex = elementStrain[e * 3]!;
    const ey = elementStrain[e * 3 + 1]!;
    const gxy = elementStrain[e * 3 + 2]!;
    stress[e * 3] = D[0]! * ex + D[1]! * ey;
    stress[e * 3 + 1] = D[3]! * ex + D[4]! * ey;
    stress[e * 3 + 2] = D[8]! * gxy;
  }
  return stress;
}

/** Von Mises invariant of a plane stress state (σx, σy, τ). */
export function vonMises(sx: number, sy: number, txy: number): number {
  return Math.sqrt(sx * sx + sy * sy - sx * sy + 3 * txy * txy);
}

/**
 * Nodal von Mises stress: area-weighted average of the adjacent element
 * stresses (simple recovery; a least-squares patch recovery would be the
 * next refinement step and is intentionally not included).
 */
export function nodalVonMises(mesh: PlanarMesh, elementStress: ArrayLike<number>): Float64Array {
  const n = mesh.nodes.length / 2;
  const sum = new Float64Array(n);
  const weight = new Float64Array(n);
  const nodes = mesh.nodes;
  for (let e = 0; e < mesh.elements.length; e += 1) {
    const el = mesh.elements[e]!;
    const area = Math.abs(
      0.5 * ((nodes[el.b * 2]! - nodes[el.a * 2]!) * (nodes[el.c * 2 + 1]! - nodes[el.a * 2 + 1]!) -
        (nodes[el.c * 2]! - nodes[el.a * 2]!) * (nodes[el.b * 2 + 1]! - nodes[el.a * 2 + 1]!)),
    );
    const vm = vonMises(elementStress[e * 3]!, elementStress[e * 3 + 1]!, elementStress[e * 3 + 2]!);
    sum[el.a] = sum[el.a]! + vm * area;
    sum[el.b] = sum[el.b]! + vm * area;
    sum[el.c] = sum[el.c]! + vm * area;
    weight[el.a] = weight[el.a]! + area;
    weight[el.b] = weight[el.b]! + area;
    weight[el.c] = weight[el.c]! + area;
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) out[i] = weight[i]! > 0 ? sum[i]! / weight[i]! : 0;
  return out;
}

/**
 * Gradient-jump error indicator for a piecewise-constant (per-element)
 * gradient field g. For every interior edge e shared by triangles T⁺/T⁻:
 *   J_e = (g⁺ − g⁻)·n_e,  η²_T = Σ_{e⊂∂T} |J_e|²·|e|
 * (the classic residual-free jump estimator; boundary edges contribute 0,
 * matching homogeneous natural BCs).
 */
export function gradientJumpIndicator(mesh: PlanarMesh, elementGradients: ArrayLike<number>): Float64Array {
  const nE = mesh.elements.length;
  const indicator2 = new Float64Array(nE);
  // Map undirected edge → the (up to two) elements sharing it.
  const edgeElements = new Map<string, number[]>();
  for (let e = 0; e < nE; e += 1) {
    const el = mesh.elements[e]!;
    for (const [p, q] of [
      [el.a, el.b],
      [el.b, el.c],
      [el.c, el.a],
    ] as const) {
      const key = edgeKey(p, q);
      const list = edgeElements.get(key);
      if (list) list.push(e);
      else edgeElements.set(key, [e]);
    }
  }
  const nodes = mesh.nodes;
  for (const [, elems] of edgeElements) {
    if (elems.length !== 2) continue; // boundary edge: zero-flux assumption
    const t1 = elems[0]!;
    const t2 = elems[1]!;
    const e1 = mesh.elements[t1]!;
    // Recover the actual shared edge: the two nodes common to both triangles.
    const e2 = mesh.elements[t2]!;
    const shared: number[] = [];
    for (const a of [e1.a, e1.b, e1.c]) {
      if (a === e2.a || a === e2.b || a === e2.c) shared.push(a);
    }
    if (shared.length !== 2) continue;
    const a = shared[0]!;
    const b = shared[1]!;
    const ax = nodes[a * 2]!;
    const ay = nodes[a * 2 + 1]!;
    const bx = nodes[b * 2]!;
    const by = nodes[b * 2 + 1]!;
    const ex = bx - ax;
    const ey = by - ay;
    const len = Math.hypot(ex, ey);
    if (len === 0) continue;
    // Outward normal of edge (a→b) w.r.t. triangle T1 (CCW): rotate edge -90°.
    const nx = ey / len;
    const ny = -ex / len;
    const g1x = elementGradients[t1 * 2]!;
    const g1y = elementGradients[t1 * 2 + 1]!;
    const g2x = elementGradients[t2 * 2]!;
    const g2y = elementGradients[t2 * 2 + 1]!;
    const jump = (g1x - g2x) * nx + (g1y - g2y) * ny;
    const contribution = jump * jump * len;
    indicator2[t1] = indicator2[t1]! + contribution;
    indicator2[t2] = indicator2[t2]! + contribution;
  }
  const indicator = new Float64Array(nE);
  for (let e = 0; e < nE; e += 1) indicator[e] = Math.sqrt(indicator2[e]!);
  return indicator;
}

/**
 * L2 error ‖u_h − u_exact‖_{L²(Ω)} for a nodal field, using the 3-point
 * midpoint quadrature (exact for the quadratic integrand of a P1 field).
 */
export function l2Error(
  mesh: PlanarMesh,
  values: ArrayLike<number>,
  exact: (x: number, y: number) => number,
): number {
  const nodes = mesh.nodes;
  let total = 0;
  for (const el of mesh.elements) {
    const ax = nodes[el.a * 2]!;
    const ay = nodes[el.a * 2 + 1]!;
    const bx = nodes[el.b * 2]!;
    const by = nodes[el.b * 2 + 1]!;
    const cx = nodes[el.c * 2]!;
    const cy = nodes[el.c * 2 + 1]!;
    const area = Math.abs(0.5 * ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)));
    // 3-point midpoint rule on the midsides, weights A/3 each. The barycentric
    // coordinates of a midpoint are (1/2, 1/2, 0) up to rotation.
    const mids: Array<[number, number, number, number, number]> = [
      [(ax + bx) / 2, (ay + by) / 2, 0.5, 0.5, 0],
      [(bx + cx) / 2, (by + cy) / 2, 0, 0.5, 0.5],
      [(cx + ax) / 2, (cy + ay) / 2, 0.5, 0, 0.5],
    ];
    const uN = [values[el.a]!, values[el.b]!, values[el.c]!];
    for (const [mx, my, l0, l1, l2] of mids) {
      const uh = uN[0]! * l0 + uN[1]! * l1 + uN[2]! * l2;
      const diff = uh - exact(mx, my);
      total += diff * diff * (area / 3);
    }
  }
  return Math.sqrt(total);
}

/** Observed convergence order from two (h, error) pairs. */
export function convergenceOrder(h1: number, e1: number, h2: number, e2: number): number {
  return Math.log(e1 / e2) / Math.log(h1 / h2);
}
