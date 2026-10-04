// ==========================================================================
// Biodiversity indices — manifest
// ==========================================================================

import type { PluginManifest } from '@/types/plugin';

export const biodiversityManifest: PluginManifest = {
  id: 'example.env-biodiversity',
  name: 'Biodiversity Indices',
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Shannon / Simpson / Pielou indices per site from a species-abundance matrix.',
  nameI18n: {
    'zh-CN': '生物多样性指数',
    'en-US': 'Biodiversity Indices',
  },
  descriptionI18n: {
    'zh-CN': '载入物种丰度表（每行一个物种及其在各样地的个体数，每列一个样地），计算各样地的物种丰富度 S、Shannon 指数 H′、Gini-Simpson 指数 1−Σpᵢ² 与 Pielou 均匀度 J，标注优势种并给出样地间多样性对比解读；结果可导出 CSV。',
    'en-US': 'Load a species-abundance matrix (rows = species, columns = sites) to compute richness S, Shannon H′, Gini-Simpson 1−Σpᵢ² and Pielou evenness J per site, flag dominant species and rank sites by diversity; results export to CSV.',
  },
  license: 'MIT',
  entry: 'example.env-biodiversity',
  category: 'scientific',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'species,site_1,…,site_n abundance matrix' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'species,site_1,…,site_n abundance matrix' },
  ],
};
