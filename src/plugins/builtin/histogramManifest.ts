// ==========================================================================
// Histogram manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const histogramManifest: PluginManifest = {
  id: 'example.histogram',
  name: 'Histogram',
  nameI18n: { 'zh-CN': '直方图', 'en-US': 'Histogram' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Distribution histogram for numeric data.',
  descriptionI18n: {
    'zh-CN': '对一维数值数据绘制分布直方图，可调节分箱数。',
    'en-US': 'Render a distribution histogram for numeric data.',
  },
  license: 'MIT',
  entry: 'example.histogram',
  research: {
    tier: 'quasi-research',
    reproducible: true,
    notes: 'Publishes n/mean/sd/skewness/kurtosis, Sturges vs Freedman–Diaconis binning and the Silverman KDE bandwidth.',
    notesI18n: {
      'en-US': 'Publishes n/mean/sd/skewness/kurtosis, Sturges vs Freedman–Diaconis binning and the Silverman KDE bandwidth.',
      'zh-CN': '发布 n/均值/标准差/偏度/峰度、Sturges 与 Freedman–Diaconis 分箱对比及 Silverman KDE 带宽。',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text' },
  ],
};
