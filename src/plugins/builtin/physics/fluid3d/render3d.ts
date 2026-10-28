// ==========================================================================
// fluid3d — rendering helpers
//
// Pure Three.js scene objects for the 3-D flow view. The plugin's primary
// experience is a genuinely three-dimensional field: a speed-coloured tracer
// cloud and a streamline-trail structure view; the cross-section planes are
// demoted to secondary options. No solver state lives here — the plugin drives
// all of it.
// ==========================================================================

import * as THREE from 'three';

/** Default trail length (steps) for one streamline seed. */
export const TRAIL_LEN = 60;

/** Evenly spaced z fractions used by the pseudo-volumetric multi-slice view. */
export const MULTI_SLICE_FRACTIONS = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];

/** Clamp a finite value into [lo, hi] (NaN → lo). */
function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function mix(a: readonly number[], b: readonly number[], f: number): [number, number, number] {
  return [a[0]! + (b[0]! - a[0]!) * f, a[1]! + (b[1]! - a[1]!) * f, a[2]! + (b[2]! - a[2]!) * f];
}

/** Sequential 0..1 speed ramp: dark graphite → amber → bright red. */
export function speedRamp(t: number): [number, number, number] {
  const v = clamp(t, 0, 1);
  const LO = [0.118, 0.118, 0.149];
  const MID = [0.902, 0.471, 0.157];
  const HI = [1.0, 0.235, 0.176];
  return v < 0.5 ? mix(LO, MID, v / 0.5) : mix(MID, HI, (v - 0.5) / 0.5);
}

/** Diverging -1..1 vorticity ramp: dark at 0, orange (+) / blue (−). */
export function vorticityRamp(t: number): [number, number, number] {
  const v = clamp(t, -1, 1);
  const DARK = [0.063, 0.078, 0.11];
  const a = Math.abs(v);
  return v >= 0 ? mix(DARK, [1.0, 0.588, 0.157], a) : mix(DARK, [0.275, 0.588, 1.0], a);
}

/**
 * Fill an RGB (0..1) buffer from a per-point speed array via `speedRamp`.
 * `out` is `count*3` floats; speeds are normalised by `u0`.
 */
export function speedColors(speeds: Float32Array, count: number, u0: number, out: Float32Array): void {
  const inv = 1 / Math.max(1e-9, u0);
  const n = Math.min(count, Math.floor(speeds.length), Math.floor(out.length / 3));
  for (let i = 0; i < n; i += 1) {
    const c = speedRamp(Math.abs(speeds[i]!) * inv);
    out[i * 3] = c[0];
    out[i * 3 + 1] = c[1];
    out[i * 3 + 2] = c[2];
  }
}

/**
 * A cross-section plane (x–y at a fixed z) painted from a per-cell RGBA byte
 * buffer through a `DataTexture`. The plane lies in the XY plane, so no
 * rotation is needed — it only slides along z. `opacity` is exposed so the
 * multi-slice volume stack can make each plane translucent.
 */
export class SliceField {
  readonly mesh: THREE.Mesh;
  private texture: THREE.DataTexture;
  private material: THREE.MeshBasicMaterial;
  private plane: THREE.PlaneGeometry;
  private w: number;
  private h: number;

  constructor(nx: number, ny: number, opacity = 0.92) {
    this.w = nx;
    this.h = ny;
    this.texture = new THREE.DataTexture(new Uint8Array(nx * ny * 4), nx, ny, THREE.RGBAFormat);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      side: THREE.DoubleSide,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    this.plane = new THREE.PlaneGeometry(nx, ny);
    this.mesh = new THREE.Mesh(this.plane, this.material);
  }

  /** Upload a new slice (`nx*ny*4` RGBA bytes) and move it to `sliceZ`. */
  update(rgba: Uint8Array, sliceZ: number, nx: number, ny: number, nz: number): void {
    if (nx !== this.w || ny !== this.h) {
      this.w = nx;
      this.h = ny;
      this.texture.dispose();
      this.texture = new THREE.DataTexture(new Uint8Array(nx * ny * 4), nx, ny, THREE.RGBAFormat);
      this.texture.minFilter = THREE.NearestFilter;
      this.texture.magFilter = THREE.NearestFilter;
      this.material.map = this.texture;
      this.material.needsUpdate = true;
      this.plane.dispose();
      this.plane = new THREE.PlaneGeometry(nx, ny);
      this.mesh.geometry = this.plane;
    }
    const data = this.texture.image.data as Uint8Array;
    const n = Math.min(data.length, rgba.length);
    for (let i = 0; i < n; i += 1) data[i] = rgba[i]!;
    this.texture.needsUpdate = true;
    this.mesh.position.set(0, 0, sliceZ - (nz - 1) / 2);
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.plane.dispose();
  }
}

/**
 * Pseudo-volumetric view: N translucent `SliceField` planes stacked at evenly
 * spaced z fractions, so the stack reads as one 3-D scalar volume instead of a
 * single flat cut.
 */
export class MultiSliceField {
  readonly group: THREE.Group;
  private planes: SliceField[];
  private fractions: number[];

  constructor(nx: number, ny: number, fractions: number[] = MULTI_SLICE_FRACTIONS, opacity = 0.32) {
    this.group = new THREE.Group();
    this.fractions = fractions.slice();
    this.planes = fractions.map(() => {
      const field = new SliceField(nx, ny, opacity);
      this.group.add(field.mesh);
      return field;
    });
  }

  /** Paint every plane from a per-z RGBA callback (called once per plane). */
  update(fieldAtZ: (zi: number) => Uint8Array, nx: number, ny: number, nz: number): void {
    for (let i = 0; i < this.planes.length; i += 1) {
      const zi = clamp(Math.round(this.fractions[i]! * (nz - 1)), 0, nz - 1);
      this.planes[i]!.update(fieldAtZ(zi), zi, nx, ny, nz);
    }
  }

  dispose(): void {
    for (const plane of this.planes) plane.dispose();
  }
}

/**
 * A fixed-capacity `THREE.Points` cloud of flow tracers, coloured per particle
 * by local speed (additive blending so the 3-D field reads through the box).
 */
export class TracerCloud {
  readonly points: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private positions: Float32Array;
  private colors: Float32Array;
  private capacity: number;

  constructor(capacity = 4000) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.positions = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.PointsMaterial({
      size: 1.1,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  get size(): number {
    return this.capacity;
  }

  /** Write `count` xyz + rgb triples and set the draw range. */
  update(xyz: Float32Array, rgb: Float32Array, count: number): void {
    const n = Math.max(
      0,
      Math.min(count, this.capacity, Math.floor(xyz.length / 3), Math.floor(rgb.length / 3)),
    );
    this.positions.set(xyz.subarray(0, n * 3));
    this.colors.set(rgb.subarray(0, n * 3));
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, n);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** mulberry32 — small deterministic PRNG so trails reproduce across reseeds. */
function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The structure view: ~hundreds of streamline seeds advected through the field,
 * each accumulating a ring buffer of positions rendered as one vertex-coloured
 * `THREE.LineSegments`. Buffers are preallocated (seeds × (len-1) × 2 vertices),
 * so there is no per-frame allocation. Seeds respawn at the inflow face when
 * they leave the domain, hit a solid cell, or complete a full trail.
 */
export class StreamlineTrails {
  readonly lines: THREE.LineSegments;
  private geometry: THREE.BufferGeometry;
  private material: THREE.LineBasicMaterial;
  private seeds: number;
  private trailLen: number;
  private ringPos: Float32Array;
  private ringSpd: Float32Array;
  private head: Int32Array;
  private count: Int32Array;
  private cur: Float32Array;
  private vPos: Float32Array;
  private vCol: Float32Array;
  private rand: () => number;
  private dims: [number, number, number] = [0, 0, 0];
  private lastU0 = 1;

  constructor(seeds = 300, trailLen = TRAIL_LEN, seed = 0x2545f491) {
    this.seeds = Math.max(1, Math.floor(seeds));
    this.trailLen = Math.max(2, Math.floor(trailLen));
    this.rand = mulberry32(seed);
    this.ringPos = new Float32Array(this.seeds * this.trailLen * 3);
    this.ringSpd = new Float32Array(this.seeds * this.trailLen);
    this.head = new Int32Array(this.seeds);
    this.count = new Int32Array(this.seeds);
    this.cur = new Float32Array(this.seeds * 3);
    const verts = this.seeds * (this.trailLen - 1) * 2;
    this.vPos = new Float32Array(verts * 3);
    this.vCol = new Float32Array(verts * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.vPos, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.vCol, 3));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false;
  }

  /** Number of emitted vertices the buffers can hold (for bookkeeping checks). */
  get vertexCapacity(): number {
    return this.vPos.length / 3;
  }

  private reset(nx: number, ny: number, nz: number): void {
    this.dims = [nx, ny, nz];
    this.head.fill(0);
    this.count.fill(0);
    for (let s = 0; s < this.seeds; s += 1) {
      this.cur[s * 3] = this.rand() * nx;
      this.cur[s * 3 + 1] = 1 + this.rand() * (ny - 2);
      this.cur[s * 3 + 2] = 1 + this.rand() * (nz - 2);
    }
  }

  private push(s: number, x: number, y: number, z: number, spd: number): void {
    const h = this.head[s]!;
    const base = (s * this.trailLen + h) * 3;
    this.ringPos[base] = x;
    this.ringPos[base + 1] = y;
    this.ringPos[base + 2] = z;
    this.ringSpd[s * this.trailLen + h] = spd;
    this.head[s] = (h + 1) % this.trailLen;
    if (this.count[s]! < this.trailLen) this.count[s] = this.count[s]! + 1;
  }

  /**
   * Advect every seed one step. `sampleVelocity(x, y, z)` returns the trilinear
   * velocity; `flags` is the solid mask (1 = solid).
   */
  step(
    sampleVelocity: (x: number, y: number, z: number) => [number, number, number],
    nx: number,
    ny: number,
    nz: number,
    flags: Float32Array,
    u0: number,
  ): void {
    if (this.dims[0] !== nx || this.dims[1] !== ny || this.dims[2] !== nz) this.reset(nx, ny, nz);
    this.lastU0 = Math.max(1e-9, u0);
    const k = 20;
    const maxV = Math.max(0.5, 2 * u0);
    for (let s = 0; s < this.seeds; s += 1) {
      const x = this.cur[s * 3]!;
      const y = this.cur[s * 3 + 1]!;
      const z = this.cur[s * 3 + 2]!;
      let [vx, vy, vz] = sampleVelocity(x, y, z);
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (sp > maxV) {
        const f = maxV / sp;
        vx *= f;
        vy *= f;
        vz *= f;
      }
      let px = x + vx * k;
      let py = y + vy * k;
      let pz = z + vz * k;
      const ci = Math.floor(pz) * nx * ny + Math.floor(py) * nx + Math.floor(px);
      const inside = px >= 0 && px < nx - 1 && py >= 0 && py < ny - 1 && pz >= 0 && pz < nz - 1;
      const blocked = !inside || (ci >= 0 && ci < flags.length && flags[ci]! > 0.5);
      if (blocked || this.count[s]! >= this.trailLen) {
        // Restart the trail at the inflow face; the previous ring is dropped.
        this.count[s] = 0;
        this.head[s] = 0;
        px = this.rand() * 2;
        py = 1 + this.rand() * (ny - 2);
        pz = 1 + this.rand() * (nz - 2);
        this.push(s, px, py, pz, 0);
      } else {
        this.push(s, px, py, pz, sp);
      }
      this.cur[s * 3] = px;
      this.cur[s * 3 + 1] = py;
      this.cur[s * 3 + 2] = pz;
    }
  }

  /** Rebuild the vertex arrays from the ring buffers (centred world coords). */
  update(): void {
    const [nx, ny, nz] = this.dims;
    if (nx === 0) return;
    const ox = (nx - 1) / 2;
    const oy = (ny - 1) / 2;
    const oz = (nz - 1) / 2;
    let v = 0;
    const maxVerts = this.vPos.length / 3;
    for (let s = 0; s < this.seeds; s += 1) {
      const c = this.count[s]!;
      if (c < 2) continue;
      const start = ((this.head[s]! - c) % this.trailLen + this.trailLen) % this.trailLen;
      for (let kk = 0; kk < c - 1; kk += 1) {
        if (v + 2 > maxVerts) break;
        const i0 = (start + kk) % this.trailLen;
        const i1 = (start + kk + 1) % this.trailLen;
        const b0 = (s * this.trailLen + i0) * 3;
        const b1 = (s * this.trailLen + i1) * 3;
        this.vPos[v * 3] = this.ringPos[b0]! - ox;
        this.vPos[v * 3 + 1] = this.ringPos[b0 + 1]! - oy;
        this.vPos[v * 3 + 2] = this.ringPos[b0 + 2]! - oz;
        this.vPos[v * 3 + 3] = this.ringPos[b1]! - ox;
        this.vPos[v * 3 + 4] = this.ringPos[b1 + 1]! - oy;
        this.vPos[v * 3 + 5] = this.ringPos[b1 + 2]! - oz;
        const c0 = speedRamp(this.ringSpd[s * this.trailLen + i0]! / this.lastU0);
        const c1 = speedRamp(this.ringSpd[s * this.trailLen + i1]! / this.lastU0);
        this.vCol[v * 3] = c0[0];
        this.vCol[v * 3 + 1] = c0[1];
        this.vCol[v * 3 + 2] = c0[2];
        this.vCol[v * 3 + 3] = c1[0];
        this.vCol[v * 3 + 4] = c1[1];
        this.vCol[v * 3 + 5] = c1[2];
        v += 2;
      }
    }
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, v);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** The obstacle mesh, scaled/positioned by the model→lattice fit. */
export class ObstacleView {
  readonly mesh: THREE.Mesh;
  private material: THREE.MeshStandardMaterial;
  private geometry: THREE.BufferGeometry | null = null;

  constructor() {
    // Opaque on purpose: an opaque mesh takes part in the depth buffer, so
    // tracers and streamlines in front of the body stay visible and the ones
    // behind it are occluded. A translucent shell instead gets painted over the
    // whole flow field in the transparent pass.
    this.material = new THREE.MeshStandardMaterial({
      color: 0x9fb6cc,
      metalness: 0.1,
      roughness: 0.65,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
  }

  /** Adopt `geometry` (ownership passes to this view) and place it. */
  set(geometry: THREE.BufferGeometry, fit: { scale: number; modelCenter: THREE.Vector3; center: THREE.Vector3 }, nx: number, ny: number, nz: number): void {
    if (this.geometry && this.geometry !== geometry) this.geometry.dispose();
    this.geometry = geometry;
    this.mesh.geometry = geometry;
    const domainCenter = new THREE.Vector3((nx - 1) / 2, (ny - 1) / 2, (nz - 1) / 2);
    this.mesh.scale.setScalar(fit.scale);
    this.mesh.position
      .copy(fit.center)
      .sub(domainCenter)
      .sub(fit.modelCenter.clone().multiplyScalar(fit.scale));
  }

  dispose(): void {
    this.geometry?.dispose();
    this.geometry = null;
    this.material.dispose();
  }
}

/** A translucent wireframe outline of the `nx*ny*nz` domain box. */
export function buildDomainOutline(nx: number, ny: number, nz: number): THREE.LineSegments {
  const box = new THREE.Box3(
    new THREE.Vector3(-(nx - 1) / 2, -(ny - 1) / 2, -(nz - 1) / 2),
    new THREE.Vector3((nx - 1) / 2, (ny - 1) / 2, (nz - 1) / 2),
  );
  const helper = new THREE.Box3Helper(box, 0x5b6b81);
  const geometry = helper.geometry.clone();
  helper.dispose();
  const material = new THREE.LineBasicMaterial({ color: 0x5b6b81, transparent: true, opacity: 0.4 });
  return new THREE.LineSegments(geometry, material);
}

/** Frame the whole domain box with the host camera + orbit controls. */
export function fitDomainCamera(
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update(): unknown },
  nx: number,
  ny: number,
  nz: number,
): void {
  const size = new THREE.Vector3(Math.max(nx - 1, 1), Math.max(ny - 1, 1), Math.max(nz - 1, 1));
  const radius = size.length() * 0.5;
  const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.5;
  const dir = new THREE.Vector3(0.85, 0.62, 1).normalize().multiplyScalar(dist);
  controls.target.set(0, 0, 0);
  camera.position.copy(dir);
  camera.near = Math.max(dist / 500, 0.01);
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
  camera.lookAt(0, 0, 0);
  controls.update();
}
