// ==========================================================================
// Population Pyramid — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const popPyramidManifest: PluginManifest = {
  id: 'example.geo-pop-pyramid',
  name: 'Population Pyramid',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Back-to-back age-sex pyramid with dependency ratios and growth-shape reading.',
  nameI18n: {
    'zh-CN': '人口金字塔',
    'en-US': 'Population Pyramid',
  },
  descriptionI18n: {
    'zh-CN': '背靠背年龄性别金字塔（左男右女，年龄自下而上），计算 0-14 / 15-64 / 65+ 占比、总人口性别比，并自动判读增长型/稳定型/缩减型结构。',
    'en-US': 'Back-to-back age-sex pyramid (male left, female right, ages bottom-up) with 0-14 / 15-64 / 65+ shares, overall sex ratio and an expansive/stable/contractive reading.',
  },
  license: 'MIT',
  entry: 'example.geo-pop-pyramid',
  category: 'scientific',
  formats: [
    {
      extension: '.csv',
      mimeTypes: ['text/csv'],
      description: 'CSV: age group label, male, female (any consistent unit; header optional)',
    },
  ],
};
