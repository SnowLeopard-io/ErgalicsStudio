// ==========================================================================
// fluid3d — built-in primitive obstacles
//
// So the plugin works out-of-the-box with no imported file: a sphere, a cube
// and a cylinder, all closed surfaces that go through the same
// `voxelizeGeometry` path as an imported model (no analytic voxeliser here).
// ==========================================================================

import * as THREE from 'three';

export type PresetId = 'sphere' | 'cube' | 'cylinder';

export interface ObstaclePreset {
  id: PresetId;
  label: string;
  labelI18n: Record<string, string>;
  /** Build the closed obstacle geometry (unit-ish size, centred on origin). */
  build(): THREE.BufferGeometry;
}

export const PRESETS: ObstaclePreset[] = [
  {
    id: 'sphere',
    label: 'Sphere',
    labelI18n: { 'zh-CN': '球体', 'en-US': 'Sphere' },
    build: () => new THREE.IcosahedronGeometry(0.5, 4),
  },
  {
    id: 'cube',
    label: 'Cube',
    labelI18n: { 'zh-CN': '立方体', 'en-US': 'Cube' },
    build: () => new THREE.BoxGeometry(1, 1, 1),
  },
  {
    id: 'cylinder',
    label: 'Cylinder',
    labelI18n: { 'zh-CN': '圆柱', 'en-US': 'Cylinder' },
    build: () => new THREE.CylinderGeometry(0.4, 0.4, 1, 32, 1, false),
  },
];

export function presetById(id: PresetId): ObstaclePreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
}
