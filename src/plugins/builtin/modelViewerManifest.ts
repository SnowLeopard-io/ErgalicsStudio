// ==========================================================================
// 3D Model Viewer manifest — data-only module (keeps three out of the
// startup graph until the plugin is loaded).
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const modelViewerManifest: PluginManifest = {
  id: 'example.model3d',
  name: '3D Model Viewer',
  nameI18n: { 'zh-CN': '3D 模型查看器', 'en-US': '3D Model Viewer' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'View GLB/GLTF/STL/OBJ/PLY models with view modes, clipping and export.',
  descriptionI18n: {
    'zh-CN': '加载并查看 GLB/GLTF/STL/OBJ/PLY 三维模型，支持观察模式、剖面、测距与模型导出。',
    'en-US': 'Load and view GLB/GLTF/STL/OBJ/PLY models with view modes, clipping, measurement and model export.',
  },
  license: 'MIT',
  entry: 'example.model3d',
  formats: [
    { extension: '.glb', mimeTypes: ['model/gltf-binary', 'application/octet-stream'], description: 'glTF binary' },
    { extension: '.gltf', mimeTypes: ['model/gltf+json', 'application/json'], description: 'glTF JSON' },
    { extension: '.stl', mimeTypes: ['model/stl', 'application/octet-stream'], description: 'STL' },
    { extension: '.obj', mimeTypes: ['text/plain', 'model/obj'], description: 'Wavefront OBJ' },
    { extension: '.ply', mimeTypes: ['application/octet-stream', 'text/plain'], description: 'Polygon File Format' },
  ],
};
