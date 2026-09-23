// ==========================================================================
// chem-crystal — 3-D unit-cell builder (host Three.js scene)
//
// Renders a real `CrystalCell` (any triclinic lattice, from the chem core)
// as meshes inside the host `Scene3DHandle`: a translucent periodic box along
// the true lattice vectors, CPK-coloured atom spheres, and min-image inferred
// bonds.
// ==========================================================================

import * as THREE from 'three';
import type { CrystalCell } from '@/chem/structure';
import { latticeMatrix, fractionalToCartesian, inferBonds } from '@/chem/structure';
import { cpkColor, covalentRadius } from '@/chem/elements';

export type Representation = 'ball-stick' | 'spacefill';

export interface CrystalRenderOptions {
  representation: Representation;
  showBonds: boolean;
  showCell: boolean;
}

// Corner-index triplets for the 12 edges of a parallelepiped cell.
// Corner idx encodes bits (x<<0 | y<<1 | z<<2).
const EDGE_PAIRS: Array<[number, number]> = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along x
  [0, 2], [1, 3], [4, 6], [5, 7], // along y
  [0, 4], [1, 5], [2, 6], [3, 7], // along z
];

interface Corner {
  x: number;
  y: number;
  z: number;
}

/**
 * Build the full 3-D group for a crystal cell: box + atoms + (optionally)
 * bonds. The structure is centred on the origin (cell centre → 0) so the host
 * camera can orbit it naturally. Returns a group with `sharedGeometries` in
 * userData for one-shot disposal by the plugin.
 */
export function buildCrystalGroup(cell: CrystalCell, opts: CrystalRenderOptions): THREE.Group {
  const group = new THREE.Group();
  const shared: THREE.BufferGeometry[] = [];

  const [a, b, c] = latticeMatrix(cell.params);
  const center: Corner = {
    x: 0.5 * (a.x + b.x + c.x),
    y: 0.5 * (a.y + b.y + c.y),
    z: 0.5 * (a.z + b.z + c.z),
  };

  if (opts.showCell) {
    const boxGeo = buildCellBox(a, b, c, center);
    shared.push(boxGeo.geometry);
    group.add(boxGeo.lines);
  }

  // Atoms (sphere + optional element label handled as a shared sphere).
  const sphereGeo = new THREE.SphereGeometry(1, 28, 20);
  shared.push(sphereGeo);
  const addSphere = (symbol: string, position: THREE.Vector3) => {
    const mesh = new THREE.Mesh(
      sphereGeo,
      new THREE.MeshStandardMaterial({
        color: cpkColor(symbol),
        roughness: opts.representation === 'spacefill' ? 0.45 : 0.28,
        metalness: 0.08,
      }),
    );
    const r = opts.representation === 'spacefill'
      ? Math.min(covalentRadius(symbol) * 0.8, 0.62)
      : Math.min(covalentRadius(symbol) * 0.36, 0.34);
    mesh.scale.setScalar(Math.max(r, 0.06));
    mesh.position.copy(position);
    group.add(mesh);
    return mesh;
  };

  // Deduped atom drawing by element + quantised fractional position, shared
  // by the boundary enumeration and the bond-end copies below.
  const drawn = new Set<string>();
  const addAtomAt = (symbol: string, f: { x: number; y: number; z: number }): void => {
    const key = `${symbol}|${f.x.toFixed(3)}|${f.y.toFixed(3)}|${f.z.toFixed(3)}`;
    if (drawn.has(key)) return;
    drawn.add(key);
    const frac = fractionalToCartesian(cell.params, f);
    addSphere(symbol, new THREE.Vector3(frac.x - center.x, frac.y - center.y, frac.z - center.z))
      .userData.element = symbol;
  };

  // Textbook unit-cell style: draw every atom image that touches the cell —
  // a corner site contributes all 8 corner copies, an edge site 4, a face
  // site 2 — so corners and faces are populated instead of relying on stray
  // bond-end ghosts floating outside the box.
  const BOUNDARY_TOL = 1e-3;
  for (const s of cell.sites) {
    const xs = [s.fx];
    const ys = [s.fy];
    const zs = [s.fz];
    if (s.fx <= BOUNDARY_TOL) xs.push(s.fx + 1);
    if (s.fy <= BOUNDARY_TOL) ys.push(s.fy + 1);
    if (s.fz <= BOUNDARY_TOL) zs.push(s.fz + 1);
    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) addAtomAt(s.symbol, { x, y, z });
      }
    }
  }

  if (opts.showBonds) {
    const bonds = inferBonds(
      cell.sites.map((s) => ({ symbol: s.symbol, x: s.fx, y: s.fy, z: s.fz })),
      { cell: cell.params },
    );
    const cyl = new THREE.CylinderGeometry(0.055, 0.055, 1, 8);
    shared.push(cyl);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8b98a8, roughness: 0.6 });
    const toScene = (f: { x: number; y: number; z: number }): THREE.Vector3 => {
      const c = fractionalToCartesian(cell.params, f);
      return new THREE.Vector3(c.x - center.x, c.y - center.y, c.z - center.z);
    };
    const posKey = (f: { x: number; y: number; z: number }): string =>
      `${f.x.toFixed(3)}|${f.y.toFixed(3)}|${f.z.toFixed(3)}`;
    const drawnBonds = new Set<string>();
    const drawSegment = (fa: { x: number; y: number; z: number }, fb: { x: number; y: number; z: number }): void => {
      const ka = posKey(fa);
      const kb = posKey(fb);
      const key = ka < kb ? `${ka}~${kb}` : `${kb}~${ka}`;
      if (drawnBonds.has(key)) return;
      drawnBonds.add(key);
      const pa = toScene(fa);
      const pb = toScene(fb);
      const mid = new THREE.Vector3().addVectors(pa, pb).multiplyScalar(0.5);
      const dir = new THREE.Vector3().subVectors(pb, pa).normalize();
      const len = pa.distanceTo(pb);
      if (len < 1e-4) return;
      const m = new THREE.Mesh(cyl, mat);
      m.scale.y = len;
      m.position.copy(mid);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      group.add(m);
    };
    // Liang–Barsky clip of the fractional segment [fa, fb] against the unit
    // cell [0,1]³ — a bond crossing the boundary is drawn as the stub that
    // lies inside the cell (the convention structure viewers use), instead of
    // being dropped whole.
    const clipToCell = (
      fa: { x: number; y: number; z: number },
      fb: { x: number; y: number; z: number },
    ): [{ x: number; y: number; z: number }, { x: number; y: number; z: number }] | null => {
      let t0 = 0;
      let t1 = 1;
      for (const ax of ['x', 'y', 'z'] as const) {
        const d = fb[ax] - fa[ax];
        if (Math.abs(d) < 1e-12) {
          if (fa[ax] < -BOUNDARY_TOL || fa[ax] > 1 + BOUNDARY_TOL) return null;
          continue;
        }
        const rLo = (0 - fa[ax]) / d;
        const rHi = (1 - fa[ax]) / d;
        t0 = Math.max(t0, Math.min(rLo, rHi));
        t1 = Math.min(t1, Math.max(rLo, rHi));
        if (t0 > t1) return null;
      }
      return [
        { x: fa.x + (fb.x - fa.x) * t0, y: fa.y + (fb.y - fa.y) * t0, z: fa.z + (fb.z - fa.z) * t0 },
        { x: fa.x + (fb.x - fa.x) * t1, y: fa.y + (fb.y - fa.y) * t1, z: fa.z + (fb.z - fa.z) * t1 },
      ];
    };
    for (const { a: ia, b: ib, image } of bonds) {
      const sa = cell.sites[ia]!;
      const sb = cell.sites[ib]!;
      if (!image) {
        // Non-periodic (molecular) input: plain segment between the sites.
        drawSegment({ x: sa.fx, y: sa.fy, z: sa.fz }, { x: sb.fx, y: sb.fy, z: sb.fz });
        continue;
      }
      // Textbook cut: draw every translate of the contact clipped to the
      // cell — full segments for contacts inside the cell, boundary stubs
      // for bonds continuing into the neighbouring cell (e.g. an S–S dimer
      // straddling a cell edge), deduped by endpoints.
      for (let nx = -2; nx <= 2; nx += 1) {
        for (let ny = -2; ny <= 2; ny += 1) {
          for (let nz = -2; nz <= 2; nz += 1) {
            const fa = { x: sa.fx + nx, y: sa.fy + ny, z: sa.fz + nz };
            const fb = { x: fa.x + image.x, y: fa.y + image.y, z: fa.z + image.z };
            const seg = clipToCell(fa, fb);
            if (seg) drawSegment(seg[0], seg[1]);
          }
        }
      }
    }
  }

  group.userData.sharedGeometries = shared;
  return group;
}

/** Build the translucent unit-cell wireframe along the true lattice vectors. */
function buildCellBox(a: Corner, b: Corner, c: Corner, center: Corner): { lines: THREE.LineSegments; geometry: THREE.BufferGeometry } {
  const corners: Corner[] = [];
  for (let i = 0; i < 2; i += 1) {
    for (let j = 0; j < 2; j += 1) {
      for (let k = 0; k < 2; k += 1) {
        corners.push({
          x: i * a.x + j * b.x + k * c.x - center.x,
          y: i * a.y + j * b.y + k * c.y - center.y,
          z: i * a.z + j * b.z + k * c.z - center.z,
        });
      }
    }
  }
  const pts: number[] = [];
  for (const [p, q] of EDGE_PAIRS) {
    pts.push(corners[p]!.x, corners[p]!.y, corners[p]!.z, corners[q]!.x, corners[q]!.y, corners[q]!.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.55 });
  return { lines: new THREE.LineSegments(geometry, mat), geometry };
}

/** Move the host camera so the (origin-centred) cell fills the view. */
export function fitCrystalCamera(
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update?: () => void },
  cell: CrystalCell,
): void {
  const radius = cellRadius(cell);
  controls.target.set(0, 0, 0);
  camera.position.set(radius * 1.7, radius * 1.25, radius * 1.9);
  camera.near = Math.max(radius / 200, 1e-4);
  camera.far = Math.max(radius * 200, 200);
  camera.updateProjectionMatrix();
  controls.update?.();
}

/** Bounding radius (Å, centred frame) with margin for the info card. */
export function cellRadius(cell: CrystalCell): number {
  const [a, b, c] = latticeMatrix(cell.params);
  // Diagonal from cell centre to the farthest corner.
  const dx = 0.5 * (a.x + b.x + c.x);
  const dy = 0.5 * (a.y + b.y + c.y);
  const dz = 0.5 * (a.z + b.z + c.z);
  return Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1.4);
}