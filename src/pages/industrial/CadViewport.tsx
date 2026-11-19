// ==========================================================================
// Industrial CAD viewport — an independent Three.js canvas (not the plugin
// host scene) so it can live inside a ToolShell page. Owns renderer, camera,
// orbit controls and disposal; geometry construction lives in core/cad3d.
// ==========================================================================

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  engineeringBounds,
  geometryToScene,
  isosurfaceToScene,
  meshToScene,
} from '@/core/engineering/cad3d';
import type { VoxelField } from '@/core/mesh3d';
import { disposeObjectTree, fitCameraToObject } from '@/core/three-utils';
import type {
  EngineeringField,
  EngineeringGeometry,
  EngineeringMesh,
} from '@/core/engineering/types';

export type CadViewPreset = 'fit' | 'front' | 'top' | 'side';

export interface CadViewportProps {
  geometry?: EngineeringGeometry | null;
  mesh?: EngineeringMesh | null;
  field?: EngineeringField | null;
  height?: number;
  wireframe?: boolean;
  showGrid?: boolean;
  layers?: readonly string[];
  preset?: CadViewPreset;
  /** Optional 3-D isosurface overlay (sampled volume + contour level). */
  isoVolume?: VoxelField | null;
  isoLevel?: number;
  /** Called with a PNG data URL when the user asks for a snapshot. */
  onSnapshotReady?: (url: string) => void;
  snapshotRequest?: number;
}

interface SceneHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
  grid: THREE.GridHelper;
}

const PRESET_DIRECTIONS: Record<CadViewPreset, THREE.Vector3> = {
  fit: new THREE.Vector3(1, 0.75, 1.15),
  front: new THREE.Vector3(0, 0, 1),
  top: new THREE.Vector3(0, 1, 0.0001),
  side: new THREE.Vector3(1, 0, 0.0001),
};

export function CadViewport({
  geometry,
  mesh,
  field,
  height = 440,
  wireframe = false,
  showGrid = true,
  layers,
  preset = 'fit',
  isoVolume = null,
  isoLevel = 0.5,
  snapshotRequest = 0,
  onSnapshotReady,
}: CadViewportProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  // Keep the snapshot callback in a ref: the parent passes a fresh closure on
  // every render, and listing it in the snapshot effect's deps would re-run
  // (and re-download) the PNG after each unrelated parent re-render.
  const onSnapshotReadyRef = useRef(onSnapshotReady);
  onSnapshotReadyRef.current = onSnapshotReady;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create the renderer/camera ONCE; rebuild only the content group on data change.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth || 800, height, false);
    renderer.setClearColor(0x0b1117, 1);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1117);
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 2, 1);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x93c5fd, 0.5);
    fill.position.set(-1, -1, -0.5);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(55, (host.clientWidth || 800) / height, 0.01, 100000);
    camera.position.set(2, 1.5, 2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    const content = new THREE.Group();
    scene.add(content);
    const grid = new THREE.GridHelper(10, 10, 0x475569, 0x1e293b);
    grid.rotation.x = Math.PI / 2; // XY plane is the default engineering sketch plane.
    scene.add(grid);
    handleRef.current = { renderer, scene, camera, controls, content, grid };

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    const resize = () => {
      const width = host.clientWidth || 800;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(host);
    setReady(true);

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      controls.dispose();
      disposeObjectTree(content);
      disposeObjectTree(grid);
      renderer.dispose();
      renderer.domElement.remove();
      handleRef.current = null;
    };
  }, [height]);

  // Rebuild the content group whenever data or display options change.
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    disposeObjectTree(handle.content);
    handle.content.clear();
    if (geometry) {
      handle.content.add(geometryToScene(geometry, { layers }));
    }
    if (mesh) {
      handle.content.add(meshToScene(mesh, field ?? null, { wireframe }));
    }
    if (isoVolume) {
      const iso = isosurfaceToScene(
        isoVolume, isoLevel, 0x38bdf8,
        mesh ? mesh.bounds : undefined,
      );
      if (iso) handle.content.add(iso);
    }
    const box = engineeringBounds(geometry, mesh);
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1) * 0.5;
    // Scale the grid to the model so it never dwarfs or disappears under it.
    handle.grid.scale.setScalar(Math.max(radius / 5, 0.01));
    fitCameraToObject(handle.content, handle.camera, handle.controls, {
      direction: PRESET_DIRECTIONS[preset],
      margin: 1.4,
    });
    handle.grid.visible = showGrid;
  }, [geometry, mesh, field, wireframe, layers, preset, showGrid, ready, isoVolume, isoLevel]);

  // Snapshot is request-driven to avoid re-rendering on every frame.
  useEffect(() => {
    if (snapshotRequest === 0) return;
    const handle = handleRef.current;
    const ready = onSnapshotReadyRef.current;
    if (!handle || !ready) return;
    handle.renderer.render(handle.scene, handle.camera);
    ready(handle.renderer.domElement.toDataURL('image/png'));
  }, [snapshotRequest]);

  return (
    <div className="ind-cad-viewport" style={{ height }} ref={hostRef}>
      {error && <div className="ind-cad-error">{error}</div>}
      {!error && !geometry && !mesh && <div className="ind-cad-empty">—</div>}
    </div>
  );
}
