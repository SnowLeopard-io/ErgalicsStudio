// ==========================================================================
// DEM Terrain Analysis — 3D scene assembly
//
// Wraps the shared DEM mesher into the group + camera framing the plugin
// hands to the host Scene3DHandle (drag to orbit, scroll to zoom). The mesh
// itself, its downsampling and the ESRI ASCII grid model live in
// @/core/geo/terrainMesh, because the 3-D plume view drapes the same terrain.
// ==========================================================================

import * as THREE from 'three';
import { buildTerrainMesh } from '@/core/geo/terrainMesh';
import type { AscGrid } from '@/core/geo/terrainMesh';

/** Build the displaced terrain surface (plus its lights) as one group.
 * NoData cells collapse to the base plane so holes read as valleys. */
export function buildTerrainGroup(grid: AscGrid, verticalExaggeration = 1): THREE.Group {
  const group = new THREE.Group();
  group.add(new THREE.AmbientLight(0x9fb4cc, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2.2, 2.8, 1.4);
  group.add(sun);
  group.add(buildTerrainMesh(grid, verticalExaggeration));
  return group;
}

/** Oblique overhead view that frames the ~2×2 footprint. */
export function fitTerrainCamera(
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update?: () => void },
  verticalExaggeration = 1,
): void {
  camera.position.set(1.9, 1.8, 2.3);
  camera.near = 0.01;
  camera.far = 100;
  camera.updateProjectionMatrix();
  controls.target.set(0, 0.2 * Math.max(0.1, verticalExaggeration), 0);
  controls.update?.();
}
