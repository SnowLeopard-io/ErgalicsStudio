// ==========================================================================
// Image Viewer manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const imageViewerManifest: PluginManifest = {
  id: 'example.image',
  name: 'Image Viewer',
  nameI18n: { 'zh-CN': '图像查看器', 'en-US': 'Image Viewer' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'View raster images with fit modes.',
  descriptionI18n: {
    'zh-CN': '加载并查看图片文件（PNG/JPEG/WebP/GIF）。',
    'en-US': 'View raster images (PNG/JPEG/WebP/GIF).',
  },
  license: 'MIT',
  entry: 'example.image',
  formats: [
    { extension: '.png', mimeTypes: ['image/png'], description: 'PNG' },
    { extension: '.jpg', mimeTypes: ['image/jpeg'], description: 'JPEG' },
    { extension: '.jpeg', mimeTypes: ['image/jpeg'], description: 'JPEG' },
    { extension: '.webp', mimeTypes: ['image/webp'], description: 'WebP' },
    { extension: '.gif', mimeTypes: ['image/gif'], description: 'GIF' },
  ],
};
