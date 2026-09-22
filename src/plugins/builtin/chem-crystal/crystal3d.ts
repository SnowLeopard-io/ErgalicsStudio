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
  const atomPositions: THREE.Vector3[] = [];

  for (const s of cell.sites) {
    const frac = fractionalToCartesian(cell.params, { x: s.fx, y: s.fy, z: s.fz });
    const pos = new THREE.Vector3(frac.x - center.x, frac.y - center.y, frac.z - center.z);
    atomPositions.push(pos);
    const color = cpkColor(s.symbol);
    const r = opts.representation === 'spacefill'
      ? Math.min(covalentRadius(s.symbol) * 0.8, 0.62)
      : Math.min(covalentRadius(s.symbol) * 0.36, 0.34);
    const mesh = new THREE.Mesh(
      sphereGeo,
      new THREE.MeshStandardMaterial({
        color,
        roughness: opts.representation === 'spacefill' ? 0.45 : 0.28,
        metalness: 0.08,
      }),
    );
    mesh.scale.setScalar(Math.max(r, 0.06));
    mesh.position.copy(pos);
    mesh.userData.element = s.symbol;
    group.add(mesh);
  }

  if (opts.showBonds) {
    const bonds = inferBonds(
      cell.sites.map((s) => ({ symbol: s.symbol, x: s.fx, y: s.fy, z: s.fz })),
      { cell: cell.params },
    );
    const cyl = new THREE.CylinderGeometry(0.055, 0.055, 1, 8);
    shared.push(cyl);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8b98a8, roughness: 0.6 });
    for (const { aI, bI } of bonds.map((x) => ({ aI: x.a, bI: x.b }))) {
      const pa = atomPositions[aI]!;
      const pb = atomPositions[bI]!;
      const mid = new THREE.Vector3().addVectors(pa, pb).multiplyScalar(0.5);
      const dir = new THREE.Vector3().subVectors(pb, pa).normalize();
      const len = pa.distanceTo(pb);
      const m = new THREE.Mesh(cyl, mat);
      m.scale.y = len;
      m.position.copy(mid);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      group.add(m);
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