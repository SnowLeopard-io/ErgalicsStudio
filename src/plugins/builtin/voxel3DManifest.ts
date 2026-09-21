// Manifest-only module (B1: keeps `three` out of the startup graph).
import type { PluginManifest } from '@/types/plugin';

export const voxel3DManifest: PluginManifest = {
  id: 'example.voxel-3d',
  name: '3D Voxel Field',
  nameI18n: { 'zh-CN': '3D 体素渲染', 'en-US': '3D Voxel Field' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Isosurface / translucent voxel rendering of 3-D scalar fields.',
  descriptionI18n: {
    'zh-CN': '三维标量场等值面与半透明体素渲染，数据来自项目文件，单次实例化提交。',
    'en-US': 'Isosurface and translucent-voxel rendering of 3-D scalar fields from project files.',
  },
  license: 'MIT',
  entry: 'example.voxel-3d',
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: '3D scalar field' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: '3D scalar field' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: '3D scalar field' },
  ],
};
