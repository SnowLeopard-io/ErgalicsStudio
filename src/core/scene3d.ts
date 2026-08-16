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

  // Mouse: left-drag orbits, right-drag pans, wheel zooms. Keyboard: arrow
  // keys pan (built into OrbitControls once it owns the key listeners), WASD
  // translates along the view axes, Q/E yaw the camera around the target.
  controls.listenToKeyEvents(canvas);

  const keys = new Set<string>();
  const KEY_SPEED = 0.12;
  const YAW_RATE = 0.02;
  const onCanvasKeyDown = (e: KeyboardEvent) => keys.add(e.key.toLowerCase());
  const onCanvasKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  canvas.addEventListener('keydown', onCanvasKeyDown);
  canvas.addEventListener('keyup', onCanvasKeyUp);

  const vForward = new THREE.Vector3();
  const vRight = new THREE.Vector3();
  const vDelta = new THREE.Vector3();
  const vOffset = new THREE.Vector3();

  const applyKeyboard = () => {
    const speed = KEY_SPEED * (keys.has('shift') ? 3 : 1);
    camera.getWorldDirection(vForward);
    vRight.crossVectors(vForward, camera.up).normalize();
    vDelta.set(0, 0, 0);
    if (keys.has('w')) vDelta.addScaledVector(vForward, speed);
    if (keys.has('s')) vDelta.addScaledVector(vForward, -speed);
    if (keys.has('d')) vDelta.addScaledVector(vRight, speed);
    if (keys.has('a')) vDelta.addScaledVector(vRight, -speed);
    const yaw = (keys.has('e') ? YAW_RATE : 0) - (keys.has('q') ? YAW_RATE : 0);
    if (yaw !== 0) {
      // Yaw around the orbit target in world space, keeping the camera at a
      // constant distance so OrbitControls' spherical state stays consistent.
      vOffset.copy(camera.position).sub(controls.target);
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      vOffset.set(
        vOffset.x * cos - vOffset.z * sin,
        vOffset.y,
        vOffset.x * sin + vOffset.z * cos,
      );
      camera.position.copy(controls.target).add(vOffset);
      camera.lookAt(controls.target);
    }
    if (vDelta.lengthSq() > 0) {
      // Translate both the camera and the orbit target by the same delta so
      // subsequent orbiting pivots around the moved viewpoint, not the old one.
      camera.position.add(vDelta);
      controls.target.add(vDelta);
    }
  };

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
    applyKeyboard();
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
    isVisible: () => visible,
    render: renderFrame,
    snapshot: () => renderer.domElement.toDataURL('image/png'),
    dispose: () => {
      disposed = true;
      stopLoop();
      resizeObserver.disconnect();
      canvas.removeEventListener('keydown', onCanvasKeyDown);
      canvas.removeEventListener('keyup', onCanvasKeyUp);
      controls.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
