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
  /** Cut every atom and bond at the six cell faces (boundary-model view). */
  clipToCell?: boolean;
}

/**
 * van der Waals radii (Bondi, Å) — the space-filling radius for *molecular*
 * crystals, where whole molecules touch their neighbours. Falls back to a
 * scaled covalent radius for unlisted elements.
 */
const VDW_RADII: Record<string, number> = {
  H: 1.2, He: 1.4, Li: 1.82, Be: 1.53, B: 1.92, C: 1.7, N: 1.55, O: 1.52,
  F: 1.47, Ne: 1.54, Na: 2.27, Mg: 1.73, Al: 1.84, Si: 2.1, P: 1.8, S: 1.8,
  Cl: 1.75, Ar: 1.88, K: 2.75, Ca: 2.31, Ti: 2.0, V: 2.0, Cr: 2.0, Mn: 2.0,
  Fe: 2.04, Co: 2.0, Ni: 1.63, Cu: 1.4, Zn: 1.39, Ga: 1.87, Ge: 2.11,
  As: 1.85, Se: 1.9, Br: 1.85, Kr: 2.02, Rb: 3.03, Sr: 2.55, Sn: 2.17,
  Ba: 2.68, Pb: 2.02,
};

const vdWRadius = (symbol: string): number => {
  const r = VDW_RADII[symbol];
  if (r !== undefined) return r;
  const cov = covalentRadius(symbol);
  return cov > 0 ? cov * 1.63 : 1.6;
};

/**
 * Shannon effective ionic radii (Å, coordination 6) — the radii at which ions
 * in an extended ionic crystal actually touch. Neutral-atom vdW radii would
 * make ions interpenetrate (Na⁺ 2.27 + Cl⁻ 1.75 = 4.02 Å against a real
 * Na···Cl distance of 2.82 Å). Element-keyed: one ionisation per element.
 */
const IONIC_RADII: Record<string, number> = {
  Li: 0.76, Na: 1.02, K: 1.38, Rb: 1.52, Cs: 1.67, Be: 0.45, Mg: 0.72,
  Ca: 1.00, Sr: 1.18, Ba: 1.35, B: 0.27, Al: 0.54, C: 0.16, Si: 0.26,
  P: 0.44, N: 1.46, O: 1.40, S: 1.84, Se: 1.98, F: 1.33, Cl: 1.81,
  Br: 1.96, I: 2.20, Ti: 0.61, V: 0.64, Cr: 0.62, Mn: 0.83, Fe: 0.78,
  Co: 0.75, Ni: 0.69, Cu: 0.77, Zn: 0.74, Ag: 1.15, Cd: 0.95, Sn: 0.83,
  Sb: 0.76, Pb: 1.19,
};

/** Shortest interatomic distance across all periodic images (Å). */
function minNeighborDistance(cell: CrystalCell): number {
  const [a, b, c] = latticeMatrix(cell.params);
  const pos = cell.sites.map((s) =>
    fractionalToCartesian(cell.params, { x: s.fx, y: s.fy, z: s.fz }));
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < pos.length; i += 1) {
    for (let j = i; j < pos.length; j += 1) {
      for (let nx = -1; nx <= 1; nx += 1) {
        for (let ny = -1; ny <= 1; ny += 1) {
          for (let nz = -1; nz <= 1; nz += 1) {
            if (i === j && nx === 0 && ny === 0 && nz === 0) continue;
            const tx = nx * a.x + ny * b.x + nz * c.x;
            const ty = nx * a.y + ny * b.y + nz * c.y;
            const tz = nx * a.z + ny * b.z + nz * c.z;
            const dx = pos[j]!.x + tx - pos[i]!.x;
            const dy = pos[j]!.y + ty - pos[i]!.y;
            const dz = pos[j]!.z + tz - pos[i]!.z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (d < best) best = d;
          }
        }
      }
    }
  }
  return best;
}

/** Inter-cluster pairs closer than this fraction of a covalent contact mean
 *  the "molecules" are actually one extended framework. */
const CONTACT_FACTOR = 1.3;

/**
 * True when the cell decomposes into discrete molecules: finite bond clusters
 * that never wrap periodically and stay clear of one another (nearest
 * inter-cluster contact beyond a covalent-scale distance).
 */
function isMolecularAssembly(cell: CrystalCell): boolean {
  const bonds = inferBonds(
    cell.sites.map((s) => ({ symbol: s.symbol, x: s.fx, y: s.fy, z: s.fz })),
    { cell: cell.params },
  );
  const adj: Array<Array<{ to: number; ix: number; iy: number; iz: number }>> =
    cell.sites.map(() => []);
  for (const bd of bonds) {
    if (!bd.image) return true; // non-periodic input → molecular by definition
    adj[bd.a]!.push({ to: bd.b, ix: bd.image.x, iy: bd.image.y, iz: bd.image.z });
    adj[bd.b]!.push({ to: bd.a, ix: -bd.image.x, iy: -bd.image.y, iz: -bd.image.z });
  }
  // Connected components with lattice-offset tracking: reaching the same site
  // under two different offsets means the cluster extends periodically.
  const offsetOf: Array<string | undefined> = cell.sites.map(() => undefined);
  const componentOf = new Array<number>(cell.sites.length).fill(-1);
  let nComponents = 0;
  for (let start = 0; start < cell.sites.length; start += 1) {
    if (offsetOf[start] !== undefined) continue;
    nComponents += 1;
    offsetOf[start] = '0,0,0';
    const queue = [start];
    while (queue.length) {
      const idx = queue.pop()!;
      componentOf[idx] = nComponents - 1;
      const [ox, oy, oz] = offsetOf[idx]!.split(',').map(Number);
      for (const { to, ix, iy, iz } of adj[idx]!) {
        const key = `${ox! + ix},${oy! + iy},${oz! + iz}`;
        if (offsetOf[to] === undefined) {
          offsetOf[to] = key;
          queue.push(to);
        } else if (offsetOf[to] !== key) {
          return false; // periodic wrap → extended framework
        }
      }
    }
  }
  if (nComponents === 1) return true; // a single finite cluster = one molecule
  // Distinct clusters approaching within a covalent-scale distance → the
  // assembly is an extended framework (e.g. Ca²⁺ packed against CO₃²⁻).
  const [a, b, c] = latticeMatrix(cell.params);
  const pos = cell.sites.map((s) =>
    fractionalToCartesian(cell.params, { x: s.fx, y: s.fy, z: s.fz }));
  for (let i = 0; i < pos.length; i += 1) {
    for (let j = 0; j < pos.length; j += 1) {
      if (componentOf[i] === componentOf[j]) continue;
      const lim = CONTACT_FACTOR *
        (covalentRadius(cell.sites[i]!.symbol) + covalentRadius(cell.sites[j]!.symbol));
      for (let nx = -1; nx <= 1; nx += 1) {
        for (let ny = -1; ny <= 1; ny += 1) {
          for (let nz = -1; nz <= 1; nz += 1) {
            const dx = pos[j]!.x + nx * a.x + ny * b.x + nz * c.x - pos[i]!.x;
            const dy = pos[j]!.y + nx * a.y + ny * b.y + nz * c.y - pos[i]!.y;
            const dz = pos[j]!.z + nx * a.z + ny * b.z + nz * c.z - pos[i]!.z;
            if (dx * dx + dy * dy + dz * dz < lim * lim) return false;
          }
        }
      }
    }
  }
  return true;
}

/**
 * Per-element space-filling radii, chosen so spheres touch instead of
 * interpenetrating: half the nearest-neighbour distance for single-element
 * cells (metals / covalent networks), van der Waals radii for molecular
 * crystals, ionic radii for extended ionic frameworks (VESTA convention).
 */
function spacefillRadii(cell: CrystalCell): Map<string, number> {
  const symbols = [...new Set(cell.sites.map((s) => s.symbol))];
  const map = new Map<string, number>();
  if (symbols.length === 1) {
    map.set(symbols[0]!, minNeighborDistance(cell) / 2);
    return map;
  }
  if (isMolecularAssembly(cell)) {
    for (const s of symbols) map.set(s, vdWRadius(s));
    return map;
  }
  for (const s of symbols) map.set(s, IONIC_RADII[s] ?? vdWRadius(s));
  return map;
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

  // Space-filling radii (ionic / vdW / half-NN per structure type) computed
  // once so spheres touch instead of interpenetrating.
  const fillRadii = opts.representation === 'spacefill' ? spacefillRadii(cell) : null;
  const fillRadiusOf = (symbol: string): number =>
    fillRadii?.get(symbol) ?? vdWRadius(symbol);

  // Boundary-model view: cut atoms and bonds at the six cell faces.
  const clipPlanes = opts.clipToCell ? cellClipPlanes(a, b, c, center) : null;

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
        // DoubleSide so a sphere cut by a face shows a solid cap, not a hole.
        ...(clipPlanes ? { clippingPlanes: clipPlanes, side: THREE.DoubleSide } : {}),
      }),
    );
    const r = fillRadii
      ? fillRadiusOf(symbol)
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
  // In the space-filling view atoms are drawn at their touching radii (see
  // spacefillRadii), so images sitting just outside a face still overlap the
  // cell and must be drawn for the packing to read as continuous.
  const minAxisLen = Math.min(cell.params.a, cell.params.b, cell.params.c);
  for (const s of cell.sites) {
    // Fractional depth this element's sphere can reach across a face
    // (orthorhombic approximation; close enough for visual completeness).
    const reach = fillRadii
      ? fillRadiusOf(s.symbol) / minAxisLen
      : BOUNDARY_TOL;
    const xs = [s.fx];
    const ys = [s.fy];
    const zs = [s.fz];
    if (s.fx <= reach) xs.push(s.fx + 1);
    if (s.fy <= reach) ys.push(s.fy + 1);
    if (s.fz <= reach) zs.push(s.fz + 1);
    if (s.fx >= 1 - reach) xs.push(s.fx - 1);
    if (s.fy >= 1 - reach) ys.push(s.fy - 1);
    if (s.fz >= 1 - reach) zs.push(s.fz - 1);
    for (const x of xs) {
      for (const y of ys) {
        for (const z of zs) addAtomAt(s.symbol, { x, y, z });
      }
    }
  }

  // Space-filling models hide the sticks entirely — the touching spheres
  // carry the connectivity (the chemistry-textbook convention).
  if (opts.showBonds && opts.representation === 'ball-stick') {
    const bonds = inferBonds(
      cell.sites.map((s) => ({ symbol: s.symbol, x: s.fx, y: s.fy, z: s.fz })),
      { cell: cell.params },
    );
    const cyl = new THREE.CylinderGeometry(0.055, 0.055, 1, 8);
    shared.push(cyl);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x8b98a8,
      roughness: 0.6,
      ...(clipPlanes ? { clippingPlanes: clipPlanes, side: THREE.DoubleSide } : {}),
    });
    const toScene = (f: { x: number; y: number; z: number }): THREE.Vector3 => {
      const c = fractionalToCartesian(cell.params, f);
      return new THREE.Vector3(c.x - center.x, c.y - center.y, c.z - center.z);
    };
    const posKey = (f: { x: number; y: number; z: number }): string =>
      `${f.x.toFixed(3)}|${f.y.toFixed(3)}|${f.z.toFixed(3)}`;
    const drawnBonds = new Set<string>();
    // A bond endpoint always sits on some site (plus an integer lattice
    // translate) — populate it with that site's mirror copy so a bond that
    // continues past a cell face ends on an atom, never in empty space.
    const atomAt = (f: { x: number; y: number; z: number }): void => {
      for (const s of cell.sites) {
        const rx = Math.round(f.x - s.fx);
        const ry = Math.round(f.y - s.fy);
        const rz = Math.round(f.z - s.fz);
        if (
          Math.abs(f.x - s.fx - rx) < 1e-3 &&
          Math.abs(f.y - s.fy - ry) < 1e-3 &&
          Math.abs(f.z - s.fz - rz) < 1e-3
        ) {
          addAtomAt(s.symbol, f);
          return;
        }
      }
    };
    const drawSegment = (fa: { x: number; y: number; z: number }, fb: { x: number; y: number; z: number }): void => {
      const ka = posKey(fa);
      const kb = posKey(fb);
      const key = ka < kb ? `${ka}~${kb}` : `${kb}~${ka}`;
      if (drawnBonds.has(key)) return;
      drawnBonds.add(key);
      atomAt(fa);
      atomAt(fb);
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
    // cell [0,1]³ — used as a pure intersection test: the bond itself is
    // drawn at full length (see the loop below), the clip only decides
    // whether the bond overlaps this cell at all, and by how much.
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
      // Draw every translate of the contact that overlaps the cell, at full
      // length: a bond continuing into the neighbouring image (e.g. an S–S
      // dimer straddling a cell edge) pokes out of the box and is capped by
      // a mirror atom at its far end, deduped by endpoints.
      for (let nx = -2; nx <= 2; nx += 1) {
        for (let ny = -2; ny <= 2; ny += 1) {
          for (let nz = -2; nz <= 2; nz += 1) {
            const fa = { x: sa.fx + nx, y: sa.fy + ny, z: sa.fz + nz };
            const fb = { x: fa.x + image.x, y: fa.y + image.y, z: fa.z + image.z };
            const seg = clipToCell(fa, fb);
            if (seg) {
              // Skip grazing contacts whose clipped depth is ~0 — they touch
              // the box only at a corner/edge and belong to the neighbouring
              // image, not to this cell.
              const dx = seg[1].x - seg[0].x;
              const dy = seg[1].y - seg[0].y;
              const dz = seg[1].z - seg[0].z;
              if (dx * dx + dy * dy + dz * dz > 1e-9) drawSegment(fa, fb);
            }
          }
        }
      }
    }
  }

  group.userData.sharedGeometries = shared;
  return group;
}

/**
 * Six clipping planes flush with the cell faces, keeping the interior —
 * the boundary-model view that cuts atoms and bonds at the cell boundary.
 * Scene coordinates (the group is centred on the cell centre).
 */
function cellClipPlanes(a: Corner, b: Corner, c: Corner, center: Corner): THREE.Plane[] {
  const cross = (u: Corner, v: Corner): THREE.Vector3 => new THREE.Vector3(
    u.y * v.z - u.z * v.y,
    u.z * v.x - u.x * v.z,
    u.x * v.y - u.y * v.x,
  );
  // Scalar triple product a·(b×c) — the signed cell volume, positive for the
  // right-handed lattice basis used here.
  const bx_c = cross(b, c);
  const volume = a.x * bx_c.x + a.y * bx_c.y + a.z * bx_c.z;
  const centerV = new THREE.Vector3(center.x, center.y, center.z);
  const planes: THREE.Plane[] = [];
  for (const [u, v] of [[b, c], [c, a], [a, b]] as const) {
    // u×v points into the cell along this axis: (u×v)·p_cart = axis coord × V.
    const g = cross(u, v);
    const n = g.clone().normalize();
    const dCenter = n.dot(centerV);
    // Keep axis coordinate ≥ 0 …
    planes.push(new THREE.Plane(n.clone(), dCenter));
    // … and ≤ 1 (normal flipped, plane offset through the opposite face).
    planes.push(new THREE.Plane(n.clone().negate(), -dCenter + volume / g.length()));
  }
  return planes;
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