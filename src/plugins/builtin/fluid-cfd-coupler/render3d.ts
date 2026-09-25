// ==========================================================================
// Fluid-CFD Coupler — 3D field rendering helpers
//
// Paints the 3-D scalar field (heat-content proxy) returned by the coupled
// solver as a coloured *voxel* cloud in the host Three.js scene: cells above a
// small fraction of the field max are emitted as instanced cubes coloured by
// magnitude, wrapped in a translucent outline box so the domain reads as a
// volume. The nozzle injects at the x0 face, so the plume visibly builds in
// the +x direction toward the outlet face — a direct visual of the 1D→3D
// inlet injection and the reverse-coupling back pressure.
//
// Pure helpers (ramp, buffer, camera framing, disposal) are exported for unit
// tests; only `buildFieldRender` touches Three.js.
// ==========================================================================

import * as THREE from 'three';

/** 3-D scalar field as returned by the Python solver (z-major flat layout). */
export interface Field3D {
  values: number[];
  nx: number;
  ny: number;
  nz: number;
}

/** sRGB → linear, so instanced colors match the sRGB Figure Studio export. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Sequential heat ramp for the (non-negative) heat-content field, scaled to
 * the field max. Low → deep blue, high → amber/white.
 */
export function heatColor(t: number): [number, number, number] {
  const v = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  const LO = [14, 58, 118] as const;
  const HI = [255, 182, 84] as const;
  const c: [number, number, number] = [
    (LO[0] + (HI[0] - LO[0]) * v) / 255,
    (LO[1] + (HI[1] - LO[1]) * v) / 255,
    (LO[2] + (HI[2] - LO[2]) * v) / 255,
  ];
  return c;
}

/**
 * Sequential velocity ramp for the velocity-magnitude field. Dark graphite →
 * amber → bright red-hot conveys "speed" distinctly from the blue-amber heat
 * ramp, so temperature and velocity channels are not confused at a glance.
 */
export function speedColor(t: number): [number, number, number] {
  const v = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  const LO = [30, 30, 38] as const;
  const MID = [230, 120, 40] as const;
  const HI = [255, 60, 45] as const;
  const u = v < 0.5 ? v / 0.5 : (v - 0.5) / 0.5;
  const A = v < 0.5 ? LO : MID;
  const B = v < 0.5 ? MID : HI;
  const c: [number, number, number] = [
    (A[0] + (B[0] - A[0]) * u) / 255,
    (A[1] + (B[1] - A[1]) * u) / 255,
    (A[2] + (B[2] - A[2]) * u) / 255,
  ];
  return c;
}

/** Which physical channel a 3-D field snapshot represents. */
export type FluidFieldChannel = 'temperature' | 'speed';

/** Extract the z-major flat layout index for cell (ix, iy, iz). */
export function fieldIndex(ix: number, iy: number, iz: number, nx: number, ny: number): number {
  return iz * ny * nx + iy * nx + ix;
}

/**
 * Build the voxel cloud + outline box for one coupled field. Cells whose
 * magnitude is below `thresholdFrac` of the max are skipped (near-empty tail
 * costs thousands of invisible cubes on bigger grids). `channel` selects the
 * color ramp: temperature → blue/amber heat; speed → graphite/amber/red.
 * Returns an empty group when every cell is below threshold.
 */
export function buildFieldRender(
  field: Field3D,
  thresholdFrac = 0.045,
  cap = 30000,
  channel: FluidFieldChannel = 'temperature',
): THREE.Group {
  const group = new THREE.Group();
  const { nx, ny, nz, values } = field;
  if (!values || values.length < 1 || nx < 1 || ny < 1 || nz < 1) return group;

  // Normalize colours against the field's OWN [min, max] span rather than
  // [0, max]. A temperature field that lives in ~[266, 300] would otherwise map
  // every cell to v/max ≈ 0.9–1.0 (all near-amber), making the plume invisible
  // against its background and its evolution during playback impossible to see.
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < vmin) vmin = v;
    if (v > vmax) vmax = v;
  }
  const span = vmax - vmin;
  if (!Number.isFinite(span) || span <= 0) return group;

  // Keep only cells standing out from the lower baseline of the span:
  // normalized t = (v − vmin)/span ≥ thresholdFrac, so a submerged thermal
  // plume (small variation on a large ambient background) keeps its cool rim
  // cells hidden while its hot peak lights up amber.
  const thresh = thresholdFrac;
  const ramp = channel === 'speed' ? speedColor : heatColor;

  // Emit visible cells (bounded) as instanced cubes spaced on a unit lattice,
  // centred at the origin.
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const cs: [number, number, number][] = [];
  for (let iz = 0; iz < nz; iz += 1) {
    for (let iy = 0; iy < ny; iy += 1) {
      for (let ix = 0; ix < nx; ix += 1) {
        if (xs.length >= cap) break;
        const v = values[fieldIndex(ix, iy, iz, nx, ny)] ?? 0;
        const t = Number.isFinite(v) ? (v - vmin) / span : 0;
        if (t < thresh) continue;
        xs.push(ix - (nx - 1) / 2);
        ys.push(iy - (ny - 1) / 2);
        zs.push(iz - (nz - 1) / 2);
        const c = ramp(t);
        cs.push([srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])]);
      }
      if (xs.length >= cap) break;
    }
    if (xs.length >= cap) break;
  }

  if (xs.length > 0) {
    const size = 0.82;
    const geom = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.7,
      metalness: 0.05,
    });
    const mesh = new THREE.InstancedMesh(geom, mat, xs.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < xs.length; i += 1) {
      dummy.position.set(xs[i]!, ys[i]!, zs[i]!);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.setRGB(cs[i]![0], cs[i]![1], cs[i]![2]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // Translucent outline so the empty remainder of the domain still reads as a
  // bounded box (and the outlet-face orientation is legible against the grid).
  const frame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(nx, ny, nz)),
    new THREE.LineBasicMaterial({ color: 0x5b6b81, transparent: true, opacity: 0.35 }),
  );
  group.add(frame);

  return group;
}

/** Dispose every geometry/material in an object tree (GPU hygiene). */
export function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const o = obj as THREE.Mesh & { material: THREE.Material | THREE.Material[] };
    o.geometry?.dispose();
    const m = (o as { material?: unknown }).material;
    if (Array.isArray(m)) (m as THREE.Material[]).forEach((x) => x.dispose());
    else if (m && typeof m === 'object' && 'dispose' in (m as THREE.Material)) {
      (m as THREE.Material).dispose();
    }
  });
}

/** Frame the camera so the whole voxel volume fits the view. */
export function fitFieldCamera(
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update: () => void },
  extent: number,
): void {
  const dist = extent * 2.2 + 2;
  controls.target.set(0, 0, 0);
  camera.position.set(dist * 0.55, dist * 0.75, dist * 0.75);
  camera.near = Math.max(dist / 200, 0.01);
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
  camera.lookAt(0, 0, 0);
  controls.update();
}