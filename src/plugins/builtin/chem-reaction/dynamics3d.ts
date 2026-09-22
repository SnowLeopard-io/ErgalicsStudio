// ==========================================================================
// chem-reaction — dynamics renderer
//
// Unlike the old kinetic3d (a scripted interpolation of a progress t), this
// scene REPLAYS the trajectory the NumPy reaction engine actually integrated:
// atom positions come straight from the physics frames, and each bond's
// visibility is driven by the engine's real fracture / recombination events.
// The engine decides when a bond breaks (Arrhenius barrier crossing) and when
// a radical pair recombines; this renderer only draws what happened.
// ==========================================================================

import * as THREE from 'three';
import { cpkColor, covalentRadius } from '@/chem/elements';
import type { PhysicsPayload, SimulationResult } from './reactmd/types';

export interface StaticSceneGroup {
  group: THREE.Group;
  shared: THREE.BufferGeometry[];
}

/**
 * Pre-run static reactant view: atoms sit at their initial positions and every
 * bond is shown in its assigned role — keep (neutral), break (reactive orange),
 * form (green but dim: not yet formed). Shown while the first engine run is
 * booting or whenever the reaction changes, so the canvas is never empty.
 */
export function buildStaticScene(payload: PhysicsPayload): StaticSceneGroup {
  const group = new THREE.Group();
  const shared: THREE.BufferGeometry[] = [];

  const spheres = payload.atoms.map((at) => {
    const mesh = makeSphere(at.symbol, shared);
    mesh.position.set(at.x, at.y, at.z);
    group.add(mesh);
    return mesh;
  });

  for (const b of payload.bonds) {
    const color = b.kind === 'keep' ? KEEP : b.kind === 'break' ? REACTIVE : FORMED;
    const mesh = makeBond(shared, color);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.opacity = b.kind === 'form' ? 0.35 : 0.85;
    group.add(mesh);
    rebar(mesh, b.a, b.b, spheres);
  }

  group.userData.sharedGeometries = shared;
  return { group, shared };
}

/** Frame the reaction cluster around the origin (reactants are centred at x=0). */
export function fitDynamicsCamera(
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update?: () => void },
  payload: PhysicsPayload,
): void {
  let minX = 0;
  let maxX = 0;
  let minZ = -1;
  let maxZ = 1;
  let minY = -1;
  let maxY = 1;
  for (const a of payload.atoms) {
    minX = Math.min(minX, a.x);
    maxX = Math.max(maxX, a.x);
    minY = Math.min(minY, a.y);
    maxY = Math.max(maxY, a.y);
    minZ = Math.min(minZ, a.z);
    maxZ = Math.max(maxZ, a.z);
  }
  const width = Math.max(maxX - minX, 6) + 2;
  const height = Math.max(maxY - minY, 2) + 2;
  const fry = Math.max(width, height) * 0.9 + 2;
  // Lens sits on the z-axis above the origin, and the controls target is the
  // origin — so the origin is dead-centre of the view. Reactants were centred
  // at x=0, so the whole cluster frames around it.
  controls.target.set(0, 0, 0);
  camera.position.set(0, 3.6, fry);
  camera.near = 0.1;
  camera.far = Math.max(fry + width * 4, 200);
  camera.updateProjectionMatrix();
  controls.update?.();
}

export interface DynamicsScene {
  group: THREE.Group;
  shared: THREE.BufferGeometry[];
  /** Advance the replay to a frame index. */
  update(frame: number): void;
  atomCount: number;
  frameCount: number;
  done: boolean;
}

const KEEP = 0x94a3b8;
const REACTIVE = 0xff8a6a; // a break bond before it fractures
const FORMED = 0x4ade80;
const BROKEN = 0xff5d5d;

interface PSide {
  kind: 'keep' | 'break' | 'form';
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  a: number;
  b: number;
  /** frame when the bond state changes, or -1 (no event → keep as-is). */
  at: number;
  occurred: boolean;
}

export function buildDynamicsScene(
  payload: PhysicsPayload,
  result: SimulationResult,
): DynamicsScene {
  const group = new THREE.Group();
  const shared: THREE.BufferGeometry[] = [];
  const positions = result.positions;
  const frameCount = positions.length;

  // atoms — one sphere per global reactant atom
  const spheres = payload.atoms.map((at) => {
    const mesh = makeSphere(at.symbol, shared);
    mesh.position.set(at.x, at.y, at.z);
    group.add(mesh);
    return mesh;
  });

  // event lookup: canonical pair -> frame (lowest)
  const evMap = (events: Array<{ a: number; b: number; t: number }>) => {
    const m = new Map<string, number>();
    for (const e of events) {
      const k = e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`;
      if (!m.has(k)) m.set(k, e.t);
    }
    return m;
  };
  const breakTimes = evMap(result.break_events ?? []);
  const formTimes = evMap(result.form_events ?? []);

  const bonds: PSide[] = payload.bonds.map((b) => {
    const k = b.a < b.b ? `${b.a}-${b.b}` : `${b.b}-${b.a}`;
    const mesh = makeBond(shared, b.kind === 'form' ? FORMED : b.kind === 'break' ? REACTIVE : KEEP);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const at = b.kind === 'form' ? formTimes.get(k) ?? -1 : b.kind === 'break' ? breakTimes.get(k) ?? -1 : -1;
    group.add(mesh);
    return { kind: b.kind, mesh, mat, a: b.a, b: b.b, at, occurred: at >= 0 };
  });

  // event flashes (red fracture / green recombination) at bond midpoints
  const flash = (color: number): THREE.Mesh => {
    const geo = new THREE.SphereGeometry(1, 16, 12);
    shared.push(geo);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  };
  const flashRed = flash(BROKEN);
  const flashGreen = flash(FORMED);

  const update = (frame: number): void => {
    const fr = Math.max(0, Math.min(frame, frameCount - 1));
    const pos = positions[fr];
    if (pos) {
      for (let i = 0; i < spheres.length; i += 1) {
        const p = pos[i];
        if (p) spheres[i]!.position.set(p[0]!, p[1]!, p[2]!);
      }
    }
    let redFlashAt: THREE.Vector3 | null = null;
    let greenFlashAt: THREE.Vector3 | null = null;
    for (const bd of bonds) {
      if (bd.kind === 'keep') {
        bd.mesh.visible = true;
        bd.mat.opacity = 0.85;
        rebar(bd.mesh, bd.a, bd.b, spheres);
        continue;
      }
      // break bond: visible until its fracture frame (if any)
      if (bd.kind === 'break') {
        const on = !bd.occurred || fr < bd.at;
        bd.mesh.visible = on;
        bd.mat.color.set(on ? REACTIVE : KEEP);
        bd.mat.opacity = on ? 0.75 : 0.0;
        if (fr === bd.at) redFlashAt = bondMid(fr, bd.a, bd.b, positions);
        if (on) rebar(bd.mesh, bd.a, bd.b, spheres);
        continue;
      }
      // form bond: invisible until recombination frame (if any)
      const on = bd.occurred && fr >= bd.at;
      bd.mesh.visible = on;
      bd.mat.color.set(FORMED);
      bd.mat.opacity = on ? 0.9 : 0.0;
      if (fr === bd.at) greenFlashAt = bondMid(fr, bd.a, bd.b, positions);
      if (on) rebar(bd.mesh, bd.a, bd.b, spheres);
    }
    showFlash(flashRed, redFlashAt);
    showFlash(flashGreen, greenFlashAt);
  };

  update(0);
  const done = result.form_flags?.every((f) => f) ?? false;
  group.userData.sharedGeometries = shared;
  return { group, shared, update, atomCount: payload.atoms.length, frameCount, done };
}

function showFlash(mesh: THREE.Mesh, at: THREE.Vector3 | null): void {
  mesh.visible = !!at;
  if (at) {
    mesh.position.copy(at);
    mesh.scale.setScalar(0.35);
    (mesh.material as THREE.MeshBasicMaterial).opacity = 0.7;
  }
}

/** Midpoint of two atoms inside a single physics frame. */
function bondMid(fr: number, a: number, b: number, positions: number[][][]): THREE.Vector3 {
  const pa = positions[fr]?.[a];
  const pb = positions[fr]?.[b];
  if (!pa || !pb) return new THREE.Vector3(0, 1.2, 0);
  return new THREE.Vector3((pa[0]! + pb[0]!) / 2, (pa[1]! + pb[1]!) / 2, (pa[2]! + pb[2]!) / 2);
}

// ---- geometry helpers (shared with static mechanism view) ------------------

function makeSphere(symbol: string, shared: THREE.BufferGeometry[]): THREE.Mesh {
  const geo = new THREE.SphereGeometry(1, 24, 18);
  shared.push(geo);
  const r = Math.min(Math.max(covalentRadius(symbol) * 0.46, 0.14), 0.4);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: cpkColor(symbol), roughness: 0.35, metalness: 0.05 }));
  m.scale.setScalar(Math.max(r, 0.12));
  return m;
}

function makeBond(shared: THREE.BufferGeometry[], color: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(0.055, 0.055, 1, 8);
  shared.push(geo);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, transparent: true, opacity: 0.9 });
  return new THREE.Mesh(geo, mat);
}

function rebar(mesh: THREE.Mesh, a: number, b: number, spheres: THREE.Mesh[]): void {
  const pa = spheres[a];
  const pb = spheres[b];
  if (!pa || !pb) return;
  const mid = new THREE.Vector3().addVectors(pa.position, pb.position).multiplyScalar(0.5);
  const len = pa.position.distanceTo(pb.position);
  const dir = new THREE.Vector3().subVectors(pb.position, pa.position).normalize();
  mesh.scale.y = Math.max(len, 0.05);
  mesh.position.copy(mid);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
}