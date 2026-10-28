// Manifest-only module (B1: keeps `three` out of the startup graph).
import type { PluginManifest } from '@/types/plugin';

export const surface3DManifest: PluginManifest = {
  id: 'example.surface-3d',
  name: '3D Surface',
  nameI18n: { 'zh-CN': '3D 表面图', 'en-US': '3D Surface' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Height-field surface plots (z = f(x,y)) in the host 3D scene.',
  descriptionI18n: {
    'zh-CN': '三维表面图：高度场网格 z=f(x,y)，数据来自项目文件或示例数据，自适应视角。',
    'en-US': '3D surface plots from height-field grids — project files or sample data, auto-fit view.',
  },
  license: 'MIT',
  entry: 'example.surface-3d',
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: '2D height grid' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: '2D height grid' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: '2D height grid' },
  ],
};
