// ==========================================================================
// Host-managed Three.js scene container (spec §3.2.3 — 3D container)
// ==========================================================================
//
// Lazily created by the workbench on first demand, then cached for the
// session. Plugins receive a `Scene3DHandle` through `container.three` and
// add their own meshes/lights to `scene`. The host owns the render loop,
// orbit controls, resize handling, and disposal of GPU resources.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Scene3DHandle } from '@/types/plugin';

/** Matches the app's dark canvas background (see styles). */
const SCENE_BACKGROUND = 0x0b1117;

export function createScene3D(container: HTMLElement): Scene3DHandle {
  const canvas = document.createElement('canvas');
  canvas.className = 'scene3d-canvas';
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  // Hidden until a 3D-capable plugin activates, so a stale 3D coordinate
  // system can never cover a 2D viewport.
  canvas.style.display = 'none';
  container.appendChild(canvas);

  const width = container.clientWidth || 640;
  const height = container.clientHeight || 480;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SCENE_BACKGROUND);

  const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 2000);
  camera.position.set(10, 8, 12);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Reference furniture so plugins have spatial context out of the box.
  scene.add(new THREE.GridHelper(24, 24, 0x334155, 0x1e293b));
  scene.add(new THREE.AxesHelper(6));
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
  keyLight.position.set(12, 20, 10);
  scene.add(keyLight);

  let raf = 0;
  let disposed = false;
  let visible = false;

  const renderFrame = () => {
    if (disposed || !visible) return;
    controls.update();
    renderer.render(scene, camera);
  };

  const loop = () => {
    if (disposed) return;
    renderFrame();
    raf = requestAnimationFrame(loop);
  };

  const startLoop = () => {
    if (disposed || raf !== 0) return;
    raf = requestAnimationFrame(loop);
  };

  const stopLoop = () => {
    if (raf !== 0) cancelAnimationFrame(raf);
    raf = 0;
  };

  const resize = () => {
    if (disposed) return;
    const w = container.clientWidth || 640;
    const h = container.clientHeight || 480;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  return {
    scene,
    camera,
    controls,
    renderer,
    setVisible(next: boolean) {
      if (disposed || visible === next) return;
      visible = next;
      canvas.style.display = next ? 'block' : 'none';
      if (next) {
        resize();
        // Render continuously only while a 3D plugin is actually showing the
        // scene — previously the rAF loop spun forever even when hidden,
        // burning CPU for the whole session.
        startLoop();
      } else {
        stopLoop();
      }
    },
    render: renderFrame,
    snapshot: () => renderer.domElement.toDataURL('image/png'),
    dispose: () => {
      disposed = true;
      stopLoop();
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
