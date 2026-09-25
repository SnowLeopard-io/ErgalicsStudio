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
  // Single-shot build: one fresh VoxelCloud serves the static view. (Playback
  // reuses a persistent VoxelCloud so it never tears down/recreates the mesh.)
  const cloud = new VoxelCloud();
  const group = cloud.render(field, thresholdFrac, cap, channel);
  // .dispose() would free the objects; the caller owns the returned group, so
  // keep the cloud instance only as a carrier for the group reference. The
  // caller disposes via disposeObjectTree() as before.
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

/**
 * A single `InstancedMesh` whose per-instance matrices/colors are updated in
 * place on every frame instead of tearing down and rebuilding the whole object
 * tree. During dynamic playback the grid is constant — only the per-cell color
 * (and the visible-cell set) changes — so this avoids the per-frame allocation
 * of a new `BoxGeometry`, `MeshStandardMaterial`, `InstancedMesh` and edges
 * frame plus their disposal, which was the dominant GC/GPU churn at playback
 * cadence. The mesh is sized once to the on-grid capacity (≤ cap) and
 * `mesh.count` is flipped to the actual visible count each frame.
 */
export class VoxelCloud {
  private group: THREE.Group | null = null;
  private mesh: THREE.InstancedMesh | null = null;
  private geom: THREE.BoxGeometry | null = null;
  private mat: THREE.MeshStandardMaterial | null = null;
  private edgeGeom: THREE.EdgesGeometry | null = null;
  private edgeMat: THREE.LineBasicMaterial | null = null;
  private signature = '';
  private capacity = 0;

  /** Render `field` into one shared cloud; lazily builds the mesh on first use. */
  render(
    field: Field3D,
    thresholdFrac: number,
    cap: number,
    channel: FluidFieldChannel = 'temperature',
  ): THREE.Group {
    const { nx, ny, nz, values } = field;
    if (!this.group || !this.mesh) this.rebuild(field, cap, channel);

    // Grid + channel + capacity are fixed for a result; only when those change
    // (e.g. user picks a different case with a different grid) do we rebuild.
    const sig = `${nx}x${ny}x${nz}:${channel}:${cap}`;
    if (sig !== this.signature) this.rebuild(field, cap, channel);

    // Normalize colours against this frame's own [min, max] span (see
    // buildFieldRender for why). Empty/uniform → clear to nothing.
    let vmin = Infinity;
    let vmax = -Infinity;
    for (const v of values) {
      if (!Number.isFinite(v)) continue;
      if (v < vmin) vmin = v;
      if (v > vmax) vmax = v;
    }
    const span = vmax - vmin;
    const ramp = channel === 'speed' ? speedColor : heatColor;
    const mesh = this.mesh!;
    if (!Number.isFinite(span) || span <= 0) {
      mesh.count = 0;
      this.meshNeedsUpdate();
      return this.group!;
    }
    const thresh = thresholdFrac;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let n = 0;
    const capacity = this.capacity;
    for (let iz = 0; iz < nz; iz += 1) {
      for (let iy = 0; iy < ny; iy += 1) {
        for (let ix = 0; ix < nx; ix += 1) {
          if (n >= capacity) break;
          const v = values[fieldIndex(ix, iy, iz, nx, ny)] ?? 0;
          const t = Number.isFinite(v) ? (v - vmin) / span : 0;
          if (t < thresh) continue;
          dummy.position.set(ix - (nx - 1) / 2, iy - (ny - 1) / 2, iz - (nz - 1) / 2);
          dummy.updateMatrix();
          mesh.setMatrixAt(n, dummy.matrix);
          const c = ramp(t);
          mesh.setColorAt(n, color.setRGB(srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])));
          n += 1;
        }
        if (n >= capacity) break;
      }
      if (n >= capacity) break;
    }
    mesh.count = n;
    this.meshNeedsUpdate();
    return this.group!;
  }

  /** (re)build the mesh tree once; ownership differs from the rebuild-loop. */
  private rebuild(field: Field3D, cap: number, channel: FluidFieldChannel): void {
    const { nx, ny, nz } = field;
    this.dispose();
    // Capacity can never exceed the cell count; size the GPU buffers once.
    const capacity = Math.max(0, Math.min(field.values.length, nx * ny * nz, cap));
    this.capacity = capacity;
    this.signature = `${nx}x${ny}x${nz}:${channel}:${cap}`;

    const group = new THREE.Group();
    this.geom = new THREE.BoxGeometry(0.82, 0.82, 0.82);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.05 });
    this.mesh = new THREE.InstancedMesh(this.geom, this.mat, capacity);
    this.mesh.count = 0;
    // Edges frame (translucent outline) so the empty remainder of the domain
    // still reads as a bounded box against the grid.
    this.edgeGeom = new THREE.EdgesGeometry(new THREE.BoxGeometry(nx, ny, nz));
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0x5b6b81, transparent: true, opacity: 0.35 });
    group.add(this.mesh);
    group.add(new THREE.LineSegments(this.edgeGeom, this.edgeMat));
    this.group = group;
  }

  private meshNeedsUpdate(): void {
    const mesh = this.mesh;
    if (!mesh) return;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  get object(): THREE.Group | null {
    return this.group;
  }

  dispose(): void {
    if (this.group) disposeObjectTree(this.group);
    this.group = null;
    this.mesh = null;
    this.geom = null;
    this.mat = null;
    this.edgeGeom = null;
    this.edgeMat = null;
    this.signature = '';
    this.capacity = 0;
  }
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