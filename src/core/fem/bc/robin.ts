// ==========================================================================
// FEM core — Robin boundary conditions (∂u/∂n + α(u − u∞) = 0).
//
// Adds the surface stiffness α ∫ v w ds to K and the load α ∫ u∞ v ds to f,
// integrated with 2-point Gauss so linear α / u∞ along the edge are exact.
// ==========================================================================

import { CsrBuilder, CsrMatrix } from '../assemble/stiffness';
import { EdgeDataFn, EdgeSelector, selectBoundaryEdges } from '../assemble/load';
import { PlanarMesh } from '../mesh/types';

export interface RobinData {
  edges: EdgeSelector;
  /** Heat-transfer coefficient α (constant or point-evaluated). */
  alpha: number | EdgeDataFn;
  /** Exterior (ambient) value u∞ (constant or point-evaluated). */
  ambient: number | EdgeDataFn;
}

const GAUSS = [0.5 - Math.SQRT1_2 / 2, 0.5 + Math.SQRT1_2 / 2];
const GAUSS_W = [0.5, 0.5];

/**
 * Add the Robin stiffness contribution α ∫ v w ds of the selected edges into
 * a CSR builder (call before `toCsr`) and return the matching load vector
 * α ∫ u∞ v ds so the caller can add it to the global RHS.
 */
export function addRobinToBuilder(mesh: PlanarMesh, builder: CsrBuilder, data: RobinData): Float64Array {
  const selected = selectBoundaryEdges(mesh, data.edges);
  const nodes = mesh.nodes;
  const load = new Float64Array(mesh.nodes.length / 2);
  const at = (x: number, y: number, v: number | EdgeDataFn): number => (typeof v === 'number' ? v : v(x, y));
  for (const e of selected) {
    const ax = nodes[e.a * 2]!;
    const ay = nodes[e.a * 2 + 1]!;
    const bx = nodes[e.b * 2]!;
    const by = nodes[e.b * 2 + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    if (len === 0) continue;
    // 2-point Gauss on the edge: exact for quadratic integrands.
    let kaa = 0;
    let kab = 0;
    let kba = 0;
    let kbb = 0;
    let fa = 0;
    let fb = 0;
    for (let q = 0; q < 2; q += 1) {
      const t = GAUSS[q]!;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const alpha = at(x, y, data.alpha);
      const uInf = at(x, y, data.ambient);
      const w = GAUSS_W[q]! * len;
      const la = 1 - t;
      const lb = t;
      kaa += alpha * la * la * w;
      kab += alpha * la * lb * w;
      kba += alpha * lb * la * w;
      kbb += alpha * lb * lb * w;
      fa += alpha * uInf * la * w;
      fb += alpha * uInf * lb * w;
    }
    builder.add(e.a, e.a, kaa);
    builder.add(e.a, e.b, kab);
    builder.add(e.b, e.a, kba);
    builder.add(e.b, e.b, kbb);
    load[e.a] = load[e.a]! + fa;
    load[e.b] = load[e.b]! + fb;
  }
  return load;
}

/** Type helper re-export so callers can annotate mutation helpers. */
export type { CsrMatrix };
