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
  research: {
    tier: 'quasi-research',
    units: { shannon: 'nats', richness: 'species' },
    reproducible: true,
    notes: 'Chao1, Shannon bootstrap CI and rarefaction are computed with a seeded RNG (mulberry32); Monte Carlo intervals carry sampling error of order 1/sqrt(draws) and assume closed communities.',
    notesI18n: {
      'zh-CN': 'Chao1、Shannon bootstrap 置信区间与稀疏化曲线均使用种子化随机数（mulberry32）；Monte Carlo 区间带有 1/√抽次 量级的抽样误差，并假设封闭群落。',
      'en-US': 'Chao1, Shannon bootstrap CI and rarefaction use a seeded RNG (mulberry32); Monte Carlo intervals carry 1/sqrt(draws) sampling error and assume closed communities.',
    },
  },
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'species,site_1,…,site_n abundance matrix' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'species,site_1,…,site_n abundance matrix' },
  ],
};
