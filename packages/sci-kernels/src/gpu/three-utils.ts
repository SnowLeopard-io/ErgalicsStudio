// ==========================================================================
// Shared Three.js utilities: GPU-safe disposal and camera framing helpers.
// ==========================================================================
//
// Used by the host scene container and by 3D plugins (model viewer, EM
// eigensolver, CFD coupler) so object teardown behaves identically
// everywhere.

import * as THREE from 'three';

/** Recursively dispose geometries, materials, and their textures. */
export function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as
      | THREE.Material
      | THREE.Material[]
      | undefined;
    if (Array.isArray(material)) {
      material.forEach(disposeMaterial);
    } else if (material) {
      disposeMaterial(material);
    }
  });
}

function disposeMaterial(material: THREE.Material): void {
  const record = material as unknown as Record<string, unknown>;
  for (const key of Object.keys(material)) {
    const value = record[key];
    if (value && (value as THREE.Texture).isTexture) {
      (value as THREE.Texture).dispose();
    }
  }
  material.dispose();
}

/** Fit result: orbit target (bbox center) and a camera offset from it. */
export interface FrameFit {
  target: THREE.Vector3;
  offset: THREE.Vector3;
}

/** Compute a camera placement that frames `object` with margin. */
export function fitCameraToObject(
  object: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  controls: { target: THREE.Vector3; update(): unknown },
  opts?: { direction?: THREE.Vector3; margin?: number },
): FrameFit {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) {
    const target = new THREE.Vector3();
    return { target, offset: camera.position.clone().sub(target) };
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
  const margin = opts?.margin ?? 1.6;
  const dir = (opts?.direction ?? new THREE.Vector3(1, 0.75, 1.15))
    .clone()
    .normalize();
  const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * margin;
  controls.target.copy(center);
  const offset = dir.multiplyScalar(dist);
  camera.position.copy(center).add(offset);
  camera.lookAt(center);
  controls.update();
  return { target: center, offset };
}
