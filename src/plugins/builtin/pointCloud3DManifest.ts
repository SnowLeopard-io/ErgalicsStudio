// Manifest-only module (B1: keeps `three` out of the startup graph).
import type { PluginManifest } from '@/types/plugin';

export const pointCloud3DManifest: PluginManifest = {
  id: 'example.point-cloud-3d',
  name: 'Point Cloud 3D',
  nameI18n: { 'zh-CN': '3D 点云', 'en-US': 'Point Cloud 3D' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Interactive 3D point clouds in the host Three.js scene.',
  descriptionI18n: {
    'zh-CN': '基于宿主 Three.js 场景的交互式 3D 点云渲染，支持高度着色与自适应视野。',
    'en-US': 'Interactive 3D point clouds rendered in the host Three.js scene with height coloring and auto-fit.',
  },
  license: 'MIT',
  entry: 'example.point-cloud-3d',
  formats: [
    { extension: '.xyz', mimeTypes: ['text/plain', 'chemical/x-xyz'], description: '3D point cloud' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: '3D point cloud' },
  ],
};
