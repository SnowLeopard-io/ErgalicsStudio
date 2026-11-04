// ==========================================================================
// Point Cloud (2-D) manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const pointCloudManifest: PluginManifest = {
  id: 'example.point-cloud',
  name: 'Point Cloud',
  nameI18n: { 'zh-CN': '点云查看器', 'en-US': 'Point Cloud' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Render .xyz point clouds with adjustable point size.',
  descriptionI18n: {
    'zh-CN': '渲染 .xyz 点云文件，可调节点大小与颜色。',
    'en-US': 'Render .xyz point clouds with adjustable point size.',
  },
  license: 'MIT',
  entry: 'example.point-cloud',
  formats: [
    { extension: '.xyz', mimeTypes: ['text/plain', 'chemical/x-xyz'], description: 'Point cloud' },
  ],
};
