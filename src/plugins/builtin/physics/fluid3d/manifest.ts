// ==========================================================================
// fluid3d manifest — pure data, split from the plugin file so builtin/index.ts
// can import it statically without dragging the plugin implementation (and its
// Three.js dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const fluid3dManifest: PluginManifest = {
  id: 'example.fluid3d',
  name: '3D Fluid Flow',
  nameI18n: { 'zh-CN': '三维流体绕流', 'en-US': '3D Fluid Flow' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'D3Q19 lattice-Boltzmann flow around any imported 3-D model, with drag/lift.',
  descriptionI18n: {
    'zh-CN':
      'D3Q19 格子 Boltzmann 三维绕流：任意 GLB/GLTF/STL/OBJ/PLY 模型进入流场，切片/涡量/示踪粒子可视化并给出阻力/升力。',
    'en-US':
      'D3Q19 lattice-Boltzmann 3-D flow around any imported GLB/GLTF/STL/OBJ/PLY model, with slice/vorticity/tracer visualisation and drag/lift.',
  },
  license: 'MIT',
  entry: 'example.fluid3d',
  category: 'scientific',
  icon: '≋',
  formats: [
    { extension: '.glb', mimeTypes: ['model/gltf-binary'], description: 'Binary glTF model' },
    { extension: '.gltf', mimeTypes: ['model/gltf+json'], description: 'glTF model' },
    { extension: '.stl', mimeTypes: ['model/stl'], description: 'STL model' },
    { extension: '.obj', mimeTypes: ['model/obj'], description: 'OBJ model' },
    { extension: '.ply', mimeTypes: ['model/ply'], description: 'PLY model' },
  ],
  research: {
    tier: 'quasi-research',
    units: { velocity: 'lattice cells/step', length: 'lattice cells' },
    notes:
      'Real D3Q19 BGK solver; drag and lift from a far-field wake survey; geometry is voxelised so boundary layers are not resolved.',
    notesI18n: {
      'zh-CN': '真实 D3Q19 BGK 求解器；阻力/升力取自远场尾迹动量守恒；几何体经体素化，不解析边界层。',
      'en-US':
        'Real D3Q19 BGK solver; drag and lift from a far-field wake survey; geometry is voxelised so boundary layers are not resolved.',
    },
  },
};
