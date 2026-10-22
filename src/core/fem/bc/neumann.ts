// ==========================================================================
// FEM core — Neumann boundary conditions (∂u/∂n = g ⇒ load ∫ g v ds).
// Thin wrapper over the shared edge-integral assembler with scalar DOFs.
// ==========================================================================

import { assembleEdgeLoad, EdgeDataFn, EdgeSelector, selectBoundaryEdges } from '../assemble/load';
import { PlanarMesh } from '../mesh/types';

/**
 * Add the Neumann contribution of the selected boundary edges to `load`.
 * `g` is the outward flux ∂u/∂n (constant or point-evaluated).
 */
export function applyNeumannLoad(
  mesh: PlanarMesh,
  load: Float64Array,
  edges: EdgeSelector,
  g: number | EdgeDataFn,
): void {
  const selected = selectBoundaryEdges(mesh, edges);
  const contribution = assembleEdgeLoad(mesh, selected, g);
  for (let i = 0; i < contribution.length; i += 1) {
    load[i] = load[i]! + contribution[i]!;
  }
}
