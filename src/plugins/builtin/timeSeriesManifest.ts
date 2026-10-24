// ==========================================================================
// Time Series manifest — pure data, split from the plugin file so
// builtin/index.ts can import it statically without dragging the plugin
// implementation (and its dependency graph) into the first-screen bundle.
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const timeSeriesManifest: PluginManifest = {
  id: 'example.timeseries',
  name: 'Time Series',
  nameI18n: { 'zh-CN': '时间序列绘图', 'en-US': 'Time Series' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Plot CSV columns as time series.',
  descriptionI18n: {
    'zh-CN': '将 CSV 各列绘制为随时间变化的折线图。',
    'en-US': 'Plot CSV columns as time series.',
  },
  license: 'MIT',
  entry: 'example.timeseries',
  research: {
    tier: 'quasi-research',
    reproducible: true,
    notes: 'Publishes OLS trend ±SE, Mann-Kendall S/p and lag-1 autocorrelation for the visible series.',
    notesI18n: {
      'en-US': 'Publishes OLS trend ±SE, Mann-Kendall S/p and lag-1 autocorrelation for the visible series.',
      'zh-CN': '为可见序列发布 OLS 趋势 ±SE、Mann-Kendall S/p 与滞后 1 阶自相关。',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'Time series CSV' },
  ],
};
