// ==========================================================================
// Ergalics Studio — ESRI ASCII grid model + DEM surface meshing (core)
//
// `AscGrid` is the shared raster model used by the terrain analysis plugin and
// by any plugin that drapes a DEM (e.g. the 3-D plume view). `buildTerrainMesh`
// turns one into a displaced, vertex-coloured Three.js surface: heights are
// normalised so the tallest peak reaches `0.55 · verticalExaggeration` world
// units and the plan footprint fits roughly 2×2 units preserving the grid
// aspect. Large DEMs are row/column downsampled first so a 4096² raster still
// renders. NoData (NaN) cells collapse to the base plane so holes read as
// valleys.
//
// Pure helpers — the mesh needs no WebGL context to construct, only to draw —
// so they are exported for unit tests.
// ==========================================================================

import * as THREE from 'three';
import { heatmapColor } from '@/core/wgsl';

export interface AscGrid {
  ncols: number;
  nrows: number;
  xllcorner: number;
  yllcorner: number;
  cellsize: number;
  nodata: number;
  /** Row-major elevations (metres); NoData replaced by NaN. */
  values: Float64Array;
}

const MAX_DIM = 384;

/** Grid sampled every `step`-th row/column so max(ncols, nrows) ≤ maxDim.
 * Cell size grows by the same factor; NaN (NoData) propagates. */
export function downsampleGrid(grid: AscGrid, maxDim = MAX_DIM): AscGrid {
  const step = Math.max(1, Math.ceil(Math.max(grid.ncols, grid.nrows) / maxDim));
  if (step === 1) return grid;
  const ncols = Math.floor((grid.ncols - 1) / step) + 1;
  const nrows = Math.floor((grid.nrows - 1) / step) + 1;
  const values = new Float64Array(ncols * nrows);
  for (let y = 0; y < nrows; y += 1) {
    for (let x = 0; x < ncols; x += 1) {
      values[y * ncols + x] = grid.values[y * step * grid.ncols + x * step]!;
    }
  }
  return { ...grid, ncols, nrows, cellsize: grid.cellsize * step, values };
}

function elevationRange(values: Float64Array): { vmin: number; vmax: number } {
  let vmin = Infinity;
  let vmax = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < vmin) vmin = v;
    if (v > vmax) vmax = v;
  }
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) return { vmin: 0, vmax: 1 };
  if (!(vmax > vmin)) vmax = vmin + 1e-9;
  return { vmin, vmax };
}

/** Build the displaced terrain surface as one mesh. NoData cells collapse to
 * the base plane so holes read as valleys. */
export function buildTerrainMesh(grid: AscGrid, verticalExaggeration = 1): THREE.Mesh {
  const g = downsampleGrid(grid);
  const { ncols, nrows, values } = g;
  const { vmin, vmax } = elevationRange(values);
  const span = Math.max(1, Math.max(ncols, nrows) - 1);
  const W = ((ncols - 1) / span) * 2;
  const H = ((nrows - 1) / span) * 2;
  const hMax = 0.55 * Math.max(0.1, verticalExaggeration);

  const count = ncols * nrows;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let y = 0; y < nrows; y += 1) {
    for (let x = 0; x < ncols; x += 1) {
      const i = y * ncols + x;
      const v = values[i]!;
      const t = Number.isFinite(v) ? (v - vmin) / (vmax - vmin) : 0;
      positions[i * 3] = (x / (ncols - 1) - 0.5) * W;
      positions[i * 3 + 1] = t * hMax;
      positions[i * 3 + 2] = (y / (nrows - 1) - 0.5) * H;
      const [r, gg, b] = heatmapColor(t);
      colors[i * 3] = r;
      colors[i * 3 + 1] = gg;
      colors[i * 3 + 2] = b;
    }
  }
  // Winding chosen so computeVertexNormals yields +Y normals (lit from above).
  const indices = new Uint32Array((ncols - 1) * (nrows - 1) * 6);
  let k = 0;
  for (let y = 0; y + 1 < nrows; y += 1) {
    for (let x = 0; x + 1 < ncols; x += 1) {
      const a = y * ncols + x;
      const b = a + 1;
      const c = a + ncols;
      const d = c + 1;
      indices[k++] = a;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = d;
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geom, mat);
}
